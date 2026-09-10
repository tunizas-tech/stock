import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "./db";
import { deleteHolding, holdingRow, importWatch, insertHolding, insertWatch, listHoldings, listWatch, updateHoldingSector, watchRow } from "./portfolio-repo";

function fakeQ(results: { rows: Record<string, unknown>[]; rowCount: number | null }[]) {
  const calls: { text: string; params?: unknown[] }[] = [];
  let i = 0;
  const q: Queryable = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      calls.push({ text, params });
      return results[i++] ?? { rows: [], rowCount: 0 };
    }),
  };
  return { q, calls };
}

const HROW = { id: "h1", market: "KR", ticker: "005930", name: "삼성전자", shares: "30", avgPrice: 71200, openedAt: "2025-11-04", sector: null };
const WROW = { id: "w1", market: "US", ticker: "NVDA", name: "엔비디아", memo: null, addedAt: "2026-01-02" };

describe("row 변환", () => {
  it("숫자 문자열은 Number로, memo null은 빈 문자열로", () => {
    expect(holdingRow(HROW)).toEqual({ id: "h1", market: "KR", ticker: "005930", name: "삼성전자", shares: 30, avgPrice: 71200, openedAt: "2025-11-04" });
    expect(watchRow(WROW).memo).toBe("");
  });
  it("sector null은 키를 빼고, 값이 있으면 그대로", () => {
    expect("sector" in holdingRow(HROW)).toBe(false);
    expect(holdingRow({ ...HROW, sector: "반도체" }).sector).toBe("반도체");
  });
});

describe("list", () => {
  it("보유는 openedAt desc, 관심은 addedAt desc", async () => {
    const a = fakeQ([{ rows: [HROW], rowCount: 1 }]);
    await listHoldings(a.q);
    expect(a.calls[0].text.replace(/\s+/g, " ")).toMatch(/order by "openedAt" desc, id desc/);
    const b = fakeQ([{ rows: [WROW], rowCount: 1 }]);
    await listWatch(b.q);
    expect(b.calls[0].text.replace(/\s+/g, " ")).toMatch(/order by "addedAt" desc, id desc/);
  });
});

describe("insert", () => {
  it("보유 8개(sector 없으면 null)·관심 6개 파라미터를 컬럼 순서대로 넘긴다", async () => {
    const a = fakeQ([{ rows: [HROW], rowCount: 1 }]);
    await insertHolding(a.q, holdingRow(HROW));
    expect(a.calls[0].params).toEqual(["h1", "KR", "005930", "삼성전자", 30, 71200, "2025-11-04", null]);
    expect(a.calls[0].text).toMatch(/sector/);
    const c = fakeQ([{ rows: [HROW], rowCount: 1 }]);
    await insertHolding(c.q, { ...holdingRow(HROW), sector: "반도체" });
    expect(c.calls[0].params?.[7]).toBe("반도체");
    const b = fakeQ([{ rows: [WROW], rowCount: 1 }]);
    await insertWatch(b.q, watchRow(WROW));
    expect(b.calls[0].params).toEqual(["w1", "US", "NVDA", "엔비디아", "", "2026-01-02"]);
  });
});

describe("delete / import", () => {
  it("rowCount로 존재 여부", async () => {
    const { q } = fakeQ([{ rows: [], rowCount: 0 }]);
    expect(await deleteHolding(q, "zzz")).toBe(false);
  });
  it("import는 on conflict do nothing으로 건너뜀을 센다", async () => {
    const { q, calls } = fakeQ([{ rows: [], rowCount: 1 }, { rows: [], rowCount: 0 }]);
    const r = await importWatch(q, [watchRow(WROW), { ...watchRow(WROW), id: "w9" }]);
    expect(r).toEqual({ inserted: 1, skipped: 1 });
    expect(calls[0].text).toMatch(/on conflict \(id\) do nothing/);
  });
});

describe("updateHoldingSector", () => {
  it("sector만 바꾸고 바뀐 행을 돌려준다; 없으면 null", async () => {
    const a = fakeQ([{ rows: [{ ...HROW, sector: "소재" }], rowCount: 1 }]);
    const r = await updateHoldingSector(a.q, "h1", "소재");
    expect(r?.sector).toBe("소재");
    expect(a.calls[0].text.replace(/\s+/g, " ")).toMatch(/update holdings set sector = \$1 where id = \$2/);
    expect(a.calls[0].params).toEqual(["소재", "h1"]);
    const b = fakeQ([{ rows: [], rowCount: 0 }]);
    expect(await updateHoldingSector(b.q, "zzz", "소재")).toBeNull();
  });
  it("undefined를 주면 자동 판정으로 되돌린다(null 저장)", async () => {
    const a = fakeQ([{ rows: [HROW], rowCount: 1 }]);
    await updateHoldingSector(a.q, "h1", undefined);
    expect(a.calls[0].params).toEqual([null, "h1"]);
  });
});
