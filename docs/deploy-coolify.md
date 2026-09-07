# Coolify 배포

개인용 서버에 올려 매일 관측소를 보고 매매일지를 쓰는 구성. 로컬에서 하던 것을 서버가 대신 돌린다.

## 배포 전에 정할 것

| 결정 | 선택 | 이유 |
|---|---|---|
| 저장소 | **Coolify Postgres** (`DATABASE_URL`. 뉴스·매매일지·보유관심종목 세 테이블 모두 Coolify Postgres. 없으면 매매일지·보유관심종목은 브라우저 localStorage) | 8단계부터 세 테이블 모두 Coolify Postgres로 통일돼 에이전트(Hermes)도 같은 문으로 쓸 수 있다. Supabase는 더는 쓰지 않는다 |
| 인증 | **Basic Auth** (`src/middleware.ts`) | `APP_USER`/`APP_PASS` 두 개로 앱 전체가 잠긴다. 없으면 로컬처럼 열림 |
| 데이터 위치 | **볼륨 `/app/data`** | `data/`는 gitignore. 재배포해도 남아야 한다 |

## 1. Postgres 준비 (1회)

Coolify에서 PostgreSQL 리소스 생성 → `db/news-schema.sql`, `db/journal-schema.sql`, `db/portfolio-schema.sql`을 순서대로 1회 실행:

```bash
psql "$DATABASE_URL" -f db/news-schema.sql
psql "$DATABASE_URL" -f db/journal-schema.sql
psql "$DATABASE_URL" -f db/portfolio-schema.sql
```

세 파일 모두 `create table if not exists`라 재배포·재실행해도 안전하다(멱등).

```bash
psql "$DATABASE_URL" -c '\d journal'   # 17개 컬럼이 보이면 성공
```

**스키마를 앱 재배포보다 먼저 적용한다.** 순서를 뒤집으면 새 이미지가 없는 테이블을
읽어 `/journal`이 "서버에서 기록을 불러오지 못했습니다" 한 줄만 보여준다(기록은
아무것도 잃지 않는다 — 스키마를 넣고 새로고침하면 그대로 돌아온다).

### Supabase에 매매일지 기록이 있었다면 — 재배포 **전에** 꺼낸다

(7단계 배포 때 이미 처리했다면 건너뜀)

7단계부터 앱은 Supabase의 `journal` 테이블을 **더 이상 읽지 않는다.** 데이터는
Supabase에 그대로 남아 있지만 화면에서는 사라지고, **자동 이관 경로는 없다.**
재배포 전에 Supabase SQL Editor에서 아래를 돌려 결과를 CSV로 내려받아 보관한다:

```sql
select * from journal order by date;
```

필요하면 그 CSV를 보고 Coolify Postgres의 `journal` 테이블에 손으로 넣는다.
(브라우저 localStorage에 있던 기록만 `/journal`의 "서버로 올리기" 카드로 1회
이관된다 — 이건 Supabase와 무관한 별개 경로다.)

## 2. Coolify 애플리케이션 생성

- Source: `tunizas-tech/stock`, branch `main`
- Build Pack: **Nixpacks** (자동 감지). `.nvmrc`가 Node 22를 고정한다 — 스크립트의 `--env-file-if-exists`가 22.9 이상을 요구한다
- Port: `3000`

## 3. 환경변수

**빌드 전에** 전부 넣는다. `NEXT_PUBLIC_*`는 빌드 시점에 번들에 구워지므로 나중에 바꾸면 재빌드해야 한다.

| 변수 | 필수 | 값 |
|---|---|---|
| `APP_USER` | **예** | 로그인 아이디 |
| `APP_PASS` | **예** | 긴 비밀번호. 이게 없으면 관측소·매매일지가 인터넷에 열린다 |
| `KIS_APP_KEY` | 예 | KIS 앱키 |
| `KIS_APP_SECRET` | 예 | KIS 시크릿 |
| `DATABASE_URL` | **예** | Coolify Postgres 연결 문자열. 뉴스·매매일지·보유관심종목이 공용으로 쓴다. 없으면 매매일지·보유관심종목은 브라우저 localStorage로 떨어지고 `/news`는 안내 문구만 보인다 |
| `AGENT_TOKEN` | 선택 | 있으면 `POST /api/journal/agent`·뉴스·관측소를 Bearer로 열어 Hermes가 쓴다. `openssl rand -hex 32` |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | 선택 | 뉴스용 |
| `FINNHUB_API_KEY` | 선택 | 미국 종목 시세 폴백 |

### KIS 키에 대해

KIS 앱키는 계좌에 묶여 있고 **시세 조회와 주문에 같은 키를 쓴다.** 서버가 뚫리면 계좌로 주문이 나갈 수 있다.

- 파일로 두지 말고 Coolify 환경변수로만 넣는다
- KIS 포털에서 **조회 전용 키를 따로 발급**할 수 있는지 확인하고, 되면 서버엔 그것만 넣는다
- `APP_USER`/`APP_PASS` 없이 배포하지 않는다

## 4. 볼륨

Persistent Storage에 추가:

| 컨테이너 경로 | 용도 |
|---|---|
| `/app/data` | 시세(`candles/`) · 수급(`flow/`) · KIS 토큰 캐시 |

Nixpacks는 앱을 `/app`에 둔다. 이 볼륨이 없으면 재배포 때마다 데이터가 사라지고, 수급의 KIS 구간(개인 열 포함)은 30일이 지나면 어디서도 복구할 수 없다.

## 5. 최초 데이터 — 로컬에서 올린다

