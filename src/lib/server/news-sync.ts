// 뉴스 동기화 — 활성 키워드마다 네이버 조회 후 upsert. 부분 실패 허용.
import type { Queryable } from "./db";
import { fetchNews, type NaverCreds } from "./naver-news";
import { listKeywords, upsertItems } from "./news-repo";

export interface SyncResult {
  keyword: string;
  fetched: number;
  inserted: number;
  error?: string;
}

export async function syncAll(
  q: Queryable,
  creds: NaverCreds
): Promise<SyncResult[]> {
  const keywords = await listKeywords(q);
  const results: SyncResult[] = [];
  for (const kw of keywords) {
    try {
      const items = await fetchNews(kw.keyword, creds);
      const inserted = await upsertItems(q, kw.id, items);
      results.push({ keyword: kw.keyword, fetched: items.length, inserted });
    } catch (e) {
      results.push({
        keyword: kw.keyword,
        fetched: 0,
        inserted: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}
