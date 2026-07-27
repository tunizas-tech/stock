# 네이버 뉴스 키워드 대시보드 (`/news`) — 설계

작성일: 2026-07-27

## 1. 목표

내가 지정한 키워드별로 네이버 뉴스를 매일 모아 분류해 보여주는 독립 페이지.
- 키워드마다 관련 뉴스를 한 묶음으로 정리(키워드 = 분류함).
- 화면에서 **키워드 추가/삭제**.
- **[업데이트]** 버튼으로 즉시 네이버에서 최신 뉴스를 다시 가져와 동기화.
- 매일 정해진 시각에 **자동 갱신**(Coolify 예약 작업).

여기서 말하는 "에이전트"는 별도 AI가 아니라, **뉴스를 수집·중복제거·저장하는 앱 내부 서버 기능**을 뜻한다. LLM은 쓰지 않는다.

## 2. 범위

**포함**
- 새 페이지 `/news` + 관련 API 라우트 + 서버 모듈 + 전용 PostgreSQL 테이블.

**제외 (Non-goals)**
- 홈 화면·주식 대시보드 변경 (별도 작업).
- 기존 기능(보유/관심/일지)의 Supabase → PostgreSQL 이전 (별도 작업).
- LLM 요약/스마트 분류 (키워드=검색어 매칭으로 충분).
- 사용자 인증 (개인용, 사설 서버 뒤).
- 실시간 스트리밍(웹소켓). "실시간"은 버튼/크론 시점의 네이버 색인 최신 기준.

## 3. 확정된 결정

| 항목 | 결정 |
|---|---|
| 위치 | 독립 페이지 `/news` |
| 뉴스 소스 | 네이버 공식 검색 API (`/v1/search/news.json`) |
| 분류 방식 | 키워드 1개 = 검색어 1개 = 분류함 1개 |
| 저장소 | Coolify에 띄운 **전용 PostgreSQL**, 서버사이드 `pg` 접근 |
| 화면 배치 | 세로 섹션 피드(B) + 상단 키워드 칩 탭 필터([전체] 기본) |
| 수동 갱신 | [업데이트] 버튼 → `POST /api/news/sync` |
| 자동 갱신 | Coolify 예약 작업(cron)이 매일 같은 `sync` 라우트 호출 |

## 4. 아키텍처

### 4.1 데이터 모델 (PostgreSQL)

`db/news-schema.sql` (Coolify Postgres에 1회 적용):

```sql
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
  link          text not null,          -- 네이버 link (키워드 내 중복제거 키)
  original_link text,                    -- 언론사 원문 URL
  description   text,
  source        text,                    -- 언론사/호스트 (best-effort)
  pub_date      timestamptz,
  fetched_at    timestamptz not null default now(),
  unique (keyword_id, link)
);

create index if not exists idx_news_item_kw_pub
  on news_item (keyword_id, pub_date desc);
```

- 같은 기사가 여러 키워드에 걸리면 각 키워드 묶음에 각각 저장(키워드=분류함이므로 의도된 동작).
- 중복제거는 `(keyword_id, link)` 유니크 + `insert … on conflict do nothing`.

### 4.2 서버 모듈

- **`src/lib/server/db.ts`** — `DATABASE_URL`로 `pg` Pool 생성. 서버 전용. `query(text, params)` 헬퍼 export. env 없으면 명확한 에러.
- **`src/lib/server/naver-news.ts`** — `fetchNews(keyword): Promise<RawNewsItem[]>`.
  - `GET https://openapi.naver.com/v1/search/news.json?query=<enc>&display=100&sort=date`
  - 헤더: `X-Naver-Client-Id`, `X-Naver-Client-Secret`.
  - 정규화: `title`/`description`의 `<b>` 태그·HTML 엔티티 제거, `pubDate`(RFC1123) → Date, `source`는 `originallink` 호스트에서 유추.
- **`src/lib/server/news-repo.ts`** — DB 연산: `listKeywords`, `addKeyword`, `deleteKeyword`, `upsertItems(keywordId, items)`, `listFeed()`(키워드별 그룹 + 최근 항목).
- **`src/lib/server/news-sync.ts`** — `syncAll()`: 활성 키워드 순회 → `fetchNews` → `upsertItems` → 키워드별 `{keyword, fetched, inserted}` 반환. 키워드 하나 실패해도 나머지 계속(부분 성공).

### 4.3 API 라우트 (App Router, 서버)

| 메서드 · 경로 | 역할 |
|---|---|
| `GET /api/news` | 키워드 + 키워드별 뉴스(그룹) 반환 — 페이지 렌더용 |
| `POST /api/news/keywords` | 키워드 추가 → 즉시 그 키워드 1회 조회·저장 → 결과 반환 |
| `DELETE /api/news/keywords/:id` | 키워드 삭제(연쇄로 뉴스도 삭제) |
| `POST /api/news/sync` | `syncAll()` 실행 → 키워드별 신규 건수 반환 |

