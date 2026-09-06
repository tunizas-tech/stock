// 관측소(/observatory)를 구성하는 순수 계산 함수 모음. 파일 I/O는 하지 않는다 —
// /api/observatory/route.ts가 data/flow·data/candles를 읽어 넘긴 값만 다룬다.
//
// 다섯 단계 백테스트(docs/superpowers/specs/2026-09-06-*.md)가 공통으로 남긴 결론은
// "타이밍 규칙은 전부 막혔다"는 것이다. 이 파일이 만드는 숫자는 그래서 전략이 아니라
// 서술이다 — 각 build 함수는 "지금 무슨 일이 일어났는가"만 답하고, 검증에 실패한
// 어떤 규칙도 예측처럼 포장하지 않는다. 정직성 규칙은 각 함수 주석에 그대로 남긴다.

import type { Candle } from "./types";
import {
  sectorTotals,
  stockTotals,
  type SectorTotal,
  type StockFlow,
  type StockTotal,
} from "./flow/aggregate";
import { applyCost, DEFAULT_ROUND_TRIP } from "./backtest/cost";
import { buyAndHold } from "./backtest/benchmark";
import { runRotation } from "./backtest/rotation";

// ---------------------------------------------------------------------------
// ① 오늘의 시장 — 지수 스냅샷 + 갭 분해
// ---------------------------------------------------------------------------

export interface IndexSnapshot {
  label: string;
  market: "KR" | "US";
  date: string;
  close: number;
  prevClose: number;
  changePct: number;
}

/**
 * 한국 거래일의 수익을 갭(시가÷전일종가)과 장중(종가÷시가)으로 분해한다.
 * us-kr-transfer-design.md §1의 정의를 그대로 쓴다 — 분해가 핵심인 이유는
 * 종가-종가만 보면 미국 상관이 높게 나오는데 그 일치가 전부 갭 안에 있으면
 * 시초가 매수로는 아무것도 얻지 못하기 때문이다(같은 문서 §12: 갭 상관 0.712,
 * 장중 상관 −0.107).
 */
export interface GapDecomposition {
  label: string;
  date: string;
  prevClose: number;
  open: number;
  close: number;
  gapPct: number;
  intradayPct: number;
}

export interface MarketToday {
  indices: IndexSnapshot[];
  gaps: GapDecomposition[];
}

/** 오늘의 시장 섹션에 넣을 지수 표시 순서 — 코스피·코스닥·나스닥·S&P 500·다우존스. */
export const MARKET_TODAY_ORDER = ["코스피", "코스닥", "나스닥", "S&P 500", "다우존스"] as const;

/** 갭 분해를 계산하는 대상 — 미국장과의 관계가 검증된 두 국내 지수. */
const GAP_LABELS = ["코스피", "코스닥"] as const;

/**
 * candles가 2개 미만인 시리즈는 등락률을 계산할 수 없으므로 건너뛴다(빈 배열로
 * 보여주지 않고 아예 빠뜨려 "이 지수는 데이터가 부족하다"는 사실이 드러나게 한다).
 * 5개 지수 중 하나도 못 구하면 섹션 전체를 null로 돌려 호출자가 "데이터 없음"을
 * 렌더링하게 한다.
 */
export function buildMarketToday(seriesByLabel: Map<string, Candle[]>): MarketToday | null {
  const indices: IndexSnapshot[] = [];
  for (const label of MARKET_TODAY_ORDER) {
    const candles = seriesByLabel.get(label);
    if (!candles || candles.length < 2) continue;
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    indices.push({
      label,
      market: label === "코스피" || label === "코스닥" ? "KR" : "US",
      date: last.date,
      close: last.close,
      prevClose: prev.close,
      changePct: last.close / prev.close - 1,
    });
  }
  if (indices.length === 0) return null;

  const gaps: GapDecomposition[] = [];
  for (const label of GAP_LABELS) {
    const candles = seriesByLabel.get(label);
    if (!candles || candles.length < 2) continue;
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    gaps.push({
      label,
      date: last.date,
      prevClose: prev.close,
      open: last.open,
      close: last.close,
      gapPct: last.open / prev.close - 1,
      intradayPct: last.close / last.open - 1,
    });
  }

  return { indices, gaps };
}

// ---------------------------------------------------------------------------
// ② 섹터별 자금 흐름 — sectorTotals/stockTotals를 감싸고, 개인 열 백필 결측을
//    별도로 드러낸다. 합산 자체는 여기서 절대 다시 하지 않는다(집계는 항상
//    flow/aggregate.ts를 거친다) — 아래 두 함수는 "이 숫자를 얼마나 믿어도
//    되는가"라는 메타데이터만 추가한다.
// ---------------------------------------------------------------------------

/**
 * 네이버 백필 구간은 개인 순매수 금액·수량을 둘 다 0으로 채워 넣는다(실제 관측이
 * 아니라 결측). 실측 데이터가 우연히 순매수 0을 기록할 확률은(금액·수량이 동시에
 * 정확히 0) 사실상 0에 가까우므로, 두 값이 함께 0인 날을 결측으로 판정한다.
 */
