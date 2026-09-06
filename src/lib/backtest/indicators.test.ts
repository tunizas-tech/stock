import { describe, expect, it } from "vitest";
import { mfi, rsi, sma, volumeRatio } from "./indicators";
import type { Candle } from "../types";

/** 종가만으로 지표를 검증할 때 쓰는 최소 캔들. high=low=close=종가로 두면
 * MFI의 typical price도 그대로 종가가 되어 계산이 손으로 추적 가능해진다. */
function candle(date: string, close: number, extra: Partial<Candle> = {}): Candle {
  return { date, open: close, high: close, low: close, close, ...extra };
}

describe("rsi", () => {
  // 종가: 44,45,46,45,47,48 (period=3)
  //
  // 변화량(등락): +1,+1,-1,+2,+1 → gain: 1,1,0,2,1 / loss: 0,0,1,0,0
  //
  // 첫 평균(시드, index=period=3)은 단순평균:
  //   avgGain = (1+1+0)/3 = 2/3,  avgLoss = (0+0+1)/3 = 1/3
  //   RS = (2/3)/(1/3) = 2 → RSI = 100 - 100/(1+2) = 66.666...7
  //
  // 이후는 Wilder 평활 avg = (prevAvg*(period-1)+current)/period 로 갱신한다(단순평균 아님):
  //   index4: avgGain=(2/3*2+2)/3=10/9, avgLoss=(1/3*2+0)/3=2/9, RS=5 → RSI=100-100/6=83.333...3
  //   index5: avgGain=(10/9*2+1)/3=29/27, avgLoss=(2/9*2+0)/3=4/27, RS=7.25 → RSI=100-100/8.25=87.878787...
  const closes = [44, 45, 46, 45, 47, 48];
  const candles = closes.map((c, i) => candle(`2024-01-0${i + 1}`, c));

  it("손으로 계산한 값과 일치한다 (시드 이후 Wilder 평활이 실제로 적용된 값까지)", () => {
    const out = rsi(candles, 3);
    expect(out[3]).toBeCloseTo(66.66667, 4);
    expect(out[4]).toBeCloseTo(83.33333, 4);
    expect(out[5]).toBeCloseTo(87.87879, 4);
  });

  it("Wilder 평활은 단순이동평균과 다르다 — 같은 창을 단순평균으로 굴리면 다른 값이 나온다", () => {
    // index5의 단순평균 버전: 최근 3개 변화량(0,2,1 / 1,0,0)만 다시 평균낸 값.
    //   avgGain=(0+2+1)/3=1, avgLoss=(1+0+0)/3=1/3, RS=3 → RSI=100-100/4=75
    const naiveSma75 = 75;
    const out = rsi(candles, 3);
    expect(out[5]).not.toBeCloseTo(naiveSma75, 1);
    expect(out[5]).toBeCloseTo(87.87879, 4);
  });

  it("손실이 전혀 없으면 RSI는 100이다", () => {
    const rising = [10, 11, 12, 13, 14].map((c, i) => candle(`2024-02-0${i + 1}`, c));
    const out = rsi(rising, 3);
    expect(out[3]).toBe(100);
    expect(out[4]).toBe(100);
  });

  it("이익이 전혀 없으면 RSI는 0이다", () => {
    const falling = [14, 13, 12, 11, 10].map((c, i) => candle(`2024-03-0${i + 1}`, c));
    const out = rsi(falling, 3);
    expect(out[3]).toBe(0);
    expect(out[4]).toBe(0);
  });

  it("undefined 접두사 길이는 정확히 period다 (index=period이 첫 계산값)", () => {
    const out = rsi(candles, 3);
    expect(out.length).toBe(candles.length);
    expect(out.slice(0, 3)).toEqual([undefined, undefined, undefined]);
    expect(out[3]).not.toBeUndefined();
  });
});

