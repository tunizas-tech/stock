# 네이버 뉴스 키워드 대시보드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/news` 페이지에서 내가 지정한 키워드별로 네이버 뉴스를 수집·중복제거·저장해 보여주고, [업데이트] 버튼과 매일 cron으로 동기화한다.

**Architecture:** 네이버 공식 검색 API(키워드=검색어=분류함)로 뉴스를 가져와 전용 PostgreSQL(Coolify, 서버사이드 `pg`)에 `(keyword_id, link)` 유니크로 upsert한다. 기존 Supabase/`db` 파사드와 무관한 독립 모듈. UI는 세로 섹션 피드 + 상단 키워드 칩 탭 필터.

**Tech Stack:** Next.js 14 App Router, TypeScript, `pg`(node-postgres), 네이버 검색 API, Vitest, Tailwind.

---

## 참고: 기존 코드 규약

- 서버 전용 어댑터는 `src/lib/server/*` 에 두고 자격증명을 인자로 받는다(예: `src/lib/server/kis.ts`의 `getKisQuote(ticker, creds)`).
- API 라우트는 `src/app/api/<name>/route.ts`, 테스트는 같은 폴더의 `route.test.ts`. 테스트는 `vi.stubEnv` + `vi.stubGlobal("fetch", …)` 로 격리(예: `src/app/api/quotes/route.test.ts`).
- Vitest: `environment: "node"`, `include: src/**/*.test.ts`, alias `@ → src`.
- Tailwind 토큰: `bg surface ink muted line accent gain loss`, radius `xl2`, `font-serif`. 색만으로 의미 전달 금지(부호/라벨 병행).
- 페이지는 `"use client"` + `PageHeader`/`EmptyState` 사용, 서브 컴포넌트를 같은 파일에 두는 패턴(예: `journal/page.tsx`의 `JournalCard`).

**커밋:** 이 폴더는 아직 git 저장소가 아니다. Task 0에서 `git init`을 하면 이후 커밋 단계가 동작한다(선택). 원치 않으면 각 커밋 단계는 건너뛰어도 된다.

---

## Task 0: (선택) git 초기화

**Files:** 없음(리포 초기화)

- [ ] **Step 1: git 저장소 초기화**

```bash
cd /d/AI/stock_k
git init
git add -A
git commit -m "chore: baseline before news dashboard"
```

Expected: 최초 커밋 생성. 이미 git이면 건너뛴다.

---

## Task 1: `pg` 의존성 + 뉴스 DB 스키마 + 뉴스 타입

**Files:**
- Modify: `package.json` (dependencies)
- Create: `db/news-schema.sql`
- Modify: `src/lib/types.ts` (파일 끝에 추가)

- [ ] **Step 1: `pg` 설치**

Run:
```bash
cd /d/AI/stock_k
npm install pg
npm install -D @types/pg
```
Expected: `package.json`의 `dependencies`에 `pg`, `devDependencies`에 `@types/pg` 추가.

- [ ] **Step 2: DB 스키마 파일 작성**

Create `db/news-schema.sql`:
```sql
-- 네이버 뉴스 키워드 대시보드 전용 스키마 (Coolify PostgreSQL에 1회 적용).
create table if not exists news_keyword (
  id          serial primary key,
  keyword     text not null unique,
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists news_item (
  id            bigserial primary key,
  keyword_id    int not null references news_keyword(id) on delete cascade,
  title         text not null,
  link          text not null,
  original_link text,
  description   text,
  source        text,
  pub_date      timestamptz,
  fetched_at    timestamptz not null default now(),
  unique (keyword_id, link)
);

create index if not exists idx_news_item_kw_pub
  on news_item (keyword_id, pub_date desc);
```

- [ ] **Step 3: 뉴스 타입 추가**

