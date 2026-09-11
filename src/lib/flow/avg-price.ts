// 수급평단 — "외국인·기관이 최근 W일 동안 산 주식의 평균 단가"를 종목 단위로 구한다.
// aggregate.ts(섹터 합산)와 역할이 달라 파일을 나눈다. 파일 I/O 없음, 입력은 FlowDay.
//
// 단위 함정: foreign/institution/individual은 백만원, *Qty는 주. 평단(원) = ΣV × 1e6 / ΣQ.
// 이 한 줄이 틀리면 평단이 100만 배 틀리므로 첫 테스트가 실측 고정값이다.
import type { FlowDay } from "./aggregate";

export type FlowActor = "foreign" | "institution" | "individual";
export const AVG_WINDOWS = [5, 20, 60] as const;
export type AvgWindow = (typeof AVG_WINDOWS)[number];
export type AvgPriceReason = "zero-qty" | "sign-mismatch" | "corp-action";

export interface SupplyAvgPrice {
  actor: FlowActor;
  window: AvgWindow;
  /** 원. null이면 reason에 이유. */
  avgPrice: number | null;
  /** ΣQ>0 → buy(매수평단), ΣQ<0 → sell(매도평단). "물렸다/이익이다" 해석이 뒤집히므로 UI가 반드시 표시. */
  side: "buy" | "sell" | null;
  /** (창 마지막 종가 − 평단) / 평단 × 100 */
  returnPct: number | null;
  /** 백만원 */
  sumValue: number;
  /** 주 */
  sumQty: number;
  /** 실제 창에 들어간 일수(데이터가 W일보다 짧으면 그만큼) */
  tradingDays: number;
  reason?: AvgPriceReason;
}

const QTY_KEY: Record<FlowActor, keyof FlowDay> = {
  foreign: "foreignQty",
  institution: "institutionQty",
  individual: "individualQty",
};

/** days는 날짜 오름차순. 마지막 W일만 돌려준다. */
export function sliceWindow(days: FlowDay[], window: AvgWindow): FlowDay[] {
  return days.slice(-window);
}

/** 액면분할·감자 근사: 창 안에 전일 대비 ±40% 이상 종가 변동이 있으면 수량 단위가 달라졌다고 본다. */
export const CORP_ACTION_JUMP = 0.4;

export function hasCorpAction(win: FlowDay[]): boolean {
  for (let i = 1; i < win.length; i++) {
    const prev = win[i - 1].close;
    if (prev > 0 && Math.abs(win[i].close / prev - 1) >= CORP_ACTION_JUMP) return true;
  }
  return false;
}

export function supplyAvgPrice(days: FlowDay[], actor: FlowActor, window: AvgWindow): SupplyAvgPrice {
  const win = sliceWindow(days, window);
  let sumValue = 0;
  let sumQty = 0;
  for (const d of win) {
    sumValue += d[actor];
    sumQty += d[QTY_KEY[actor]] as number;
  }
  const base = { actor, window, sumValue, sumQty, tradingDays: win.length };
  const none = (reason: AvgPriceReason): SupplyAvgPrice => ({ ...base, avgPrice: null, side: null, returnPct: null, reason });

  if (sumQty === 0) return none("zero-qty");
  if (Math.sign(sumValue) !== Math.sign(sumQty)) return none("sign-mismatch");
  if (hasCorpAction(win)) return none("corp-action");
  const avgPrice = Math.round((sumValue * 1_000_000) / sumQty);
  const close = win[win.length - 1].close;
  return {
    ...base,
    avgPrice,
    side: sumQty > 0 ? "buy" : "sell",
    returnPct: ((close - avgPrice) / avgPrice) * 100,
  };
}
