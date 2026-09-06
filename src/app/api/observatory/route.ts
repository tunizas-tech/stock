// 관측소(/observatory) 서버 라우트. data/flow·data/candles를 읽어 src/lib/observatory.ts의
// 순수 함수에 넘기고 결과만 반환한다 — 집계·비용·순위 계산은 전부 라이브러리 쪽에서 하고
// 이 파일은 파일을 찾아 읽는 것과 "없으면 무엇을 하라고 안내할지"만 맡는다.
//
// data/ 디렉터리는 gitignore 대상이라 로컬에 없을 수 있다(npm run flow:fetch /
// backtest:fetch 실행 전). 그 경우 크래시하거나 빈 화면을 주지 않고, 각 섹션을
// null로 두고 meta에 무엇을 실행해야 하는지 남긴다.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { INDICES } from "@/lib/indices";
import type { Candle } from "@/lib/types";
import type { StockFlow } from "@/lib/flow/aggregate";
import {
  buildBuyAndHold,
  buildFlowSection,
  buildMarketToday,
  buildRelativeStrength,
  type ObservatoryResponse,
} from "@/lib/observatory";

export const runtime = "nodejs";
// data/flow는 매일 갱신된다(flow:fetch). GET에 요청 파라미터가 없어 Next가 빌드 시점에
// 정적으로 굳혀버릴 수 있으므로, 매 요청마다 파일을 다시 읽도록 명시적으로 강제한다.
export const dynamic = "force-dynamic";

const CANDLES_DIR = "data/candles";
const FLOW_DIR = "data/flow";

// 4단계(섹터 로테이션) 후보 9개 — sector-rotation-design.md §1, scripts/backtest-rotation.ts의
// CANDIDATES와 같은 목록이다. TIGER 반도체(091230)는 KODEX 반도체와 같은 섹터라 의도적으로
// 뺀다(같은 문서 참고). KODEX 200(069500)은 시장 벤치마크일 뿐 로테이션 후보가 아니라서 뺀다.
// 이 저장소는 이런 소규모 후보 목록을 스크립트/라이브러리마다 각자 인라인으로 들고 다니는
// 관례를 이미 쓰고 있다(.superpowers/flow-report.md 참고) — 공유 소스가 따로 없으므로 그대로 따른다.
const ROTATION_CANDIDATES: { code: string; label: string }[] = [
  { code: "091160", label: "KODEX 반도체" },
  { code: "091170", label: "KODEX 은행" },
  { code: "091180", label: "KODEX 자동차" },
  { code: "102960", label: "KODEX 기계장비" },
  { code: "117460", label: "KODEX 에너지화학" },
  { code: "117680", label: "KODEX 철강" },
  { code: "140710", label: "KODEX 운송" },
  { code: "139260", label: "TIGER 200 IT" },
  { code: "143860", label: "TIGER 헬스케어" },
];

function loadCandles(market: "KR" | "US", code: string): Candle[] | undefined {
  const file = `${CANDLES_DIR}/${market}-${code}-D.json`;
  if (!existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed?.candles) ? (parsed.candles as Candle[]) : undefined;
  } catch {
    return undefined; // 손상된 파일 — 조용히 빼고 나머지는 계속 계산한다
  }
}

function loadAllFlows(): StockFlow[] {
  if (!existsSync(FLOW_DIR)) return [];
  const files = readdirSync(FLOW_DIR).filter((f) => f.endsWith(".json"));
  const flows: StockFlow[] = [];
  for (const f of files) {
    try {
      const parsed = JSON.parse(readFileSync(`${FLOW_DIR}/${f}`, "utf8"));
      if (parsed?.ticker && Array.isArray(parsed?.days)) flows.push(parsed as StockFlow);
    } catch {
      // 손상된 종목 파일 하나 때문에 전체를 못 그리게 하지 않는다 — 빼고 계속한다
    }
  }
  return flows;
}

export async function GET(): Promise<NextResponse<ObservatoryResponse>> {
  const candleDataMissing = !existsSync(CANDLES_DIR) || readdirSync(CANDLES_DIR).length === 0;

  // ① 오늘의 시장 — src/lib/indices.ts(대시보드와 같은 소스)의 5개 지수.
  const indexLabelOf: Record<string, string> = {
    "KR:0001": "코스피",
    "KR:1001": "코스닥",
    "US:COMP": "나스닥",
    "US:SPX": "S&P 500",
    "US:.DJI": "다우존스",
  };
  const indexSeries = new Map<string, Candle[]>();
  for (const idx of INDICES) {
    const label = indexLabelOf[`${idx.market}:${idx.code}`];
    if (!label) continue;
    const candles = loadCandles(idx.market, idx.code);
    if (candles) indexSeries.set(label, candles);
  }
  const market = buildMarketToday(indexSeries);

  // ③·④ — 로테이션 후보 9개. 두 섹션이 같은 파일을 읽으므로 한 번만 로드한다.
  const rotationAssets = ROTATION_CANDIDATES.map((c) => ({
    label: c.label,
    ticker: c.code,
    candles: loadCandles("KR", c.code) ?? [],
  }));
  const relativeStrength = buildRelativeStrength(rotationAssets);
  const buyAndHold = buildBuyAndHold(rotationAssets);

  // ② 섹터별 자금 흐름
  const flows = loadAllFlows();
  const flowDataMissing = flows.length === 0;
  const flow = buildFlowSection(flows);

  return NextResponse.json({
    market,
    flow,
    relativeStrength,
    buyAndHold,
    meta: { candleDataMissing, flowDataMissing },
  });
}
