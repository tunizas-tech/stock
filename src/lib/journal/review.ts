// 매매일지 자기검증 — 짝짓기·반사실·대조군·묶음(6단계 설계 §3). 순수 함수만,
// 파일 I/O·fetch 없음. 데이터(가격 조회 함수 포함)는 전부 인자로 받는다.
//
// benchmark.ts의 mulberry32와 원리는 같지만 이 모듈은 backtest/strategy.ts를
// import하지 않는다 — journal 쪽 대조군은 "한 번에 한 포지션만 보유"라는
// 백테스트 제약이 없는, 단순 독립 표본 평균이라 전략 실행기가 필요 없다.
// 브리프가 두 트리를 독립적으로 유지하라고 명시했다.

import type { Emotion, JournalEntry, JournalSnapshot, ReasonTag } from "../types";
import { applyCost } from "../backtest/cost";
import { isAfterCloseKst } from "../kst";
import { REASON_TAGS } from "./validate";

// ---------------------------------------------------------------------------
// mulberry32 — backtest/benchmark.ts와 같은 패턴을 그대로 복사한다(import 아님).
// 시드 고정 → 같은 결과 재현이 목적이고, 암호학적 강도는 필요 없다.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** 가격 조회 — 종목 티커로 날짜 오름차순 종가 배열을 돌려준다. 없으면 undefined. */
export type PriceLookup = (ticker: string) => { date: string; close: number }[] | undefined;

// ---------------------------------------------------------------------------
// 짝짓기 — 평균단가(§3 "실제 수익")
// ---------------------------------------------------------------------------

export interface ClosedTrade {
  ticker: string;
  name: string;
  entryDate: string;
  /** 진입 매수를 실제로 "쓴" 시각(ISO) — entersSameDay로 그날 종가 진입 여부를 가른다. */
  entryCreatedAt?: string;
  exitDate: string;
  /** 달력일 차이 — 매매일지 날짜는 거래일이 아니라 달력일이라 그대로 뺀다. */
  holdDays: number;
  avgCost: number;
  exitPrice: number;
  grossReturn: number;
  netReturn: number;
  emotion: Emotion;
  primaryTag?: ReasonTag;
  snapshot?: JournalSnapshot;
  /** 이 매도로 청산된 수량(전체 포지션이 아니라 이 건이 닫은 몫). */
  qty: number;
}

export interface OpenPosition {
  ticker: string;
  name: string;
  since: string;
  avgCost: number;
  qty: number;
  emotion: Emotion;
  primaryTag?: ReasonTag;
}

/** 두 날짜(YYYY-MM-DD) 사이의 달력일 차이. */
function calendarDays(fromDate: string, toDate: string): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(toDate) - Date.parse(fromDate)) / MS_PER_DAY);
}

interface BuyAttribution {
  emotion: Emotion;
  primaryTag?: ReasonTag;
  snapshot?: JournalSnapshot;
}

/**
 * 같은 종목의 buy→sell을 평균단가로 짝짓는다(증권사 표시 방식과 같다 — FIFO는
 * 부분 매도에서 "어느 매수분이 팔렸나"가 모호해 감정·태그 귀속을 못 정한다).
 * price·qty가 둘 다 있는 buy/sell만 포지션에 영향을 준다 — note/skip, 값이
 * 빠진 buy/sell은 무시한다.
 */
