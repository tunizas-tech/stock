// 3단계: RSI·MFI 과매도 탈출 전략 백테스트 실행 — data/candles의 파일만 읽는다. API 호출 없음.
//   npm run backtest:indicators
//
// 물음은 하나다: "RSI/MFI 과매도 탈출 진입 + 손절/목표/추세필터"가 그냥 사서 들고
// 있는 것(매수후보유)보다 나은가. 1·2단계와 달리 거래가 순차·비중첩이므로 여기서는
// MDD를 낸다(설계 §6).
import { existsSync, readFileSync } from "node:fs";
import type { Candle } from "../src/lib/types";
import {
  runStrategy,
  type EntrySignal,
  type ExitReason,
  type StrategyConfig,
  type Trade,
} from "../src/lib/backtest/strategy";
import { buyAndHold, randomEntries, type BuyHoldResult } from "../src/lib/backtest/benchmark";
import { summarize } from "../src/lib/backtest/stats";
import { DEFAULT_ROUND_TRIP } from "../src/lib/backtest/cost";

const load = (f: string): Candle[] =>
  JSON.parse(readFileSync(`data/candles/${f}`, "utf8")).candles;

// 파일이 없으면 undefined — 조용히 건너뛰지 않고 명시적으로 알린 뒤 나머지를 계속한다.
const loadIfExists = (f: string): Candle[] | undefined =>
  existsSync(`data/candles/${f}`) ? load(f) : undefined;

const missing = (label: string, file: string) =>
  console.log(`[${label}] 파일 없음: data/candles/${file} — npm run backtest:fetch 를 먼저 실행하세요.\n`);

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const n2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "-");

// MDD 25% 한도 — 설계 §6("스펙 §5의 연간 −25% 한도를 넘는 결과는 재현 불가능으로 표시").
// 실전이라면 이 낙폭에서 이미 손을 뗐을 것이므로, 넘는 값은 곧이곧대로 신뢰하지 않는다는
// 뜻을 라벨로 못박는다.
const MDD_LIMIT = 0.25;
const mddLabel = (mdd: number): string =>
  mdd > MDD_LIMIT ? `${pct(mdd)} (-25%한도 초과, 재현 불가능)` : pct(mdd);

// summarize()는 승률·평균·손익비·MDD는 내지만, "거래를 순서대로 복리로 이어 붙인 최종
// 누적 수익" 자체는 반환하지 않는다 — 매수후보유(총수익 하나)와 나란히 비교하려면 이
// 숫자가 필요하다. 통계라기보다 이미 있는 배열을 곱해 나가는 표시(formatting) 한 줄이라
// 여기 두었지만, 라이브러리 후보라는 점은 보고서에 남긴다.
const cumulativeReturn = (returns: number[]): number =>
  returns.reduce((acc, r) => acc * (1 + r), 1) - 1;

const exitReasonCounts = (trades: Trade[]): Record<ExitReason, number> => {
  const counts: Record<ExitReason, number> = { stop: 0, target: 0, rsi: 0, time: 0, end: 0 };
  for (const t of trades) counts[t.exitReason]++;
  return counts;
};

const formatExitReasons = (trades: Trade[]): string => {
  const c = exitReasonCounts(trades);
  return `stop ${c.stop} target ${c.target} rsi ${c.rsi} time ${c.time} end ${c.end}`;
};

// 표준 설정 — 설계 §7. 데이터를 보고 고른 값이 아니라 교과서 표준값이므로 다중 검정
// 문제가 없다. 이 절 안에서는 entry·trendFilter만 바꾼다.
const STANDARD: Omit<StrategyConfig, "entry" | "trendFilter"> = {
  rsiPeriod: 14,
  rsiThreshold: 30,
  mfiPeriod: 14,
  mfiThreshold: 20,
  trendPeriod: 200,
  stopLossPct: 0.1,
  targetPct: 0.15,
  rsiExitLevel: 70,
  maxHoldDays: 20,
  roundTrip: DEFAULT_ROUND_TRIP,
};

const RANDOM_SEED = 20260906;
const ENTRY_VARIANTS: EntrySignal[] = ["rsi", "mfi", "both"];

