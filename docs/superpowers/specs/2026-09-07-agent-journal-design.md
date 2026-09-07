# 에이전트 관망 기록 (7단계) — 설계

날짜: 2026-09-07 · 상태: 사용자 승인(설계 ①~⑥ + 적대적 리뷰 고침 7건)
선행: `2026-09-07-journal-review-design.md`(6단계, PR #7) · `docs/deploy-coolify.md`

## 0. 한 줄 요약

Coolify에 이미 있는 Hermes 에이전트가 매일 아침 밤사이 뉴스로 **한국 종목 ≤3개를 골라 "관망(skip)"으로 매매일지에 기록**한다. 앱은 쓰기 문(`POST /api/journal`) 하나와 그 문의 규칙만 가진다. 생각은 Hermes가, 채점은 6단계 자기검증이 한다. **매매는 절대 실행하지 않는다.**

왜 관망인가: 6단계의 관망 반사실("안 샀는데 샀다면 20거래일 뒤 어땠나")이 에이전트 후보를 자동으로 채점한다. 사용자가 에이전트 후보를 실제로 샀다면 주 이유를 `에이전트`로 찍어 "에이전트 따라 산 거래가 무작위보다 나았나"까지 답할 수 있다.

## 1. 데이터 모델

`JournalEntry`에 두 가지 추가:

| 필드 | 타입 | 뜻 |
|---|---|---|
| `author?` | `"user" \| "agent"` | 누가 썼나. 기존 기록은 undefined(=user). |
| `sector?` | 12개 섹터 중 하나 | 에이전트 기록에서 스냅샷 계산에 쓰인다. 사람 기록은 비워 둔다(폼에 안 보임). |

`ReasonTag`에 `"에이전트"` 추가(8번째). `SECTORS`(12개)는 `src/lib/flow/universe.ts`의 섹터명을 단일 소스로 export한다: 금융·반도체·방산·배터리·소비재·소재·에너지·인터넷·자동차·제약바이오·조선·통신.

Supabase(idempotent):
```sql
alter table journal add column if not exists author text;
alter table journal add column if not exists sector text;
```
컬럼명은 `data.ts`가 TS 객체를 그대로 insert하므로 필드명과 같다.

## 2. `POST /api/journal` — 에이전트가 쓰는 유일한 문

### 2.1 요청

```json
{
  "ticker": "247540",
  "name": "에코프로비엠",
  "sector": "배터리",
  "reason": "① 무슨 뉴스 ② 왜 이 종목 ③ 반대 근거 + 출처 URL",
  "emotion": 3,
  "tags": ["뉴스", "미국장"],
  "date": "2026-09-08"
}
```

| 필드 | 규칙 | 위반 시 |
|---|---|---|
| `ticker` | `^\d{6}$` (한국 코드만; 6단계 `TICKER_RE`의 알파벳 분기는 이 문에서 불허) | 400 |
| `name` | 1~60자 | 400 |
| `sector` | `SECTORS` 중 하나 | 400 |
| `reason` | 1~1,000자, `http` 포함 필수(출처 없는 기록 거부) | 400 |
| `emotion` | 정수 1~5 | 400 |
| `tags` | 선택. `ReasonTag[]`, `에이전트` 제외, 중복 제거 | 400 |
| `date` | 선택. `YYYY-MM-DD`. 생략 시 오늘(KST). **오늘 또는 어제(KST)만** — 과거 백필·미래 거부 | 400 |
| `action` | 보내도 무시. 항상 `skip`. `buy`/`sell`/`note`를 명시하면 | 400 |

### 2.2 서버가 채우는 것 (요청값을 덮어씀)

`action: "skip"`, `market: "KR"`, `primaryTag: "에이전트"`, `author: "agent"`, `lesson: ""`, `price/qty` 없음, `createdAt: now(UTC ISO)`, `snapshot: buildSnapshot({ticker, date, sector, ...로컬 data/})`.

스냅샷은 6단계 라우트와 같은 로컬 데이터만 쓴다(KIS 실시간 호출 없음). 그 종목 일봉은 저녁에야 들어오므로 `rsi14`는 대개 비고 `coverage: "partial"`이 정상이다. `sector`를 요청에서 받는 이유: 스냅샷의 섹터는 원래 수급 유니버스 30종목 표에서만 나오므로, 없으면 중소형주 기록이 전부 `coverage: "none"`이 된다.

### 2.3 거부

| 상황 | 응답 |
|---|---|
| 토큰 없음/틀림 | 401 (미들웨어) |
| `AGENT_TOKEN` 미설정 또는 Supabase 미설정 | 503 `{ error }` — 에이전트 경로는 둘 다 필수. localStorage 백엔드엔 서버가 쓸 곳이 없다 |
| 그 `date`에 `author="agent"` 기록이 이미 **3건** | 429 |
| 그 `date`에 `author="agent"` + 같은 `ticker` 이미 있음 | 409 |
| 검증 실패 | 400 `{ error, field }` |
| 성공 | 201 + 저장된 entry |

상한·중복 판정은 `author="agent"`끼리만 — 사용자가 같은 날 같은 종목을 먼저 써도 에이전트를 막지 않는다. Hermes는 순차 실행이라 count→insert 사이 경쟁은 무시한다.

### 2.4 시간대

"오늘/어제", 장 마감 여부(§4) 등 **모든 날짜 판정은 `Asia/Seoul`로 명시 계산**한다. 컨테이너 TZ는 UTC일 수 있다. 헬퍼 `src/lib/server/kst.ts`: `todayKst()`, `isAfterCloseKst(iso)`(15:30 이후), `kstDate(iso)`.

## 3. 인증 — `AGENT_TOKEN`

미들웨어(`src/middleware.ts`)가 `Authorization: Bearer <AGENT_TOKEN>`을 **정확히 이 셋**에서만 받는다(메서드+경로 완전 일치):

```
POST /api/journal
GET  /api/news
GET  /api/observatory
```

- 그 외 경로는 지금처럼 Basic Auth. `POST /api/news/sync`는 Bearer로 열리지 않는다.
- 비교는 `basic-auth.ts`의 `timingSafeEqual` 재사용. `AGENT_TOKEN`이 비어 있으면 Bearer는 어디서도 통하지 않는다.
- 사람 비밀번호(`APP_PASS`)를 Hermes 설정에 넣지 않는다. 토큰이 새도 피해는 "하루 관망 3건 + 뉴스·관측소 읽기"로 한정된다.

## 4. 채점 시작점 — `createdAt`으로 정한다 (사람 기록에도 적용)

6단계 `forwardReturn`은 "기록일 **다음** 거래일 종가" 진입이었다(장 마감 후 쓰는 걸 전제). 07:30 기록엔 그날의 움직임 — 뉴스가 만드는 바로 그 움직임 — 이 빠진다.

새 규칙: `entryIdx = closes.findIndex(c => c.date >= date)` if `createdAt`이 그 `date`의 15:30 KST **이전**, else `> date`. `createdAt`이 없는 옛 기록은 종전대로 `>`. 그날 종가는 쓰는 시점에 아직 모르므로 미리보기(look-ahead)가 아니다. `forwardReturn(closes, fromDate, horizon, opts?: { includeSameDay: boolean })`로 확장하고 `skipCounterfactual`이 `createdAt`으로 플래그를 결정한다.

## 5. 관망 절 — 분리와 대조

`/journal/review` 관망 절을 두 줄로 나눈다: **내 관망** / **에이전트 관망**(`author`). 섞으면 "내 판단력"에 에이전트 점수가 들어간다.

각 줄에 `n · 반사실 20일 평균 · 같은 창 KOSPI 20일 평균 · 차이`. KOSPI는 같은 진입일 규칙(§4)으로 `data/candles/KR-0001-D.json`에서 계산, 비용도 같게 차감. 뉴스 종목은 이미 오른 종목이기 쉬우므로 시장과 비교하지 않으면 "+3%"가 좋은지 알 수 없다. `n < 20`은 6단계와 같이 회색 + 판단 보류.

주 이유별 표에는 `에이전트` 행이 자동으로 생긴다(ReasonTag 확장) — 사용자가 에이전트 후보를 실제로 샀을 때 찍는 주 이유다.

에이전트 `emotion`(확신도)은 저장만 하고 아직 채점하지 않는다.

## 6. 봉인 — 에이전트 기록은 봉인을 시작시키지 않는다

`sealBaseDate`는 `author !== "agent"`인 기록만 본다. 안 그러면 에이전트가 반년 써 둔 뒤 사용자가 첫 기록을 남기는 날 자기검증이 바로 열린다. 봉인 중엔 에이전트 관망 점수도 함께 숨긴다(6단계 N2 "분석은 봉인 뒤" 유지). 사용자가 원하면 봉인 카드의 `sealDays: 0`.

## 7. 시세 커버리지 — 고른 종목이 채점되게

`scripts/backtest-fetch.mjs`에 단계 추가:

1. 기존 19종 증분 적재(그대로)
2. Supabase가 설정돼 있으면 `journal`에서 `market='KR'`인 distinct `ticker`를 REST로 읽는다(anon key). 미설정이면 2·3 건너뜀.
3. `data/candles/KR-<ticker>-D.json`이 없거나 마지막 봉이 어제보다 오래됐으면 KIS 일봉 적재. 처음 받을 땐 **최근 2년(약 500봉)**만, 이후 증분. 기존 KR 캔들 파일 형식·`atomicWrite`·1.5초 간격 그대로.

하루 최대 3종목이 새로 들어오니 추가 부하는 수 초. 순수 함수 `journalTickersToFetch(tickers, existingFiles, today)`를 분리해 테스트한다.

## 8. 예약 작업 (`docs/deploy-coolify.md` §6 갱신)

| 시간(KST) | 명령 | 이유 |
|---|---|---|
| **07:00** | `npm run backtest:fetch` | 밤사이 끝난 미국 세션을 받아야 07:30 관측소·스냅샷이 "전날"이 아닌 "간밤"을 본다 |
| **07:30** | Hermes 일일 작업(§9) | 미국 마감 + 밤사이 뉴스 이후, 한국 개장(09:00) 전 |
| 18:00 | `npm run flow:fetch` | (기존) |
| 18:05 | `npm run backtest:fetch` | (기존) + 일지 종목 일봉(§7) |
| 18:10 | `curl -u … POST /api/news/sync` | (기존) |

Hermes 호출은 Hermes 쪽 cron이든 Coolify 예약작업이든 상관없다. 문서에 한 줄 예시를 둔다.

## 9. Hermes 절차 — `docs/hermes/AGENTS.md`

레포에 절차서를 두고 사용자가 Hermes 작업 폴더에 복사한다. 골자:

```
목표   : 매일 07:30 KST, 밤사이 국내외 뉴스에서 "오늘 검토할 한국 종목" 0~3개를 관망으로 기록한다.
입력   : GET /api/news (기존 파이프라인, publishedAt으로 24시간 필터) · web_search(국내외 경제·정치) ·
         GET /api/observatory (섹터 수급, 기타법인 경고, 간밤 미국 지수)
출력   : POST /api/journal × 0~3. 확신 없는 날은 0건이 정답이다 — 채우려고 고르지 않는다.
절대   : 매매 지시·주문 금지. buy/sell을 보내지 않는다. 종목코드 6자리를 web_search로 검증한다.
         출처 URL 없는 기록은 서버가 거부한다(400).
sector : 12개 중 하나를 반드시 고른다(목록은 절차서에).
확신도 : 1~5 = 승률 50~90%. "뉴스가 명확하고 섹터 수급이 같은 방향"일 때만 4 이상.
reason : 3줄 — ① 무슨 뉴스 ② 왜 이 종목 ③ 반대 근거(기타법인 경고·이미 급등 등) + URL
실패   : 429/409는 정상(그날 끝). 401/503이면 중단하고 다음 날 재시도. 재시도로 상한을 우회하지 않는다.
```

## 10. 화면

- `/journal`: `author === "agent"` 기록에 **에이전트** 칩, 상단 "에이전트 기록 숨기기" 토글(localStorage). 폼은 바뀌지 않는다(`sector` 미노출).
- `/journal/review`: §5.

## 11. 테스트

- 라우트: 검증(ticker 알파벳·5자리, sector 밖, reason URL 없음, emotion 0/6/1.5, date 그제/내일, action buy), 429(3건 뒤), 409, 503(토큰·Supabase 없음), 201 시 서버 채움 필드 확인.
- 미들웨어: Bearer는 세 (메서드,경로)만 · `POST /api/news/sync`엔 401 · 토큰 틀림 401 · `AGENT_TOKEN` 비면 401 · Basic Auth 종전대로.
- `kst.ts`: UTC 경계(KST 00:30 = UTC 15:30 전날), 15:30 마감 경계.
- `forwardReturn` `includeSameDay` / `skipCounterfactual`이 `createdAt`으로 분기(07:30 → 그날 종가, 16:00 → 다음 거래일).
- `sealBaseDate`가 agent 제외 · 관망 절 author 분리 · KOSPI 대조 계산.
- `journalTickersToFetch` 순수 함수.

## 12. 적대적 리뷰 (설계 단계, 반영됨)

| # | 지적 | 반영 |
|---|---|---|
| 1 | 07:30 기록의 채점이 하루 늦어 뉴스 당일 움직임을 놓친다 | §4 |
| 2 | 스냅샷 섹터가 30종목 표에만 있어 중소형주는 `none` | §2 `sector` 필수 |
| 3 | 07:30엔 미국 데이터가 하루 묵음 | §8 07:00 fetch |
| 4 | 관망 반사실에 대조군이 없어 "+3%"를 판단 못 함 | §5 KOSPI 대조 |
| 5 | `note`는 종목 필수 구조와 안 맞음 | 뺌, `skip`만 |
| 6 | 중복 판정에 사용자 기록이 걸림 | §2.3 agent끼리만 |
| 7 | `/api/news` 통째 허용은 `sync`까지 염 · UTC 날짜 | §3 완전 일치 · §2.4 KST |

## 13. 범위 밖

에이전트 확신도 채점, 미국 종목, 알림(카카오 등), 사용자 폼의 `sector` 입력, 쓰기 경로의 KIS 실시간 호출.
