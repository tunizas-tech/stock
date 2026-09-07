# 에이전트 관망 기록 + 일지 Postgres 저장 (7단계) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매매일지를 Coolify Postgres에 저장하는 서버 API를 만들고, Hermes 에이전트가 `POST /api/journal/agent`로 하루 ≤3건의 "관망" 기록을 남기게 하며, 그 기록을 6단계 자기검증이 KOSPI 대조와 함께 채점하게 한다.

**Architecture:** 브라우저는 `/api/journal`(사람 문, Basic Auth)을 통해 Postgres에 쓰고 `DATABASE_URL`이 없으면 localStorage로 폴백한다(런타임 감지). 에이전트는 별도 문 `/api/journal/agent`(Bearer `AGENT_TOKEN`)로만 들어오며 서버가 `skip`·오늘 날짜·스냅샷을 강제한다. 채점은 `createdAt`이 그날 15:30 KST 이전이면 그날 종가 진입으로 바뀌고, 관망 절은 사람/에이전트로 나뉘어 같은 창 KOSPI와 비교된다.

**Tech Stack:** Next.js 14 App Router (nodejs runtime routes), TypeScript, `pg` 풀(`src/lib/server/db.ts` 기존), vitest, Tailwind. 스크립트는 Node 22 `.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-07-agent-journal-design.md`

## Global Constraints

- **매매는 절대 실행하지 않는다.** 에이전트 문은 `action: "skip"`만 만들며 `buy`/`sell`을 받으면 400.
- 쓰기 경로에서 KIS 등 실시간 API를 호출하지 않는다 — 스냅샷은 로컬 `data/`만.
- 범위는 `journal` 테이블만. 보유종목·관심종목의 Supabase 분기는 건드리지 않는다.
- 빌드에 굽는 `NEXT_PUBLIC_` 변수 추가 금지 — 백엔드 감지는 런타임 `GET /api/journal/mode`.
- 모든 날짜 판정은 `Asia/Seoul` 명시 계산(`src/lib/kst.ts`). 컨테이너 TZ는 UTC일 수 있다.
- 미들웨어 Bearer 허용은 정확히 `POST /api/journal/agent`, `GET /api/news`, `GET /api/observatory` 세 (메서드,경로)만.
- 사람 비밀번호(`APP_PASS`)를 에이전트 설정에 넣지 않는다. `AGENT_TOKEN` 비교는 `timingSafeEqual`.
- 컬럼명은 TS 필드명과 같다(camelCase는 따옴표). 행↔entry 변환은 `journal-repo.ts` 한 곳.
- `MIN_SAMPLE=20`, `DEFAULT_ROUND_TRIP=0.004`, 리뷰 시드 `20260907` 유지.
- 주석은 기존 코드처럼 국문으로 "왜"를 쓴다. 커밋 트레일러:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_013P2fJR2eNjh72WPmca87FV`
- 검증: `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` 전부 통과.

---

## File Structure

| 파일 | 책임 | Task |
|---|---|---|
| `src/lib/types.ts` | `author`, `sector`, ReasonTag `에이전트` | 1 |
| `src/lib/kst.ts` (+test) | `todayKst`, `kstDate`, `isAfterCloseKst` 순수 함수 | 1 |
| `db/journal-schema.sql` | Postgres 스키마(1회 적용) | 1 |
| `src/lib/server/journal-repo.ts` (+test) | SQL + 행↔entry 변환 | 2 |
| `src/app/api/journal/route.ts`, `mode/route.ts`, `[id]/route.ts`, `import/route.ts` (+test) | 사람 문 | 3 |
| `src/lib/storage-mode.ts`, `src/lib/journal-client.ts` (+test), `src/lib/data.ts`, `src/components/Nav.tsx`, `src/app/journal/page.tsx` | 클라이언트 전환·이관 카드 | 4 |
| `src/lib/server/agent-auth.ts` (+test), `src/middleware.ts` | Bearer 허용 목록 | 5 |
| `src/lib/server/snapshot-data.ts`, `src/lib/journal/agent-input.ts` (+test), `src/app/api/journal/agent/route.ts` (+test), `src/app/api/journal/snapshot/route.ts` | 에이전트 문 | 6 |
| `src/lib/journal/review.ts`, `settings.ts`, `src/app/api/journal/review/route.ts` (+tests) | createdAt 진입·관망 분리·KOSPI 대조·봉인 제외 | 7 |
| `src/app/journal/review/page.tsx`, `src/app/journal/page.tsx` | 화면 | 8 |
| `scripts/lib/journal-tickers.mjs` (+test), `scripts/backtest-fetch.mjs` | 일지 종목 일봉 | 9 |
| `docs/hermes/AGENTS.md`, `docs/deploy-coolify.md`, `supabase/schema.sql` | 문서 | 10 |

---

### Task 1: 타입·KST 헬퍼·스키마

**Files:**
- Modify: `src/lib/types.ts:24` (ReasonTag), `src/lib/types.ts:105-125` (JournalEntry 끝)
- Create: `src/lib/kst.ts`, `src/lib/kst.test.ts`, `db/journal-schema.sql`

**Interfaces:**
- Produces: `JournalEntry.author?: "user" | "agent"`, `JournalEntry.sector?: string`, `ReasonTag`에 `"에이전트"`, `todayKst(now?: Date): string`, `kstDate(iso: string | Date): string`, `isAfterCloseKst(createdAtIso: string, date: string): boolean`. 섹터 목록은 기존 `FLOW_SECTORS` (`src/lib/flow/universe.ts:67`)를 그대로 쓴다.

- [ ] **Step 1: 실패하는 테스트 — `src/lib/kst.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { isAfterCloseKst, kstDate, todayKst } from "./kst";