Append to `src/lib/types.ts`:
```typescript
// ---------------------------------------------------------------------------
// 뉴스 키워드 대시보드(/news) — 전용 PostgreSQL. 기존 db 파사드/Supabase와 무관.
// ---------------------------------------------------------------------------

export interface NewsKeyword {
  id: number;
  keyword: string;
  sortOrder: number;
  active: boolean;
  createdAt: string; // ISO
}

export interface NewsItem {
  id: number;
  keywordId: number;
  title: string;
  link: string; // 네이버 link (키워드 내 중복제거 키)
  originalLink: string | null; // 언론사 원문
  description: string | null;
  source: string | null; // 언론사/호스트 (best-effort)
  pubDate: string | null; // ISO
  fetchedAt: string; // ISO
}

/** 네이버 API 응답을 정규화한, DB 저장 직전 형태(id/fetchedAt 없음). */
export interface RawNewsItem {
  title: string;
  link: string;
  originalLink: string | null;
  description: string | null;
  source: string | null;
  pubDate: string | null; // ISO
}

export interface NewsFeedGroup {
  keyword: NewsKeyword;
  items: NewsItem[];
}
```

- [ ] **Step 4: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json db/news-schema.sql src/lib/types.ts
git commit -m "feat(news): add pg dep, db schema, news types"
```

---

## Task 2: PostgreSQL 풀 (`db.ts`)

**Files:**
- Create: `src/lib/server/db.ts`

`pg`는 서버 전용이라 여기서만 import한다. `DATABASE_URL` 없으면 `null`(라우트가 503으로 분기, `supabase.ts`가 null 반환하는 패턴과 동일).

- [ ] **Step 1: 풀 헬퍼 작성**

Create `src/lib/server/db.ts`:
```typescript
// 전용 PostgreSQL 풀(서버 전용 — DATABASE_URL을 다루므로 클라이언트 import 금지).
// 환경변수가 없으면 null → 라우트가 503으로 분기한다.
import { Pool } from "pg";

