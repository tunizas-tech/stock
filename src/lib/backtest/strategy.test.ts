import { describe, expect, it } from "vitest";
import { runStrategy } from "./strategy";
import type { StrategyConfig } from "./strategy";
import { applyCost } from "./cost";
import type { Candle } from "../types";

// 종가만 다르게 두고 시가는 종가-0.5로 고정한 캔들. 시가·종가를 항상 다른 값으로
// 만들어 두면 "신호 다음날 시가로 진입"을 "종가로 진입"과 혼동하는 실수를
// entryPrice !== candles[i+1].close assertion 없이도 값 비교만으로 잡아낼 수 있다.
function candle(date: string, close: number, extra: Partial<Candle> = {}): Candle {
  return { date, open: close - 0.5, high: close + 1, low: close - 1, close, ...extra };
}

function closesToCandles(closes: number[], extra: Partial<Candle>[] = []): Candle[] {
  return closes.map((c, i) => candle(`2024-01-${String(i + 1).padStart(2, "0")}`, c, extra[i] ?? {}));
}

/** 필요한 필드만 덮어써서 쓰는 기본 설정. RSI period=1이면 하루 전 대비 등락만으로
 * RSI가 100(상승/보합) 또는 0(하락)으로 정확히 갈려서, 크로스업 지점을 손으로
 * 정확히 예측할 수 있다 — 표준 기간(14)으로는 손검증이 사실상 불가능하다. */
function baseConfig(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
  return {
    entry: "rsi",
    rsiPeriod: 1,
    rsiThreshold: 50,
    mfiPeriod: 14,
    mfiThreshold: 20,
    trendFilter: false,
    trendPeriod: 200,
    stopLossPct: 0.9,
    targetPct: 0.9,
    maxHoldDays: 100,
    roundTrip: 0.004,
    ...overrides,
  };
}

describe("runStrategy — 진입", () => {
  // 종가 100,90,95,96,97 (period=1 RSI)
  // out[1]=0(100→90 하락), out[2]=100(90→95 상승) → i=2에서 크로스업(0<50<=100)
  // out[3]=100(95→96 상승, 이미 위라 크로스 아님), out[4]=100(96→97)
  const closes = [100, 90, 95, 96, 97];
  const candles = closesToCandles(closes);

  it("진입가는 신호 다음날 시가다 — 신호 당일 종가가 아니다", () => {
    const trades = runStrategy(candles, baseConfig());

    expect(trades).toHaveLength(1);
    expect(trades[0].entryIndex).toBe(3);
    expect(trades[0].entryPrice).toBe(candles[3].open);
    expect(trades[0].entryPrice).not.toBe(candles[2].close); // 신호 당일 종가와 다름
    expect(trades[0].entryDate).toBe(candles[3].date);
  });

  it("신호가 마지막 캔들에서 나오면 다음날이 없어 거래가 생기지 않는다", () => {
    // 종가 100,90,95 → out[1]=0, out[2]=100 → i=2(마지막 인덱스)에서 크로스업.
    // entryIndex=3인데 캔들은 인덱스 0~2뿐이라 진입 불가.
    const shortCloses = [100, 90, 95];
    const shortCandles = closesToCandles(shortCloses);

    const trades = runStrategy(shortCandles, baseConfig());

    expect(trades).toHaveLength(0);
  });

  it("크로스업은 직전·당일 값이 둘 다 정의돼 있어야 한다 — 직전이 undefined면 신호 없음", () => {
    // 길이 2: out[0]=undefined, out[1]은 정의됨(상승이므로 100). i=1이 유일한 후보인데
    // 직전(out[0])이 undefined이므로, 값만 보면 크로스업처럼 보여도 신호가 아니다.
    const candles2 = closesToCandles([100, 110]);

    const trades = runStrategy(candles2, baseConfig());

    expect(trades).toHaveLength(0);
  });

  it("추세 필터(trendFilter)를 켜면 신호일 종가가 SMA 이하일 때 진입이 막힌다", () => {
    // 첫 종가를 130으로 높여 SMA(3)이 신호일(index=2, 종가95)보다 높게 만든다.
    // sma[2] = (130+90+95)/3 = 105 > 95 → 필터 켜면 진입 불가, 끄면 그대로 진입.
    const trendCloses = [130, 90, 95, 96, 97];
    const trendCandles = closesToCandles(trendCloses);

    const withoutFilter = runStrategy(trendCandles, baseConfig({ trendFilter: false }));
    const withFilter = runStrategy(
      trendCandles,
      baseConfig({ trendFilter: true, trendPeriod: 3 })
    );

    expect(withoutFilter).toHaveLength(1);
    expect(withFilter).toHaveLength(0);
  });

  it("minVolumeRatio를 설정하면 거래량비가 기준 미달인 신호는 걸러진다", () => {
    // 앞 20일은 거래량 100으로 평탄하게 채워 volumeRatio(period=20) 기준선을 만든다.
    // index20에서 하락(out=0), index21에서 상승(out=100)으로 크로스업 → 신호일=21.
    // 신호일 거래량을 50으로 낮게 둬 비율 0.5(<1.5)로 만든다.
    const flatCloses = new Array(20).fill(50);
    const closesWithSignal = [...flatCloses, 40, 45, 50];
    const extras: Partial<Candle>[] = closesWithSignal.map(() => ({ volume: 100 }));
    extras[21] = { volume: 50 }; // 신호일(index21) 거래량비 = 50/100 = 0.5
    const volCandles = closesToCandles(closesWithSignal, extras);

    const withoutFilter = runStrategy(volCandles, baseConfig({ minVolumeRatio: undefined }));
    const withFilter = runStrategy(volCandles, baseConfig({ minVolumeRatio: 1.5 }));

    expect(withoutFilter).toHaveLength(1);
    expect(withFilter).toHaveLength(0);
  });
});