describe("kstDate", () => {
  it("UTC 15:30은 KST 다음 날 00:30이다", () => {
    expect(kstDate("2026-09-07T15:30:00.000Z")).toBe("2026-09-08");
  });
  it("UTC 14:59는 KST 같은 날 23:59다", () => {
    expect(kstDate("2026-09-07T14:59:00.000Z")).toBe("2026-09-07");
  });
  it("Date 객체도 받는다", () => {
    expect(kstDate(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01-01");
  });
});

describe("todayKst", () => {
  it("now를 주입해 결정적으로 계산한다", () => {
    expect(todayKst(new Date("2026-09-07T16:00:00.000Z"))).toBe("2026-09-08");
  });
});

describe("isAfterCloseKst — 그 날짜의 15:30 KST(=06:30Z) 기준", () => {
  it("07:30 KST 기록은 마감 전", () => {
    expect(isAfterCloseKst("2026-09-07T22:30:00.000Z", "2026-09-08")).toBe(false);
  });
  it("15:30 KST 정각은 마감 후", () => {
    expect(isAfterCloseKst("2026-09-08T06:30:00.000Z", "2026-09-08")).toBe(true);
  });
  it("15:29 KST는 마감 전", () => {
    expect(isAfterCloseKst("2026-09-08T06:29:59.000Z", "2026-09-08")).toBe(false);
  });
  it("어제 날짜 기록을 오늘 아침에 쓰면 어제 마감 후다", () => {
    expect(isAfterCloseKst("2026-09-08T22:30:00.000Z", "2026-09-08")).toBe(true);
  });
  it("깨진 createdAt은 마감 후로 본다(보수적: 다음 거래일 진입)", () => {
    expect(isAfterCloseKst("nope", "2026-09-08")).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/kst.test.ts` → FAIL (모듈 없음)

- [ ] **Step 3: `src/lib/kst.ts`**

```ts
// 한국 시간 판정 — 순수 함수, 클라이언트·서버 공용.
// 컨테이너 TZ가 UTC라 Date.toISOString()의 날짜는 한국 자정~09:00 사이에 하루 어긋난다.
// "오늘", "장 마감 전인가"는 전부 여기서만 계산한다(설계 §3.3).

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** ISO 시각(또는 Date)의 한국 날짜 YYYY-MM-DD. */
export function kstDate(iso: string | Date): string {
  const t = typeof iso === "string" ? Date.parse(iso) : iso.getTime();
  return new Date(t + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 오늘(KST). now를 주입받아 테스트가 결정적이다. */
export function todayKst(now: Date = new Date()): string {
  return kstDate(now);
}

/**
 * `createdAt`이 `date`의 장 마감(15:30 KST = 06:30Z) 이후인가.
 * 마감 전에 쓴 기록은 그날 종가를 아직 모르므로 그날 종가 진입이 미리보기가 아니다(설계 §5).
 * 파싱 불가한 값은 "마감 후"로 본다 — 보수적으로 다음 거래일 진입.
 */
export function isAfterCloseKst(createdAtIso: string, date: string): boolean {
  const t = Date.parse(createdAtIso);
  if (!Number.isFinite(t)) return true;
  return t >= Date.parse(`${date}T06:30:00.000Z`);
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run src/lib/kst.test.ts` → PASS 9

- [ ] **Step 5: `src/lib/types.ts` 수정**

`ReasonTag`(24행):
```ts
export type ReasonTag =
  | "수급" | "지표" | "섹터강세" | "미국장" | "뉴스" | "밸류체인" | "직관"
  // 7단계: 에이전트가 남긴 관망의 주 이유이자, 사용자가 에이전트 후보를 실제로 샀을 때 찍는 주 이유.
  | "에이전트";
```

`JournalEntry` 끝(`createdAt?: string;` 뒤):
```ts
  /**
   * 누가 썼나(7단계). 서버가 채운다 — 사람 문은 "user", 에이전트 문은 "agent".
   * 옛 기록·localStorage 기록은 undefined(=user로 취급). 자기검증은 관망 절을
   * 이 값으로 나누고, 봉인 기준일 계산에서 "agent"를 제외한다.
   */
  author?: "user" | "agent";
  /**
   * 12개 섹터 중 하나(FLOW_SECTORS). 에이전트 기록에만 있고 스냅샷 계산에 쓴다 —
   * 수급 유니버스 30종목 밖의 종목은 이 값이 없으면 섹터를 알 수 없어 스냅샷이
   * 통째로 "none"이 된다. 사람 폼에는 노출하지 않는다.
   */
  sector?: string;
```

- [ ] **Step 6: `db/journal-schema.sql`**

```sql
-- 매매일지 스키마 (7단계). Coolify PostgreSQL에 1회 적용 — 뉴스 스키마(news-schema.sql)와 같은 DB.
-- 컬럼명은 src/lib/types.ts JournalEntry 필드명과 같다(camelCase는 따옴표).
-- 행 <-> JournalEntry 변환은 src/lib/server/journal-repo.ts 한 곳에서만 한다.
create table if not exists journal (
  id           text primary key,
  date         text not null,                                   -- YYYY-MM-DD (거래일)
  market       text not null check (market in ('KR','US')),
  ticker       text not null,
  name         text not null,
  action       text not null check (action in ('buy','sell','note','skip')),
  price        double precision,
  qty          double precision,
  reason       text not null default '',
  emotion      int  not null check (emotion between 1 and 5),
  lesson       text not null default '',
  "primaryTag" text,
  tags         text[],
  snapshot     jsonb,
  "createdAt"  timestamptz,
  author       text check (author in ('user','agent')),
  sector       text
);
create index if not exists journal_date_idx on journal (date desc);
-- 에이전트 하루 상한(3건)·같은 날 같은 종목 중복 판정용
create index if not exists journal_agent_day_idx on journal (date, ticker) where author = 'agent';
```

- [ ] **Step 7: 검증·커밋**

```bash
npx tsc --noEmit && npx vitest run src/lib/kst.test.ts src/lib/journal
git add src/lib/types.ts src/lib/kst.ts src/lib/kst.test.ts db/journal-schema.sql
git commit -m "feat(journal): author/sector 필드·에이전트 태그·KST 헬퍼·Postgres 스키마 (7단계 Task 1)"
```

(`tsc`에서 `Record<ReasonTag,…>` 같은 완전성 오류가 나면 그 파일을 이 커밋에 함께 고친다 — 6단계 때 `skip` 추가 시 `journal/page.tsx`가 그랬다. 검색: `grep -rn "ReasonTag" src --include=*.tsx`.)

---

### Task 2: 서버 저장소 `journal-repo.ts`

**Files:**
- Create: `src/lib/server/journal-repo.ts`, `src/lib/server/journal-repo.test.ts`

**Interfaces:**
- Consumes: `Queryable` (`src/lib/server/db.ts`), `JournalEntry`
- Produces:
  ```ts
  rowToEntry(row: Record<string, unknown>): JournalEntry
  listJournal(q: Queryable): Promise<JournalEntry[]>                  // date desc, "createdAt" desc nulls last
  insertJournal(q: Queryable, entry: JournalEntry): Promise<JournalEntry>
  updateLesson(q: Queryable, id: string, lesson: string): Promise<boolean>   // 갱신된 행이 있으면 true
  deleteJournal(q: Queryable, id: string): Promise<boolean>
  countAgentOn(q: Queryable, date: string): Promise<number>
  agentHasTicker(q: Queryable, date: string, ticker: string): Promise<boolean>
  importJournal(q: Queryable, entries: JournalEntry[]): Promise<{ inserted: number; skipped: number }>  // 같은 id는 건너뜀
  ```

- [ ] **Step 1: 실패하는 테스트 — `src/lib/server/journal-repo.test.ts`**

```ts
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
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/server/journal-repo.test.ts` → FAIL

- [ ] **Step 3: `src/lib/server/journal-repo.ts`**

```ts
// 매매일지 Postgres 저장소(7단계 설계 §1). 서버 전용 — DATABASE_URL 풀만 받는다.
// 행 <-> JournalEntry 변환은 이 파일 밖에서 하지 않는다: pg는 NULL을 null로,
// timestamptz를 Date로 주는데 앱의 나머지는 전부 "없으면 undefined, 시각은 ISO 문자열"을
// 전제한다(6단계 리뷰 I-3: null이 undefined 가드를 통과해 NaN을 만든 전례).
import type { Queryable } from "./db";
import type { JournalEntry, JournalSnapshot, ReasonTag } from "../types";

const COLUMNS =
  'id, date, market, ticker, name, action, price, qty, reason, emotion, lesson, "primaryTag", tags, snapshot, "createdAt", author, sector';

function opt<T>(v: unknown): T | undefined {
  return v === null || v === undefined ? undefined : (v as T);
}

export function rowToEntry(row: Record<string, unknown>): JournalEntry {
  const e: JournalEntry = {
    id: String(row.id),
    date: String(row.date),
    market: row.market as JournalEntry["market"],
    ticker: String(row.ticker),
    name: String(row.name),
    action: row.action as JournalEntry["action"],
    reason: String(row.reason ?? ""),
    emotion: Number(row.emotion) as JournalEntry["emotion"],
    lesson: String(row.lesson ?? ""),
  };
  // 선택 필드는 값이 있을 때만 키를 만든다 — JSON으로 나갔을 때 옛 기록과 모양이 같아야
  // 클라이언트의 `"primaryTag" in e` 류 판정과 자기검증 그룹핑이 흔들리지 않는다.
  const price = opt<number>(row.price); if (price !== undefined) e.price = Number(price);
  const qty = opt<number>(row.qty); if (qty !== undefined) e.qty = Number(qty);
  const primaryTag = opt<ReasonTag>(row.primaryTag); if (primaryTag !== undefined) e.primaryTag = primaryTag;
  const tags = opt<ReasonTag[]>(row.tags); if (tags !== undefined) e.tags = tags;
  const snapshot = opt<JournalSnapshot>(row.snapshot); if (snapshot !== undefined) e.snapshot = snapshot;
  const createdAt = opt<Date | string>(row.createdAt);
  if (createdAt !== undefined) e.createdAt = createdAt instanceof Date ? createdAt.toISOString() : String(createdAt);
  const author = opt<"user" | "agent">(row.author); if (author !== undefined) e.author = author;
  const sector = opt<string>(row.sector); if (sector !== undefined) e.sector = sector;
  return e;
}

function entryParams(e: JournalEntry): unknown[] {
  return [
    e.id, e.date, e.market, e.ticker, e.name, e.action,
    e.price ?? null, e.qty ?? null, e.reason ?? "", e.emotion, e.lesson ?? "",
    e.primaryTag ?? null, e.tags ?? null,
    e.snapshot === undefined ? null : JSON.stringify(e.snapshot),
    e.createdAt ?? null, e.author ?? null, e.sector ?? null,
  ];
}

const INSERT_SQL = `insert into journal (${COLUMNS})
  values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17)`;

export async function listJournal(q: Queryable): Promise<JournalEntry[]> {
  const { rows } = await q.query(
    `select ${COLUMNS} from journal order by date desc, "createdAt" desc nulls last, id desc`
  );
  return rows.map(rowToEntry);
}

export async function insertJournal(q: Queryable, entry: JournalEntry): Promise<JournalEntry> {
  const { rows } = await q.query(`${INSERT_SQL} returning ${COLUMNS}`, entryParams(entry));
  return rowToEntry(rows[0]);
}

export async function updateLesson(q: Queryable, id: string, lesson: string): Promise<boolean> {
  const { rowCount } = await q.query(`update journal set lesson = $2 where id = $1`, [id, lesson]);
  return (rowCount ?? 0) > 0;
}

export async function deleteJournal(q: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await q.query(`delete from journal where id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

/** 그 날짜에 에이전트가 남긴 기록 수 — 하루 상한(3건) 판정. 사람 기록은 세지 않는다. */
export async function countAgentOn(q: Queryable, date: string): Promise<number> {
  const { rows } = await q.query(
    `select count(*)::int as n from journal where author = 'agent' and date = $1`,
    [date]
  );
  return Number(rows[0]?.n ?? 0);
}

/** 그 날짜에 에이전트가 같은 종목을 이미 썼나 — 중복(409). 사람이 쓴 같은 종목은 막지 않는다. */
export async function agentHasTicker(q: Queryable, date: string, ticker: string): Promise<boolean> {
  const { rows } = await q.query(
    `select 1 as one from journal where author = 'agent' and date = $1 and ticker = $2 limit 1`,
    [date, ticker]
  );
  return rows.length > 0;
}

/** 브라우저 localStorage 기록 이관 — 같은 id는 건너뛴다(두 번 눌러도 안전). */
export async function importJournal(
  q: Queryable,
  entries: JournalEntry[]
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  for (const e of entries) {
    const { rowCount } = await q.query(`${INSERT_SQL} on conflict (id) do nothing`, entryParams(e));
    if ((rowCount ?? 0) > 0) inserted += 1;
  }
  return { inserted, skipped: entries.length - inserted };
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run src/lib/server/journal-repo.test.ts` → PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/server/journal-repo.ts src/lib/server/journal-repo.test.ts
git commit -m "feat(journal): Postgres 저장소 journal-repo — 행 변환·상한·중복·이관 (Task 2)"
```

---

### Task 3: 사람 문 라우트

**Files:**
- Create: `src/app/api/journal/route.ts`, `src/app/api/journal/mode/route.ts`, `src/app/api/journal/[id]/route.ts`, `src/app/api/journal/import/route.ts`, `src/app/api/journal/route.test.ts`

**Interfaces:**
- Consumes: Task 2 함수 전부, `getPool()`, `todayKst`가 아닌 `new Date().toISOString()`(createdAt은 UTC ISO).
- Produces:
  - `GET /api/journal/mode` → `200 { mode: "server" }` | `503 { error }`
  - `GET /api/journal` → `200 { entries: JournalEntry[] }` | 503
  - `POST /api/journal` body `Omit<JournalEntry,"id">` → `201 JournalEntry` | 400 | 503. 서버가 `id`(`crypto.randomUUID()`), `author: "user"`, `createdAt`(없으면 now) 채움. `author`가 `"agent"`로 오면 `"user"`로 덮어쓴다(사람 문에서 에이전트 행세 불가).
  - `PATCH /api/journal/[id]` body `{ lesson: string }` → 204 | 404 | 400 | 503
  - `DELETE /api/journal/[id]` → 204 | 404 | 503
  - `POST /api/journal/import` body `{ entries: JournalEntry[] }` → `200 { inserted, skipped }` | 400 | 503. 이관 행도 `author` 없으면 `"user"`.
  - 공용 검증 `src/app/api/journal/validate-entry.ts`: `parseUserEntry(body: unknown): { ok: true; value: Omit<JournalEntry,"id"> } | { ok: false; error: string; field: string }` — 타입·enum만(market/action/emotion/date 형식/ticker `TICKER_RE`/primaryTag·tags가 `REASON_TAGS`에 속함).

- [ ] **Step 1: 실패하는 테스트 — `src/app/api/journal/route.test.ts`**

```ts
// getPool을 가짜 Queryable로 바꿔 라우트의 배선만 검증한다(SQL은 journal-repo.test가 검증).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = { pool: null as null | { query: ReturnType<typeof vi.fn> } };
vi.mock("@/lib/server/db", () => ({ getPool: () => state.pool }));

import { GET, POST } from "./route";
import { GET as MODE } from "./mode/route";
import { PATCH, DELETE } from "./[id]/route";
import { POST as IMPORT } from "./import/route";

const ROW = {
  id: "u1", date: "2026-09-08", market: "KR", ticker: "005930", name: "삼성전자", action: "buy",
  price: 70000, qty: 10, reason: "r", emotion: 3, lesson: "", primaryTag: "수급", tags: null,
  snapshot: null, createdAt: new Date("2026-09-08T01:00:00.000Z"), author: "user", sector: null,
};

function req(method: string, url: string, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  state.pool = { query: vi.fn(async () => ({ rows: [ROW], rowCount: 1 })) };
});
afterEach(() => vi.clearAllMocks());

describe("mode", () => {
  it("풀이 있으면 server", async () => {
    const res = await MODE();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: "server" });
  });
  it("풀이 없으면 503", async () => {
    state.pool = null;
    expect((await MODE()).status).toBe(503);
  });
});

describe("GET /api/journal", () => {
  it("entries 배열을 돌려준다", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.entries[0].id).toBe("u1");
    expect(body.entries[0].createdAt).toBe("2026-09-08T01:00:00.000Z");
  });
});

describe("POST /api/journal", () => {
  const draft = {
    date: "2026-09-08", market: "KR", ticker: "005930", name: "삼성전자", action: "buy",
    price: 70000, qty: 10, reason: "r", emotion: 3, lesson: "", primaryTag: "수급",
  };
  it("id·author=user·createdAt을 채워 저장하고 201", async () => {
    const res = await POST(req("POST", "/api/journal", draft));
    expect(res.status).toBe(201);
    const params = state.pool!.query.mock.calls[0][1] as unknown[];
    expect(typeof params[0]).toBe("string");          // id
    expect(params[15]).toBe("user");                   // author
    expect(typeof params[14]).toBe("string");          // createdAt ISO
  });
  it("author=agent로 보내도 user로 덮어쓴다", async () => {
    await POST(req("POST", "/api/journal", { ...draft, author: "agent" }));
    const params = state.pool!.query.mock.calls[0][1] as unknown[];
    expect(params[15]).toBe("user");
  });
  it("emotion 6은 400 + field", async () => {
    const res = await POST(req("POST", "/api/journal", { ...draft, emotion: 6 }));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("emotion");
  });
  it("풀 없으면 503", async () => {
    state.pool = null;
    expect((await POST(req("POST", "/api/journal", draft))).status).toBe(503);
  });
});

describe("PATCH/DELETE /api/journal/[id]", () => {
  it("lesson만 갱신, 없는 id는 404", async () => {
    const res = await PATCH(req("PATCH", "/api/journal/u1", { lesson: "복기" }), { params: { id: "u1" } });
    expect(res.status).toBe(204);
    state.pool!.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const miss = await DELETE(req("DELETE", "/api/journal/zzz"), { params: { id: "zzz" } });
    expect(miss.status).toBe(404);
  });
  it("lesson이 문자열이 아니면 400", async () => {
    const res = await PATCH(req("PATCH", "/api/journal/u1", { lesson: 3 }), { params: { id: "u1" } });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/journal/import", () => {
  it("배열을 받아 inserted/skipped를 돌려준다", async () => {
    state.pool!.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await IMPORT(req("POST", "/api/journal/import", { entries: [{ ...ROW, id: "x1", createdAt: undefined }, { ...ROW, id: "x2" }] }));
    expect(await res.json()).toEqual({ inserted: 1, skipped: 1 });
  });
  it("entries가 배열이 아니면 400", async () => {
    expect((await IMPORT(req("POST", "/api/journal/import", { entries: "no" }))).status).toBe(400);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/app/api/journal/route.test.ts` → FAIL

- [ ] **Step 3: `src/app/api/journal/validate-entry.ts`**

```ts
// 사람 문(POST /api/journal, import)의 본문 검증 — 타입·enum만 본다. "주 이유 필수" 같은
// 업무 규칙은 폼(JournalEntryForm)이 이미 강제하고, 여기서 다시 막으면 옛 기록 이관이 막힌다.
import type { JournalEntry, ReasonTag } from "@/lib/types";
import { DATE_RE, TICKER_RE } from "@/lib/journal/validate";

export const REASON_TAGS: readonly ReasonTag[] = ["수급", "지표", "섹터강세", "미국장", "뉴스", "밸류체인", "직관", "에이전트"];
const ACTIONS = ["buy", "sell", "note", "skip"] as const;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string; field: string };

export function parseUserEntry(body: unknown): ParseResult<Omit<JournalEntry, "id">> {
  const b = (body ?? {}) as Record<string, unknown>;
  const fail = (field: string, error: string): ParseResult<never> => ({ ok: false, field, error });
  if (typeof b.date !== "string" || !DATE_RE.test(b.date)) return fail("date", "YYYY-MM-DD");
  if (b.market !== "KR" && b.market !== "US") return fail("market", "KR 또는 US");
  if (typeof b.ticker !== "string" || !TICKER_RE.test(b.ticker)) return fail("ticker", "6자리 숫자 또는 1~5자리 대문자");
  if (typeof b.name !== "string" || b.name.length === 0 || b.name.length > 60) return fail("name", "1~60자");
  if (!ACTIONS.includes(b.action as (typeof ACTIONS)[number])) return fail("action", "buy/sell/note/skip");
  if (b.price !== undefined && (typeof b.price !== "number" || !Number.isFinite(b.price))) return fail("price", "숫자");
  if (b.qty !== undefined && (typeof b.qty !== "number" || !Number.isFinite(b.qty))) return fail("qty", "숫자");
  if (typeof b.reason !== "string" || b.reason.length > 2000) return fail("reason", "문자열, 2000자 이하");
  if (![1, 2, 3, 4, 5].includes(b.emotion as number)) return fail("emotion", "1~5");
  if (b.lesson !== undefined && typeof b.lesson !== "string") return fail("lesson", "문자열");
  if (b.primaryTag !== undefined && !REASON_TAGS.includes(b.primaryTag as ReasonTag)) return fail("primaryTag", "정해진 태그");
  if (b.tags !== undefined && (!Array.isArray(b.tags) || !b.tags.every((t) => REASON_TAGS.includes(t as ReasonTag)))) return fail("tags", "정해진 태그 배열");
  if (b.createdAt !== undefined && (typeof b.createdAt !== "string" || !Number.isFinite(Date.parse(b.createdAt)))) return fail("createdAt", "ISO 시각");
  const value: Omit<JournalEntry, "id"> = {
    date: b.date, market: b.market, ticker: b.ticker, name: b.name,
    action: b.action as JournalEntry["action"], reason: b.reason,
    emotion: b.emotion as JournalEntry["emotion"], lesson: (b.lesson as string) ?? "",
  };
  if (b.price !== undefined) value.price = b.price as number;
  if (b.qty !== undefined) value.qty = b.qty as number;
  if (b.primaryTag !== undefined) value.primaryTag = b.primaryTag as ReasonTag;
  if (b.tags !== undefined) value.tags = b.tags as ReasonTag[];
  if (b.snapshot !== undefined && b.snapshot !== null && typeof b.snapshot === "object") value.snapshot = b.snapshot as JournalEntry["snapshot"];
  if (b.createdAt !== undefined) value.createdAt = b.createdAt as string;
  return { ok: true, value };
}
```

- [ ] **Step 4: 라우트 4개**

`src/app/api/journal/mode/route.ts`:
```ts
// 클라이언트가 저장 백엔드를 런타임에 알아내는 문(설계 §1) — 빌드에 굽는 NEXT_PUBLIC_ 변수 없이
// DATABASE_URL 유무만으로 서버/localStorage를 가른다.
import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(): Promise<NextResponse> {
  if (!getPool()) return NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });
  return NextResponse.json({ mode: "server" });
}
```

`src/app/api/journal/route.ts`:
```ts
// 매매일지 사람 문(설계 §3.1) — Basic Auth 뒤. 브라우저 폼·페이지가 쓴다.
// 에이전트는 이 문을 쓰지 않는다(/api/journal/agent). 여기로 author:"agent"가 와도 user로 덮는다.
import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
import { insertJournal, listJournal } from "@/lib/server/journal-repo";
import { parseUserEntry } from "./validate-entry";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });
  return NextResponse.json({ entries: await listJournal(pool) });
}

export async function POST(req: Request): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "잘못된 본문", field: "body" }, { status: 400 }); }
  const parsed = parseUserEntry(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });
  const entry = await insertJournal(pool, {
    ...parsed.value,
    id: crypto.randomUUID(),
    author: "user",
    createdAt: parsed.value.createdAt ?? new Date().toISOString(),
  });
  return NextResponse.json(entry, { status: 201 });
}
```

`src/app/api/journal/[id]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
import { deleteJournal, updateLesson } from "@/lib/server/journal-repo";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: { id: string } };

