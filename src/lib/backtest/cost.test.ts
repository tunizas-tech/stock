import { describe, expect, it } from "vitest";
import { DEFAULT_ROUND_TRIP, applyCost, annualCost } from "./cost";

describe("applyCost", () => {
  it("기본 왕복 비용은 0.4%다", () => {
    expect(DEFAULT_ROUND_TRIP).toBe(0.004);
  });

  it("총수익에서 왕복 비용을 곱셈으로 뺀다", () => {
    // (1 + 0.02) * (1 - 0.004) - 1
    expect(applyCost(0.02)).toBeCloseTo(0.015920, 6);
  });

  it("손실이어도 비용은 그대로 더 빠진다", () => {
    expect(applyCost(-0.02)).toBeCloseTo(-0.023920, 6);
  });

  it("비용을 0으로 주면 총수익 그대로다", () => {
    expect(applyCost(0.05, 0)).toBeCloseTo(0.05, 10);
  });
});

describe("annualCost", () => {
  it("왕복 0.4%로 연 50회 매매하면 연 18% 남짓이 비용으로 나간다", () => {
    // 복리이므로 0.004 * 50 = 0.2 가 아니라 1 - 0.996^50 = 0.1816 이다.
    expect(annualCost(0.004, 50)).toBeCloseTo(0.1816, 3);
  });

  it("매매를 안 하면 비용도 0이다", () => {
    expect(annualCost(0.004, 0)).toBeCloseTo(0, 10);
  });
});
