// 펀더멘털 서버 프록시 (디자인 §5.2-4 보안 경계) — /api/quotes와 같은 원칙.
// 키가 있는 시장만 실데이터(KR: KIS 현재가 응답, US: Finnhub metric)를 조회하고,
// 키가 없거나 조회가 실패한 종목은 mock으로 폴백해 스크리너는 항상 동작한다.

import { NextResponse } from "next/server";
import { getFinnhubFundamentals } from "@/lib/server/finnhub";
import { getKisFundamentals } from "@/lib/server/kis";
import { mockFundamentals } from "@/lib/mock-quotes";
import { mapLimit } from "@/lib/server/map-limit";
import { quoteKey } from "@/lib/quotes";
import type { Fundamentals, Market } from "@/lib/types";

const CONCURRENCY = 4;
const RETRY_DELAY_MS = 400;

interface FundamentalsRequestItem {
  ticker: string;
  market: Market;
  name: string;
}

async function fetchLive(
  item: FundamentalsRequestItem
): Promise<Fundamentals> {
  if (item.market === "KR") {
    const appKey = process.env.KIS_APP_KEY;
    const appSecret = process.env.KIS_APP_SECRET;
    if (appKey && appSecret) {
      const f = await getKisFundamentals(item.ticker, { appKey, appSecret });
      return { ...f, name: item.name };
    }
  } else {
    const apiKey = process.env.FINNHUB_API_KEY;
    if (apiKey) {
      const f = await getFinnhubFundamentals(item.ticker, apiKey);
      return { ...f, name: item.name };
    }
  }
  return mockFundamentals(item.ticker, item.market, item.name);
}

export async function POST(req: Request): Promise<NextResponse> {
  let items: FundamentalsRequestItem[];
  try {
    const body = await req.json();
    if (!Array.isArray(body?.items)) throw new Error("items 배열 필요");
    items = body.items;
  } catch {
    return NextResponse.json(
      { error: "본문은 { items: [{ ticker, market, name }] } 형태여야 합니다" },
      { status: 400 }
    );
  }

  // KIS 초당 요청 제한 때문에 한꺼번에 던지면 일부가 실패해 mock으로 떨어진다.
  // 동시 실행을 묶고, 실패하면 한 번 더 시도한 뒤에야 mock으로 폴백한다.
  const fundamentals: Record<string, Fundamentals> = {};
  const results = await mapLimit(items, CONCURRENCY, async (item) => {
    try {
      return await fetchLive(item);
    } catch {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      return fetchLive(item).catch(() =>
        mockFundamentals(item.ticker, item.market, item.name)
      );
    }
  });
  items.forEach((item, i) => {
    fundamentals[quoteKey(item.market, item.ticker)] = results[i];
  });
  return NextResponse.json({ fundamentals });
}