export function pairTrades(
  entries: JournalEntry[],
  roundTrip: number
): { closed: ClosedTrade[]; open: OpenPosition[] } {
  const byTicker = new Map<string, JournalEntry[]>();
  for (const e of entries) {
    if (e.action !== "buy" && e.action !== "sell") continue;
    // 값이 "있는지"가 아니라 "쓸 수 있는지"를 본다. 옛 기록·손상된 저장소에서
    // price가 null이나 문자열로 들어오면 undefined 검사만으로는 통과해 버리고,
    // 그 뒤 평균단가 계산이 NaN이 되어 그 종목의 모든 거래(그리고 그 거래가
    // 속한 묶음 평균 전체)가 NaN으로 오염된다 — 한 줄의 나쁜 값이 화면 전체를
    // 망치지 않도록 여기서 걸러낸다. price<=0·qty<=0도 같은 이유다: 0주 매수는
    // 평균단가 계산을 0으로 나누고, 가격 0짜리 매수는 평균단가를 0으로 만들어
    // 그 뒤 수익률이 Infinity가 된다.
    if (
      typeof e.price !== "number" ||
      typeof e.qty !== "number" ||
      !Number.isFinite(e.price) ||
      !Number.isFinite(e.qty) ||
      e.price <= 0 ||
      e.qty <= 0
    )
      continue;
    const arr = byTicker.get(e.ticker) ?? [];
    arr.push(e);
    byTicker.set(e.ticker, arr);
  }

  const closed: ClosedTrade[] = [];
  const open: OpenPosition[] = [];

  for (const [ticker, list] of byTicker) {
    // 날짜 오름차순, 같은 날짜면 원래 배열 순서를 유지(안정 정렬 — Array#sort는
    // ECMA2019+ 표준에서 안정성을 보장한다).
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));

    let qty = 0;
    let avgCost = 0;
    let since: string | undefined;
    // since와 항상 같이 세팅/리셋된다 — 같은 진입에 물린 buy가 남긴 createdAt.
    let sinceCreatedAt: string | undefined;
    let name = sorted[0].name;
    // "가장 최근 매수"의 감정·주 이유·스냅샷 — 매도 시 이 값을 그대로 물려준다.
    let lastBuy: BuyAttribution | undefined;

    for (const e of sorted) {
      const q = e.qty as number;
      const p = e.price as number;

      if (e.action === "buy") {
        if (qty === 0) {
          since = e.date; // 포지션이 없던 상태에서의 매수 = 새 진입
          sinceCreatedAt = e.createdAt;
        }
        avgCost = (avgCost * qty + p * q) / (qty + q);
        qty += q;
        name = e.name;
        lastBuy = { emotion: e.emotion, primaryTag: e.primaryTag, snapshot: e.snapshot };
        continue;
      }

      // sell: 보유가 없으면 팔 것이 없으니 무시.
      if (qty <= 0) continue;
      const closeQty = Math.min(q, qty);
      if (closeQty <= 0) continue;

      // qty > 0인 상태에서만 이 분기에 도달하므로 반드시 이전에 매수가 있었고,
      // since·lastBuy는 항상 정의돼 있다.
      const entryDate = since as string;
      const entryCreatedAt = sinceCreatedAt;
      const attribution = lastBuy as BuyAttribution;
      const grossReturn = p / avgCost - 1;

      closed.push({
        ticker,
        name,
        entryDate,
        entryCreatedAt,
        exitDate: e.date,
        holdDays: calendarDays(entryDate, e.date),
        avgCost,
        exitPrice: p,
        grossReturn,
        netReturn: applyCost(grossReturn, roundTrip),
        emotion: attribution.emotion,
        primaryTag: attribution.primaryTag,
        snapshot: attribution.snapshot,
        qty: closeQty,
      });

      qty -= closeQty;
      if (qty === 0) {
        since = undefined;
        sinceCreatedAt = undefined;
      }
    }

    if (qty > 0) {
      const attribution = lastBuy as BuyAttribution;
      open.push({
        ticker,
        name,
        since: since as string,
        avgCost,
        qty,
        emotion: attribution.emotion,
        primaryTag: attribution.primaryTag,
      });
    }
  }

  return { closed, open };
}

// ---------------------------------------------------------------------------
// 반사실 — 집계 전용(C3). 거래 정체성과 묶어 거래별로 노출하는 함수는 여기서
// export하지 않는다 — 그 자체가 "팔지 않았으면" 개별 표시를 막는 장치다.
// ---------------------------------------------------------------------------

/**
 * `fromDate` "다음" 거래일 종가에 진입해 `horizonDays` 거래일 뒤 종가에 청산.
 * `closes`는 날짜 오름차순을 가정한다(Candle 배열 관례와 동일).
 *
 * `includeSameDay`가 true면 `fromDate` 그날 종가부터 진입한다(설계 §5) — 장
 * 마감 전에 쓴 기록은 그날 종가를 아직 모르므로 미리보기가 아니다.
 */
export function forwardReturn(
  closes: { date: string; close: number }[],
  fromDate: string,
  horizonDays: number,
  roundTrip: number,
  includeSameDay = false
): number | undefined {
  // fromDate가 시리즈 시작보다 이르면 findIndex가 인덱스 0에 걸려 실제보다
  // 짧은 창을 몰래 계산한다(tradingDayIndex와 같은 가드 — M3).
  if (closes.length === 0 || fromDate < closes[0].date) return undefined;
  const entryIdx = closes.findIndex((c) => (includeSameDay ? c.date >= fromDate : c.date > fromDate));
  if (entryIdx < 0) return undefined;
  const exitIdx = entryIdx + horizonDays;
  if (exitIdx >= closes.length) return undefined;
  const gross = closes[exitIdx].close / closes[entryIdx].close - 1;
  return applyCost(gross, roundTrip);
}

