# 수급평단 1단계 — 내 평단 vs 외국인·기관 평단 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/portfolio`의 유니버스 안 보유종목마다 "외국인은 나보다 15.1% 비싸게 샀고 지금 −13.1% 물려 있음" 같은 결론 한 줄과, 펼치면 보이는 주체별 3카드(추정평단·현재 수익률·순매수액) + 평단 위치 바를 붙인다.

**Architecture:** 계산은 전부 순수 함수(`src/lib/flow/avg-price.ts`, `avg-price-headline.ts`)로 두고 TDD로 만든다. 새 라우트 `GET /api/flow?ticker=&window=`는 `data/flow/<ticker>.json` 한 파일만 읽어 순수 함수 결과를 그대로 돌려준다. 클라이언트 컴포넌트 `SupplyAvgPrice`가 보유행 아래 한 줄로 그린다. DB·적재·라이브러리 추가 없음.

**Tech Stack:** Next.js 14 App Router (nodejs route), TypeScript, vitest(node env, `src/**/*.test.ts`만), Tailwind 토큰(`ink/muted/line/surface/accent/gain/loss`).

**Spec:** `docs/superpowers/specs/2026-09-10-supply-avg-price-review.md` §1.1(수식·유효성), §2(데이터 함정), §3.1·§3.2·§3.3(a), §4 1단계.

## Global Constraints

- **단위**: `FlowDay.foreign/institution/individual`은 **백만원**, `*Qty`는 **주**. 평단(원) = `ΣV × 1,000,000 / ΣQ`. 실측 고정값(2026-08-11~09-08, HD한국조선해양 009540, 창 20): 외국인 ΣV=50,906 ΣQ=127,674 → **398,719원**, 종가 346,500 → −13.10%; 기관 ΣV=−77,980 ΣQ=−203,351 → **383,475원** side=sell; 창 종가 최저 329,500 최고 398,000.
- 유효성(spec §1.1): ΣQ=0 → null `zero-qty`; sign(ΣV)≠sign(ΣQ) → null `sign-mismatch`; ΣQ<0∧ΣV<0 → 유효 `side:"sell"`; 창 안 하루 종가 변동 |Δ| ≥ 40% → null `corp-action`. 노이즈 규칙(평균거래량 × 0.001)은 **거래량 데이터가 없어 1단계에서 뺀다**.
- 창은 `5 | 20 | 60`만 허용, 1단계 UI는 20 고정. `days`는 날짜 오름차순으로 저장돼 있다(`data/flow/*.json`) — 창 = 마지막 W개. `tradingDays < W`면 UI에 `(N일치)`.
- 개인(individual)은 계산·API엔 포함하되 **UI엔 표시하지 않는다**(백필 구간 0, spec §2 함정 2).
- 결론 문장은 순수 함수가 만든다. 숫자 색은 `pnlClass`, 부호는 항상 표시(`−`는 U+2212, `fmtPct`와 동일). 정직성 캡션 필수: "평단은 그 주체의 손익 상태를 기술할 뿐, 다음 수익률을 예측하지 않는다." + "기관에는 연기금·투신·보험이 섞여 있다." + "막대는 종가 범위(고저가 아님)".
- 라우트 관례: 동적 세그먼트 대신 쿼리(`/api/candles?…`와 동일). `runtime = "nodejs"`, `dynamic = "force-dynamic"`. 파일 없으면 404 + `hint: "npm run flow:fetch"`. Basic Auth 미들웨어가 `/api/*`를 덮으므로 인증 코드 추가 없음.
- 브랜치 `feat/supply-avg-price-1`. TDD: RED를 실제로 확인한 뒤 GREEN. 로컬 :3000에서 사용자 "됐어" 후에만 main merge·push.
- 주석은 기존 코드처럼 국문으로 "왜". 커밋 트레일러 두 줄:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01MadX5txAYgeg3PS1TbdBNu`

## File Structure

| 파일 | 역할 |
|---|---|
| `src/lib/flow/avg-price.ts` (새) | `supplyAvgPrice`(주체 1개 평단), `closeRange`, `pricePositionPct`, `buildAvgPriceView`(API 응답 조립) — 전부 순수 |
| `src/lib/flow/avg-price.test.ts` (새) | 위 함수 테스트. 첫 케이스는 단위 환산 고정값 |
| `src/lib/flow/avg-price-headline.ts` (새) | `avgPriceHeadline` — 결론 문장. UI 문구는 여기만 |
| `src/lib/flow/avg-price-headline.test.ts` (새) | 문장 케이스 |
| `src/app/api/flow/route.ts` (새) | 파일 읽기·파라미터 검증만. 계산은 `buildAvgPriceView` |
| `src/app/api/flow/route.test.ts` (새) | `node:fs` 메모리 목으로 배선 검증(관측소 라우트 테스트와 같은 방식) |
| `src/components/SupplyAvgPrice.tsx` (새) | 결론 한 줄 + `<details>` 3카드·위치 바. fetch 1회 |
| `src/app/portfolio/page.tsx` (수정) | `HoldingRow` 아래 유니버스 종목이면 컴포넌트 행 추가 |

---

### Task 0: 브랜치

- [ ] **Step 1: 브랜치 생성**

```bash
cd ~/Desktop/AI/stock && git switch -c feat/supply-avg-price-1
```

---

### Task 1: `supplyAvgPrice` — 단위 환산과 유효성 규칙

**Files:**
- Create: `src/lib/flow/avg-price.ts`
- Test: `src/lib/flow/avg-price.test.ts`

**Interfaces:**
- Consumes: `FlowDay` from `@/lib/flow/aggregate`
- Produces:
  ```ts
  export type FlowActor = "foreign" | "institution" | "individual";
  export const AVG_WINDOWS = [5, 20, 60] as const;
  export type AvgWindow = (typeof AVG_WINDOWS)[number];
  export type AvgPriceReason = "zero-qty" | "sign-mismatch" | "corp-action";
  export interface SupplyAvgPrice {
    actor: FlowActor; window: AvgWindow;
    avgPrice: number | null; side: "buy" | "sell" | null; returnPct: number | null;
    sumValue: number; sumQty: number; tradingDays: number; reason?: AvgPriceReason;
  }
  export function supplyAvgPrice(days: FlowDay[], actor: FlowActor, window: AvgWindow): SupplyAvgPrice;
  ```

- [ ] **Step 1: 실패하는 테스트 — 단위 환산 고정값**

`src/lib/flow/avg-price.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { FlowDay } from "./aggregate";
import { supplyAvgPrice } from "./avg-price";