/** 복기(lesson)만 나중에 채우는 경로 — 다른 필드는 이 문으로 못 바꾼다. */
export async function PATCH(req: Request, { params }: Ctx): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });
  let body: { lesson?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "잘못된 본문" }, { status: 400 }); }
  if (typeof body.lesson !== "string") return NextResponse.json({ error: "lesson은 문자열", field: "lesson" }, { status: 400 });
  const ok = await updateLesson(pool, params.id, body.lesson);
  return ok ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "없는 기록" }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });
  const ok = await deleteJournal(pool, params.id);
  return ok ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "없는 기록" }, { status: 404 });
}
```

`src/app/api/journal/import/route.ts`:
```ts
// 브라우저 localStorage 기록을 서버로 올리는 1회성 문(설계 §1). id를 유지해 두 번 눌러도 중복되지 않는다.
import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
import { importJournal } from "@/lib/server/journal-repo";
import type { JournalEntry } from "@/lib/types";
import { parseUserEntry } from "../validate-entry";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });
  let body: { entries?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "잘못된 본문" }, { status: 400 }); }
  if (!Array.isArray(body.entries)) return NextResponse.json({ error: "entries 배열 필요", field: "entries" }, { status: 400 });
  const entries: JournalEntry[] = [];
  for (const raw of body.entries as Record<string, unknown>[]) {
    const parsed = parseUserEntry(raw);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field, id: raw?.id }, { status: 400 });
    if (typeof raw.id !== "string" || raw.id.length === 0) return NextResponse.json({ error: "id 필요", field: "id" }, { status: 400 });
    entries.push({ ...parsed.value, id: raw.id, author: "user" });
  }
  return NextResponse.json(await importJournal(pool, entries));
}
```

- [ ] **Step 5: 통과 확인** — `npx vitest run src/app/api/journal/route.test.ts` → PASS. `npx tsc --noEmit`.

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/journal
git commit -m "feat(journal): 사람 문 라우트 — mode/list/add/lesson/delete/import (Task 3)"
```

---

### Task 4: 클라이언트 전환 — `data.ts` 일지 분기 교체·Nav 배지·이관 카드

**Files:**
- Create: `src/lib/storage-mode.ts`, `src/lib/journal-client.ts`, `src/lib/journal-client.test.ts`
- Modify: `src/lib/data.ts:1-8,211-270` (일지 4메서드의 Supabase 분기 → 서버 분기), `src/components/Nav.tsx:6,52-64`, `src/app/journal/page.tsx:36-41,70-72`

**Interfaces:**
- Consumes: Task 3 라우트.
- Produces:
  ```ts
  // storage-mode.ts
  type StorageMode = "server" | "local";
  detectStorageMode(fetchFn?: typeof fetch): Promise<StorageMode>   // 결과·진행 중 Promise를 모듈 변수에 캐시
  resetStorageModeForTests(): void
  // journal-client.ts (전부 서버 모드 전제, 실패 시 throw)
  fetchJournal(): Promise<JournalEntry[]>
  postJournal(draft: Omit<JournalEntry,"id">): Promise<JournalEntry>
  patchLesson(id: string, lesson: string): Promise<void>
  deleteJournalEntry(id: string): Promise<void>
  importJournalEntries(entries: JournalEntry[]): Promise<{ inserted: number; skipped: number }>
  // data.ts 추가
  db.localJournalForImport(): JournalEntry[]   // 시드 j1/j2 제외한 localStorage 기록
  db.clearLocalJournal(): void
  ```

- [ ] **Step 1: 실패하는 테스트 — `src/lib/journal-client.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectStorageMode, resetStorageModeForTests } from "./storage-mode";
import { fetchJournal, postJournal } from "./journal-client";

afterEach(() => { resetStorageModeForTests(); vi.restoreAllMocks(); });

describe("detectStorageMode", () => {
  it("/api/journal/mode가 200이면 server, 한 번만 부른다", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ mode: "server" }), { status: 200 }));
    expect(await detectStorageMode(f as unknown as typeof fetch)).toBe("server");
    expect(await detectStorageMode(f as unknown as typeof fetch)).toBe("server");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("503이면 local", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 503 }));
    expect(await detectStorageMode(f as unknown as typeof fetch)).toBe("local");
  });
  it("네트워크 예외도 local", async () => {
    const f = vi.fn(async () => { throw new Error("down"); });
    expect(await detectStorageMode(f as unknown as typeof fetch)).toBe("local");
  });
});

describe("journal-client", () => {
  it("fetchJournal은 entries를 꺼낸다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ entries: [{ id: "a" }] }), { status: 200 })));
    expect(await fetchJournal()).toEqual([{ id: "a" }]);
  });
  it("postJournal은 201 본문을 돌려주고 실패면 throw", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "x", field: "emotion" }), { status: 400 })));
    await expect(postJournal({} as never)).rejects.toThrow(/emotion/);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/journal-client.test.ts` → FAIL

- [ ] **Step 3: `src/lib/storage-mode.ts`**

```ts
// 저장 백엔드 런타임 감지(설계 §1). 서버에 DATABASE_URL이 있으면 "server", 아니면 "local".
// NEXT_PUBLIC_ 변수로 빌드에 굽지 않는 이유: Coolify에서 환경변수를 바꿀 때마다 재빌드해야
// 하는 함정을 없애고, 같은 이미지가 로컬(localStorage)·서버(Postgres) 어디서나 돈다.
export type StorageMode = "server" | "local";

let cached: StorageMode | undefined;
let inflight: Promise<StorageMode> | undefined;

export function detectStorageMode(fetchFn: typeof fetch = fetch): Promise<StorageMode> {
  if (cached) return Promise.resolve(cached);
  if (typeof window === "undefined") return Promise.resolve("local"); // SSR에서는 절대 fetch하지 않는다
  if (!inflight) {
    inflight = fetchFn("/api/journal/mode", { cache: "no-store" })
      .then((r) => (r.ok ? "server" : "local") as StorageMode)
      .catch(() => "local" as StorageMode)
      .then((m) => { cached = m; return m; });
  }
  return inflight;
}

export function resetStorageModeForTests(): void { cached = undefined; inflight = undefined; }
```

