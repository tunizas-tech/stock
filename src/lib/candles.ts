// 캔들 어댑터 — quotes.ts와 같은 원칙의 이음새(디자인 §5.2-2).
// /api/candles 서버 프록시를 호출하고, 네트워크·서버 오류 시 mock 캔들로 폴백한다.

import { mockCandlesFor } from "./mock-candles";
import type { Candle, Market, Period } from "./types";

export interface CandleQuery {
  kind: "stock" | "index";
  market: Market;
  code: string;
  period: Period;
}

export async function getCandles(q: CandleQuery): Promise<Candle[]> {
  try {
    const qs = new URLSearchParams({
      kind: q.kind,
      market: q.market,
      code: q.code,
      period: q.period,
    });
    const res = await fetch(`/api/candles?${qs}`);
    if (!res.ok) throw new Error(`/api/candles HTTP ${res.status}`);
    const body = (await res.json()) as { candles: Candle[] };
    return body.candles;
  } catch {
    return mockCandlesFor(q.kind, q.market, q.code, q.period);
  }
}
