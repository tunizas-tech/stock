// 4단계: 섹터 로테이션 검증 — data/candles의 파일만 읽는다. API 호출 없음.
//   npm run backtest:rotation
//
// 1~3단계에서 타이밍 규칙은 전부 막혔다(미국→한국 전이는 갭에 있어 못 먹고, RSI/MFI
// 과매도 진입은 무작위보다 나빴다). 그런데 같은 15년 동안 "무엇을 들고 있었는가"의
// 격차는 3,306%p였다 — 언제 샀는가보다 100배 넘게 중요했다. 그래서 이번 물음은
// "언제 사느냐"가 아니라 "무엇을 들고 있느냐"다: 매달 상대강도 1위 섹터로 갈아타는
// 것이, 그냥 제일 좋은 섹터 하나를 계속 들고 있는 것(매수후보유)을 이기는가?
import { existsSync, readFileSync } from "node:fs";
import type { Candle } from "../src/lib/types";
import { runRotation, type RotationInput } from "../src/lib/backtest/rotation";
import { buyAndHold, type BuyHoldResult } from "../src/lib/backtest/benchmark";
import { DEFAULT_ROUND_TRIP } from "../src/lib/backtest/cost";

const load = (f: string): Candle[] =>
  JSON.parse(readFileSync(`data/candles/${f}`, "utf8")).candles;

// 파일이 없으면 undefined — 조용히 건너뛰지 않고 명시적으로 알린 뒤 나머지를 계속한다.
const loadIfExists = (f: string): Candle[] | undefined =>
  existsSync(`data/candles/${f}`) ? load(f) : undefined;

const missing = (label: string, file: string) =>
  console.log(`[${label}] 파일 없음: data/candles/${file} — npm run backtest:fetch 를 먼저 실행하세요.\n`);

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

// MDD 25% 한도 — 설계 §6("스펙 §5(1단계)의 연 −25% 한도를 넘는 결과는 재현 불가능으로
// 표시"). 3단계 backtest-indicators.ts와 같은 기준을 그대로 쓴다.
const MDD_LIMIT = 0.25;
const mddLabel = (mdd: number): string =>
  mdd > MDD_LIMIT ? `${pct(mdd)} (-25%한도 초과, 재현 불가능)` : pct(mdd);

const BAR = "═".repeat(60);

interface LoadedAsset {
  label: string;
  candles: Candle[];
}

/** 날짜 구간으로 캔들을 자른다. buyAndHold를 "같은 기간"으로만 비교하기 위한 단순
 * 필터 — 새 통계가 아니라 배열 슬라이싱이라 여기서 계산한다. */
function sliceWindow(candles: Candle[], startDate: string, endDate: string): Candle[] {
  return candles.filter((c) => c.date >= startDate && c.date <= endDate);
}

/** 9개 후보의 공통 거래일 교집합. rotation.ts 내부의 공통 캘린더 계산과 같은 로직이지만,
 * 여기서는 학습/검증 70/30 분할 경계를 정하는 데만 쓴다(순위·매매 판정이 아니다) —
 * 통계가 아니라 날짜 집합 연산이라 라이브러리를 새로 만들지 않고 여기서 계산한다. */
function commonDatesOf(assets: LoadedAsset[]): string[] {
  let common = assets[0].candles.map((c) => c.date);
  for (const a of assets.slice(1)) {
    const own = new Set(a.candles.map((c) => c.date));
    common = common.filter((d) => own.has(d));
  }
  common.sort();
  return common;
}

function printSingleHold(label: string, bh: BuyHoldResult) {
  console.log(
    `  ${label.padEnd(16)} ${pct(bh.netReturn).padStart(10)}  (${bh.entryDate}~${bh.exitDate}, ${bh.days}일)`
  );
}

