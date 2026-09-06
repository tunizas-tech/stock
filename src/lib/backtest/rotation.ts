// 월말 순위 → 다음 거래일 시가 교체 → 보유 수익 계산.
//
// 이 파일의 핵심 함정은 strategy.ts와 같다 — 신호를 만든 바로 그 캔들에서 매매하면
// 미래 정보를 쓰는 셈이 된다. 월말 종가로 순위를 매기고 그 종가에 사는 것은 실행
// 불가능한 매매다. 그래서 순위는 월말(d)의 종가까지만 보고, 매수는 d+1의 시가에서
// 일어난다. 청산도 마찬가지로 다음 재조정의 "시가"에 일어나 — 두 번 다 시가만 쓴다.

import type { Candle } from "../types";
import { applyCost } from "./cost";

export interface RotationInput {
  /** 후보 종목. 각 candles는 날짜 오름차순, 서로 다른 길이일 수 있다. */
  assets: { label: string; candles: Candle[] }[];
  lookback: number; // 상대강도 계산에 쓸 과거 거래일 수 (표준 250)
  topK: number; // 보유 개수 (표준 1)
  roundTrip: number;
  from?: string; // YYYY-MM-DD, 이 날짜 이후만 (선택)
}

export interface Rebalance {
  decideDate: string; // 순위를 매긴 날 (월 마지막 거래일)
  tradeDate: string; // 실제 교체가 일어난 날 (다음 거래일)
  held: string[]; // 이번 기간 보유 종목 label
  entered: string[]; // 새로 들어온 종목
  exited: string[]; // 빠진 종목
  periodReturn: number; // 이 보유 기간의 수익 (비용 후)
}

export interface RotationResult {
  rebalances: Rebalance[];
  cumulativeReturn: number; // 복리 누적 (비용 후)
  mdd: number;
  monthsHeldByAsset: Record<string, number>;
}

interface Candidate {
  decideDate: string;
  tradeDate: string;
  held: string[];
}

/** candles가 날짜 오름차순이라는 입력 계약이 깨지면 공통 캘린더 인덱스 계산
 * 전체가 조용히 틀어진다(뒤에서 lookback을 공통 캘린더 인덱스로 재기 때문에,
 * 순서가 깨진 자산 하나가 전체 재조정을 오염시킬 수 있다). 정렬해서 넘어가는
 * 대신 바로 던진다 — 호출자의 데이터 문제를 여기서 삼키면 원인을 못 찾는다. */
function assertAscending(label: string, candles: Candle[]): void {
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].date <= candles[i - 1].date) {
      throw new Error(
        `${label}의 candles가 날짜 오름차순이 아닙니다 (인덱스 ${i}: ${candles[i - 1].date} → ${candles[i].date})`
      );
    }
  }
}

/** dateMaps에서 특정 자산의 특정 날짜 캔들을 찾는다. 공통 캘린더에서 나온
 * 날짜라면 모든 자산에 반드시 존재해야 하므로, 없으면 교집합 계산이 잘못된
 * 것이다 — 조용히 undefined를 넘기지 않고 바로 드러낸다. */
function entryAt(
  dateMaps: Map<string, Map<string, Candle>>,
  label: string,
  date: string
): Candle {
  const candle = dateMaps.get(label)?.get(date);
  if (!candle) {
    throw new Error(`공통 캘린더 날짜 ${date}에 ${label}의 캔들이 없습니다`);
  }
  return candle;
}

