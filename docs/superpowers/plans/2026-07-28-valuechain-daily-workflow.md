# 밸류체인 매일 1개 축적 워크플로 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 밸류체인을 산업별 파일로 분리하고 draft/published 상태를 도입해, 매일 하나씩 초안을 만들고 브라우저 확인 후 공개하는 흐름을 가능하게 한다.

**Architecture:** 데이터는 계속 정적 TypeScript 파일에 둔다(DB 없음). `src/lib/valuechains/` 디렉터리에 산업당 파일 하나, `index.ts`가 배럴로 모아 기존 공개 API(`VALUE_CHAINS`, `getValueChain`)를 그대로 유지한다. 화면 분기 로직은 순수 함수 `splitByStatus`로 빼서 단위 테스트하고, JSX는 얇게 유지한다(이 코드베이스에 컴포넌트 테스트 도구가 없는 기존 패턴을 따름).

**Tech Stack:** Next.js 14 App Router, TypeScript, vitest(node 환경, `.test.ts`만), Tailwind

**설계 문서:** `docs/superpowers/specs/2026-07-28-valuechain-daily-workflow-design.md`

---

## File Structure

| 파일 | 역할 |
|---|---|
| `src/lib/valuechains/index.ts` (신규) | 배럴 — 산업 파일들을 모아 `VALUE_CHAINS` 구성, `getValueChain`·`splitByStatus` 제공 |
| `src/lib/valuechains/sk-eternix-renewable.ts` (신규) | 기존 시드 1건. 산업당 파일 하나 원칙의 첫 사례 |
| `src/lib/valuechains.ts` (삭제) | 위 두 파일로 대체 |
| `src/lib/types.ts` (수정) | `ValueChain`에 `status` 추가, `sources` 필수화 |
| `src/lib/valuechains.test.ts` (수정) | 규약 검증(status·출처 2개 이상·단계) + `splitByStatus` 테스트 |
| `src/app/valuechain/page.tsx` (수정) | 공개/초안 두 그룹 렌더 |
| `src/app/valuechain/[slug]/page.tsx` (수정) | 초안이면 상단 배너 |
| `docs/valuechain-backlog.md` (신규) | 다룰 산업 순서 체크리스트 |
| `README.md` (수정) | 밸류체인 작업 흐름 한 단락 |

---

### Task 1: 산업별 파일로 분리

동작 변화 없는 순수 이동. 기존 테스트가 계속 통과하는 것이 성공 기준이다.

**Files:**
- Create: `src/lib/valuechains/sk-eternix-renewable.ts`
- Create: `src/lib/valuechains/index.ts`
- Delete: `src/lib/valuechains.ts`

- [ ] **Step 1: 이동 전 기준선 확인**

Run: `npm test`
Expected: PASS (86 tests). 이 숫자를 기억해 둔다.

- [ ] **Step 2: 시드 파일로 이동**

```bash
mkdir -p src/lib/valuechains
git mv src/lib/valuechains.ts src/lib/valuechains/sk-eternix-renewable.ts
```

- [ ] **Step 3: 시드 파일을 단일 export로 바꾼다**

`src/lib/valuechains/sk-eternix-renewable.ts`의 **상단 주석·import·배열 선언부**를 아래로 교체한다.
(`stages`, `thesis`, `disclaimer`, `sources` 등 내용은 그대로 둔다.)

바꿀 앞부분 — 기존:

```ts
// 산업/테마별 밸류체인 데이터 — 정적 파일(직접 편집). 타입은 types.ts.
// 새 산업을 추가하려면 VALUE_CHAINS 배열에 ValueChain 객체를 하나 더 넣으면 된다.
// 첫 시드: SK이터닉스 중심 신재생에너지 밸류체인(원본 마인드맵 이식).

import type { ValueChain } from "./types";

export const VALUE_CHAINS: ValueChain[] = [
  {
    slug: "sk-eternix-renewable",
```