// ── 후보/벤치마크 정의 — 설계 §1. 로테이션 후보는 정확히 이 9개뿐이다. ──────────
// TIGER 반도체(091230)는 파일은 있지만 의도적으로 제외한다 — KODEX 반도체와 같은
// 섹터를 중복으로 넣으면, 그 섹터가 우연히 지배했던 시기에 선택이 쏠려 결과가 편향된다.
const CANDIDATES: { file: string; label: string }[] = [
  { file: "KR-091160-D.json", label: "KODEX 반도체" },
  { file: "KR-091170-D.json", label: "KODEX 은행" },
  { file: "KR-091180-D.json", label: "KODEX 자동차" },
  { file: "KR-102960-D.json", label: "KODEX 기계장비" },
  { file: "KR-117460-D.json", label: "KODEX 에너지화학" },
  { file: "KR-117680-D.json", label: "KODEX 철강" },
  { file: "KR-140710-D.json", label: "KODEX 운송" },
  { file: "KR-139260-D.json", label: "TIGER 200 IT" },
  { file: "KR-143860-D.json", label: "TIGER 헬스케어" },
];
const MARKET_BENCHMARK = { file: "KR-069500-D.json", label: "KODEX 200" };

const loadedCandidates: LoadedAsset[] = [];
for (const c of CANDIDATES) {
  const candles = loadIfExists(c.file);
  if (!candles) {
    missing(c.label, c.file);
    continue;
  }
  loadedCandidates.push({ label: c.label, candles });
}
const marketCandles = loadIfExists(MARKET_BENCHMARK.file);
if (!marketCandles) missing(MARKET_BENCHMARK.label, MARKET_BENCHMARK.file);

console.log(`\n${BAR}`);
console.log("4단계: 섹터 로테이션 — 매달 1위로 갈아타는 것이 하나를 계속 드는 것을 이기는가?");
console.log(BAR);
console.log(`비용 왕복 ${pct(DEFAULT_ROUND_TRIP)} · MDD -25% 초과 시 "재현 불가능"으로 표시`);
console.log(
  `후보 로드 ${loadedCandidates.length}/${CANDIDATES.length}개` +
    (marketCandles ? " · 시장벤치마크 KODEX 200 로드됨\n" : " · 시장벤치마크 KODEX 200 없음\n")
);

if (loadedCandidates.length < 2) {
  console.log("후보가 2개 미만이라 로테이션(순위·교체)을 계산할 수 없다. 누락 파일을 먼저 채우세요.\n");
  process.exit(0);
}

// ── 1절: 주 결과 — 표준값 고정, 스윕 없음 ───────────────────────────────────────
console.log("════ 1절. 주 결과 — 표준값 고정 (lookback=250거래일, topK=1, 스윕 없음) ════\n");
console.log(
  "lookback=250거래일(약 12개월)·topK=1은 학계 모멘텀 연구의 관례값이며 데이터를 보고\n" +
    "고른 값이 아니다. 이 결과만이 다중 검정에서 자유롭다(설계 §3·§5). 스윕은 3절에서 별도로 다룬다.\n"
);

const STANDARD_LOOKBACK = 250;
const STANDARD_TOPK = 1;

const rotationInput: RotationInput = {
  assets: loadedCandidates,
  lookback: STANDARD_LOOKBACK,
  topK: STANDARD_TOPK,
  roundTrip: DEFAULT_ROUND_TRIP,
};
const result = runRotation(rotationInput);

// 종료일 근사 — RotationResult는 마지막으로 "완결된" 보유 기간까지만 담고 그 청산일
// 자체는 노출하지 않는다(rotation.ts: 마지막 후보는 청산일을 정해줄 다음 후보가 없어
// 결과에서 제외됨). 그래서 벤치마크 비교 종료일은 9개 후보가 공유하는 데이터의 마지막
// 날짜로 근사한다 — 실제 로테이션의 마지막 청산일과 최대 한 달 차이 날 수 있으나,
// 14년 규모의 비교에는 영향이 없는 수준이다. 시작일(첫 진입일)은 근사가 아니라 정확한 값이다.
const commonEndDate = loadedCandidates.reduce((min, a) => {
  const last = a.candles[a.candles.length - 1].date;
  return last < min ? last : min;
}, loadedCandidates[0].candles[loadedCandidates[0].candles.length - 1].date);

