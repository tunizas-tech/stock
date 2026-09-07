import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "./db";
import type { JournalEntry } from "../types";
import {
  agentHasTicker, countAgentOn, deleteJournal, importJournal, insertJournal,
  listJournal, rowToEntry, updateLesson,
} from "./journal-repo";

/** 호출 순서대로 미리 준비한 결과를 돌려주는 가짜 Queryable(news-repo.test와 같은 패턴). */
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

const ROW = {
  id: "a1", date: "2026-09-08", market: "KR", ticker: "247540", name: "에코프로비엠",
  action: "skip", price: null, qty: null, reason: "r", emotion: 3, lesson: "",
  primaryTag: "에이전트", tags: ["뉴스"], snapshot: { asOf: "2026-09-07", coverage: "partial" },
  createdAt: new Date("2026-09-07T22:30:00.000Z"), author: "agent", sector: "배터리",
};

describe("rowToEntry", () => {
  it("null은 undefined로, timestamptz는 ISO 문자열로", () => {
    const e = rowToEntry(ROW);
    expect(e.price).toBeUndefined();
    expect(e.qty).toBeUndefined();
    expect(e.createdAt).toBe("2026-09-07T22:30:00.000Z");
    expect(e.tags).toEqual(["뉴스"]);
    expect(e.snapshot).toEqual({ asOf: "2026-09-07", coverage: "partial" });
    expect(e.author).toBe("agent");
    expect(e.sector).toBe("배터리");
  });
  it("undefined 키를 만들지 않는다(JSON 왕복 시 키 자체가 없어야 옛 기록과 같다)", () => {
    const e = rowToEntry({ ...ROW, primaryTag: null, tags: null, snapshot: null, createdAt: null, author: null, sector: null });
    expect("primaryTag" in e).toBe(false);
    expect("createdAt" in e).toBe(false);
  });
});

describe("listJournal", () => {
  it("date desc, createdAt desc로 정렬해 조회한다", async () => {
    const { q, calls } = fakeQ([{ rows: [ROW], rowCount: 1 }]);
    const list = await listJournal(q);
    expect(list).toHaveLength(1);
    expect(calls[0].text.replace(/\s+/g, " ")).toMatch(/order by date desc, "createdAt" desc nulls last/i);
  });
});

describe("insertJournal", () => {
  it("17개 컬럼을 파라미터로 넘기고 반환 행을 entry로 돌려준다", async () => {
    const { q, calls } = fakeQ([{ rows: [ROW], rowCount: 1 }]);
    const entry = rowToEntry(ROW);
    const out = await insertJournal(q, entry);
    expect(out.id).toBe("a1");
    expect(calls[0].params).toHaveLength(17);
    expect(calls[0].params?.[0]).toBe("a1");
    // tags/snapshot은 pg가 배열·jsonb로 직렬화하도록 각각 배열·JSON 문자열로 넘긴다
    expect(calls[0].params?.[12]).toEqual(["뉴스"]);
    expect(typeof calls[0].params?.[13]).toBe("string");
  });
});

describe("updateLesson / deleteJournal", () => {
  it("rowCount로 존재 여부를 알린다", async () => {
    const { q } = fakeQ([{ rows: [], rowCount: 1 }, { rows: [], rowCount: 0 }]);
    expect(await updateLesson(q, "a1", "복기")).toBe(true);
    expect(await deleteJournal(q, "zzz")).toBe(false);
  });
});

describe("countAgentOn / agentHasTicker", () => {
  it("author='agent'로만 센다", async () => {
    const { q, calls } = fakeQ([{ rows: [{ n: "2" }], rowCount: 1 }, { rows: [{ one: 1 }], rowCount: 1 }]);
    expect(await countAgentOn(q, "2026-09-08")).toBe(2);
    expect(await agentHasTicker(q, "2026-09-08", "247540")).toBe(true);
    expect(calls[0].text).toMatch(/author = 'agent'/);
    expect(calls[1].text).toMatch(/author = 'agent'/);
    expect(calls[1].params).toEqual(["2026-09-08", "247540"]);
  });
});

describe("importJournal", () => {
  it("같은 id는 건너뛰고(on conflict do nothing) 삽입·건너뜀 수를 센다", async () => {
    const { q } = fakeQ([{ rows: [], rowCount: 1 }, { rows: [], rowCount: 0 }]);
    const a: JournalEntry = { ...rowToEntry(ROW), id: "x1" };
    const b: JournalEntry = { ...rowToEntry(ROW), id: "x2" };
    expect(await importJournal(q, [a, b])).toEqual({ inserted: 1, skipped: 1 });
  });
});
