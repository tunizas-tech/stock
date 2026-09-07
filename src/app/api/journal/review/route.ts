// 자기검증 리뷰 API(6단계 설계 §3·§4) — POST /api/journal/review
// body: { entries: JournalEntry[], settings: JournalSettings }
//
// 일지 자체는 사용자 기기의 localStorage(또는 Supabase, data.ts)에 살 수 있어
// 서버가 소유하지 않는다 — 그래서 클라이언트가 자기 entries를 body로 들고 온다.
// 이 라우트는 그 entries와 로컬 가격 파일(data/flow, data/candles)만으로
// review.ts(순수 함수)를 호출하고 결과를 그대로 돌려준다.
//
// 가격 조회는 로컬 파일 한정이다 — 이 라우트는 KIS 같은 실시간 API를 절대
// 호출하지 않는다. 이유는 세 가지: (1) 결과 화면은 봉인 해제 후 반복해서
// 열어보는 화면이라 매번 실시간 호출이 붙으면 요금·쿼터·실패 지점이 늘어난다,
// (2) §4의 취지 자체가 "지금 시세가 어떤가"가 아니라 "과거 내 판단이 어땠나"라
// 실시간성이 필요 없다, (3) DEFAULT_ROUND_TRIP·고정 시드와 함께 로컬 파일만
// 쓰면 새로고침해도 항상 같은 숫자가 나온다(재현성) — 실시간 API가 끼면 그
// 재현성이 깨진다. 로컬에 가격이 없는 티커는 missingPrices로 알리고, 그
// 티커의 거래는 실제 평균·승률에는 그대로 들어가되(그건 일지 자체 값)
// 대조군·반사실에서는 빠진다(review.ts computeGroupStat이 이미 그렇게 한다).

import { existsSync, readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import type { JournalEntry } from "@/lib/types";
import type { JournalSettings } from "@/lib/journal/settings";
import {
  disciplineReport,
  groupByEmotion,
  groupByHoldBucket,
  groupByPrimaryTag,
  pairTrades,
  skipCounterfactual,
  type PriceLookup,
} from "@/lib/journal/review";
import { DEFAULT_ROUND_TRIP } from "@/lib/backtest/cost";

export const dynamic = "force-dynamic";

const FLOW_DIR = "data/flow";
const CANDLES_DIR = "data/candles";

// 페이지를 새로고침해도 같은 무작위 대조군 표본이 나오도록 고정한 시드(브리프 지정).
const REVIEW_SEED = 20260907;

/** data/flow/<ticker>.json의 close만 있는 하루치. */
function flowCloses(ticker: string): { date: string; close: number }[] | undefined {
  const path = `${FLOW_DIR}/${ticker}.json`;
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(parsed?.days)) return undefined;
    return (parsed.days as { date: string; close: number }[]).map((d) => ({
      date: d.date,
      close: d.close,
    }));
  } catch {
    return undefined;
  }
}

/** data/candles/KR-<ticker>-D.json의 종가. */
function candleCloses(ticker: string): { date: string; close: number }[] | undefined {
  const path = `${CANDLES_DIR}/KR-${ticker}-D.json`;
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(parsed?.candles)) return undefined;
    return (parsed.candles as { date: string; close: number }[]).map((c) => ({
      date: c.date,
      close: c.close,
    }));
  } catch {
    return undefined;
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: { entries?: JournalEntry[]; settings?: JournalSettings };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문입니다" }, { status: 400 });
  }

  const entries = Array.isArray(body.entries) ? body.entries : [];
  const settings: JournalSettings = body.settings ?? { sealDays: 180 };

  // 티커 하나당 파일을 한 번만 읽는다 — review.ts의 여러 묶음 함수가 같은
  // 티커를 여러 번 조회할 수 있어서다. 조회했는데 없던 티커는 missingPrices로
  // 모은다(§4 "가격 데이터 없는 종목" 절, N1/N3에서 이어지는 정직성 규약).
  const priceCache = new Map<string, { date: string; close: number }[] | undefined>();
  const missingPrices = new Set<string>();
  const priceLookup: PriceLookup = (ticker) => {
    if (!priceCache.has(ticker)) {
      const prices = flowCloses(ticker) ?? candleCloses(ticker);
      priceCache.set(ticker, prices);
      if (prices === undefined) missingPrices.add(ticker);
    }
    return priceCache.get(ticker);
  };

  const { closed, open } = pairTrades(entries, DEFAULT_ROUND_TRIP);

  const byEmotion = groupByEmotion(closed, priceLookup, REVIEW_SEED, DEFAULT_ROUND_TRIP);
  const byTag = groupByPrimaryTag(closed, priceLookup, REVIEW_SEED, DEFAULT_ROUND_TRIP);
  const byHold = groupByHoldBucket(closed, priceLookup, REVIEW_SEED, DEFAULT_ROUND_TRIP);
  const skip = skipCounterfactual(entries, priceLookup, DEFAULT_ROUND_TRIP);
  const discipline = disciplineReport(closed, priceLookup, settings.stopLossPct, DEFAULT_ROUND_TRIP);

  return NextResponse.json({
    closedCount: closed.length,
    openCount: open.length,
    byEmotion,
    byTag,
    byHold,
    skip,
    discipline,
    missingPrices: [...missingPrices],
  });
}