if (result.rebalances.length === 0) {
  console.log("재조정이 한 번도 일어나지 않았다 — lookback을 채울 만큼의 공통 데이터가 없다.\n");
} else {
  const first = result.rebalances[0];
  const last = result.rebalances[result.rebalances.length - 1];

  console.log(
    `공통 기간: 첫 재조정 판정 ${first.decideDate}(진입 ${first.tradeDate}) ~ ` +
      `마지막 재조정 판정 ${last.decideDate}(진입 ${last.tradeDate})`
  );
  console.log(`재조정 횟수(표본) ${result.rebalances.length}회\n`);

  console.log(`누적 순수익(비용후, 복리) ${pct(result.cumulativeReturn)}`);

  // 연평균 환산 — 이미 있는 cumulativeReturn을 실제 보유 연수로 나눠 되돌리는 단순
  // 단위 변환이다. 새 통계가 아니므로(3단계 backtest-indicators.ts의 cumulativeReturn과
  // 같은 성격) 라이브러리가 아니라 여기서 계산한다.
  const years = (Date.parse(commonEndDate) - Date.parse(first.tradeDate)) / (365.25 * 24 * 3600 * 1000);
  const cagr = Math.pow(1 + result.cumulativeReturn, 1 / years) - 1;
  console.log(
    `연평균 환산(근사 ${years.toFixed(1)}년: ${first.tradeDate}~${commonEndDate}, 종료일은 위 설명대로 근사) ${pct(cagr)}`
  );
  console.log(`MDD ${mddLabel(result.mdd)}\n`);

  const swapped = result.rebalances.filter((r) => r.entered.length > 0).length;
  const kept = result.rebalances.length - swapped;
  console.log(
    `실제 교체 발생(비용 있음) ${swapped}회 / 유지(비용 없음) ${kept}회 (표본 ${result.rebalances.length}회)\n`
  );

  const monthsSorted = Object.entries(result.monthsHeldByAsset).sort((a, b) => b[1] - a[1]);
  console.log("종목별 보유 개월 수 (많은 순, 표본은 전체 재조정 횟수):");
  for (const [label, months] of monthsSorted) {
    console.log(
      `  ${label.padEnd(16)} ${String(months).padStart(3)}개월  ${pct(months / result.rebalances.length).padStart(8)}`
    );
  }
  console.log("");

  const [topLabel, topMonths] = monthsSorted[0];
  const topShare = topMonths / result.rebalances.length;
  if (topShare >= 0.5) {
    console.log(
      `>>> 해석: ${topLabel}가 전체 재조정의 ${pct(topShare)}(${topMonths}/${result.rebalances.length}회)를 차지했다.\n` +
        `    이것은 로테이션이라기보다 사실상 ${topLabel} 단독보유에 가깝다 — 아래 결과를 "로테이션 전략의\n` +
        `    성과"가 아니라 "우연히 ${topLabel}를 자주 골랐던 결과"로 읽어야 한다.\n`
    );
  } else {
    console.log(
      `>>> 해석: 어느 한 종목도 과반을 차지하지 않았다 — 여러 섹터에 분산되어 실제로 "갈아탄" 로테이션이었다.\n`
    );
  }

  // ── 2절: 벤치마크 비교 — 이 단계의 핵심 ───────────────────────────────────────
  console.log(BAR);
  console.log("════ 2절. 벤치마크 비교 — 이 단계의 핵심 ════");
  console.log(
    `로테이션과 정확히 같은 기간(${first.tradeDate} ~ ${commonEndDate})으로만 비교한다 —\n` +
      "더 긴 창을 쓰면 어느 쪽이 유리해지든 불공정한 비교가 된다.\n"
  );

  const singleHolds = loadedCandidates
    .map((a) => ({
      label: a.label,
      bh: buyAndHold(sliceWindow(a.candles, first.tradeDate, commonEndDate), DEFAULT_ROUND_TRIP),
    }))
    .sort((a, b) => b.bh.netReturn - a.bh.netReturn);

  console.log("각 후보 단독 보유(매수후보유, 비용후 순수익 내림차순):");
  for (const s of singleHolds) printSingleHold(s.label, s.bh);
  console.log("");

  // 균등분할 — 9개를 매달 재조정하지 않고 첫날 균등하게 사서 끝까지 들고 있었다고
  // 가정한 근사치다. 정확한 포트폴리오 복리 곡선(매일 리밸런싱 등)이 아니라 "9개 각각의
  // 순수익 평균"이며, 이 근사는 지시된 방식이다 — "선택이 값어치를 하는가"라는 벤치마크
  // 목적에는 이 정도로 충분하다.
  const equalSplit = singleHolds.reduce((s, x) => s + x.bh.netReturn, 0) / singleHolds.length;
  console.log(`9개 균등분할(9개 순수익의 평균, 재조정 없음) ${pct(equalSplit)}\n`);

  let marketBh: BuyHoldResult | undefined;
  if (marketCandles) {
    marketBh = buyAndHold(sliceWindow(marketCandles, first.tradeDate, commonEndDate), DEFAULT_ROUND_TRIP);
    console.log(`KODEX 200(시장벤치마크, 로테이션 후보 아님):`);
    printSingleHold(MARKET_BENCHMARK.label, marketBh);
    console.log("");
  }

  console.log(BAR);
  console.log("┃ 판정 — 로테이션이 존재할 이유가 있는가 ┃");
  console.log(BAR);
  console.log(`로테이션 누적(비용후) ${pct(result.cumulativeReturn)}\n`);

  const best = singleHolds[0];
  const rotBeatsBest = result.cumulativeReturn > best.bh.netReturn;
  console.log(
    `1) 로테이션 vs 최고 단독 보유(${best.label} ${pct(best.bh.netReturn)}) — 가장 중요한 비교: ` +
      (rotBeatsBest ? "이겼다" : "졌다") +
      ` (차이 ${pct(result.cumulativeReturn - best.bh.netReturn)})`
  );

  const rotBeatsEqual = result.cumulativeReturn > equalSplit;
  console.log(
    `2) 로테이션 vs 9개 균등분할(${pct(equalSplit)}) — 고르는 것이 값어치를 했는가: ` +
      (rotBeatsEqual ? "이겼다" : "졌다") +
      ` (차이 ${pct(result.cumulativeReturn - equalSplit)})`
  );

  if (marketBh) {
    const rotBeatsMarket = result.cumulativeReturn > marketBh.netReturn;
    console.log(
      `3) 로테이션 vs KODEX 200(${pct(marketBh.netReturn)}) — 섹터 선택 자체가 쓸모 있는가: ` +
        (rotBeatsMarket ? "이겼다" : "졌다") +
        ` (차이 ${pct(result.cumulativeReturn - marketBh.netReturn)})`
    );
  }
  console.log("");

  if (!rotBeatsBest) {
    console.log(
      `>>> 결론: 로테이션은 최고 단독 보유(${best.label})를 이 기간 동안 이기지 못했다.\n` +
        `    이 결과대로라면 매달 갈아타는 로테이션을 쓸 이유가 없고, "제일 좋은 섹터 하나를\n` +
        `    계속 든다"가 실행 가능한 결론이다(설계 §9의 예상과 일치).\n`
    );
  } else {
    console.log(
      `>>> 결론: 로테이션이 이 기간의 최고 단독 보유(${best.label})까지 이겼다 — 설계 §9의 예상과\n` +
        `    반대되는 결과이므로, 이 결과를 실전에 쓰기 전에 별도로 재현·검증할 것을 권한다.\n`
    );
  }
}