**수급 과거 5년 백필은 서버에서 못 돌린다.** `scripts/flow-backfill.mjs`가 로컬 브라우저 도구(gstack browse)로 네이버를 읽기 때문이다.

이미 로컬 `data/`에 다 받아 두었으니(시세 19종목, 수급 30종목 37,665행) **한 번만 복사해 올린다:**

```bash
# 로컬에서. <container>는 Coolify가 보여주는 컨테이너 이름
tar czf data.tgz data/candles data/flow
docker cp data.tgz <container>:/app/
docker exec <container> sh -c 'cd /app && tar xzf data.tgz && rm data.tgz'
```

또는 Coolify 터미널에서 같은 작업. 이후는 서버의 예약 작업이 매일 이어붙인다.

## 6. 예약 작업

Scheduled Tasks에 다섯 개. 저녁 세 개는 장 마감(15:30) 이후, 데이터가 확정된 뒤로 잡는다. 아침 두 개는
Hermes가 관측소를 보기 전에 간밤 미국 세션을 받아 두기 위한 것이다.

| 시간(KST) | 명령 | 소요 |
|---|---|---|
| 07:00 | `npm run backtest:fetch` | 1~2분 (증분) |
| 07:30 | Hermes 아침 후보 검토 (→ `docs/hermes/AGENTS.md`) | 뉴스·후보 선정 |
| 18:00 | `npm run flow:fetch` | 45초 |
| 18:05 | `npm run backtest:fetch` | 1~2분 (증분) |
| 18:10 | `curl -u "$APP_USER:$APP_PASS" -X POST http://localhost:3000/api/news/sync` | 뉴스 (선택) |

07:00이 먼저인 이유: `backtest:fetch`가 나스닥·S&P 500·다우존스 지수도 받는다. 07:00에 미리 받아야
07:30 관측소가 "전날" 미국 지수가 아니라 "간밤"에 마감한 진짜 최신 미국 지수를 보여준다. 마지막 줄에
`-u`가 있는 이유: 미들웨어가 API도 잠그므로 cron도 같은 문을 지나야 한다.

`flow:fetch`는 KIS의 30일 창을 병합하므로 **서버가 며칠 죽어도 다음 실행이 빈 날을 메운다.** 30일 넘게 멈추면 그때부터 손실이다.

## 7. 백업

`/app/data`를 하루 한 번 다른 곳으로 복사한다. 시세는 재적재 20분, 수급 과거는 백필 35분으로 복구되지만, **수급의 KIS 구간은 복구 경로가 없다.**

## 8. 확인

배포 후:

```bash
curl -I https://<도메인>/observatory            # → 401 이어야 한다
curl -u user:pass https://<도메인>/observatory   # → 200
```

첫 줄이 200이면 `APP_USER`/`APP_PASS`가 안 들어간 것이다. **그 상태로 두지 않는다.**

`AGENT_TOKEN`을 넣었다면 에이전트 문도 확인한다:

```bash
curl -H "Authorization: Bearer $AGENT_TOKEN" -X POST https://<도메인>/api/journal/agent -d '{}'
```

**400**이어야 한다(본문이 비어 형식 검증에 걸린 것 — 문 자체는 열렸다는 뜻). 401이면 토큰이 틀렸다.
503이면 `DATABASE_URL` 또는 `AGENT_TOKEN`이 서버에 안 들어갔다.

매매일지까지 한 번에 확인하려면 세 줄을 순서대로:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<도메인>/observatory            # → 401
curl -s -u "$APP_USER:$APP_PASS" https://<도메인>/api/journal | head -c 200      # → {"entries":[...]}
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $AGENT_TOKEN" -X POST \
  https://<도메인>/api/journal/agent -d '{}'                                      # → 400
```

보유·관심종목이 Postgres로 붙었는지는 두 줄로 확인한다:

```bash
curl -s -u "$APP_USER:$APP_PASS" https://<도메인>/api/storage/mode              # → {"mode":"server"}
curl -s -u "$APP_USER:$APP_PASS" https://<도메인>/api/holdings                  # → {"holdings":[]}
```

`{"mode":"local"}`이면 `DATABASE_URL`이 서버에 안 들어간 것이고, `/api/holdings`가
503이면 스키마(`db/portfolio-schema.sql`)가 아직 안 들어간 것이다.

첫 07:00 실행 뒤 로그에 `[5] 일지 종목 일봉 적재 / 대상 N종목`이 보여야 한다.
`DATABASE_URL 없음, 건너뜀`이면 스크립트 쪽 환경변수가 빠진 것이고,
`경고: 일지 종목 적재 건너뜀 — …`이면 스키마가 아직 안 들어간 것이다(이 단계는
선택이라 나머지 19종 적재와 스크립트 종료 코드에는 영향을 주지 않는다).

관측소에 들어가 ② 섹터 자금 흐름의 "거래일" 열이 20일로 차 있으면 볼륨과 초기 데이터가 정상이다. "데이터 없음" 안내가 뜨면 5번을 확인한다.

## 매일 하는 일

서버가 적재를 대신하니 사람이 할 일은 셋뿐이다.

| | |
|---|---|
| 아침 | 관측소 — 갭 방향, 섹터 수급, **기타법인 경고** |
| 매매 직후 | 매매일지 — 이유와 확신도(1~5)를 그 자리에서 |
| 주말 | 그 주 거래의 `lesson` 채우기 |

## 다음에 만들 것

8단계 완료 — 다음 후보: 에이전트 확신도 채점, KOSPI 파일 캐시.