/** repo 함수가 받는 최소 쿼리 인터페이스. pg Pool이 이 형태를 만족한다. */
export interface Queryable {
  query(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

let pool: Pool | null = null;

export function getPool(): Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!pool) pool = new Pool({ connectionString: url });
  return pool;
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/db.ts
git commit -m "feat(news): add postgres pool helper"
```

---

## Task 3: 네이버 뉴스 API 클라이언트 (`naver-news.ts`)

**Files:**
- Create: `src/lib/server/naver-news.ts`
- Test: `src/lib/server/naver-news.test.ts`

네이버 응답의 `title`/`description`은 `<b>` 태그와 HTML 엔티티를 포함하므로 정규화한다. `pubDate`(RFC1123)는 ISO로, `source`는 `originallink` 호스트에서 유추.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `src/lib/server/naver-news.test.ts`:
```typescript
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/server/naver-news.test.ts`
Expected: FAIL — `fetchNews`가 없음.

- [ ] **Step 3: 구현 작성**

Create `src/lib/server/naver-news.ts`:
```typescript
// 네이버 검색(뉴스) API 어댑터 (서버 전용 — client id/secret을 다루므로 클라이언트 import 금지).
// GET /v1/search/news.json?query=&display=100&sort=date, 헤더에 X-Naver-Client-Id/Secret.
// 응답 title/description은 <b> 태그·HTML 엔티티를 포함 → 정규화한다.
import type { RawNewsItem } from "../types";

const ENDPOINT = "https://openapi.naver.com/v1/search/news.json";

export interface NaverCreds {
  clientId: string;
  clientSecret: string;
}

interface NaverItem {
  title: string;
  originallink?: string;
  link: string;
  description?: string;
  pubDate?: string;
}

/** <b> 등 태그 제거 + 주요 HTML 엔티티 디코드. */
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** RFC1123 → ISO. 파싱 실패 시 null. */
function toIso(pubDate: string | undefined): string | null {
  if (!pubDate) return null;
  const t = new Date(pubDate);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/** originallink 호스트에서 언론사/출처를 유추(best-effort). */
function sourceFrom(originallink: string | undefined): string | null {
  if (!originallink) return null;
  try {
    return new URL(originallink).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function fetchNews(
  keyword: string,
  creds: NaverCreds
): Promise<RawNewsItem[]> {
  const url =
    `${ENDPOINT}?query=${encodeURIComponent(keyword)}` + `&display=100&sort=date`;
  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": creds.clientId,
      "X-Naver-Client-Secret": creds.clientSecret,
    },
  });
  if (!res.ok) throw new Error(`네이버 뉴스 HTTP ${res.status} (${keyword})`);
  const body = (await res.json()) as { items?: NaverItem[] };
  return (body.items ?? []).map((it) => ({
    title: stripHtml(it.title),
    link: it.link,
    originalLink: it.originallink ?? null,
    description: it.description ? stripHtml(it.description) : null,
    source: sourceFrom(it.originallink),
    pubDate: toIso(it.pubDate),
  }));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/server/naver-news.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/naver-news.ts src/lib/server/naver-news.test.ts
git commit -m "feat(news): naver search api client with normalization"
```

---

## Task 4: 저장소 (`news-repo.ts`)

**Files:**
- Create: `src/lib/server/news-repo.ts`
- Test: `src/lib/server/news-repo.test.ts`

repo 함수는 `Queryable`(=pg Pool)을 인자로 받아 테스트에서 가짜 쿼리 객체를 주입할 수 있게 한다. snake_case 컬럼 → camelCase 타입 매핑.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `src/lib/server/news-repo.test.ts`:
```typescript
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/server/news-repo.test.ts`
Expected: FAIL — `news-repo`가 없음.

- [ ] **Step 3: 구현 작성**

Create `src/lib/server/news-repo.ts`:
```typescript
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/server/news-repo.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/news-repo.ts src/lib/server/news-repo.test.ts
git commit -m "feat(news): postgres repo for keywords and items"
```

---

## Task 5: 동기화 오케스트레이션 (`news-sync.ts`)

**Files:**
- Create: `src/lib/server/news-sync.ts`
- Test: `src/lib/server/news-sync.test.ts`

`syncAll`은 활성 키워드마다 `fetchNews` → `upsertItems`. 한 키워드가 실패해도 나머지는 계속(부분 성공).

- [ ] **Step 1: 실패하는 테스트 작성**

Create `src/lib/server/news-sync.test.ts`:
```typescript
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/server/news-sync.test.ts`
Expected: FAIL — `syncAll`이 없음.

- [ ] **Step 3: 구현 작성**

Create `src/lib/server/news-sync.ts`:
```typescript
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/server/news-sync.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/news-sync.ts src/lib/server/news-sync.test.ts
git commit -m "feat(news): syncAll orchestration with partial failure"
```

---

## Task 6: API 라우트

**Files:**
- Create: `src/lib/server/news-config.ts` (env 헬퍼)
- Create: `src/app/api/news/route.ts` (GET)
- Create: `src/app/api/news/sync/route.ts` (POST)
- Create: `src/app/api/news/keywords/route.ts` (POST)
- Create: `src/app/api/news/keywords/[id]/route.ts` (DELETE)
- Test: `src/app/api/news/sync/route.test.ts`
- Test: `src/app/api/news/keywords/route.test.ts`

`pg`는 Node 런타임이 필요하므로 각 라우트에 `export const runtime = "nodejs";`. env 누락 시 503, 잘못된 입력 400. DB가 필요한 happy-path는 Task 8의 수동 검증으로 확인(단위 테스트는 설정-누락/입력검증 경로만).

- [ ] **Step 1: env 헬퍼 작성**

Create `src/lib/server/news-config.ts`:
```typescript
import type { NaverCreds } from "./naver-news";

/** 네이버 자격증명(둘 다 있어야 유효). 없으면 null. */
export function naverCreds(): NaverCreds | null {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}
```

- [ ] **Step 2: sync 라우트 테스트 작성(실패)**

Create `src/app/api/news/sync/route.test.ts`:
```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

function req() {
  return new Request("http://localhost/api/news/sync", { method: "POST" });
}

describe("POST /api/news/sync", () => {
  it("DATABASE_URL이 없으면 503", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("NAVER_CLIENT_ID", "a");
    vi.stubEnv("NAVER_CLIENT_SECRET", "b");
    const res = await POST(req());
    expect(res.status).toBe(503);
  });

  it("네이버 키가 없으면 503", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://x");
    vi.stubEnv("NAVER_CLIENT_ID", "");
    vi.stubEnv("NAVER_CLIENT_SECRET", "");
    const res = await POST(req());
    expect(res.status).toBe(503);
  });
});
```

- [ ] **Step 3: sync 테스트 실패 확인**

Run: `npx vitest run src/app/api/news/sync/route.test.ts`
Expected: FAIL — 라우트 없음.

- [ ] **Step 4: GET /api/news 라우트 작성**

Create `src/app/api/news/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
import { listFeed } from "@/lib/server/news-repo";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) {
    return NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });
  }
  const feed = await listFeed(pool);
  return NextResponse.json({ feed });
}
```

- [ ] **Step 5: POST /api/news/sync 라우트 작성**

Create `src/app/api/news/sync/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
import { naverCreds } from "@/lib/server/news-config";
import { syncAll } from "@/lib/server/news-sync";

