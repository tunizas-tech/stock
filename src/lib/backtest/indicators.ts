// 3단계(RSI·MFI 과매도 탈출 전략) 진입 판정에 쓰는 순수 지표 계산.
//
// 이 모듈이 없으면 전략 로직마다 지표 계산을 다시 구현하게 되고, 그 과정에서
// RSI의 Wilder 평활을 단순이동평균으로 잘못 구현하는 실수가 가장 흔하다 — 둘은 초기 몇 개
// 값만 비슷하고 이후로는 다른 숫자를 낸다(indicators.test.ts가 그 차이를 못박는다).
// 여기서 한 번만 맞게 만들고, 전략·벤치마크는 이 결과를 그대로 소비한다.
//
// 모든 함수는 입력 배열과 나란한(parallel) 배열을 반환한다. 계산에 필요한 기간이
// 안 찼거나 그 창에 결측값이 있는 자리는 0이 아니라 `undefined`로 남긴다 — 0으로 채우면
// "지표가 낮다"와 "아직 계산 불가"를 구분할 수 없게 되어 전략이 없는 신호를 있는 것처럼
// 오판하게 된다.

import type { Candle } from "../types";

/** avgLoss가 0이면 RS가 Infinity로 발산하는데, 그 값이 그대로 100-100/(1+Infinity)=100으로
 * 굴러떨어지긴 하지만 부동소수점 특수값에 기대는 대신 의도를 명시적으로 드러낸다. */
function rsFormula(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Wilder RSI. index 0..period-1은 `undefined`, index=period이 첫 계산값이다.
 *
 * 첫 평균(시드)만 단순평균이고, 그 이후는 전부
 *   avg = (prevAvg * (period - 1) + current) / period
 * 로 갱신한다(Wilder 평활). 매번 최근 period개를 다시 단순평균 내는 방식(SMA 기반 RSI)과는
 * 다른 숫자가 나온다 — 후자는 흔한 오구현이며 시드 이후 값이 어긋난다.
 */
export function rsi(candles: Candle[], period = 14): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(candles.length).fill(undefined);
  if (candles.length <= period) return out;

  // gains[k]/losses[k]는 candles[k] → candles[k+1]로의 변화량이다.
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    gains.push(Math.max(change, 0));
    losses.push(Math.max(-change, 0));
  }

  let avgGain = 0;
  let avgLoss = 0;
  for (let k = 0; k < period; k++) {
    avgGain += gains[k];
    avgLoss += losses[k];
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = rsFormula(avgGain, avgLoss);

  for (let k = period; k < gains.length; k++) {
    avgGain = (avgGain * (period - 1) + gains[k]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[k]) / period;
    out[k + 1] = rsFormula(avgGain, avgLoss);
  }

  return out;
}

/**
 * Money Flow Index. RSI와 같은 undefined 접두사 규약(index=period이 첫 값)을 쓰지만,
 * 평활 방식은 단순 이동창(rolling window)이다 — Wilder 평활과 섞지 않는다.
 *
 * 동률(전일과 typical price가 같은 날)은 양(+)에도 음(-)에도 넣지 않는다. 동률을 양으로
 * 잘못 넣으면 상승 압력을 부풀리게 된다.
 *
 * 창에 속한 캔들 중 하나라도 거래량이 없으면 그 창은 `undefined`다. 거래량 결측을 0으로
 * 취급하면 "거래가 없었다"는 거짓 신호가 되어 MFI가 조용히 틀린 숫자를 낸다.
 */
export function mfi(candles: Candle[], period = 14): (number | undefined)[] {
  const n = candles.length;
  const out: (number | undefined)[] = new Array(n).fill(undefined);
  if (n <= period) return out;

  const tp = candles.map((c) => (c.high + c.low + c.close) / 3);

  // posFlow[i]/negFlow[i]는 candles[i-1] → candles[i] 비교 결과. index 0은 비교 대상이 없다.
  const posFlow: number[] = new Array(n).fill(0);
  const negFlow: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const rmf = tp[i] * (candles[i].volume ?? 0);
    if (tp[i] > tp[i - 1]) posFlow[i] = rmf;
    else if (tp[i] < tp[i - 1]) negFlow[i] = rmf;
    // tp[i] === tp[i-1] (동률)이면 posFlow·negFlow 둘 다 0으로 남아 어느 합에도 안 들어간다.
  }

  for (let i = period; i < n; i++) {
    const start = i - period + 1; // 비교 period개: candles[start..i]
    let missingVolume = false;
    for (let j = start; j <= i; j++) {
      if (candles[j].volume === undefined) {
        missingVolume = true;
        break;
      }
    }
    if (missingVolume) continue;

    let sumPos = 0;
    let sumNeg = 0;
    for (let j = start; j <= i; j++) {
      sumPos += posFlow[j];
      sumNeg += negFlow[j];
    }
    out[i] = sumNeg === 0 ? 100 : 100 - 100 / (1 + sumPos / sumNeg);
  }

  return out;
}

/** 단순 이동평균. period개 값이 모이기 전(index < period-1)까지는 `undefined`다. */
export function sma(values: number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * 당일 거래량 ÷ 직전 period일(당일 제외) 평균 거래량.
 *
 * 당일을 기준 평균에 포함시키면 급증 자체가 평균을 끌어올려 비율을 낮추므로, 정작
 * 잡아내려는 거래량 스파이크를 스스로 희석시킨다 — 그래서 반드시 "직전" period일만 쓴다.
 * 기준 창에 결측 거래량이 있거나 평균이 0이면 `undefined`다.
 */
export function volumeRatio(candles: Candle[], period = 20): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(candles.length).fill(undefined);

  for (let i = period; i < candles.length; i++) {
    const todayVolume = candles[i].volume;
    if (todayVolume === undefined) continue;

    let sum = 0;
    let missing = false;
    for (let j = i - period; j < i; j++) {
      const v = candles[j].volume;
      if (v === undefined) {
        missing = true;
        break;
      }
      sum += v;
    }
    if (missing) continue;

    const mean = sum / period;
    if (mean === 0) continue;
    out[i] = todayVolume / mean;
  }

  return out;
}
