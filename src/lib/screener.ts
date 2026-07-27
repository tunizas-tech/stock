// 스크리너 필터 로직(PRD §6.3) — 순수 함수. UI·데이터 소스와 무관하게 테스트 가능.
// 원칙: 조건이 설정된 지표가 결측인 종목은 제외 — 모르는 값은 통과시키지 않는다.

import type { Fundamentals, Market } from "./types";

export type MetricKey =
  | "marketCap"
  | "per"
  | "pbr"
  | "dividendYield"
  | "revenueGrowth"
  | "off52wHigh";

export interface RangeCriterion {
  min?: number;
  max?: number;
}

export interface ScreenerCriteria {
  markets: Market[];
  ranges: Partial<Record<MetricKey, RangeCriterion>>;
}

function passes(row: Fundamentals, key: MetricKey, r: RangeCriterion): boolean {
  const value = row[key];
  if (value === undefined) return false;
  if (r.min !== undefined && value < r.min) return false;
  if (r.max !== undefined && value > r.max) return false;
  return true;
}

export function applyFilters(
  rows: Fundamentals[],
  criteria: ScreenerCriteria
): Fundamentals[] {
  return rows.filter((row) => {
    if (!criteria.markets.includes(row.market)) return false;
    for (const [key, r] of Object.entries(criteria.ranges)) {
      if (r.min === undefined && r.max === undefined) continue;
      if (!passes(row, key as MetricKey, r)) return false;
    }
    return true;
  });
}
