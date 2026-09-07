# 보유종목·관심종목 Postgres 이전 + Supabase 제거 (8단계) — 설계

날짜: 2026-09-07 · 상태: 사용자 승인(접근 A, 적대적 리뷰 빈틈 4건 반영)
선행: `2026-09-07-agent-journal-design.md`(7단계, PR #8 — 일지가 먼저 Postgres로 갔다)

## 0. 한 줄 요약

7단계에서 매매일지에 쓴 패턴(서버 라우트 + `pg` repo + 런타임 감지 + localStorage 폴백 + 1회 이관 카드)을 **보유종목·관심종목에 그대로 복제**하고, 더 이상 쓰는 곳이 없는 **Supabase를 코드·의존성·스키마에서 제거**한다. Supabase에 실제 데이터는 없으므로(사용자 확인) Supabase→Postgres 이관 스크립트는 만들지 않는다.

## 1. 스키마 — `db/portfolio-schema.sql` (1회 적용, idempotent)

```sql
-- 보유종목·관심종목 (8단계). Coolify PostgreSQL에 1회 적용 — 뉴스·일지 스키마와 같은 DB.
-- 컬럼명은 src/lib/types.ts Holding / WatchItem 필드명과 같다(camelCase는 따옴표).
create table if not exists holdings (
  id         text primary key,
  market     text not null check (market in ('KR','US')),
  ticker     text not null,
  name       text not null,
  shares     double precision not null check (shares > 0),
  "avgPrice" double precision not null check ("avgPrice" >= 0),
  "openedAt" text not null                          -- YYYY-MM-DD
);
create index if not exists holdings_opened_idx on holdings ("openedAt" desc);

create table if not exists watchlist (
  id        text primary key,
  market    text not null check (market in ('KR','US')),
  ticker    text not null,
  name      text not null,
  memo      text not null default '',
  "addedAt" text not null                           -- YYYY-MM-DD
);
create index if not exists watchlist_added_idx on watchlist ("addedAt" desc);
```

- `id`는 서버가 `crypto.randomUUID()`로 채운다(일지와 동일). 이관 행은 브라우저 `id`를 유지한다.
- 날짜는 `text` — 앱 전체가 `YYYY-MM-DD` 문자열을 쓰고, `date` 타입은 pg가 `Date`로 돌려줘 변환 지점이 하나 늘어난다.
- `price_cache`는 코드에서 읽는 곳이 없어 만들지 않는다.

## 2. 서버 — `src/lib/server/portfolio-repo.ts`

행↔타입 변환은 이 파일에서만(`null` → 키 없음, 숫자 `Number()` 강제). 함수:

```ts
listHoldings(q)                         // "openedAt" desc, id desc
insertHolding(q, h: Holding)            // returning
deleteHolding(q, id): Promise<boolean>
importHoldings(q, rows: Holding[]): Promise<{ inserted; skipped }>   // on conflict (id) do nothing
listWatch(q) · insertWatch(q, w) · deleteWatch(q, id) · importWatch(q, rows)   // 같은 모양, "addedAt" desc
```

라우트(전부 Basic Auth 뒤, `runtime="nodejs"`, `dynamic="force-dynamic"`, 풀 없으면 503 `{ error: "DATABASE_URL 미설정" }`):

| 메서드·경로 | 동작 |
|---|---|
| `GET /api/holdings` | `{ holdings: Holding[] }` |
| `POST /api/holdings` | `Omit<Holding,"id">` → 201 Holding (서버가 `id`) |
| `DELETE /api/holdings/[id]` | 204 / 404 |
| `POST /api/holdings/import` | `{ rows: Holding[] }` → `{ inserted, skipped, rejected:[{index,id,field,error}] }` (7단계 I-6과 같은 skip-and-report) |
| `GET /api/watchlist` · `POST` · `DELETE /[id]` · `POST /import` | 동일 |
| `GET /api/storage/mode` | `{ mode: "server" \| "local" }` 항상 200 — 세 테이블 공용 프로브. **`GET /api/journal/mode`는 307 → `/api/storage/mode`로 한 단계 남긴다**(배포 직후 옛 JS를 든 탭 보호), 다음 단계에서 제거 |

검증(`src/lib/portfolio/validate.ts`, 순수): `market ∈ KR|US`, `ticker` `TICKER_RE`, `name` 1~60자, `shares` 유한수 `> 0`, `avgPrice` 유한수 `>= 0`, `openedAt`/`addedAt` `DATE_RE`, `memo` 문자열 ≤ 500자, import의 `id` 1~64자 문자열. 타입·enum만 — 업무 규칙 없음.

## 3. 클라이언트

- `src/lib/portfolio-client.ts`: `fetchHoldings/postHolding/deleteHoldingEntry/importHoldingRows` + watchlist 4개. 실패는 `{error, field}`를 담은 `Error`로 던진다(journal-client와 같은 `fail()`).
- `src/lib/data.ts`: 보유·관심 6메서드의 `if (supabase)` 분기를 `if ((await detectStorageMode()) === "server")` 분기로 교체. localStorage 분기·시드 주입은 그대로. 추가: `localHoldingsForImport()`/`localWatchForImport()`(시드 `h1·h2`/`w1·w2` 제외), `replaceLocalHoldings/Watch(rows)`, `clearLocalHoldings/Watch()`.
- `src/lib/storage-mode.ts`: 프로브 URL을 `/api/storage/mode`로. 실패는 캐시하지 않는 7단계 규칙 유지.
- 페이지:
  - `/portfolio`: 목록 로딩 실패·추가·삭제 실패 모두 한 줄 오류(`"서버에서 보유·관심종목을 불러오지 못했습니다 — DATABASE_URL·db/portfolio-schema.sql을 적용했는지 확인하세요."` / 쓰기 실패는 `e.message`). 이관 카드 2개(보유·관심)를 서버 모드 + 로컬 비시드 행이 있을 때만. 카드 문구: "예시 데이터 N건(삼성전자 등)은 올리지 않습니다 — 실제 보유면 직접 추가하세요." 올라간 행만 로컬에서 지운다(`splitImportResult` 재사용, 제네릭화).
  - `/screener`: "관심종목 추가" 실패 시 같은 방식으로 한 줄 표시.
  - `/`(대시보드): 목록 실패 시 한 줄 표시.

## 4. Supabase 제거

- 삭제: `@supabase/supabase-js`(package.json·lock), `src/lib/supabase.ts`, `supabase/` 디렉터리 전체.
- 정리: `src/lib/types.ts`·`src/lib/data.ts` 머리 주석, `docs/deploy-coolify.md`(저장소 표·§1·§3 각주), `README.md`의 Supabase 설정 절 → Coolify Postgres + 세 스키마 파일 순서.
- 과거 설계 문서(`docs/superpowers/**`)는 역사 기록이라 건드리지 않는다.

## 5. 배포 순서 (`docs/deploy-coolify.md`)

1. `psql "$DATABASE_URL" -f db/portfolio-schema.sql` — **앱 재배포 전에**. 반만 적용된 상태(일지만 있음)에서는 대시보드·포트폴리오가 오류 줄로 파일명을 알려준다(무한 로딩 아님).
2. 앱 재배포.
3. 확인: `curl -u … /api/storage/mode` → `{"mode":"server"}`, `curl -u … /api/holdings` → `{"holdings":[]}`.

## 6. 테스트

- `portfolio-repo.test.ts`(fakeQ): 행 변환(null·숫자), 정렬 SQL, import `on conflict`.
- 라우트 테스트(getPool mock): 503, POST가 `id` 채움, 검증 400 + field(shares 0·음수·문자열, market, ticker, 날짜), DELETE 204/404, import rejected 인덱스, storage/mode 200 local/server, journal/mode 307.
- `portfolio-client.test.ts`: fetch mock 성공·실패 메시지.
- `splitImportResult` 제네릭화 회귀(기존 3케이스 유지).
- `grep -rn supabase src package.json` → 0건을 검증 항목으로.
- 최종: colima Postgres로 end-to-end(스키마 적용 → 추가/삭제/이관 → 반만 적용 시 오류 줄).

## 7. 적대적 리뷰 (설계 단계, 반영됨)

| # | 지적 | 반영 |
|---|---|---|
| 1 | 쓰기 실패가 조용히 사라짐 | §3 페이지 — 추가·삭제·관심 추가에도 오류 줄 |
| 2 | 모드 경로 이름 변경 시 열린 탭이 로컬 모드로 보임 | §2 옛 경로 307 한 단계 유지 |
| 3 | 보유 시드 제외가 "내 보유가 사라짐"으로 보일 수 있음 | §3 카드 문구 명시 |
| 4 | 스키마 반만 적용된 배포 | §3 오류 문구에 파일명, §5 순서 |

## 8. 범위 밖

에이전트의 보유종목 읽기(Bearer 목록 불변), 보유·관심 종목 일봉 적재, 멀티유저, 화면 개편, `price_cache`.
