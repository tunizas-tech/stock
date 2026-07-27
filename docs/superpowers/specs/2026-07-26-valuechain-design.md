# 산업 밸류체인 (Value Chain) 페이지 — 설계

- 날짜: 2026-07-26
- 대상 프로젝트: `stock_k` (Next.js + Tailwind + Supabase)
- 원본 참조: `C:\Users\jj\Downloads\sk_eternix_valuechain_mindmap_4.html` (SK이터닉스 신재생에너지 밸류체인 마인드맵)

## 1. 목적

주식 산업/테마별 **밸류체인 기업**을 정리해 한눈에 보는 페이지를 stock_k 앱에
새 라우트로 추가한다. 원본 SK 페이지의 "파이프라인" 레이아웃(단계 → 화살표 →
단계, 단계 안에 종목 카드, 앵커 종목 강조, 모바일 세로 전환)을 재사용하되,
색·폰트는 stock_k의 밝은 종이 테마로 리스킨해 앱 안에서 하나의 제품으로 읽히게 한다.

여러 산업을 다루므로 **목록 페이지 + 산업별 상세 페이지** 구조로 둔다.

## 2. 확정된 결정 (브레인스토밍 결과)

| 항목 | 결정 |
|------|------|
| 형태 | stock_k 앱에 통합된 Next.js/Tailwind 컴포넌트 (독립 HTML 아님) |
| 데이터 관리 | 코드 안 데이터 파일(TS) 직접 편집. DB/UI CRUD 없음 |
| 페이지 구조 | 목록(`/valuechain`) + 산업별 상세(`/valuechain/[slug]`) |
| 단계 구조 | 가변 단계 (산업마다 3~6단계 자유), 색은 팔레트 인덱스 순환 |
| 테마 | 밝은 종이 테마로 리스킨 (stock_k 토큰과 동일) |

## 3. 아키텍처 / 파일

```
src/lib/types.ts                           # (수정) ChainNode/ChainStage/ValueChain/IconKey 타입 추가
src/lib/valuechains.ts                     # 데이터(TS) 직접 편집 + getValueChain(). SK 예시 1건 시드
src/lib/valuechain-theme.ts                # 단계 색 팔레트(인덱스 → 색)
src/app/valuechain/page.tsx                # 목록: 산업 카드 → 상세 링크
src/app/valuechain/[slug]/page.tsx         # 상세: 파이프라인 렌더
src/components/valuechain/ChainPipeline.tsx# 파이프라인 본체(단계 + 화살표, 반응형)
src/components/valuechain/StageIcon.tsx    # 내장 SVG 아이콘 세트(키 → SVG)
src/components/Nav.tsx                      # (수정) ROUTES에 밸류체인 항목 추가
```

> **타입 위치**: `types.ts` 헤더가 "도메인 타입 단일 출처"를 규정하므로, 밸류체인
> 타입(§4)은 `types.ts`에 정의하고 `valuechains.ts`·컴포넌트가 import 한다.

- **데이터 소스는 순수 정적 파일**이다. 기존 `db` 파사드(Supabase/localStorage)와
  무관하다. 밸류체인은 사용자가 앱에서 편집하는 데이터가 아니라 큐레이션된
  참고 자료이기 때문.
- 목록/상세 페이지는 정적 데이터만 읽으므로 서버 컴포넌트로 둘 수 있다
  (`"use client"` 불필요). 상호작용은 CSS hover 수준이라 클라이언트 상태 없음.

## 4. 데이터 모델 (타입은 `src/lib/types.ts`, 데이터는 `src/lib/valuechains.ts`)

