import { describe, expect, it } from "vitest";
import { aggregateBySector, sectorTotals, type StockFlow } from "./aggregate";

// 반도체 2종목 — 날짜 커버리지가 일부러 어긋나 있다(둘 다 09-04는 있지만
// 09-03은 A만, 09-05는 B만 있다). "일부 종목만 보고했는데 전체 섹터가
// 보고한 것처럼 보이면 안 된다"는 정직성 요구를 검증하기 위해서다.
const semiA: StockFlow = {
  ticker: "AAA",
  name: "A전자",
  sector: "반도체",
  days: [
    { date: "2025-09-03", close: 100, foreign: 10, institution: 5, individual: -15, foreignQty: 1, institutionQty: 1, individualQty: -2 },
    { date: "2025-09-04", close: 101, foreign: 20, institution: -3, individual: -17, foreignQty: 2, institutionQty: -1, individualQty: -1 },
  ],
};
const semiB: StockFlow = {
  ticker: "BBB",
  name: "B반도체",
  sector: "반도체",
  days: [
    { date: "2025-09-04", close: 50, foreign: 5, institution: 5, individual: -10, foreignQty: 3, institutionQty: 2, individualQty: -5 },
    { date: "2025-09-05", close: 51, foreign: -8, institution: 2, individual: 6, foreignQty: -1, institutionQty: 1, individualQty: 0 },
  ],
};
const auto: StockFlow = {
  ticker: "CCC",
  name: "C자동차",
  sector: "자동차",
  days: [
    { date: "2025-09-04", close: 200, foreign: 100, institution: -50, individual: -50, foreignQty: 5, institutionQty: -2, individualQty: -3 },
  ],
};

const flows = [semiA, semiB, auto];

describe("aggregateBySector", () => {
  it("같은 섹터 여러 종목의 대금을 날짜별로 단순 합산한다", () => {
    const out = aggregateBySector(flows, "반도체");
    const day0904 = out.find((d) => d.date === "2025-09-04");
    expect(day0904).toEqual({
      date: "2025-09-04",
      foreign: 20 + 5,
      institution: -3 + 5,
      individual: -17 + (-10),
      stocks: 2,
    });
  });

  it("한 종목만 보고한 날짜는 그 종목만 반영하고 stocks로 몇 종목이 기여했는지 드러낸다", () => {
    const out = aggregateBySector(flows, "반도체");
    const day0903 = out.find((d) => d.date === "2025-09-03");
    const day0905 = out.find((d) => d.date === "2025-09-05");

    // 09-03은 A만 보고 → 섹터 합계 = A 단독, stocks: 1
    expect(day0903).toEqual({
      date: "2025-09-03",
      foreign: 10,
      institution: 5,
      individual: -15,
      stocks: 1,
    });
    // 09-05는 B만 보고 → 섹터 합계 = B 단독, stocks: 1 (A가 보고 안 했다고 0으로 깔리지 않는다)
    expect(day0905).toEqual({
      date: "2025-09-05",
      foreign: -8,
      institution: 2,
      individual: 6,
      stocks: 1,
    });
  });

  it("날짜 오름차순으로 정렬해 반환한다", () => {
    const out = aggregateBySector(flows, "반도체");
    expect(out.map((d) => d.date)).toEqual(["2025-09-03", "2025-09-04", "2025-09-05"]);
  });

  it("해당 섹터에 속한 종목이 없으면 빈 배열을 반환한다", () => {
    expect(aggregateBySector(flows, "존재하지않는섹터")).toEqual([]);
  });

  it("다른 섹터 종목은 섞이지 않는다", () => {
    const out = aggregateBySector(flows, "자동차");
    expect(out).toEqual([
      { date: "2025-09-04", foreign: 100, institution: -50, individual: -50, stocks: 1 },
    ]);
  });
});

describe("sectorTotals", () => {
  it("최근 N 거래일만 합산한다", () => {
    // days: 1 → 가장 최신 날짜(09-05)만 대상. 반도체는 그날 B만 존재.
    const out = sectorTotals(flows, 1);
    const semi = out.find((s) => s.sector === "반도체");
    expect(semi).toEqual({ sector: "반도체", foreign: -8, institution: 2, individual: 6, tradingDays: 1 });
  });

  it("종목별로 날짜 커버리지가 다르면 tradingDays가 실제 관측 일수를 정직하게 보고한다", () => {
    // days: 3 → 09-03, 09-04, 09-05 전부 포함. 반도체는 세 날짜 모두 최소 한 종목이 보고했다.
    const out = sectorTotals(flows, 3);
    const semi = out.find((s) => s.sector === "반도체");
    expect(semi?.tradingDays).toBe(3);

    // 자동차는 09-04 하루치 데이터뿐이므로 3일 창을 요청해도 실제 관측일은 1.
    const autoTotal = out.find((s) => s.sector === "자동차");
    expect(autoTotal?.tradingDays).toBe(1);
  });

  it("foreign + institution 내림차순으로 정렬한다", () => {
    const out = sectorTotals(flows, 3);
    // 반도체 foreign+institution = (10+5)+(20-3)+(5+5)+(-8+2) = 15+17+10-6 = 36
    // 자동차 foreign+institution = 100-50 = 50
    expect(out.map((s) => s.sector)).toEqual(["자동차", "반도체"]);
  });

  it("foreign + institution 값이 같으면 섹터명으로 타이브레이크해 정렬을 결정적으로 만든다", () => {
    const tieA: StockFlow = {
      ticker: "T1",
      name: "티1",
      sector: "다",
      days: [{ date: "2025-09-04", close: 1, foreign: 10, institution: 0, individual: -10, foreignQty: 0, institutionQty: 0, individualQty: 0 }],
    };
    const tieB: StockFlow = {
      ticker: "T2",
      name: "티2",
      sector: "가",
      days: [{ date: "2025-09-04", close: 1, foreign: 10, institution: 0, individual: -10, foreignQty: 0, institutionQty: 0, individualQty: 0 }],
    };
    const out = sectorTotals([tieA, tieB], 1);
    expect(out.map((s) => s.sector)).toEqual(["가", "다"]);
  });

  it("days 창보다 저장된 날짜 수가 적으면 있는 만큼만 쓰고 tradingDays로 알린다", () => {
    const out = sectorTotals(flows, 100);
    const semi = out.find((s) => s.sector === "반도체");
    // 반도체 전체 고유 날짜: 09-03, 09-04, 09-05 = 3일뿐인데 100일을 요청했다.
    expect(semi?.tradingDays).toBe(3);
  });
});
