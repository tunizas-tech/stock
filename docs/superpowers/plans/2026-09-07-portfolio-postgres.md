# 보유종목·관심종목 Postgres 이전 + Supabase 제거 (8단계) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 보유종목·관심종목을 매매일지와 같은 방식(서버 라우트 + `pg` repo + 런타임 감지 + localStorage 폴백 + 1회 이관 카드)으로 Coolify Postgres에 저장하고, Supabase를 코드·의존성·스키마에서 제거한다.

**Architecture:** 7단계 일지 패턴을 그대로 복제한다. `db/portfolio-schema.sql` → `src/lib/server/portfolio-repo.ts` → `/api/holdings`·`/api/watchlist` 라우트 → `src/lib/portfolio-client.ts` → `data.ts`의 6메서드가 `detectStorageMode()`로 분기. 프로브는 `GET /api/storage/mode`로 이름을 바꾸고 옛 `/api/journal/mode`는 307 한 단계 남긴다. 페이지는 로딩·추가·삭제 실패를 한 줄로 보이고 이관 카드로 브라우저 기록을 올린다.

**Tech Stack:** Next.js 14 App Router (nodejs runtime routes), TypeScript, `pg`, vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-07-portfolio-postgres-design.md`

## Global Constraints

- 범위는 `holdings`·`watchlist`만. 일지 코드는 프로브 URL 변경 외에 건드리지 않는다.
- `id`는 서버가 `crypto.randomUUID()`; 이관 행은 브라우저 `id` 유지(1~64자). 날짜 컬럼은 `text`(`YYYY-MM-DD`).
- 라우트는 전부 Basic Auth 뒤(미들웨어 matcher가 `/api/*`를 덮는다), `runtime = "nodejs"`, `dynamic = "force-dynamic"`, 풀 없으면 503 `{ error: "DATABASE_URL 미설정" }`. Bearer 허용 목록(`agent-auth.ts`)은 **변경하지 않는다**.
- 검증은 타입·enum만: `market ∈ KR|US`, `ticker` `TICKER_RE`, `name` 1~60자, `shares` 유한수 `> 0`, `avgPrice` 유한수 `>= 0`, `openedAt`/`addedAt` `DATE_RE`, `memo` 문자열 ≤ 500자.
- 행↔타입 변환은 `portfolio-repo.ts` 한 곳. `null` → 키 없음, 숫자는 `Number()`.
- `storage-mode.ts`의 "실패는 캐시하지 않는다" 규칙 유지. `GET /api/storage/mode`는 항상 200.
- 이관: 시드(`h1`·`h2`·`w1`·`w2`) 제외, skip-and-report, **올라간 행만 로컬에서 지운다**(`splitImportResult` 재사용).
- 페이지 오류 문구: 로딩 실패 `"서버에서 보유·관심종목을 불러오지 못했습니다 — DATABASE_URL·db/portfolio-schema.sql을 적용했는지 확인하세요."`, 쓰기 실패는 `e.message`. 무한 로딩 금지.
- `grep -rn supabase src package.json` → 0건이 완료 조건. 과거 설계 문서(`docs/superpowers/**`)는 건드리지 않는다.
- 주석은 기존 코드처럼 국문으로 "왜". 커밋 트레일러:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_013P2fJR2eNjh72WPmca87FV`
- 검증: `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` 전부 통과.

---

## File Structure

| 파일 | 책임 | Task |
|---|---|---|
| `db/portfolio-schema.sql` | 두 테이블 스키마 | 1 |
| `src/lib/portfolio/validate.ts` (+test) | `parseHolding`, `parseWatch` 순수 검증 | 1 |
| `src/lib/server/portfolio-repo.ts` (+test) | SQL + 행 변환 8함수 | 2 |
| `src/app/api/holdings/{route,[id]/route,import/route}.ts`, `src/app/api/watchlist/…`, `src/app/api/storage/mode/route.ts`, `src/app/api/journal/mode/route.ts`(307) (+tests) | 라우트 | 3 |
| `src/lib/portfolio-client.ts` (+test), `src/lib/import-split.ts`(제네릭화), `src/lib/storage-mode.ts`, `src/lib/data.ts` | 클라이언트 | 4 |
| `src/app/portfolio/page.tsx`, `src/app/screener/page.tsx`, `src/app/page.tsx`, `src/components/ImportCard.tsx` | 화면 | 5 |
| `package.json`, `src/lib/supabase.ts`(삭제), `supabase/`(삭제), `src/lib/types.ts`·`data.ts` 주석, `README.md`, `docs/deploy-coolify.md` | Supabase 제거·문서 | 6 |

---

### Task 1: 스키마 + 검증 순수 함수

**Files:**
- Create: `db/portfolio-schema.sql`, `src/lib/portfolio/validate.ts`, `src/lib/portfolio/validate.test.ts`

**Interfaces:**
- Consumes: `TICKER_RE`, `DATE_RE`, `ParseResult<T>` from `src/lib/journal/validate.ts`; `Holding`, `WatchItem` from `src/lib/types.ts`.
- Produces: `parseHolding(body: unknown): ParseResult<Omit<Holding,"id">>`, `parseWatch(body: unknown): ParseResult<Omit<WatchItem,"id">>`, `parseImportId(raw: unknown): string | undefined` (1~64자 문자열이면 그 값).

- [ ] **Step 1: 실패하는 테스트 — `src/lib/portfolio/validate.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { parseHolding, parseImportId, parseWatch } from "./validate";

const H = { market: "KR", ticker: "005930", name: "삼성전자", shares: 10, avgPrice: 70000, openedAt: "2026-09-01" };
const W = { market: "US", ticker: "NVDA", name: "엔비디아", memo: "", addedAt: "2026-09-01" };

describe("parseHolding", () => {
  it("정상 입력은 그대로", () => {
    const r = parseHolding(H);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(H);
  });
  it.each([
    ["market", { market: "JP" }],
    ["ticker", { ticker: "12345" }],
    ["ticker", { ticker: "nvda" }],
    ["name", { name: "" }],
    ["name", { name: "x".repeat(61) }],
    ["shares", { shares: 0 }],
    ["shares", { shares: -1 }],
    ["shares", { shares: "10" }],
    ["shares", { shares: Infinity }],
    ["avgPrice", { avgPrice: -1 }],
    ["avgPrice", { avgPrice: null }],
    ["openedAt", { openedAt: "2026/09/01" }],
  ])("%s 위반 → field=%s", (field, patch) => {
    const r = parseHolding({ ...H, ...patch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe(field);
  });
  it("소수 주식(미국)은 허용", () => {
    expect(parseHolding({ ...H, market: "US", ticker: "AAPL", shares: 0.5 }).ok).toBe(true);
  });
  it("avgPrice 0은 허용(무상 취득)", () => {
    expect(parseHolding({ ...H, avgPrice: 0 }).ok).toBe(true);
  });
});

describe("parseWatch", () => {
  it("정상 입력·memo 생략 시 빈 문자열", () => {
    const r = parseWatch({ ...W, memo: undefined });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.memo).toBe("");
  });
  it.each([
    ["memo", { memo: "x".repeat(501) }],
    ["memo", { memo: 3 }],
    ["addedAt", { addedAt: "" }],
    ["ticker", { ticker: "ABCDEF" }],
  ])("%s 위반 → field=%s", (field, patch) => {
    const r = parseWatch({ ...W, ...patch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe(field);
  });
});

describe("parseImportId", () => {
  it("1~64자 문자열만", () => {
    expect(parseImportId("h-1")).toBe("h-1");
    expect(parseImportId("")).toBeUndefined();
    expect(parseImportId("x".repeat(65))).toBeUndefined();
    expect(parseImportId(3)).toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/portfolio` → FAIL (모듈 없음)

- [ ] **Step 3: `src/lib/portfolio/validate.ts`**

```ts
// 보유·관심종목 서버 문의 본문 검증(8단계 설계 §2) — 타입·enum만 본다. 순수 함수.
// 업무 규칙(중복 종목 금지 등)은 두지 않는다 — 옛 브라우저 기록 이관이 막히면 안 된다.
import type { Holding, WatchItem } from "@/lib/types";
import { DATE_RE, TICKER_RE, type ParseResult } from "@/lib/journal/validate";

const fail = (field: string, error: string): ParseResult<never> => ({ ok: false, field, error });
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function common(b: Record<string, unknown>): ParseResult<{ market: "KR" | "US"; ticker: string; name: string }> {
  if (b.market !== "KR" && b.market !== "US") return fail("market", "KR 또는 US");
  if (typeof b.ticker !== "string" || !TICKER_RE.test(b.ticker)) return fail("ticker", "6자리 숫자 또는 1~5자리 대문자");
  if (typeof b.name !== "string" || b.name.length === 0 || b.name.length > 60) return fail("name", "1~60자");
  return { ok: true, value: { market: b.market, ticker: b.ticker, name: b.name } };
}

export function parseHolding(body: unknown): ParseResult<Omit<Holding, "id">> {
  const b = (body ?? {}) as Record<string, unknown>;
  const c = common(b);
  if (!c.ok) return c;
  if (!isFiniteNumber(b.shares) || b.shares <= 0) return fail("shares", "0보다 큰 숫자");
  if (!isFiniteNumber(b.avgPrice) || b.avgPrice < 0) return fail("avgPrice", "0 이상 숫자");
  if (typeof b.openedAt !== "string" || !DATE_RE.test(b.openedAt)) return fail("openedAt", "YYYY-MM-DD");
  return { ok: true, value: { ...c.value, shares: b.shares, avgPrice: b.avgPrice, openedAt: b.openedAt } };
}

export function parseWatch(body: unknown): ParseResult<Omit<WatchItem, "id">> {
  const b = (body ?? {}) as Record<string, unknown>;
  const c = common(b);
  if (!c.ok) return c;
  const memo = b.memo === undefined || b.memo === null ? "" : b.memo;
  if (typeof memo !== "string" || memo.length > 500) return fail("memo", "500자 이하 문자열");
  if (typeof b.addedAt !== "string" || !DATE_RE.test(b.addedAt)) return fail("addedAt", "YYYY-MM-DD");
  return { ok: true, value: { ...c.value, memo, addedAt: b.addedAt } };
}

/** 이관 행의 id — 브라우저가 만든 값을 그대로 쓰되 길이만 막는다(SQL 파라미터·URL 인코딩으로만 쓰여 탐색 위험은 없다). */
export function parseImportId(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.length >= 1 && raw.length <= 64 ? raw : undefined;
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run src/lib/portfolio` → PASS

- [ ] **Step 5: `db/portfolio-schema.sql`** — 스펙 §1의 SQL을 그대로(머리 주석 2줄 포함, `create index … if not exists` 2개).

- [ ] **Step 6: 커밋**

```bash
git add db/portfolio-schema.sql src/lib/portfolio
git commit -m "feat(portfolio): 보유·관심종목 Postgres 스키마 + 순수 검증 (8단계 Task 1)"
```

---

### Task 2: 서버 저장소 `portfolio-repo.ts`

**Files:**
- Create: `src/lib/server/portfolio-repo.ts`, `src/lib/server/portfolio-repo.test.ts`

**Interfaces:**
- Consumes: `Queryable` (`src/lib/server/db.ts`).
- Produces:
  ```ts
  holdingRow(row): Holding · watchRow(row): WatchItem
  listHoldings(q): Promise<Holding[]>                 // "openedAt" desc, id desc
  insertHolding(q, h: Holding): Promise<Holding>
  deleteHolding(q, id): Promise<boolean>
  importHoldings(q, rows: Holding[]): Promise<{ inserted: number; skipped: number }>
  listWatch(q) · insertWatch(q, w) · deleteWatch(q, id) · importWatch(q, rows)   // "addedAt" desc
  ```

- [ ] **Step 1: 실패하는 테스트 — `src/lib/server/portfolio-repo.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "./db";
import { deleteHolding, holdingRow, importWatch, insertHolding, insertWatch, listHoldings, listWatch, watchRow } from "./portfolio-repo";

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

const HROW = { id: "h1", market: "KR", ticker: "005930", name: "삼성전자", shares: "30", avgPrice: 71200, openedAt: "2025-11-04" };
const WROW = { id: "w1", market: "US", ticker: "NVDA", name: "엔비디아", memo: null, addedAt: "2026-01-02" };

describe("row 변환", () => {
  it("숫자 문자열은 Number로, memo null은 빈 문자열로", () => {
    expect(holdingRow(HROW)).toEqual({ id: "h1", market: "KR", ticker: "005930", name: "삼성전자", shares: 30, avgPrice: 71200, openedAt: "2025-11-04" });
    expect(watchRow(WROW).memo).toBe("");
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
  it("보유 7개·관심 6개 파라미터를 컬럼 순서대로 넘긴다", async () => {
    const a = fakeQ([{ rows: [HROW], rowCount: 1 }]);
    await insertHolding(a.q, holdingRow(HROW));
    expect(a.calls[0].params).toEqual(["h1", "KR", "005930", "삼성전자", 30, 71200, "2025-11-04"]);
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
```

- [ ] **Step 2: 실패 확인** → FAIL

- [ ] **Step 3: `src/lib/server/portfolio-repo.ts`**

```ts
// 보유·관심종목 Postgres 저장소(8단계 설계 §2). 서버 전용. 행 <-> 타입 변환은 이 파일 밖에서 하지 않는다
// — pg는 double precision을 number로 주지만 numeric/count는 문자열로 주고 NULL은 null로 준다(journal-repo와 같은 이유).
import type { Queryable } from "./db";
import type { Holding, WatchItem } from "../types";

const H_COLS = 'id, market, ticker, name, shares, "avgPrice", "openedAt"';
const W_COLS = 'id, market, ticker, name, memo, "addedAt"';

export function holdingRow(row: Record<string, unknown>): Holding {
  return {
    id: String(row.id), market: row.market as Holding["market"], ticker: String(row.ticker), name: String(row.name),
    shares: Number(row.shares), avgPrice: Number(row.avgPrice), openedAt: String(row.openedAt),
  };
}
export function watchRow(row: Record<string, unknown>): WatchItem {
  return {
    id: String(row.id), market: row.market as WatchItem["market"], ticker: String(row.ticker), name: String(row.name),
    memo: row.memo === null || row.memo === undefined ? "" : String(row.memo), addedAt: String(row.addedAt),
  };
}

const hParams = (h: Holding): unknown[] => [h.id, h.market, h.ticker, h.name, h.shares, h.avgPrice, h.openedAt];
const wParams = (w: WatchItem): unknown[] => [w.id, w.market, w.ticker, w.name, w.memo ?? "", w.addedAt];
const H_INSERT = `insert into holdings (${H_COLS}) values ($1,$2,$3,$4,$5,$6,$7)`;
const W_INSERT = `insert into watchlist (${W_COLS}) values ($1,$2,$3,$4,$5,$6)`;

export async function listHoldings(q: Queryable): Promise<Holding[]> {
  const { rows } = await q.query(`select ${H_COLS} from holdings order by "openedAt" desc, id desc`);
  return rows.map(holdingRow);
}
export async function insertHolding(q: Queryable, h: Holding): Promise<Holding> {
  const { rows } = await q.query(`${H_INSERT} returning ${H_COLS}`, hParams(h));
  return holdingRow(rows[0]);
}
export async function deleteHolding(q: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await q.query(`delete from holdings where id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}
/** 브라우저 기록 이관 — 같은 id는 건너뛴다(두 번 눌러도 안전). */
export async function importHoldings(q: Queryable, rows: Holding[]): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  for (const h of rows) {
    const { rowCount } = await q.query(`${H_INSERT} on conflict (id) do nothing`, hParams(h));
    if ((rowCount ?? 0) > 0) inserted += 1;
  }
  return { inserted, skipped: rows.length - inserted };
}

export async function listWatch(q: Queryable): Promise<WatchItem[]> {
  const { rows } = await q.query(`select ${W_COLS} from watchlist order by "addedAt" desc, id desc`);
  return rows.map(watchRow);
}
export async function insertWatch(q: Queryable, w: WatchItem): Promise<WatchItem> {
  const { rows } = await q.query(`${W_INSERT} returning ${W_COLS}`, wParams(w));
  return watchRow(rows[0]);
}
export async function deleteWatch(q: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await q.query(`delete from watchlist where id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}
export async function importWatch(q: Queryable, rows: WatchItem[]): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  for (const w of rows) {
    const { rowCount } = await q.query(`${W_INSERT} on conflict (id) do nothing`, wParams(w));
    if ((rowCount ?? 0) > 0) inserted += 1;
  }
  return { inserted, skipped: rows.length - inserted };
}
```

- [ ] **Step 4: 통과 확인** → PASS. `npx tsc --noEmit`.
- [ ] **Step 5: 커밋** — `git add src/lib/server/portfolio-repo.ts src/lib/server/portfolio-repo.test.ts && git commit -m "feat(portfolio): Postgres 저장소 portfolio-repo (Task 2)"`

---

### Task 3: 라우트 — holdings·watchlist·storage/mode

**Files:**
- Create: `src/app/api/holdings/route.ts`, `src/app/api/holdings/[id]/route.ts`, `src/app/api/holdings/import/route.ts`, `src/app/api/watchlist/route.ts`, `src/app/api/watchlist/[id]/route.ts`, `src/app/api/watchlist/import/route.ts`, `src/app/api/storage/mode/route.ts`, `src/app/api/portfolio.test.ts`(라우트 테스트 한 파일)
- Modify: `src/app/api/journal/mode/route.ts` (307 → `/api/storage/mode`)

**Interfaces:**
- Consumes: Task 1 `parseHolding/parseWatch/parseImportId`, Task 2 repo, `getPool()`.
- Produces: 스펙 §2 표의 응답 모양. import 응답 `{ inserted, skipped, rejected: { index; id?; field; error }[] }`.

- [ ] **Step 1: 실패하는 테스트 — `src/app/api/portfolio.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = { pool: null as null | { query: ReturnType<typeof vi.fn> } };
vi.mock("@/lib/server/db", () => ({ getPool: () => state.pool }));

import { GET as HGET, POST as HPOST } from "./holdings/route";
import { DELETE as HDEL } from "./holdings/[id]/route";
import { POST as HIMPORT } from "./holdings/import/route";
import { GET as WGET, POST as WPOST } from "./watchlist/route";
import { POST as WIMPORT } from "./watchlist/import/route";
import { GET as MODE } from "./storage/mode/route";
import { GET as OLDMODE } from "./journal/mode/route";

const HROW = { id: "h1", market: "KR", ticker: "005930", name: "삼성전자", shares: 30, avgPrice: 71200, openedAt: "2025-11-04" };
const WROW = { id: "w1", market: "US", ticker: "NVDA", name: "엔비디아", memo: "", addedAt: "2026-01-02" };
const req = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => { state.pool = { query: vi.fn(async () => ({ rows: [HROW], rowCount: 1 })) }; });
afterEach(() => vi.clearAllMocks());

describe("storage/mode", () => {
  it("풀 있으면 server, 없으면 local — 둘 다 200", async () => {
    expect(await (await MODE()).json()).toEqual({ mode: "server" });
    state.pool = null;
    const res = await MODE();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: "local" });
  });
  it("옛 /api/journal/mode는 307로 새 경로를 가리킨다", async () => {
    const res = await OLDMODE(req("GET", "/api/journal/mode"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/api\/storage\/mode$/);
  });
});

describe("holdings", () => {
  it("GET → {holdings}", async () => {
    expect((await (await HGET()).json()).holdings[0].id).toBe("h1");
  });
  it("POST는 id를 서버가 채우고 201", async () => {
    const { id: _omit, ...draft } = HROW; void _omit;
    const res = await HPOST(req("POST", "/api/holdings", { ...draft, id: "attacker" }));
    expect(res.status).toBe(201);
    const params = state.pool!.query.mock.calls[0][1] as unknown[];
    expect(params[0]).not.toBe("attacker");
    expect(typeof params[0]).toBe("string");
  });
  it("shares 0 → 400 field=shares", async () => {
    const res = await HPOST(req("POST", "/api/holdings", { ...HROW, shares: 0 }));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("shares");
  });
  it("DELETE 204 / 없는 id 404", async () => {
    expect((await HDEL(req("DELETE", "/api/holdings/h1"), { params: { id: "h1" } })).status).toBe(204);
    state.pool!.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect((await HDEL(req("DELETE", "/api/holdings/zzz"), { params: { id: "zzz" } })).status).toBe(404);
  });
  it("풀 없으면 503", async () => {
    state.pool = null;
    expect((await HGET()).status).toBe(503);
  });
  it("import는 거절 행을 index와 함께 보고하고 나머지는 넣는다", async () => {
    state.pool!.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await HIMPORT(req("POST", "/api/holdings/import", { rows: [HROW, { ...HROW, id: "h2", shares: -1 }, { ...HROW, id: "" }] }));
    const body = await res.json();
    expect(body.inserted).toBe(1);
    expect(body.rejected.map((r: { index: number; field: string }) => [r.index, r.field])).toEqual([[1, "shares"], [2, "id"]]);
  });
});

describe("watchlist", () => {
  beforeEach(() => { state.pool = { query: vi.fn(async () => ({ rows: [WROW], rowCount: 1 })) }; });
  it("GET → {watchlist}; POST 201; memo 생략 허용", async () => {
    expect((await (await WGET()).json()).watchlist[0].id).toBe("w1");
    const res = await WPOST(req("POST", "/api/watchlist", { market: "US", ticker: "NVDA", name: "엔비디아", addedAt: "2026-01-02" }));
    expect(res.status).toBe(201);
  });
  it("import 응답 모양", async () => {
    const body = await (await WIMPORT(req("POST", "/api/watchlist/import", { rows: [WROW] }))).json();
    expect(body).toEqual({ inserted: 1, skipped: 0, rejected: [] });
  });
  it("rows가 배열이 아니면 400", async () => {
    expect((await WIMPORT(req("POST", "/api/watchlist/import", { rows: "no" }))).status).toBe(400);
  });
});
```

- [ ] **Step 2: 실패 확인** → FAIL

- [ ] **Step 3: 라우트 구현**

`src/app/api/storage/mode/route.ts`:
```ts
// 저장 백엔드 프로브(8단계부터 세 테이블 공용). 항상 200 — DATABASE_URL 없음은 오류가 아니라 "local"이라는 답이다.
import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ mode: getPool() ? "server" : "local" });
}
```

`src/app/api/journal/mode/route.ts` (내용 교체):
```ts
// 7단계의 옛 경로. 8단계에서 /api/storage/mode로 옮겼다 — 배포 직후 옛 JS를 든 탭이 여기를 부르면
// 404로 localStorage 모드에 갇히므로 한 단계만 307로 넘긴다. 다음 단계에서 이 파일을 지운다.
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request): Promise<NextResponse> {
  return NextResponse.redirect(new URL("/api/storage/mode", req.url), 307);
}
```

`src/app/api/holdings/route.ts`:
```ts
// 보유종목 서버 문(8단계 설계 §2) — Basic Auth 뒤. id는 서버가 정한다(본문 id 무시).
import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
import { insertHolding, listHoldings } from "@/lib/server/portfolio-repo";
import { parseHolding } from "@/lib/portfolio/validate";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_DB = () => NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });

