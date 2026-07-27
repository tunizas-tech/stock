# 산업 밸류체인 페이지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** stock_k 앱에 산업/테마별 밸류체인 기업을 정리해 보여주는 목록+상세 페이지를 추가한다(정적 TS 데이터, 밝은 종이 테마).

**Architecture:** 순수 정적 데이터 파일(`valuechains.ts`)을 서버 컴포넌트 페이지가 읽어 파이프라인 UI로 렌더. 단계는 가변, 단계별 색은 인덱스 팔레트. DB/CRUD 없음.

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript, Tailwind 3.

> **참고:** 이 저장소는 git 저장소가 아니므로 각 태스크의 커밋은 생략한다. 검증은 `npm run build`(정적) + `npm run dev` 브라우저 확인(동적)으로 한다. 로직 단위(`getValueChain`, `stageColor`)만 vitest 테스트를 둔다.

---

### Task 1: 도메인 타입 추가 (`src/lib/types.ts`)

**Files:**
- Modify: `src/lib/types.ts` (파일 끝에 추가)

- [ ] **Step 1: 타입 추가**

```ts
// ---------------------------------------------------------------------------
// 밸류체인(산업 종목 정리) — 정적 데이터 전용. DB/파사드와 무관.
// ---------------------------------------------------------------------------

export type IconKey =
  | "factory" | "solar" | "wind" | "server"
  | "chip" | "battery" | "grid" | "generic";

export interface ChainNode {
  name: string; // 종목명
  role: string; // 역할 한 줄
  ticker?: string;
  anchor?: boolean; // 대표 종목 강조
  tag?: string; // 앵커 배지 텍스트 (예: "ANCHOR")
}

export interface ChainStage {
  label: string; // 단계명 (예: "① 상류")
  en?: string; // 부제 (예: "소재 · 제조장비")
  badge?: string; // 상단 배지 (예: "UPSTREAM")
  desc?: string; // 단계 설명
  icon?: IconKey; // 생략 시 번호 배지
  nodes: ChainNode[];
}

export interface ValueChain {
  slug: string;
  title: string;
  summary: string;
  anchor?: string; // 대표 종목명
  updatedAt: string; // YYYY-MM-DD
  flows?: { forward: string; reverse: string };
  stages: ChainStage[];
  thesis?: string;
  disclaimer?: string;
  sources?: { label: string; url: string }[];
}
```

- [ ] **Step 2: 타입 체크** — `npx tsc --noEmit` → 에러 없음.

---

### Task 2: 단계 색 팔레트 (`src/lib/valuechain-theme.ts`) — TDD

**Files:**
- Create: `src/lib/valuechain-theme.ts`
- Test: `src/lib/valuechain-theme.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { describe, it, expect } from "vitest";
import { stageColor, STAGE_PALETTE } from "./valuechain-theme";

describe("stageColor", () => {
  it("인덱스 순서로 팔레트 색을 반환한다", () => {
    expect(stageColor(0)).toBe(STAGE_PALETTE[0]);
    expect(stageColor(2)).toBe(STAGE_PALETTE[2]);
  });
  it("팔레트 길이를 넘으면 순환한다", () => {
    expect(stageColor(STAGE_PALETTE.length)).toBe(STAGE_PALETTE[0]);
    expect(stageColor(STAGE_PALETTE.length + 1)).toBe(STAGE_PALETTE[1]);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/valuechain-theme.test.ts` → FAIL(모듈 없음).

- [ ] **Step 3: 구현**

```ts
// 단계별 강조색 — 밝은 종이 배경에서 대비가 확보되는 6색 시퀀스.
export const STAGE_PALETTE = [
  "#0f766e", // teal
  "#1d4ed8", // blue
  "#6d28d9", // indigo
  "#b45309", // amber
  "#be123c", // rose
  "#15803d", // green
] as const;

export function stageColor(index: number): string {
  return STAGE_PALETTE[index % STAGE_PALETTE.length];
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run src/lib/valuechain-theme.test.ts` → PASS.

