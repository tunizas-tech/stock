# 주식 공부 노트 — 디자인 문서

> Design Document (UI 시스템 + 기술 설계)
> 버전 1.0 · 최종 수정 2026-05-31

---

## 1. 디자인 컨셉 — "조용한 분석실"

트레이딩 대시보드의 번쩍이는 빨강/초록 점멸과 정반대 방향을 택했다.
이 앱은 **사고파는 곳이 아니라 차분히 되돌아보는 곳**이므로, 시각 언어도 그에 맞춘다.

- 종이 질감의 따뜻한 라이트 테마 — 노트에 손으로 적는 감각.
- 숫자는 모노스페이스 + 고정폭 정렬로 "데이터"의 신뢰감.
- 색은 절제하고, 의미 있는 곳(손익, 강조)에만 색을 쓴다.
- 에디토리얼 세리프 제목으로 "읽고 사유하는" 톤.

한 줄로: **차분한 종이 위의 금융 노트.**

---

## 2. 디자인 토큰

### 2.1 색상

모두 CSS 변수로 관리(`globals.css`), Tailwind에 매핑.

| 토큰 | 값 | 용도 |
|------|-----|------|
| `--bg` | `#f4f1ea` | 배경 (따뜻한 종이) |
| `--surface` | `#fbfaf6` | 카드·패널 |
| `--ink` | `#1c1a17` | 본문 텍스트 (웜 블랙) |
| `--muted` | `#6b655c` | 보조 텍스트 |
| `--line` | `#e4ded2` | 보더·구분선 |
| `--accent` | `#b4541f` | 강조·인터랙션 (테라코타) |
| `--gain` | `#1f7a4d` | 수익 (초록) |
| `--loss` | `#c0392b` | 손실 (빨강) |

원칙: **지배색(종이)은 넓게, 강조색(테라코타)은 점으로.** 손익의 초록/빨강은 오직 수치에만 — 장식으로 쓰지 않는다.

### 2.2 타이포그래피

| 역할 | 폰트 | 이유 |
|------|------|------|
| 본문/UI (한글) | **Pretendard** | 한글 가독성의 사실상 표준 |
| 디스플레이/제목 | **Fraunces** (세리프) | 사유하는 에디토리얼 톤, Inter류 회피 |
| 숫자·티커 | **JetBrains Mono** | 고정폭, 금융 데이터 정렬 |

- 숫자에는 `font-variant-numeric: tabular-nums` 적용 → 표에서 자릿수 흔들림 없음.
- 티커·종목코드는 항상 모노스페이스.
- 폰트는 CSS `@import`(Pretendard는 jsDelivr, 나머지는 Google Fonts)로 로드 → 빌드 시 네트워크 의존 제거.

### 2.3 형태·간격

- 모서리: 카드 `--radius xl2 (1.25rem)`, 작은 요소 `lg`. 부드럽지만 과하지 않게.
- 컨테이너 최대폭 `max-w-5xl` — 노트처럼 읽기 좋은 폭.
- 배경에 미세한 점 그리드(radial-gradient 22px) → 모눈종이 질감.
- 그림자는 거의 안 씀. hover 시에만 살짝 떠오르는 정도.

### 2.4 모션

절제가 핵심. 인터랙션 피드백에만 사용.

- 대시보드 카드 hover: `-translate-y-0.5` + 옅은 그림자.
- 일지 카드의 삭제 버튼: hover 시에만 fade-in(`group-hover`).
- 페이지 점멸·자동 애니메이션 없음.

---

## 3. 컴포넌트 패턴

| 컴포넌트 | 위치 | 역할 |
|----------|------|------|
| `Nav` | 상단 고정 | 4개 라우트 + 저장모드 배지(●supabase/○local) |
| `PageHeader` | 페이지 상단 | kicker(모노 소문자) + 세리프 큰 제목 |
| `MarketBadge` | 인라인 | KR(잉크) / US(테라코타) 구분 칩 |
| `EmotionDots` | 일지 | 확신도 1~5를 점 5개로 |
| `EmptyState` | 공통 | 점선 박스 + 안내 문구 |
| `JournalEntryForm` | 일지 | 접힘/펼침 기록 입력 |

규칙: 시장은 항상 `MarketBadge`로, 통화·손익 색은 `format.ts`의 `fmtMoney`/`pnlClass`로 일관 처리.

---