// 테스트용 하루치. 값은 백만원·주 — 실제 파일과 같은 단위.
function day(
  date: string,
  close: number,
  v: Partial<Pick<FlowDay, "foreign" | "institution" | "individual">> = {},
  q: Partial<Pick<FlowDay, "foreignQty" | "institutionQty" | "individualQty">> = {},
): FlowDay {
  return {
    date, close,
    foreign: v.foreign ?? 0, institution: v.institution ?? 0, individual: v.individual ?? 0,
    foreignQty: q.foreignQty ?? 0, institutionQty: q.institutionQty ?? 0, individualQty: q.individualQty ?? 0,
  };
}

// 20일을 한 줄로: 첫날에 ΣV·ΣQ를 몰아 넣고 나머지 19일은 0 — 창 슬라이싱과 무관하게
// 합계만 검증하기 위해. 종가는 마지막 날만 의미 있다.
function twentyDays(last: Partial<FlowDay>, first: Partial<FlowDay> = {}): FlowDay[] {
  const days: FlowDay[] = [];
  for (let i = 0; i < 20; i++) {
    const d = day(`2026-08-${String(11 + i).padStart(2, "0")}`, 346500);
    days.push(i === 0 ? { ...d, ...first } : i === 19 ? { ...d, ...last } : d);
  }
  return days;
}

describe("supplyAvgPrice", () => {
  it("백만원 × 1,000,000 / 주 = 원 — 009540 20일 외국인 실측값 398,719원, 종가 대비 −13.10%", () => {
    const days = twentyDays({ close: 346500 }, { foreign: 50906, foreignQty: 127674 });
    const r = supplyAvgPrice(days, "foreign", 20);
    expect(r.avgPrice).toBe(398719);
    expect(r.side).toBe("buy");
    expect(r.returnPct).toBeCloseTo(-13.1, 1);
    expect(r.sumValue).toBe(50906);
    expect(r.sumQty).toBe(127674);
    expect(r.tradingDays).toBe(20);
    expect(r.reason).toBeUndefined();
  });
});
```

- [ ] **Step 2: RED 확인**

Run: `cd ~/Desktop/AI/stock && npx vitest run src/lib/flow/avg-price.test.ts`
Expected: FAIL — `Failed to resolve import "./avg-price"` (모듈 없음).

- [ ] **Step 3: 최소 구현**

`src/lib/flow/avg-price.ts`:

```ts
// 수급평단 — "외국인·기관이 최근 W일 동안 산 주식의 평균 단가"를 종목 단위로 구한다.
// aggregate.ts(섹터 합산)와 역할이 달라 파일을 나눈다. 파일 I/O 없음, 입력은 FlowDay.
//
// 단위 함정: foreign/institution/individual은 백만원, *Qty는 주. 평단(원) = ΣV × 1e6 / ΣQ.
// 이 한 줄이 틀리면 평단이 100만 배 틀리므로 첫 테스트가 실측 고정값이다.
import type { FlowDay } from "./aggregate";

export type FlowActor = "foreign" | "institution" | "individual";
export const AVG_WINDOWS = [5, 20, 60] as const;
export type AvgWindow = (typeof AVG_WINDOWS)[number];
export type AvgPriceReason = "zero-qty" | "sign-mismatch" | "corp-action";

export interface SupplyAvgPrice {
  actor: FlowActor;
  window: AvgWindow;
  /** 원. null이면 reason에 이유. */
  avgPrice: number | null;
  /** ΣQ>0 → buy(매수평단), ΣQ<0 → sell(매도평단). "물렸다/이익이다" 해석이 뒤집히므로 UI가 반드시 표시. */
  side: "buy" | "sell" | null;
  /** (창 마지막 종가 − 평단) / 평단 × 100 */
  returnPct: number | null;
  /** 백만원 */
  sumValue: number;
  /** 주 */
  sumQty: number;
  /** 실제 창에 들어간 일수(데이터가 W일보다 짧으면 그만큼) */
  tradingDays: number;
  reason?: AvgPriceReason;
}

const QTY_KEY: Record<FlowActor, keyof FlowDay> = {
  foreign: "foreignQty",
  institution: "institutionQty",
  individual: "individualQty",
};

/** days는 날짜 오름차순. 마지막 W일만 돌려준다. */
export function sliceWindow(days: FlowDay[], window: AvgWindow): FlowDay[] {
  return days.slice(-window);
}