export function runRotation(input: RotationInput): RotationResult {
  const { assets, lookback, topK, roundTrip, from } = input;

  // 자산별 날짜 → 캔들 맵.
  const dateMaps = new Map<string, Map<string, Candle>>();
  for (const a of assets) {
    assertAscending(a.label, a.candles);
    const m = new Map<string, Candle>();
    for (const candle of a.candles) m.set(candle.date, candle);
    dateMaps.set(a.label, m);
  }

  // 공통 캘린더: 모든 자산이 값을 가진 날짜의 교집합. 로테이션은 이 날짜에서만
  // 판정·매매할 수 있다 — 한 종목이라도 가격이 없는 날 매매를 가정하면 그 자체가
  // 실행 불가능한 백테스트가 된다.
  let common = assets.length > 0 ? assets[0].candles.map((c) => c.date) : [];
  for (const a of assets.slice(1)) {
    const own = new Set(a.candles.map((c) => c.date));
    common = common.filter((d) => own.has(d));
  }
  common.sort(); // YYYY-MM-DD 문자열이므로 사전순 정렬이 곧 시간순 정렬이다

  // 월말: 그 달의 마지막 공통 거래일. 자연월의 실제 마지막 날이 휴장이라
  // 공통 캘린더에 없어도, 그 달의 마지막 "있는" 날을 그대로 쓴다 — 실제
  // 달력의 말일을 계산하지 않는다.
  const monthEndIndices: number[] = [];
  for (let i = 0; i < common.length; i++) {
    const ym = common[i].slice(0, 7);
    const nextYm = i + 1 < common.length ? common[i + 1].slice(0, 7) : null;
    if (ym !== nextYm) monthEndIndices.push(i);
  }

  // 재조정 후보: 순위를 매길 수 있고(공통 캘린더상 lookback만큼의 과거가 있음)
  // 매수할 수 있는(d+1이 존재) 월말만 후보로 남긴다.
  //
  // lookback의 anchor(과거 기준일)는 반드시 공통 캘린더 인덱스로 잡아야 한다.
  // 자산 "자기" 배열 인덱스로 재면, 다른 자산엔 없는 날짜(개별 종목 거래정지 등)가
  // 그 자산의 인덱스만 밀어 서로 다른 실제 달력일을 anchor로 잡게 된다 —
  // 순위가 서로 다른 기간의 수익률을 비교하는 셈이 되어 비교 자체가 무너진다.
  // 공통 캘린더에서 뽑은 날짜는 교집합의 정의상 모든 자산에 반드시 존재하므로,
  // entryAt의 "없으면 던진다" 가드가 그대로 무결성 검증이 된다.
  const candidates: Candidate[] = [];
  for (const i of monthEndIndices) {
    const decideDate = common[i];
    if (i + 1 >= common.length) break; // 다음 거래일이 없다 — 여기가 항상 마지막 반복이다
    const tradeDate = common[i + 1];

    if (i < lookback) continue; // 공통 캘린더상 lookback치 과거가 없으면 이 재조정 자체를 건너뛴다
    const pastDate = common[i - lookback];

    const ranked = assets.map((a) => {
      const cur = entryAt(dateMaps, a.label, decideDate);
      const past = entryAt(dateMaps, a.label, pastDate);
      return { label: a.label, ret: cur.close / past.close - 1 };
    });

    // 수익률 내림차순, 동점은 label 오름차순 — 비교 함수 자체가 완전순서를
    // 주므로 Array.prototype.sort의 안정성 여부와 무관하게 결과가 결정적이다.
    ranked.sort((x, y) => y.ret - x.ret || x.label.localeCompare(y.label));
    const held = ranked.slice(0, topK).map((r) => r.label);

    candidates.push({ decideDate, tradeDate, held });
  }

  // 완결된 보유 기간은 연속한 두 후보가 있어야 나온다 — 진입은 이번 후보의
  // tradeDate, 청산은 다음 후보의 tradeDate("다음 재조정까지 유지"). 마지막
  // 후보는 청산일을 정해 줄 다음 후보가 없는(아직 진행 중인) 포지션이므로
  // 결과에 넣지 않는다.
  const rebalances: Rebalance[] = [];
  let prevHeld: string[] = [];
  for (let j = 0; j < candidates.length - 1; j++) {
    const cur = candidates[j];
    const next = candidates[j + 1];
    const held = cur.held;
    const entered = held.filter((l) => !prevHeld.includes(l));
    const exited = prevHeld.filter((l) => !held.includes(l));

    // 기간 수익: 보유 종목 각각 진입 시가 → 청산 시가. 균등 비중이므로 평균.
    let grossSum = 0;
    for (const label of held) {
      const entryOpen = entryAt(dateMaps, label, cur.tradeDate).open;
      const exitOpen = entryAt(dateMaps, label, next.tradeDate).open;
      grossSum += exitOpen / entryOpen - 1;
    }
    const grossReturn = grossSum / held.length;

    // 비용: "들어온" 종목 수만큼만 왕복비용을 topK로 나눠 포트폴리오에 비례
    // 부과한다. cost.ts의 왕복비용은 매수+매도를 한 쌍으로 묶은 값이므로,
    // 종목이 새로 들어오는 시점에 그 종목의 미래 매도분까지 한 번에 계상한다.
    // 그러면 (a) 같은 종목이 계속 보유되는 기간(entered가 비어 있음)에는
    // 비용이 다시 붙지 않고, (b) 그 종목이 실제로 빠져나가는 시점("exited"
    // 쪽)에도 중복으로 붙지 않는다 — 이미 들어올 때 왕복분을 다 냈기 때문이다.
    // 첫 재조정은 prevHeld가 없어 topK 전부가 entered이므로, 현금에서 처음
    // 사는 진짜 매수 비용이 자연스럽게 전액 부과된다.
    const turnover = entered.length / topK;
    const periodReturn = applyCost(grossReturn, roundTrip * turnover);

    rebalances.push({
      decideDate: cur.decideDate,
      tradeDate: cur.tradeDate,
      held,
      entered,
      exited,
      periodReturn,
    });

    prevHeld = held;
  }

  // from은 결과 창만 자른다. lookback 계산과 entered/exited 판정은 이미 전체
  // 데이터로 끝났으므로, from을 여기서 적용해도 과거 데이터 접근 범위나
  // "직전에 무엇을 들고 있었는가"라는 사실 자체는 바뀌지 않는다.
  const filtered = from ? rebalances.filter((r) => r.decideDate >= from) : rebalances;

  const monthsHeldByAsset: Record<string, number> = {};
  for (const r of filtered) {
    for (const label of r.held) {
      monthsHeldByAsset[label] = (monthsHeldByAsset[label] ?? 0) + 1;
    }
  }

  // 포지션이 순차적·비중첩이므로(한 기간이 끝나야 다음 기간이 시작) 곧이곧대로
  // 복리 계산한 곡선이 실제 계좌가 겪는 곡선과 같다 — stats.ts의 mdd 설명과 같은 근거.
  let equity = 1;
  let peak = 1;
  let mdd = 0;
  for (const r of filtered) {
    equity *= 1 + r.periodReturn;
    peak = Math.max(peak, equity);
    mdd = Math.max(mdd, 1 - equity / peak);
  }

  return {
    rebalances: filtered,
    cumulativeReturn: equity - 1,
    mdd,
    monthsHeldByAsset,
  };
}
