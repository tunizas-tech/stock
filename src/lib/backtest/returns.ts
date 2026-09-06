// 하루 수익을 세 구간으로 나눈다.
//
//   갭        = 시가(t) / 종가(t-1) - 1   미국장 반응이 개장가에 이미 반영된 몫
//   장중      = 종가(t) / 시가(t)   - 1   매매로 취할 수 있는 유일한 구간
//   종가-종가 = 종가(t) / 종가(t-1) - 1   갭 + 장중
//
// 종가-종가만 보면 상관이 높게 나오는데, 그 일치가 전부 갭 안에 있으면 시초가 매수로는
// 아무것도 얻지 못한다. 그래서 셋을 따로 낸다.

import type { Candle } from "../types";

export interface DayReturn {
  date: string;
  gap: number;
  intraday: number;
  closeToClose: number;
}

/** 입력은 날짜 오름차순을 가정한다. 첫 캔들은 직전 종가가 없어 제외된다. */
export function decompose(candles: Candle[]): DayReturn[] {
  const out: DayReturn[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const cur = candles[i];
    out.push({
      date: cur.date,
      gap: cur.open / prev.close - 1,
      intraday: cur.close / cur.open - 1,
      closeToClose: cur.close / prev.close - 1,
    });
  }
  return out;
}

/**
 * entryIndex일 시가에 사서 days거래일 뒤 종가에 판 총수익(비용 미반영).
 * 데이터 끝을 넘으면 undefined — 표본에서 빼야 한다.
 */
export function holdReturn(
  candles: Candle[],
  entryIndex: number,
  days: number
): number | undefined {
  const exit = candles[entryIndex + days];
  const entry = candles[entryIndex];
  if (!exit || !entry) return undefined;
  return exit.close / entry.open - 1;
}
