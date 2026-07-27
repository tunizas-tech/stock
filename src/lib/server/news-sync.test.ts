import { afterEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "./db";
import { syncAll } from "./news-sync";

const CREDS = { clientId: "cid", clientSecret: "csecret" };

afterEach(() => {
  vi.unstubAllGlobals();
});

/** listKeywords → 2개, 이후 upsert insert들은 rowCount 1로 응답하는 가짜 Q. */
function fakeQ() {
  let first = true;
  const q: Queryable = {
    query: vi.fn(async (text: string) => {
      if (first && text.includes("from news_keyword")) {
        first = false;
        return {
          rows: [
            { id: 1, keyword: "2차전지", sort_order: 0, active: true, created_at: "2026-07-27T00:00:00.000Z" },
            { id: 2, keyword: "금리", sort_order: 0, active: true, created_at: "2026-07-27T00:00:00.000Z" },
          ],
          rowCount: 2,
        };
      }
      return { rows: [], rowCount: 1 }; // 각 insert는 신규 1건
    }),
  };
  return q;
}

describe("syncAll", () => {
  it("키워드별로 조회·저장하고 신규 건수를 돌려준다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            { title: "n", link: "L1", originallink: "https://a.com/1", pubDate: "Mon, 27 Jul 2026 14:00:00 +0900" },
          ],
        }),
      })
    );

    const results = await syncAll(fakeQ(), CREDS);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ keyword: "2차전지", fetched: 1, inserted: 1 });
    expect(results[1]).toMatchObject({ keyword: "금리", fetched: 1, inserted: 1 });
  });

  it("한 키워드 조회가 실패해도 나머지는 계속하고 error를 담는다", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        n += 1;
        if (n === 1) return { ok: false, status: 429, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      })
    );

    const results = await syncAll(fakeQ(), CREDS);

    expect(results[0].error).toBeTruthy();
    expect(results[0].inserted).toBe(0);
    expect(results[1].error).toBeUndefined();
  });
});
