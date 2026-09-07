import { describe, expect, it } from "vitest";
import type { JournalEntry } from "../types";
import { DEFAULT_ROUND_TRIP } from "../backtest/cost";
import {
  DECLARED_PROB,
  disciplineReport,
  forwardReturn,
  groupByEmotion,
  groupByHoldBucket,
  groupByPrimaryTag,
  MIN_SAMPLE,
  pairTrades,
  randomBenchmark,
  skipCounterfactual,
} from "./review";

const RT = DEFAULT_ROUND_TRIP;

function entry(partial: Partial<JournalEntry>): JournalEntry {
  return {
    id: Math.random().toString(36),
    date: "2025-01-01",
    market: "KR",
    ticker: "005930",
    name: "삼성전자",
    action: "buy",
    reason: "",
    emotion: 3,
    lesson: "",
    ...partial,
  };
}

describe("pairTrades — 평균단가 짝짓기", () => {
  it("부분 매도 후 재매수를 포함한 평균단가 계산", () => {
    const entries: JournalEntry[] = [
      entry({ action: "buy", date: "2025-01-01", price: 100, qty: 10, emotion: 4, primaryTag: "수급" }),
      // 평균단가 100, 5주 매도 @120
      entry({ action: "sell", date: "2025-01-05", price: 120, qty: 5 }),
      // 남은 5주 + 새 매수 10주 @80 -> avgCost = (100*5 + 80*10)/15
      entry({ action: "buy", date: "2025-01-06", price: 80, qty: 10, emotion: 2, primaryTag: "지표" }),
      // 15주 전량 매도 @90
      entry({ action: "sell", date: "2025-01-10", price: 90, qty: 15 }),
    ];
    const { closed, open } = pairTrades(entries, RT);
    expect(closed).toHaveLength(2);

    const first = closed[0];
    expect(first.avgCost).toBeCloseTo(100, 8);
    expect(first.exitPrice).toBe(120);
    expect(first.grossReturn).toBeCloseTo(120 / 100 - 1, 10);
    expect(first.netReturn).toBeCloseTo((1 + (120 / 100 - 1)) * (1 - RT) - 1, 10);
    expect(first.emotion).toBe(4);
    expect(first.primaryTag).toBe("수급");
    expect(first.qty).toBe(5);
    expect(first.holdDays).toBe(4); // 01-01 -> 01-05

    const second = closed[1];
    const avgCost2 = (100 * 5 + 80 * 10) / 15;
    expect(second.avgCost).toBeCloseTo(avgCost2, 8);
    expect(second.exitPrice).toBe(90);
    // 두 번째 매도를 만든 "가장 최근 매수"는 01-06 매수(emotion 2, 지표)다.
    expect(second.emotion).toBe(2);
    expect(second.primaryTag).toBe("지표");
    expect(second.qty).toBe(15);

    expect(open).toHaveLength(0);
  });

  it("미청산 포지션은 open으로 분리되고 수익 집계에서 빠진다", () => {
    const entries: JournalEntry[] = [
      entry({ ticker: "000660", name: "SK하이닉스", action: "buy", date: "2025-02-01", price: 200, qty: 10, emotion: 5, primaryTag: "섹터강세" }),
    ];
    const { closed, open } = pairTrades(entries, RT);
    expect(closed).toHaveLength(0);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ ticker: "000660", name: "SK하이닉스", since: "2025-02-01", avgCost: 200, qty: 10, emotion: 5, primaryTag: "섹터강세" });
  });

  it("note·skip·가격 없는 매수/매도는 포지션에 영향을 주지 않는다", () => {
    const entries: JournalEntry[] = [
      entry({ action: "note", date: "2025-03-01", price: 999999, qty: 999 }),
      entry({ action: "skip", date: "2025-03-01" }),
      entry({ action: "buy", date: "2025-03-02", price: undefined, qty: 10 }), // price 없음
      entry({ action: "buy", date: "2025-03-02", price: 100, qty: undefined }), // qty 없음
      entry({ action: "buy", date: "2025-03-03", price: 100, qty: 10 }),
      entry({ action: "sell", date: "2025-03-04", price: 110, qty: 10 }),
    ];
    const { closed, open } = pairTrades(entries, RT);
    expect(closed).toHaveLength(1);
    expect(closed[0].avgCost).toBe(100);
    expect(open).toHaveLength(0);
  });

  it("여러 종목은 독립적으로 짝짓는다", () => {
    const entries: JournalEntry[] = [
      entry({ ticker: "A", name: "A", action: "buy", date: "2025-01-01", price: 100, qty: 10 }),
      entry({ ticker: "B", name: "B", action: "buy", date: "2025-01-01", price: 50, qty: 4 }),
      entry({ ticker: "A", name: "A", action: "sell", date: "2025-01-05", price: 110, qty: 10 }),
    ];
    const { closed, open } = pairTrades(entries, RT);
    expect(closed).toHaveLength(1);
    expect(closed[0].ticker).toBe("A");
    expect(open).toHaveLength(1);
    expect(open[0].ticker).toBe("B");
  });
});

