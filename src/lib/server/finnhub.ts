// Finnhub US 시세·펀더멘털 어댑터 (서버 전용 — API 키를 다루므로 클라이언트에서 import 금지).
// GET /quote 응답: c=현재가, d=전일 대비, dp=전일 대비 %. 미지원 심볼은 c=0, d=null.
// GET /stock/metric (metric=all): 펀더멘털. marketCapitalization은 백만 달러 단위.

import type { Fundamentals, Quote } from "../types";

export async function getFinnhubQuote(
  ticker: string,
  apiKey: string
): Promise<Quote> {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(
    ticker
  )}&token=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Finnhub HTTP ${res.status} (${ticker})`);
  }
  const body = (await res.json()) as {
    c: number;
    d: number | null;
    dp: number | null;
  };
  if (body.d === null) {
    throw new Error(`Finnhub: 알 수 없는 심볼 ${ticker}`);
  }
  return {
    ticker,
    market: "US",
    price: body.c,
    change: body.d,
    changePct: body.dp ?? 0,
    currency: "USD",
  };
}

/** null/누락 지표를 undefined로 정규화. */
function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

export async function getFinnhubFundamentals(
  ticker: string,
  apiKey: string
): Promise<Omit<Fundamentals, "name">> {
  const sym = encodeURIComponent(ticker);
  const tok = encodeURIComponent(apiKey);
  const [metricRes, quoteRes] = await Promise.all([
    fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${sym}&metric=all&token=${tok}`),
    fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${tok}`),
  ]);
  if (!metricRes.ok) {
    throw new Error(`Finnhub metric HTTP ${metricRes.status} (${ticker})`);
  }
  if (!quoteRes.ok) {
    throw new Error(`Finnhub quote HTTP ${quoteRes.status} (${ticker})`);
  }
  const { metric } = (await metricRes.json()) as {
    metric: Record<string, unknown>;
  };
  const { c: price } = (await quoteRes.json()) as { c: number };
  const high52w = num(metric["52WeekHigh"]);
  return {
    ticker,
    market: "US",
    marketCap: num(metric.marketCapitalization),
    per: num(metric.peTTM),
    pbr: num(metric.pbAnnual),
    dividendYield: num(metric.currentDividendYieldTTM),
    revenueGrowth: num(metric.revenueGrowthTTMYoy),
    off52wHigh:
      high52w && price
        ? Math.round((price / high52w - 1) * 10000) / 100
        : undefined,
  };
}
