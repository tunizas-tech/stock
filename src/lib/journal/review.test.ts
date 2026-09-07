import { describe, expect, it } from "vitest";
import type { JournalEntry } from "../types";
import { DEFAULT_ROUND_TRIP } from "../backtest/cost";
import {
  DECLARED_PROB,
  disciplineReport,
  entersSameDay,
  forwardReturn,
  groupByEmotion,
  groupByHoldBucket,
  groupByPrimaryTag,
  MIN_SAMPLE,
  pairTrades,
  randomBenchmark,
  skipCounterfactual,
  type PriceLookup,
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

/**
 * 달력일 연속 종가 픽스처(2025-01-01 형식). 거래일=달력일인 단순 시리즈라
 * "진입/청산 날짜가 배열에서 그대로 찾아진다".
 */
function closesFrom(start: string, n: number, drift: number): { date: string; close: number }[] {
  const out: { date: string; close: number }[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  let close = 100;
  for (let i = 0; i < n; i++) {
    close *= 1 + drift;
    out.push({ date: d.toISOString().slice(0, 10), close });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** 주말을 건너뛴 종가 픽스처 — 달력일과 거래일이 어긋나게 만드는 데 쓴다(I-2). */
function tradingCloses(start: string, n: number, drift: number): { date: string; close: number }[] {
  const out: { date: string; close: number }[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  let close = 100;
  while (out.length < n) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      close *= 1 + drift;
      out.push({ date: d.toISOString().slice(0, 10), close });
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
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

  it("주 이유 그룹은 8개 태그(에이전트 포함) + '없음' 9개 키를 전부 반환한다", () => {
    const stats = groupByPrimaryTag([], priceLookup, 1, 0);
    expect(stats).toHaveLength(9);
    expect(stats.map((s) => s.key)).toContain("없음");
    expect(stats.map((s) => s.key)).toContain("수급");
    // R5: validate.ts의 REASON_TAGS(8종, "에이전트" 포함)를 그대로 쓴다 —
    // 로컬에 따로 7종짜리 배열을 두면 에이전트 문 거래가 이 표에서 빠진다.
    expect(stats.map((s) => s.key)).toContain("에이전트");
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

  it("모든 거래에 시세가 있으면 delta = mean − randomMean", () => {
    // 픽스처 날짜는 실제 달력 순서여야 한다 — I-2 이후 대조군 보유일이 종가
    // 배열에서 찾은 거래일 인덱스 차이라, 날짜가 뒤죽박죽이면 진입/청산
    // 인덱스를 못 잡아 그 거래가 대조군에서 빠진다.
    const prices = closesFrom("2025-01-01", 80, 0.002);
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
    expect(result.user.n).toBe(1);
    expect(result.user.cfMean20).toBeDefined();
  });

  it("skip 데이터가 없으면 n=0, insufficient=true, cfMean20 undefined", () => {
    const result = skipCounterfactual([], () => undefined, 0);
    expect(result.user).toEqual({ n: 0, cfMean20: undefined, insufficient: true });
    expect(MIN_SAMPLE).toBe(20);
  });
});

describe("forwardReturn includeSameDay", () => {
  const closes = [
    { date: "2026-09-07", close: 100 }, { date: "2026-09-08", close: 110 }, { date: "2026-09-09", close: 121 },
  ];
  it("기본은 다음 거래일 진입(> fromDate)", () => {
    expect(forwardReturn(closes, "2026-09-07", 1, 0)).toBeCloseTo(0.1, 6);       // 110→121
  });
  it("includeSameDay면 그날 종가 진입(>= fromDate)", () => {
    expect(forwardReturn(closes, "2026-09-08", 1, 0, true)).toBeCloseTo(0.1, 6);  // 110→121
    expect(forwardReturn(closes, "2026-09-08", 1, 0)).toBeUndefined();            // 121 다음이 없다
  });
});

describe("entersSameDay", () => {
  it("07:30 KST 기록은 그날 종가 진입", () => {
    expect(entersSameDay({ date: "2026-09-08", createdAt: "2026-09-07T22:30:00.000Z" })).toBe(true);
  });
  it("16:00 KST 기록은 다음 거래일", () => {
    expect(entersSameDay({ date: "2026-09-08", createdAt: "2026-09-08T07:00:00.000Z" })).toBe(false);
  });
  it("createdAt 없으면 종전대로 다음 거래일", () => {
    expect(entersSameDay({ date: "2026-09-08" })).toBe(false);
  });
});

describe("skipCounterfactual — author 분리·KOSPI 대조", () => {
  const closes = Array.from({ length: 30 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, close: 100 + i }));
  const kospi = Array.from({ length: 30 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, close: 1000 + i * 5 }));
  const skip = (p: Partial<JournalEntry>): JournalEntry => ({ id: Math.random().toString(36), date: "2026-01-02", market: "KR", ticker: "X", name: "x", action: "skip", reason: "", emotion: 3, lesson: "", ...p });
  it("사람과 에이전트를 나눠 세고, 같은 창의 KOSPI 수익과 차이를 붙인다", () => {
    const r = skipCounterfactual([skip({ author: "agent" }), skip({}), skip({ author: "user" })], () => closes, 0, kospi);
    expect(r.agent.n).toBe(1);
    expect(r.user.n).toBe(2);
    // 진입 01-03(다음 거래일) close 102 → +20일 01-23 close 122: +19.6%; KOSPI 1010→1110: +9.9%
    expect(r.user.cfMean20).toBeCloseTo(122 / 102 - 1, 6);
    expect(r.user.kospiMean20).toBeCloseTo(1110 / 1010 - 1, 6);
    expect(r.user.delta).toBeCloseTo(122 / 102 - 1 - (1110 / 1010 - 1), 6);
  });
  it("07:30 에이전트 기록은 그날 종가 진입으로 판다", () => {
    const r = skipCounterfactual([skip({ author: "agent", date: "2026-01-02", createdAt: "2026-01-01T22:30:00.000Z" })], () => closes, 0, kospi);
    // 진입 01-02 close 101 → 01-22 close 121
    expect(r.agent.cfMean20).toBeCloseTo(121 / 101 - 1, 6);
    expect(r.agent.kospiMean20).toBeCloseTo(1105 / 1005 - 1, 6);
  });
  it("KOSPI 종가가 없으면 kospiMean20·delta는 undefined, cfMean20은 그대로", () => {
    const r = skipCounterfactual([skip({})], () => closes, 0, undefined);
    expect(r.user.cfMean20).toBeDefined();
    expect(r.user.kospiMean20).toBeUndefined();
    expect(r.user.delta).toBeUndefined();
  });
});

describe("computeGroupStat cfMean20도 createdAt 규칙을 따른다", () => {
  it("07:30에 쓴 매수는 반사실이 그날 종가부터", () => {
    // 30일 closes, 매수 01-02 07:30 KST createdAt, 매도 01-10. cfMean20 = closes[1]→closes[21]
    const closes = Array.from({ length: 30 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, close: 100 + i }));
    const entries: JournalEntry[] = [
      { id: "b", date: "2026-01-02", market: "KR", ticker: "X", name: "x", action: "buy", price: 101, qty: 1, reason: "", emotion: 3, lesson: "", createdAt: "2026-01-01T22:30:00.000Z" },
      { id: "s", date: "2026-01-10", market: "KR", ticker: "X", name: "x", action: "sell", price: 109, qty: 1, reason: "", emotion: 3, lesson: "" },
    ];
    const { closed } = pairTrades(entries, 0);
    expect(closed[0].entryCreatedAt).toBe("2026-01-01T22:30:00.000Z");
    // 없는 확신도 행들 사이에서 3번 행을 찾는다
    const e3 = groupByEmotion(closed, () => closes, 1, 0).find((r) => r.key === "3")!;
    expect(e3.cfMean20).toBeCloseTo(121 / 101 - 1, 6);
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


describe("delta 모집단 — 대조군이 돈 거래끼리만 비교한다(I-1)", () => {
  // 왜 이 구분이 필요한가: mean은 전체 거래의 평균인데 randomMean은 대조군을
  // 실제로 돌린 거래에서만 나온다. 그 둘을 그냥 빼면 "무작위보다 나았다"가
  // 사실은 "대조군이 없던 종목이 잘됐다"일 수 있다 — 서로 다른 모집단을 뺀
  // 수치라 의미가 없다. priceN은 그 "대조군이 돈 거래" 수다.
  const prices = closesFrom("2025-01-01", 60, 0.002);
  const lookup: PriceLookup = (t) => (t === "P" ? prices : undefined);

  function trade(ticker: string, sellPrice: number) {
    const entries: JournalEntry[] = [
      entry({ ticker, action: "buy", date: "2025-01-02", price: 100, qty: 10, emotion: 4 }),
      entry({ ticker, action: "sell", date: "2025-01-08", price: sellPrice, qty: 10 }),
    ];
    return pairTrades(entries, 0).closed[0];
  }

  it("n은 전체 거래 수, priceN은 대조군이 돈 거래 수", () => {
    const trades = [trade("P", 110), trade("X", 200), trade("Y", 50)];
    const stat = groupByEmotion(trades, lookup, 5, 0).find((s) => s.key === "4")!;
    expect(stat.n).toBe(3);
    expect(stat.priceN).toBe(1);
  });

  it("delta는 대조군이 돈 거래(1건)의 평균 기준이고, 전체 평균 기준이 아니다", () => {
    const trades = [trade("P", 110), trade("X", 200), trade("Y", 50)];
    const stat = groupByEmotion(trades, lookup, 5, 0).find((s) => s.key === "4")!;
    expect(stat.randomMean).toBeDefined();
    // 대조군이 돈 거래는 P 하나 — 그 거래의 수익(+10%)만으로 비교한다.
    expect(stat.delta).toBeCloseTo(0.1 - stat.randomMean!, 10);
    // 전체 평균(mean)은 -20%대라 그걸로 뺐다면 완전히 다른 값이 나온다.
    expect(stat.mean).not.toBeCloseTo(0.1, 3);
    expect(stat.delta).not.toBeCloseTo(stat.mean! - stat.randomMean!, 3);
  });

  it("mean·winRate는 스펙대로 전체 n 기준을 유지한다", () => {
    const trades = [trade("P", 110), trade("X", 200), trade("Y", 50)];
    const stat = groupByEmotion(trades, lookup, 5, 0).find((s) => s.key === "4")!;
    expect(stat.mean).toBeCloseTo((0.1 + 1.0 - 0.5) / 3, 10);
    expect(stat.winRate).toBeCloseTo(2 / 3, 10);
  });

  it("대조군이 하나도 못 돌면 randomMean·delta·cfMean20 모두 undefined", () => {
    const trades = [trade("X", 200), trade("Y", 50)];
    const stat = groupByEmotion(trades, lookup, 5, 0).find((s) => s.key === "4")!;
    expect(stat.priceN).toBe(0);
    expect(stat.randomMean).toBeUndefined();
    expect(stat.delta).toBeUndefined();
    expect(stat.cfMean20).toBeUndefined();
    expect(stat.mean).toBeDefined(); // 실제 수익은 일지 자체 값이라 그대로 남는다
  });

  it("시세는 있지만 대조군을 못 돌린 거래(당일 매매)는 priceN에도 delta에도 안 들어간다", () => {
    // 당일 사고 판 거래는 보유 거래일이 0이라 대조군을 돌릴 수 없다. 그런데도
    // 분자(수익 평균)에만 넣으면 delta는 다시 "대조군이 없는 거래가 섞인" 값이
    // 된다 — 분모(randomMean)와 정확히 같은 거래만 분자에 넣어야 한다.
    const sameDay = pairTrades(
      [
        entry({ ticker: "P", action: "buy", date: "2025-01-02", price: 100, qty: 10, emotion: 4 }),
        entry({ ticker: "P", action: "sell", date: "2025-01-02", price: 300, qty: 10 }),
      ],
      0
    ).closed[0];
    const normal = trade("P", 110); // 01-02 → 01-08, 대조군이 돈다

    const stat = groupByEmotion([normal, sameDay], lookup, 5, 0).find((s) => s.key === "4")!;
    expect(stat.n).toBe(2);
    expect(stat.priceN).toBe(1);
    expect(stat.randomMean).toBeDefined();
    // 당일 매매(+200%)가 분자에 섞였다면 delta가 1.0을 훌쩍 넘는다.
    expect(stat.delta).toBeCloseTo(0.1 - stat.randomMean!, 10);
  });
});

describe("대조군 보유일은 거래일 기준(I-2)", () => {
  // 종가 배열은 거래일만 담는다 — randomBenchmark는 그 배열의 인덱스를 그대로
  // 더하므로, 달력일(금→화 = 4일)을 넘기면 실제로는 4거래일(= 달력 6일)짜리
  // 대조군이 되어 사용자 거래보다 긴 기간과 비교하게 된다.
  const prices = tradingCloses("2025-01-01", 60, 0.002);

  function fridayToTuesday() {
    const entries: JournalEntry[] = [
      // 2025-01-03(금) 매수 → 2025-01-07(화) 매도. 달력 4일, 거래일 2일.
      entry({ ticker: "P", action: "buy", date: "2025-01-03", price: 100, qty: 10, emotion: 2 }),
      entry({ ticker: "P", action: "sell", date: "2025-01-07", price: 110, qty: 10 }),
    ];
    return pairTrades(entries, 0).closed[0];
  }

  it("금→화 보유는 holdDays(달력) 4이지만 대조군은 거래일 2로 돈다", () => {
    const t = fridayToTuesday();
    expect(t.holdDays).toBe(4); // 달력일은 그대로 둔다(사용자는 달력으로 생각한다)

    const stat = groupByEmotion([t], () => prices, 5, 0).find((s) => s.key === "2")!;
    const expected = randomBenchmark(prices, 2, 20, 5, 0);
    const calendarBased = randomBenchmark(prices, 4, 20, 5, 0);
    expect(expected).not.toBeCloseTo(calendarBased!, 6); // 픽스처가 두 값을 구분한다
    expect(stat.randomMean).toBeCloseTo(expected!, 12);
  });

  it("종가 배열이 매수일보다 나중에 시작하면 그 거래는 대조군에서 빠진다", () => {
    // 진입일이 시리즈 시작 전이면 "그 다음 거래일"이 아니라 아예 데이터 밖이다.
    // 첫 인덱스로 붙여버리면 보유 기간이 실제보다 짧게 잡혀(여기서는 0일) 잘못된
    // 대조군이 나온다 — 계산하지 않는 편이 정직하다.
    const later = closesFrom("2025-06-01", 60, 0.002);
    const t = fridayToTuesday();
    const stat = groupByEmotion([t], () => later, 5, 0).find((s) => s.key === "2")!;
    expect(stat.priceN).toBe(0);
    expect(stat.randomMean).toBeUndefined();
    expect(stat.delta).toBeUndefined();
  });

  it("매도일만 시리즈 끝을 넘어가는 경우에도 대조군을 만들지 않는다", () => {
    // 청산일이 데이터 끝보다 뒤면 보유 거래일을 알 수 없다.
    const short = closesFrom("2025-01-01", 4, 0.002); // 01-01~01-04
    const t = fridayToTuesday(); // 01-03 매수 → 01-07 매도(데이터 밖)
    const stat = groupByEmotion([t], () => short, 5, 0).find((s) => s.key === "2")!;
    expect(stat.priceN).toBe(0);
    expect(stat.randomMean).toBeUndefined();
  });
});

describe("pairTrades — 값이 이상한 기록 방어(I-3)", () => {
  it("price가 null인 매수는 무시하고 나머지로 정상 청산한다(NaN 오염 없음)", () => {
    const entries: JournalEntry[] = [
      entry({ ticker: "N", action: "buy", date: "2025-01-01", price: null as unknown as number, qty: 10 }),
      entry({ ticker: "N", action: "buy", date: "2025-01-02", price: 100, qty: 10 }),
      entry({ ticker: "N", action: "sell", date: "2025-01-05", price: 110, qty: 10 }),
    ];
    const { closed, open } = pairTrades(entries, 0);
    expect(closed).toHaveLength(1);
    expect(closed[0].avgCost).toBe(100);
    expect(Number.isNaN(closed[0].netReturn)).toBe(false);
    expect(closed[0].netReturn).toBeCloseTo(0.1, 10);
    expect(closed[0].entryDate).toBe("2025-01-02");
    expect(open).toHaveLength(0);
  });

  it("price가 0인 매수는 무시한다(평균단가 0 → 수익률 Infinity 방지)", () => {
    const entries: JournalEntry[] = [
      entry({ ticker: "N", action: "buy", date: "2025-01-01", price: 0, qty: 10 }),
      entry({ ticker: "N", action: "buy", date: "2025-01-02", price: 100, qty: 10 }),
      entry({ ticker: "N", action: "sell", date: "2025-01-05", price: 110, qty: 10 }),
    ];
    const { closed, open } = pairTrades(entries, 0);
    expect(closed).toHaveLength(1);
    expect(closed[0].avgCost).toBe(100);
    expect(Number.isFinite(closed[0].netReturn)).toBe(true);
    expect(closed[0].netReturn).toBeCloseTo(0.1, 10);
    expect(open).toHaveLength(0);
  });

  it("qty가 0·음수·NaN인 기록도 포지션을 흔들지 않는다", () => {
    const entries: JournalEntry[] = [
      entry({ ticker: "N", action: "buy", date: "2025-01-01", price: 100, qty: 0 }),
      entry({ ticker: "N", action: "buy", date: "2025-01-02", price: 100, qty: -5 }),
      entry({ ticker: "N", action: "buy", date: "2025-01-03", price: 100, qty: NaN }),
      entry({ ticker: "N", action: "buy", date: "2025-01-04", price: 100, qty: 10 }),
      entry({ ticker: "N", action: "sell", date: "2025-01-06", price: 120, qty: 10 }),
    ];
    const { closed, open } = pairTrades(entries, 0);
    expect(closed).toHaveLength(1);
    expect(closed[0].avgCost).toBe(100);
    expect(closed[0].netReturn).toBeCloseTo(0.2, 10);
    expect(open).toHaveLength(0);
  });
});

describe("disciplineReport — 이탈 창과 초과 손실의 정의(I-5)", () => {
  function closedTrade(entryDate: string, exitDate: string, avgCost: number, netReturn: number) {
    const entries: JournalEntry[] = [
      entry({ ticker: "D", action: "buy", date: entryDate, price: avgCost, qty: 10 }),
      entry({ ticker: "D", action: "sell", date: exitDate, price: avgCost * (1 + netReturn), qty: 10 }),
    ];
    return pairTrades(entries, 0).closed[0];
  }

  it("이탈 후 회복해 손절선보다 작은 손실로 팔아도 위반이다(초과 손실은 0)", () => {
    // 손절 5%: 종가가 94까지 빠져 규칙상 팔았어야 했는데 안 팔았다 → 규율 위반.
    // 결국 -2%로 끝나 "손해는 덜 봤다" — 그래도 규칙을 어긴 건 어긴 것이다.
    // 초과 손실은 손절선보다 더 잃은 몫만 세므로 여기서는 0이다.
    const trade = closedTrade("2025-01-01", "2025-01-10", 100, -0.02);
    const prices = [
      { date: "2025-01-01", close: 100 },
      { date: "2025-01-05", close: 94 }, // 손절선(95) 이탈
      { date: "2025-01-10", close: 98 },
    ];
    const report = disciplineReport([trade], () => prices, 0.05, 0)!;
    expect(report.violated).toBe(1);
    expect(report.excessLoss).toBe(0);
  });

  it("매도 당일 종가가 처음 이탈한 것이면 위반이 아니다(규칙대로 판 것)", () => {
    // 손절선을 깬 그날 팔았다면 그게 바로 규칙을 지킨 모습이다.
    const trade = closedTrade("2025-01-01", "2025-01-10", 100, -0.06);
    const prices = [
      { date: "2025-01-01", close: 100 },
      { date: "2025-01-05", close: 97 },
      { date: "2025-01-10", close: 94 }, // 매도 당일에 처음 이탈
    ];
    const report = disciplineReport([trade], () => prices, 0.05, 0)!;
    expect(report.checked).toBe(1);
    expect(report.violated).toBe(0);
    expect(report.excessLoss).toBe(0);
  });

  it("이탈했고 손절선보다 더 잃었으면 그 초과분만 합산한다", () => {
    const trade = closedTrade("2025-01-01", "2025-01-10", 100, -0.2);
    const prices = [
      { date: "2025-01-01", close: 100 },
      { date: "2025-01-05", close: 85 },
      { date: "2025-01-10", close: 80 },
    ];
    const report = disciplineReport([trade], () => prices, 0.1, 0)!;
    expect(report.violated).toBe(1);
    expect(report.excessLoss).toBeCloseTo(-0.1, 10);
  });
});
