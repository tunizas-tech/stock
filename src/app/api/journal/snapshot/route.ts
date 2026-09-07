// 매매 시점 스냅샷 API(6단계 설계 §2) — GET /api/journal/snapshot?ticker=005930&date=2026-09-05
//
// data/ 아래 코스피·나스닥·수급(30종목)·섹터 로테이션 ETF·종목 캔들을 읽어
// buildSnapshot(순수 함수, src/lib/journal/snapshot.ts)에 그대로 넘기고 결과만
// 돌려준다. 파일을 찾아 읽는 것과 "없으면 무엇을 돌려줄지"만 이 라우트가 맡는다
// — observatory 라우트와 같은 분업이다.
//
// buildSnapshot 자체는 절대 throw하지 않지만, data/ 디렉터리가 통째로 없을 때는
// (로컬에서 flow:fetch/backtest:fetch를 아직 안 돌린 상태) 애초에 계산을 시도하지
// 않고 바로 coverage:"none"을 200으로 준다 — 저널 폼은 이 API가 실패하든
// 성공하든 저장 자체를 절대 막지 않는다(설계 §1). 그래서 이 라우트는 입력 검증
// 실패(400) 외에는 절대 5xx를 내지 않는다.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import type { Candle, JournalSnapshot } from "@/lib/types";
import type { StockFlow } from "@/lib/flow/aggregate";
import { buildSnapshot, SECTOR_ROTATION_ETF } from "@/lib/journal/snapshot";
import { DATE_RE, TICKER_RE } from "@/lib/journal/validate";

export const dynamic = "force-dynamic";

const CANDLES_DIR = "data/candles";
const FLOW_DIR = "data/flow";

interface CandleFile {
  label?: string;
  candles: Candle[];
}

function loadCandleFile(path: string): CandleFile | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(parsed?.candles)) return undefined;
    return {
      label: typeof parsed.label === "string" ? parsed.label : undefined,
      candles: parsed.candles as Candle[],
    };
  } catch {
    return undefined; // 손상된 파일 — 조용히 빼고 나머지 계산을 계속한다
  }
}

/** data/candles의 모든 파일을 한 번 읽어 label로 찾을 수 있게 한다(섹터 ETF 매칭용). */
function loadAllCandleFilesByLabel(): Map<string, Candle[]> {
  const byLabel = new Map<string, Candle[]>();
  if (!existsSync(CANDLES_DIR)) return byLabel;
  for (const f of readdirSync(CANDLES_DIR).filter((n) => n.endsWith(".json"))) {
    const loaded = loadCandleFile(`${CANDLES_DIR}/${f}`);
    if (loaded?.label) byLabel.set(loaded.label, loaded.candles);
  }
  return byLabel;
}

function loadAllFlows(): StockFlow[] {
  if (!existsSync(FLOW_DIR)) return [];
  const flows: StockFlow[] = [];
  for (const f of readdirSync(FLOW_DIR).filter((n) => n.endsWith(".json"))) {
    try {
      const parsed = JSON.parse(readFileSync(`${FLOW_DIR}/${f}`, "utf8"));
      if (parsed?.ticker && Array.isArray(parsed?.days)) flows.push(parsed as StockFlow);
    } catch {
      // 손상된 종목 파일 하나 때문에 전체 스냅샷 계산을 멈추지 않는다 — 빼고 계속한다
    }
  }
  return flows;
}

/** data/flow/<ticker>.json의 close만 있는 하루치를 Candle로 승격한다(open=high=low=close). */
function flowCloseCandles(ticker: string): Candle[] | undefined {
  const path = `${FLOW_DIR}/${ticker}.json`;
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(parsed?.days)) return undefined;
    return (parsed.days as { date: string; close: number }[]).map((d) => ({
      date: d.date,
      open: d.close,
      high: d.close,
      low: d.close,
      close: d.close,
    }));
  } catch {
    return undefined;
  }
}

/** 종목 가격: data/flow(30종목, close만) 우선, 없으면 data/candles/KR-<ticker>-D.json. */
function stockCandlesFor(ticker: string): Candle[] | undefined {
  return flowCloseCandles(ticker) ?? loadCandleFile(`${CANDLES_DIR}/KR-${ticker}-D.json`)?.candles;
}

export async function GET(req: Request): Promise<NextResponse> {
  const params = new URL(req.url).searchParams;
  const ticker = params.get("ticker") ?? "";
  const date = params.get("date") ?? "";

  if (!TICKER_RE.test(ticker) || !DATE_RE.test(date)) {
    return NextResponse.json(
      { error: "ticker(6자리 숫자 또는 1~5자리 대문자)와 date(YYYY-MM-DD)가 필요합니다" },
      { status: 400 }
    );
  }

  // data/ 디렉터리 자체가 없으면(로컬에서 fetch 스크립트를 아직 안 돌린 상태) 계산을
  // 시도하지 않고 바로 "none"을 200으로 준다 — 폼은 이걸 "스냅샷 없이 저장"으로 다룬다.
  if (!existsSync(CANDLES_DIR) && !existsSync(FLOW_DIR)) {
    const empty: JournalSnapshot = { asOf: "", coverage: "none" };
    return NextResponse.json(empty);
  }

  const candlesByLabel = loadAllCandleFilesByLabel();
  const kospiCandles = candlesByLabel.get("코스피") ?? loadCandleFile(`${CANDLES_DIR}/KR-0001-D.json`)?.candles ?? [];
  const nasdaqCandles = candlesByLabel.get("나스닥") ?? loadCandleFile(`${CANDLES_DIR}/US-COMP-D.json`)?.candles ?? [];
  const flows = loadAllFlows();

  // 섹터 → 로테이션 ETF 캔들. Task 2 사실: sectorEtfCandles는 섹터명으로 키를
  // 잡는다(ETF 라벨이 아니다) — buildSnapshot이 그렇게 기대한다.
  const sectorEtfCandles: Record<string, Candle[]> = {};
  for (const [sector, etfLabel] of Object.entries(SECTOR_ROTATION_ETF)) {
    const candles = candlesByLabel.get(etfLabel);
    if (candles) sectorEtfCandles[sector] = candles;
  }

  const snapshot = buildSnapshot({
    ticker,
    date,
    kospiCandles,
    nasdaqCandles,
    flows,
    sectorEtfCandles,
    stockCandles: stockCandlesFor(ticker),
  });

  return NextResponse.json(snapshot);
}