---

### Task 3: 데이터 파일 + SK 시드 (`src/lib/valuechains.ts`) — TDD

**Files:**
- Create: `src/lib/valuechains.ts`
- Test: `src/lib/valuechains.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { describe, it, expect } from "vitest";
import { VALUE_CHAINS, getValueChain } from "./valuechains";

describe("valuechains", () => {
  it("SK이터닉스 시드를 slug로 찾는다", () => {
    const c = getValueChain("sk-eternix-renewable");
    expect(c?.title).toContain("SK이터닉스");
    expect(c?.stages.length).toBe(4);
  });
  it("없는 slug는 undefined", () => {
    expect(getValueChain("nope")).toBeUndefined();
  });
  it("모든 밸류체인 slug는 고유하다", () => {
    const slugs = VALUE_CHAINS.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
```

- [ ] **Step 2: 실패 확인** — FAIL(모듈 없음).

- [ ] **Step 3: 구현** — 원본 HTML 내용을 그대로 이식. `import type { ValueChain } from "./types"`.
  - 4단계: ① 상류(factory), ② 중류(solar), ③ 하류(wind, SK이터닉스 anchor), ④ 수요(server).
  - 각 단계의 종목/역할, flows(정방향/역방향), thesis, disclaimer, sources는 원본 HTML(§footer 포함) 텍스트를 그대로 사용.
  - `getValueChain(slug)`는 `VALUE_CHAINS.find`.

- [ ] **Step 4: 통과 확인** — `npx vitest run src/lib/valuechains.test.ts` → PASS.

---

### Task 4: 아이콘 세트 (`src/components/valuechain/StageIcon.tsx`)

**Files:**
- Create: `src/components/valuechain/StageIcon.tsx`

- [ ] **Step 1: 구현**
  - props: `{ icon?: IconKey; index: number; color: string }`.
  - `icon`이 있으면 대응 SVG(factory/solar/wind/server는 원본 SVG 이식, chip/battery/grid/generic은 간단 도형), `currentColor` 사용하고 컨테이너에 `style={{ color }}`.
  - `icon`이 없으면 `index+1` 번호를 원형 배지로.
  - `viewBox="0 0 128 64"`, 클래스로 크기 지정.

- [ ] **Step 2: 타입 체크** — `npx tsc --noEmit` → 에러 없음.

---

### Task 5: 파이프라인 컴포넌트 (`src/components/valuechain/ChainPipeline.tsx`)

**Files:**
- Create: `src/components/valuechain/ChainPipeline.tsx`

- [ ] **Step 1: 구현**
  - props: `{ stages: ChainStage[] }`.
  - 바깥: `overflow-x-auto`. 안쪽 트랙: `flex md:flex-row flex-col`, 단계 사이 화살표.
  - 각 단계: `min-w-[200px] flex-1`. 헤더(badge/StageIcon/label/en/desc) + 바디(종목 카드들).
  - 단계 색: `stageColor(i)` → inline style CSS 변수 `{ ["--sc" as any]: color }`, 보더/텍스트에 활용.
  - 종목 카드: 좌측 3px 컬러 보더 + `bg-surface` + hover 시 `-translate-y-0.5`. 앵커면 `border-accent` + `bg-accent/5` + tag 배지(`bg-accent text-surface`).
  - 화살표: 작은 인라인 SVG(→), 모바일에서는 `rotate-90`.
  - 서버 컴포넌트로 둔다("use client" 불필요; hover는 CSS).

- [ ] **Step 2: 타입 체크** — `npx tsc --noEmit` → 에러 없음.

---

### Task 6: 상세 페이지 (`src/app/valuechain/[slug]/page.tsx`)

**Files:**
- Create: `src/app/valuechain/[slug]/page.tsx`