새로:

```ts
// SK이터닉스 중심 신재생에너지 밸류체인 (첫 시드, 원본 마인드맵 이식).

import type { ValueChain } from "../types";

export const skEternixRenewable: ValueChain = {
  slug: "sk-eternix-renewable",
```

그리고 파일 **끝부분** — 기존:

```ts
    ],
  },
];

export function getValueChain(slug: string): ValueChain | undefined {
  return VALUE_CHAINS.find((c) => c.slug === slug);
}
```

새로 (배열 닫는 `];`와 `getValueChain`을 걷어내고 객체만 닫는다):

```ts
    ],
};
```

객체 리터럴 내부의 들여쓰기가 한 단계 깊게 남는데, 동작에는 영향이 없다. 에디터에서 파일 전체를
선택해 한 단계 내어쓰기 해도 되고 그대로 두어도 된다(이 저장소에는 prettier가 설치돼 있지 않다).

- [ ] **Step 4: 배럴 파일 작성**

Create `src/lib/valuechains/index.ts`:

```ts
// 산업/테마별 밸류체인 — 산업당 파일 하나. 새 산업은 파일을 만들고 아래 배열에 추가한다.
// 작업 순서는 docs/valuechain-backlog.md 를 따른다.

import type { ValueChain } from "../types";
import { skEternixRenewable } from "./sk-eternix-renewable";

export const VALUE_CHAINS: ValueChain[] = [skEternixRenewable];

export function getValueChain(slug: string): ValueChain | undefined {
  return VALUE_CHAINS.find((c) => c.slug === slug);
}
```

- [ ] **Step 5: 테스트로 이동이 무해했는지 확인**

Run: `npm test`
Expected: PASS, Step 1과 같은 86 tests. (`src/lib/valuechains.test.ts`의 `import ... from "./valuechains"`는 디렉터리의 `index.ts`로 해석되므로 수정할 필요가 없다.)

Run: `npx tsc --noEmit`
Expected: 출력 없음

- [ ] **Step 6: 커밋**

```bash
git add -A src/lib
git commit -m "refactor(valuechain): 산업별 파일로 분리"
```

---

### Task 2: draft/published 상태 도입

**Files:**
- Modify: `src/lib/types.ts:113-124`
- Modify: `src/lib/valuechains/sk-eternix-renewable.ts`
- Test: `src/lib/valuechains.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/valuechains.test.ts`의 `describe("valuechains", ...)` 블록 안, 마지막 `it` 뒤에 추가:

```ts
  it("모든 밸류체인은 단계를 가진다", () => {
    for (const c of VALUE_CHAINS) {
      expect(c.stages.length).toBeGreaterThan(0);
    }
  });
  it("모든 밸류체인은 유효한 status를 가진다", () => {
    for (const c of VALUE_CHAINS) {
      expect(["draft", "published"]).toContain(c.status);
    }
  });
  it("모든 밸류체인은 출처를 2개 이상 가진다", () => {
    for (const c of VALUE_CHAINS) {
      expect(c.sources.length).toBeGreaterThanOrEqual(2);
    }
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- valuechains`
Expected: FAIL — "모든 밸류체인은 유효한 status를 가진다"에서 `undefined`가 배열에 없다는 오류. (타입상으로도 `c.status`는 아직 존재하지 않는다.)

- [ ] **Step 3: 타입에 필드 추가**

`src/lib/types.ts`의 `ValueChain`을 아래로 교체한다:

```ts
export interface ValueChain {
  slug: string;
  title: string;
  summary: string;
  status: "draft" | "published"; // 초안은 목록에서 "초안" 그룹으로 분리 표시
  anchor?: string; // 대표 종목명
  updatedAt: string; // YYYY-MM-DD
  flows?: { forward: string; reverse: string };
  stages: ChainStage[];
  thesis?: string;
  disclaimer?: string;
  sources: { label: string; url: string }[]; // 정확도 규약상 2개 이상
}
```