export async function GET(): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) return NO_DB();
  return NextResponse.json({ holdings: await listHoldings(pool) });
}
export async function POST(req: Request): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) return NO_DB();
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "잘못된 본문", field: "body" }, { status: 400 }); }
  const parsed = parseHolding(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });
  return NextResponse.json(await insertHolding(pool, { ...parsed.value, id: crypto.randomUUID() }), { status: 201 });
}
```

`src/app/api/holdings/[id]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
import { deleteHolding } from "@/lib/server/portfolio-repo";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function DELETE(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });
  const ok = await deleteHolding(pool, params.id);
  return ok ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "없는 기록" }, { status: 404 });
}
```

`src/app/api/holdings/import/route.ts`:
```ts
// 브라우저 localStorage 보유종목 이관 — skip-and-report(7단계 I-6 교훈): 한 행이 틀려도 나머지는 올리고,
// 틀린 행은 index로 알려 브라우저가 그 행만 남겨 둔다.
import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
import { importHoldings } from "@/lib/server/portfolio-repo";
import { parseHolding, parseImportId } from "@/lib/portfolio/validate";
import type { Holding } from "@/lib/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });
  let body: { rows?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "잘못된 본문" }, { status: 400 }); }
  if (!Array.isArray(body.rows)) return NextResponse.json({ error: "rows 배열 필요", field: "rows" }, { status: 400 });
  const rows: Holding[] = [];
  const rejected: { index: number; id?: unknown; field: string; error: string }[] = [];
  (body.rows as Record<string, unknown>[]).forEach((raw, index) => {
    const id = parseImportId(raw?.id);
    if (id === undefined) { rejected.push({ index, id: raw?.id, field: "id", error: "1~64자 id 필요" }); return; }
    const parsed = parseHolding(raw);
    if (!parsed.ok) { rejected.push({ index, id, field: parsed.field, error: parsed.error }); return; }
    rows.push({ ...parsed.value, id });
  });
  const { inserted, skipped } = await importHoldings(pool, rows);
  return NextResponse.json({ inserted, skipped, rejected });
}
```

`src/app/api/watchlist/route.ts`, `[id]/route.ts`, `import/route.ts`: 위 세 파일과 같은 구조로 `parseWatch`·`listWatch/insertWatch/deleteWatch/importWatch`·응답 키 `watchlist`·타입 `WatchItem`으로 바꿔 쓴다(복사 후 치환; 주석은 "관심종목"으로).

- [ ] **Step 4: 통과 확인** — `npx vitest run src/app/api/portfolio.test.ts src/app/api/journal` → PASS(기존 journal 라우트 테스트의 mode 케이스가 있다면 307로 갱신). `npx tsc --noEmit`, `npm run build`(8개 라우트 등록 확인).
- [ ] **Step 5: 커밋** — `git add src/app/api && git commit -m "feat(portfolio): holdings·watchlist 라우트 + storage/mode 프로브(옛 경로 307) (Task 3)"`

---

### Task 4: 클라이언트 — `portfolio-client`·`data.ts` 분기·프로브 URL·이관 헬퍼 제네릭화

**Files:**
- Create: `src/lib/portfolio-client.ts`, `src/lib/portfolio-client.test.ts`, `src/lib/import-split.ts`, `src/lib/import-split.test.ts`
- Modify: `src/lib/journal-import.ts`(→ 제네릭 재export), `src/lib/storage-mode.ts:27`, `src/lib/data.ts:1-10,133-212`, `src/lib/journal-client.ts:46-50`(ImportResult를 공용으로 이동)

**Interfaces:**
- Produces:
  ```ts
  // import-split.ts
  interface ImportResult { inserted: number; skipped: number; rejected: { index: number; id?: unknown; field: string; error: string }[] }
  splitImportResult<T extends { id: string }>(localLeft: T[], result: ImportResult): { keep: T[]; message: string }
  // portfolio-client.ts
  fetchHoldings(): Promise<Holding[]> · postHolding(draft: Omit<Holding,"id">): Promise<Holding> · deleteHoldingEntry(id): Promise<void> · importHoldingRows(rows: Holding[]): Promise<ImportResult>
  fetchWatch() · postWatch(draft) · deleteWatchEntry(id) · importWatchRows(rows)
  // data.ts 추가
  db.localHoldingsForImport(): Holding[]   // h1·h2 제외
  db.localWatchForImport(): WatchItem[]    // w1·w2 제외
  db.replaceLocalHoldings(rows) · db.clearLocalHoldings() · db.replaceLocalWatch(rows) · db.clearLocalWatch()
  ```

- [ ] **Step 1: 실패하는 테스트**

`src/lib/import-split.test.ts` — 기존 `journal-import.test.ts`의 3케이스를 제네릭 함수로 옮겨 오고(값 동일) 하나 추가:
```ts
it("id가 있는 어떤 타입이든 같은 규칙으로 나눈다(보유종목)", () => {
  const local = [{ id: "a", shares: 1 }, { id: "b", shares: 2 }];
  const r = splitImportResult(local, { inserted: 1, skipped: 0, rejected: [{ index: 1, id: "b", field: "shares", error: "0보다 큰 숫자" }] });
  expect(r.keep).toEqual([{ id: "b", shares: 2 }]);
  expect(r.message).toMatch(/1건은 형식 오류로 이 브라우저에 남겨 둠 — shares/);
});
```
`src/lib/portfolio-client.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHoldings, postWatch } from "./portfolio-client";
afterEach(() => vi.restoreAllMocks());
describe("portfolio-client", () => {
  it("fetchHoldings는 holdings를 꺼낸다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ holdings: [{ id: "h" }] }), { status: 200 })));
    expect(await fetchHoldings()).toEqual([{ id: "h" }]);
  });
  it("실패는 field: error 메시지로 던진다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "YYYY-MM-DD", field: "addedAt" }), { status: 400 })));
    await expect(postWatch({} as never)).rejects.toThrow(/addedAt: YYYY-MM-DD/);
  });
});
```

- [ ] **Step 2: 실패 확인** → FAIL

- [ ] **Step 3: 구현**

`src/lib/import-split.ts` — `journal-import.ts`의 본문을 제네릭 `<T extends { id: string }>`로 옮기고 `ImportResult`를 여기서 export. `journal-import.ts`는 `export { splitImportResult, type ImportResult } from "./import-split";` 한 줄만 남긴다(기존 import 경로 유지). `journal-client.ts`는 `ImportResult`를 `./import-split`에서 import해 재export.

`src/lib/portfolio-client.ts`:
```ts
// 서버 모드에서 data.ts가 쓰는 얇은 HTTP 클라이언트(journal-client와 같은 규약). 실패는 Error로 던진다.
import type { Holding, WatchItem } from "./types";
import type { ImportResult } from "./import-split";

