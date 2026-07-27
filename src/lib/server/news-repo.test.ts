import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "./db";
import { addKeyword, listFeed, upsertItems } from "./news-repo";
import type { RawNewsItem } from "../types";

/** 호출 순서대로 미리 준비한 결과를 돌려주는 가짜 Queryable. */
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

describe("addKeyword", () => {
  it("삽입 결과 row를 camelCase로 매핑한다", async () => {
    const { q } = fakeQ([
      {
        rows: [
          { id: 3, keyword: "금리", sort_order: 0, active: true, created_at: "2026-07-27T00:00:00.000Z" },
        ],
        rowCount: 1,
      },
    ]);
    const kw = await addKeyword(q, "금리");
    expect(kw).toEqual({
      id: 3,
      keyword: "금리",
      sortOrder: 0,
      active: true,
      createdAt: "2026-07-27T00:00:00.000Z",
    });
  });
});

describe("upsertItems", () => {
  it("항목별 on-conflict insert를 하고 rowCount 합을 신규 건수로 돌려준다", async () => {
    const items: RawNewsItem[] = [
      { title: "a", link: "L1", originalLink: null, description: null, source: null, pubDate: null },
      { title: "b", link: "L2", originalLink: null, description: null, source: null, pubDate: null },
    ];
    const { q, calls } = fakeQ([
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 0 }, // 중복 → 0
    ]);
    const inserted = await upsertItems(q, 5, items);
    expect(inserted).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[0].text).toContain("on conflict");
    expect(calls[0].params?.[0]).toBe(5);
    expect(calls[0].params?.[2]).toBe("L1");
  });
});

describe("listFeed", () => {
  it("키워드마다 항목을 묶어 그룹 배열로 돌려준다", async () => {
    const { q } = fakeQ([
      // listKeywords
      { rows: [{ id: 1, keyword: "2차전지", sort_order: 0, active: true, created_at: "2026-07-27T00:00:00.000Z" }], rowCount: 1 },
      // items for keyword 1
      { rows: [{ id: 10, keyword_id: 1, title: "t", link: "L", original_link: "O", description: null, source: "hankyung.com", pub_date: "2026-07-27T05:00:00.000Z", fetched_at: "2026-07-27T06:00:00.000Z" }], rowCount: 1 },
    ]);
    const feed = await listFeed(q);
    expect(feed).toHaveLength(1);
    expect(feed[0].keyword.keyword).toBe("2차전지");
    expect(feed[0].items[0]).toMatchObject({ id: 10, keywordId: 1, source: "hankyung.com" });
  });
});