```ts
export type IconKey =
  | "factory" | "solar" | "wind" | "server"
  | "chip" | "battery" | "grid" | "generic";

export type ChainNode = {
  name: string;      // 종목명 — 예: "레이크머티리얼즈"
  role: string;      // 역할 한 줄 — 예: "태양광·반도체용 초고순도 유기금속(TMA)"
  ticker?: string;   // 선택: 종목코드
  anchor?: boolean;  // 선택: 앵커(대표) 종목 강조
  tag?: string;      // 선택: 앵커 배지 텍스트 — 예: "ANCHOR"
};

export type ChainStage = {
  label: string;     // 단계명 — 예: "① 상류"
  en?: string;       // 선택: 영문/부제 — 예: "소재 · 제조장비"
  badge?: string;    // 선택: 상단 배지 — 예: "UPSTREAM"
  desc?: string;     // 선택: 단계 설명 한두 줄
  icon?: IconKey;    // 선택: 아이콘. 생략 시 번호 배지로 대체
  nodes: ChainNode[];
};

export type ValueChain = {
  slug: string;      // URL 조각 — 예: "sk-eternix-renewable"
  title: string;     // 예: "SK이터닉스 중심 신재생에너지 밸류체인"
  summary: string;   // 상단 설명 문단
  anchor?: string;   // 선택: 대표 종목명(목록 카드에 표기)
  updatedAt: string; // ISO 날짜 — 예: "2026-07-26"
  flows?: {          // 선택: 흐름 배너(원본의 정방향/역방향 설명)
    forward: string;
    reverse: string;
  };
  stages: ChainStage[];         // 가변 단계
  thesis?: string;              // 선택: 핵심 논리(원본 footer)
  disclaimer?: string;          // 선택: 면책 문구
  sources?: { label: string; url: string }[]; // 선택: 출처 링크
};

// 위 타입들은 src/lib/types.ts 에 정의. 아래 데이터는 src/lib/valuechains.ts.
export const VALUE_CHAINS: ValueChain[] = [ /* SK이터닉스 예시 1건 */ ];

export function getValueChain(slug: string): ValueChain | undefined {
  return VALUE_CHAINS.find((c) => c.slug === slug);
}
```

- **SK 예시 시드**: 원본 HTML의 4단계/종목/역할/흐름/thesis/disclaimer/sources를
  그대로 이 구조에 옮겨 첫 데이터로 넣는다. 아이콘은
  factory→solar→wind→server 로 매핑.
- **Next 14 App Router 주의**: `[slug]/page.tsx`의 `params`는 Next 14에서 **동기
  객체**다(Next 15의 `Promise<params>` 아님). `{ params }: { params: { slug: string } }`
  형태로 받는다. `notFound()`는 `next/navigation`에서 import.

## 5. 색상 / 테마 (`src/lib/valuechain-theme.ts`)

- stock_k 토큰(`bg`, `surface`, `ink`, `muted`, `line`, `accent`)을 기본으로 사용.
- 단계별 강조색은 **6색 시퀀스 팔레트**를 인덱스로 배정, 단계가 6개를 넘으면 순환:
  - 예: `["#0f766e"(teal), "#1d4ed8"(blue), "#6d28d9"(indigo), "#b45309"(amber), "#be123c"(rose), "#15803d"(green)]`
  - 밝은 크림 배경에서 대비가 확보되는 채도로 선택.
- 단계 색은 **인덱스 기반 동적**이라 Tailwind 정적 클래스와 안 맞음 → 해당 색은
  inline style(CSS 변수)로 주입한다. 나머지 레이아웃/여백/타이포는 Tailwind 클래스.
- **앵커 종목**(`anchor: true`)은 `accent`(번트오렌지) 테두리 + 옅은 tint 배경 +
  `tag` 배지로 강조(원본의 `.node.sk`에 대응).

## 6. 컴포넌트 명세

### 6.1 `ChainPipeline.tsx`
- 입력: `stages: ChainStage[]`.
- 데스크톱: 가로 flex 파이프라인 — 단계 컬럼들 사이에 화살표(SVG). 각 컬럼은
  헤더(배지/아이콘/label/en/desc) + 바디(종목 카드 목록).
- **폭 처리**: 레이아웃 컨테이너가 `max-w-5xl`(1024px)이므로, 가로 트랙을
  `overflow-x-auto`로 감싸고 각 단계에 `min-width`(예: 200px)를 준다. 단계가 많으면
  (5~6개) 컨테이너 안에서 가로 스크롤된다. 4단계 이하는 폭에 맞게 균등 분배.