function printBuyHold(bh: BuyHoldResult) {
  console.log(
    `  총수익 비용전 ${pct(bh.grossReturn).padStart(9)} 비용후 ${pct(bh.netReturn).padStart(9)} ` +
      `기간 ${bh.entryDate}~${bh.exitDate} (${bh.days}일)`
  );
}

// 전략(또는 무작위 진입) 결과 한 블록을 찍는다. 거래 0건이면 NaN·빈칸을 내지 않고
// 그 사실 자체를 문장으로 남긴다.
function printTradeBlock(label: string, trades: Trade[]): number | undefined {
  if (trades.length === 0) {
    console.log(`  ${label}: 거래 0건 — 표본이 없어 통계를 낼 수 없다`);
    return undefined;
  }
  const gross = summarize(trades.map((t) => t.grossReturn));
  const net = summarize(trades.map((t) => t.netReturn));
  const cum = cumulativeReturn(trades.map((t) => t.netReturn));
  console.log(`  ${label}: 거래 ${trades.length}건`);
  console.log(
    `    비용전 승률 ${pct(gross.winRate).padStart(7)}(표본${gross.n}) ` +
      `평균 ${pct(gross.mean).padStart(8)} 손익비 ${n2(gross.payoff)}`
  );
  console.log(
    `    비용후 승률 ${pct(net.winRate).padStart(7)}(표본${net.n}) ` +
      `평균 ${pct(net.mean).padStart(8)} 손익비 ${n2(net.payoff)}`
  );
  console.log(`    MDD ${mddLabel(net.mdd)}`);
  console.log(`    청산 사유: ${formatExitReasons(trades)}`);
  console.log(`    누적 순수익(비용후, 복리) ${pct(cum)}`);
  return cum;
}

const BAR = "═".repeat(60);
console.log(`\n${BAR}`);
console.log("3단계: RSI/MFI 과매도 탈출 전략 — 매수후보유를 이기는가?");
console.log(BAR);
console.log(`비용 왕복 ${pct(DEFAULT_ROUND_TRIP)} · MDD -25% 초과 시 "재현 불가능"으로 표시`);
console.log(
  "표준: RSI(14)/30 MFI(14)/20 추세SMA(200) 손절-10% 목표+15% RSI청산70 최대보유20일\n"
);

// ── 1절: 주 결과 — KODEX 반도체, 표준값 고정 ────────────────────────────────────
console.log("════ 1절. 주 결과 — KODEX 반도체(091160), 표준값 고정 (스윕 없음) ════\n");

const PRIMARY_FILE = "KR-091160-D.json";
const PRIMARY_LABEL = "KODEX 반도체";
const primary = loadIfExists(PRIMARY_FILE);

if (!primary) {
  missing(PRIMARY_LABEL, PRIMARY_FILE);
} else {
  console.log(`${PRIMARY_LABEL}: ${primary[0].date} ~ ${primary.at(-1)!.date} (${primary.length}건)\n`);

  const bh = buyAndHold(primary, DEFAULT_ROUND_TRIP);
  console.log("┌─ 비교 기준 (가장 중요): 매수후보유 — 첫날 사서 마지막날 판다 ──────");
  printBuyHold(bh);
  console.log("│ 이 값을 못 이기면, 매매 비용을 물면서까지 이 규칙을 쓸 이유가 없다.");
  console.log("└─────────────────────────────────────────────────────────────────\n");

  for (const entry of ENTRY_VARIANTS) {
    for (const trendFilter of [true, false]) {
      const config: StrategyConfig = { ...STANDARD, entry, trendFilter };
      const label = `entry=${entry} 추세필터=${trendFilter ? "on " : "off"}`;
      console.log(`━━ ${label} ━━`);

      const trades = runStrategy(primary, config);
      const cum = printTradeBlock("전략", trades);

      const rnd = randomEntries(primary, trades.length, config, RANDOM_SEED);
      printTradeBlock(`무작위 진입(같은 ${trades.length}건, seed ${RANDOM_SEED})`, rnd);

      if (cum === undefined) {
        console.log(`  >>> 판정 [${label}]: 거래 0건이라 매수후보유와 비교할 수 없다.\n`);
      } else {
        const beat = cum > bh.netReturn;
        const diff = cum - bh.netReturn;
        console.log(`  >>> 판정 [${label}]: 매수후보유를 ${beat ? "이겼다" : "못 이겼다"}`);
        console.log(
          `      전략 누적 ${pct(cum)} vs 매수후보유(비용후) ${pct(bh.netReturn)} (차이 ${pct(diff)})\n`
        );
      }
    }
  }
}