describe("runStrategy — 보유 중 신호 무시(포지션은 한 번에 하나)", () => {
  it("보유 중 발생한 두 번째 신호는 무시되고 거래는 하나만 남는다", () => {
    // 종가: 100,90,95,96,85,92,90 (period=1 RSI, threshold=50)
    // i=2에서 첫 크로스업(0<50<=100) → entryIndex=3.
    // maxHoldDays=3이면 보유는 index3(hold0)~index6(hold3, 시간청산)까지 이어진다.
    // 그 사이 index4→5(85→92, 상승)로 두 번째 크로스업(i=5)이 발생하지만
    // 보유 중이므로 무시되어야 한다. index6 이후 추가 신호는 없다.
    const closes = [100, 90, 95, 96, 85, 92, 90];
    const candles = closesToCandles(closes);

    const trades = runStrategy(candles, baseConfig({ maxHoldDays: 3, stopLossPct: 0.9, targetPct: 0.9 }));

    expect(trades).toHaveLength(1);
    expect(trades[0].entryIndex).toBe(3);
    expect(trades[0].exitIndex).toBe(6);
    expect(trades[0].exitReason).toBe("time");
  });
});

describe("runStrategy — 청산 우선순위", () => {
  it("손절과 목표가 같은 날 동시에 성립하면 손절이 이긴다", () => {
    // stopLossPct=0, targetPct=0 → 두 기준선이 진입가와 정확히 같아진다.
    // 신호일 종가를 진입가와 같게 둬서 두 조건이 동시에 참이 되게 만든다.
    const closes = [100, 90, 95, 96, 97];
    const candles: Candle[] = closesToCandles(closes);
    // entryIndex=3의 캔들을 시가=종가=95로 덮어써 stop·target 기준선(둘 다 95)과 일치시킨다.
    candles[3] = { ...candles[3], open: 95, close: 95, high: 95, low: 95 };

    const trades = runStrategy(candles, baseConfig({ stopLossPct: 0, targetPct: 0 }));

    expect(trades).toHaveLength(1);
    expect(trades[0].entryIndex).toBe(3);
    expect(trades[0].exitReason).toBe("stop");
    expect(trades[0].exitIndex).toBe(3);
  });

  it("RSI 청산과 시간 청산이 같은 날 성립하면 RSI가 이긴다", () => {
    // 종가: 100,90,95,90,85,90 → i=2에서 크로스업(entryIndex=3).
    // maxHoldDays=2 → hold0(index3),hold1(index4),hold2(index5)에서 시간청산 조건 성립.
    // index4→5는 85→90 상승이라 out[5]=100 → rsiExitLevel=70 이상이라 RSI청산도 같은 날 성립.
    // index3,4는 하락이라 out=0 (rsi청산·시간청산 모두 안 걸림, hold0/1 < maxHoldDays=2).
    const closes = [100, 90, 95, 90, 85, 90];
    const candles = closesToCandles(closes);

    const trades = runStrategy(
      candles,
      baseConfig({ maxHoldDays: 2, rsiExitLevel: 70, stopLossPct: 0.9, targetPct: 0.9 })
    );

    expect(trades).toHaveLength(1);
    expect(trades[0].entryIndex).toBe(3);
    expect(trades[0].exitIndex).toBe(5);
    expect(trades[0].exitReason).toBe("rsi");
  });

  it("데이터가 보유 중에 끝나면 마지막 종가로 강제 청산(end)한다", () => {
    // 종가: 100,90,95,96,97 → i=2 크로스업, entryIndex=3.
    // maxHoldDays=100, 손절·목표 모두 넉넉해 아무것도 안 걸리고 데이터(index4)에서 끝난다.
    const closes = [100, 90, 95, 96, 97];
    const candles = closesToCandles(closes);

    const trades = runStrategy(candles, baseConfig());

    expect(trades).toHaveLength(1);
    expect(trades[0].exitReason).toBe("end");
    expect(trades[0].exitIndex).toBe(candles.length - 1);
    expect(trades[0].exitPrice).toBe(candles[candles.length - 1].close);
  });
});