- 모바일(`max-md`): 세로 스택, 화살표 90도 회전(원본과 동일 동작).
- 종목 카드: 좌측 3px 컬러 보더 + `surface` 배경, hover 시 살짝 떠오름
  (원본 `.node:hover` 대응). 앵커 카드는 §5 강조.
- 단계 색은 `stageColor(index)`로 계산해 inline CSS 변수로 전달.

### 6.2 `StageIcon.tsx`
- 입력: `icon?: IconKey`, `index: number`.
- 내장 SVG 세트(factory/solar/wind/server/chip/battery/grid/generic).
  원본 SVG 4종(factory/solar/wind/server)을 옮기고 나머지는 간단한 형태로 추가.
- `icon` 없으면 단계 번호(index+1)를 원형 배지로 렌더.

### 6.3 목록 페이지 `valuechain/page.tsx`
- `PageHeader kicker="valuechain" title="산업 밸류체인"`.
- `VALUE_CHAINS`를 카드 그리드로: 각 카드에 title · summary(1줄 clamp) ·
  anchor 종목 · 단계 수 · updatedAt. 카드 전체가 `/valuechain/[slug]` 링크.
- 데이터가 비면 기존 `EmptyState` 재사용.

### 6.4 상세 페이지 `valuechain/[slug]/page.tsx`
- `getValueChain(slug)` → 없으면 `notFound()`.
- 헤더(title/summary) → flows 배너(있으면) → `ChainPipeline` → thesis/disclaimer/
  sources(footer). 원본 페이지 구조를 그대로 따른다.

### 6.5 `Nav.tsx` (수정)
- `ROUTES`에 `{ href: "/valuechain", label: "밸류체인" }` 추가.
- 기존 배열 스타일 그대로. 나머지 라인은 손대지 않는다.

## 7. 데이터 흐름

정적 파일(`valuechains.ts`) → 페이지(서버 컴포넌트)가 import → props로
컴포넌트에 전달 → SVG/HTML 렌더. 런타임 fetch·DB·상태 없음.

## 8. 에러 처리

- 상세 페이지: 잘못된 slug → `notFound()` (Next.js 기본 404).
- 목록: 데이터 0건 → `EmptyState`.
- 데이터 형식 오류는 컴파일 타임에 타입으로 방지(순수 TS 데이터라 런타임 검증 불필요).

## 9. 검증 기준 (성공 조건)

1. `/valuechain` 접속 → SK이터닉스 카드 1건 표시. → 확인: 카드 클릭 시 상세 이동.
2. `/valuechain/sk-eternix-renewable` → 4단계 파이프라인이 밝은 종이 테마로
   렌더, 단계별 색·앵커(SK이터닉스) 강조·흐름 배너·출처 링크 표시.
   → 확인: 원본 HTML과 정보(종목/역할/thesis) 일치.
3. 데스크톱 가로 / 모바일(≤768px) 세로 전환 정상. → 확인: 창 축소로 육안 확인.
4. Nav에 "밸류체인" 항목 추가, 활성 상태 표시 정상. → 확인: 라우트 이동 시 하이라이트.
5. `npm run build` 통과(타입/린트). → 확인: 빌드 로그 무오류.

## 10. 범위 밖 (YAGNI)

- UI를 통한 밸류체인 추가/편집(CRUD) 없음 — 파일 직접 편집.
- DB/Supabase 연동 없음 — 순수 정적 데이터.
- 시세·재무 데이터 연동 없음.
- 검색/필터/정렬 없음(산업 수가 많아지면 그때 추가).
- 원본 다크 테마 유지 안 함(밝은 종이 테마로 통일).

## 11. 향후 확장 여지 (지금 구현 안 함)

- 종목 카드에서 stock_k 관심종목/포트폴리오로 연결(ticker 기반).
- 산업 많아질 때 목록 검색/태그 필터.
- 밸류체인 데이터를 Supabase로 이전(db 파사드 패턴 재사용 가능).