describe("forwardReturn — 반사실 원시값(집계 전용)", () => {
  const closes = [
    { date: "2025-01-01", close: 100 },
    { date: "2025-01-02", close: 101 },
    { date: "2025-01-03", close: 102 },
    { date: "2025-01-04", close: 103 },
    { date: "2025-01-05", close: 104 },
  ];

  it("fromDate '다음' 거래일 종가에 진입한다(당일 진입 아님)", () => {
    // fromDate=01-01이면 진입은 01-02(102는 그 다음). horizon=1이면 01-03 종가에서 청산.
    const r = forwardReturn(closes, "2025-01-01", 1, 0);
    expect(r).toBeCloseTo(102 / 101 - 1, 10);
  });

  it("데이터 끝을 넘으면 undefined", () => {
    const r = forwardReturn(closes, "2025-01-04", 5, 0);
    expect(r).toBeUndefined();
  });

  it("fromDate 자체가 데이터 마지막 날이면 진입할 다음날이 없어 undefined", () => {
    const r = forwardReturn(closes, "2025-01-05", 1, 0);
    expect(r).toBeUndefined();
  });
});

describe("randomBenchmark — 대조군(C2)", () => {
  function series(n: number, drift: number): { date: string; close: number }[] {
    const out = [];
    let close = 100;
    for (let i = 0; i < n; i++) {
      close *= 1 + drift;
      out.push({ date: `2025-01-${String(i + 1).padStart(2, "0")}`, close });
    }
    return out;
  }

  it("같은 시드면 같은 결과(재현성)", () => {
    const closes = series(60, 0.001);
    const a = randomBenchmark(closes, 5, 20, 42, 0);
    const b = randomBenchmark(closes, 5, 20, 42, 0);
    expect(a).toBe(b);
  });

  it("시드가 다르면 대개 다른 결과", () => {
    const closes = series(60, 0.001);
    const a = randomBenchmark(closes, 5, 20, 1, 0);
    const b = randomBenchmark(closes, 5, 20, 2, 0);
    expect(a).not.toBe(b);
  });

  it("유효한 진입 창이 3개 미만인 짧은 시리즈는 undefined", () => {
    const closes = series(4, 0.001); // holdDays=5면 유효 창 4-5<0
    const r = randomBenchmark(closes, 5, 20, 1, 0);
    expect(r).toBeUndefined();
  });

  it("비용은 대조군에도 적용된다(I4) — gross는 양수인데 net은 음수인 경우", () => {
    // 거의 오르지 않는 시리즈 + 왕복비용 4% -> net은 음수여야 한다.
    const closes = series(60, 0.0005); // 아주 작은 상승
    const r = randomBenchmark(closes, 5, 20, 7, 0.04);
    expect(r).toBeDefined();
    expect(r!).toBeLessThan(0);
  });
});

describe("groupByEmotion / groupByPrimaryTag / groupByHoldBucket", () => {
  function mkClosed(overrides: Partial<JournalEntry> = {}) {
    // pairTrades를 거쳐 ClosedTrade를 만든다(직접 리터럴을 만들지 않아 타입이 항상 맞는다).
    const entries: JournalEntry[] = [
      entry({ action: "buy", date: "2025-01-01", price: 100, qty: 10, ...overrides }),
      entry({ action: "sell", date: "2025-01-04", price: 105, qty: 10 }),
    ];
    return pairTrades(entries, 0).closed[0];
  }

  const priceLookup = () => undefined; // 가격 데이터 없음 — randomMean/cfMean20는 undefined로 남아야 함

  it("확신도 그룹은 거래가 0건이어도 1~5 다섯 키를 전부 반환한다", () => {
    const stats = groupByEmotion([], priceLookup, 1, 0);
    expect(stats.map((s) => s.key)).toEqual(["1", "2", "3", "4", "5"]);
    for (const s of stats) {
      expect(s.n).toBe(0);
      expect(s.insufficient).toBe(true);
    }
  });

  it("확신도 그룹은 declaredProb를 함께 낸다", () => {
    const stats = groupByEmotion([], priceLookup, 1, 0);
    for (const s of stats) {
      expect(s.declaredProb).toBe(DECLARED_PROB[Number(s.key) as 1 | 2 | 3 | 4 | 5]);
    }
  });

  it("주 이유 그룹은 7개 태그 + '없음' 8개 키를 전부 반환한다", () => {
    const stats = groupByPrimaryTag([], priceLookup, 1, 0);
    expect(stats).toHaveLength(8);
    expect(stats.map((s) => s.key)).toContain("없음");
    expect(stats.map((s) => s.key)).toContain("수급");
  });

  it("보유기간 그룹은 4개 버킷을 전부 반환한다", () => {
    const stats = groupByHoldBucket([], priceLookup, 1, 0);
    expect(stats.map((s) => s.key)).toEqual(["1-3", "4-10", "11-30", "31+"]);
  });

  it("insufficient는 정확히 20건에서 뒤집힌다", () => {
    const trades19 = Array.from({ length: 19 }, () => mkClosed({ emotion: 3 }));
    const trades20 = Array.from({ length: 20 }, () => mkClosed({ emotion: 3 }));
    const s19 = groupByEmotion(trades19, priceLookup, 1, 0).find((s) => s.key === "3")!;
    const s20 = groupByEmotion(trades20, priceLookup, 1, 0).find((s) => s.key === "3")!;
    expect(s19.insufficient).toBe(true);
    expect(s20.insufficient).toBe(false);
    // insufficient여도 숫자는 회색 처리를 위해 그대로 계산돼 있어야 한다.
    expect(s19.mean).toBeDefined();
  });

  it("delta = mean - randomMean", () => {
    function series(n: number): { date: string; close: number }[] {
      const out = [];
      let close = 100;
      for (let i = 0; i < n; i++) {
        close *= 1.002;
        out.push({ date: `2025-02-${String((i % 27) + 1).padStart(2, "0")}`, close });
      }
      return out;
    }
    const prices = series(80);
    const trades = Array.from({ length: 20 }, () => mkClosed({ emotion: 1 }));
    const stats = groupByEmotion(trades, () => prices, 5, 0).find((s) => s.key === "1")!;
    expect(stats.randomMean).toBeDefined();
    expect(stats.delta).toBeCloseTo(stats.mean! - stats.randomMean!, 10);
  });
});