## 4. 화면 구조

```
대시보드 (/)        3개 모듈 진입 카드 + 현황 카운트
포트폴리오 (/portfolio)  보유 종목 표(평가손익) + 관심 종목 그리드
스크리너 (/screener)     필터 카드 그리드 + 결과 테이블(관심 추가)
매매일지 (/journal)      입력 폼 + 기록 카드 목록(최신순)
```

레이아웃: 상단 Nav → 본문(`max-w-5xl`) → 하단 면책 푸터. 모든 페이지 공통 셸은 `layout.tsx`.

---

## 5. 기술 아키텍처

### 5.1 레이어 구조

```
 [ app/*  페이지 (클라이언트 컴포넌트) ]
            │ db.*, getQuotes()  만 호출
            ▼
 [ lib/data.ts   데이터 레이어 ]──┐
            │                     │ 분기
   Supabase 설정 O                Supabase 설정 X
            ▼                     ▼
   Supabase(Postgres)        브라우저 localStorage
                                  (시드 데이터 자동 주입)

 [ lib/quotes.ts  시세 어댑터 ] ── /api/quotes 프록시(KR: KIS, US: Finnhub) ── 키 없음/실패 시 mock 폴백
```

### 5.2 핵심 설계 결정

**(1) 저장소 이중화 — 점진적 도입**
`lib/data.ts`가 환경변수 유무로 Supabase ↔ localStorage를 자동 분기한다. 설치 직후엔 아무 설정 없이 동작(localStorage + 시드), 멀티기기가 필요해질 때만 `.env.local`에 키를 넣으면 영속 전환. 페이지 코드는 바뀌지 않는다 — `db` 파사드만 바라보기 때문.

**(2) 시세 어댑터 격리 — 교체 가능한 이음새**
모든 시세 접근은 `lib/quotes.ts`의 `getQuote()` 한 함수를 통한다. 내부적으로 `/api/quotes` 서버 프록시를 호출하고(KR: KIS, US: Finnhub), 키가 없거나 실패하면 mock으로 폴백한다. 데이터 소스 변경의 폭발 반경은 여전히 서버 어댑터 파일로 갇혀 있다.

**(3) 타입 단일 출처**
`lib/types.ts`의 도메인 타입(`Holding`/`WatchItem`/`JournalEntry`/`Quote`)을 모든 레이어가 공유. Supabase 스키마(`supabase/schema.sql`)의 컬럼명도 이 타입과 일치(camelCase 컬럼은 따옴표).

**(4) 보안 경계**
API 키는 절대 클라이언트로 내려가지 않는다. 모듈 A 연동 시 `app/api/quotes/route.ts`(서버)에서만 KIS/Finnhub를 호출하고, 클라이언트는 그 내부 라우트만 호출한다. `NEXT_PUBLIC_*` 접두사는 Supabase의 anon key처럼 공개 가능한 값에만 사용.

### 5.3 디렉터리

```
src/
  app/{page,portfolio,screener,journal}/   라우트
  app/{layout,globals.css}                 공통 셸·토큰
  components/                              UI 컴포넌트
  lib/types.ts        도메인 타입(단일 출처)
  lib/data.ts         저장소 파사드(분기)
  lib/quotes.ts       시세 어댑터(모듈 A 이음새)
  lib/supabase.ts     클라이언트(env 없으면 null)
  lib/format.ts       통화·퍼센트·날짜·색상
supabase/schema.sql   Postgres 스키마
```

### 5.4 확장 시 고려

- **멀티유저**: 각 테이블에 `user_id` 추가 → Supabase Auth + RLS(`auth.uid() = user_id`). 스키마 주석에 경로 명시됨.
- **캐싱**: `price_cache` 테이블 + 일 1회 배치로 KIS 유량 절감, 동시에 과거 종가 기반 복기 가능.
- **차트**: recharts로 보유 비중 도넛, 일지 확신도-손익 산점도.

---

## 6. 접근성·품질 기준

- 색만으로 의미 전달하지 않음 — 손익은 색 + 부호(+/−) + 라벨 병행.
- 모든 인터랙티브 요소 키보드 포커스 가능, `focus:border-accent`로 시각 표시.
- 본문 대비비 충분(웜 블랙 on 종이). 보조 텍스트도 `--muted`로 최소 대비 확보.
- 빈 상태마다 다음 행동을 안내하는 문구 제공.