export function supplyAvgPrice(days: FlowDay[], actor: FlowActor, window: AvgWindow): SupplyAvgPrice {
  const win = sliceWindow(days, window);
  let sumValue = 0;
  let sumQty = 0;
  for (const d of win) {
    sumValue += d[actor];
    sumQty += d[QTY_KEY[actor]] as number;
  }
  const base = { actor, window, sumValue, sumQty, tradingDays: win.length };
  const none = (reason: AvgPriceReason): SupplyAvgPrice => ({ ...base, avgPrice: null, side: null, returnPct: null, reason });

  if (sumQty === 0) return none("zero-qty");
  const avgPrice = Math.round((sumValue * 1_000_000) / sumQty);
  const close = win[win.length - 1].close;
  return {
    ...base,
    avgPrice,
    side: sumQty > 0 ? "buy" : "sell",
    returnPct: ((close - avgPrice) / avgPrice) * 100,
  };
}
```

- [ ] **Step 4: GREEN 확인**

Run: `npx vitest run src/lib/flow/avg-price.test.ts`
Expected: PASS 1.

- [ ] **Step 5: 실패하는 테스트 — 유효성 4개 + 창 슬라이싱**

같은 `describe` 안에 추가:

```ts
  it("ΣQ=0이면 null, reason zero-qty (백필 구간 개인처럼 매매 자체가 없는 창)", () => {
    const r = supplyAvgPrice(twentyDays({}), "individual", 20);
    expect(r).toMatchObject({ avgPrice: null, side: null, returnPct: null, reason: "zero-qty", sumQty: 0 });
  });

  it("ΣV와 ΣQ의 부호가 엇갈리면 null, reason sign-mismatch", () => {
    // 비싸게 사고(+금액 크게) 더 많이 싸게 팔아(−수량) 금액은 +인데 수량은 −인 창
    const days = twentyDays({}, { foreign: 1000, foreignQty: -500 });
    const r = supplyAvgPrice(days, "foreign", 20);
    expect(r).toMatchObject({ avgPrice: null, reason: "sign-mismatch", sumValue: 1000, sumQty: -500 });
  });

  it("ΣQ<0이고 ΣV<0이면 매도평단 side=sell — 009540 기관 383,475원, 종가는 그보다 9.64% 아래", () => {
    const days = twentyDays({ close: 346500 }, { institution: -77980, institutionQty: -203351 });
    const r = supplyAvgPrice(days, "institution", 20);
    expect(r.avgPrice).toBe(383475);
    expect(r.side).toBe("sell");
    expect(r.returnPct).toBeCloseTo(-9.64, 1);
  });

  it("창 안에 하루 종가 변동이 40% 이상이면 null, reason corp-action (액면분할 근사)", () => {
    const days = twentyDays({ close: 50000 }, { foreign: 100, foreignQty: 1000 });
    days[10] = { ...days[10], close: 50000 }; // 11일째부터 1/7 가격 — 분할로 본다
    for (let i = 11; i < 20; i++) days[i] = { ...days[i], close: 50000 };
    const r = supplyAvgPrice(days, "foreign", 20);
    expect(r).toMatchObject({ avgPrice: null, reason: "corp-action" });
  });

  it("창은 마지막 W일만 쓰고, 데이터가 W보다 짧으면 tradingDays가 실제 일수다", () => {
    const days = twentyDays({}, { foreign: 999, foreignQty: 1 });
    // 마지막 5일엔 첫날의 큰 값이 안 들어간다 → ΣQ=0
    expect(supplyAvgPrice(days, "foreign", 5)).toMatchObject({ reason: "zero-qty", tradingDays: 5 });
    expect(supplyAvgPrice(days.slice(0, 3), "foreign", 20).tradingDays).toBe(3);
  });
```

- [ ] **Step 6: RED 확인**

Run: `npx vitest run src/lib/flow/avg-price.test.ts`
Expected: sign-mismatch와 corp-action 2건 FAIL(현재 구현은 부호 불일치도 값을 내고, 급변을 안 본다). 나머지 PASS.

- [ ] **Step 7: 구현 보강**

`supplyAvgPrice` 안 `if (sumQty === 0) return none("zero-qty");` 다음에 추가:

```ts
  if (Math.sign(sumValue) !== Math.sign(sumQty)) return none("sign-mismatch");
  if (hasCorpAction(win)) return none("corp-action");
```

그리고 파일 상단(`sliceWindow` 아래)에:

```ts
/** 액면분할·감자 근사: 창 안에 전일 대비 ±40% 이상 종가 변동이 있으면 수량 단위가 달라졌다고 본다. */
export const CORP_ACTION_JUMP = 0.4;

export function hasCorpAction(win: FlowDay[]): boolean {
  for (let i = 1; i < win.length; i++) {
    const prev = win[i - 1].close;
    if (prev > 0 && Math.abs(win[i].close / prev - 1) >= CORP_ACTION_JUMP) return true;
  }
  return false;
}
```

- [ ] **Step 8: GREEN 확인**

Run: `npx vitest run src/lib/flow/avg-price.test.ts`
Expected: PASS 6.

- [ ] **Step 9: 커밋**

```bash
git add src/lib/flow/avg-price.ts src/lib/flow/avg-price.test.ts
git commit -m "feat(flow): supplyAvgPrice — ΣV/ΣQ 수급평단과 유효성 규칙(zero-qty/sign-mismatch/corp-action)"
```

---

### Task 2: `closeRange`·`pricePositionPct`·`buildAvgPriceView`

**Files:**
- Modify: `src/lib/flow/avg-price.ts`
- Test: `src/lib/flow/avg-price.test.ts`

**Interfaces:**
- Consumes: Task 1의 `supplyAvgPrice`, `sliceWindow`; `StockFlow` from `@/lib/flow/aggregate`
- Produces:
  ```ts
  export function closeRange(days: FlowDay[], window: AvgWindow): { low: number; high: number } | null;
  export function pricePositionPct(value: number, low: number, high: number): number; // 0~100, 밖이면 클램프
  export interface AvgPriceView {
    ticker: string; name: string; sector: string; window: AvgWindow;
    asOf: string | null; close: number | null; closeLow: number | null; closeHigh: number | null;
    tradingDays: number;
    actors: Record<FlowActor, SupplyAvgPrice>;
  }
  export function buildAvgPriceView(stock: StockFlow, window: AvgWindow): AvgPriceView;
  ```

- [ ] **Step 1: 실패하는 테스트**

`avg-price.test.ts` import를 `import { buildAvgPriceView, closeRange, pricePositionPct, supplyAvgPrice } from "./avg-price";`로 바꾸고 추가:

```ts
describe("closeRange / pricePositionPct", () => {
  it("창 안 종가의 최저·최고 — 빈 창이면 null", () => {
    const days = twentyDays({ close: 346500 });
    days[3] = { ...days[3], close: 329500 };
    days[7] = { ...days[7], close: 398000 };
    expect(closeRange(days, 20)).toEqual({ low: 329500, high: 398000 });
    expect(closeRange([], 20)).toBeNull();
  });

  it("값의 위치를 0~100으로, 범위 밖은 클램프, low=high면 50", () => {
    expect(pricePositionPct(329500, 329500, 398000)).toBe(0);
    expect(pricePositionPct(398000, 329500, 398000)).toBe(100);
    expect(pricePositionPct(363750, 329500, 398000)).toBe(50);
    expect(pricePositionPct(100, 329500, 398000)).toBe(0);
    expect(pricePositionPct(999999, 329500, 398000)).toBe(100);
    expect(pricePositionPct(5, 5, 5)).toBe(50);
  });
});

