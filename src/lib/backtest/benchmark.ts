// 매수후보유·무작위 진입 벤치마크.
//
// "매수후보유"는 가장 중요한 비교 대상이다 — 16년간 크게 오른 자산에서, 연 수십 회
// 매매하며 비용을 무는 전략이 이것을 못 이기면 규칙 자체를 쓸 이유가 없다.
// "무작위 진입"은 같은 청산 규칙을 그대로 쓰되 진입일만 무작위로 골라, 진입 신호
// 자체가 기여하는지("아무 날에나 들어가도 비슷하지 않은가?")를 답한다.
//
// 두 벤치마크 모두 strategy.ts의 simulateExit를 그대로 쓴다 — 청산 규칙과
// 한 번에 하나만 보유한다는 제약을 여기서 다시 구현하면, 세 결과(전략·무작위·매수후보유
// 중 청산 로직이 겹치는 둘)가 미묘하게 다른 규칙으로 갈라질 위험이 생긴다.

import type { Candle } from "../types";
import { applyCost } from "./cost";
import { rsi } from "./indicators";
import { simulateExit, type StrategyConfig, type Trade } from "./strategy";

export interface BuyHoldResult {
  entryDate: string;
  exitDate: string;
  grossReturn: number;
  netReturn: number;
  days: number;
}

/** 첫 캔들 시가에 사서 마지막 캔들 종가에 판다. 왕복 비용 1회. */
export function buyAndHold(candles: Candle[], roundTrip: number): BuyHoldResult {
  const first = candles[0];
  const last = candles[candles.length - 1];
  const grossReturn = last.close / first.open - 1;

  return {
    entryDate: first.date,
    exitDate: last.date,
    grossReturn,
    netReturn: applyCost(grossReturn, roundTrip),
    days: candles.length - 1,
  };
}

/**
 * mulberry32 — 32비트 상태만으로 굴러가는 결정론적 PRNG. Math.random은 시드를 못 박을
 * 수 없어 "같은 시드면 같은 결과"라는 재현성 요구를 만족시키지 못한다. 통계적 품질이
 * 필요한 자리가 아니라 "무작위처럼 흩어지되 재현 가능"하면 충분한 자리이므로, 암호학적
 * 강도가 없는 이 정도로 충분하다.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * count개의 진입일을 [2, n) 구간에서 균등 무작위로 뽑은 뒤, 시간순으로 정렬해
 * strategy.ts와 같은 "한 번에 하나만 보유" 제약으로 청산까지 시뮬레이션한다.
 *
 * 하한이 0이 아니라 2인 이유: runStrategy의 신호 스캔은 `crossedUp`이 i-1을 봐야
 * 해서 i=1부터 시작하고, 진입은 i+1이므로 전략이 도달할 수 있는 entryIndex의
 * 구조적 최솟값은 2다(strategy.ts의 신호 루프 참고). 무작위 벤치마크가 0·1도
 * 뽑을 수 있게 두면, "신호가 무작위보다 나은가"를 비교할 때 두 표본이 애초에
 * 다른 인덱스 구간에서 뽑힌 셈이 되어 비교 자체가 오염된다 — 지금 데이터에서는
 * 그 두 인덱스가 지표 워밍업 구간에 묻혀 영향이 없더라도, 두 표본의 정의역이
 * 다르다는 사실 자체가 문제다. 전략의 스캔 시작 지점이 바뀌면 이 하한도 같이
 * 맞춰야 한다.
 *
 * 뽑은 날짜 중 이전 거래의 청산일 이전(또는 그 안)에 걸리는 것은 건너뛴다 — 다시
 * 뽑지 않는다. 그래서 겹침이 많은 시드는 count보다 적은 거래를 낼 수 있고, 그 개수
 * 자체가 호출자에게 드러나는 정보다(설계 문서 §5).
 */
export function randomEntries(
  candles: Candle[],
  count: number,
  config: StrategyConfig,
  seed: number
): Trade[] {
  const n = candles.length;
  const trades: Trade[] = [];
  const MIN_ENTRY_INDEX = 2; // strategy.ts의 구조적 최소 entryIndex(i=1부터 스캔, 진입은 i+1)와 동기화
  if (n <= MIN_ENTRY_INDEX) return trades; // 유효한 진입 구간이 없다

  const rsiValues = rsi(candles, config.rsiPeriod);
  const rand = mulberry32(seed);

  const candidates: number[] = [];
  for (let k = 0; k < count; k++) {
    candidates.push(MIN_ENTRY_INDEX + Math.floor(rand() * (n - MIN_ENTRY_INDEX)));
  }
  candidates.sort((a, b) => a - b);

  let nextAvailable = 0;
  for (const day of candidates) {
    if (day < nextAvailable) continue; // 이전 거래 보유 중 — 건너뛰고 다시 뽑지 않는다
    const trade = simulateExit(candles, day, config, rsiValues);
    trades.push(trade);
    nextAvailable = trade.exitIndex + 1;
  }

  return trades;
}