- [ ] **Step 4: `src/lib/journal-client.ts`**

```ts
// 서버 모드에서 data.ts가 쓰는 얇은 HTTP 클라이언트. 실패는 Error로 던진다 — 폼이 잡아 표시한다.
import type { JournalEntry } from "./types";

async function fail(res: Response): Promise<never> {
  let msg = `HTTP ${res.status}`;
  try { const b = await res.json(); if (b?.error) msg = b.field ? `${b.field}: ${b.error}` : b.error; } catch { /* 본문 없음 */ }
  throw new Error(msg);
}

export async function fetchJournal(): Promise<JournalEntry[]> {
  const res = await fetch("/api/journal", { cache: "no-store" });
  if (!res.ok) return fail(res);
  return ((await res.json()) as { entries: JournalEntry[] }).entries;
}

export async function postJournal(draft: Omit<JournalEntry, "id">): Promise<JournalEntry> {
  const res = await fetch("/api/journal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
  if (!res.ok) return fail(res);
  return (await res.json()) as JournalEntry;
}

export async function patchLesson(id: string, lesson: string): Promise<void> {
  const res = await fetch(`/api/journal/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lesson }) });
  if (!res.ok) return fail(res);
}

export async function deleteJournalEntry(id: string): Promise<void> {
  const res = await fetch(`/api/journal/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) return fail(res);
}

export async function importJournalEntries(entries: JournalEntry[]): Promise<{ inserted: number; skipped: number }> {
  const res = await fetch("/api/journal/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entries }) });
  if (!res.ok) return fail(res);
  return (await res.json()) as { inserted: number; skipped: number };
}
```

- [ ] **Step 5: `src/lib/data.ts` 일지 4메서드 교체**

파일 머리 주석(1-4행)을 "일지는 서버(`/api/journal`, Postgres) ↔ localStorage, 보유·관심은 Supabase ↔ localStorage(변경 없음)"로 고치고 import 추가:
```ts
import { detectStorageMode } from "./storage-mode";
import { deleteJournalEntry, fetchJournal, patchLesson, postJournal } from "./journal-client";
```
`listJournal/addJournal/updateJournalLesson/removeJournal`의 `if (supabase) {…}` 블록을 각각 아래로 바꾼다:
```ts
  async listJournal(): Promise<JournalEntry[]> {
    if ((await detectStorageMode()) === "server") return fetchJournal();
    ensureSeed();
    return lsRead<JournalEntry>(LS_KEYS.journal).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  },
  async addJournal(input: Omit<JournalEntry, "id">): Promise<JournalEntry> {
    if ((await detectStorageMode()) === "server") return postJournal(input);
    const row: JournalEntry = { ...input, id: newId() };
    const rows = lsRead<JournalEntry>(LS_KEYS.journal);
    lsWrite(LS_KEYS.journal, [row, ...rows]);
    return row;
  },
  async updateJournalLesson(id: string, lesson: string): Promise<void> {
    if ((await detectStorageMode()) === "server") return patchLesson(id, lesson);
    const rows = lsRead<JournalEntry>(LS_KEYS.journal).map((r) => (r.id === id ? { ...r, lesson } : r));
    lsWrite(LS_KEYS.journal, rows);
  },
  async removeJournal(id: string): Promise<void> {
    if ((await detectStorageMode()) === "server") return deleteJournalEntry(id);
    const rows = lsRead<JournalEntry>(LS_KEYS.journal).filter((r) => r.id !== id);
    lsWrite(LS_KEYS.journal, rows);
  },
  /** 이관 카드용 — 시드 2건은 사용자의 기록이 아니므로 뺀다. */
  localJournalForImport(): JournalEntry[] {
    return lsRead<JournalEntry>(LS_KEYS.journal).filter((r) => !SEED_JOURNAL.some((s) => s.id === r.id));
  },
  clearLocalJournal(): void {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(LS_KEYS.journal);
  },
```

- [ ] **Step 6: `Nav.tsx` 배지**

`hasSupabase` import를 지우고:
```tsx
import { detectStorageMode, type StorageMode } from "@/lib/storage-mode";
// …컴포넌트 안:
const [mode, setMode] = useState<StorageMode>("local");
useEffect(() => { detectStorageMode().then(setMode); }, []);
```
배지 JSX의 `hasSupabase`를 `mode === "server"`로, 문구를 `"Postgres(서버)에 영속 저장 중"` / `"브라우저 localStorage에 저장 중 (설정 없이 동작)"`, 라벨을 `server` / `local`로. (`Nav`가 서버 컴포넌트면 `"use client"`를 붙인다 — 파일 머리 확인.)

- [ ] **Step 7: `/journal` 이관 카드** (`src/app/journal/page.tsx`)

```tsx
const [mode, setMode] = useState<StorageMode>("local");
const [localLeft, setLocalLeft] = useState<JournalEntry[]>([]);
const [importMsg, setImportMsg] = useState<string | null>(null);
useEffect(() => {
  detectStorageMode().then((m) => { setMode(m); if (m === "server") setLocalLeft(db.localJournalForImport()); });
}, []);
async function handleImport() {
  try {
    const r = await importJournalEntries(localLeft);
    db.clearLocalJournal();
    setLocalLeft([]);
    setImportMsg(`${r.inserted}건 올림, ${r.skipped}건은 이미 있어 건너뜀`);
    await refresh();
  } catch (e) { setImportMsg(e instanceof Error ? e.message : "이관 실패"); }
}
```
폼 위(70행 `<div className="mb-6">` 앞)에:
```tsx
{mode === "server" && localLeft.length > 0 && (
  <div className="mb-6 rounded-xl2 border border-accent/40 bg-surface p-4 text-sm">
    <p className="text-ink">이 브라우저에 남아 있는 기록 <b>{localLeft.length}건</b>이 서버에 없습니다.</p>
    <p className="mt-1 text-xs text-muted">한 번 올리면 이 브라우저의 사본은 비웁니다. 같은 기록은 두 번 들어가지 않습니다.</p>
    <button onClick={handleImport} className="mt-3 rounded-md border border-accent px-3 py-1.5 text-xs text-accent hover:bg-accent/10">서버로 올리기</button>
  </div>
)}
{importMsg && <p className="mb-4 text-xs text-muted">{importMsg}</p>}
```

- [ ] **Step 8: 검증** — `npx vitest run`, `npx tsc --noEmit`, `npm run lint`. 브라우저(로컬, DATABASE_URL 없음): `/journal`이 종전처럼 localStorage로 동작하고 Nav 배지가 `○ local`인지 확인. `grep -rn "supabase" src/lib/data.ts`에 일지 관련 참조가 남지 않았는지 확인(보유·관심은 남는다).

- [ ] **Step 9: 커밋**

```bash
git add src/lib/storage-mode.ts src/lib/journal-client.ts src/lib/journal-client.test.ts src/lib/data.ts src/components/Nav.tsx src/app/journal/page.tsx
git commit -m "feat(journal): 일지 저장을 서버 API로 — 런타임 감지·localStorage 폴백·이관 카드 (Task 4)"
```

---

### Task 5: 에이전트 인증 — 미들웨어 Bearer 허용 목록

**Files:**
- Create: `src/lib/server/agent-auth.ts`, `src/lib/server/agent-auth.test.ts`
- Modify: `src/middleware.ts:8-20`

**Interfaces:**
- Produces:
  ```ts
  AGENT_ROUTES: readonly { method: string; path: string }[]   // 정확히 3개
  isAgentRoute(method: string, pathname: string): boolean
  checkAgentBearer(header: string | null, token: string | undefined): boolean   // token 비면 항상 false
  ```
  `timingSafeEqual`을 `basic-auth.ts`에서 export한다(현재 비공개 함수).

- [ ] **Step 1: 실패하는 테스트 — `src/lib/server/agent-auth.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { checkAgentBearer, isAgentRoute } from "./agent-auth";

describe("isAgentRoute — (메서드, 경로) 완전 일치 3개만", () => {
  it.each([
    ["POST", "/api/journal/agent", true],
    ["GET", "/api/news", true],
    ["GET", "/api/observatory", true],
    ["GET", "/api/journal/agent", false],
    ["POST", "/api/news/sync", false],
    ["GET", "/api/journal", false],
    ["GET", "/api/news/", false],
    ["POST", "/api/journal/agent/", false],
    ["GET", "/journal/review", false],
  ])("%s %s → %s", (m, p, want) => {
    expect(isAgentRoute(m, p)).toBe(want);
  });
});

describe("checkAgentBearer", () => {
  it("토큰이 비면 무엇을 보내도 거부", () => {
    expect(checkAgentBearer("Bearer abc", undefined)).toBe(false);
    expect(checkAgentBearer("Bearer abc", "")).toBe(false);
  });
  it("정확히 일치해야 통과", () => {
    expect(checkAgentBearer("Bearer s3cret", "s3cret")).toBe(true);
    expect(checkAgentBearer("Bearer s3cre", "s3cret")).toBe(false);
    expect(checkAgentBearer("Bearer s3cret!", "s3cret")).toBe(false);
    expect(checkAgentBearer("Basic s3cret", "s3cret")).toBe(false);
    expect(checkAgentBearer(null, "s3cret")).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/server/agent-auth.test.ts` → FAIL

- [ ] **Step 3: 구현**

`src/lib/server/basic-auth.ts`: `function timingSafeEqual` → `export function timingSafeEqual`.

`src/lib/server/agent-auth.ts`:
```ts
// 에이전트 전용 Bearer 인증(설계 §4). 사람 비밀번호(APP_PASS)를 Hermes 설정에 넣지 않기 위한 별도 문.
// 허용 경로는 (메서드, 경로) 완전 일치 3개뿐이다 — 접두사 매칭을 하면 /api/news/sync(동기화 실행)처럼
// 의도치 않은 문이 같이 열린다. 토큰이 새도 피해는 "하루 관망 3건 + 뉴스·관측소 읽기"로 끝난다.
import { timingSafeEqual } from "./basic-auth";

export const AGENT_ROUTES = [
  { method: "POST", path: "/api/journal/agent" },
  { method: "GET", path: "/api/news" },
  { method: "GET", path: "/api/observatory" },
] as const;

export function isAgentRoute(method: string, pathname: string): boolean {
  return AGENT_ROUTES.some((r) => r.method === method && r.path === pathname);
}

/** AGENT_TOKEN이 비어 있으면 어떤 헤더도 통과하지 못한다 — 미설정 = 에이전트 경로 닫힘. */
export function checkAgentBearer(header: string | null, token: string | undefined): boolean {
  if (!token) return false;
  if (!header || !header.startsWith("Bearer ")) return false;
  return timingSafeEqual(header.slice(7), token);
}
```

`src/middleware.ts` — `middleware` 함수를 다음으로:
```ts
export function middleware(req: NextRequest) {
  const user = process.env.APP_USER;
  const pass = process.env.APP_PASS;
  const auth = req.headers.get("authorization");

  // 에이전트 문: 정확히 세 (메서드,경로)만 Bearer로 연다. Basic Auth 설정 여부와 무관하게
  // 토큰이 맞으면 통과 — 토큰이 없거나 틀리면 아래 Basic Auth로 떨어진다.
  if (isAgentRoute(req.method, req.nextUrl.pathname) && checkAgentBearer(auth, process.env.AGENT_TOKEN)) {
    return NextResponse.next();
  }

  if (!isAuthConfigured(user, pass)) return NextResponse.next();
  if (checkBasicAuth(auth, user, pass)) return NextResponse.next();
  return new NextResponse("인증이 필요합니다.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="stock-study-note", charset="UTF-8"' },
  });
}
```
import 추가: `import { checkAgentBearer, isAgentRoute } from "@/lib/server/agent-auth";`. 파일 머리 주석에 세 줄: Bearer 허용 경로 3개와 "`AGENT_TOKEN` 없으면 닫힘".

- [ ] **Step 4: 통과 확인** — `npx vitest run src/lib/server` → PASS. `npx tsc --noEmit`. `npm run build`(미들웨어는 Edge 번들이라 `basic-auth.ts` 외 Node 전용 import가 없어야 한다 — `agent-auth.ts`는 `basic-auth.ts`만 import).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/server/agent-auth.ts src/lib/server/agent-auth.test.ts src/lib/server/basic-auth.ts src/middleware.ts
git commit -m "feat(auth): AGENT_TOKEN Bearer — (메서드,경로) 완전 일치 3개만 (Task 5)"
```

---

### Task 6: 에이전트 문 `POST /api/journal/agent`

**Files:**
- Create: `src/lib/server/snapshot-data.ts`(스냅샷 로더 추출), `src/lib/journal/agent-input.ts`, `src/lib/journal/agent-input.test.ts`, `src/app/api/journal/agent/route.ts`, `src/app/api/journal/agent/route.test.ts`
- Modify: `src/app/api/journal/snapshot/route.ts` (로더를 `snapshot-data.ts`에서 import — 동작 동일)

**Interfaces:**
- Consumes: `buildSnapshot`, `SECTOR_ROTATION_ETF`, Task 2 repo, `todayKst`, `FLOW_SECTORS`, `REASON_TAGS`(Task 3).
- Produces:
  ```ts
  // snapshot-data.ts — snapshot/route.ts의 함수들을 그대로 옮긴 것
  loadSnapshotInputs(ticker: string, date: string, sector?: string): SnapshotInput | undefined  // data/ 둘 다 없으면 undefined
  // agent-input.ts
  interface AgentInput { ticker: string; name: string; sector: string; reason: string; emotion: Emotion; tags?: ReasonTag[] }
  parseAgentInput(body: unknown): ParseResult<AgentInput>
  AGENT_DAILY_CAP = 3
  ```
  `buildSnapshot`의 `SnapshotInput`에 `sector?: string`을 추가한다: 있으면 유니버스 조회 대신 그 값을 쓴다(`src/lib/journal/snapshot.ts` — 섹터를 찾는 줄에서 `input.sector ?? universeSector(ticker)`). 테스트 1개 추가(유니버스 밖 종목 + sector 지정 → `coverage !== "none"`, `sector` 그대로).

- [ ] **Step 1: 실패하는 테스트 — `src/lib/journal/agent-input.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { parseAgentInput } from "./agent-input";

const OK = { ticker: "247540", name: "에코프로비엠", sector: "배터리", reason: "① 뉴스 ② 이유 ③ 반대 https://n.news.naver.com/x", emotion: 3, tags: ["뉴스", "뉴스"] };

describe("parseAgentInput", () => {
  it("정상 입력은 tags 중복을 제거해 돌려준다", () => {
    const r = parseAgentInput(OK);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.tags).toEqual(["뉴스"]);
  });
  it.each([
    ["ticker", { ticker: "AAPL" }],
    ["ticker", { ticker: "12345" }],
    ["name", { name: "" }],
    ["sector", { sector: "우주" }],
    ["reason", { reason: "출처 없음" }],
    ["reason", { reason: "x".repeat(1001) + " http://a" }],
    ["emotion", { emotion: 0 }],
    ["emotion", { emotion: 6 }],
    ["emotion", { emotion: 1.5 }],
    ["tags", { tags: ["에이전트"] }],
    ["tags", { tags: ["없는태그"] }],
    ["action", { action: "buy" }],
    ["action", { action: "skip" }],
    ["date", { date: "2026-09-08" }],
    ["price", { price: 1 }],
    ["qty", { qty: 1 }],
  ])("%s 위반 → ok:false, field=%s", (field, patch) => {
    const r = parseAgentInput({ ...OK, ...patch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe(field);
  });
});
```

- [ ] **Step 2: 실패 확인** → FAIL

- [ ] **Step 3: `src/lib/journal/agent-input.ts`**

```ts
// 에이전트 문의 본문 검증(설계 §3.2) — 순수 함수. 라우트는 이 결과로 400/201만 가른다.
// action·date·price·qty는 "받지 않는다"가 규칙이다: 무시하면 에이전트가 buy를 보내도 조용히
// skip으로 저장되어 절차서 위반을 못 알아챈다. 있으면 400으로 되돌려 절차서를 고치게 한다.
import type { Emotion, ReasonTag } from "@/lib/types";
import { FLOW_SECTORS } from "@/lib/flow/universe";
import { REASON_TAGS, type ParseResult } from "@/app/api/journal/validate-entry";

export const AGENT_DAILY_CAP = 3;
const KR_TICKER_RE = /^\d{6}$/;
const FORBIDDEN = ["action", "date", "price", "qty"] as const;

export interface AgentInput {
  ticker: string; name: string; sector: string; reason: string; emotion: Emotion; tags?: ReasonTag[];
}

export function parseAgentInput(body: unknown): ParseResult<AgentInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const fail = (field: string, error: string): ParseResult<never> => ({ ok: false, field, error });
  for (const f of FORBIDDEN) if (f in b) return fail(f, "에이전트 문은 이 필드를 받지 않는다(서버가 정한다)");
  if (typeof b.ticker !== "string" || !KR_TICKER_RE.test(b.ticker)) return fail("ticker", "한국 6자리 종목코드");
  if (typeof b.name !== "string" || b.name.length === 0 || b.name.length > 60) return fail("name", "1~60자");
  if (typeof b.sector !== "string" || !FLOW_SECTORS.includes(b.sector)) return fail("sector", `다음 중 하나: ${FLOW_SECTORS.join(", ")}`);
  if (typeof b.reason !== "string" || b.reason.length === 0 || b.reason.length > 1000) return fail("reason", "1~1000자");
  if (!/https?:\/\//.test(b.reason)) return fail("reason", "출처 URL(http…)이 있어야 한다");
  if (![1, 2, 3, 4, 5].includes(b.emotion as number)) return fail("emotion", "정수 1~5");
  let tags: ReasonTag[] | undefined;
  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags) || !b.tags.every((t) => REASON_TAGS.includes(t as ReasonTag) && t !== "에이전트"))
      return fail("tags", "정해진 태그 배열(에이전트 제외)");
    tags = [...new Set(b.tags as ReasonTag[])];
  }
  const value: AgentInput = { ticker: b.ticker, name: b.name, sector: b.sector, reason: b.reason, emotion: b.emotion as Emotion };
  if (tags) value.tags = tags;
  return { ok: true, value };
}
```

- [ ] **Step 4: `src/lib/server/snapshot-data.ts`** — `snapshot/route.ts`의 `loadCandleFile`·`loadAllCandleFilesByLabel`·`loadAllFlows`·`flowCloseCandles`·`stockCandlesFor`와 `GET` 안의 조립 코드를 옮겨 하나로:

```ts
export function loadSnapshotInputs(ticker: string, date: string, sector?: string): SnapshotInput | undefined {
  if (!existsSync(CANDLES_DIR) && !existsSync(FLOW_DIR)) return undefined;
  const candlesByLabel = loadAllCandleFilesByLabel();
  const kospiCandles = candlesByLabel.get("코스피") ?? loadCandleFile(`${CANDLES_DIR}/KR-0001-D.json`)?.candles ?? [];
  const nasdaqCandles = candlesByLabel.get("나스닥") ?? loadCandleFile(`${CANDLES_DIR}/US-COMP-D.json`)?.candles ?? [];
  const sectorEtfCandles: Record<string, Candle[]> = {};
  for (const [s, etfLabel] of Object.entries(SECTOR_ROTATION_ETF)) {
    const c = candlesByLabel.get(etfLabel);
    if (c) sectorEtfCandles[s] = c;
  }
  return { ticker, date, sector, kospiCandles, nasdaqCandles, flows: loadAllFlows(), sectorEtfCandles, stockCandles: stockCandlesFor(ticker) };
}
```
`snapshot/route.ts`의 GET은 검증 후 `const input = loadSnapshotInputs(ticker, date); return NextResponse.json(input ? buildSnapshot(input) : { asOf: "", coverage: "none" });`가 된다. 기존 `snapshot/route.test.ts`가 있으면 그대로 통과해야 한다(파일 경로·동작 동일).

- [ ] **Step 5: 실패하는 테스트 — `src/app/api/journal/agent/route.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  pool: null as null | { query: ReturnType<typeof vi.fn> },
  token: "t0k" as string | undefined,
  now: new Date("2026-09-07T22:30:00.000Z"), // 09-08 07:30 KST
};
vi.mock("@/lib/server/db", () => ({ getPool: () => state.pool }));
vi.mock("@/lib/server/snapshot-data", () => ({
  loadSnapshotInputs: () => ({ ticker: "247540", date: "2026-09-08", sector: "배터리", kospiCandles: [], nasdaqCandles: [], flows: [], sectorEtfCandles: {}, stockCandles: undefined }),
}));

