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
});
