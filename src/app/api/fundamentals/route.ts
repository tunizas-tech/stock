// 펀더멘털 서버 프록시 (디자인 §5.2-4 보안 경계) — /api/quotes와 같은 원칙.
// 키가 있는 시장만 실데이터(KR: KIS 현재가 응답, US: Finnhub metric)를 조회하고,
// 키가 없거나 조회가 실패한 종목은 mock으로 폴백해 스크리너는 항상 동작한다.

import { NextResponse } from "next/server";
import { getFinnhubFundamentals } from "@/lib/server/finnhub";
import { getKisFundamentals } from "@/lib/server/kis";
import { mockFundamentals } from "@/lib/mock-quotes";
import { quoteKey } from "@/lib/quotes";
import type { Fundamentals, Market } from "@/lib/types";

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

  const fundamentals: Record<string, Fundamentals> = {};
  await Promise.all(
    items.map(async (item) => {
      const f = await fetchLive(item).catch(() =>
        mockFundamentals(item.ticker, item.market, item.name)
      );
      fundamentals[quoteKey(item.market, item.ticker)] = f;
    })
  );
  return NextResponse.json({ fundamentals });
}
