// 종목 하나의 수급평단. /api/observatory에 얹지 않는 이유: 관측소 응답은 이미 크고(12섹터×3창),
// 평단은 종목을 골라야 나오는 상세 데이터라 data/flow/<ticker>.json 하나만 읽으면 된다.
// 계산은 전부 src/lib/flow/avg-price.ts — 여기는 파라미터 검증과 파일 찾기만.
import { existsSync, readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import type { StockFlow } from "@/lib/flow/aggregate";
import { AVG_WINDOWS, buildAvgPriceView, type AvgWindow } from "@/lib/flow/avg-price";

export const runtime = "nodejs";
// data/flow는 매일 갱신된다(flow:fetch). 매 요청마다 파일을 다시 읽도록 강제한다.
export const dynamic = "force-dynamic";

const FLOW_DIR = "data/flow";
// 6자리 숫자만 — 경로 조작(../)을 여기서 막는다.
const TICKER_RE = /^\d{6}$/;

function loadFlow(ticker: string): StockFlow | undefined {
  const path = `${FLOW_DIR}/${ticker}.json`;
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed?.ticker && Array.isArray(parsed?.days)) return parsed as StockFlow;
  } catch {
    // 손상된 파일 — "없음"과 같게 다룬다. 크래시보다 404가 낫다.
  }
  return undefined;
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const ticker = url.searchParams.get("ticker") ?? "";
  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: "ticker는 6자리 숫자여야 합니다" }, { status: 400 });
  }
  const windowRaw = url.searchParams.get("window");
  const window = windowRaw === null ? 20 : Number(windowRaw);
  if (!(AVG_WINDOWS as readonly number[]).includes(window)) {
    return NextResponse.json({ error: `window는 ${AVG_WINDOWS.join("·")} 중 하나여야 합니다` }, { status: 400 });
  }
  const stock = loadFlow(ticker);
  if (!stock) {
    return NextResponse.json(
      { error: `data/flow/${ticker}.json 없음`, hint: "npm run flow:fetch 로 수급 데이터를 먼저 적재하세요" },
      { status: 404 },
    );
  }
  return NextResponse.json(buildAvgPriceView(stock, window as AvgWindow));
}