describe("buildAvgPriceView", () => {
  it("종목 메타 + 창 종가 범위 + 3주체 평단을 한 응답으로 묶는다", () => {
    const days = twentyDays({ close: 346500 }, { foreign: 50906, foreignQty: 127674, institution: -77980, institutionQty: -203351 });
    const view = buildAvgPriceView({ ticker: "009540", name: "HD한국조선해양", sector: "조선", days }, 20);
    expect(view).toMatchObject({
      ticker: "009540", name: "HD한국조선해양", sector: "조선", window: 20,
      asOf: "2026-08-30", close: 346500, closeLow: 346500, closeHigh: 346500, tradingDays: 20,
    });
    expect(view.actors.foreign.avgPrice).toBe(398719);
    expect(view.actors.institution.side).toBe("sell");
    expect(view.actors.individual.reason).toBe("zero-qty");
  });

  it("days가 비어 있으면 asOf·close·범위는 null이고 주체는 전부 zero-qty", () => {
    const view = buildAvgPriceView({ ticker: "x", name: "x", sector: "x", days: [] }, 20);
    expect(view).toMatchObject({ asOf: null, close: null, closeLow: null, closeHigh: null, tradingDays: 0 });
    expect(view.actors.foreign.reason).toBe("zero-qty");
  });
});
```

(`twentyDays`가 만드는 날짜는 `2026-08-11`…`2026-08-30` — 마지막이 30일이다. 실제 달력과 달라도 무방하다.)

- [ ] **Step 2: RED 확인**

Run: `npx vitest run src/lib/flow/avg-price.test.ts`
Expected: FAIL — `closeRange`/`pricePositionPct`/`buildAvgPriceView` is not a function 계열.

- [ ] **Step 3: 구현**

`avg-price.ts` 끝에 추가 (상단 import를 `import type { FlowDay, StockFlow } from "./aggregate";`로):

```ts
/** 창 안 종가의 최저·최고. 진짜 고저가가 아니라 종가 범위다 — UI 캡션에 명시할 것. */
export function closeRange(days: FlowDay[], window: AvgWindow): { low: number; high: number } | null {
  const win = sliceWindow(days, window);
  if (win.length === 0) return null;
  let low = Infinity;
  let high = -Infinity;
  for (const d of win) {
    if (d.close < low) low = d.close;
    if (d.close > high) high = d.close;
  }
  return { low, high };
}

/** 위치 바용. value가 [low, high] 어디쯤인지 0~100. 밖이면 끝에 붙이고, 범위가 0이면 가운데. */
export function pricePositionPct(value: number, low: number, high: number): number {
  if (high <= low) return 50;
  const pct = ((value - low) / (high - low)) * 100;
  return Math.max(0, Math.min(100, pct));
}

export const FLOW_ACTORS: FlowActor[] = ["foreign", "institution", "individual"];

/** /api/flow 응답. 라우트는 파일만 읽고 이 함수 결과를 그대로 돌려준다. */
export interface AvgPriceView {
  ticker: string;
  name: string;
  sector: string;
  window: AvgWindow;
  /** 창 마지막 날짜. 데이터 없으면 null */
  asOf: string | null;
  close: number | null;
  closeLow: number | null;
  closeHigh: number | null;
  tradingDays: number;
  actors: Record<FlowActor, SupplyAvgPrice>;
}

export function buildAvgPriceView(stock: StockFlow, window: AvgWindow): AvgPriceView {
  const win = sliceWindow(stock.days, window);
  const last = win[win.length - 1];
  const range = closeRange(stock.days, window);
  const actors = Object.fromEntries(
    FLOW_ACTORS.map((a) => [a, supplyAvgPrice(stock.days, a, window)]),
  ) as Record<FlowActor, SupplyAvgPrice>;
  return {
    ticker: stock.ticker,
    name: stock.name,
    sector: stock.sector,
    window,
    asOf: last?.date ?? null,
    close: last?.close ?? null,
    closeLow: range?.low ?? null,
    closeHigh: range?.high ?? null,
    tradingDays: win.length,
    actors,
  };
}
```

- [ ] **Step 4: GREEN 확인**

Run: `npx vitest run src/lib/flow/avg-price.test.ts`
Expected: PASS 10.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/flow/avg-price.ts src/lib/flow/avg-price.test.ts
git commit -m "feat(flow): closeRange·pricePositionPct·buildAvgPriceView — /api/flow 응답 조립"
```

---

### Task 3: `avgPriceHeadline` — 결론 문장

**Files:**
- Create: `src/lib/flow/avg-price-headline.ts`
- Test: `src/lib/flow/avg-price-headline.test.ts`

**Interfaces:**
- Consumes: `SupplyAvgPrice`, `FlowActor` from `./avg-price`
- Produces:
  ```ts
  export const ACTOR_LABEL: Record<FlowActor, string>; // 외국인/기관/개인
  export const REASON_LABEL: Record<AvgPriceReason, string>;
  export function actorSentence(a: SupplyAvgPrice, myAvgPrice: number): string;
  export function avgPriceHeadline(view: { actors: Pick<Record<FlowActor, SupplyAvgPrice>, "foreign" | "institution"> }, myAvgPrice: number): string;
  ```

- [ ] **Step 1: 실패하는 테스트**

