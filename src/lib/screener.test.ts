import { describe, expect, it } from "vitest";
import { applyFilters, type ScreenerCriteria } from "./screener";
import type { Fundamentals } from "./types";

// 스크리너 필터(PRD §6.3): min~max 범위 필터를 지표별로 적용.
// 원칙: 조건이 설정된 지표가 결측(undefined)인 종목은 제외 — 모르는 값은 통과시키지 않는다.

const SAMSUNG: Fundamentals = {
  ticker: "005930",
  market: "KR",
  name: "삼성전자",
  marketCap: 4000000, // 억 원
  per: 12.5,
  pbr: 1.1,
  off52wHigh: -15,
  // KR 실데이터에는 배당·매출성장 없음
};

const APPLE: Fundamentals = {
  ticker: "AAPL",
  market: "US",
  name: "Apple",
  marketCap: 2900000, // 백만 달러
  per: 29.8,
  pbr: 45.2,
  dividendYield: 0.5,
  revenueGrowth: 8.1,
  off52wHigh: -5,
};

const ROWS = [SAMSUNG, APPLE];

function crit(partial: Partial<ScreenerCriteria>): ScreenerCriteria {
  return { markets: ["KR", "US"], ranges: {}, ...partial };
}

describe("applyFilters", () => {
  it("조건이 없으면 선택된 시장의 전 종목을 돌려준다", () => {
    expect(applyFilters(ROWS, crit({}))).toEqual(ROWS);
  });

  it("시장 선택으로 거른다", () => {
    expect(applyFilters(ROWS, crit({ markets: ["KR"] }))).toEqual([SAMSUNG]);
  });

  it("max 조건: PER 15 이하만 남긴다", () => {
    const out = applyFilters(ROWS, crit({ ranges: { per: { max: 15 } } }));
    expect(out).toEqual([SAMSUNG]);
  });

  it("min 조건: 매출 성장률 5% 이상만 남긴다", () => {
    const out = applyFilters(
      ROWS,
      crit({ ranges: { revenueGrowth: { min: 5 } } })
    );
    expect(out).toEqual([APPLE]);
  });

  it("min~max 동시: 52주 고가 대비 -30%~-10% 구간", () => {
    const out = applyFilters(
      ROWS,
      crit({ ranges: { off52wHigh: { min: -30, max: -10 } } })
    );
    expect(out).toEqual([SAMSUNG]);
  });

  it("조건이 설정된 지표가 결측이면 그 종목은 제외한다", () => {
    // 삼성전자는 dividendYield가 없다 → 배당 조건을 걸면 제외
    const out = applyFilters(
      ROWS,
      crit({ ranges: { dividendYield: { min: 0 } } })
    );
    expect(out).toEqual([APPLE]);
  });

  it("여러 지표 조건은 AND로 결합한다", () => {
    const out = applyFilters(
      ROWS,
      crit({ ranges: { per: { max: 35 }, pbr: { max: 2 } } })
    );
    expect(out).toEqual([SAMSUNG]);
  });

  it("경계값은 포함(이상/이하)한다", () => {
    const out = applyFilters(ROWS, crit({ ranges: { per: { max: 12.5 } } }));
    expect(out).toEqual([SAMSUNG]);
  });
});