describe("skipCounterfactual — N3", () => {
  it("skip 건에 대해 20거래일 반사실 평균을 낸다", () => {
    const closes = [
      { date: "2025-01-01", close: 100 },
      ...Array.from({ length: 25 }, (_, i) => ({ date: `2025-02-${String((i % 27) + 1).padStart(2, "0")}`, close: 100 + i })),
    ];
    const entries: JournalEntry[] = [entry({ action: "skip", date: "2025-01-01", ticker: "X" })];
    const result = skipCounterfactual(entries, (t) => (t === "X" ? closes : undefined), 0);
    expect(result.n).toBe(1);
    expect(result.cfMean20).toBeDefined();
  });

  it("skip 데이터가 없으면 n=0, insufficient=true, cfMean20 undefined", () => {
    const result = skipCounterfactual([], () => undefined, 0);
    expect(result).toEqual({ n: 0, cfMean20: undefined, insufficient: true });
    expect(MIN_SAMPLE).toBe(20);
  });
});

describe("disciplineReport — I3", () => {
  function closedTrade(entryDate: string, exitDate: string, avgCost: number, netReturn: number) {
    // pairTrades를 거쳐 정확한 형태의 ClosedTrade를 만든다.
    const entries: JournalEntry[] = [
      entry({ ticker: "D", action: "buy", date: entryDate, price: avgCost, qty: 10 }),
      entry({ ticker: "D", action: "sell", date: exitDate, price: avgCost * (1 + netReturn), qty: 10 }),
    ];
    return pairTrades(entries, 0).closed[0];
  }

  it("stopLossPct 설정이 없으면 undefined", () => {
    const trade = closedTrade("2025-01-01", "2025-01-10", 100, -0.2);
    expect(disciplineReport([trade], () => undefined, undefined, 0)).toBeUndefined();
  });

  it("규칙이 있고 실제 위반이 있으면 카운트한다", () => {
    // avgCost 100, stopLossPct 0.1 -> stopPrice 90. 종가가 85까지 내려간 뒤 결국 -20%로 매도.
    const trade = closedTrade("2025-01-01", "2025-01-10", 100, -0.2);
    const prices = [
      { date: "2025-01-01", close: 100 },
      { date: "2025-01-05", close: 85 }, // 손절선(90) 이탈
      { date: "2025-01-10", close: 80 },
    ];
    const report = disciplineReport([trade], () => prices, 0.1, 0);
    expect(report).toBeDefined();
    expect(report!.checked).toBe(1);
    expect(report!.violated).toBe(1);
    expect(report!.excessLoss).toBeCloseTo(-0.2 - -0.1, 10);
  });

  it("종가가 손절선 아래로 간 적이 없으면(실제 체결은 장중 이탈로 더 나빴어도) 위반 아님", () => {
    // 실제 체결가는 -15%(넷)로 손절선(-10%)보다 나쁘지만, 시장 종가 시계열은
    // 보유 기간 내내 손절선(90) 아래로 내려간 적이 없다 — 장중에만 스치고
    // 종가는 회복한 상황을 흉내낸다. 종가 기준 판정은 이런 위반을 놓친다.
    const trade = closedTrade("2025-01-01", "2025-01-10", 100, -0.15);
    const prices = [
      { date: "2025-01-01", close: 100 },
      { date: "2025-01-05", close: 95 }, // 손절선(90) 안 깨짐
      { date: "2025-01-10", close: 92 },
    ];
    const report = disciplineReport([trade], () => prices, 0.1, 0);
    expect(report!.violated).toBe(0);
    expect(report!.excessLoss).toBe(0);
  });
});