import { POST } from "./route";

const OK = { ticker: "247540", name: "에코프로비엠", sector: "배터리", reason: "뉴스 https://a.b/c", emotion: 3 };
const INSERTED = { id: "a1", date: "2026-09-08", market: "KR", ticker: "247540", name: "에코프로비엠", action: "skip", price: null, qty: null, reason: "뉴스 https://a.b/c", emotion: 3, lesson: "", primaryTag: "에이전트", tags: null, snapshot: { asOf: "", coverage: "none" }, createdAt: state.now, author: "agent", sector: "배터리" };

function post(body: unknown) {
  return POST(new Request("http://localhost/api/journal/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.useFakeTimers({ now: state.now });
  process.env.AGENT_TOKEN = "t0k";
  state.pool = { query: vi.fn(async (text: string) => {
    if (/count\(\*\)/.test(text)) return { rows: [{ n: 0 }], rowCount: 1 };
    if (/select 1 as one/.test(text)) return { rows: [], rowCount: 0 };
    return { rows: [INSERTED], rowCount: 1 };
  }) };
});
afterEach(() => { vi.useRealTimers(); delete process.env.AGENT_TOKEN; });

describe("POST /api/journal/agent", () => {
  it("201 — 서버가 skip·오늘(KST)·author=agent·primaryTag=에이전트·createdAt·snapshot을 채운다", async () => {
    const res = await post(OK);
    expect(res.status).toBe(201);
    const params = state.pool!.query.mock.calls.find((c) => /insert into journal/.test(c[0] as string))![1] as unknown[];
    expect(params[1]).toBe("2026-09-08");     // date = todayKst
    expect(params[5]).toBe("skip");            // action
    expect(params[11]).toBe("에이전트");        // primaryTag
    expect(params[15]).toBe("agent");          // author
    expect(params[16]).toBe("배터리");          // sector
    expect(typeof params[13]).toBe("string");  // snapshot jsonb
    expect(params[14]).toBe(state.now.toISOString());
  });
  it("검증 실패 400 + field", async () => {
    const res = await post({ ...OK, action: "buy" });
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("action");
  });
  it("오늘 3건이면 429", async () => {
    state.pool!.query.mockImplementation(async (text: string) => /count\(\*\)/.test(text) ? { rows: [{ n: 3 }], rowCount: 1 } : { rows: [], rowCount: 0 });
    expect((await post(OK)).status).toBe(429);
  });
  it("같은 종목 이미 있으면 409", async () => {
    state.pool!.query.mockImplementation(async (text: string) => {
      if (/count\(\*\)/.test(text)) return { rows: [{ n: 1 }], rowCount: 1 };
      if (/select 1 as one/.test(text)) return { rows: [{ one: 1 }], rowCount: 1 };
      return { rows: [INSERTED], rowCount: 1 };
    });
    expect((await post(OK)).status).toBe(409);
  });
  it("AGENT_TOKEN 없으면 503(미들웨어를 우회해 들어와도 닫혀 있다)", async () => {
    delete process.env.AGENT_TOKEN;
    expect((await post(OK)).status).toBe(503);
  });
  it("풀 없으면 503", async () => {
    state.pool = null;
    expect((await post(OK)).status).toBe(503);
  });
});
```

- [ ] **Step 6: `src/app/api/journal/agent/route.ts`**

```ts
// 에이전트 문(설계 §3.2) — Hermes가 하루 ≤3건의 "관망"을 남기는 유일한 경로.
// 미들웨어가 Bearer AGENT_TOKEN을 검사하지만 여기서도 토큰 유무를 다시 본다: 미들웨어 매처가
// 바뀌어 이 경로가 열리는 사고가 나도 토큰이 없으면 문은 닫혀 있어야 한다.
// 서버가 정하는 것(action/date/market/primaryTag/author/createdAt/snapshot)은 요청값을 보지 않는다.
import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
import { agentHasTicker, countAgentOn, insertJournal } from "@/lib/server/journal-repo";
import { loadSnapshotInputs } from "@/lib/server/snapshot-data";
import { buildSnapshot } from "@/lib/journal/snapshot";
import { AGENT_DAILY_CAP, parseAgentInput } from "@/lib/journal/agent-input";
import { todayKst } from "@/lib/kst";
import type { JournalEntry, JournalSnapshot } from "@/lib/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  if (!process.env.AGENT_TOKEN) return NextResponse.json({ error: "AGENT_TOKEN 미설정" }, { status: 503 });
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "잘못된 본문", field: "body" }, { status: 400 }); }
  const parsed = parseAgentInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });
  const v = parsed.value;

  const now = new Date();
  const date = todayKst(now);
  if ((await countAgentOn(pool, date)) >= AGENT_DAILY_CAP) {
    return NextResponse.json({ error: `오늘 에이전트 기록 상한 ${AGENT_DAILY_CAP}건` }, { status: 429 });
  }
  if (await agentHasTicker(pool, date, v.ticker)) {
    return NextResponse.json({ error: "오늘 이미 같은 종목을 기록했다" }, { status: 409 });
  }

  // 스냅샷은 로컬 data/만 — 실패해도 저장은 막지 않는다(6단계 §1과 같은 best-effort).
  let snapshot: JournalSnapshot = { asOf: "", coverage: "none" };
  try {
    const input = loadSnapshotInputs(v.ticker, date, v.sector);
    if (input) snapshot = buildSnapshot(input);
  } catch { /* coverage:none으로 저장 */ }

  const entry: JournalEntry = {
    id: crypto.randomUUID(), date, market: "KR", ticker: v.ticker, name: v.name, action: "skip",
    reason: v.reason, emotion: v.emotion, lesson: "", primaryTag: "에이전트", author: "agent",
    sector: v.sector, createdAt: now.toISOString(), snapshot,
  };
  if (v.tags) entry.tags = v.tags;
  return NextResponse.json(await insertJournal(pool, entry), { status: 201 });
}
```

- [ ] **Step 7: 통과 확인** — `npx vitest run src/lib/journal src/app/api/journal` → PASS. `npx tsc --noEmit`.

- [ ] **Step 8: 커밋**

```bash
git add src/lib/server/snapshot-data.ts src/lib/journal/agent-input.ts src/lib/journal/agent-input.test.ts src/lib/journal/snapshot.ts src/lib/journal/snapshot.test.ts src/app/api/journal/agent src/app/api/journal/snapshot/route.ts
git commit -m "feat(journal): 에이전트 문 POST /api/journal/agent — skip만·하루 3건·중복 거부·스냅샷 (Task 6)"
```

---

### Task 7: 채점 규칙 — createdAt 진입·관망 분리·KOSPI 대조·봉인 제외

**Files:**
- Modify: `src/lib/journal/review.ts:37-60,121-176,196-208,349,431-447`, `src/lib/journal/review.test.ts`, `src/lib/journal/settings.ts:58-70`, `src/lib/journal/settings.test.ts`, `src/app/api/journal/review/route.ts:105-120`, `src/app/api/journal/review/route.test.ts`

**Interfaces:**
- Produces:
  ```ts
  forwardReturn(closes, fromDate, horizonDays, roundTrip, includeSameDay = false)
  entersSameDay(e: { date: string; createdAt?: string }): boolean      // createdAt 있고 그 date 마감 전이면 true
  ClosedTrade.entryCreatedAt?: string
  interface SkipStat { n: number; cfMean20?: number; kospiMean20?: number; delta?: number; insufficient: boolean }
  skipCounterfactual(entries, priceLookup, roundTrip, kospiCloses?: {date;close}[]): { user: SkipStat; agent: SkipStat }
  sealBaseDate(entries: readonly { createdAt?: string; author?: string }[])   // author==="agent" 제외
  ```
  리뷰 응답 `skip`이 `{ user, agent }`가 된다(Task 8이 소비).

- [ ] **Step 1: 실패하는 테스트 추가 — `src/lib/journal/review.test.ts`**

```ts
describe("forwardReturn includeSameDay", () => {
  const closes = [
    { date: "2026-09-07", close: 100 }, { date: "2026-09-08", close: 110 }, { date: "2026-09-09", close: 121 },
  ];
  it("기본은 다음 거래일 진입(> fromDate)", () => {
    expect(forwardReturn(closes, "2026-09-07", 1, 0)).toBeCloseTo(0.1, 6);       // 110→121
  });
  it("includeSameDay면 그날 종가 진입(>= fromDate)", () => {
    expect(forwardReturn(closes, "2026-09-08", 1, 0, true)).toBeCloseTo(0.1, 6);  // 110→121
    expect(forwardReturn(closes, "2026-09-08", 1, 0)).toBeUndefined();            // 121 다음이 없다
  });
});

