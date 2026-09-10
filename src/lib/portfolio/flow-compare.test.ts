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

import { flowStance, stanceLabel, summarizeFlowCompare, type SectorFlowCompareRow } from "./flow-compare";

const row = (sector: string, weightPct: number, total: number | null, streak = 0): SectorFlowCompareRow => ({
  sector,
  weightPct,
  total,
  unreliable: false,
  persistence: total === null ? null : { streak, buyDays: 10, tradingDays: 20 },
});

describe("flowStance", () => {
  it("20일 합이 음수면 반대 방향, 단 3일 이상 연속 매수면 돌아서는 중", () => {
    expect(flowStance(row("자동차", 19, -1300000, 1))).toBe("opposed");
    expect(flowStance(row("조선", 29, -65510, 4))).toBe("turning-in");
  });
  it("20일 합이 양수면 같은 방향, 단 3일 이상 연속 매도면 빠져나가는 중", () => {
    expect(flowStance(row("반도체", 16, 5000, 2))).toBe("aligned");
    expect(flowStance(row("반도체", 16, 5000, -3))).toBe("turning-out");
  });
  it("수급이 없으면 관측 밖", () => {
    expect(flowStance(row("기타", 6, null))).toBe("outside");
  });
});

describe("stanceLabel", () => {
  it("상태 이름 뒤에 지속성 설명을 괄호로 붙인다", () => {
    expect(stanceLabel(row("조선", 29, -65510, 4))).toBe("돌아서는 중 (4일 연속 매수)");
    expect(stanceLabel(row("자동차", 19, -1300000, 1))).toBe("반대 방향 (20일 중 10일 매수)");
    expect(stanceLabel(row("제약바이오", 14, -43860, -6))).toBe("반대 방향 (6일 연속 매도)");
    expect(stanceLabel(row("기타", 6, null))).toBe("관측 밖");
  });
});

describe("summarizeFlowCompare", () => {
  const rows = [
    row("조선", 29.1, -65510, 4),
    row("자동차", 19.1, -1300220, 1),
    row("반도체", 16.2, 8000, 3),
    row("제약바이오", 13.6, -43860, -6),
    row("기타", 6, null),
  ];
  it("큰손이 판 산업/산 산업의 비중 합과, 돌아선 산업 목록을 낸다", () => {
    expect(summarizeFlowCompare(rows)).toMatchObject({
      sellingPct: 61.8,
      buyingPct: 16.2,
      turningIn: ["조선"],
      turningOut: [],
    });
  });
  it("결론 문장: 파는 쪽 비중이 크면 반대 방향, 사는 쪽이 크면 같은 방향", () => {
    expect(summarizeFlowCompare(rows).headline).toBe("보유 62%가 큰손이 파는 산업에 있음 — 반대 방향");
    expect(summarizeFlowCompare([row("반도체", 40, 8000, 3), row("조선", 10, -1, 1)]).headline).toBe(
      "보유 40%가 큰손이 사는 산업에 있음 — 같은 방향",
    );
  });
  it("전부 관측 밖이면 결론 없음", () => {
    expect(summarizeFlowCompare([row("기타", 6, null)]).headline).toBeNull();
  });
});
