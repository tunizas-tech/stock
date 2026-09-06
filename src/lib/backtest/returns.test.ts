import { describe, expect, it } from "vitest";
import { decompose, holdReturn } from "./returns";
import type { Candle } from "../types";

const c = (date: string, open: number, close: number): Candle => ({
  date,
  open,
  high: Math.max(open, close),
  low: Math.min(open, close),
  close,
});

describe("decompose", () => {
  const candles = [
    c("2025-01-02", 100, 100),
    c("2025-01-03", 110, 121), // 갭 +10%, 장중 +10%
    c("2025-01-06", 121, 108.9), // 갭 0%, 장중 -10%
  ];

  it("첫 캔들은 직전 종가가 없으므로 결과에 넣지 않는다", () => {
    expect(decompose(candles).map((r) => r.date)).toEqual([
      "2025-01-03",
      "2025-01-06",
    ]);
  });

  it("갭은 시가/직전 종가, 장중은 종가/시가다", () => {
    const [first] = decompose(candles);
    expect(first.gap).toBeCloseTo(0.1, 10);
    expect(first.intraday).toBeCloseTo(0.1, 10);
  });

  it("갭과 장중을 곱하면 종가-종가가 된다", () => {
    for (const r of decompose(candles)) {
      expect((1 + r.gap) * (1 + r.intraday)).toBeCloseTo(1 + r.closeToClose, 10);
    }
  });

  it("장중이 마이너스면 종가-종가도 그만큼 깎인다", () => {
    const [, second] = decompose(candles);
    expect(second.gap).toBeCloseTo(0, 10);
    expect(second.intraday).toBeCloseTo(-0.1, 10);
    expect(second.closeToClose).toBeCloseTo(-0.1, 10);
  });
});

describe("holdReturn", () => {
  const candles = [
    c("2025-01-02", 100, 100),
    c("2025-01-03", 100, 105),
    c("2025-01-06", 105, 110),
    c("2025-01-07", 110, 120),
  ];

  it("진입일 시가에 사서 N거래일 뒤 종가에 판 수익을 낸다", () => {
    // index 1 시가 100 → index 2 종가 110
    expect(holdReturn(candles, 1, 1)).toBeCloseTo(0.1, 10);
  });

  it("보유 기간이 데이터 끝을 넘으면 undefined를 낸다", () => {
    expect(holdReturn(candles, 3, 5)).toBeUndefined();
  });
});