/**
 * createdAt이 그 거래일(date)의 장 마감(15:30 KST) 전이면 그날 종가 진입으로
 * 본다(설계 §5) — 마감 전에 쓴 기록은 그날 종가를 아직 모르므로 미리보기가
 * 아니다. createdAt이 없으면(옛 기록) 종전대로 다음 거래일.
 */
export function entersSameDay(e: { date: string; createdAt?: string }): boolean {
  return e.createdAt !== undefined && !isAfterCloseKst(e.createdAt, e.date);
}

// ---------------------------------------------------------------------------
// 대조군(C2)
// ---------------------------------------------------------------------------

/**
 * 같은 종목·같은 보유일수로 시드 고정 무작위 진입 `count`회의 평균 수익(비용 반영).
 * 유효 진입 창(`closes.length - holdDays`)이 3 미만이면 대조군 자체가 통계적으로
 * 의미 없다고 보고 undefined를 돌려준다.
 */
export function randomBenchmark(
  closes: { date: string; close: number }[],
  holdDays: number,
  count: number,
  seed: number,
  roundTrip: number
): number | undefined {
  if (count <= 0) return undefined;
  const validWindows = closes.length - holdDays;
  if (validWindows < 3) return undefined;

  const rand = mulberry32(seed);
  let sum = 0;
  for (let k = 0; k < count; k++) {
    const entryIdx = Math.floor(rand() * validWindows);
    const exitIdx = entryIdx + holdDays;
    const gross = closes[exitIdx].close / closes[entryIdx].close - 1;
    sum += applyCost(gross, roundTrip);
  }
  return sum / count;
}

// ---------------------------------------------------------------------------
// 묶음 — 1축만(N1)
// ---------------------------------------------------------------------------

/** 이 표본 수 미만이면 "판단 보류"(회색). 숫자 자체는 계속 계산해 화면이 흐리게 보여줄 뿐이다. */
export const MIN_SAMPLE = 20;

/** 확신도(emotion) → "이 거래가 수익으로 끝날 것"이라고 선언한 확률(설계 §1 emotion 정의). */
export const DECLARED_PROB: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 0.5,
  2: 0.6,
  3: 0.7,
  4: 0.8,
  5: 0.9,
};

export interface GroupStat {
  key: string;
  /** 이 묶음의 전체 거래 수 — mean·winRate의 모집단(스펙 §3 "모든 칸에 표본 수"). */
  n: number;
  /**
   * 그중 로컬 시세로 무작위 대조군을 **실제로 돌린** 거래 수 — `delta`의
   * 모집단이다(분자와 분모가 정확히 같은 거래). 시세가 아예 없는 종목, 당일
   * 매매(보유 거래일 0), 시세 구간 밖의 매매는 전부 여기서 빠진다.
   * n과 다르면 화면이 그 사실을 같이 보여준다.
   */
  priceN: number;
  insufficient: boolean;
  mean?: number;
  winRate?: number;
  randomMean?: number;
  /** (시세 있는 거래들의 평균) − randomMean. 같은 모집단끼리의 차이다. */
  delta?: number;
  cfMean20?: number;
}

export interface EmotionGroupStat extends GroupStat {
  declaredProb: number;
}

const RANDOM_BENCHMARK_COUNT = 20;
const COUNTERFACTUAL_HORIZON_DAYS = 20;

/**
 * 종가 배열에서 이 날짜의 인덱스. 그날 거래가 없었으면(주말·휴장) 그 다음
 * 거래일 인덱스를 준다. 배열 끝을 넘으면 undefined.
 *
 * 시리즈 시작 **전**의 날짜도 undefined다 — "그 다음 거래일"이 아니라 아예
 * 데이터 밖이기 때문이다. 첫 인덱스(0)로 붙여버리면 보유 기간이 실제보다
 * 짧게 잡혀 잘못된 대조군이 나온다.
 */
function tradingDayIndex(
  closes: { date: string; close: number }[],
  date: string
): number | undefined {
  if (closes.length === 0 || date < closes[0].date) return undefined;
  const i = closes.findIndex((c) => c.date >= date);
  return i < 0 ? undefined : i;
}

/**
 * 한 묶음의 통계를 낸다. n=0이어도 키는 그대로 반환한다 — 표본이 없다는 사실
 * 자체가 "이 그룹은 아직 판단할 수 없다"는 정보이지, 숨길 이유가 아니다.
 */
