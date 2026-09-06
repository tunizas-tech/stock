import { describe, expect, it } from "vitest";
import { analyzeTransfer } from "./run";
import type { Candle } from "../types";

// 미국이 오른 다음 한국 거래일의 장중이 오르도록 만든 합성 데이터.
// 분석이 이 심어둔 관계를 잡아내야 한다.
function build(days: number) {
  const kr: Candle[] = [];
  const us: Candle[] = [];
  let krClose = 100;
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.UTC(2020, 0, 6 + i * 7)); // 매주 월요일 — 주말 없이 단순화
    const date = d.toISOString().slice(0, 10);

    const usUp = i % 2 === 0 ? 0.02 : -0.02;
    us.push({ date, open: 100, high: 100, low: 100, close: 100 * (1 + usUp) });

    // 한국 i번째 날은 미국 (i-1)번째 신호를 받는다.
    const prevSignal = i === 0 ? 0 : (i - 1) % 2 === 0 ? 0.02 : -0.02;
    const open = krClose; // 갭 0 — 전부 장중으로 나오게 한다
    const close = open * (1 + prevSignal);
    kr.push({ date, open, high: Math.max(open, close), low: Math.min(open, close), close });
    krClose = close;
  }
  return { kr, us };
}

describe("analyzeTransfer", () => {
  const { kr, us } = build(60);
  const report = analyzeTransfer({
    krCandles: kr,
    usCandles: us,
    mode: "skip",
    roundTrip: 0,
    window: 20,
    threshold: 0.01,
    horizons: [3, 5],
  });

  it("심어둔 관계를 장중 상관에서 강하게 잡아낸다", () => {
    expect(report.corr.intraday).toBeGreaterThan(0.9);
  });

  it("갭을 0으로 만들었으므로 갭 상관은 거의 없다", () => {
    expect(Math.abs(report.corr.gap)).toBeLessThan(0.2);
  });

  it("롤링 점은 창 크기만큼 모인 뒤부터 나온다", () => {
    expect(report.rolling.length).toBeGreaterThan(0);
    expect(report.rolling[0].n).toBe(20);
  });

  it("신호일 성과가 대조군보다 낫다", () => {
    expect(report.conditional.deltaMean).toBeGreaterThan(0);
    expect(report.conditional.signal.n).toBeGreaterThan(0);
    expect(report.conditional.control.n).toBeGreaterThan(0);
  });

  const withCost = analyzeTransfer({
    krCandles: kr,
    usCandles: us,
    mode: "skip",
    roundTrip: 0.004,
    window: 20,
    threshold: 0.01,
    horizons: [3, 5],
  });

  it("비용을 0.4%로 주면 신호일 평균이 그만큼 낮아진다", () => {
    expect(withCost.conditional.signal.mean).toBeLessThan(
      report.conditional.signal.mean
    );
  });

  it("연 50회 매매 기준 비용을 같이 낸다", () => {
    // 복리이므로 1 - 0.996^50 = 0.1816
    expect(withCost.annualCostAt50).toBeCloseTo(0.1816, 3);
  });

  it("요청한 보유 기간마다 대조군 비교를 낸다", () => {
    expect(report.horizons.map((h) => h.days)).toEqual([3, 5]);
    for (const h of report.horizons) {
      expect(h.comparison.signal.n).toBeGreaterThan(0);
      expect(h.comparison.control.n).toBeGreaterThan(0);
    }
  });

  it("보유 기간 성과에도 비용이 적용된다", () => {
    for (let i = 0; i < report.horizons.length; i++) {
      expect(withCost.horizons[i].comparison.signal.mean).toBeLessThan(
        report.horizons[i].comparison.signal.mean
      );
    }
  });

  it("horizons가 비면 보유 기간 결과도 비어 있다", () => {
    const none = analyzeTransfer({
      krCandles: kr,
      usCandles: us,
      mode: "skip",
      roundTrip: 0,
      window: 20,
      threshold: 0.01,
      horizons: [],
    });
    expect(none.horizons).toEqual([]);
  });

  describe("conditionalGross — 비용 전 조건부 성과", () => {
    it("비용이 0이면 conditionalGross는 conditional과 같다", () => {
      expect(report.conditionalGross.signal.mean).toBeCloseTo(
        report.conditional.signal.mean,
        10
      );
      expect(report.conditionalGross.control.mean).toBeCloseTo(
        report.conditional.control.mean,
        10
      );
    });

    it("conditionalGross는 roundTrip과 무관하게 항상 같다", () => {
      expect(withCost.conditionalGross.signal.mean).toBeCloseTo(
        report.conditionalGross.signal.mean,
        10
      );
      expect(withCost.conditionalGross.signal.winRate).toBeCloseTo(
        report.conditionalGross.signal.winRate,
        10
      );
      expect(withCost.conditionalGross.control.winRate).toBeCloseTo(
        report.conditionalGross.control.winRate,
        10
      );
    });

    it("conditional과 conditionalGross는 표본을 동일하게 나눈다", () => {
      expect(report.conditionalGross.signal.n).toBe(report.conditional.signal.n);
      expect(report.conditionalGross.control.n).toBe(
        report.conditional.control.n
      );
    });

    it("비용이 있으면 conditional(비용후) 평균이 conditionalGross(비용전)보다 낮다", () => {
      expect(withCost.conditional.signal.mean).toBeLessThan(
        withCost.conditionalGross.signal.mean
      );
    });
  });

  describe("comparisonGross — 보유 기간별 비용 전 성과", () => {
    it("보유 기간마다 comparisonGross를 낸다", () => {
      for (let i = 0; i < report.horizons.length; i++) {
        expect(report.horizons[i].comparisonGross.signal.n).toBeGreaterThan(0);
        expect(report.horizons[i].comparisonGross.control.n).toBeGreaterThan(0);
      }
    });

    it("comparisonGross는 roundTrip과 무관하게 항상 같다", () => {
      for (let i = 0; i < report.horizons.length; i++) {
        expect(withCost.horizons[i].comparisonGross.signal.mean).toBeCloseTo(
          report.horizons[i].comparisonGross.signal.mean,
          10
        );
      }
    });

    it("comparison과 comparisonGross는 표본을 동일하게 나눈다", () => {
      for (let i = 0; i < report.horizons.length; i++) {
        expect(report.horizons[i].comparisonGross.signal.n).toBe(
          report.horizons[i].comparison.signal.n
        );
        expect(report.horizons[i].comparisonGross.control.n).toBe(
          report.horizons[i].comparison.control.n
        );
      }
    });
  });
});