`sources`를 필수로 바꾸므로, 출처 없이 체인을 추가하면 컴파일 단계에서 걸린다.

- [ ] **Step 4: 시드에 status 지정**

`src/lib/valuechains/sk-eternix-renewable.ts`에서 `summary:` 항목 바로 뒤에 한 줄 추가:

```ts
  status: "published",
```

- [ ] **Step 5: 통과 확인**

Run: `npm test`
Expected: PASS (89 tests — 3개 증가)

Run: `npx tsc --noEmit`
Expected: 출력 없음

- [ ] **Step 6: 커밋**

```bash
git add src/lib/types.ts src/lib/valuechains/sk-eternix-renewable.ts src/lib/valuechains.test.ts
git commit -m "feat(valuechain): draft/published 상태와 출처 2개 이상 규약 추가"
```

---

### Task 3: 목록 페이지에 공개/초안 그룹

**Files:**
- Modify: `src/lib/valuechains/index.ts`
- Modify: `src/app/valuechain/page.tsx`
- Test: `src/lib/valuechains.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/valuechains.test.ts` 파일 맨 위 import를 아래로 교체:

```ts
import { describe, it, expect } from "vitest";
import type { ValueChain } from "./types";
import { VALUE_CHAINS, getValueChain, splitByStatus } from "./valuechains";
```

파일 맨 아래(기존 `describe` 블록 뒤)에 추가:

```ts
describe("splitByStatus", () => {
  const chain = (slug: string, status: "draft" | "published"): ValueChain => ({
    slug,
    title: slug,
    summary: "",
    status,
    updatedAt: "2026-07-28",
    stages: [{ label: "①", nodes: [{ name: "종목", role: "역할" }] }],
    sources: [
      { label: "a", url: "https://a" },
      { label: "b", url: "https://b" },
    ],
  });

  it("공개본과 초안을 나눈다", () => {
    const { published, drafts } = splitByStatus([
      chain("a", "published"),
      chain("b", "draft"),
      chain("c", "published"),
    ]);
    expect(published.map((c) => c.slug)).toEqual(["a", "c"]);
    expect(drafts.map((c) => c.slug)).toEqual(["b"]);
  });

  it("빈 배열이면 양쪽 모두 비어 있다", () => {
    const { published, drafts } = splitByStatus([]);
    expect(published).toEqual([]);
    expect(drafts).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- valuechains`
Expected: FAIL — `splitByStatus is not a function`

- [ ] **Step 3: 함수 구현**

`src/lib/valuechains/index.ts`의 `getValueChain` 아래에 추가:

```ts
/** 목록 화면용 — 공개본과 초안을 나눈다. */
export function splitByStatus(chains: ValueChain[]): {
  published: ValueChain[];
  drafts: ValueChain[];
} {
  return {
    published: chains.filter((c) => c.status === "published"),
    drafts: chains.filter((c) => c.status === "draft"),
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: PASS (91 tests)

- [ ] **Step 5: 목록 페이지 수정**

`src/app/valuechain/page.tsx` 전체를 아래로 교체한다. 카드 마크업은 기존과 동일하고, 반복을 피하려고 같은 파일 안의 로컬 컴포넌트로 뺐다.

```tsx
// 밸류체인 목록(디자인 §6.3). 산업 카드 → 상세 링크. 정적 데이터 서버 컴포넌트.
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { VALUE_CHAINS, splitByStatus } from "@/lib/valuechains";
import type { ValueChain } from "@/lib/types";

