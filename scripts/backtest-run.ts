// 1단계 백테스트 실행 — data/candles의 파일만 읽는다. API를 호출하지 않는다.
//   npm run backtest:run
import { readFileSync } from "node:fs";
import { analyzeTransfer } from "../src/lib/backtest/run";
import { DEFAULT_ROUND_TRIP } from "../src/lib/backtest/cost";
import type { Candle } from "../src/lib/types";
import type { Comparison } from "../src/lib/backtest/stats";

const load = (f: string): Candle[] =>
  JSON.parse(readFileSync(`data/candles/${f}`, "utf8")).candles;

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const n2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "-");

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

const KR = [
  { file: "KR-0001-D.json", label: "코스피" },
  { file: "KR-1001-D.json", label: "코스닥" },
];
const US = [
  { file: "US-COMP-D.json", label: "나스닥" },
  { file: "US-SPX-D.json", label: "S&P 500" },
  { file: "US-.DJI-D.json", label: "다우존스" },
];

console.log(`\n비용 왕복 ${pct(DEFAULT_ROUND_TRIP)} · 연 50회 매매 기준 본전 문턱 확인\n`);
console.log(
  "MDD는 여기서 찍지 않는다 — 매일 진입/보유가 겹치는 1단계 실험에서는 실제로 겪을 수 없는 곡선이라서다.\n"
);

for (const kr of KR) {
  const krCandles = load(kr.file);
  console.log(`━━ ${kr.label} (${krCandles[0].date} ~ ${krCandles.at(-1)!.date}, ${krCandles.length}건) ━━`);

  for (const us of US) {
    const r = analyzeTransfer({
      krCandles,
      usCandles: load(us.file),
      mode: "skip",
      roundTrip: DEFAULT_ROUND_TRIP,
      window: 250,
      threshold: 0.01,
      horizons: [3, 5, 20, 60],
    });
    console.log(
      `${us.label.padEnd(10)} 갭상관 ${r.corr.gap.toFixed(3).padStart(7)} ` +
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
}

console.log("읽는 법: 갭상관이 높고 장중상관이 낮으면, 관계는 실재하지만 시초가에 이미 반영돼 매매로는 못 먹는다는 뜻이다.\n");