// ── 3절: 스윕 (학습/검증 분할) — 별도, 주 결과 아님 ─────────────────────────────
console.log(BAR);
console.log("경고: 아래는 lookback 3개 × topK 3개 = 9개 조합을 훑은 결과다. 훑으면 반드시 좋아");
console.log('보이는 조합이 나온다. 이 절의 숫자를 "주 결과"로 읽지 말 것 — 주 결과는 위 1절이다.');
console.log(`${BAR}\n`);
console.log("════ 3절. 스윕 — 학습 70% / 검증 30% (별도 절, 과최적화 방어, 설계 §5) ════\n");

const commonDates = commonDatesOf(loadedCandidates);
const trainEnd = Math.floor(commonDates.length * 0.7);

if (trainEnd < 1 || trainEnd >= commonDates.length) {
  console.log("공통 거래일이 너무 적어 학습/검증을 나눌 수 없다.\n");
} else {
  const trainEndDate = commonDates[trainEnd - 1];
  const validStartDate = commonDates[trainEnd];
  const commonLastDate = commonDates[commonDates.length - 1];

  console.log(`공통 캘린더(9개 후보 교집합) ${commonDates.length}거래일 (${commonDates[0]}~${commonLastDate})`);
  console.log(`학습 ${commonDates[0]}~${trainEndDate} / 검증 ${validStartDate}~${commonLastDate}\n`);

  // 학습: 검증 구간 데이터를 아예 안 보이게 자른 배열로 별도 실행한다.
  // 검증: RotationInput.from으로 결과 창만 자른다 — lookback은 여전히 경계 이전 데이터를
  // 볼 수 있어야 하므로(설계 지시), 자산 배열 자체는 전체를 그대로 넘긴다.
  const trainAssets: LoadedAsset[] = loadedCandidates.map((a) => ({
    label: a.label,
    candles: a.candles.filter((c) => c.date <= trainEndDate),
  }));

  const LOOKBACK_OPTS = [60, 125, 250];
  const TOPK_OPTS = [1, 2, 3];

  interface SweepRow {
    lookback: number;
    topK: number;
    trainN: number;
    trainCum: number;
    validN: number;
    validCum: number;
  }

  const rows: SweepRow[] = [];
  for (const lookback of LOOKBACK_OPTS) {
    for (const topK of TOPK_OPTS) {
      const trainResult = runRotation({
        assets: trainAssets,
        lookback,
        topK,
        roundTrip: DEFAULT_ROUND_TRIP,
      });
      const validResult = runRotation({
        assets: loadedCandidates,
        lookback,
        topK,
        roundTrip: DEFAULT_ROUND_TRIP,
        from: validStartDate,
      });
      rows.push({
        lookback,
        topK,
        trainN: trainResult.rebalances.length,
        trainCum: trainResult.cumulativeReturn,
        validN: validResult.rebalances.length,
        validCum: validResult.cumulativeReturn,
      });
    }
  }

  console.log("lookback  topK    학습(표본/누적)        검증(표본/누적)");
  for (const r of rows) {
    console.log(
      `${String(r.lookback).padStart(6)}  ${String(r.topK).padStart(4)}    ` +
        `${String(r.trainN).padStart(3)}건 ${pct(r.trainCum).padStart(9)}      ` +
        `${String(r.validN).padStart(3)}건 ${pct(r.validCum).padStart(9)}`
    );
  }
  console.log("");

  const validSingle = loadedCandidates
    .map((a) => ({
      label: a.label,
      bh: buyAndHold(sliceWindow(a.candles, validStartDate, commonLastDate), DEFAULT_ROUND_TRIP),
    }))
    .sort((a, b) => b.bh.netReturn - a.bh.netReturn);
  const validBest = validSingle[0];
  const validEqualSplit = validSingle.reduce((s, x) => s + x.bh.netReturn, 0) / validSingle.length;

  console.log(`검증 기간(${validStartDate}~${commonLastDate}) 최고 단독 보유: ${validBest.label} ${pct(validBest.bh.netReturn)}`);
  console.log(`검증 기간 9개 균등분할(근사) ${pct(validEqualSplit)}\n`);

  const trainWinner = [...rows].sort((a, b) => b.trainCum - a.trainCum)[0];
  console.log(
    `학습 1위 조합: lookback=${trainWinner.lookback} topK=${trainWinner.topK} ` +
      `(학습 ${trainWinner.trainN}건 누적 ${pct(trainWinner.trainCum)})`
  );
  console.log(
    `  → 검증 ${trainWinner.validN}건 누적 ${pct(trainWinner.validCum)} vs 검증 최고 단독 보유 ${pct(validBest.bh.netReturn)} ` +
      `vs 검증 균등분할 ${pct(validEqualSplit)}`
  );

  if (trainWinner.validN === 0) {
    console.log("판정: 학습 1위 조합은 검증 구간에서 재조정이 한 번도 없었다 — 검증 자체가 불가능하다.\n");
  } else {
    const heldUp = trainWinner.validCum >= validBest.bh.netReturn;
    console.log(
      heldUp
        ? "판정: 학습 1위가 검증에서도 최고 단독 보유를 넘어섰다 — 우연만은 아니었을 가능성이 있다\n" +
            "      (그래도 9개 조합을 훑은 다중 검정 경고는 여전히 유효하다).\n"
        : "판정: 학습 1위는 검증에서 최고 단독 보유를 넘지 못했다 — 학습에서 좋아 보였던 결과는\n" +
            "      우연이었다는 뜻이다.\n"
    );
  }
}

console.log(
  "읽는 법: 1·2절(표준값 고정)만이 다중 검정에서 자유로운 주 결과다. 로테이션이 최고 단독\n" +
    "보유를 못 이기면 그 자체가 결론이며, 3절 스윕은 '이렇게까지 훑어도 이 정도'라는 상한선으로만 읽는다.\n"
);
