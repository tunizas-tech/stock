import { describe, expect, it } from "vitest";
import { pearson, rollingCorr } from "./transfer";

describe("pearson", () => {
  it("완전히 같이 움직이면 1이다", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
  });

  it("정반대로 움직이면 -1이다", () => {
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 10);
  });

  it("한쪽이 전혀 변하지 않으면 0을 낸다", () => {
    expect(pearson([1, 2, 3], [5, 5, 5])).toBe(0);
  });

  it("표본이 2개 미만이면 0을 낸다", () => {
    expect(pearson([1], [2])).toBe(0);
  });

  it("길이가 다르면 던진다", () => {
    expect(() => pearson([1, 2], [1])).toThrow();
  });
});

describe("rollingCorr", () => {
  const dates = ["d1", "d2", "d3", "d4", "d5"];
  const xs = [1, 2, 3, 4, 5];
  const ys = [2, 4, 6, 8, 10];

  it("창 크기만큼 모인 뒤부터 창의 마지막 날짜로 점을 낸다", () => {
    const out = rollingCorr(dates, xs, ys, 3);
    expect(out.map((p) => p.date)).toEqual(["d3", "d4", "d5"]);
    expect(out.every((p) => p.n === 3)).toBe(true);
    for (const p of out) expect(p.corr).toBeCloseTo(1, 10);
  });

  it("표본이 창보다 적으면 빈 배열이다", () => {
    expect(rollingCorr(["d1"], [1], [2], 3)).toEqual([]);
  });

  it("길이가 다르면 던진다", () => {
    expect(() => rollingCorr(["d1", "d2"], [1, 2], [1], 2)).toThrow();
  });
});
