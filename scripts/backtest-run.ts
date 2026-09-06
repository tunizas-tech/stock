// 1단계 백테스트 실행 — data/candles의 파일만 읽는다. API를 호출하지 않는다.
//   npm run backtest:run
import { readFileSync } from "node:fs";
import { analyzeTransfer } from "../src/lib/backtest/run";
import { DEFAULT_ROUND_TRIP } from "../src/lib/backtest/cost";
import type { Candle } from "../src/lib/types";

const load = (f: string): Candle[] =>
  JSON.parse(readFileSync(`data/candles/${f}`, "utf8")).candles;

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const n2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "-");

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

for (const kr of KR) {
  const krCandles = load(kr.file);
  console.log(`━━ ${kr.label} (${krCandles[0].date} ~ ${krCandles.at(-1)!.date}, ${krCandles.length}건) ━━`);
  console.log("미국지수     갭상관  장중상관  종종상관 |  신호일 장중  대조군 장중   차이   신호수  승률   손익비   MDD");

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
    const s = r.conditional.signal;
    const c = r.conditional.control;
    console.log(
      `${us.label.padEnd(10)} ${r.corr.gap.toFixed(3).padStart(7)} ` +
        `${r.corr.intraday.toFixed(3).padStart(9)} ${r.corr.closeToClose.toFixed(3).padStart(9)} | ` +
        `${pct(s.mean).padStart(11)} ${pct(c.mean).padStart(12)} ${pct(r.conditional.deltaMean).padStart(8)} ` +
        `${String(s.n).padStart(7)} ${pct(s.winRate).padStart(7)} ${n2(s.payoff).padStart(7)} ${pct(s.mdd).padStart(7)}`
    );

    // 보유 기간별 성과 — 스펙 §4의 단기 3·5일, 중기 20·60일.
    for (const h of r.horizons) {
      const hs = h.comparison.signal;
      const hc = h.comparison.control;
      console.log(
        `  └ ${String(h.days).padStart(2)}일 보유: 신호 ${pct(hs.mean).padStart(8)} ` +
          `대조 ${pct(hc.mean).padStart(8)} 차이 ${pct(h.comparison.deltaMean).padStart(8)} ` +
          `n=${String(hs.n).padStart(5)} 승률 ${pct(hs.winRate).padStart(7)} ` +
          `손익비 ${n2(hs.payoff).padStart(5)} MDD ${pct(hs.mdd).padStart(7)}`
      );
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
