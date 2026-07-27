// 기간별시세(캔들) 서버 프록시 (디자인 §5.2-4 보안 경계) — 시세·펀더멘털과 같은 원칙.
// KIS 키가 있으면 실데이터(국내외 종목·지수 4종 API), 없거나 실패하면 mock 캔들로 폴백.
// GET /api/candles?kind=stock|index&market=KR|US&code=...&period=D|W|M

import { NextResponse } from "next/server";
import {
  getKisStockCandles,
  getKisIndexCandles,
  getKisOverseasStockCandles,
  getKisOverseasIndexCandles,
  type KisCredentials,
} from "@/lib/server/kis";
import { mockCandlesFor } from "@/lib/mock-candles";
import { todayISO } from "@/lib/format";
import type { Candle, Market, Period } from "@/lib/types";

async function fetchLive(
  kind: "stock" | "index",
  market: Market,
  code: string,
  period: Period,
  creds: KisCredentials
): Promise<Candle[]> {
  const end = todayISO().replaceAll("-", "");
  if (kind === "stock") {
    return market === "KR"
      ? getKisStockCandles(code, period, creds, end)
      : getKisOverseasStockCandles(code, period, creds);
  }
  return market === "KR"
    ? getKisIndexCandles(code, period, creds, end)
    : getKisOverseasIndexCandles(code, period, creds, end);
}

export async function GET(req: Request): Promise<NextResponse> {
  const params = new URL(req.url).searchParams;
  const kind = params.get("kind");
  const market = params.get("market");
  const code = params.get("code");
  const period = params.get("period");
  if (
    (kind !== "stock" && kind !== "index") ||
    (market !== "KR" && market !== "US") ||
    !code ||
    (period !== "D" && period !== "W" && period !== "M")
  ) {
    return NextResponse.json(
      { error: "kind=stock|index, market=KR|US, code, period=D|W|M 필요" },
      { status: 400 }
    );
  }

  const appKey = process.env.KIS_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET;
  let candles: Candle[];
  if (appKey && appSecret) {
    candles = await fetchLive(kind, market, code, period, {
      appKey,
      appSecret,
    }).catch(() => mockCandlesFor(kind, market, code, period));
  } else {
    candles = mockCandlesFor(kind, market, code, period);
  }
  return NextResponse.json({ candles });
}
