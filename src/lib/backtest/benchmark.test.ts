import { describe, expect, it } from "vitest";
import { buyAndHold, randomEntries } from "./benchmark";
import type { StrategyConfig } from "./strategy";
import { applyCost } from "./cost";
import type { Candle } from "../types";

function candle(date: string, close: number, extra: Partial<Candle> = {}): Candle {
  return { date, open: close - 0.5, high: close + 1, low: close - 1, close, ...extra };
}

describe("buyAndHold", () => {
  it("첫날 시가에 사서 마지막날 종가에 판다 — 왕복 비용 1회", () => {
    const candles = [
      candle("2024-01-01", 100),
      candle("2024-01-02", 105),
      candle("2024-01-03", 130),
    ];

    const result = buyAndHold(candles, 0.004);

    const expectedGross = candles[2].close / candles[0].open - 1;
    expect(result.entryDate).toBe(candles[0].date);
    expect(result.exitDate).toBe(candles[2].date);
    expect(result.grossReturn).toBeCloseTo(expectedGross, 10);
    expect(result.netReturn).toBeCloseTo(applyCost(expectedGross, 0.004), 10);
  });
});

describe("randomEntries", () => {
  // 40일치 등락을 반복하는 합성 시계열. 무작위 진입일이 서로 다른 청산 결과를
  // 낼 수 있을 만큼 가격이 충분히 오르내리게 만든다.
  const closes = Array.from({ length: 40 }, (_, i) => 100 + ((i * 7) % 23) - 10);
  const candles = closes.map((c, i) =>
    candle(`2024-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, c)
  );

  function config(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
    return {
      entry: "rsi",
      rsiPeriod: 14,
      rsiThreshold: 30,
      mfiPeriod: 14,
      mfiThreshold: 20,
      trendFilter: false,
      trendPeriod: 200,
      stopLossPct: 0.5,
      targetPct: 0.5,
      maxHoldDays: 5,
      roundTrip: 0.004,
      ...overrides,
    };
  }

  it("같은 시드면 완전히 같은 거래 목록을 낸다(재현 가능)", () => {
    const a = randomEntries(candles, 5, config(), 42);
    const b = randomEntries(candles, 5, config(), 42);

    expect(a).toEqual(b);
  });

  it("시드가 다르면 다른 거래 목록을 낸다", () => {
    const a = randomEntries(candles, 5, config(), 1);
    const b = randomEntries(candles, 5, config(), 2);

    expect(a).not.toEqual(b);
  });

  it("무작위 진입도 포지션 한 번에 하나 원칙을 지켜 거래가 겹치지 않는다", () => {
    const trades = randomEntries(candles, 10, config(), 7);

    expect(trades.length).toBeGreaterThan(0);
    for (let i = 1; i < trades.length; i++) {
      expect(trades[i].entryIndex).toBeGreaterThan(trades[i - 1].exitIndex);
    }
  });

  it("Math.random을 쓰지 않는다 — 호출해도 값이 바뀌지 않는다", () => {
    const before = randomEntries(candles, 5, config(), 99);

    const original = Math.random;
    Math.random = () => {
      throw new Error("Math.random이 호출되었다 — PRNG는 seed 기반이어야 한다");
    };
    let after: ReturnType<typeof randomEntries>;
    try {
      after = randomEntries(candles, 5, config(), 99);
    } finally {
      Math.random = original;
    }

    expect(after).toEqual(before);
  });

  it("진입 인덱스는 전략과 같은 구간([2, n))에서만 뽑힌다 — 0·1은 나오지 않는다", () => {
    // runStrategy의 신호 스캔은 i=1부터(crossedUp이 i-1을 봐야 해서) 시작해
    // entryIndex=i+1의 구조적 최솟값이 2다. 무작위 벤치마크가 0·1도 뽑는다면
    // "신호 vs 무작위" 비교의 두 표본이 서로 다른 정의역에서 온 셈이 된다.
    // 여러 시드로 반복 호출해 우연히 큰 값만 뽑히는 시드에 기대지 않게 한다.
    for (let seed = 0; seed < 20; seed++) {
      const trades = randomEntries(candles, 10, config(), seed);
      for (const trade of trades) {
        expect(trade.entryIndex).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("유효한 진입 구간이 없을 만큼 짧은 시계열이면 빈 배열을 낸다", () => {
    // n<=2면 [2, n) 구간이 비어(또는 음의 길이가 되어) 뽑을 진입일이 없다.
    const tooShort = [candle("2024-01-01", 100), candle("2024-01-02", 101)];

    expect(randomEntries(tooShort, 5, config(), 1)).toEqual([]);
    expect(randomEntries([], 5, config(), 1)).toEqual([]);
  });
});
