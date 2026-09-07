# 에이전트 관망 기록 + 일지 Postgres 저장 (7단계) — 설계

날짜: 2026-09-07 · 상태: 사용자 승인(설계 ①~⑥, 적대적 리뷰 7건, 자체 점검 2건, Postgres 전환)
선행: `2026-09-07-journal-review-design.md`(6단계, PR #7) · `docs/deploy-coolify.md` · `db/news-schema.sql`

## 0. 한 줄 요약

Coolify에 이미 있는 Hermes 에이전트가 매일 아침 밤사이 뉴스로 **한국 종목 0~3개를 골라 "관망(skip)"으로 매매일지에 기록**한다. 그러려면 서버가 일지를 가져야 하므로 **매매일지 저장소를 Coolify Postgres로 옮긴다**(뉴스 파이프라인이 이미 쓰는 `DATABASE_URL`·`pg` 풀 재사용). 생각은 Hermes가, 채점은 6단계 자기검증이 한다. **매매는 절대 실행하지 않는다.**

왜 관망인가: 6단계의 관망 반사실("안 샀는데 샀다면 20거래일 뒤 어땠나")이 에이전트 후보를 자동으로 채점한다. 사용자가 에이전트 후보를 실제로 샀다면 주 이유를 `에이전트`로 찍어 "에이전트 따라 산 거래가 무작위보다 나았나"까지 답할 수 있다.

## 1. 저장소 — 일지만 Postgres로

```
지금:  브라우저 ──(supabase-js)──▶ Supabase          브라우저 ──▶ localStorage
바꿈:  브라우저 ──▶ /api/journal ──(pg)──▶ Postgres    DATABASE_URL 없으면 ▶ localStorage 그대로
```

- **범위는 `journal` 테이블만.** 보유종목·관심종목의 Supabase 분기는 건드리지 않는다(미설정이면 지금처럼 localStorage). Supabase 완전 제거는 별도 단계.
- `src/lib/data.ts`의 일지 4메서드(`listJournal`·`addJournal`·`updateJournalLesson`·`removeJournal`)에서 **Supabase 분기를 제거**하고 서버 분기로 바꾼다: `src/lib/journal-client.ts`가 `/api/journal`을 호출하고, 실패(503)면 localStorage.
- **백엔드 감지는 런타임**: `src/lib/storage-mode.ts`가 `GET /api/journal/mode`를 1회 호출해 `"server" | "local"`을 캐시한다(모듈 변수 + 진행 중 Promise 공유). 빌드에 굽는 `NEXT_PUBLIC_` 변수 없음. `Nav.tsx` 배지는 `hasSupabase` 대신 이 값(●server / ○local).
- 스키마 `db/journal-schema.sql` — 뉴스와 같은 폴더·같은 방식(1회 적용, idempotent):

```sql
create table if not exists journal (
  id          text primary key,
  date        text not null,              -- YYYY-MM-DD
  market      text not null check (market in ('KR','US')),
  ticker      text not null,
  name        text not null,
  action      text not null check (action in ('buy','sell','note','skip')),
  price       double precision,
  qty         double precision,
  reason      text not null default '',
  emotion     int  not null check (emotion between 1 and 5),
  lesson      text not null default '',
  "primaryTag" text,
  tags        text[],
  snapshot    jsonb,
  "createdAt" timestamptz,
  author      text check (author in ('user','agent')),
  sector      text
);
create index if not exists journal_date_idx on journal (date desc);
create index if not exists journal_agent_day_idx on journal (date, ticker) where author = 'agent';
```

컬럼명은 TS 필드명과 같다(camelCase는 따옴표). 행↔`JournalEntry` 변환은 `src/lib/server/journal-repo.ts` 한 곳에서만 한다(`null` → `undefined`).

- **기존 브라우저 기록 이관**: 서버 모드에서 `/journal`을 처음 열 때 localStorage에 기록이 있으면 카드 하나 — "이 브라우저 기록 N건을 서버로 올리기" → `POST /api/journal/import`(배열, `id` 유지, 같은 `id`는 건너뜀) → 성공하면 localStorage 비움. 시드 2건(`j1`,`j2`)은 제외한다.

## 2. 데이터 모델

`JournalEntry`에 두 가지 추가:

| 필드 | 타입 | 뜻 |
|---|---|---|
| `author?` | `"user" \| "agent"` | 누가 썼나. 기존 기록·폼 기록은 서버가 `"user"`로 채운다. |
| `sector?` | 12개 섹터 중 하나 | 에이전트 기록의 스냅샷 계산용. 폼에는 안 보인다. |

`ReasonTag`에 `"에이전트"` 추가(8번째). `SECTORS`(12개)는 `src/lib/flow/universe.ts`의 섹터명을 단일 소스로 export: 금융·반도체·방산·배터리·소비재·소재·에너지·인터넷·자동차·제약바이오·조선·통신.

`supabase/schema.sql`의 journal 부분은 "7단계부터 `db/journal-schema.sql`로 이동" 주석만 남긴다.

## 3. API — 사람 문과 에이전트 문을 나눈다

전부 `runtime = "nodejs"`, `force-dynamic`. `getPool()`이 null이면 503 `{ error: "DATABASE_URL 미설정" }`.

### 3.1 사람 문 (Basic Auth 뒤, 폼과 페이지가 쓴다)

| 메서드·경로 | 동작 |
|---|---|
| `GET /api/journal/mode` | 항상 200 `{ mode: "server" \| "local" }` — `DATABASE_URL` 없음은 오류가 아니라 `local`이라는 답이다(클라이언트가 "실패"와 구분해야 한다) |
| `GET /api/journal` | 전체 목록, `date desc, "createdAt" desc` |
| `POST /api/journal` | 폼 초안(`Omit<JournalEntry,"id">`) 저장. 서버가 `id`(기존 `newId()` 규칙), `author:"user"`, `createdAt`(없으면 now) 채움. 6단계 규칙(주 이유 필수 등)은 폼이 이미 강제하므로 여기선 타입·enum 검증만 |
| `PATCH /api/journal/[id]` | `{ lesson }`만 |
| `DELETE /api/journal/[id]` | |
| `POST /api/journal/import` | §1 이관 |

### 3.2 에이전트 문 — `POST /api/journal/agent`

요청:
```json
{
  "ticker": "247540",
  "name": "에코프로비엠",
  "sector": "배터리",
  "reason": "① 무슨 뉴스 ② 왜 이 종목 ③ 반대 근거 + 출처 URL",
  "emotion": 3,
  "tags": ["뉴스", "미국장"]
}
```

| 필드 | 규칙 | 위반 시 |
|---|---|---|
| `ticker` | `^\d{6}$` (한국 코드만) | 400 |
| `name` | 1~60자 | 400 |
| `sector` | `SECTORS` 중 하나 | 400 |
| `reason` | 1~1,000자, `http` 포함 필수(출처 없는 기록 거부) | 400 |
| `emotion` | 정수 1~5 | 400 |
| `tags` | 선택. `ReasonTag[]`, `에이전트` 제외, 중복 제거 | 400 |
| `action`·`date`·`price`·`qty` | **받지 않는다.** 있으면 | 400 |

서버가 채우는 것: `action:"skip"`, `date: todayKst()`, `market:"KR"`, `primaryTag:"에이전트"`, `author:"agent"`, `lesson:""`, `createdAt: now`, `snapshot: buildSnapshot({ticker, date, sector, …로컬 data/})`.

`date`를 요청에서 받지 않는 이유: "어제"를 허용하면 아침에 어제 3건 + 오늘 3건으로 상한이 6건이 된다. §5 규칙상 어제 날짜도 진입은 오늘 종가라 허용할 이유도 없다.

스냅샷은 6단계 라우트와 같은 로컬 데이터만 쓴다(KIS 실시간 호출 없음). 그 종목 일봉은 저녁에야 들어오므로 `rsi14`는 대개 비고 `coverage:"partial"`이 정상이다. `sector`를 요청에서 받는 이유: 스냅샷의 섹터는 원래 수급 유니버스 30종목 표에서만 나오므로, 없으면 중소형주가 전부 `coverage:"none"`이 된다.

거부:

| 상황 | 응답 |
|---|---|
| Bearer 없음/틀림 | 401 (미들웨어) |
| `AGENT_TOKEN` 또는 `DATABASE_URL` 미설정 | 503 |
| 오늘 `author='agent'` 기록이 이미 3건 | 429 |
| 오늘 `author='agent'` + 같은 `ticker` | 409 |
| 검증 실패 | 400 `{ error, field }` |
| 성공 | 201 + 저장된 entry |

상한·중복은 `author='agent'`끼리만 — 사용자가 같은 날 같은 종목을 먼저 써도 막지 않는다. Hermes는 순차 실행이라 count→insert 경쟁은 무시한다.

### 3.3 시간대

"오늘", 장 마감 여부(§5) 등 **모든 날짜 판정은 `Asia/Seoul`로 명시 계산**. 컨테이너 TZ는 UTC일 수 있다. `src/lib/kst.ts`(순수, 클라이언트·서버 공용): `todayKst(now?)`, `kstDate(iso)`, `isAfterCloseKst(iso)`(그 날짜의 15:30 이후).

## 4. 인증 — `AGENT_TOKEN`

미들웨어가 `Authorization: Bearer <AGENT_TOKEN>`을 **정확히 이 셋**에서만 받는다(메서드+경로 완전 일치):

```
POST /api/journal/agent
GET  /api/news
GET  /api/observatory
```

- 그 외는 지금처럼 Basic Auth. `POST /api/news/sync`, `GET /api/journal`은 Bearer로 열리지 않는다.
- 비교는 `basic-auth.ts`의 `timingSafeEqual` 재사용(`src/lib/server/agent-auth.ts`). `AGENT_TOKEN`이 비면 Bearer는 어디서도 통하지 않는다.
- 사람 비밀번호(`APP_PASS`)를 Hermes 설정에 넣지 않는다. 토큰이 새도 피해는 "하루 관망 3건 + 뉴스·관측소 읽기"로 한정된다.

## 5. 채점 시작점 — `createdAt`으로 정한다 (모든 일지 반사실에 공통)

6단계 `forwardReturn`은 "기록일 **다음** 거래일 종가" 진입이었다(장 마감 후 쓰는 걸 전제). 07:30 기록엔 그날의 움직임 — 뉴스가 만드는 바로 그 움직임 — 이 빠진다.

새 규칙: `createdAt`이 **그 `date`의 15:30 KST 이전**이면 `closes.findIndex(c => c.date >= date)`, 이후(또는 `createdAt` 없음)면 종전대로 `>`. 그날 종가는 쓰는 시점에 아직 모르므로 미리보기가 아니다.

`forwardReturn(closes, fromDate, horizon, { includeSameDay })`로 확장. **관망 반사실과 매수 거래의 `cfMean20` 모두** `createdAt`으로 플래그를 정한다 — 기록 종류에 따라 진입일이 다르면 둘을 나란히 놓을 수 없다.

## 6. 관망 절 — 분리와 대조

`/journal/review` 관망 절을 두 줄로: **내 관망** / **에이전트 관망**(`author`). 섞으면 "내 판단력"에 에이전트 점수가 들어간다.

각 줄: `n · 반사실 20일 평균 · 같은 창 KOSPI 20일 평균 · 차이`. KOSPI는 같은 진입 규칙(§5)으로 `data/candles/KR-0001-D.json`에서, 비용도 같게 차감. 뉴스 종목은 이미 오른 종목이기 쉬우므로 시장과 비교하지 않으면 "+3%"가 좋은지 알 수 없다. `n < 20`은 회색 + 판단 보류. 리뷰 API 응답 `skip`이 `{ user, agent }` 두 객체가 된다.

주 이유별 표엔 `에이전트` 행이 자동으로 생긴다(ReasonTag 확장). 에이전트 `emotion`은 저장만 하고 아직 채점하지 않는다.

## 7. 봉인 — 에이전트 기록은 봉인을 시작시키지 않는다

`sealBaseDate`는 `author !== "agent"`인 기록만 본다. 안 그러면 에이전트가 반년 써 둔 뒤 사용자가 첫 기록을 남기는 날 자기검증이 바로 열린다. 봉인 중엔 에이전트 관망 점수도 함께 숨긴다(6단계 N2 유지).

## 8. 시세 커버리지 — 고른 종목이 채점되게

`scripts/backtest-fetch.mjs`에 단계 추가:

1. 기존 19종 증분 적재(그대로)
2. `DATABASE_URL`이 있으면 `pg`로 `select distinct ticker from journal where market='KR'`. 없으면 2·3 건너뜀.
3. `data/candles/KR-<ticker>-D.json`이 없거나 마지막 봉이 어제(KST)보다 오래됐으면 KIS 일봉 적재. 처음엔 **최근 2년(약 500봉)**, 이후 증분. 기존 KR 캔들 파일 형식·`atomicWrite`·1.5초 간격 그대로.

순수 함수 `journalTickersToFetch(tickers, lastDates, today)`를 `scripts/lib/`에 분리해 테스트한다. 하루 최대 3종목이 새로 오니 추가 부하는 수 초.

## 9. 예약 작업 (`docs/deploy-coolify.md` 갱신)

| 시간(KST) | 명령 | 이유 |
|---|---|---|
| **07:00** | `npm run backtest:fetch` | 밤사이 끝난 미국 세션을 받아야 07:30 관측소·스냅샷이 "전날"이 아닌 "간밤"을 본다 |
| **07:30** | Hermes 일일 작업(§10) | 미국 마감 + 밤사이 뉴스 이후, 한국 개장 전 |
| 18:00 | `npm run flow:fetch` | (기존) |
| 18:05 | `npm run backtest:fetch` | (기존) + 일지 종목 일봉(§8) |
| 18:10 | `curl -u … POST /api/news/sync` | (기존) |

배포 문서의 저장소 표는 Supabase → Coolify Postgres(`DATABASE_URL`, 뉴스와 공용, `db/journal-schema.sql` 1회 적용)로 바꾼다.

## 10. Hermes 절차 — `docs/hermes/AGENTS.md`

레포에 절차서를 두고 사용자가 Hermes 작업 폴더에 복사한다. 골자:

```
목표   : 매일 07:30 KST, 밤사이 국내외 뉴스에서 "오늘 검토할 한국 종목" 0~3개를 관망으로 기록한다.
입력   : GET /api/news (publishedAt으로 24시간 필터) · web_search(국내외 경제·정치) ·
         GET /api/observatory (섹터 수급, 기타법인 경고, 간밤 미국 지수)
출력   : POST /api/journal/agent × 0~3. 확신 없는 날은 0건이 정답이다 — 채우려고 고르지 않는다.
절대   : 매매 지시·주문 금지. 종목코드 6자리를 web_search로 검증한다. 출처 URL 없는 기록은 서버가 거부한다.
sector : 12개 중 하나를 반드시 고른다(목록 수록).
확신도 : 1~5 = 승률 50~90%. "뉴스가 명확하고 섹터 수급이 같은 방향"일 때만 4 이상.
reason : 3줄 — ① 무슨 뉴스 ② 왜 이 종목 ③ 반대 근거(기타법인 경고·이미 급등 등) + URL
실패   : 429/409는 정상(그날 끝). 401/503이면 중단하고 다음 날 재시도. 재시도로 상한을 우회하지 않는다.
```

## 11. 화면

- `/journal`: `author === "agent"` 기록에 **에이전트** 칩, 상단 "에이전트 기록 숨기기" 토글(localStorage). 이관 카드(§1). 폼은 바뀌지 않는다.
- `/journal/review`: §6. `Nav` 배지: §1.

## 12. 테스트

- `journal-repo`: 행↔entry 변환(null→undefined, tags 배열, snapshot jsonb), `Queryable` 가짜로 SQL 파라미터 검증.
- 사람 문 라우트: 503(풀 없음), POST가 `author:"user"`·`createdAt` 채움, PATCH는 lesson만, import는 같은 id 건너뜀.
- 에이전트 문: 검증(ticker 알파벳·5자리, sector 밖, reason URL 없음, emotion 0/6/1.5, action·date 동봉), 429(3건 뒤), 409, 503(토큰·풀), 201 시 서버 채움 필드.
- 미들웨어: Bearer는 세 (메서드,경로)만 · `POST /api/news/sync`·`GET /api/journal`엔 401 · 토큰 틀림 · `AGENT_TOKEN` 비면 401 · Basic Auth 종전대로.
- `kst.ts`: UTC 경계(KST 00:30 = UTC 전날 15:30), 15:30 마감 경계.
- `forwardReturn` `includeSameDay` / `skipCounterfactual`·`computeGroupStat`이 `createdAt`으로 분기(07:30 → 그날 종가, 16:00 → 다음 거래일, 없음 → 다음 거래일).
- `sealBaseDate` agent 제외 · 관망 `{user, agent}` 분리 · KOSPI 대조 계산.
- `journalTickersToFetch` 순수 함수. `storage-mode` 캐시·503 폴백.

## 13. 적대적 리뷰·자체 점검 (설계 단계, 반영됨)

| # | 지적 | 반영 |
|---|---|---|
| 1 | 07:30 기록의 채점이 하루 늦어 뉴스 당일 움직임을 놓친다 | §5 |
| 2 | 스냅샷 섹터가 30종목 표에만 있어 중소형주는 `none` | §3.2 `sector` 필수 |
| 3 | 07:30엔 미국 데이터가 하루 묵음 | §9 07:00 fetch |
| 4 | 관망 반사실에 대조군이 없어 "+3%"를 판단 못 함 | §6 KOSPI 대조 |
| 5 | `note`는 종목 필수 구조와 안 맞음 | 뺌, `skip`만 |
| 6 | 중복 판정에 사용자 기록이 걸림 | §3.2 agent끼리만 |
| 7 | `/api/news` 통째 허용은 `sync`까지 염 · UTC 날짜 | §4 완전 일치 · §3.3 KST |
| A | "오늘 또는 어제" 허용 ↔ 하루 3건 상한(6건 가능) | §3.2 `date` 안 받음 |
| B | createdAt 진입 규칙을 관망에만 적용하면 매수 반사실과 못 나란히 놓음 | §5 공통 적용 |

## 14. 범위 밖

보유종목·관심종목의 Postgres 이전과 Supabase 완전 제거, 에이전트 확신도 채점, 미국 종목, 알림(카카오 등), 사용자 폼의 `sector` 입력, 쓰기 경로의 KIS 실시간 호출, 멀티유저.
