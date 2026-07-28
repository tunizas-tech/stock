// 시세 서버 프록시 (디자인 §5.2-4 보안 경계).
// API 키는 이 라우트 밖으로 나가지 않는다. 키가 있는 시장만 실시세를 조회하고,
// 키가 없거나 조회가 실패한 종목은 mock으로 폴백해 앱은 항상 동작한다.

import { NextResponse } from "next/server";
import { getFinnhubQuote } from "@/lib/server/finnhub";
import { getKisQuote } from "@/lib/server/kis";
import { mockQuote } from "@/lib/mock-quotes";
import { mapLimit } from "@/lib/server/map-limit";
import { quoteKey } from "@/lib/quotes";
import type { Market, Quote } from "@/lib/types";

const CONCURRENCY = 4;
const RETRY_DELAY_MS = 400;

interface QuoteRequestItem {
  ticker: string;
  market: Market;
}

async function fetchLive(item: QuoteRequestItem): Promise<Quote> {
  if (item.market === "KR") {
    const appKey = process.env.KIS_APP_KEY;
    const appSecret = process.env.KIS_APP_SECRET;
    if (appKey && appSecret) {
      return getKisQuote(item.ticker, { appKey, appSecret });
    }
  } else {
    const apiKey = process.env.FINNHUB_API_KEY;
    if (apiKey) {
      return getFinnhubQuote(item.ticker, apiKey);
    }
  }
  return mockQuote(item.ticker, item.market);
}

export async function POST(req: Request): Promise<NextResponse> {
  let items: QuoteRequestItem[];
  try {
    const body = await req.json();
    if (!Array.isArray(body?.items)) throw new Error("items 배열 필요");
    items = body.items;
  } catch {
    return NextResponse.json(
      { error: "본문은 { items: [{ ticker, market }] } 형태여야 합니다" },
      { status: 400 }
    );
  }

  // KIS 초당 요청 제한 대응 — /api/fundamentals와 같은 방식.
  const quotes: Record<string, Quote> = {};
  const results = await mapLimit(items, CONCURRENCY, async (item) => {
    try {
      return await fetchLive(item);
    } catch {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      return fetchLive(item).catch(() => mockQuote(item.ticker, item.market));
    }
  });
  items.forEach((item, i) => {
    quotes[quoteKey(item.market, item.ticker)] = results[i];
  });
  return NextResponse.json({ quotes });
}