`src/lib/flow/avg-price-headline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SupplyAvgPrice } from "./avg-price";
import { actorSentence, avgPriceHeadline } from "./avg-price-headline";

const base = (over: Partial<SupplyAvgPrice>): SupplyAvgPrice => ({
  actor: "foreign", window: 20, avgPrice: null, side: null, returnPct: null,
  sumValue: 0, sumQty: 0, tradingDays: 20, ...over,
});

describe("actorSentence", () => {
  it("매수평단이 내 평단보다 높고 지금 손실이면 '비싸게 샀고 물려 있음'", () => {
    const a = base({ avgPrice: 398719, side: "buy", returnPct: -13.1 });
    expect(actorSentence(a, 346500)).toBe("외국인은 나보다 15.1% 비싸게 샀고 지금 −13.1% 물려 있음");
  });

  it("매수평단이 내 평단보다 낮고 지금 이익이면 '싸게 샀고 이익 중'", () => {
    const a = base({ avgPrice: 132937, side: "buy", returnPct: 15.2 });
    expect(actorSentence(a, 137000)).toBe("외국인은 나보다 3.0% 싸게 샀고 지금 +15.2% 이익 중");
  });

  it("내 평단과 0.5% 안이면 '나와 비슷한 값에'", () => {
    const a = base({ avgPrice: 100200, side: "buy", returnPct: 0 });
    expect(actorSentence(a, 100000)).toBe("외국인은 나와 비슷한 값에 샀고 지금 평단과 같음");
  });

  it("매도평단은 '평균 N원에 팔았고 종가는 그보다 X% 아래/위'", () => {
    const a = base({ actor: "institution", avgPrice: 383475, side: "sell", returnPct: -9.64 });
    expect(actorSentence(a, 300000)).toBe("기관은 평균 383,475원에 팔았고 종가는 그보다 9.6% 아래");
    const b = base({ actor: "institution", avgPrice: 100000, side: "sell", returnPct: 4 });
    expect(actorSentence(b, 300000)).toBe("기관은 평균 100,000원에 팔았고 종가는 그보다 4.0% 위");
  });

  it("평단이 없으면 이유를 말한다", () => {
    expect(actorSentence(base({ reason: "zero-qty" }), 1)).toBe("외국인은 20일 매매 없음");
    expect(actorSentence(base({ actor: "institution", reason: "sign-mismatch" }), 1)).toBe("기관은 20일 매매가 엇갈려 평단 없음");
    expect(actorSentence(base({ reason: "corp-action" }), 1)).toBe("외국인은 창 안 주가 급변으로 평단 없음");
  });
});

describe("avgPriceHeadline", () => {
  it("외국인 문장 · 기관 문장 순으로 잇는다", () => {
    const foreign = base({ avgPrice: 398719, side: "buy", returnPct: -13.1 });
    const institution = base({ actor: "institution", avgPrice: 383475, side: "sell", returnPct: -9.64 });
    expect(avgPriceHeadline({ actors: { foreign, institution } }, 346500)).toBe(
      "외국인은 나보다 15.1% 비싸게 샀고 지금 −13.1% 물려 있음 · 기관은 평균 383,475원에 팔았고 종가는 그보다 9.6% 아래",
    );
  });

  it("둘 다 없으면 한 문장으로 합친다", () => {
    const foreign = base({ reason: "sign-mismatch" });
    const institution = base({ actor: "institution", reason: "sign-mismatch" });
    expect(avgPriceHeadline({ actors: { foreign, institution } }, 1)).toBe("외국인·기관 모두 20일 평단 없음 (매매가 엇갈림)");
  });
});
```

- [ ] **Step 2: RED 확인**

Run: `npx vitest run src/lib/flow/avg-price-headline.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`src/lib/flow/avg-price-headline.ts`:

```ts
// 수급평단 결론 문장. 새 지표 화면은 표보다 계산된 결론 한 줄이 먼저다(내 산업 vs 큰손
// 카드에서 배운 것). 문구는 여기 한 곳에만 두고 컴포넌트는 그리기만 한다.
import type { AvgPriceReason, FlowActor, SupplyAvgPrice } from "./avg-price";

export const ACTOR_LABEL: Record<FlowActor, string> = { foreign: "외국인", institution: "기관", individual: "개인" };

export const REASON_LABEL: Record<AvgPriceReason, string> = {
  "zero-qty": "매매 없음",
  "sign-mismatch": "매매가 엇갈림",
  "corp-action": "주가 급변",
};

/** 내 평단과 "같다"고 볼 폭. 이 안이면 비싸게/싸게 대신 "비슷한 값에". */
const SIMILAR_PCT = 0.5;

/** 부호 있는 소수 1자리. fmtPct(2자리)보다 짧게 — 문장 안에 들어가므로. */
function pct1(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(1)}%`;
}

function abs1(v: number): string {
  return `${Math.abs(v).toFixed(1)}%`;
}

export function actorSentence(a: SupplyAvgPrice, myAvgPrice: number): string {
  const who = ACTOR_LABEL[a.actor];
  if (a.avgPrice === null || a.returnPct === null || a.side === null) {
    switch (a.reason) {
      case "zero-qty":
        return `${who}은 ${a.window}일 매매 없음`;
      case "corp-action":
        return `${who}은 창 안 주가 급변으로 평단 없음`;
      default:
        return `${who}은 ${a.window}일 매매가 엇갈려 평단 없음`;
    }
  }
  if (a.side === "sell") {
    const dir = a.returnPct < 0 ? "아래" : "위";
    return `${who}은 평균 ${a.avgPrice.toLocaleString("ko-KR")}원에 팔았고 종가는 그보다 ${abs1(a.returnPct)} ${dir}`;
  }
  const diffPct = myAvgPrice > 0 ? ((a.avgPrice - myAvgPrice) / myAvgPrice) * 100 : 0;
  const bought =
    Math.abs(diffPct) < SIMILAR_PCT
      ? "나와 비슷한 값에 샀고"
      : diffPct > 0
        ? `나보다 ${abs1(diffPct)} 비싸게 샀고`
        : `나보다 ${abs1(diffPct)} 싸게 샀고`;
  const now = a.returnPct > 0 ? `지금 ${pct1(a.returnPct)} 이익 중` : a.returnPct < 0 ? `지금 ${pct1(a.returnPct)} 물려 있음` : "지금 평단과 같음";
  return `${who}은 ${bought} ${now}`;
}

export function avgPriceHeadline(
  view: { actors: Pick<Record<FlowActor, SupplyAvgPrice>, "foreign" | "institution"> },
  myAvgPrice: number,
): string {
  const { foreign, institution } = view.actors;
  if (foreign.avgPrice === null && institution.avgPrice === null) {
    const reasons = [...new Set([foreign.reason, institution.reason].filter((r): r is AvgPriceReason => !!r))]
      .map((r) => REASON_LABEL[r])
      .join("·");
    return `외국인·기관 모두 ${foreign.window}일 평단 없음 (${reasons})`;
  }
  return `${actorSentence(foreign, myAvgPrice)} · ${actorSentence(institution, myAvgPrice)}`;
}
```

- [ ] **Step 4: GREEN 확인**