export const runtime = "nodejs";

export async function POST(_req: Request): Promise<NextResponse> {
  const pool = getPool();
  const creds = naverCreds();
  if (!pool || !creds) {
    return NextResponse.json(
      { error: "DATABASE_URL 또는 NAVER_CLIENT_ID/SECRET 미설정" },
      { status: 503 }
    );
  }
  const results = await syncAll(pool, creds);
  const inserted = results.reduce((s, r) => s + r.inserted, 0);
  return NextResponse.json({ results, inserted });
}
```

- [ ] **Step 6: sync 테스트 통과 확인**

Run: `npx vitest run src/app/api/news/sync/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: keywords 라우트 테스트 작성(실패)**

Create `src/app/api/news/keywords/route.test.ts`:
```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

function req(body: unknown) {
  return new Request("http://localhost/api/news/keywords", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/news/keywords", () => {
  it("DATABASE_URL이 없으면 503", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const res = await POST(req({ keyword: "금리" }));
    expect(res.status).toBe(503);
  });

  it("빈 키워드면 400", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://x");
    const res = await POST(req({ keyword: "  " }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 8: keywords 테스트 실패 확인**

Run: `npx vitest run src/app/api/news/keywords/route.test.ts`
Expected: FAIL — 라우트 없음.

- [ ] **Step 9: POST /api/news/keywords 라우트 작성**

Create `src/app/api/news/keywords/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
import { naverCreds } from "@/lib/server/news-config";
import { addKeyword, upsertItems } from "@/lib/server/news-repo";
import { fetchNews } from "@/lib/server/naver-news";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) {
    return NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });
  }
  const body = await req.json().catch(() => null);
  const keyword = typeof body?.keyword === "string" ? body.keyword.trim() : "";
  if (!keyword) {
    return NextResponse.json({ error: "keyword가 필요합니다" }, { status: 400 });
  }

  const kw = await addKeyword(pool, keyword);

  // 추가 즉시 한 번 조회해 채운다(키가 있을 때만). 실패해도 키워드 추가는 유지.
  const creds = naverCreds();
  if (creds) {
    try {
      const items = await fetchNews(keyword, creds);
      await upsertItems(pool, kw.id, items);
    } catch {
      // 무시 — 이후 [업데이트]로 재시도 가능
    }
  }

  return NextResponse.json({ keyword: kw });
}
```

- [ ] **Step 10: DELETE /api/news/keywords/[id] 라우트 작성**

Create `src/app/api/news/keywords/[id]/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
import { deleteKeyword } from "@/lib/server/news-repo";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) {
    return NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });
  }
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "잘못된 id" }, { status: 400 });
  }
  await deleteKeyword(pool, id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 11: keywords 테스트 통과 확인**

Run: `npx vitest run src/app/api/news/keywords/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 12: Commit**

```bash
git add src/lib/server/news-config.ts src/app/api/news
git commit -m "feat(news): api routes for feed, sync, keywords"
```

---

## Task 7: 상대 시간 포맷 헬퍼

**Files:**
- Modify: `src/lib/format.ts` (파일 끝에 추가)
- Test: `src/lib/format.test.ts` (케이스 추가)

- [ ] **Step 1: 실패하는 테스트 추가**

Append to `src/lib/format.test.ts` (기존 import에 `fmtRelative` 추가, describe 블록 추가):
```typescript
import { fmtRelative } from "./format";

describe("fmtRelative", () => {
  const now = new Date("2026-07-27T12:00:00.000Z");

  it("1분 미만은 '방금 전'", () => {
    expect(fmtRelative("2026-07-27T11:59:30.000Z", now)).toBe("방금 전");
  });
  it("분 단위", () => {
    expect(fmtRelative("2026-07-27T11:30:00.000Z", now)).toBe("30분 전");
  });
  it("시간 단위", () => {
    expect(fmtRelative("2026-07-27T09:00:00.000Z", now)).toBe("3시간 전");
  });
  it("일 단위", () => {
    expect(fmtRelative("2026-07-25T12:00:00.000Z", now)).toBe("2일 전");
  });
  it("파싱 불가면 빈 문자열", () => {
    expect(fmtRelative("nope", now)).toBe("");
  });
});
```
(파일 상단 import에 이미 다른 심볼을 불러오고 있으면 `fmtRelative`만 추가한다.)

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/format.test.ts`
Expected: FAIL — `fmtRelative`가 없음.

- [ ] **Step 3: 구현 추가**

Append to `src/lib/format.ts`:
```typescript
/** ISO 시각 → "방금 전 / N분 전 / N시간 전 / N일 전". 파싱 불가면 "". */
export function fmtRelative(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diffMin = Math.max(0, Math.floor((now.getTime() - t) / 60000));
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}시간 전`;
  return `${Math.floor(diffHr / 24)}일 전`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/format.test.ts`
Expected: PASS (기존 + 신규 5).

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.ts src/lib/format.test.ts
git commit -m "feat(news): add fmtRelative time helper"
```

---

## Task 8: `/news` 페이지 + 네비 링크

**Files:**
- Create: `src/app/news/page.tsx`
- Modify: `src/components/Nav.tsx` (ROUTES에 뉴스 추가)

칩 탭 필터(전체 기본) + 세로 섹션 피드. `PageHeader`/`EmptyState` 재사용, 서브 컴포넌트는 같은 파일(`journal/page.tsx` 패턴).

- [ ] **Step 1: 네비 링크 추가**

In `src/components/Nav.tsx`, `ROUTES` 배열에 밸류체인 앞에 한 줄 추가:
```typescript
const ROUTES = [
  { href: "/", label: "대시보드" },
  { href: "/portfolio", label: "포트폴리오" },
  { href: "/screener", label: "스크리너" },
  { href: "/journal", label: "매매일지" },
  { href: "/news", label: "뉴스" },
  { href: "/valuechain", label: "밸류체인" },
];
```

- [ ] **Step 2: 페이지 작성**

Create `src/app/news/page.tsx`:
```tsx
"use client";

// 뉴스 키워드 대시보드(/news). 키워드=검색어 분류, 상단 칩 탭 필터 + 세로 섹션 피드.
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { fmtRelative } from "@/lib/format";
import type { NewsFeedGroup } from "@/lib/types";

export default function NewsPage() {
  const [feed, setFeed] = useState<NewsFeedGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [configMissing, setConfigMissing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<number | "all">("all");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState("");

  async function load() {
    const res = await fetch("/api/news");
    if (res.status === 503) {
      setConfigMissing(true);
      setLoading(false);
      return;
    }
    const body = await res.json();
    setFeed(body.feed ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/news/sync", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      await load();
      setToast(res.ok ? `신규 ${body.inserted ?? 0}건 반영` : "갱신 실패");
    } finally {
      setSyncing(false);
      setTimeout(() => setToast(""), 3000);
    }
  }

  async function handleAdd() {
    const keyword = draft.trim();
    setDraft("");
    setAdding(false);
    if (!keyword) return;
    await fetch("/api/news/keywords", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keyword }),
    });
    await load();
  }

  async function handleDelete(id: number) {
    await fetch(`/api/news/keywords/${id}`, { method: "DELETE" });
    if (filter === id) setFilter("all");
    await load();
  }

  if (configMissing) {
    return (
      <div>
        <PageHeader kicker="news" title="뉴스" />
        <EmptyState
          title="설정이 필요합니다"
          hint="서버에 DATABASE_URL, NAVER_CLIENT_ID, NAVER_CLIENT_SECRET를 설정하세요."
        />
      </div>
    );
  }

  const shown =
    filter === "all" ? feed : feed.filter((g) => g.keyword.id === filter);

  return (
    <div>
      <PageHeader kicker="news" title="뉴스">
        <button
          onClick={handleSync}
          disabled={syncing}
          className="rounded-lg border border-accent bg-accent/10 px-3 py-1.5 text-sm text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
        >
          {syncing ? "갱신 중…" : "↻ 업데이트"}
        </button>
      </PageHeader>

      {toast && (
        <p className="mb-4 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-muted">
          {toast}
        </p>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Chip label="전체" active={filter === "all"} onClick={() => setFilter("all")} />
        {feed.map((g) => (
          <Chip
            key={g.keyword.id}
            label={g.keyword.keyword}
            active={filter === g.keyword.id}
            onClick={() => setFilter(g.keyword.id)}
          />
        ))}
        {adding ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
              if (e.key === "Escape") {
                setAdding(false);
                setDraft("");
              }
            }}
            onBlur={handleAdd}
            placeholder="키워드 입력 후 Enter"
            className="rounded-full border border-accent bg-bg px-3 py-1.5 text-sm outline-none"
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="rounded-full border border-dashed border-line px-3 py-1.5 text-sm text-muted transition-colors hover:text-ink"
          >
            + 키워드
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted">불러오는 중…</p>
      ) : feed.length === 0 ? (
        <EmptyState
          title="아직 키워드가 없습니다"
          hint="관심 있는 키워드를 추가하면 관련 뉴스를 모아 보여줍니다."
        />
      ) : (
        <div className="space-y-6">
          {shown.map((g) => (
            <NewsSection
              key={g.keyword.id}
              group={g}
              onDelete={() => handleDelete(g.keyword.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
        active
          ? "border-accent bg-accent/10 text-accent"
          : "border-line text-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function NewsSection({
  group,
  onDelete,
}: {
  group: NewsFeedGroup;
  onDelete: () => void;
}) {
  return (
    <section className="group rounded-xl2 border border-line bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-serif text-lg font-semibold text-accent">
          {group.keyword.keyword}
          <span className="ml-2 text-sm font-normal text-muted">
            {group.items.length}건
          </span>
        </h2>
        <button
          onClick={onDelete}
          aria-label="키워드 삭제"
          className="text-xs text-muted opacity-0 transition-opacity hover:text-loss group-hover:opacity-100"
        >
          삭제
        </button>
      </div>
      {group.items.length === 0 ? (
        <p className="text-sm text-muted">
          아직 수집된 뉴스가 없습니다. [업데이트]를 눌러보세요.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {group.items.map((it) => (
            <li key={it.id} className="py-2.5">
              <a
                href={it.originalLink ?? it.link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium leading-snug text-ink transition-colors hover:text-accent"
              >
                {it.title}
              </a>
              <p className="tabular mt-0.5 text-xs text-muted">
                {it.source ?? "출처 미상"}
                {it.pubDate ? ` · ${fmtRelative(it.pubDate)}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 3: 전체 테스트 + 타입체크 + 빌드**

Run:
```bash
npx vitest run
npx tsc --noEmit
npm run build
```
Expected: 모든 테스트 PASS, 타입 에러 없음, 빌드 성공(`/news` 라우트 포함).

- [ ] **Step 4: Commit**

```bash
git add src/app/news/page.tsx src/components/Nav.tsx
git commit -m "feat(news): /news page with chip filter + section feed, nav link"
```

---

## Task 9: 환경설정 · DB 적용 · 수동 검증 · cron

**Files:**
- Modify: `.env.local` (실제 키 입력 — 커밋하지 않음)
- Modify: `README.md` (뉴스 설정 섹션 추가)

- [ ] **Step 1: 네이버 키 발급 + env 설정**

1. https://developers.naver.com → 애플리케이션 등록 → "검색" API 사용 → Client ID/Secret 발급.
2. Coolify에서 PostgreSQL 리소스 생성 → 접속 문자열 확보.
3. `.env.local`에 추가(값은 실제 발급값):
```
NAVER_CLIENT_ID=발급값
NAVER_CLIENT_SECRET=발급값
DATABASE_URL=postgres://user:pass@host:5432/dbname
```

- [ ] **Step 2: 스키마 적용**

Run(로컬에서 Coolify DB로 연결되는 경우):
```bash
psql "$DATABASE_URL" -f db/news-schema.sql
```
Expected: `news_keyword`, `news_item` 테이블 생성. (psql이 없으면 Coolify DB 콘솔에 `db/news-schema.sql` 내용을 붙여 실행.)

- [ ] **Step 3: 수동 검증 (실제 DB + 네이버)**

```bash
npm run dev
```
브라우저에서 확인:
1. `/news` 접속 → "아직 키워드가 없습니다" 빈 상태.
2. `+ 키워드` → "2차전지" 입력 Enter → 섹션이 생기고 뉴스가 채워짐(네이버 키가 있으면 즉시).
3. `↻ 업데이트` → "신규 N건 반영" 토스트, 목록 갱신.
4. 칩 `전체`/`2차전지` 토글로 필터 동작.
5. 기사 제목 클릭 → 원문 새 탭.
6. 키워드 `삭제` → 섹션 사라짐(뉴스도 연쇄 삭제).
7. 다시 `↻ 업데이트` → 같은 기사 중복 없이 신규만 증가(중복제거 확인).

- [ ] **Step 4: Coolify 매일 cron 설정**

Coolify의 Scheduled Task(또는 서버 crontab)에 매일 07:30 KST 실행 등록:
```bash
curl -fsS -X POST https://<배포도메인>/api/news/sync
```
Expected: 매일 자동으로 `syncAll` 실행, 신규 뉴스 누적.

- [ ] **Step 5: README에 설정 섹션 추가**

Append to `README.md`:
```markdown
## 뉴스 대시보드(/news)

- 네이버 검색 API 키(`NAVER_CLIENT_ID`/`NAVER_CLIENT_SECRET`)와 전용 PostgreSQL(`DATABASE_URL`)이 필요하다(서버 전용).
- 스키마: `db/news-schema.sql`을 DB에 1회 적용.
- 키워드=검색어=분류함. `[업데이트]` 버튼 또는 매일 cron이 `POST /api/news/sync`를 호출해 동기화한다.
- 매일 자동: Coolify Scheduled Task에서 `curl -X POST <도메인>/api/news/sync`.
```

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs(news): setup instructions for naver news dashboard"
```

---

## Self-Review (작성자 확인 완료)

**스펙 커버리지**
- 키워드별 분류 → Task 3/4 (키워드=검색어, `(keyword_id, link)` 저장). ✅
- 키워드 추가/삭제 → Task 6 (keywords 라우트) + Task 8 (UI). ✅
- [업데이트] 실시간 동기화 → Task 5 (syncAll) + Task 6 (sync 라우트) + Task 8 (버튼). ✅
- 매일 자동 → Task 9 Step 4 (Coolify cron). ✅
- PostgreSQL 저장 → Task 1/2/4. ✅
- 상단 칩 탭 + 세로 피드(B) → Task 8. ✅
- 설정 미비/부분 실패 처리 → Task 5, Task 6, Task 8 configMissing. ✅

**플레이스홀더 스캔:** 없음(모든 코드 스텝에 실제 코드).

**타입 일관성:** `NaverCreds{clientId,clientSecret}`, `Queryable.query`, `RawNewsItem`, `NewsFeedGroup{keyword,items}`, `SyncResult`가 전 태스크에서 일치. repo는 camelCase 매핑, 라우트는 `getPool`/`naverCreds` 공통 사용.

**남은 판단(스펙에서 기본값으로 확정):** cron 인증은 생략(개인용, YAGNI) — 필요 시 `CRON_SECRET` 헤더 검사를 sync 라우트에 추가하는 확장 지점만 남김.