- **인증**: 개인용·사설 서버라 앱 라우트는 무인증. `sync`는 선택적으로 `x-cron-secret` 헤더(`CRON_SECRET`)를 검사해 자동 호출을 구분 가능(미설정 시 통과). 쿼터 낭비 방지용으로 서버측 최소 간격(예: 마지막 sync로부터 20초 이내 재호출은 무시) 정도만 둔다. — 과설계 지양.

### 4.4 화면 (`/news`, 클라이언트 컴포넌트)

```
┌───────────────────────────────────────────────┐
│  뉴스 · 오늘 07/27              [+ 키워드] [↻ 업데이트] │
│  [전체] [2차전지] [엔비디아] [금리] …                  │  ← 칩 탭 필터
├───────────────────────────────────────────────┤
│  ▸ 2차전지            4건 · 방금 갱신 · ✕            │
│     LG엔솔 유럽 공장 증설 …        한국경제 · 2시간 전   │
│     에코프로 +5% …                머니투데이 · 3시간 전 │
│  ▸ 엔비디아           3건 · ✕                       │
│     …                                            │
└───────────────────────────────────────────────┘
```

- **상단 칩 탭**: `[전체]`(기본) + 키워드별 칩. 칩 클릭 → 해당 키워드 섹션만 필터. `[+ 키워드]` → 인라인 입력.
- **피드 섹션**: 키워드마다 박스(제목·건수·✕삭제 + 최근 항목 10건, "더 보기"). 기사 제목 클릭 → `original_link` 새 탭.
- **[↻ 업데이트]**: `POST /api/news/sync` → 로딩 표시 → 완료 시 `GET /api/news` 재조회 + "신규 N건" 토스트.
- **빈 상태**: 키워드 0개면 "첫 키워드를 추가하세요" 안내(기존 `EmptyState` 패턴 재사용).
- **설정 미비**: `NAVER_*`/`DATABASE_URL` 없으면 상단 배너로 안내(기존 Supabase-less 폴백과 같은 톤).

### 4.5 데이터 흐름

1. 페이지 로드 → `GET /api/news` → 키워드+뉴스 렌더.
2. 키워드 추가 → `POST /api/news/keywords` → 서버가 삽입 + 즉시 1회 조회 → UI에 섹션 추가.
3. 업데이트 버튼 → `POST /api/news/sync` → 전 키워드 upsert(dedup) → 신규 건수 → UI 재조회.
4. 매일 자동 → Coolify 예약 작업: `curl -X POST -H "x-cron-secret: $CRON_SECRET" https://<app>/api/news/sync` → 동일 `syncAll()`.

## 5. 에러 처리

- 네이버 실패(쿼터/네트워크): 키워드별 try/catch, sync는 나머지 계속, 결과에 실패 키워드 포함 → UI 부분 성공 토스트.
- DB 오류: 500 + UI 에러 상태.
- env 누락(`NAVER_*`/`DATABASE_URL`): 라우트 503 + 명확한 메시지, 페이지 설정-필요 배너.
- 중복 삽입: `on conflict do nothing`.
- 제목 HTML 엔티티/`<b>`: 저장 전 정규화.

## 6. 설정 (env)

서버 전용 (브라우저 노출 금지, `NEXT_PUBLIC_` 사용 안 함):

```
NAVER_CLIENT_ID=...        # 네이버 개발자센터 검색 API
NAVER_CLIENT_SECRET=...
DATABASE_URL=postgres://user:pass@host:5432/dbname   # Coolify Postgres
CRON_SECRET=...            # 선택: 자동 sync 호출 구분
```

사용자 준비물: 네이버 개발자센터에서 **검색 API 무료 키** 발급, Coolify에서 **PostgreSQL** 인스턴스 생성 후 접속 문자열 확보.

## 7. 테스트 (vitest, 기존 패턴 따름)

- `naver-news`: fetch 모킹 → HTML 제거·pubDate 파싱·source 유추 검증.
- `news-sync`: repo 모킹 → dedup/부분 성공(한 키워드 실패 시 나머지 진행) 검증.
- 라우트 `route.test.ts`: `/api/news/sync`, `/api/news/keywords` (repo·fetch 모킹) — 기존 `api/*/route.test.ts` 방식.

## 8. 기본값으로 정한 소소한 결정 (필요 시 조정)

- 칩 탭 = 필터(전체 기본). (스크롤 앵커 아님)
- 섹션당 기본 10건 + "더 보기".
- 보존: 전부 유지(당분간 정리 안 함).
- cron 시각 기본 07:30 KST — Coolify에서 설정.
- `sort=date`(최신순).

## 9. 향후 확장 지점 (지금 구현 안 함)

- LLM 요약/감성/스마트 분류를 `news-item`에 컬럼 추가로 붙일 수 있게 여지만 남김.
- 기존 기능의 self-host PostgreSQL 이전(별도 스펙).
- 읽음 표시·북마크·키워드 정렬 드래그.