describe("runStrategy — 수익률", () => {
  it("netReturn은 grossReturn에 왕복 비용을 적용한 값과 같다", () => {
    const closes = [100, 90, 95, 96, 97];
    const candles = closesToCandles(closes);

    const trades = runStrategy(candles, baseConfig({ roundTrip: 0.004 }));

    expect(trades).toHaveLength(1);
    const t = trades[0];
    expect(t.grossReturn).toBeCloseTo(t.exitPrice / t.entryPrice - 1, 10);
    expect(t.netReturn).toBeCloseTo(applyCost(t.grossReturn, 0.004), 10);
  });
});

describe("runStrategy — 거래는 겹치지 않는다", () => {
  it("연속된 두 거래는 다음 거래의 진입이 이전 거래의 청산보다 뒤여야 한다", () => {
    // 종가: 100,90,95,95,85,92,90
    // i=2에서 첫 크로스업(entryIndex=3). targetPct=0이면 시가<종가(우리 캔들 규약)라
    // 진입 당일 종가가 이미 목표(=진입가) 이상이라 즉시 청산(hold0, exitIndex=3).
    // 이어서 index3→4(95→85, 하락) out=0, index4→5(85→92, 상승) out=100 →
    // i=5에서 두 번째 크로스업 → entryIndex=6, 역시 즉시 청산(exitIndex=6).
    const closes = [100, 90, 95, 95, 85, 92, 90];
    const candles = closesToCandles(closes);

    const trades = runStrategy(
      candles,
      baseConfig({ targetPct: 0, stopLossPct: 0.9, maxHoldDays: 100 })
    );

    expect(trades).toHaveLength(2);
    expect(trades[0].entryIndex).toBe(3);
    expect(trades[0].exitIndex).toBe(3);
    expect(trades[1].entryIndex).toBe(6);
    expect(trades[1].exitIndex).toBe(6);

    for (let i = 1; i < trades.length; i++) {
      expect(trades[i].entryIndex).toBeGreaterThan(trades[i - 1].exitIndex);
    }
  });
});