describe("entersSameDay", () => {
  it("07:30 KST 기록은 그날 종가 진입", () => {
    expect(entersSameDay({ date: "2026-09-08", createdAt: "2026-09-07T22:30:00.000Z" })).toBe(true);
  });
  it("16:00 KST 기록은 다음 거래일", () => {
    expect(entersSameDay({ date: "2026-09-08", createdAt: "2026-09-08T07:00:00.000Z" })).toBe(false);
  });
  it("createdAt 없으면 종전대로 다음 거래일", () => {
    expect(entersSameDay({ date: "2026-09-08" })).toBe(false);
  });
});

describe("skipCounterfactual — author 분리·KOSPI 대조", () => {
  const closes = Array.from({ length: 30 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, close: 100 + i }));
  const kospi = Array.from({ length: 30 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, close: 1000 + i * 5 }));
  const skip = (p: Partial<JournalEntry>): JournalEntry => ({ id: Math.random().toString(36), date: "2026-01-02", market: "KR", ticker: "X", name: "x", action: "skip", reason: "", emotion: 3, lesson: "", ...p });
  it("사람과 에이전트를 나눠 세고, 같은 창의 KOSPI 수익과 차이를 붙인다", () => {
    const r = skipCounterfactual([skip({ author: "agent" }), skip({}), skip({ author: "user" })], () => closes, 0, kospi);
    expect(r.agent.n).toBe(1);
    expect(r.user.n).toBe(2);
    // 진입 01-03(다음 거래일) close 102 → +20일 01-23 close 122: +19.6%; KOSPI 1010→1110: +9.9%
    expect(r.user.cfMean20).toBeCloseTo(122 / 102 - 1, 6);
    expect(r.user.kospiMean20).toBeCloseTo(1110 / 1010 - 1, 6);
    expect(r.user.delta).toBeCloseTo(122 / 102 - 1 - (1110 / 1010 - 1), 6);
  });
  it("07:30 에이전트 기록은 그날 종가 진입으로 판다", () => {
    const r = skipCounterfactual([skip({ author: "agent", date: "2026-01-02", createdAt: "2026-01-01T22:30:00.000Z" })], () => closes, 0, kospi);
    // 진입 01-02 close 101 → 01-22 close 121
    expect(r.agent.cfMean20).toBeCloseTo(121 / 101 - 1, 6);
    expect(r.agent.kospiMean20).toBeCloseTo(1105 / 1005 - 1, 6);
  });
  it("KOSPI 종가가 없으면 kospiMean20·delta는 undefined, cfMean20은 그대로", () => {
    const r = skipCounterfactual([skip({})], () => closes, 0, undefined);
    expect(r.user.cfMean20).toBeDefined();
    expect(r.user.kospiMean20).toBeUndefined();
    expect(r.user.delta).toBeUndefined();
  });
});

describe("computeGroupStat cfMean20도 createdAt 규칙을 따른다", () => {
  it("07:30에 쓴 매수는 반사실이 그날 종가부터", () => {
    // 30일 closes, 매수 01-02 07:30 KST createdAt, 매도 01-10. cfMean20 = closes[1]→closes[21]
    const closes = Array.from({ length: 30 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, close: 100 + i }));
    const entries: JournalEntry[] = [
      { id: "b", date: "2026-01-02", market: "KR", ticker: "X", name: "x", action: "buy", price: 101, qty: 1, reason: "", emotion: 3, lesson: "", createdAt: "2026-01-01T22:30:00.000Z" },
      { id: "s", date: "2026-01-10", market: "KR", ticker: "X", name: "x", action: "sell", price: 109, qty: 1, reason: "", emotion: 3, lesson: "" },
    ];
    const { closed } = pairTrades(entries, 0);
    expect(closed[0].entryCreatedAt).toBe("2026-01-01T22:30:00.000Z");
    const [row] = groupByEmotion(closed, () => closes, 1, 0);
    // 없는 확신도 행들 사이에서 3번 행을 찾는다
    const e3 = [row, ...groupByEmotion(closed, () => closes, 1, 0)].find((r) => r.key === "3")!;
    expect(e3.cfMean20).toBeCloseTo(121 / 101 - 1, 6);
  });
});
```
`settings.test.ts`에 추가:
```ts
it("sealBaseDate는 에이전트 기록을 무시한다", () => {
  expect(sealBaseDate([{ createdAt: "2026-01-01T00:00:00.000Z", author: "agent" }])).toBeUndefined();
  expect(sealBaseDate([
    { createdAt: "2026-01-01T00:00:00.000Z", author: "agent" },
    { createdAt: "2026-03-01T00:00:00.000Z", author: "user" },
    { createdAt: "2026-02-01T00:00:00.000Z" },
  ])).toBe("2026-02-01");
});
```

- [ ] **Step 2: 실패 확인** → FAIL (`entersSameDay` 없음, `skip.user` 없음 등)

- [ ] **Step 3: `review.ts` 수정**

```ts
import { isAfterCloseKst } from "@/lib/kst";

/** createdAt이 그 거래일의 장 마감 전이면 그날 종가 진입(설계 §5) — 종가를 아직 모르므로 미리보기가 아니다. */
export function entersSameDay(e: { date: string; createdAt?: string }): boolean {
  return e.createdAt !== undefined && !isAfterCloseKst(e.createdAt, e.date);
}

export function forwardReturn(
  closes: { date: string; close: number }[],
  fromDate: string,
  horizonDays: number,
  roundTrip: number,
  includeSameDay = false
): number | undefined {
  const entryIdx = closes.findIndex((c) => (includeSameDay ? c.date >= fromDate : c.date > fromDate));
  // …이하 동일
}
```
`ClosedTrade`에 `entryCreatedAt?: string;` 추가. `pairTrades`에서 `since`를 세팅하는 곳(포지션이 0에서 열릴 때)에 `sinceCreatedAt = e.createdAt`을 같이 잡고, `closed.push({... entryDate, entryCreatedAt: sinceCreatedAt, ...})`. 포지션이 0으로 닫히면 둘 다 `undefined`로 리셋.

`computeGroupStat` 349행: `forwardReturn(prices, t.entryDate, COUNTERFACTUAL_HORIZON_DAYS, roundTrip, entersSameDay({ date: t.entryDate, createdAt: t.entryCreatedAt }))`.

`skipCounterfactual` 교체:
```ts
export interface SkipStat { n: number; cfMean20?: number; kospiMean20?: number; delta?: number; insufficient: boolean }