export function isIndividualMissing(day: { individual: number; individualQty: number }): boolean {
  return day.individual === 0 && day.individualQty === 0;
}

/**
 * 유니버스 전체에서 개인 수급이 실측으로 전환된 날짜. 종목마다 전환일이 다를 수
 * 있으므로 가장 늦게 전환된 종목 기준(최댓값)을 쓴다 — 그래야 "이 날짜 이후는
 * 전부 실측"이라는 주장이 어떤 종목에도 어긋나지 않는다. 실측 구간이 전혀 없는
 * 종목이 하나라도 있으면 undefined를 돌려줘 "이 유니버스는 개인 실측 시점을
 * 특정할 수 없다"는 사실 자체를 드러낸다.
 */
export function individualRealFrom(flows: StockFlow[]): string | undefined {
  if (flows.length === 0) return undefined;
  let latest: string | undefined;
  for (const stock of flows) {
    const firstReal = stock.days.find((d) => !isIndividualMissing(d));
    if (!firstReal) return undefined;
    if (!latest || firstReal.date > latest) latest = firstReal.date;
  }
  return latest;
}

export interface IndividualCoverage {
  /** sectorTotals와 같은 정의로 계산한, 이 창에서 실제로 쓰인 고유 날짜 수. */
  tradingDays: number;
  /** 그중 개인 데이터가 실측인 날짜 수. tradingDays보다 작으면 나머지는 백필 결측. */
  realDays: number;
}

/**
 * 섹터 하나·창 하나에 대해 "이 창의 며칠이 개인 실측이고 며칠이 백필 결측인가"를
 * 센다. sectorTotals가 쓰는 "섹터가 관측한 날짜 합집합에서 최근 N일" 정의를 그대로
 * 따라야 같은 창을 가리키므로 그 정의만 다시 계산한다 — 합산(foreign/institution/
 * other 계산)은 절대 다시 하지 않고 sectorTotals의 결과를 그대로 쓴다.
 */
export function sectorIndividualCoverage(
  flows: StockFlow[],
  sector: string,
  days: number,
  realFrom: string | undefined
): IndividualCoverage {
  const bySector = flows.filter((f) => f.sector === sector);
  const allDates = new Set<string>();
  for (const stock of bySector) for (const day of stock.days) allDates.add(day.date);
  const recent = [...allDates].sort((a, b) => b.localeCompare(a)).slice(0, days);
  const realDays = realFrom === undefined ? 0 : recent.filter((d) => d >= realFrom).length;
  return { tradingDays: recent.length, realDays };
}

export const FLOW_WINDOWS = [5, 20, 60] as const;
export type FlowWindowDays = (typeof FLOW_WINDOWS)[number];

export interface FlowWindow {
  days: FlowWindowDays;
  sectors: SectorTotal[];
  stocksBySector: Record<string, StockTotal[]>;
  coverageBySector: Record<string, IndividualCoverage>;
}

export interface FlowSection {
  windows: FlowWindow[];
  individualRealFrom: string | undefined;
}

/** flows가 비어 있으면(data/flow가 없거나 30개 파일이 하나도 안 읽히면) null. */
export function buildFlowSection(flows: StockFlow[]): FlowSection | null {
  if (flows.length === 0) return null;
  const realFrom = individualRealFrom(flows);

  const windows: FlowWindow[] = FLOW_WINDOWS.map((days) => {
    const sectors = sectorTotals(flows, days);
    const stocks = stockTotals(flows, days);
    const stocksBySector: Record<string, StockTotal[]> = {};
    const coverageBySector: Record<string, IndividualCoverage> = {};
    for (const s of sectors) {
      stocksBySector[s.sector] = stocks.filter((st) => st.sector === s.sector);
      coverageBySector[s.sector] = sectorIndividualCoverage(flows, s.sector, days, realFrom);
    }
    return { days, sectors, stocksBySector, coverageBySector };
  });

  return { windows, individualRealFrom: realFrom };
}

// ---------------------------------------------------------------------------
// ③ 섹터 상대강도 — 9개 로테이션 후보의 추세 순위. 검증된 정보가 있는 유일한
//    조각이다(sector-rotation-design.md §10: 균등분할·시장은 이겼다). 다만 비용을
//    적용하지 않는다 — 실제 매매를 흉내 낸 값이 아니라 "지금 추세가 어디로
//    쏠려 있는가"라는 서술이기 때문이다.
// ---------------------------------------------------------------------------

export const RELATIVE_STRENGTH_WINDOWS = [20, 60, 250] as const;

export interface RelativeStrengthAsset {
  label: string;
  ticker: string;
  candles: Candle[];
}

export interface RelativeStrengthRow {
  label: string;
  ticker: string;
  returnPct: number;
}

