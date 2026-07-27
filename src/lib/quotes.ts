// 시세 어댑터 — 교체 가능한 이음새(디자인 §5.2-2).
// 모든 시세 접근은 getQuote()/getQuotes() 한 곳을 통한다.
// /api/quotes 서버 프록시(모듈 A: KIS/Finnhub)를 호출하고,
// 네트워크·서버 오류 시 결정론적 mock으로 폴백해 앱은 항상 동작한다.

import { mockQuote } from "./mock-quotes";
import type { Market, Quote } from "./types";

export async function getQuote(ticker: string, market: Market): Promise<Quote> {
  const out = await getQuotes([{ ticker, market }]);
  return out[quoteKey(market, ticker)];
}

export async function getQuotes(
  items: { ticker: string; market: Market }[]
): Promise<Record<string, Quote>> {
  try {
    const res = await fetch("/api/quotes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) throw new Error(`/api/quotes HTTP ${res.status}`);
    const body = (await res.json()) as { quotes: Record<string, Quote> };
    return body.quotes;
  } catch {
    const out: Record<string, Quote> = {};
    for (const { ticker, market } of items) {
      out[quoteKey(market, ticker)] = mockQuote(ticker, market);
    }
    return out;
  }
}

/** data 페이지에서 quote 키를 일관되게 만들기 위한 헬퍼. */
export function quoteKey(market: Market, ticker: string): string {
  return `${market}:${ticker}`;
}
