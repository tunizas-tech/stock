// 뉴스 저장소 — Queryable(pg Pool)을 인자로 받아 테스트에서 주입 가능하게 한다.
import type { Queryable } from "./db";
import type { NewsFeedGroup, NewsItem, NewsKeyword, RawNewsItem } from "../types";

const FEED_LIMIT = 30;

function mapKeyword(r: Record<string, unknown>): NewsKeyword {
  return {
    id: Number(r.id),
    keyword: String(r.keyword),
    sortOrder: Number(r.sort_order),
    active: Boolean(r.active),
    createdAt: new Date(r.created_at as string).toISOString(),
  };
}

function mapItem(r: Record<string, unknown>): NewsItem {
  return {
    id: Number(r.id),
    keywordId: Number(r.keyword_id),
    title: String(r.title),
    link: String(r.link),
    originalLink: (r.original_link as string) ?? null,
    description: (r.description as string) ?? null,
    source: (r.source as string) ?? null,
    pubDate: r.pub_date ? new Date(r.pub_date as string).toISOString() : null,
    fetchedAt: new Date(r.fetched_at as string).toISOString(),
  };
}

export async function listKeywords(q: Queryable): Promise<NewsKeyword[]> {
  const { rows } = await q.query(
    `select id, keyword, sort_order, active, created_at
       from news_keyword
      where active = true
      order by sort_order, id`
  );
  return rows.map(mapKeyword);
}

export async function addKeyword(q: Queryable, keyword: string): Promise<NewsKeyword> {
  const { rows } = await q.query(
    `insert into news_keyword (keyword) values ($1)
       on conflict (keyword) do update set active = true
     returning id, keyword, sort_order, active, created_at`,
    [keyword]
  );
  return mapKeyword(rows[0]);
}

export async function deleteKeyword(q: Queryable, id: number): Promise<void> {
  await q.query(`delete from news_keyword where id = $1`, [id]);
}

export async function upsertItems(
  q: Queryable,
  keywordId: number,
  items: RawNewsItem[]
): Promise<number> {
  let inserted = 0;
  for (const it of items) {
    const { rowCount } = await q.query(
      `insert into news_item
         (keyword_id, title, link, original_link, description, source, pub_date)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (keyword_id, link) do nothing`,
      [keywordId, it.title, it.link, it.originalLink, it.description, it.source, it.pubDate]
    );
    inserted += rowCount ?? 0;
  }
  return inserted;
}

export async function listFeed(q: Queryable): Promise<NewsFeedGroup[]> {
  const keywords = await listKeywords(q);
  const groups: NewsFeedGroup[] = [];
  for (const kw of keywords) {
    const { rows } = await q.query(
      `select id, keyword_id, title, link, original_link, description, source, pub_date, fetched_at
         from news_item
        where keyword_id = $1
        order by pub_date desc nulls last, id desc
        limit ${FEED_LIMIT}`,
      [kw.id]
    );
    groups.push({ keyword: kw, items: rows.map(mapItem) });
  }
  return groups;
}