- [ ] **Step 1: 구현**
  - `import { notFound } from "next/navigation"`, `getValueChain`, `ChainPipeline`, `PageHeader`.
  - `export function generateStaticParams()` → `VALUE_CHAINS.map(c => ({ slug: c.slug }))`.
  - `export default function Page({ params }: { params: { slug: string } })` (Next 14 동기 params).
  - `const chain = getValueChain(params.slug); if (!chain) notFound();`
  - 렌더: PageHeader(kicker="valuechain", title=chain.title) → summary → flows 배너(있으면 정/역방향 2줄) → `<ChainPipeline stages={chain.stages} />` → thesis/disclaimer/sources(footer, `border-t border-line`, sources는 `<a target="_blank" rel="noreferrer">`).

- [ ] **Step 2: 타입 체크** — `npx tsc --noEmit` → 에러 없음.

---

### Task 7: 목록 페이지 (`src/app/valuechain/page.tsx`)

**Files:**
- Create: `src/app/valuechain/page.tsx`

- [ ] **Step 1: 구현**
  - `import Link from "next/link"`, `VALUE_CHAINS`, `PageHeader`, `EmptyState`.
  - PageHeader(kicker="valuechain", title="산업 밸류체인").
  - `VALUE_CHAINS.length === 0` → `EmptyState`.
  - 아니면 카드 그리드(`grid gap-4 sm:grid-cols-2`): 각 카드는 `<Link href={/valuechain/${c.slug}}>` 로 감싼 `rounded-xl2 border border-line bg-surface p-5 hover:border-accent`. 내용: title(font-serif) · summary(`line-clamp-2` 대신 2줄 제한 없으면 그냥 text-sm text-muted) · 하단 메타(앵커 종목 · `{stages.length}단계` · updatedAt, tabular).

- [ ] **Step 2: 타입 체크** — `npx tsc --noEmit` → 에러 없음.

---

### Task 8: Nav에 라우트 추가 (`src/components/Nav.tsx`)

**Files:**
- Modify: `src/components/Nav.tsx:8-13` (ROUTES 배열)

- [ ] **Step 1: ROUTES에 항목 추가**

```ts
const ROUTES = [
  { href: "/", label: "대시보드" },
  { href: "/portfolio", label: "포트폴리오" },
  { href: "/screener", label: "스크리너" },
  { href: "/journal", label: "매매일지" },
  { href: "/valuechain", label: "밸류체인" },
];
```

- [ ] **Step 2: 타입 체크** — `npx tsc --noEmit` → 에러 없음.

---

### Task 9: 정적 검증 (전체)

- [ ] **Step 1: 테스트** — `npm run test` → 전부 PASS(기존 테스트 포함 무회귀).
- [ ] **Step 2: 빌드** — `npm run build` → 성공, `/valuechain` 및 `/valuechain/[slug]` 라우트가 빌드 출력에 표시.

---

### Task 10: 동적 검증 (브라우저)

- [ ] **Step 1:** `npm run dev` 백그라운드 기동.
- [ ] **Step 2:** `/valuechain` → SK이터닉스 카드 표시, 클릭 시 상세 이동.
- [ ] **Step 3:** `/valuechain/sk-eternix-renewable` → 4단계 파이프라인, 앵커 강조, 출처 링크, 밝은 종이 테마 확인.
- [ ] **Step 4:** Nav "밸류체인" 활성 표시 확인. 좁은 폭에서 세로 전환/가로 스크롤 확인.

---

## Self-Review

- **Spec coverage:** §3 파일 구조 → Task 1~8. §4 데이터/타입 → Task 1,3. §5 색 → Task 2,5. §6 컴포넌트 → Task 4~8. §9 검증기준 → Task 9,10. 누락 없음.
- **Placeholder scan:** 컴포넌트 본문 코드는 실행 시 확정(구현 지시가 구체적). 로직 태스크(1~3,8)는 완전 코드 포함.
- **Type consistency:** `ChainStage`/`ChainNode`/`ValueChain`/`IconKey`(Task1), `stageColor`/`STAGE_PALETTE`(Task2), `getValueChain`/`VALUE_CHAINS`(Task3) — 이후 태스크에서 동일 이름으로 참조.