/**
 * 관망의 20거래일 반사실 — 사람/에이전트로 나눈다(섞으면 "내 판단력"에 에이전트 점수가 들어간다).
 * 같은 진입일·같은 창의 KOSPI 수익을 나란히 둔다: 뉴스 종목은 이미 오른 종목이기 쉬워 시장과
 * 비교하지 않으면 "+3%"가 좋은지 알 수 없다. delta는 둘 다 계산된 관망끼리만 뺀다.
 */
export function skipCounterfactual(
  entries: JournalEntry[],
  priceLookup: PriceLookup,
  roundTrip: number,
  kospiCloses?: { date: string; close: number }[]
): { user: SkipStat; agent: SkipStat } {
  const acc = { user: { cf: [] as number[], pairs: [] as [number, number][] }, agent: { cf: [] as number[], pairs: [] as [number, number][] } };
  for (const e of entries) {
    if (e.action !== "skip") continue;
    const prices = priceLookup(e.ticker);
    if (prices === undefined) continue;
    const sameDay = entersSameDay(e);
    const cf = forwardReturn(prices, e.date, COUNTERFACTUAL_HORIZON_DAYS, roundTrip, sameDay);
    if (cf === undefined) continue;
    const bucket = e.author === "agent" ? acc.agent : acc.user;
    bucket.cf.push(cf);
    const k = kospiCloses ? forwardReturn(kospiCloses, e.date, COUNTERFACTUAL_HORIZON_DAYS, roundTrip, sameDay) : undefined;
    if (k !== undefined) bucket.pairs.push([cf, k]);
  }
  const stat = (b: typeof acc.user): SkipStat => {
    const n = b.cf.length;
    const s: SkipStat = { n, insufficient: n < MIN_SAMPLE };
    if (n > 0) s.cfMean20 = avg(b.cf);
    if (b.pairs.length > 0) {
      s.kospiMean20 = avg(b.pairs.map((p) => p[1]));
      s.delta = avg(b.pairs.map((p) => p[0])) - s.kospiMean20;
    }
    return s;
  };
  return { user: stat(acc.user), agent: stat(acc.agent) };
}
```
`settings.ts` `sealBaseDate`: 시그니처를 `readonly { createdAt?: string; author?: string }[]`로, 루프 첫 줄에 `if (e.author === "agent") continue;` + 주석("에이전트가 반년 써 둔 뒤 사용자가 첫 기록을 남기는 날 봉인이 바로 열리면 안 된다").

리뷰 라우트: `const kospi = candleCloses("0001");` (기존 `candleCloses`가 `KR-0001-D.json`을 읽는다) → `skipCounterfactual(entries, priceLookup, DEFAULT_ROUND_TRIP, kospi)`. 라우트 테스트에 `data/candles/KR-0001-D.json`을 fsState에 넣고 응답 `skip.user.kospiMean20`이 숫자인 케이스 1개, 없을 때 undefined 케이스 1개 추가.

- [ ] **Step 4: 통과 확인** — `npx vitest run src/lib/journal src/app/api/journal` → PASS(기존 `skipCounterfactual` 테스트 2개는 `result.user.*`로 옮긴다 — 값·의미는 그대로).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/journal src/app/api/journal/review
git commit -m "feat(journal): createdAt 기준 진입·관망 사람/에이전트 분리·KOSPI 대조·봉인에서 에이전트 제외 (Task 7)"
```

---

### Task 8: 화면 — 관망 두 줄·에이전트 칩·숨기기 토글

**Files:**
- Modify: `src/app/journal/review/page.tsx:29-33,47,419-431`, `src/app/journal/page.tsx:36-41,82-92,108-127`

- [ ] **Step 1: 리뷰 페이지 타입·관망 절**

```tsx
interface SkipStatShape { n: number; cfMean20?: number; kospiMean20?: number; delta?: number; insufficient: boolean }
interface ReviewResponse { /* … */ skip: { user: SkipStatShape; agent: SkipStatShape }; /* … */ }

function SkipRow({ label, s }: { label: string; s: SkipStatShape }) {
  const grey = s.insufficient;
  const cls = (v?: number) => (grey || v === undefined ? "text-muted" : pnlClass(v));
  return (
    <div className="flex flex-wrap items-center gap-8 rounded-xl2 border border-line bg-surface p-4">
      <p className={`w-24 text-sm font-medium ${grey ? "text-muted" : "text-ink"}`}>{label}</p>
      <Stat label="n" value={String(s.n)} insufficient={s.insufficient} />
      <Stat label="반사실 20일 평균" value={fmtSignedRate(s.cfMean20)} valueClass={cls(s.cfMean20)} />
      <Stat label="같은 창 KOSPI" value={fmtSignedRate(s.kospiMean20)} valueClass={cls(s.kospiMean20)} />
      <Stat label="차이" value={fmtSignedRate(s.delta)} valueClass={cls(s.delta)} />
    </div>
  );
}
```
관망 절 본문:
```tsx
<ReviewSection
  title="관망(skip)"
  caption="검토하고 안 산 종목의 평균이다. 같은 날짜·같은 20일 창의 KOSPI를 옆에 둔다 — 시장이 더 올랐다면 그 관망은 잘한 것이 아니다. 에이전트 줄은 내 판단력과 섞지 않는다."
>
  <div className="space-y-3">
    <SkipRow label="내 관망" s={data.skip.user} />
    <SkipRow label="에이전트 관망" s={data.skip.agent} />
  </div>
</ReviewSection>
```

- [ ] **Step 2: 일지 페이지 — 칩·토글**

```tsx
const [hideAgent, setHideAgent] = useState(false);
useEffect(() => { try { setHideAgent(localStorage.getItem("ssn.journal.hideAgent") === "1"); } catch { /* 비공개 창 등 */ } }, []);
function toggleHideAgent() {
  const next = !hideAgent; setHideAgent(next);
  try { localStorage.setItem("ssn.journal.hideAgent", next ? "1" : "0"); } catch { /* 무시 */ }
}
const visible = hideAgent ? entries.filter((e) => e.author !== "agent") : entries;
const agentCount = entries.filter((e) => e.author === "agent").length;
```
`PageHeader` 안 링크 옆에(에이전트 기록이 있을 때만):
```tsx
{agentCount > 0 && (
  <button onClick={toggleHideAgent} className="ml-4 text-xs text-muted hover:text-ink">
    {hideAgent ? `에이전트 기록 보이기 (${agentCount})` : `에이전트 기록 숨기기 (${agentCount})`}
  </button>
)}
```
목록은 `visible.map(...)`. `JournalCard` 칩 줄(primaryTag 칩 앞):
```tsx
{entry.author === "agent" && (
  <span className="inline-flex items-center rounded-md border border-accent/50 px-1.5 py-0.5 text-xs font-medium text-accent">에이전트</span>
)}
```
`sector`가 있으면 종목명 옆 작은 글씨 `· {entry.sector}`.

- [ ] **Step 3: 검증** — `npx tsc --noEmit`, `npm run lint`, 브라우저: localStorage에 `author:"agent"` 기록을 하나 넣고(`ssn.journal`) `/journal`에서 칩·토글, `/journal/review`(sealDays 0)에서 관망 두 줄이 보이는지 확인. 스크린샷 1장.

- [ ] **Step 4: 커밋**

```bash
git add src/app/journal
git commit -m "feat(journal): 관망 절 사람/에이전트 두 줄 + KOSPI 대조, 에이전트 칩·숨기기 (Task 8)"
```

---

### Task 9: 시세 커버리지 — 일지 종목 일봉 적재

**Files:**
- Create: `scripts/lib/journal-tickers.mjs`, `src/lib/backtest/journal-tickers.test.ts`
- Modify: `scripts/backtest-fetch.mjs` (buildRequest에 `kind: "stock"` 분기 — KR ETF와 같은 엔드포인트; 끝에 `[4]` 단계 추가)

**Interfaces:**
- Produces:
  ```js
  // scripts/lib/journal-tickers.mjs
  export function journalTickersToFetch(tickers, lastDates, today)
  //   tickers: string[] (distinct KR 6자리), lastDates: Map<ticker, "YYYY-MM-DD" | undefined>, today: "YYYY-MM-DD"(KST)
  //   → { ticker, from: "YYYYMMDD" }[]  — 파일 없으면 from = today-2년, 마지막 봉이 어제(KST)보다 오래되면 from = 마지막 봉 다음날, 아니면 제외
  export function yesterdayOf(today)  // "YYYY-MM-DD" → 전날
  ```

- [ ] **Step 1: 실패하는 테스트 — `src/lib/backtest/journal-tickers.test.ts`**

```ts
import { describe, expect, it } from "vitest";
// scripts/의 .mjs를 그대로 import한다 — 스크립트와 테스트가 같은 코드를 본다.
import { journalTickersToFetch } from "../../../scripts/lib/journal-tickers.mjs";

describe("journalTickersToFetch", () => {
  const today = "2026-09-08";
  it("파일이 없으면 2년 전부터", () => {
    expect(journalTickersToFetch(["247540"], new Map(), today)).toEqual([{ ticker: "247540", from: "20240908" }]);
  });
  it("마지막 봉이 어제면 제외, 그제면 마지막 봉 다음날부터", () => {
    const last = new Map([["005930", "2026-09-07"], ["000660", "2026-09-04"]]);
    expect(journalTickersToFetch(["005930", "000660"], last, today)).toEqual([{ ticker: "000660", from: "20260905" }]);
  });
  it("6자리가 아닌 티커는 무시(US·손상값)", () => {
    expect(journalTickersToFetch(["AAPL", "../x", "005930"], new Map(), today)).toHaveLength(1);
  });
  it("중복 제거", () => {
    expect(journalTickersToFetch(["005930", "005930"], new Map(), today)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 실패 확인** → FAIL

- [ ] **Step 3: `scripts/lib/journal-tickers.mjs`**

```js
// 일지에 등장한 종목 중 오늘 일봉을 받아야 할 것만 고른다(설계 §8) — 순수 함수, 테스트 대상.
// 에이전트가 고른 중소형주는 기존 19종 적재에 없어 이 단계가 없으면 관망 반사실이 영원히 "—"다.
const KR = /^\d{6}$/;
const ymd = (isoDate) => isoDate.replaceAll("-", "");

function shiftDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function shiftYears(isoDate, years) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

export function yesterdayOf(today) { return shiftDays(today, -1); }

export function journalTickersToFetch(tickers, lastDates, today) {
  const out = [];
  const yesterday = yesterdayOf(today);
  for (const t of new Set(tickers)) {
    if (!KR.test(t)) continue;
    const last = lastDates.get(t);
    if (last === undefined) { out.push({ ticker: t, from: ymd(shiftYears(today, -2)) }); continue; }
    if (last >= yesterday) continue;        // 어제(또는 오늘) 봉까지 있으면 오늘 할 일 없음
    out.push({ ticker: t, from: ymd(shiftDays(last, 1)) });
  }
  return out;
}
```

- [ ] **Step 4: `scripts/backtest-fetch.mjs`**

`buildRequest`의 `// kind === "etf"` 분기 주석을 `// kind === "etf" | "stock"`으로 — KR 개별주식도 같은 `inquire-daily-itemchartprice`를 쓴다(코드 변경 없음, 주석만).

