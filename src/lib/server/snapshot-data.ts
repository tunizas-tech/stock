// 매매 시점 스냅샷 입력 로더(6단계 설계 §2) — data/ 아래 코스피·나스닥·수급(30종목)·
// 섹터 로테이션 ETF·종목 캔들을 읽어 buildSnapshot(순수 함수, src/lib/journal/snapshot.ts)이
// 바로 쓸 수 있는 SnapshotInput으로 조립한다.
//
// 사람 문(snapshot/route.ts)과 에이전트 문(agent/route.ts) 둘 다 이 로더를 쓴다 —
// 파일을 찾아 읽는 것과 "없으면 undefined"만 여기가 맡고, 그 값으로 무엇을
// 돌려줄지(coverage:"none" 200 vs best-effort 저장)는 각 라우트가 정한다.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { Candle } from "@/lib/types";
import type { StockFlow } from "@/lib/flow/aggregate";
import { SECTOR_ROTATION_ETF, type SnapshotInput } from "@/lib/journal/snapshot";

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

/**
 * data/ 아래 파일을 읽어 buildSnapshot 입력을 조립한다. data/ 디렉터리 자체가
 * 통째로 없으면(로컬에서 flow:fetch/backtest:fetch를 아직 안 돌린 상태)
 * undefined — 호출자가 "스냅샷 없이" 경로를 택한다.
 *
 * `sector`가 주어지면(에이전트 문 — 수급 유니버스 30종목 밖일 수 있어 직접 넘긴다)
 * SnapshotInput에 그대로 실어 buildSnapshot이 유니버스 조회 대신 이 값을 쓰게 한다.
 */
export function loadSnapshotInputs(ticker: string, date: string, sector?: string): SnapshotInput | undefined {
  if (!existsSync(CANDLES_DIR) && !existsSync(FLOW_DIR)) return undefined;
  const candlesByLabel = loadAllCandleFilesByLabel();
  const kospiCandles = candlesByLabel.get("코스피") ?? loadCandleFile(`${CANDLES_DIR}/KR-0001-D.json`)?.candles ?? [];
  const nasdaqCandles = candlesByLabel.get("나스닥") ?? loadCandleFile(`${CANDLES_DIR}/US-COMP-D.json`)?.candles ?? [];
  const sectorEtfCandles: Record<string, Candle[]> = {};
  for (const [s, etfLabel] of Object.entries(SECTOR_ROTATION_ETF)) {
    const c = candlesByLabel.get(etfLabel);
    if (c) sectorEtfCandles[s] = c;
  }
  return { ticker, date, sector, kospiCandles, nasdaqCandles, flows: loadAllFlows(), sectorEtfCandles, stockCandles: stockCandlesFor(ticker) };
}
