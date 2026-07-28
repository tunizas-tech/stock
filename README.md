# 주식 공부 노트 (Stock Study Note)

한국·미국 주식을 **사고파는 도구가 아니라, 기록하고 복기하며 배우는** 개인용 공부 워크스페이스.
[PRD](./prd.md) · [디자인 문서](./design.md) 기반 구현.

## 실행

```bash
npm install
npm run dev      # http://localhost:3000
```

설정이 전혀 없어도 동작합니다 — 브라우저 **localStorage** + **mock 시세**로 시드 데이터와 함께 즉시 켜집니다.

## 화면

| 라우트 | 내용 |
|--------|------|
| `/` | 대시보드 — 3개 모듈 진입 카드 + 시장 지수 차트(코스피·코스닥·나스닥·S&P 500·다우) + 현황 카운트 |
| `/journal` | 매매일지 — 입력 폼 + 기록 카드(최신순), 확신도·복기 |
| `/portfolio` | 포트폴리오 — 보유 종목 평가손익 표 + 관심 종목 그리드. 행/카드 클릭 시 일·주·월봉 차트 |
| `/screener` | 스크리너 — 지표 min~max 필터 + 결과 테이블, 관심 종목 추가 |
| `/news` | 뉴스 — 키워드별 네이버 뉴스 분류(칩 필터 + 세로 피드), [업데이트] 버튼 동기화 |

## 구현 범위 (PRD 로드맵 기준)

- ✅ **B** 스캐폴드: 3모듈 라우팅, 데이터 레이어, 디자인 시스템
- ✅ **C** 매매일지: CRUD, 확신도(1~5), 복기
- ✅ 포트폴리오(평가손익 자동 계산)
- ✅ **D** 스크리너: `/api/fundamentals` 프록시 + 필터 로직 + 결과 테이블. 유니버스 = 내장 대표 종목(KR·US 각 12) + 보유 + 관심
- ✅ 차트: `/api/candles` 프록시(KIS 기간별시세 4종 — 국내외 종목·지수) + recharts 캔들차트. 대시보드 지수 + 종목 모달, 일·주·월봉
- ✅ **A** 실시세: `/api/quotes` 서버 프록시(KR: KIS, US: Finnhub). 키가 없거나 조회 실패 시 mock 폴백 — 무설정 동작 유지

## 선택 설정

`.env.local.example`를 `.env.local`로 복사해 값을 채우면:

- **Supabase** 키 → localStorage 대신 Postgres 영속 저장 (`supabase/schema.sql` 실행 필요)
- **KIS/Finnhub** 키 → 모듈 A 시세 연동 (서버 전용, `NEXT_PUBLIC_` 금지)

## 아키텍처 요약

- `lib/types.ts` — 도메인 타입 단일 출처
- `lib/data.ts` — 저장소 파사드(Supabase ↔ localStorage 자동 분기). 페이지는 `db.*`만 호출
- `lib/quotes.ts` — 시세 어댑터. `/api/quotes` 호출, 실패 시 mock 폴백
- `lib/server/{kis,finnhub}.ts` — 시세 프로바이더(서버 전용, `npm test`로 검증)
- `lib/format.ts` — 통화·퍼센트·날짜·손익 색상

## 뉴스 대시보드(/news)

- 네이버 검색 API 키(`NAVER_CLIENT_ID`/`NAVER_CLIENT_SECRET`)와 전용 PostgreSQL(`DATABASE_URL`)이 필요하다(서버 전용). 미설정 시 `/news`는 "설정이 필요합니다" 안내를 보여준다.
- 스키마: `db/news-schema.sql`을 DB에 1회 적용. `.env.local`에 키·URL을 넣고 `npm run news:setup`을 실행하면 네이버 API 실호출 검증 + 스키마 적용을 한 번에 한다(psql 불필요, 여러 번 실행해도 안전).
- 키워드=검색어=분류함. `[업데이트]` 버튼 또는 매일 cron이 `POST /api/news/sync`를 호출해 동기화한다(`(keyword_id, link)` 유니크로 중복 제거).
- 매일 자동: Coolify Scheduled Task에서 `curl -X POST <도메인>/api/news/sync`.
