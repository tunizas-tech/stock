// 1·2단계 백테스트 실행 — data/candles의 파일만 읽는다. API를 호출하지 않는다.
//   npm run backtest:run
import { existsSync, readFileSync } from "node:fs";
import { analyzeTransfer, type TransferReport } from "../src/lib/backtest/run";
import { DEFAULT_ROUND_TRIP } from "../src/lib/backtest/cost";
import type { Candle } from "../src/lib/types";
import type { Comparison } from "../src/lib/backtest/stats";

const load = (f: string): Candle[] =>
  JSON.parse(readFileSync(`data/candles/${f}`, "utf8")).candles;

// 파일이 없으면 undefined — 2단계 섹터 구간에서 "받아오지 않은 조합"을 조용히 건너뛰지 않고
// 명시적으로 알리기 위해 존재 여부를 먼저 확인한다.
const loadIfExists = (f: string): Candle[] | undefined =>
  existsSync(`data/candles/${f}`) ? load(f) : undefined;

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const n2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "-");

// 1·2단계 공통 설정 — 비용 왕복, 롤링 창, 신호 문턱, 보유 기간.
const SETTINGS = {
  mode: "skip" as const,
  roundTrip: DEFAULT_ROUND_TRIP,
  window: 250,
  threshold: 0.01,
  horizons: [3, 5, 20, 60],
};

// 신호/대조군 비교 한 줄을 찍는다. tag는 "(비용후)"/"(비용전)"처럼 어떤 수치인지 항상 밝힌다.
// 승률은 특히 비용 전/후가 서로 다른 질문에 답하므로 태그 없이는 절대 찍지 않는다.
function printComparison(indent: string, tag: string, cmp: Comparison) {
  const s = cmp.signal;
  const c = cmp.control;
  console.log(
    `${indent}${tag.padEnd(6)} 신호일 ${pct(s.mean).padStart(8)} 대조군 ${pct(c.mean).padStart(8)} ` +
      `차이 ${pct(cmp.deltaMean).padStart(8)} 신호수 ${String(s.n).padStart(6)} ` +
      `승률${tag} 신호 ${pct(s.winRate).padStart(7)} 대조 ${pct(c.winRate).padStart(7)} ` +
      `손익비 ${n2(s.payoff).padStart(6)}`
  );
}

// analyzeTransfer 결과 한 조합(상관·조건부 성과·보유기간별·롤링 연평균)을 찍는다.
// 1단계(지수)와 2단계(섹터 ETF)가 같은 형식을 공유하도록 여기서 한 번만 정의한다.
function printReport(usLabel: string, r: TransferReport) {
  console.log(
    `${usLabel.padEnd(10)} 갭상관 ${r.corr.gap.toFixed(3).padStart(7)} ` +
      `장중상관 ${r.corr.intraday.toFixed(3).padStart(7)} 종종상관 ${r.corr.closeToClose.toFixed(3).padStart(7)}`
  );
  printComparison("  당일장중", "(비용후)", r.conditional);
  printComparison("  당일장중", "(비용전)", r.conditionalGross);

  // 보유 기간별 성과 — 스펙 §4의 단기 3·5일, 중기 20·60일.
  for (const h of r.horizons) {
    printComparison(`  └${String(h.days).padStart(2)}일보유`, "(비용후)", h.comparison);
    printComparison(`  └${String(h.days).padStart(2)}일보유`, "(비용전)", h.comparisonGross);
  }

  // 롤링 상관을 연 단위로 요약해 변곡점을 눈으로 찾는다.
  const byYear = new Map<string, number[]>();
  for (const p of r.rolling) {
    const y = p.date.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(p.corr);
  }
  const line = [...byYear.entries()]
    .map(([y, xs]) => `${y.slice(2)}:${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2)}`)
    .join(" ");
  console.log(`  롤링(250일) 연평균 장중상관 → ${line}\n`);
}

const KR = [
  { file: "KR-0001-D.json", label: "코스피" },
  { file: "KR-1001-D.json", label: "코스닥" },
];
const US = [
  { file: "US-COMP-D.json", label: "나스닥" },
  { file: "US-SPX-D.json", label: "S&P 500" },
  { file: "US-.DJI-D.json", label: "다우존스" },
];

// 2단계: 섹터 ETF 3쌍(반도체/IT/헬스케어). 조선·방산은 국내 상장 이력이 짧아(2023~2024년) 제외했다.
const SECTOR_PAIRS = [
  {
    label: "반도체",
    krFile: "KR-091160-D.json",
    krLabel: "KODEX 반도체",
    usFile: "US-SOXX-D.json",
    usLabel: "SOXX",
  },
  {
    label: "IT",
    krFile: "KR-139260-D.json",
    krLabel: "TIGER 200 IT",
    usFile: "US-XLK-D.json",
    usLabel: "XLK",
  },
  {
    label: "헬스케어",
    krFile: "KR-143860-D.json",
    krLabel: "TIGER 헬스케어",
    usFile: "US-XLV-D.json",
    usLabel: "XLV",
  },
];

console.log(`\n비용 왕복 ${pct(DEFAULT_ROUND_TRIP)} · 연 50회 매매 기준 본전 문턱 확인\n`);
console.log(
  "MDD는 여기서 찍지 않는다 — 매일 진입/보유가 겹치는 실험에서는 실제로 겪을 수 없는 곡선이라서다.\n"
);

console.log("════ 1단계: 지수 전이 ════\n");
for (const kr of KR) {
  const krCandles = load(kr.file);
  console.log(`━━ ${kr.label} (${krCandles[0].date} ~ ${krCandles.at(-1)!.date}, ${krCandles.length}건) ━━`);

  for (const us of US) {
    const r = analyzeTransfer({ krCandles, usCandles: load(us.file), ...SETTINGS });
    printReport(us.label, r);
  }
}

console.log("════ 2단계: 섹터 ETF 전이 ════\n");
for (const pair of SECTOR_PAIRS) {
  const krCandles = loadIfExists(pair.krFile);
  const usCandles = loadIfExists(pair.usFile);
  if (!krCandles) {
    console.log(
      `[${pair.label}] 파일 없음: data/candles/${pair.krFile} — npm run backtest:fetch 를 먼저 실행하세요.\n`
    );
    continue;
  }
  if (!usCandles) {
    console.log(
      `[${pair.label}] 파일 없음: data/candles/${pair.usFile} — npm run backtest:fetch 를 먼저 실행하세요.\n`
    );
    continue;
  }

  console.log(
    `━━ ${pair.label}: ${pair.krLabel} vs ${pair.usLabel} ` +
      `(${krCandles[0].date} ~ ${krCandles.at(-1)!.date}, ${krCandles.length}건) ━━`
  );
  const r = analyzeTransfer({ krCandles, usCandles, ...SETTINGS });
  printReport(pair.usLabel, r);
}

console.log("읽는 법: 갭상관이 높고 장중상관이 낮으면, 관계는 실재하지만 시초가에 이미 반영돼 매매로는 못 먹는다는 뜻이다.\n");
