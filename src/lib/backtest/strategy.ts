// RSI·MFI 과매도 탈출 전략의 진입·청산 판정과 포지션 시뮬레이션.
//
// 스테이지 1·2는 매일 진입해 보유 구간이 겹치는 실험이라 MDD를 낼 수 없었다. 여기서는
// 정확히 반대로 만든다 — 포지션은 한 번에 하나만 잡고, 보유 중에는 새 신호를 무시한다.
// 그래야 거래가 순차·비중첩이 되어 누적 곡선의 MDD가 실제 계좌가 겪는 값이 된다.
//
// 진입은 신호 다음날 시가, 청산은 조건 충족일 종가로 잡는다. 신호 당일 종가로 사는
// 것은 그날 종가를 보고 그날 종가에 사는 것이므로 실행 불가능한 미래 정보 사용이다.

import type { Candle } from "../types";
import { applyCost } from "./cost";
import { mfi, rsi, sma, volumeRatio } from "./indicators";

export type EntrySignal = "rsi" | "mfi" | "both";

export interface StrategyConfig {
  entry: EntrySignal;
  rsiPeriod: number; // 기본 14
  rsiThreshold: number; // 기본 30
  mfiPeriod: number; // 기본 14
  mfiThreshold: number; // 기본 20
  trendFilter: boolean; // true면 close > SMA(trendPeriod) 인 날만 진입
  trendPeriod: number; // 기본 200
  minVolumeRatio?: number; // 설정 시 거래량비가 이 값 이상일 때만 진입
  stopLossPct: number; // 0.10 = -10%
  targetPct: number; // 0.15 = +15%
  rsiExitLevel?: number; // 설정 시 RSI가 이 값 이상이면 청산 (기본 70 상당)
  maxHoldDays: number; // 시간 청산
  roundTrip: number; // 왕복 비용
}

export type ExitReason = "stop" | "target" | "rsi" | "time" | "end";

export interface Trade {
  entryDate: string;
  entryIndex: number;
  entryPrice: number; // 진입일 시가
  exitDate: string;
  exitIndex: number;
  exitPrice: number; // 청산일 종가
  holdDays: number;
  grossReturn: number; // 비용 전
  netReturn: number; // 비용 후
  exitReason: ExitReason;
}

/** 거래량비 기본 창(20일)은 지표 모듈·설계 문서와 동일하게 고정값을 쓴다.
 * StrategyConfig에 별도 필드를 두지 않은 이유는 이 값이 사용자가 튜닝하는
 * 파라미터가 아니라 "거래량 확인"이라는 개념 자체의 정의이기 때문이다. */
const VOLUME_RATIO_PERIOD = 20;

/** 직전값 < threshold, 당일값 >= threshold일 때만 크로스업이다. 둘 중 하나라도
 * undefined면(기간 미달) 신호로 취급하지 않는다 — undefined를 0처럼 취급하면
 * 계산이 아직 안 된 자리를 "과매도 탈출"로 오판하게 된다. */
function crossedUp(
  values: (number | undefined)[],
  i: number,
  threshold: number
): boolean {
  const prev = values[i - 1];
  const curr = values[i];
  if (prev === undefined || curr === undefined) return false;
  return prev < threshold && curr >= threshold;
}

function hasEntrySignal(
  i: number,
  config: StrategyConfig,
  rsiValues: (number | undefined)[],
  mfiValues: (number | undefined)[]
): boolean {
  const rsiUp = crossedUp(rsiValues, i, config.rsiThreshold);
  const mfiUp = crossedUp(mfiValues, i, config.mfiThreshold);
  if (config.entry === "rsi") return rsiUp;
  if (config.entry === "mfi") return mfiUp;
  return rsiUp && mfiUp; // "both" — 같은 날 둘 다 크로스업
}

/** 필터는 신호일(i) 기준으로 판정한다 — 진입일(i+1)이 아니다. 진입 여부를 결정하는
 * 것은 "신호가 발생한 그 순간의 상황"이지, 하루 지나 시가가 열린 뒤의 상황이 아니다. */
function passesFilters(
  i: number,
  config: StrategyConfig,
  candles: Candle[],
  smaValues: (number | undefined)[] | undefined,
  volRatios: (number | undefined)[] | undefined
): boolean {
  if (config.trendFilter) {
    const s = smaValues?.[i];
    if (s === undefined || candles[i].close <= s) return false;
  }
  if (config.minVolumeRatio !== undefined) {
    const vr = volRatios?.[i];
    if (vr === undefined || vr < config.minVolumeRatio) return false;
  }
  return true;
}