// ── 2절: 참고 — 나머지 10개 종목 ────────────────────────────────────────────────
console.log("════ 2절. 참고 — 나머지 10개 종목 (파라미터 선택에 쓰지 않음) ════");
console.log("설정 고정: entry=rsi 추세필터=on. 이 결과를 보고 파라미터를 고르면 다중 검정이 된다.\n");

const SECONDARY = [
  { file: "KR-0001-D.json", label: "코스피" },
  { file: "KR-1001-D.json", label: "코스닥" },
  { file: "US-COMP-D.json", label: "나스닥" },
  { file: "US-SPX-D.json", label: "S&P 500" },
  { file: "US-.DJI-D.json", label: "다우존스" },
  { file: "KR-139260-D.json", label: "TIGER 200 IT" },
  { file: "KR-143860-D.json", label: "TIGER 헬스케어" },
  { file: "US-SOXX-D.json", label: "SOXX" },
  { file: "US-XLK-D.json", label: "XLK" },
  { file: "US-XLV-D.json", label: "XLV" },
];

for (const inst of SECONDARY) {
  const candles = loadIfExists(inst.file);
  if (!candles) {
    missing(inst.label, inst.file);
    continue;
  }
  const config: StrategyConfig = { ...STANDARD, entry: "rsi", trendFilter: true };
  const trades = runStrategy(candles, config);
  const bh = buyAndHold(candles, DEFAULT_ROUND_TRIP);

  if (trades.length === 0) {
    console.log(
      `${inst.label.padEnd(14)} 거래 0건 — 매수후보유(비용후) ${pct(bh.netReturn).padStart(9)}`
    );
    continue;
  }
  const net = summarize(trades.map((t) => t.netReturn));
  const cum = cumulativeReturn(trades.map((t) => t.netReturn));
  const diff = cum - bh.netReturn;
  console.log(
    `${inst.label.padEnd(14)} 거래 ${String(trades.length).padStart(3)}건 ` +
      `승률(비용후,표본${net.n}) ${pct(net.winRate).padStart(7)}`
  );
  console.log(
    `${"".padEnd(14)} 순수익누적(비용후) ${pct(cum).padStart(9)}  ` +
      `매수후보유(비용후) ${pct(bh.netReturn).padStart(9)}  차이 ${pct(diff).padStart(9)}`
  );
}
console.log("");

// ── 3절: 스윕 (학습/검증 분할) — 별도, 주 결과 아님 ─────────────────────────────
console.log(BAR);
console.log("경고: 아래는 72개 조합을 훑은 결과다. 훑으면 반드시 좋아 보이는 조합이 나온다.");
console.log("이 절의 숫자를 주 결과로 읽지 말 것 — 주 결과는 위 1절(표준값 고정)이다.");
console.log(`${BAR}\n`);
console.log("════ 3절. 스윕 — KODEX 반도체, 학습 70% / 검증 30% (별도 절) ════\n");

