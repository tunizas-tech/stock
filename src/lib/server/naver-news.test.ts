import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchNews } from "./naver-news";

const CREDS = { clientId: "cid", clientSecret: "csecret" };

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(json: unknown, ok = true, status = 200) {
  const fn = vi.fn().mockResolvedValue({ ok, status, json: async () => json });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("fetchNews", () => {
  it("HTML 태그·엔티티를 제거하고 pubDate를 ISO로, source를 호스트로 정규화한다", async () => {
    stubFetch({
      items: [
        {
          title: "<b>삼성</b> 실적 &amp; 전망",
          originallink: "https://www.hankyung.com/article/1",
          link: "https://n.news.naver.com/x",
          description: "요약 &quot;인용&quot;",
          pubDate: "Mon, 27 Jul 2026 14:00:00 +0900",
        },
      ],
    });

    const items = await fetchNews("삼성", CREDS);

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("삼성 실적 & 전망");
    expect(items[0].description).toBe('요약 "인용"');
    expect(items[0].source).toBe("hankyung.com");
    expect(items[0].link).toBe("https://n.news.naver.com/x");
    expect(items[0].originalLink).toBe("https://www.hankyung.com/article/1");
    expect(items[0].pubDate).toBe(new Date("Mon, 27 Jul 2026 14:00:00 +0900").toISOString());
  });

  it("검색어·display·sort와 인증 헤더를 담아 요청한다", async () => {
    const fn = stubFetch({ items: [] });

    await fetchNews("2차전지", CREDS);

    const [url, opts] = fn.mock.calls[0];
    expect(String(url)).toContain("query=" + encodeURIComponent("2차전지"));
    expect(String(url)).toContain("display=100");
    expect(String(url)).toContain("sort=date");
    expect((opts as RequestInit).headers).toMatchObject({
      "X-Naver-Client-Id": "cid",
      "X-Naver-Client-Secret": "csecret",
    });
  });

  it("HTTP 오류면 throw한다", async () => {
    stubFetch({}, false, 429);
    await expect(fetchNews("금리", CREDS)).rejects.toThrow(/429/);
  });
});
