import { describe, expect, it } from "vitest";
import { compareSectorFlow, persistenceLabel } from "./flow-compare";
import type { SectorGroup } from "./sector";
import type { FlowWindow } from "@/lib/observatory";

const group = (sector: string, weightPct: number | null): SectorGroup => ({
  sector, holdings: [], marketValue: weightPct === null ? null : 1, pnl: 0, weightPct,
});

const sectorTotal = (sector: string, foreign: number, institution: number, unreliable = false) => ({
  sector, foreign, institution, individual: 0, other: 0, otherRatio: 0, unreliable, tradingDays: 20,
});

const window: FlowWindow = {
  days: 20,
  sectors: [sectorTotal("반도체", 2000, 1100), sectorTotal("조선", -1000, -240, true)],
  stocksBySector: {},
  coverageBySector: {},
  persistenceBySector: {
    반도체: { streak: 2, buyDays: 14, tradingDays: 20 },
    조선: { streak: -12, buyDays: 8, tradingDays: 20 },
  },
};

describe("persistenceLabel", () => {
  it("3일 이상 이어지면 연속 일수로, 아니면 순매수 일 비율로 말한다", () => {
    expect(persistenceLabel({ streak: -12, buyDays: 8, tradingDays: 20 })).toBe("▼ 12일 연속 순매도");
    expect(persistenceLabel({ streak: 3, buyDays: 10, tradingDays: 20 })).toBe("▲ 3일 연속 순매수");
    expect(persistenceLabel({ streak: 2, buyDays: 14, tradingDays: 20 })).toBe("순매수 14/20일");
    expect(persistenceLabel({ streak: 0, buyDays: 0, tradingDays: 0 })).toBe("순매수 0/0일");
  });
});

describe("compareSectorFlow", () => {
  it("KR 비중이 있는 보유 산업만, 비중 순서 그대로, 같은 이름의 수급을 붙인다", () => {
    const rows = compareSectorFlow([group("조선", 36.8), group("반도체", 23.3), group("해외", null)], window);
    expect(rows.map((r) => r.sector)).toEqual(["조선", "반도체"]);
    expect(rows[0]).toEqual({
      sector: "조선",
      weightPct: 36.8,
      total: -1240,
      unreliable: true,
      persistence: { streak: -12, buyDays: 8, tradingDays: 20 },
    });
  });

  it("수급 유니버스에 없는 산업(기타 등)은 total·persistence가 null이다", () => {
    const rows = compareSectorFlow([group("기타", 4.1)], window);
    expect(rows[0]).toEqual({ sector: "기타", weightPct: 4.1, total: null, unreliable: false, persistence: null });
  });

  it("창이 없으면(수급 데이터 없음) 빈 배열", () => {
    expect(compareSectorFlow([group("조선", 36.8)], undefined)).toEqual([]);
  });
});
