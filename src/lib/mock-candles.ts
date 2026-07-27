// 결정론적 mock 캔들 — 키가 없거나 기간별시세 조회가 실패할 때의 차트 폴백.
// 마지막 종가(앵커)에서 뒤로 random walk. 같은 인자면 항상 같은 시리즈.

import { mockQuote, seededUnit } from "./mock-quotes";
import { todayISO } from "./format";
import type { Candle, Market, Period } from "./types";

const COUNT: Record<Period, number> = { D: 90, W: 104, M: 60 };
const VOLATILITY: Record<Period, number> = { D: 0.02, W: 0.04, M: 0.07 };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** end(YYYY-MM-DD)에서 뒤로 count개의 봉 날짜를 만든다 — 오름차순 반환. */
function datesBack(end: string, period: Period, count: number): string[] {
  const d = new Date(`${end}T00:00:00Z`);
  if (period === "D") {
    // 주말이면 금요일로 당긴다
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
      d.setUTCDate(d.getUTCDate() - 1);
    }
  }
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(d.toISOString().slice(0, 10));
    if (period === "D") {
      do {
        d.setUTCDate(d.getUTCDate() - 1);
      } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
    } else if (period === "W") {
      d.setUTCDate(d.getUTCDate() - 7);
    } else {
      d.setUTCDate(1); // 월 경계 오버플로 방지
      d.setUTCMonth(d.getUTCMonth() - 1);
    }
  }
  return out.reverse();
}

// mock 지수 앵커 — 실데이터 없이도 그럴듯한 수준 (KIS 지수 코드 기준)
const INDEX_MOCK_BASE: Record<string, number> = {
  "0001": 2700, // 코스피
  "1001": 870, // 코스닥
  SPX: 5600,
  COMP: 18200,
  ".DJI": 39500,
};

/** 서버 라우트·클라이언트 폴백 공용 — 종목은 mock 시세, 지수는 앵커표 기준으로 생성. */
export function mockCandlesFor(
  kind: "stock" | "index",
  market: Market,
  code: string,
  period: Period
): Candle[] {
  const anchor =
    kind === "stock"
      ? mockQuote(code, market).price
      : INDEX_MOCK_BASE[code] ?? 1000;
  const key = kind === "stock" ? `${market}:${code}` : `IDX:${code}`;
  return mockCandles(key, period, todayISO(), anchor);
}

export function mockCandles(
  key: string,
  period: Period,
  end: string,
  lastClose: number
): Candle[] {
  const count = COUNT[period];
  const vol = VOLATILITY[period];
  const dates = datesBack(end, period, count);

  // 마지막 종가에서 뒤로 걸어가며 종가 시리즈 생성(인덱스는 오름차순 기준)
  const closes = new Array<number>(count);
  closes[count - 1] = lastClose;
  for (let i = count - 2; i >= 0; i--) {
    const r = (seededUnit(`${key}:${period}:${i}`) - 0.5) * 2 * vol;
    closes[i] = closes[i + 1] / (1 + r);
  }

  return dates.map((date, i) => {
    const close = round2(closes[i]);
    const open = round2(i === 0 ? closes[0] : closes[i - 1]);
    const wick = vol * 0.5;
    const high = round2(
      Math.max(open, close) * (1 + seededUnit(`${key}:${period}:${i}:h`) * wick)
    );
    const low = round2(
      Math.min(open, close) * (1 - seededUnit(`${key}:${period}:${i}:l`) * wick)
    );
    return { date, open, high, low, close };
  });
}
