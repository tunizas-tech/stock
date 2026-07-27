// 펀더멘털 어댑터 — quotes.ts와 같은 원칙의 이음새(디자인 §5.2-2).
// /api/fundamentals 서버 프록시를 호출하고, 네트워크·서버 오류 시 mock으로 폴백한다.

import { mockFundamentals } from "./mock-quotes";
import { quoteKey } from "./quotes";
import type { Fundamentals, Market } from "./types";

export interface FundamentalsItem {
  ticker: string;
  market: Market;
  name: string;
}

export async function getFundamentals(
  items: FundamentalsItem[]
): Promise<Record<string, Fundamentals>> {
  try {
    const res = await fetch("/api/fundamentals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) throw new Error(`/api/fundamentals HTTP ${res.status}`);
    const body = (await res.json()) as {
      fundamentals: Record<string, Fundamentals>;
    };
    return body.fundamentals;
  } catch {
    const out: Record<string, Fundamentals> = {};
    for (const { ticker, market, name } of items) {
      out[quoteKey(market, ticker)] = mockFundamentals(ticker, market, name);
    }
    return out;
  }
}