async function fail(res: Response): Promise<never> {
  let msg = `HTTP ${res.status}`;
  try { const b = await res.json(); if (b?.error) msg = b.field ? `${b.field}: ${b.error}` : b.error; } catch { /* 본문 없음 */ }
  throw new Error(msg);
}
const J = { "Content-Type": "application/json" };

export async function fetchHoldings(): Promise<Holding[]> {
  const res = await fetch("/api/holdings", { cache: "no-store" });
  if (!res.ok) return fail(res);
  return ((await res.json()) as { holdings: Holding[] }).holdings;
}
export async function postHolding(draft: Omit<Holding, "id">): Promise<Holding> {
  const res = await fetch("/api/holdings", { method: "POST", headers: J, body: JSON.stringify(draft) });
  if (!res.ok) return fail(res);
  return (await res.json()) as Holding;
}
export async function deleteHoldingEntry(id: string): Promise<void> {
  const res = await fetch(`/api/holdings/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) return fail(res);
}
export async function importHoldingRows(rows: Holding[]): Promise<ImportResult> {
  const res = await fetch("/api/holdings/import", { method: "POST", headers: J, body: JSON.stringify({ rows }) });
  if (!res.ok) return fail(res);
  return (await res.json()) as ImportResult;
}
export async function fetchWatch(): Promise<WatchItem[]> {
  const res = await fetch("/api/watchlist", { cache: "no-store" });
  if (!res.ok) return fail(res);
  return ((await res.json()) as { watchlist: WatchItem[] }).watchlist;
}
export async function postWatch(draft: Omit<WatchItem, "id">): Promise<WatchItem> {
  const res = await fetch("/api/watchlist", { method: "POST", headers: J, body: JSON.stringify(draft) });
  if (!res.ok) return fail(res);
  return (await res.json()) as WatchItem;
}
export async function deleteWatchEntry(id: string): Promise<void> {
  const res = await fetch(`/api/watchlist/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) return fail(res);
}
export async function importWatchRows(rows: WatchItem[]): Promise<ImportResult> {
  const res = await fetch("/api/watchlist/import", { method: "POST", headers: J, body: JSON.stringify({ rows }) });
  if (!res.ok) return fail(res);
  return (await res.json()) as ImportResult;
}
```

`src/lib/storage-mode.ts:27` — `"/api/journal/mode"` → `"/api/storage/mode"`; 파일 머리 주석에 "세 테이블 공용".

`src/lib/data.ts` — 머리 주석을 "세 테이블 모두 서버(`/api/*`, Postgres) ↔ localStorage"로; `import { supabase } from "./supabase";` 삭제; `import { … } from "./portfolio-client";` 추가. 보유·관심 6메서드의 `if (supabase) {…}` 블록을 각각:
```ts
  async listHoldings(): Promise<Holding[]> {
    if ((await detectStorageMode()) === "server") return fetchHoldings();
    ensureSeed();
    return lsRead<Holding>(LS_KEYS.holdings);
  },
  async addHolding(input: Omit<Holding, "id">): Promise<Holding> {
    if ((await detectStorageMode()) === "server") return postHolding(input);
    /* localStorage 분기 그대로 */
  },
  async removeHolding(id: string): Promise<void> {
    if ((await detectStorageMode()) === "server") return deleteHoldingEntry(id);
    /* 그대로 */
  },
  // listWatch / addWatch / removeWatch 동일하게 fetchWatch / postWatch / deleteWatchEntry