파일 끝(`[3]` 루프 뒤)에:
```js
// ── [4] 일지 종목 일봉(7단계 설계 §8) — DATABASE_URL이 있을 때만 ────────────
// 에이전트·사용자가 일지에 남긴 KR 종목의 일봉을 따라 받아야 관망 반사실이 계산된다.
// 처음엔 최근 2년만(20거래일 반사실이면 충분), 이후 증분. 하루 새 종목은 최대 3개라 수 초.
import pg from "pg";
import { journalTickersToFetch } from "./lib/journal-tickers.mjs";
import { todayKst } from "./lib/kst.mjs";
```
(`scripts/lib/kst.mjs`: `src/lib/kst.ts`의 `kstDate/todayKst` 두 함수를 JS로 옮긴 8줄 — 스크립트는 TS를 import할 수 없다. 두 파일이 같은 값을 내는 테스트 1개를 `src/lib/kst.test.ts`에 추가: `import { todayKst as mjsToday } from "../../scripts/lib/kst.mjs"`.)
```js
if (process.env.DATABASE_URL) {
  console.log("\n[4] 일지 종목 일봉 적재");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(`select distinct ticker from journal where market = 'KR'`);
    const lastDates = new Map();
    for (const { ticker } of rows) {
      const file = `${OUT_DIR}/KR-${ticker}-D.json`;
      if (!/^\d{6}$/.test(ticker) || !existsSync(file)) continue;
      try { const prev = JSON.parse(await readFile(file, "utf8")); lastDates.set(ticker, prev.candles.at(-1)?.date); } catch { /* 손상 → 처음부터 */ }
    }
    const todo = journalTickersToFetch(rows.map((r) => r.ticker), lastDates, todayKst());
    console.log(`  대상 ${todo.length}종목`);
    for (const { ticker, from } of todo) {
      await loadTarget(token, { market: "KR", code: ticker, kind: "stock", label: ticker, from });
    }
  } finally {
    await pool.end();
  }
} else {
  console.log("\n[4] 일지 종목 일봉 — DATABASE_URL 없음, 건너뜀");
}
```
`loadTarget`은 `target.from`을 커서 하한으로 쓰므로 증분이 자동으로 된다(기존 파일을 `seen`에 먼저 올린다).

- [ ] **Step 5: 검증** — `npx vitest run src/lib/backtest/journal-tickers.test.ts src/lib/kst.test.ts`, `npm run lint`(scripts 포함). 로컬엔 DATABASE_URL이 없으므로 `npm run backtest:fetch`는 `[4] 건너뜀`을 찍고 끝나야 한다(1~2분, KIS 키 필요 — 시간이 없으면 `node --check scripts/backtest-fetch.mjs`만).

- [ ] **Step 6: 커밋**

```bash
git add scripts/lib scripts/backtest-fetch.mjs src/lib/backtest/journal-tickers.test.ts src/lib/kst.test.ts
git commit -m "feat(fetch): 일지에 등장한 KR 종목 일봉을 따라 받는다 — 2년 초기, 이후 증분 (Task 9)"
```

---

### Task 10: 문서 — Hermes 절차서·배포·Supabase 주석

**Files:**
- Create: `docs/hermes/AGENTS.md`
- Modify: `docs/deploy-coolify.md:5-11,13-18,26-40,75-87,116-118`, `supabase/schema.sql:24-62`

- [ ] **Step 1: `docs/hermes/AGENTS.md`**

```markdown
# 아침 후보 검토 — Hermes 절차서

당신은 개인 투자자의 **아침 검토 보조**다. 매일 07:30 KST에 밤사이 국내외 뉴스를 읽고, 오늘 한국 장에서
검토할 가치가 있는 종목 **0~3개**를 골라 매매일지에 "관망"으로 기록한다. **주문·매매 지시는 절대 하지 않는다.**
당신의 기록은 180일 뒤 "에이전트 후보를 샀다면 20거래일 뒤 어땠나"로 KOSPI와 비교해 채점된다 — 채우려고
고르지 말고, 확신 없는 날은 0건이 정답이다.

## 환경변수
- `STOCK_BASE_URL` — 예: `http://stock:3000` (같은 Coolify 네트워크) 또는 `https://<도메인>`
- `AGENT_TOKEN` — 앱의 `AGENT_TOKEN`과 같은 값. 사람 로그인 비밀번호는 절대 받지 않는다.

모든 요청에 `Authorization: Bearer $AGENT_TOKEN`.

## 절차
1. **간밤 미국·섹터 상태**: `GET $STOCK_BASE_URL/api/observatory` — `nasdaq` 전일 등락, 섹터별 20일 외국인·기관 순매수,
   `unreliable`(기타법인 경고)이 true인 섹터는 수급을 근거로 쓰지 않는다.
2. **뉴스**: `GET $STOCK_BASE_URL/api/news` → `feed[].items[]`의 `pub_date`가 지난 24시간인 것만. 부족하면 `web_search`로
   "국내 증시 오늘", "미국 증시 마감", 관련 산업 뉴스를 보강한다.
3. **후보 선정(≤3)**: 뉴스가 특정 한국 종목의 매출·수주·규제·가격에 **직접** 닿는 것만. 지수 전체 이야기, 이미 며칠 급등한 종목,
   기타법인 경고 섹터는 뺀다. 종목코드 6자리는 `web_search`로 확인한다(종목명만으로 기록하지 않는다).
4. **기록**: 후보마다 한 번
   ```
   POST $STOCK_BASE_URL/api/journal/agent
   { "ticker": "247540", "name": "에코프로비엠", "sector": "배터리",
     "reason": "① 무슨 뉴스 ② 왜 이 종목 ③ 반대 근거 + 출처 URL",
     "emotion": 3, "tags": ["뉴스", "미국장"] }
   ```
   - `sector`: 금융·반도체·방산·배터리·소비재·소재·에너지·인터넷·자동차·제약바이오·조선·통신 중 하나
   - `reason`: 세 줄 — ① 무슨 뉴스 ② 왜 이 종목 ③ 반대 근거(이미 급등·기타법인 경고·불확실성). **출처 URL 필수**
   - `emotion`: 1~5 = 이 후보를 샀을 때 수익으로 끝날 확률 50/60/70/80/90%. "뉴스가 명확하고 섹터 수급이 같은 방향"일 때만 4 이상
   - `tags`(선택): `뉴스`·`미국장`·`섹터강세`·`수급`·`지표`·`밸류체인`·`직관`
   - 보내지 말 것: `action`·`date`·`price`·`qty` (서버가 정한다; 보내면 400)

## 응답 처리
| 코드 | 뜻 | 할 일 |
|---|---|---|
| 201 | 저장됨 | 다음 후보 |
| 400 | 형식 위반(`field` 참고) | 그 후보만 고쳐 1회 재시도, 또 실패면 건너뜀 |
| 409 | 오늘 같은 종목 있음 | 정상, 건너뜀 |
| 429 | 오늘 3건 끝 | 정상, **즉시 종료** |
| 401 / 503 | 토큰·서버 설정 문제 | 중단, 재시도하지 않음, 내일 다시 |

재시도로 상한을 우회하지 않는다. 하루 한 번만 실행한다.

## 실행
Coolify 예약작업 또는 Hermes 자체 cron, 07:30 KST(`30 22 * * *` UTC). 예: `hermes run --agents docs/hermes/AGENTS.md "오늘 아침 후보 검토를 수행하라"`
(정확한 호출 형식은 Hermes 버전 문서를 따른다.)
```

- [ ] **Step 2: `docs/deploy-coolify.md`**
  - "배포 전에 정할 것" 표: 매매일지 저장소 → **Coolify Postgres** (`DATABASE_URL`, 뉴스와 공용. 없으면 브라우저 localStorage)
  - §1 "Supabase 준비" → "Postgres 준비: Coolify에서 PostgreSQL 리소스 생성 → `db/news-schema.sql`, `db/journal-schema.sql`을 순서대로 1회 실행(`psql "$DATABASE_URL" -f db/journal-schema.sql`)"
  - §3 환경변수 표: `NEXT_PUBLIC_SUPABASE_*` 두 줄 삭제(보유·관심종목에 Supabase를 계속 쓰려면 남길 수 있다는 각주 1줄), `DATABASE_URL` 필수로 승격, **`AGENT_TOKEN`** 추가("선택. 있으면 `POST /api/journal/agent`·뉴스·관측소를 Bearer로 열어 Hermes가 쓴다. `openssl rand -hex 32`")
  - §6 예약 작업 표: 07:00 `backtest:fetch`, 07:30 Hermes(→ `docs/hermes/AGENTS.md`) 두 줄 추가 + 이유 한 줄("07:00은 간밤 미국 세션을 받아야 07:30 관측소가 '전날'이 아닌 '간밤'을 본다")
  - §8 확인에 `curl -H "Authorization: Bearer $AGENT_TOKEN" -X POST …/api/journal/agent -d '{}'` → **400**이어야 한다(401이면 토큰, 503이면 DATABASE_URL/AGENT_TOKEN)
  - "다음에 만들 것" 절을 "6단계 자기검증(완료)·7단계 에이전트 관망(완료)"로 갱신하고, 다음 후보로 "보유·관심종목 Postgres 이전 + Supabase 제거"를 적는다.

- [ ] **Step 3: `supabase/schema.sql`** — journal 테이블·6단계 alter 블록 위에 주석 3줄: "7단계부터 매매일지는 `db/journal-schema.sql`(Coolify Postgres)로 이동. 아래 journal 정의는 Supabase를 계속 쓰는 보유·관심종목과 무관하며 참고용으로만 남긴다."

- [ ] **Step 4: 커밋**

```bash
git add docs/hermes/AGENTS.md docs/deploy-coolify.md supabase/schema.sql
git commit -m "docs: Hermes 아침 후보 절차서·Coolify Postgres 배포·예약작업 07:00/07:30 (Task 10)"
```

---

## Self-Review

**1. Spec coverage**
- §1 저장소·런타임 감지·스키마·이관 → Task 1(스키마), 3, 4 ✅
- §2 데이터 모델 → Task 1 ✅ (`FLOW_SECTORS` 재사용)
- §3.1 사람 문 5개 → Task 3 ✅ · §3.2 에이전트 문·거부표 → Task 6 ✅ · §3.3 KST → Task 1 ✅
- §4 인증 3경로 → Task 5 ✅
- §5 createdAt 진입(관망+매수 공통) → Task 7 ✅
- §6 관망 분리·KOSPI 대조·응답 `{user, agent}` → Task 7, 8 ✅
- §7 봉인 제외 → Task 7 ✅
- §8 시세 커버리지 → Task 9 ✅
- §9 예약 작업·§10 절차서·§11 화면(Nav 배지 Task 4, 칩·토글 Task 8) → Task 10, 4, 8 ✅
- §12 테스트 목록 → 각 Task의 Step 1 ✅ (`storage-mode` 캐시·503 폴백은 Task 4 테스트)

**2. Placeholder scan** — 없음. Task 4 Step 6의 "`Nav`가 서버 컴포넌트면 `use client`" 및 Task 1 Step 7의 완전성 오류 처리는 조건부 지시이지 빈칸이 아니다.

**3. Type consistency**
- `ParseResult`는 Task 3 `validate-entry.ts`에서 정의, Task 6이 import ✅
- `REASON_TAGS` Task 3 정의 → Task 6 사용 ✅
- `SnapshotInput.sector?` Task 6에서 추가, `loadSnapshotInputs(ticker, date, sector?)` 시그니처 일치 ✅
- `skipCounterfactual` 4번째 인자 `kospiCloses?` — Task 7 라우트·테스트 일치 ✅; 리뷰 페이지 `SkipStatShape`에 `kospiMean20`·`delta` 추가 Task 8 ✅
- `ClosedTrade.entryCreatedAt?` Task 7 정의·사용 ✅
- `db.localJournalForImport/clearLocalJournal` Task 4 정의·같은 Task 사용 ✅
- `journalTickersToFetch(tickers, lastDates: Map, today)` Task 9 테스트·스크립트 일치 ✅