function computeGroupStat(
  key: string,
  trades: ClosedTrade[],
  priceLookup: PriceLookup,
  seed: number,
  roundTrip: number
): GroupStat {
  const n = trades.length;
  if (n === 0) return { key, n: 0, priceN: 0, insufficient: true };

  const netReturns = trades.map((t) => t.netReturn);
  const mean = avg(netReturns);
  const winRate = netReturns.filter((r) => r > 0).length / n;

  // 대조군이 실제로 돈 거래의 수익만 따로 모은다 — randomMean은 그 거래들에서만
  // 나오므로, 전체 평균(mean)에서 빼면 서로 다른 모집단을 뺀 수치가 된다.
  // "무작위보다 나았다"가 사실은 "대조군이 없던 거래가 잘됐다"일 수 있다는 뜻이다.
  // 두 배열은 항상 같은 거래에서 같이 채워진다(분자와 분모가 같은 모집단).
  const pricedReturns: number[] = [];
  const randomMeans: number[] = [];
  const cfMeans: number[] = [];
  for (const t of trades) {
    const prices = priceLookup(t.ticker);
    if (prices === undefined) continue;

    // 대조군 보유일은 **거래일** 차이다. randomBenchmark는 종가 배열의 인덱스를
    // 그대로 더하므로 달력일(t.holdDays)을 넘기면 주말만큼 더 긴 기간과 비교하게
    // 된다(금→화 매매는 달력 4일이지만 거래일로는 2일이다). ClosedTrade.holdDays와
    // 보유기간 묶음은 달력일 그대로 둔다 — 사용자는 달력으로 생각하기 때문이고,
    // 그래서 이 두 숫자는 의도적으로 다르다.
    const entryIdx = tradingDayIndex(prices, t.entryDate);
    const exitIdx = tradingDayIndex(prices, t.exitDate);
    const tradingHold =
      entryIdx !== undefined && exitIdx !== undefined ? exitIdx - entryIdx : 0;
    // 0 이하면 이 종가 배열로는 보유 구간을 못 잡는다(시세가 매매일 이후에만
    // 있는 경우 등) — 0일짜리 무작위 진입은 비용만 빼는 무의미한 값이라 뺀다.
    if (tradingHold > 0) {
      const rb = randomBenchmark(prices, tradingHold, RANDOM_BENCHMARK_COUNT, seed, roundTrip);
      if (rb !== undefined) {
        randomMeans.push(rb);
        pricedReturns.push(t.netReturn);
      }
    }

    const cf = forwardReturn(
      prices,
      t.entryDate,
      COUNTERFACTUAL_HORIZON_DAYS,
      roundTrip,
      entersSameDay({ date: t.entryDate, createdAt: t.entryCreatedAt })
    );
    if (cf !== undefined) cfMeans.push(cf);
  }

  const priceN = pricedReturns.length; // === randomMeans.length
  const randomMean = randomMeans.length > 0 ? avg(randomMeans) : undefined;
  // 반사실은 대조군과 조건이 다르다(진입 다음 거래일부터 20거래일이면 되고 실제
  // 보유 기간을 몰라도 된다) — 그래서 priceN이 아니라 자기 표본으로만 판단한다.
  const cfMean20 = cfMeans.length > 0 ? avg(cfMeans) : undefined;
  const delta = randomMean !== undefined ? avg(pricedReturns) - randomMean : undefined;

  return {
    key,
    n,
    priceN,
    insufficient: n < MIN_SAMPLE,
    mean,
    winRate,
    randomMean,
    delta,
    cfMean20,
  };
}

/** 확신도별(1~5) 묶음. 거래가 0건인 등급도 키는 항상 낸다. */
export function groupByEmotion(
  closed: ClosedTrade[],
  priceLookup: PriceLookup,
  seed: number,
  roundTrip: number
): EmotionGroupStat[] {
  const keys: Emotion[] = [1, 2, 3, 4, 5];
  return keys.map((k) => {
    const trades = closed.filter((t) => t.emotion === k);
    const stat = computeGroupStat(String(k), trades, priceLookup, seed, roundTrip);
    return { ...stat, declaredProb: DECLARED_PROB[k] };
  });
}

const NO_TAG = "없음";

/**
 * 주 이유별(8종 + "없음") 묶음. 태그 목록은 validate.ts의 REASON_TAGS를 그대로
 * 쓴다(R5) — 이걸 로컬에서 따로 유지하면 7단계에서 추가된 "에이전트" 태그가
 * 이 표에서 조용히 빠진다.
 */
