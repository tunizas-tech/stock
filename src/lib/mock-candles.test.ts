import { describe, expect, it } from "vitest";
import { mockCandles } from "./mock-candles";

// 결정론적 mock 캔들 — 키 없거나 조회 실패 시 차트 폴백.
// 마지막 종가를 앵커로 뒤로 random walk. 같은 인자 → 같은 시리즈.

const END = "2026-07-15";

describe("mockCandles", () => {
  it("기간별 개수: 일봉 90, 주봉 104, 월봉 60", () => {
    expect(mockCandles("KR:005930", "D", END, 71900)).toHaveLength(90);
    expect(mockCandles("KR:005930", "W", END, 71900)).toHaveLength(104);
    expect(mockCandles("KR:005930", "M", END, 71900)).toHaveLength(60);
  });

  it("같은 인자면 같은 시리즈를 돌려준다 (결정론)", () => {
    const a = mockCandles("US:AAPL", "D", END, 200);
    const b = mockCandles("US:AAPL", "D", END, 200);
    expect(a).toEqual(b);
  });

  it("마지막 캔들의 종가는 앵커 가격이다", () => {
    const candles = mockCandles("KR:005930", "D", END, 71900);
    expect(candles[candles.length - 1].close).toBe(71900);
  });

  it("날짜는 과거→현재 오름차순이다", () => {
    const candles = mockCandles("IDX:KOSPI", "W", END, 2700);
    for (let i = 1; i < candles.length; i++) {
      expect(candles[i].date > candles[i - 1].date).toBe(true);
    }
  });

  it("OHLC 불변식: high ≥ max(open,close), low ≤ min(open,close)", () => {
    for (const c of mockCandles("US:NVDA", "M", END, 120)) {
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
      expect(c.low).toBeGreaterThan(0);
    }
  });

  it("일봉 날짜는 주말을 건너뛴다", () => {
    for (const c of mockCandles("KR:005930", "D", END, 71900)) {
      const day = new Date(`${c.date}T00:00:00Z`).getUTCDay();
      expect(day).toBeGreaterThanOrEqual(1);
      expect(day).toBeLessThanOrEqual(5);
    }
  });
});