function ChainCard({ chain }: { chain: ValueChain }) {
  return (
    <Link
      href={`/valuechain/${chain.slug}`}
      className="group rounded-xl2 border border-line bg-surface p-5 transition-colors hover:border-accent"
    >
      <h2 className="font-serif text-lg font-semibold text-ink group-hover:text-accent">
        {chain.title}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">{chain.summary}</p>
      <div className="tabular mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {chain.status === "draft" && (
          <span className="rounded border border-loss px-1.5 py-0.5 font-semibold text-loss">
            초안
          </span>
        )}
        {chain.anchor && <span className="text-accent">◆ {chain.anchor}</span>}
        <span>{chain.stages.length}단계</span>
        <span>업데이트 {chain.updatedAt}</span>
      </div>
    </Link>
  );
}

export default function ValueChainListPage() {
  const { published, drafts } = splitByStatus(VALUE_CHAINS);

  return (
    <div>
      <PageHeader kicker="valuechain" title="산업 밸류체인" />

      {VALUE_CHAINS.length === 0 ? (
        <EmptyState
          title="아직 정리된 밸류체인이 없습니다"
          hint="src/lib/valuechains/ 에 산업 파일을 추가하면 여기에 나타납니다."
        />
      ) : (
        <div className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-2">
            {published.map((c) => (
              <ChainCard key={c.slug} chain={c} />
            ))}
          </div>

          {drafts.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
                초안 — 검수 대기 {drafts.length}건
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {drafts.map((c) => (
                  <ChainCard key={c.slug} chain={c} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: 타입·빌드 확인**

Run: `npx tsc --noEmit`
Expected: 출력 없음

Run: `npm run build`
Expected: `✓ Compiled successfully`, `/valuechain` 라우트가 목록에 나타남

- [ ] **Step 7: 커밋**

```bash
git add src/lib/valuechains/index.ts src/lib/valuechains.test.ts src/app/valuechain/page.tsx
git commit -m "feat(valuechain): 목록을 공개/초안 그룹으로 분리"
```

---

### Task 4: 상세 페이지 초안 배너

**Files:**
- Modify: `src/app/valuechain/[slug]/page.tsx:33-35`

- [ ] **Step 1: 배너 추가**

`src/app/valuechain/[slug]/page.tsx`에서 summary 문단 앞에 조건부 배너를 넣는다.

기존:

```tsx
      <p className="-mt-4 mb-6 max-w-3xl text-sm leading-relaxed text-muted">
        {chain.summary}
      </p>
```

새로:

```tsx
      {chain.status === "draft" && (
        <p className="-mt-4 mb-4 rounded-lg border border-loss bg-surface px-3 py-2 text-xs font-semibold text-loss">
          검수 전 초안입니다 — 종목·내용이 바뀔 수 있습니다.
        </p>
      )}

      <p className="mb-6 max-w-3xl text-sm leading-relaxed text-muted">
        {chain.summary}
      </p>
```

초안일 때는 배너가 `-mt-4`를 가져가고, summary는 일반 여백을 쓴다. 공개본에서는 summary 위 여백이 기존보다 약간 넓어지는데, 이는 배너 유무에 따라 헤더 간격이 달라지지 않도록 하기 위한 것이다.

- [ ] **Step 2: 초안 상태를 눈으로 확인**

임시로 `src/lib/valuechains/sk-eternix-renewable.ts`의 `status`를 `"draft"`로 바꾼다.

```bash
npm run dev
```

브라우저에서 확인:
- `http://localhost:3000/valuechain` → 공개 그리드가 비고, "초안 — 검수 대기 1건" 섹션에 카드가 "초안" 배지와 함께 보인다
- `http://localhost:3000/valuechain/sk-eternix-renewable` → 제목 아래 붉은 "검수 전 초안입니다" 배너

확인 후 `status`를 `"published"`로 되돌리고, 목록에서 다시 공개 그리드에 나타나는지 본다.

- [ ] **Step 3: 타입·테스트 확인**

Run: `npx tsc --noEmit && npm test`
Expected: 출력 없음 / PASS (91 tests)

- [ ] **Step 4: 커밋**

```bash
git add "src/app/valuechain/[slug]/page.tsx"
git commit -m "feat(valuechain): 초안 상세에 검수 전 배너 표시"
```

---

### Task 5: 백로그 문서와 README 갱신

**Files:**
- Create: `docs/valuechain-backlog.md`
- Modify: `README.md:49` 부근(밸류체인 관련 서술이 없으면 뉴스 섹션 앞에 새 섹션 추가)

- [ ] **Step 1: 백로그 작성**

Create `docs/valuechain-backlog.md`:

```markdown
# 밸류체인 백로그

매일 하나씩 위에서부터 작업한다. 공개 전환 시 체크한다.
순서는 언제든 바꿔도 되고, 항목을 추가·삭제해도 된다.

작업 방법은 README "밸류체인" 절 참고.

## 대기

- [ ] HBM · 반도체 후공정(패키징)
- [ ] 반도체 소부장(소재·부품·장비)
- [ ] AI 데이터센터 인프라(전력·냉각)
- [ ] 전력기기 · 변압기(북미 그리드 교체)
- [ ] 원자력 · SMR
- [ ] 방산(지상무기 · 유도무기)
- [ ] 조선 · 해운
- [ ] 2차전지 양극재 · 음극재
- [ ] 전고체 배터리
- [ ] ESS · 전력저장
- [ ] 수소(생산 · 운송 · 연료전지)
- [ ] 해상풍력
- [ ] 로봇(협동로봇 · 감속기 · 액추에이터)
- [ ] 자율주행 · 차량 전장
- [ ] 우주항공 · 위성
- [ ] 바이오 CDMO
- [ ] 비만치료제(GLP-1)
- [ ] 의료기기 · 미용기기
- [ ] 디스플레이 OLED
- [ ] 통신장비 · 광케이블
- [ ] 화장품 ODM(K-뷰티)
- [ ] 음식료 · K-푸드
- [ ] 엔터 · 콘텐츠
- [ ] 게임
- [ ] 건설 · 플랜트
- [ ] 철강 · 비철금속
- [ ] 정유 · 석유화학
- [ ] 완성차 · 자동차부품

## 완료

- [x] 신재생에너지(SK이터닉스 중심) — `sk-eternix-renewable`
```

- [ ] **Step 2: README에 작업 흐름 추가**

`README.md`의 "## 뉴스 대시보드(/news)" 섹션 **바로 앞**에 아래를 삽입한다:

```markdown
## 밸류체인(/valuechain)

- 데이터는 정적 파일이다. 산업당 파일 하나: `src/lib/valuechains/<slug>.ts` → `index.ts` 배럴이 모은다.
- 각 체인은 `status: "draft" | "published"`를 가진다. 초안은 목록에서 "초안" 그룹으로 분리되고 상세 상단에 배너가 붙는다.
- 작업 순서는 `docs/valuechain-backlog.md`. 맨 위 미완료 항목을 초안으로 만들고, 브라우저 확인 후 `published`로 바꾸며 체크한다.
- 정확도 규약: 출처 2개 이상 필수, 각 종목의 역할은 출처에서 확인된 사업 내용만 기재, 확신이 낮은 종목은 넣지 않는다.
```

- [ ] **Step 3: 커밋**

```bash
git add docs/valuechain-backlog.md README.md
git commit -m "docs(valuechain): 산업 백로그와 작업 흐름 문서화"
```

- [ ] **Step 4: 최종 확인 후 푸시**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: PASS (91 tests) / 출력 없음 / `✓ Compiled successfully`

```bash
git push
```

---

## 완료 기준

- `npm test` 91개 통과, `npx tsc --noEmit` 무출력, `npm run build` 성공
- `/valuechain`에 공개 그리드와 초안 섹션이 분리되어 보인다
- 새 산업을 추가하려면 `src/lib/valuechains/<slug>.ts`를 만들고 `index.ts` 배열에 한 줄 추가하면 된다
- `docs/valuechain-backlog.md`의 맨 위 미완료 항목이 "오늘 할 산업"이다