export function groupByPrimaryTag(
  closed: ClosedTrade[],
  priceLookup: PriceLookup,
  seed: number,
  roundTrip: number
): GroupStat[] {
  const keys: string[] = [...REASON_TAGS, NO_TAG];
  return keys.map((key) => {
    const trades = closed.filter((t) => (t.primaryTag ?? NO_TAG) === key);
    return computeGroupStat(key, trades, priceLookup, seed, roundTrip);
  });
}

const HOLD_BUCKETS = ["1-3", "4-10", "11-30", "31+"] as const;

function holdBucket(days: number): (typeof HOLD_BUCKETS)[number] {
  if (days <= 3) return "1-3";
  if (days <= 10) return "4-10";
  if (days <= 30) return "11-30";
  return "31+";
}

/** 보유기간별(1-3/4-10/11-30/31+일) 묶음. */
export function groupByHoldBucket(
  closed: ClosedTrade[],
  priceLookup: PriceLookup,
  seed: number,
  roundTrip: number
): GroupStat[] {
  return HOLD_BUCKETS.map((key) => {
    const trades = closed.filter((t) => holdBucket(t.holdDays) === key);
    return computeGroupStat(key, trades, priceLookup, seed, roundTrip);
  });
}

/**
 * `n`(관망 전체 수) · `pairedN`(그중 KOSPI까지 짝지어져 `delta`의 분모가 된 수) ·
 * `cfMean20`(그 자체 표본 수는 n 이하)은 서로 다른 모집단에서 나올 수 있다(I2) —
 * KOSPI 시세가 일부 관망에서만 살아 있으면 cfMean20은 n건 평균인데 delta는
 * pairedN건 평균끼리의 차이가 된다. `pairedN`을 항상 내는 이유는 이 차이를
 * 화면이 숨기지 않게 하기 위해서다(KOSPI가 아예 없으면 0).
 */
export interface SkipStat {
  n: number;
  cfMean20?: number;
  kospiMean20?: number;
  delta?: number;
  /** delta·kospiMean20의 실제 모집단 크기 — KOSPI가 없으면 항상 0. */
  pairedN: number;
  insufficient: boolean;
}

/**
 * 에이전트 관망 전체 통계에 확신도(emotion 1~5)별 소계를 붙인 모양 — 페이지가
 * 이 타입을 그대로 import해서 쓴다(재선언하면 route가 필드를 바꿔도 컴파일이
 * 통과해 런타임에만 깨진다, 기존 SkipStat과 같은 이유).
 */
export type AgentSkipStat = SkipStat & { byEmotion: Record<"1" | "2" | "3" | "4" | "5", SkipStat> };

/**
 * 관망의 20거래일 반사실 — 사람/에이전트로 나눈다(섞으면 "내 판단력"에 에이전트
 * 점수가 들어간다). 같은 진입일·같은 창의 KOSPI 수익을 나란히 둔다: 뉴스로 알게
 * 된 종목은 이미 오른 종목이기 쉬워, 시장과 비교하지 않으면 "+3%"가 좋은지 나쁜지
 * 알 수 없다. delta는 둘 다 계산된 관망끼리만 뺀다.
 */
