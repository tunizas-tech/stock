# Coolify 배포

개인용 서버에 올려 매일 관측소를 보고 매매일지를 쓰는 구성. 로컬에서 하던 것을 서버가 대신 돌린다.

## 배포 전에 정할 것

| 결정 | 선택 | 이유 |
|---|---|---|
| 매매일지 저장소 | **Supabase** | 코드가 이미 분기돼 있다(`src/lib/data.ts`). 환경변수 2개면 끝 |
| 인증 | **Basic Auth** (`src/middleware.ts`) | `APP_USER`/`APP_PASS` 두 개로 앱 전체가 잠긴다. 없으면 로컬처럼 열림 |
| 데이터 위치 | **볼륨 `/app/data`** | `data/`는 gitignore. 재배포해도 남아야 한다 |

## 1. Supabase 준비 (1회)

1. 프로젝트 생성 → SQL Editor에서 `supabase/schema.sql` 실행
2. Settings → API에서 **Project URL**과 **anon key** 복사

anon key는 공개 가능한 값이라 `NEXT_PUBLIC_` 접두사가 붙는다. 서비스 키는 쓰지 않는다.

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
| `NEXT_PUBLIC_SUPABASE_URL` | 예 | 1번에서 복사 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 예 | 1번에서 복사 |
| `DATABASE_URL` | 선택 | 뉴스 대시보드용 Postgres. 없으면 `/news`가 안내 문구만 보인다 |
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

Scheduled Tasks에 세 개. 시간은 장 마감(15:30) 이후, 데이터가 확정된 뒤로 잡는다.

| 시간(KST) | 명령 | 소요 |
|---|---|---|
| 18:00 | `npm run flow:fetch` | 45초 |
| 18:05 | `npm run backtest:fetch` | 1~2분 (증분) |
| 18:10 | `curl -u "$APP_USER:$APP_PASS" -X POST http://localhost:3000/api/news/sync` | 뉴스 (선택) |

셋째 줄에 `-u`가 있는 이유: 미들웨어가 API도 잠그므로 cron도 같은 문을 지나야 한다.

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

관측소에 들어가 ② 섹터 자금 흐름의 "거래일" 열이 20일로 차 있으면 볼륨과 초기 데이터가 정상이다. "데이터 없음" 안내가 뜨면 5번을 확인한다.

## 매일 하는 일

서버가 적재를 대신하니 사람이 할 일은 셋뿐이다.

| | |
|---|---|
| 아침 | 관측소 — 갭 방향, 섹터 수급, **기타법인 경고** |
| 매매 직후 | 매매일지 — 이유와 확신도(1~5)를 그 자리에서 |
| 주말 | 그 주 거래의 `lesson` 채우기 |

## 다음에 만들 것

매매일지에 **그 순간의 관측소 상태를 같이 저장**하는 것. 그러면 반년 뒤 "확신도 5로 산 거래가 확신도 2보다 실제로 나았나"를 당신 데이터로 답할 수 있다. 시장 규칙은 여섯 번 검증해 전부 기각됐지만, **당신의 매매 습관은 검증 가능하고 그것이 실제로 수익을 바꾼다.**