export interface RelativeStrengthWindow {
  days: number;
  asOf: string;
  rows: RelativeStrengthRow[];
}

export interface RelativeStrengthSection {
  windows: RelativeStrengthWindow[];
}

export function buildRelativeStrength(
  assets: RelativeStrengthAsset[]
): RelativeStrengthSection | null {
  const loaded = assets.filter((a) => a.candles.length > 0);
  if (loaded.length === 0) return null;

  const windows: RelativeStrengthWindow[] = RELATIVE_STRENGTH_WINDOWS.map((days) => {
    const rows: RelativeStrengthRow[] = [];
    let asOf = "";
    for (const a of loaded) {
      const n = a.candles.length;
      if (n <= days) continue; // 표본이 창보다 짧은 종목은 빼고, 있는 종목만으로 순위를 매긴다
      const last = a.candles[n - 1];
      const base = a.candles[n - 1 - days];
      if (last.date > asOf) asOf = last.date;
      rows.push({ label: a.label, ticker: a.ticker, returnPct: last.close / base.close - 1 });
    }
    rows.sort((x, y) => y.returnPct - x.returnPct);
    return { days, asOf, rows };
  });

  return { windows };
}

// ---------------------------------------------------------------------------
// ④ 장기 매수후보유 — 이 페이지에서 가장 무거운 결론. sector-rotation-design.md
//    §10과 정확히 같은 창을 쓴다: 로테이션(lookback=250, topK=1)의 첫 진입일부터
//    9개 후보의 공통 종료일까지. 이 창을 다시 손으로 계산하지 않고 runRotation·
//    buyAndHold를 그대로 재사용한다 — 같은 라이브러리를 쓰지 않으면 이 페이지의
//    숫자와 설계 문서의 숫자가 미묘하게 어긋날 위험이 있다.
// ---------------------------------------------------------------------------

export const STANDARD_LOOKBACK = 250;
export const STANDARD_TOPK = 1;

export interface BuyAndHoldAsset {
  label: string;
  ticker: string;
  candles: Candle[];
}

export interface BuyAndHoldRow {
  label: string;
  ticker: string;
  returnPct: number;
}

export interface BuyAndHoldSection {
  from: string;
  to: string;
  tradingDays: number;
  rows: BuyAndHoldRow[];
}

export function buildBuyAndHold(
  assets: BuyAndHoldAsset[],
  lookback: number = STANDARD_LOOKBACK,
  topK: number = STANDARD_TOPK
): BuyAndHoldSection | null {
  const loaded = assets.filter((a) => a.candles.length > 0);
  if (loaded.length < 2) return null;

  let result;
  try {
    result = runRotation({
      assets: loaded.map((a) => ({ label: a.label, candles: a.candles })),
      lookback,
      topK,
      roundTrip: DEFAULT_ROUND_TRIP,
    });
  } catch {
    return null; // 캘린더 정합성이 깨진 입력 — 섹션 전체를 숨긴다(잘못된 숫자를 보여주지 않는다)
  }
  if (result.rebalances.length === 0) return null; // lookback을 채울 공통 데이터가 없다

  const from = result.rebalances[0].tradeDate;
  const to = loaded.reduce((min, a) => {
    const last = a.candles[a.candles.length - 1].date;
    return last < min ? last : min;
  }, loaded[0].candles[loaded[0].candles.length - 1].date);

  let tradingDays = 0;
  const rows: BuyAndHoldRow[] = [];
  for (const a of loaded) {
    const windowed = a.candles.filter((c) => c.date >= from && c.date <= to);
    if (windowed.length === 0) continue;
    const bh = buyAndHold(windowed, DEFAULT_ROUND_TRIP);
    tradingDays = Math.max(tradingDays, bh.days);
    rows.push({ label: a.label, ticker: a.ticker, returnPct: bh.netReturn });
  }
  rows.sort((x, y) => y.returnPct - x.returnPct);
  if (rows.length === 0) return null;

  return { from, to, tradingDays, rows };
}

// applyCost를 재수출 — 라우트가 별도 계산을 직접 만들 필요가 있을 때(현재는 없음)를
// 대비해 단일 출처를 유지한다. 실제로는 이 파일의 build 함수들이 이미 필요한 곳에서
// 위 두 함수를 통해서만 비용을 적용한다.
export { applyCost, DEFAULT_ROUND_TRIP };

// ---------------------------------------------------------------------------
// API 응답 형태 — 라우트와 페이지가 함께 쓰는 단일 출처. 페이지(클라이언트 컴포넌트)가
// src/app/api/observatory/route.ts를 직접 import하지 않도록 여기 둔다.
// ---------------------------------------------------------------------------

export interface ObservatoryResponse {
  market: MarketToday | null;
  flow: FlowSection | null;
  relativeStrength: RelativeStrengthSection | null;
  buyAndHold: BuyAndHoldSection | null;
  meta: {
    candleDataMissing: boolean;
    flowDataMissing: boolean;
  };
}