Run: `npx vitest run src/lib/flow/avg-price-headline.test.ts`
Expected: PASS 7.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/flow/avg-price-headline.ts src/lib/flow/avg-price-headline.test.ts
git commit -m "feat(flow): avgPriceHeadline — 내 평단 vs 외국인·기관 평단 결론 문장"
```

---

### Task 4: `GET /api/flow?ticker=&window=`

**Files:**
- Create: `src/app/api/flow/route.ts`
- Test: `src/app/api/flow/route.test.ts`
- Modify: spec `docs/superpowers/specs/2026-09-10-supply-avg-price-review.md` §3.2 첫 줄

**Interfaces:**
- Consumes: `buildAvgPriceView`, `AVG_WINDOWS`, `AvgWindow` from `@/lib/flow/avg-price`; `StockFlow`
- Produces: `GET` — 200 `AvgPriceView` / 400 `{ error }` / 404 `{ error, hint }`

- [ ] **Step 1: 실패하는 테스트**

`src/app/api/flow/route.test.ts`:

```ts
// node:fs를 메모리 맵으로 대체해 라우트의 배선(파라미터 검증, 파일 찾기, 없으면 404 + hint)만
// 검증한다. 평단 계산은 src/lib/flow/avg-price.test.ts가 이미 검증한다.
import { afterEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();

vi.mock("node:fs", () => ({
  existsSync: (p: string) => files.has(p),
  readFileSync: (p: string) => {
    const v = files.get(p);
    if (v === undefined) throw new Error(`ENOENT: ${p}`);
    return v;
  },
}));

import { GET } from "./route";

const req = (qs: string) => new Request(`http://localhost/api/flow${qs}`);

afterEach(() => files.clear());

describe("GET /api/flow", () => {
  it("ticker가 6자리 숫자가 아니면 400", async () => {
    expect((await GET(req(""))).status).toBe(400);
    expect((await GET(req("?ticker=../x"))).status).toBe(400);
  });

  it("window가 5·20·60이 아니면 400", async () => {
    files.set("data/flow/009540.json", JSON.stringify({ ticker: "009540", name: "HD한국조선해양", sector: "조선", days: [] }));
    expect((await GET(req("?ticker=009540&window=7"))).status).toBe(400);
  });

  it("파일이 없으면 404와 flow:fetch 안내", async () => {
    const res = await GET(req("?ticker=009540"));
    expect(res.status).toBe(404);
    expect((await res.json()).hint).toContain("flow:fetch");
  });

  it("파일이 있으면 buildAvgPriceView 결과를 돌려주고 window 기본은 20", async () => {
    const days = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-08-${String(11 + i).padStart(2, "0")}`, close: 346500,
      foreign: i === 0 ? 50906 : 0, institution: 0, individual: 0,
      foreignQty: i === 0 ? 127674 : 0, institutionQty: 0, individualQty: 0,
    }));
    files.set("data/flow/009540.json", JSON.stringify({ ticker: "009540", name: "HD한국조선해양", sector: "조선", days }));
    const res = await GET(req("?ticker=009540"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.window).toBe(20);
    expect(body.actors.foreign.avgPrice).toBe(398719);
    expect(body.close).toBe(346500);
  });

  it("손상된 파일은 500이 아니라 404로 다룬다", async () => {
    files.set("data/flow/009540.json", "{not json");
    expect((await GET(req("?ticker=009540"))).status).toBe(404);
  });
});
```

- [ ] **Step 2: RED 확인**

Run: `npx vitest run src/app/api/flow/route.test.ts`
Expected: FAIL — `./route` 모듈 없음.

- [ ] **Step 3: 구현**

`src/app/api/flow/route.ts`:

```ts
// 종목 하나의 수급평단. /api/observatory에 얹지 않는 이유: 관측소 응답은 이미 크고(12섹터×3창),
// 평단은 종목을 골라야 나오는 상세 데이터라 data/flow/<ticker>.json 하나만 읽으면 된다.
// 계산은 전부 src/lib/flow/avg-price.ts — 여기는 파라미터 검증과 파일 찾기만.
import { existsSync, readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import type { StockFlow } from "@/lib/flow/aggregate";
import { AVG_WINDOWS, buildAvgPriceView, type AvgWindow } from "@/lib/flow/avg-price";

export const runtime = "nodejs";
// data/flow는 매일 갱신된다(flow:fetch). 매 요청마다 파일을 다시 읽도록 강제한다.
export const dynamic = "force-dynamic";

const FLOW_DIR = "data/flow";
// 6자리 숫자만 — 경로 조작(../)을 여기서 막는다.
const TICKER_RE = /^\d{6}$/;

function loadFlow(ticker: string): StockFlow | undefined {
  const path = `${FLOW_DIR}/${ticker}.json`;
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed?.ticker && Array.isArray(parsed?.days)) return parsed as StockFlow;
  } catch {
    // 손상된 파일 — "없음"과 같게 다룬다. 크래시보다 404가 낫다.
  }
  return undefined;
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const ticker = url.searchParams.get("ticker") ?? "";
  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: "ticker는 6자리 숫자여야 합니다" }, { status: 400 });
  }
  const windowRaw = url.searchParams.get("window");
  const window = windowRaw === null ? 20 : Number(windowRaw);
  if (!(AVG_WINDOWS as readonly number[]).includes(window)) {
    return NextResponse.json({ error: `window는 ${AVG_WINDOWS.join("·")} 중 하나여야 합니다` }, { status: 400 });
  }
  const stock = loadFlow(ticker);
  if (!stock) {
    return NextResponse.json(
      { error: `data/flow/${ticker}.json 없음`, hint: "npm run flow:fetch 로 수급 데이터를 먼저 적재하세요" },
      { status: 404 },
    );
  }
  return NextResponse.json(buildAvgPriceView(stock, window as AvgWindow));
}
```

- [ ] **Step 4: GREEN 확인**

Run: `npx vitest run src/app/api/flow/route.test.ts`
Expected: PASS 5.

- [ ] **Step 5: spec §3.2 경로 확인**

spec §3.2는 이미 `GET /api/flow?ticker=009540&window=20`로 정정돼 있다(계획서 작성 시 반영). 라우트 응답 필드가 spec의 `AvgPriceView` 설명과 같은지 눈으로 대조만 한다.

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/flow/route.ts src/app/api/flow/route.test.ts
git commit -m "feat(api): GET /api/flow?ticker=&window= — 종목 수급평단 응답"
```

---

### Task 5: `SupplyAvgPrice` 컴포넌트 + `/portfolio` 배선

**Files:**
- Create: `src/components/SupplyAvgPrice.tsx`
- Modify: `src/app/portfolio/page.tsx` — `HoldingsTable`의 `g.holdings.map` (현재 307행 부근)

**Interfaces:**
- Consumes: `AvgPriceView`, `SupplyAvgPrice`, `pricePositionPct` from `@/lib/flow/avg-price`; `avgPriceHeadline`, `ACTOR_LABEL`, `REASON_LABEL` from `@/lib/flow/avg-price-headline`; `fmtEok`, `fmtMoney`, `fmtPct`, `pnlClass` from `@/lib/format`; `universeSector` from `@/lib/portfolio/sector`
- Produces: `<SupplyAvgPrice ticker myAvgPrice current />`

컴포넌트 단위 테스트는 없다(vitest가 `*.test.ts` node 환경만 돈다 — 저장소 관례). 대신 Step 4의 로컬 확인이 검증이다.

- [ ] **Step 1: 컴포넌트 작성**

`src/components/SupplyAvgPrice.tsx`:

```tsx
"use client";

// 보유종목 한 줄 아래 붙는 "내 평단 vs 외국인·기관 평단". 결론 한 줄이 항상 보이고,
// 펼치면 주체별 3카드(추정평단·현재 수익률·순매수액)와 평단 위치 바가 나온다.
// 판단·문구는 avg-price-headline.ts의 순수 함수가 하고 여기서는 그리기만 한다.
// 개인은 백필 구간이 0이라 1단계에서 보이지 않는다(spec §2 함정 2).
import { useEffect, useState } from "react";
import { pricePositionPct, type AvgPriceView, type SupplyAvgPrice as ActorAvg } from "@/lib/flow/avg-price";
import { ACTOR_LABEL, REASON_LABEL, avgPriceHeadline } from "@/lib/flow/avg-price-headline";
import { fmtEok, fmtMoney, fmtPct, pnlClass } from "@/lib/format";

const WINDOW = 20;

export function SupplyAvgPrice({ ticker, myAvgPrice, current }: { ticker: string; myAvgPrice: number; current: number }) {
  const [view, setView] = useState<AvgPriceView | null | undefined>(undefined);
  useEffect(() => {
    fetch(`/api/flow?ticker=${ticker}&window=${WINDOW}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("조회 실패"))))
      .then((body: AvgPriceView) => setView(body))
      .catch(() => setView(null));
  }, [ticker]);

  // 아직 로딩이거나 파일이 없으면 줄 자체를 그리지 않는다 — 빈 경고로 표를 어지럽히지 않기 위해.
  if (!view) return null;

  const { foreign, institution } = view.actors;
  const short = view.tradingDays < view.window ? ` (${view.tradingDays}일치)` : "";

  return (
    <div className="text-xs">
      <p className="text-ink">
        <span className="mr-1 text-muted">큰손 평단{short}</span>
        {avgPriceHeadline(view, myAvgPrice)}
      </p>
      <details className="mt-1">
        <summary className="cursor-pointer text-muted hover:text-ink">자세히 (최근 {view.window}거래일)</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <ActorCard a={foreign} />
          <ActorCard a={institution} />
        </div>
        {view.closeLow !== null && view.closeHigh !== null && (
          <PositionBar
            low={view.closeLow}
            high={view.closeHigh}
            points={[
              { label: "나", value: myAvgPrice, cls: "bg-accent" },
              { label: "외국인", value: foreign.avgPrice, cls: "bg-gain" },
              { label: "기관", value: institution.avgPrice, cls: "bg-loss" },
              { label: "현재가", value: current, cls: "bg-ink" },
            ]}
          />
        )}
        <p className="mt-2 leading-relaxed text-muted">
          평단 = Σ순매수금액 ÷ Σ순매수수량. 평단은 그 주체의 손익 상태를 기술할 뿐, 다음 수익률을 예측하지
          않는다. 기관에는 연기금·투신·보험이 섞여 있다. 막대는 창 안 종가 범위(고저가 아님).
        </p>
      </details>
    </div>
  );
}

function ActorCard({ a }: { a: ActorAvg }) {
  const label = ACTOR_LABEL[a.actor];
  if (a.avgPrice === null || a.returnPct === null) {
    return (
      <div className="rounded-lg border border-line bg-bg/40 p-2">
        <div className="font-medium text-ink">{label}</div>
        <div className="text-muted">평단 없음 — {a.reason ? REASON_LABEL[a.reason] : "데이터 없음"}</div>
        <div className="tabular text-muted">순매수 {fmtEok(a.sumValue)}</div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-line bg-bg/40 p-2">
      <div className="flex items-center gap-1 font-medium text-ink">
        {label}
        {a.side === "sell" && (
          <span className="rounded border border-line px-1 text-[10px] text-muted">매도평단</span>
        )}
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1">
        <Cell k="추정평단" v={fmtMoney(a.avgPrice, "KRW")} />
        <Cell k="현재 수익률" v={fmtPct(a.returnPct)} cls={pnlClass(a.returnPct)} />
        <Cell k="순매수액" v={fmtEok(a.sumValue)} cls={pnlClass(a.sumValue)} />
      </div>
    </div>
  );
}

function Cell({ k, v, cls = "text-ink" }: { k: string; v: string; cls?: string }) {
  return (
    <div>
      <div className="text-[10px] text-muted">{k}</div>
      <div className={`tabular ${cls}`}>{v}</div>
    </div>
  );
}

function PositionBar({
  low, high, points,
}: {
  low: number;
  high: number;
  points: { label: string; value: number | null; cls: string }[];
}) {
  const shown = points.filter((p): p is { label: string; value: number; cls: string } => p.value !== null);
  return (
    <div className="mt-3">
      <div className="relative h-1.5 rounded bg-line">
        {shown.map((p) => (
          <span
            key={p.label}
            title={`${p.label} ${fmtMoney(p.value, "KRW")}`}
            className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-surface ${p.cls}`}
            style={{ left: `${pricePositionPct(p.value, low, high)}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span className="tabular">{fmtMoney(low, "KRW")}</span>
        <span>
          {shown.map((p) => (
            <span key={p.label} className="ml-2 inline-flex items-center gap-1">
              <span className={`inline-block h-2 w-2 rounded-full ${p.cls}`} />
              {p.label}
            </span>
          ))}
        </span>
        <span className="tabular">{fmtMoney(high, "KRW")}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `/portfolio`에 배선**

`src/app/portfolio/page.tsx`:

(a) import 추가:
```ts
import { SupplyAvgPrice } from "@/components/SupplyAvgPrice";
```

(b) `HoldingsTable` 안 `g.holdings.map((h) => ( <HoldingRow … /> ))` 를 다음으로 교체:

```tsx
                {g.holdings.map((h) => (
                  <Fragment key={h.id}>
                    <HoldingRow
                      h={h}
                      current={priceOf(h)}
                      onOpenChart={onOpenChart}
                      onSetSector={onSetSector}
                      onRemove={onRemove}
                    />
                    {/* 수급 유니버스 안 KR 종목만 — 밖이면 데이터가 없어 줄을 만들지 않는다. */}
                    {universeSector(h.market, h.ticker) && (
                      <tr className="border-b border-line/60 last:border-0">
                        <td className="whitespace-normal px-4 pb-3 pt-0 pl-12" colSpan={9}>
                          <SupplyAvgPrice ticker={h.ticker} myAvgPrice={h.avgPrice} current={priceOf(h)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
```

(`HoldingRow`의 `key={h.id}`는 `Fragment`로 옮긴다. `universeSector`는 이미 import돼 있다 — 없으면 `@/lib/portfolio/sector`에서 추가.)

- [ ] **Step 3: 타입·린트·전체 테스트**

Run: `cd ~/Desktop/AI/stock && npx tsc --noEmit && npm run lint && npm test`
Expected: 오류 0, 테스트 전부 PASS (기존 518 + 새 22 = 540 부근).

- [ ] **Step 4: 로컬 확인 (사용자)**

전제: Colima·`stock-pg`·`npm run dev`(:3000)가 떠 있다. `next build`는 돌리지 않는다.

1. http://localhost:3000/portfolio 새로고침.
2. 조선(009540) 보유행 아래에 `큰손 평단 외국인은 나보다 …% 비싸게/싸게 샀고 지금 … · 기관은 평균 …원에 팔았고 …` 한 줄이 보이는지.
3. "자세히" 펼쳐 카드 2개(외국인·기관)에 추정평단·현재 수익률·순매수액, 기관에 `매도평단` 배지, 위치 바에 점 4개(나·외국인·기관·현재가)와 양끝 종가 최저·최고.
4. 유니버스 밖 종목(보령·리가켐바이오 등)엔 줄이 **없는지**.
5. 행 클릭 시 차트 모달이 여전히 열리고, "자세히" 클릭은 차트를 열지 **않는지**.
6. 터미널: `curl -s 'http://localhost:3000/api/flow?ticker=009540' | head -c 400` 에 `"avgPrice":398719` 근처 값(데이터 날짜에 따라 다를 수 있음).

사용자 "됐어"를 받기 전엔 Step 5로 가지 않는다.

- [ ] **Step 5: 커밋**

```bash
git add src/components/SupplyAvgPrice.tsx src/app/portfolio/page.tsx
git commit -m "feat(portfolio): 보유행 아래 큰손 평단 — 결론 한 줄 + 주체별 3카드 + 평단 위치 바"
```

---

### Task 6: main 병합·배포·문서

**Files:**
- Modify: `~/Desktop/AI/Coolify/RUNBOOK.md` (stock 앱 M12 절, "내 산업 vs 큰손 카드" 불릿 다음)
- Modify: spec §4 표 1단계 셀에 커밋 해시

- [ ] **Step 1: 병합·푸시 (사용자 OK 후)**

```bash
cd ~/Desktop/AI/stock && git switch main && git merge --no-ff feat/supply-avg-price-1 -m "Merge feat/supply-avg-price-1: 큰손 평단 1단계" && git push origin main
```

- [ ] **Step 2: 배포 확인**

```bash
ssh -i ~/.ssh/oci_coolify ubuntu@129.225.167.219 '~/.local/bin/capi GET "/deployments/applications/zwdzpbgnxgvhzijsvbi81tn9?take=1"' | python3 -c 'import json,sys; d=json.load(sys.stdin)["deployments"][0]; print(d["status"], d["commit"][:7], d["created_at"])'
```
Expected: `finished <merge hash>`. 3분 안에 안 끝나면 다시 조회.
그다음 (Basic Auth는 사용자가 브라우저에서) https://stock.129.225.167.219.sslip.io/portfolio 에서 Task 5 Step 4의 2~4번 확인.

- [ ] **Step 3: RUNBOOK 한 줄**

"내 산업 vs 큰손 카드" 불릿 바로 다음에:
```
- **큰손 평단 1단계 (2026-09-11, stock main <hash>)**: `/portfolio` 유니버스 안 보유행 아래 "외국인은 나보다 N% 비싸게 샀고 지금 −M% 물려 있음 · 기관은 평균 …원에 팔았고 …" 결론 한 줄 + 접힌 3카드 + 평단 위치 바. 계산 `src/lib/flow/avg-price.ts`(ΣV×1e6/ΣQ), API `GET /api/flow?ticker=&window=`(data/flow 파일만 읽음, DB·적재 변경 없음). 2단계(외국인 수익/손실 종목 목록 + 관측소 ③) 미착수 — 계획서 §4.
```

- [ ] **Step 4: 커밋 (Coolify 저장소는 git 아님 — 파일 저장만)**

spec §4 표의 `**1** ✅ 승인 2026-09-11` 셀 뒤에 ` (main <hash>)`를 붙이고 stock 저장소에서:
```bash
git add docs/superpowers/specs/2026-09-10-supply-avg-price-review.md && git commit -m "docs: 수급평단 1단계 배포 기록" && git push origin main
```

---

## Self-review

- **Spec coverage**: §1.1 수식·유효성 4규칙 → Task 1 (노이즈 규칙은 거래량 부재로 제외, Global Constraints에 명시). §2 함정 1(단위) → Task 1 첫 테스트; 함정 2(개인 0) → UI 비표시; 함정 3(짧은 창) → `(N일치)`; 함정 4(기관⊃연기금) → 캡션. §3.1 → Task 1·2 (`supplyAvgSeries`는 spec §4가 2단계로 둠). §3.2 → Task 4 (경로 정정 포함). §3.3(a) 1·2·3 → Task 3·5. §4 1단계 산출물 → Task 5·6.
- **Placeholder scan**: 없음. 모든 코드 블록 완성.
- **Type consistency**: `SupplyAvgPrice.reason?: AvgPriceReason`(Task 1) ↔ `REASON_LABEL: Record<AvgPriceReason,…>`(Task 3) ↔ 컴포넌트 `a.reason ? REASON_LABEL[a.reason]`(Task 5). `AvgPriceView.actors: Record<FlowActor, SupplyAvgPrice>`(Task 2) ↔ `avgPriceHeadline(view: { actors: Pick<…,"foreign"|"institution"> })`(Task 3) — `AvgPriceView`는 구조적으로 만족. 컴포넌트에서 타입 이름 충돌(`SupplyAvgPrice` 함수 vs 타입)은 `type SupplyAvgPrice as ActorAvg`로 회피.