export function skipCounterfactual(
  entries: JournalEntry[],
  priceLookup: PriceLookup,
  roundTrip: number,
  kospiCloses?: { date: string; close: number }[]
): { user: SkipStat; agent: AgentSkipStat } {
  type Bucket = { cf: number[]; pairs: [number, number][] };
  const acc = {
    user: { cf: [] as number[], pairs: [] as [number, number][] },
    agent: { cf: [] as number[], pairs: [] as [number, number][] },
  };
  // 에이전트 관망만 확신도(emotion)별로 한 번 더 누적한다 — "확신도 4~5로 낸
  // 에이전트 후보가 1~3보다 실제로 나았나"를 답하는 표를 만들기 위해서다.
  // 사람 관망은 여기 섞이면 "내 판단력"에 에이전트 점수가 들어가 버리므로
  // 절대 넣지 않는다(브리프: 사람 관망은 바꾸지 않는다).
  const agentByEmotion: Record<1 | 2 | 3 | 4 | 5, Bucket> = {
    1: { cf: [], pairs: [] },
    2: { cf: [], pairs: [] },
    3: { cf: [], pairs: [] },
    4: { cf: [], pairs: [] },
    5: { cf: [], pairs: [] },
  };
  for (const e of entries) {
    if (e.action !== "skip") continue;
    const prices = priceLookup(e.ticker);
    if (prices === undefined) continue;
    const sameDay = entersSameDay(e);
    const cf = forwardReturn(prices, e.date, COUNTERFACTUAL_HORIZON_DAYS, roundTrip, sameDay);
    if (cf === undefined) continue;
    const isAgent = e.author === "agent";
    const bucket = isAgent ? acc.agent : acc.user;
    bucket.cf.push(cf);
    const k = kospiCloses
      ? forwardReturn(kospiCloses, e.date, COUNTERFACTUAL_HORIZON_DAYS, roundTrip, sameDay)
      : undefined;
    if (k !== undefined) bucket.pairs.push([cf, k]);
    if (isAgent) {
      const eb = agentByEmotion[e.emotion];
      eb.cf.push(cf);
      if (k !== undefined) eb.pairs.push([cf, k]);
    }
  }
  const stat = (b: Bucket): SkipStat => {
    const n = b.cf.length;
    const s: SkipStat = { n, pairedN: b.pairs.length, insufficient: n < MIN_SAMPLE };
    if (n > 0) s.cfMean20 = avg(b.cf);
    if (b.pairs.length > 0) {
      s.kospiMean20 = avg(b.pairs.map((p) => p[1]));
      s.delta = avg(b.pairs.map((p) => p[0])) - s.kospiMean20;
    }
    return s;
  };
  const byEmotion: Record<"1" | "2" | "3" | "4" | "5", SkipStat> = {
    "1": stat(agentByEmotion[1]),
    "2": stat(agentByEmotion[2]),
    "3": stat(agentByEmotion[3]),
    "4": stat(agentByEmotion[4]),
    "5": stat(agentByEmotion[5]),
  };
  return { user: stat(acc.user), agent: { ...stat(acc.agent), byEmotion } };
}

// ---------------------------------------------------------------------------
// 규율(I3) — 채택한 손절 규칙이 있을 때만
// ---------------------------------------------------------------------------

/**
 * `stopLossPct`가 설정돼 있을 때만 위반을 센다 — 채택하지 않은 규칙은 어길 수
 * 없다(설계 I2/I3, "손절 기준은 사용자 설정, 기본값 없음"). 종가 기준 판정이라
 * 장중에만 손절선을 스치고 종가는 회복한 경우를 놓친다 — 그래서 이 숫자는
 * 실제 규율 위반보다 항상 적게(또는 같게) 나온다.
 *
 * `roundTrip`은 다른 §3 함수들과 시그니처를 맞추기 위해 받는다 — 여기서는
 * 이미 비용이 반영된 `ClosedTrade.netReturn`을 그대로 비교에 쓰므로 별도로
 * 쓰이지 않는다.
 */
export function disciplineReport(
  closed: ClosedTrade[],
  priceLookup: PriceLookup,
  stopLossPct: number | undefined,
  roundTrip: number
): { checked: number; violated: number; excessLoss: number } | undefined {
  void roundTrip;
  if (stopLossPct === undefined) return undefined;

  let checked = 0;
  let violated = 0;
  let excessLoss = 0;

  for (const t of closed) {
    const prices = priceLookup(t.ticker);
    if (prices === undefined) continue;
    checked += 1;

    const stopPrice = t.avgCost * (1 - stopLossPct);
    // 이탈 창은 [매수일, 매도일) — **매도 당일은 뺀다**. 손절선을 깬 그날 팔았다면
    // 그건 규칙을 지킨 모습이지 어긴 게 아니다. 창을 매도일까지로 잡으면 규칙대로
    // 판 사람이 오히려 위반으로 잡힌다.
    const breached = prices.some(
      (p) => p.date >= t.entryDate && p.date < t.exitDate && p.close < stopPrice
    );

    if (breached) {
      // 위반은 이탈만으로 센다. "이탈했는데 안 팔았다"가 곧 규율 위반이고,
      // 그 뒤 운 좋게 회복해 손실이 작았는지는 규율과 무관하다 — 결과로 규율을
      // 채점하면 "버텨서 이긴" 거래가 규율 위반에서 빠져나간다.
      violated += 1;
      // 초과 손실은 손절선보다 **더 잃은 몫**만 센다. 회복해서 덜 잃었으면
      // 0이다(양수로 더해 "규율을 어겨 이득"이라고 적지 않는다).
      const excess = t.netReturn + stopLossPct;
      if (excess < 0) excessLoss += excess;
    }
  }

  return { checked, violated, excessLoss };
}