if (!primary) {
  console.log(`[${PRIMARY_LABEL}] 파일이 없어 스윕을 건너뜁니다.\n`);
} else {
  const n = primary.length;
  const trainEnd = Math.floor(n * 0.7);
  const trainCandles = primary.slice(0, trainEnd);
  const validStartDate = primary[trainEnd].date;
  // 검증 구간에 앞선 250일을 더 붙여 계산한다 — 그러지 않으면 SMA(200) 등 지표가
  // 검증 구간 초반 내내 undefined라 추세필터가 그 구간을 통째로 걸러내며, "검증에서
  // 거래가 안 나온다"가 "규칙이 안 통한다"가 아니라 "지표 워밍업 부족"이 되어버린다.
  // 거래는 entryDate로 다시 걸러 실제 검증 구간 것만 센다.
  const LOOKBACK = 250;
  const lookbackStart = Math.max(0, trainEnd - LOOKBACK);
  const validExtended = primary.slice(lookbackStart);
  const validOnly = primary.slice(trainEnd);
  const validBH = buyAndHold(validOnly, DEFAULT_ROUND_TRIP);

  console.log(
    `학습 ${primary[0].date}~${primary[trainEnd - 1].date} (${trainCandles.length}건) / ` +
      `검증 ${validStartDate}~${primary.at(-1)!.date} (${validOnly.length}건)`
  );
  console.log(`검증 기간 매수후보유(비용후) ${pct(validBH.netReturn)}\n`);

  const STOP_OPTS = [0.08, 0.1];
  const TARGET_OPTS = [0.1, 0.15];
  const HOLD_OPTS = [5, 20, 60];

  interface SweepResult {
    config: StrategyConfig;
    trainN: number;
    trainCum: number;
    validN: number;
    validCum: number;
  }

  const results: SweepResult[] = [];
  for (const entry of ENTRY_VARIANTS) {
    for (const trendFilter of [true, false]) {
      for (const stopLossPct of STOP_OPTS) {
        for (const targetPct of TARGET_OPTS) {
          for (const maxHoldDays of HOLD_OPTS) {
            const config: StrategyConfig = {
              ...STANDARD,
              entry,
              trendFilter,
              stopLossPct,
              targetPct,
              maxHoldDays,
            };
            const trainTrades = runStrategy(trainCandles, config);
            const validTrades = runStrategy(validExtended, config).filter(
              (t) => t.entryDate >= validStartDate
            );
            results.push({
              config,
              trainN: trainTrades.length,
              trainCum: cumulativeReturn(trainTrades.map((t) => t.netReturn)),
              validN: validTrades.length,
              validCum: cumulativeReturn(validTrades.map((t) => t.netReturn)),
            });
          }
        }
      }
    }
  }

  const configLabel = (c: StrategyConfig): string =>
    `entry=${c.entry} 추세=${c.trendFilter ? "on" : "off"} 손절${pct(c.stopLossPct)} ` +
    `목표${pct(c.targetPct)} 보유${c.maxHoldDays}일`;

  const top5 = [...results].sort((a, b) => b.trainCum - a.trainCum).slice(0, 5);
  console.log(`총 ${results.length}개 조합 중 학습 누적 순수익 상위 5개:\n`);
  top5.forEach((r, idx) => {
    console.log(`${idx + 1}위 ${configLabel(r.config)}`);
    console.log(
      `    학습 거래 ${r.trainN}건 누적(비용후) ${pct(r.trainCum).padStart(9)}  |  ` +
        `검증 거래 ${r.validN}건 누적(비용후) ${pct(r.validCum).padStart(9)}`
    );
  });

  const winner = top5[0];
  const heldUp = winner.validN > 0 && winner.validCum > 0 && winner.validCum >= validBH.netReturn;
  console.log(`\n판정: 학습 1위 (${configLabel(winner.config)})`);
  console.log(
    `  검증 누적 순수익 ${pct(winner.validCum)} vs 검증 매수후보유 ${pct(validBH.netReturn)} → ` +
      (heldUp ? "검증에서도 넘어섰다." : "검증에서 밑돌았다.")
  );
  console.log(
    heldUp
      ? "  학습 결과가 우연만은 아니었을 가능성이 있다 (그래도 §7 다중 검정 경고는 유효하다)."
      : "  학습에서 좋아 보였던 결과는 검증에서 무너졌다 — 우연이었다는 뜻이다."
  );
}

console.log(
  "\n읽는 법: 1절(표준값 고정)만이 다중 검정에서 자유로운 결과다. 매수후보유를 못 이기면\n" +
    "그 변형은 실전에 쓸 이유가 없고, 3절 스윕은 '이렇게까지 훑어도 이 정도'라는 상한선으로만 읽는다.\n"
);