function buildTrade(
  candles: Candle[],
  entryIndex: number,
  exitIndex: number,
  exitReason: ExitReason,
  config: StrategyConfig
): Trade {
  const entryCandle = candles[entryIndex];
  const exitCandle = candles[exitIndex];
  const entryPrice = entryCandle.open;
  const exitPrice = exitCandle.close;
  const grossReturn = exitPrice / entryPrice - 1;

  return {
    entryDate: entryCandle.date,
    entryIndex,
    entryPrice,
    exitDate: exitCandle.date,
    exitIndex,
    exitPrice,
    holdDays: exitIndex - entryIndex,
    grossReturn,
    netReturn: applyCost(grossReturn, config.roundTrip),
    exitReason,
  };
}

/**
 * 진입일부터 매일 종가로 청산 조건을 검사한다. 우선순위는 손절 → 목표 → RSI → 시간이며,
 * 그날 여럿이 동시에 성립해도 이 순서로 하나만 고른다. 데이터가 떨어지면 마지막 종가로
 * 강제 청산(end)한다.
 *
 * holdDays 규약: 진입일 자신이 0일차이고, 청산 조건은 0일차(진입일 자신의 종가)부터
 * 검사한다. 진입은 시가에 이뤄지므로 그날 종가로 손절·목표를 재는 것은 "장중 변동을
 * 반영한 당일 청산"이며 미래 정보가 아니다 — 오히려 진입 다음날부터 검사를 시작하면
 * 시가 대비 그날 종가 급락(손절)·급등(목표)을 놓치게 된다.
 *
 * runStrategy와 randomEntries가 이 함수 하나를 공유한다 — "진입을 어떻게 고르느냐"만
 * 다르고 "일단 들어간 뒤 어떻게 나오느냐"는 완전히 같은 규칙이어야 하기 때문이다.
 */
export function simulateExit(
  candles: Candle[],
  entryIndex: number,
  config: StrategyConfig,
  rsiValues: (number | undefined)[]
): Trade {
  const entryPrice = candles[entryIndex].open;
  const stopPrice = entryPrice * (1 - config.stopLossPct);
  const targetPrice = entryPrice * (1 + config.targetPct);

  for (let day = entryIndex; day < candles.length; day++) {
    const holdDays = day - entryIndex;
    const close = candles[day].close;

    if (close <= stopPrice) return buildTrade(candles, entryIndex, day, "stop", config);
    if (close >= targetPrice) return buildTrade(candles, entryIndex, day, "target", config);
    if (config.rsiExitLevel !== undefined) {
      const r = rsiValues[day];
      if (r !== undefined && r >= config.rsiExitLevel) {
        return buildTrade(candles, entryIndex, day, "rsi", config);
      }
    }
    if (holdDays >= config.maxHoldDays) {
      return buildTrade(candles, entryIndex, day, "time", config);
    }
  }

  // 루프가 조건 없이 끝났다는 건 데이터가 보유 중에 떨어졌다는 뜻 — 마지막 종가로 청산.
  return buildTrade(candles, entryIndex, candles.length - 1, "end", config);
}

export function runStrategy(candles: Candle[], config: StrategyConfig): Trade[] {
  const n = candles.length;
  const trades: Trade[] = [];
  if (n < 2) return trades;

  const rsiValues = rsi(candles, config.rsiPeriod);
  const mfiValues = mfi(candles, config.mfiPeriod);
  const smaValues = config.trendFilter
    ? sma(candles.map((c) => c.close), config.trendPeriod)
    : undefined;
  const volRatios =
    config.minVolumeRatio !== undefined
      ? volumeRatio(candles, VOLUME_RATIO_PERIOD)
      : undefined;

  // i는 "신호일" 후보다. i-1이 필요하므로 1부터 시작한다.
  // 거래를 찾으면 i를 그 거래의 청산일 다음날로 건너뛴다 — 이 점프 자체가 "보유 중
  // 신호 무시"를 강제한다. 건너뛴 구간의 i는 애초에 신호 후보로 검사되지 않으므로,
  // 두 거래가 겹치는 경우는 이 루프 구조상 존재할 수 없다.
  let i = 1;
  while (i < n) {
    if (
      hasEntrySignal(i, config, rsiValues, mfiValues) &&
      passesFilters(i, config, candles, smaValues, volRatios)
    ) {
      const entryIndex = i + 1;
      if (entryIndex < n) {
        const trade = simulateExit(candles, entryIndex, config, rsiValues);
        trades.push(trade);
        i = trade.exitIndex + 1;
        continue;
      }
      // entryIndex가 데이터 끝을 넘으면(신호가 마지막 캔들에서 남) 진입할 다음날이
      // 없으므로 거래를 만들지 않는다.
    }
    i++;
  }

  return trades;
}