describe("analyzeTransfer — from 하한", () => {
  const { kr, us } = build(60);
  const base = analyzeTransfer({
    krCandles: kr,
    usCandles: us,
    mode: "skip",
    roundTrip: 0.004,
    window: 20,
    threshold: 0.01,
    horizons: [3, 5],
  });

  it("from을 생략하면 전체 기간과 같은 결과를 낸다", () => {
    const noFrom = analyzeTransfer({
      krCandles: kr,
      usCandles: us,
      mode: "skip",
      roundTrip: 0.004,
      window: 20,
      threshold: 0.01,
      horizons: [3, 5],
      from: undefined,
    });
    expect(noFrom).toEqual(base);
  });

  it("from을 주면 그 이전 한국 거래일은 빠지고 표본이 줄어든다", () => {
    const filtered = analyzeTransfer({
      krCandles: kr,
      usCandles: us,
      mode: "skip",
      roundTrip: 0.004,
      window: 20,
      threshold: 0.01,
      horizons: [3, 5],
      from: "2020-08-03",
    });

    const totalBefore =
      base.conditional.signal.n + base.conditional.control.n;
    const totalAfter =
      filtered.conditional.signal.n + filtered.conditional.control.n;
    expect(totalAfter).toBeLessThan(totalBefore);
    expect(filtered.rolling.length).toBeLessThan(base.rolling.length);
    expect(filtered.rolling.every((p) => p.date >= "2020-08-03")).toBe(true);
  });
});