```
그리고 이관 헬퍼 6개(일지의 `localJournalForImport/replaceLocalJournal/clearLocalJournal`와 같은 모양, 시드 id `SEED_HOLDINGS`/`SEED_WATCH` 기준 제외).

- [ ] **Step 4: 통과 확인** — `npx vitest run src/lib` → PASS(기존 `journal-import.test.ts`·`journal-client.test.ts` 그대로 통과). `npx tsc --noEmit`. `grep -n supabase src/lib/data.ts` → 0건.
- [ ] **Step 5: 커밋** — `git add src/lib && git commit -m "feat(portfolio): 보유·관심 저장을 서버 API로 — 클라이언트·분기·이관 헬퍼 제네릭화·프로브 URL (Task 4)"`

---

### Task 5: 화면 — 오류 표시·이관 카드

**Files:**
- Create: `src/components/ImportCard.tsx`
- Modify: `src/app/portfolio/page.tsx:22-40,60-100`, `src/app/screener/page.tsx:63-100`, `src/app/page.tsx:40-56`

**Interfaces:**
- Produces: `ImportCard({ label, rows, seedNote, onImport }: { label: string; rows: { id: string }[]; seedNote?: string; onImport: () => Promise<void> })` — `rows.length === 0`이면 null.

- [ ] **Step 1: `src/components/ImportCard.tsx`**

```tsx
"use client";
// 브라우저 localStorage 기록을 서버로 올리는 1회성 카드(8단계 §3). 일지(/journal)의 카드와 같은 문구 규칙:
// 올라간 행만 지우고, 예시 데이터는 올리지 않는다고 말한다.
export function ImportCard({ label, rows, seedNote, onImport }: {
  label: string; rows: { id: string }[]; seedNote?: string; onImport: () => Promise<void>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-6 rounded-xl2 border border-accent/40 bg-surface p-4 text-sm">
      <p className="text-ink">이 브라우저에 남아 있는 {label} <b>{rows.length}건</b>이 서버에 없습니다.</p>
      <p className="mt-1 text-xs text-muted">올라간 기록만 이 브라우저에서 지웁니다. 같은 기록은 두 번 들어가지 않습니다.{seedNote ? ` ${seedNote}` : ""}</p>
      <button onClick={onImport} className="mt-3 rounded-md border border-accent px-3 py-1.5 text-xs text-accent hover:bg-accent/10">서버로 올리기</button>
    </div>
  );
}
```

- [ ] **Step 2: `/portfolio`**

상태 추가: `const [error, setError] = useState<string | null>(null); const [mode, setMode] = useState<StorageMode>("local"); const [localH, setLocalH] = useState<Holding[]>([]); const [localW, setLocalW] = useState<WatchItem[]>([]); const [importMsg, setImportMsg] = useState<string | null>(null);`

`refresh()`를 `try { … } catch { setError(LOAD_ERROR) } finally { setLoading(false) }`로. `LOAD_ERROR = "서버에서 보유·관심종목을 불러오지 못했습니다 — DATABASE_URL·db/portfolio-schema.sql을 적용했는지 확인하세요."`. 마운트 시 `detectStorageMode().then((m) => { setMode(m); if (m === "server") { setLocalH(db.localHoldingsForImport()); setLocalW(db.localWatchForImport()); } })`.

삭제 핸들러 두 곳: `try { await db.removeHolding(id); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : "삭제 실패"); }` (관심도 동일). `PageHeader` 아래에 `{error && <p className="mb-4 text-xs text-loss">{error}</p>}`.

이관:
```tsx
async function importHoldings() {
  try {
    const r = await importHoldingRows(localH);
    const { keep, message } = splitImportResult(localH, r);
    if (keep.length === 0) db.clearLocalHoldings(); else db.replaceLocalHoldings(keep);
    setLocalH(keep); setImportMsg(message); await refresh();
  } catch (e) { setImportMsg(e instanceof Error ? e.message : "이관 실패"); }
}
// importWatch 동일(importWatchRows / clearLocalWatch / replaceLocalWatch)
```
보유 절 위에 `<ImportCard label="보유종목" rows={mode === "server" ? localH : []} seedNote="예시 데이터(삼성전자·엔비디아 등)는 올리지 않습니다 — 실제 보유면 직접 추가하세요." onImport={importHoldings} />`, 관심 절 위에 `label="관심종목"` 카드. `{importMsg && <p className="mb-4 text-xs text-muted">{importMsg}</p>}`.

(포트폴리오에 보유 추가 폼이 있다면 그 submit도 `try/catch` → `setError(e.message)`; 없으면 건너뛴다 — 파일에서 `db.addHolding` 호출 여부를 확인해 보고서에 적는다.)

- [ ] **Step 3: `/screener`** — `addToWatch`를 `try { await db.addWatch(…); setWatchedKeys(…) } catch (e) { setError(e instanceof Error ? e.message : "관심종목 추가 실패") }`; `error` 상태와 한 줄 표시를 결과 표 위에. `runScreen`의 `Promise.all` 실패도 같은 `setError(LOAD_ERROR)`.

- [ ] **Step 4: `/`(대시보드)** — `useEffect` 안 `Promise.all`을 `try/catch`로 감싸고 실패 시 `setError(LOAD_ERROR)`; 카운트 카드 위에 한 줄.

- [ ] **Step 5: 검증** — `npx tsc --noEmit`, `npm run lint`. 브라우저(DATABASE_URL 없음): `/portfolio`·`/screener`·`/`가 종전처럼 localStorage로 동작, 카드 없음, 콘솔 오류 0. 스크린샷 1장(`/portfolio`).
- [ ] **Step 6: 커밋** — `git add src/components/ImportCard.tsx src/app && git commit -m "feat(portfolio): 로딩·추가·삭제 실패 표시 + 이관 카드 (Task 5)"`

---

### Task 6: Supabase 제거 + 문서

**Files:**
- Delete: `src/lib/supabase.ts`, `supabase/` 디렉터리
- Modify: `package.json`(+`package-lock.json`), `src/lib/types.ts:1-2`, `README.md:42,48`, `docs/deploy-coolify.md:32-44,67,178-179` 및 저장소 표·§1

- [ ] **Step 1: 의존성·파일 제거**
```bash
npm uninstall @supabase/supabase-js
git rm -r supabase src/lib/supabase.ts
grep -rn "supabase" src package.json   # → 0건이어야 한다
```
- [ ] **Step 2: 주석·문서**
  - `src/lib/types.ts:1-2`: "Supabase 스키마" 문장을 "`db/*.sql`의 컬럼명도 이 타입과 일치(camelCase 컬럼은 따옴표)"로.
  - `README.md`: 42행을 "**`DATABASE_URL`**(Coolify Postgres) → localStorage 대신 서버 저장. `db/news-schema.sql`·`db/journal-schema.sql`·`db/portfolio-schema.sql`을 순서대로 1회 적용" / 48행을 "저장소 파사드(서버 API ↔ localStorage 런타임 분기)".
  - `docs/deploy-coolify.md`: 저장소 표에서 Supabase 열 삭제·"세 테이블 모두 Coolify Postgres"; §1에 `psql "$DATABASE_URL" -f db/portfolio-schema.sql` 추가(순서: news → journal → portfolio, **앱 재배포 전**); "Supabase에 매매일지 기록이 있었다면" 절은 "(7단계 배포 때 이미 처리했다면 건너뜀)" 한 줄을 달아 유지; 67행의 `NEXT_PUBLIC_SUPABASE_*` 각주 삭제; §8 확인에 `curl -u … /api/storage/mode` → `{"mode":"server"}`, `/api/holdings` → `{"holdings":[]}`; "다음에 만들 것"을 "8단계 완료 — 다음 후보: 에이전트 확신도 채점, KOSPI 파일 캐시"로.
- [ ] **Step 3: 검증** — `npm ci`(lock 정합), `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`.
- [ ] **Step 4: 커밋** — `git add -A package.json package-lock.json src/lib/types.ts README.md docs/deploy-coolify.md && git commit -m "chore: Supabase 제거 — 의존성·클라이언트·스키마, 문서를 Coolify Postgres로 (Task 6)"`

---

## Self-Review

**1. Spec coverage** — §1 스키마·id·날짜 text → T1 ✅ · §2 repo 8함수·라우트 8개·307·검증 → T1/T2/T3 ✅ · §3 client·data.ts·storage-mode URL·페이지 오류·이관 카드 문구·`splitImportResult` 재사용 → T4/T5 ✅ · §4 제거·문서 → T6 ✅ · §5 배포 순서 → T6 문서 ✅ · §6 테스트 목록 → 각 Task Step 1 ✅ (`grep supabase → 0` T6 Step 1) · §7 빈틈 4건 → T5 오류 핸들러(1), T3 307(2), T5 seedNote(3), T5 LOAD_ERROR 파일명 + T6 문서(4) ✅

**2. Placeholder scan** — Task 3의 "watchlist 세 파일은 같은 구조로 치환"과 Task 4의 "localStorage 분기 그대로"는 기존 코드를 지시하는 것으로 빈칸이 아니다. Task 5의 "보유 추가 폼이 있다면"은 조건부 지시.

**3. Type consistency** — `ParseResult`/`TICKER_RE`/`DATE_RE`는 `src/lib/journal/validate.ts`에 이미 존재 ✅ · `ImportResult`가 `import-split.ts`로 이동하되 `journal-client.ts`가 재export해 기존 import 유지 ✅ · `splitImportResult<T extends {id:string}>` 시그니처를 T5가 `Holding[]`/`WatchItem[]`로 호출 ✅ · 라우트 응답 키 `holdings`/`watchlist`를 client가 그대로 읽음 ✅ · `db.localHoldingsForImport` 등 6개 이름을 T4 정의·T5 사용 일치 ✅ · `StorageMode` 타입은 `storage-mode.ts` export 기존 ✅