describe("mfi", () => {
  // typical price(=종가, h=l=c로 둠): 10,12,12,11,13 (period=3)
  //
  // 비교(day1~day4, 전일 대비):
  //   day1: 12>10 양(+)  rmf=12*100=1200
  //   day2: 12=12 동률   → 양쪽 어디에도 안 들어간다
  //   day3: 11<12 음(-)  rmf=11*100=1100
  //   day4: 13>11 양(+)  rmf=13*100=1300
  //
  // index=3(=period) 창은 day1~day3: posSum=1200, negSum=1100
  //   MFR=1200/1100=12/11 → MFI=100-100/(1+12/11)=100-1100/23=52.173913...
  const tieCandles = [10, 12, 12, 11, 13].map((c, i) =>
    candle(`2024-04-0${i + 1}`, c, { volume: 100 })
  );

  it("동률(tie)인 날은 양쪽 어느 합에도 들어가지 않는다", () => {
    const out = mfi(tieCandles, 3);
    expect(out[3]).toBeCloseTo(52.17391, 4);

    // 동률을 양(+)으로 잘못 취급하면: posSum=1200+1200=2400, negSum=1100
    //   MFR=2400/1100 → MFI=100-100/(1+2400/1100)=68.571428...
    const buggyTieAsPositive = 68.571428;
    expect(out[3]).not.toBeCloseTo(buggyTieAsPositive, 1);
  });

  it("다음 값(index=4)도 손으로 확인한 값과 일치한다", () => {
    // index=4 창은 day2~day4: day2(동률, 제외) + day3(음, 1100) + day4(양, 1300)
    //   MFR=1300/1100 → MFI=100-1100/24=54.166666...
    const out = mfi(tieCandles, 3);
    expect(out[4]).toBeCloseTo(54.16667, 4);
  });

  it("창 안에 거래량 결측 캔들이 있으면 그 창의 MFI는 undefined다", () => {
    const tp = [10, 12, 11, 13, 12, 14];
    const volumes: (number | undefined)[] = [100, 100, undefined, 100, 100, 100];
    const candles = tp.map((c, i) =>
      candle(`2024-05-0${i + 1}`, c, { volume: volumes[i] })
    );

    const out = mfi(candles, 3);

    // index3 창(1~3)과 index4 창(2~4)은 index2(거래량 결측)를 포함하므로 undefined.
    expect(out[3]).toBeUndefined();
    expect(out[4]).toBeUndefined();
    // index5 창(3~5)은 index2를 벗어나므로 다시 계산 가능해야 한다(0으로 취급하지 않았다는 증거).
    expect(out[5]).not.toBeUndefined();
  });

  it("undefined 접두사 길이는 정확히 period다", () => {
    const out = mfi(tieCandles, 3);
    expect(out.length).toBe(tieCandles.length);
    expect(out.slice(0, 3)).toEqual([undefined, undefined, undefined]);
    expect(out[3]).not.toBeUndefined();
  });
});

describe("sma", () => {
  it("period개가 모이기 전까지는 undefined, 이후는 단순평균이다", () => {
    const out = sma([1, 2, 3, 4, 5], 3);
    expect(out).toEqual([
      undefined,
      undefined,
      2, // (1+2+3)/3
      3, // (2+3+4)/3
      4, // (3+4+5)/3
    ]);
  });
});

describe("volumeRatio", () => {
  it("오늘 거래량은 기준(직전 period일 평균)에서 제외한다", () => {
    // index3 직전 3일 거래량: 10,10,10 → 평균 10. 오늘(index3)=100 → 비율=10.
    // 오늘을 기준에 포함시키면(버그): 평균(10,10,100)=40 → 비율=100/40=2.5로 크게 달라진다.
    const candles = [10, 10, 10, 100, 10].map((v, i) =>
      candle(`2024-06-0${i + 1}`, 100, { volume: v })
    );

    const out = volumeRatio(candles, 3);

    expect(out[3]).toBe(10);
    expect(out[3]).not.toBeCloseTo(2.5, 1);
  });

  it("창에 거래량 결측이 있거나 평균이 0이면 undefined다", () => {
    const withMissing = [10, undefined, 10, 100].map((v, i) =>
      candle(`2024-07-0${i + 1}`, 100, { volume: v })
    );
    expect(volumeRatio(withMissing, 3)[3]).toBeUndefined();

    const zeroMean = [0, 0, 0, 50].map((v, i) =>
      candle(`2024-08-0${i + 1}`, 100, { volume: v })
    );
    expect(volumeRatio(zeroMean, 3)[3]).toBeUndefined();
  });

  it("undefined 접두사 길이는 정확히 period다", () => {
    const candles = [10, 10, 10, 100, 10].map((v, i) =>
      candle(`2024-09-0${i + 1}`, 100, { volume: v })
    );
    const out = volumeRatio(candles, 3);
    expect(out.slice(0, 3)).toEqual([undefined, undefined, undefined]);
    expect(out[3]).not.toBeUndefined();
  });
});

describe("순수성 — 같은 입력을 두 번 넣어도 같은 결과, 입력은 변형하지 않는다", () => {
  const closes = [44, 45, 46, 45, 47, 48];
  const candles = closes.map((c, i) => candle(`2024-01-0${i + 1}`, c, { volume: 100 }));
  const candlesSnapshot = JSON.parse(JSON.stringify(candles));
  const values = [1, 2, 3, 4, 5];
  const valuesSnapshot = [...values];

  it("rsi는 순수함수이고 입력을 변형하지 않는다", () => {
    const a = rsi(candles, 3);
    const b = rsi(candles, 3);
    expect(a).toEqual(b);
    expect(candles).toEqual(candlesSnapshot);
  });

  it("mfi는 순수함수이고 입력을 변형하지 않는다", () => {
    const a = mfi(candles, 3);
    const b = mfi(candles, 3);
    expect(a).toEqual(b);
    expect(candles).toEqual(candlesSnapshot);
  });

  it("sma는 순수함수이고 입력을 변형하지 않는다", () => {
    const a = sma(values, 3);
    const b = sma(values, 3);
    expect(a).toEqual(b);
    expect(values).toEqual(valuesSnapshot);
  });

  it("volumeRatio는 순수함수이고 입력을 변형하지 않는다", () => {
    const a = volumeRatio(candles, 3);
    const b = volumeRatio(candles, 3);
    expect(a).toEqual(b);
    expect(candles).toEqual(candlesSnapshot);
  });
});
