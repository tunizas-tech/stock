import { describe, expect, it } from "vitest";
import { summarize, compare } from "./stats";

describe("summarize", () => {
  it("표본 수·승률·평균을 낸다", () => {
    const s = summarize([0.1, -0.05, 0.2, -0.05]);
    expect(s.n).toBe(4);
    expect(s.winRate).toBeCloseTo(0.5, 10);
    expect(s.mean).toBeCloseTo(0.05, 10);
  });

  it("손익비는 평균이익 나누기 평균손실 절대값이다", () => {
    // 이익 평균 0.15, 손실 평균 절대값 0.05
    expect(summarize([0.1, -0.05, 0.2, -0.05]).payoff).toBeCloseTo(3, 10);
  });

  it("MDD는 누적 곡선의 최대 낙폭을 양수로 낸다", () => {
    // 1 → 1.5 → 0.75 : 고점 1.5 대비 0.75이므로 -50%
    expect(summarize([0.5, -0.5]).mdd).toBeCloseTo(0.5, 10);
  });

  it("계속 오르기만 하면 MDD는 0이다", () => {
    expect(summarize([0.1, 0.1, 0.1]).mdd).toBeCloseTo(0, 10);
  });

  it("손실이 없으면 손익비는 Infinity다", () => {
    expect(summarize([0.1, 0.2]).payoff).toBe(Infinity);
  });

  it("이익이 없고 손실만 있으면 손익비는 NaN이다", () => {
    expect(summarize([-0.1, -0.2]).payoff).toBeNaN();
  });

  it("빈 입력이면 표본 0에 나머지는 0이다", () => {
    expect(summarize([])).toEqual({
      n: 0,
      winRate: 0,
      mean: 0,
      payoff: 0,
      mdd: 0,
    });
  });
});

describe("compare", () => {
  it("신호와 대조군의 평균·승률 차이를 낸다", () => {
    const out = compare([0.1, 0.1, -0.05], [0.0, 0.0, -0.05]);
    expect(out.signal.n).toBe(3);
    expect(out.control.n).toBe(3);
    // signal: mean = (0.1+0.1-0.05)/3 = 0.05, winRate = 2/3
    // control: mean = (0+0-0.05)/3 = -1/60, winRate = 0
    // deltaMean = 0.05 - (-1/60) = 1/15, deltaWinRate = 2/3 - 0 = 2/3
    expect(out.deltaMean).toBeCloseTo(1 / 15, 10);
    expect(out.deltaWinRate).toBeCloseTo(2 / 3, 10);
  });
});
