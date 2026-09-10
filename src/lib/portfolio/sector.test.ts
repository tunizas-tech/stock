import { describe, expect, it } from "vitest";
import type { Holding } from "@/lib/types";
import { groupBySector, OTHER_SECTOR, priceFromQuotes, resolveSector, SECTOR_OPTIONS, sectorColor } from "./sector";

function h(p: Partial<Holding> & { ticker: string }): Holding {
  return { id: p.ticker, market: "KR", name: p.ticker, shares: 1, avgPrice: 0, openedAt: "2026-01-01", ...p };
}

describe("resolveSector", () => {
  it("관측소 유니버스에 있는 종목은 그 섹터", () => {
    expect(resolveSector(h({ ticker: "005930" }))).toBe("반도체");
  });
  it("사용자가 고른 섹터가 유니버스보다 우선", () => {
    expect(resolveSector(h({ ticker: "005930", sector: "소비재" }))).toBe("소비재");
  });
  it("유니버스에 없고 지정도 없으면 기타", () => {
    expect(resolveSector(h({ ticker: "003850" }))).toBe(OTHER_SECTOR);
  });
  it("US 종목은 유니버스를 안 보고 기타", () => {
    expect(resolveSector(h({ ticker: "AAPL", market: "US" }))).toBe(OTHER_SECTOR);
  });
});

describe("SECTOR_OPTIONS", () => {
  it("관측소 12섹터 + 기타가 마지막", () => {
    expect(SECTOR_OPTIONS).toHaveLength(13);
    expect(SECTOR_OPTIONS[12]).toBe(OTHER_SECTOR);
    expect(SECTOR_OPTIONS).toContain("반도체");
  });
});

describe("groupBySector", () => {
  const holdings = [
    h({ ticker: "005930", shares: 10, avgPrice: 60000 }), // 반도체
    h({ ticker: "000660", shares: 1, avgPrice: 100000 }), // 반도체
    h({ ticker: "005380", shares: 2, avgPrice: 100000 }), // 자동차
    h({ ticker: "AAPL", market: "US", shares: 3, avgPrice: 100 }),
  ];
  const price = (x: Holding) => (x.ticker === "005930" ? 70000 : x.avgPrice);

  it("섹터별 평가금액·손익을 합치고 비중이 큰 순으로 정렬한다", () => {
    const groups = groupBySector(holdings, price);
    expect(groups.map((g) => g.sector)).toEqual(["반도체", "자동차", OTHER_SECTOR]);
    const semi = groups[0];
    expect(semi.holdings.map((x) => x.ticker)).toEqual(["005930", "000660"]);
    expect(semi.marketValue).toBe(800000);
    expect(semi.pnl).toBe(100000);
  });
  it("비중은 KR 평가금액 합계 기준 %이고 US는 비중이 없다", () => {
    const groups = groupBySector(holdings, price);
    expect(groups[0].weightPct).toBeCloseTo(80, 5);
    expect(groups[1].weightPct).toBeCloseTo(20, 5);
    expect(groups[2].weightPct).toBeNull();
    expect(groups[2].marketValue).toBeNull();
  });
  it("보유가 없으면 빈 배열", () => {
    expect(groupBySector([], price)).toEqual([]);
  });
});

describe("sectorColor", () => {
  it("섹터마다 고정 색, 13개가 서로 다르고 모르는 섹터도 색이 있다", () => {
    const colors = SECTOR_OPTIONS.map(sectorColor);
    expect(new Set(colors).size).toBe(13);
    expect(sectorColor("반도체")).toBe(sectorColor("반도체"));
    expect(sectorColor("듣보")).toMatch(/^hsl\(/);
  });
});

describe("priceFromQuotes", () => {
  it("시세가 있으면 현재가, 없으면 평단가", () => {
    const priceOf = priceFromQuotes({ "KR:005930": { price: 70000 } as never });
    expect(priceOf(h({ ticker: "005930", avgPrice: 60000 }))).toBe(70000);
    expect(priceOf(h({ ticker: "000660", avgPrice: 60000 }))).toBe(60000);
  });
});
