# 미국장 전이 검증 (1단계) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 코스피·코스닥과 미국 3대지수 25년치 일봉을 받아, "전날 미국장 상승이 다음날 한국장 장중 수익으로 이어지는가"를 비용까지 반영해 대조군과 비교 측정한다.

**Architecture:** 순수 계산 로직은 `src/lib/backtest/`에 두어 vitest로 검증하고, 데이터 적재와 실행은 `scripts/`의 얇은 `.mjs`가 맡는다. 적재는 한 번(파일 저장), 백테스트는 파일만 읽어 수백 번 반복한다. 기존 저장소 규약(`lib`은 테스트, `scripts`는 실행, 한국어 주석)을 따른다.

**Tech Stack:** TypeScript, vitest, Node 24 ESM(`.mjs`), KIS Developers REST API

**Spec:** `docs/superpowers/specs/2026-09-06-us-kr-transfer-design.md`

## Global Constraints

- **비용**: 왕복 기본 `0.004`(0.4%). 모든 가상 매매 수익에 적용한다.
- **연휴 기본 모드**: `skip`. `sum`·`last`도 계산 가능해야 한다.
- **KIS 호출**: 매 응답의 `rt_cd !== "0"`을 반드시 검사한다. 검사하지 않으면 오류가 빈 배열로 위장된다. 호출 간격 1.5초, 실패 시 3회 재시도.
- **KIS 토큰**: 발급 자체에 분당 제한이 있다. `data/.kis-token.json`에 캐시하고 만료 2분 전까지 재사용한다.
- **적재 범위**: 25년 전체를 받는다. 기간을 자르는 것은 분석 단계에서만 한다.
- **대조군**: 조건부 성과는 항상 무작위 날 매수와 비교해 낸다. 대조군 없는 승률은 출력하지 않는다.
- **출력 지표**: 승률·평균과 함께 **손익비·MDD·신호 발생 횟수**를 반드시 같이 낸다.
- **언어**: 주석·테스트 설명·CLI 출력은 한국어. 저장소 기존 파일과 동일하게 맞춘다.
- **테스트 실행**: `npm test` (vitest, `src/**/*.test.ts`만 수집).
- **커밋 메시지 꼬리말**: 모든 커밋 본문 끝에 아래 두 줄을 붙인다.
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013P2fJR2eNjh72WPmca87FV
  ```

---

### Task 1: 브랜치 생성 + Candle에 거래량 추가

`Candle`은 현재 `{date, open, high, low, close}`뿐이다. 백테스트 모듈이 이 타입으로 적재 데이터를 다루고, 3단계 지표(MFI)와 L1(거래대금)이 이 필드를 쓴다. optional이라 기존 코드는 영향받지 않는다.

**Files:**
- Modify: `src/lib/types.ts:66-72` (`Candle` 인터페이스)
- Modify: `src/lib/server/kis.ts` (`toCandles` 및 4개 호출부)
- Test: `src/lib/server/kis-candles.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: 없음
- Produces: `Candle { date: string; open: number; high: number; low: number; close: number; volume?: number; value?: number }` — 이후 모든 태스크가 이 타입을 쓴다.

- [ ] **Step 1: 작업 브랜치를 만든다**

현재 `main`이므로 먼저 분기한다.

```bash
git checkout -b feat/us-kr-transfer
git status -sb
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`src/lib/server/kis-candles.test.ts` 파일 끝에 추가한다. 기존 테스트가 쓰는 mock 방식을 그대로 따른다 — 파일 상단의 기존 import와 헬퍼를 먼저 읽고 맞출 것.

```ts
describe("거래량·거래대금 매핑", () => {
  it("국내지수 응답의 acml_vol·acml_tr_pbmn을 volume·value로 옮긴다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          rt_cd: "0",
          output2: [
            {
              stck_bsop_date: "20260904",
              bstp_nmix_oprc: "6654.36",
              bstp_nmix_hgpr: "6746.14",
              bstp_nmix_lwpr: "6632.77",
              bstp_nmix_prpr: "6687.21",
              acml_vol: "238152",
              acml_tr_pbmn: "17723650",
            },
          ],
        }),
      })
    );

    const out = await getKisIndexCandles("0001", "D", CREDS, "20260904");

    expect(out[0].volume).toBe(238152);
    expect(out[0].value).toBe(17723650);
  });

  it("거래대금이 없는 해외지수 응답에서는 value가 undefined다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          rt_cd: "0",
          output2: [
            {
              stck_bsop_date: "20260904",
              ovrs_nmix_oprc: "26587.90",
              ovrs_nmix_hgpr: "26628.58",
              ovrs_nmix_lwpr: "26444.84",
              ovrs_nmix_prpr: "26506.99",
              acml_vol: "6701009200",
            },
          ],
        }),
      })
    );

    const out = await getKisOverseasIndexCandles("COMP", "D", CREDS, "20260904");

    expect(out[0].volume).toBe(6701009200);
    expect(out[0].value).toBeUndefined();
  });
});
```

`CREDS`가 기존 파일에 없으면 `const CREDS = { appKey: "k", appSecret: "s" };`를 파일 상단에 추가한다.

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

Run: `npm test -- kis-candles`
Expected: FAIL — `volume`이 `undefined`라 `toBe(238152)`에서 깨진다.

- [ ] **Step 4: 타입에 필드를 추가한다**

`src/lib/types.ts`의 `Candle`을 고친다.

```ts
/** 기간별 시세 캔들. 날짜 오름차순으로 다룬다. */
export interface Candle {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number; // 거래량 — 소스가 주지 않으면 undefined
  value?: number; // 거래대금 — 국내만 제공
}
```

- [ ] **Step 5: 파서가 필드를 채우게 한다**

`src/lib/server/kis.ts`의 `toCandles`를 고친다. 필드명 매핑에 `volume`/`value`를 optional로 받는다.

```ts
/** output2(최신순) → 오름차순 Candle[]. 필드명은 API마다 달라 매핑을 받는다. */
function toCandles(
  rows: ChartRow[],
  f: {
    date: string;
    open: string;
    high: string;
    low: string;
    close: string;
    volume?: string;
    value?: string;
  }
): Candle[] {
  const num = (v: string | undefined) =>
    v === undefined || v === "" ? undefined : Number(v);
  return rows
    .filter((r) => r[f.date])
    .map((r) => ({
      date: isoDate(r[f.date]),
      open: Number(r[f.open]),
      high: Number(r[f.high]),
      low: Number(r[f.low]),
      close: Number(r[f.close]),
      volume: f.volume ? num(r[f.volume]) : undefined,
      value: f.value ? num(r[f.value]) : undefined,
    }))
    .reverse();
}
```

그다음 4개 호출부의 매핑 객체에 필드를 더한다.

- `getKisStockCandles`: `volume: "acml_vol", value: "acml_tr_pbmn"` 추가
- `getKisIndexCandles`: `volume: "acml_vol", value: "acml_tr_pbmn"` 추가
- `getKisOverseasStockCandles`: `volume: "acml_vol"` 추가 (거래대금 없음)
- `getKisOverseasIndexCandles`: `volume: "acml_vol"` 추가 (거래대금 없음)

- [ ] **Step 6: 테스트가 통과하는지 확인한다**

Run: `npm test`
Expected: PASS — 새 테스트 2개 포함 전체 통과. 기존 테스트가 깨지면 안 된다(필드가 optional이므로 `toEqual` 비교가 있는 기존 테스트는 `volume: undefined`가 추가되어 실패할 수 있다. 실패하면 그 테스트의 기대값에 `volume: undefined, value: undefined`를 명시하거나 `toMatchObject`로 바꾼다).

- [ ] **Step 7: 커밋**

```bash
git add src/lib/types.ts src/lib/server/kis.ts src/lib/server/kis-candles.test.ts
git commit -m "feat(types): Candle에 거래량·거래대금 추가

MFI와 섹터 거래대금 필터가 쓸 필드. optional이라 기존 소비 지점은 영향 없다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013P2fJR2eNjh72WPmca87FV"
```

---

### Task 2: 날짜 정렬 (align.ts)

**이 태스크가 계획 전체에서 가장 중요하다.** 하루만 틀려도 아직 일어나지 않은 일을 알고 매매한 것처럼 계산되어 백테스트 결과가 전부 거짓이 된다.

규칙: **미국 거래일 `D` → 한국 거래일 중 `D`보다 큰 첫 번째 날.** `D` 자체가 한국 거래일이어도 그날 한국장은 이미 끝난 뒤라 대상이 아니다.

이를 뒤집으면: 한국 거래일 `k`에 매핑되는 미국 거래일은 `prevKr <= D < k` 구간의 것들이다(`prevKr`은 `k` 직전 한국 거래일).

**Files:**
- Create: `src/lib/backtest/align.ts`
- Test: `src/lib/backtest/align.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `type HolidayMode = "skip" | "sum" | "last"`
  - `interface AlignedDay { krDate: string; usDates: string[] }`
  - `alignUsToKr(usDates: string[], krDates: string[]): AlignedDay[]`
  - `applyHolidayMode(days: AlignedDay[], mode: HolidayMode): AlignedDay[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/backtest/align.test.ts`를 만든다. 날짜는 전부 2026-09-06에 KIS 실호출로 확인한 실제 거래일이다.

```ts
import { describe, expect, it } from "vitest";
import { alignUsToKr, applyHolidayMode } from "./align";

// 미국 거래일 D → 한국 거래일 중 D보다 큰 첫 번째 날.
// 아래 날짜는 KIS 실호출로 확인한 실제 거래일이다(2026-09-06 확인).

describe("alignUsToKr", () => {
  it("평상시에는 미국 하루가 한국 다음 거래일 하나에 붙는다", () => {
    const us = ["2025-09-02", "2025-09-03", "2025-09-04"];
    const kr = ["2025-09-02", "2025-09-03", "2025-09-04", "2025-09-05"];

    const out = alignUsToKr(us, kr);

    expect(out).toEqual([
      { krDate: "2025-09-03", usDates: ["2025-09-02"] },
      { krDate: "2025-09-04", usDates: ["2025-09-03"] },
      { krDate: "2025-09-05", usDates: ["2025-09-04"] },
    ]);
  });

  it("한국 연휴에는 미국 여러 거래일이 한국 하루로 몰린다", () => {
    // 한국은 2025-10-03(개천절)~10-09(추석) 휴장, 미국은 10-03·06~09 정상 개장.
    const us = [
      "2025-10-02", "2025-10-03", "2025-10-06",
      "2025-10-07", "2025-10-08", "2025-10-09", "2025-10-10",
    ];
    const kr = ["2025-10-02", "2025-10-10"];

    const out = alignUsToKr(us, kr);

    expect(out).toEqual([
      {
        krDate: "2025-10-10",
        usDates: [
          "2025-10-02", "2025-10-03", "2025-10-06",
          "2025-10-07", "2025-10-08", "2025-10-09",
        ],
      },
    ]);
  });

  it("미국이 쉰 구간이면 그 한국 거래일에는 미국 거래일이 하나도 붙지 않는다", () => {
    // 미국 2025-07-04 독립기념일 휴장 + 주말 → 한국 07-07(월)에 붙을 미국 거래일이 없다.
    const us = ["2025-07-03", "2025-07-07"];
    const kr = ["2025-07-03", "2025-07-04", "2025-07-07"];

    const out = alignUsToKr(us, kr);

    expect(out).toEqual([
      { krDate: "2025-07-04", usDates: ["2025-07-03"] },
      { krDate: "2025-07-07", usDates: [] },
    ]);
  });

  it("첫 한국 거래일은 직전 거래일이 없으므로 결과에 넣지 않는다", () => {
    const out = alignUsToKr(["2025-09-02"], ["2025-09-02", "2025-09-03"]);
    expect(out.map((d) => d.krDate)).toEqual(["2025-09-03"]);
  });
});

describe("applyHolidayMode", () => {
  const days = [
    { krDate: "2025-10-02", usDates: ["2025-10-01"] },
    { krDate: "2025-10-10", usDates: ["2025-10-08", "2025-10-09"] },
    { krDate: "2025-10-13", usDates: [] },
  ];

  it("skip은 미국 거래일이 정확히 하나인 날만 남긴다", () => {
    expect(applyHolidayMode(days, "skip")).toEqual([
      { krDate: "2025-10-02", usDates: ["2025-10-01"] },
    ]);
  });

  it("last는 몰린 날에서 직전 하루만 쓴다", () => {
    expect(applyHolidayMode(days, "last")).toEqual([
      { krDate: "2025-10-02", usDates: ["2025-10-01"] },
      { krDate: "2025-10-10", usDates: ["2025-10-09"] },
    ]);
  });

  it("sum은 몰린 날을 그대로 두되 빈 날은 버린다", () => {
    expect(applyHolidayMode(days, "sum")).toEqual([
      { krDate: "2025-10-02", usDates: ["2025-10-01"] },
      { krDate: "2025-10-10", usDates: ["2025-10-08", "2025-10-09"] },
    ]);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npm test -- align`
Expected: FAIL — `Cannot find module './align'`

- [ ] **Step 3: 구현한다**

`src/lib/backtest/align.ts`를 만든다.

```ts
// 미국 거래일을 한국 거래일에 붙이는 규칙.
//
//   미국 거래일 D → 한국 거래일 중 D보다 큰 첫 번째 날
//
// 미국장은 한국시간 새벽에 끝나므로, D가 한국 거래일이더라도 그날 한국장은 이미
// 끝난 뒤다. 뒤집으면 한국 거래일 k에 붙는 미국 거래일은 prevKr <= D < k 구간의 것들이다.
//
// 하루만 어긋나도 아직 일어나지 않은 일을 알고 매매한 셈이 되어 백테스트가 전부
// 거짓이 된다. align.test.ts의 날짜는 KIS 실호출로 확인한 실제 거래일이다.

/** 연휴로 미국 여러 거래일이 한국 하루에 몰릴 때의 처리 방식. */
export type HolidayMode = "skip" | "sum" | "last";

export interface AlignedDay {
  krDate: string;
  /** 이 한국 거래일에 반영되는 미국 거래일들. 보통 1개, 연휴면 여러 개, 미국이 쉬었으면 0개. */
  usDates: string[];
}

/** 날짜는 YYYY-MM-DD이므로 문자열 비교가 곧 시간 순서다. 입력은 오름차순을 가정한다. */
export function alignUsToKr(usDates: string[], krDates: string[]): AlignedDay[] {
  const out: AlignedDay[] = [];
  for (let i = 1; i < krDates.length; i++) {
    const prevKr = krDates[i - 1];
    const krDate = krDates[i];
    out.push({
      krDate,
      usDates: usDates.filter((d) => d >= prevKr && d < krDate),
    });
  }
  return out;
}

/**
 * 미국 거래일이 하나도 없는 날은 신호 자체가 없으므로 어느 모드에서든 버린다.
 * 기본은 skip — 연휴 표본은 전체의 몇 %도 안 되면서 영향력만 커서, 소수의 연휴 건이
 * "미국 신호가 통했다/안 통했다"를 뒤집을 수 있다.
 */
export function applyHolidayMode(
  days: AlignedDay[],
  mode: HolidayMode
): AlignedDay[] {
  const nonEmpty = days.filter((d) => d.usDates.length > 0);
  if (mode === "skip") return nonEmpty.filter((d) => d.usDates.length === 1);
  if (mode === "last")
    return nonEmpty.map((d) => ({
      krDate: d.krDate,
      usDates: [d.usDates[d.usDates.length - 1]],
    }));
  return nonEmpty;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npm test -- align`
Expected: PASS — 7개 전부 통과

- [ ] **Step 5: 커밋**

```bash
git add src/lib/backtest/align.ts src/lib/backtest/align.test.ts
git commit -m "feat(backtest): 미국→한국 거래일 정렬

미국 거래일 D는 D보다 큰 첫 한국 거래일에 붙는다. 연휴 처리 3모드(skip/sum/last).
테스트 날짜는 KIS 실호출로 확인한 실제 거래일이다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013P2fJR2eNjh72WPmca87FV"
```

---

### Task 3: 수익 분해 (returns.ts)

"올랐다"에는 갭과 장중이 섞여 있다. 시초가에 사면 갭은 이미 지불한 값이므로, 검증 대상은 장중이다.

**Files:**
- Create: `src/lib/backtest/returns.ts`
- Test: `src/lib/backtest/returns.test.ts`

**Interfaces:**
- Consumes: `Candle` (Task 1)
- Produces:
  - `interface DayReturn { date: string; gap: number; intraday: number; closeToClose: number }`
  - `decompose(candles: Candle[]): DayReturn[]`
  - `holdReturn(candles: Candle[], entryIndex: number, days: number): number | undefined`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
import { describe, expect, it } from "vitest";
import { decompose, holdReturn } from "./returns";
import type { Candle } from "../types";

const c = (date: string, open: number, close: number): Candle => ({
  date,
  open,
  high: Math.max(open, close),
  low: Math.min(open, close),
  close,
});

describe("decompose", () => {
  const candles = [
    c("2025-01-02", 100, 100),
    c("2025-01-03", 110, 121), // 갭 +10%, 장중 +10%
    c("2025-01-06", 121, 108.9), // 갭 0%, 장중 -10%
  ];

  it("첫 캔들은 직전 종가가 없으므로 결과에 넣지 않는다", () => {
    expect(decompose(candles).map((r) => r.date)).toEqual([
      "2025-01-03",
      "2025-01-06",
    ]);
  });

  it("갭은 시가/직전 종가, 장중은 종가/시가다", () => {
    const [first] = decompose(candles);
    expect(first.gap).toBeCloseTo(0.1, 10);
    expect(first.intraday).toBeCloseTo(0.1, 10);
  });

  it("갭과 장중을 곱하면 종가-종가가 된다", () => {
    for (const r of decompose(candles)) {
      expect((1 + r.gap) * (1 + r.intraday)).toBeCloseTo(1 + r.closeToClose, 10);
    }
  });

  it("장중이 마이너스면 종가-종가도 그만큼 깎인다", () => {
    const [, second] = decompose(candles);
    expect(second.gap).toBeCloseTo(0, 10);
    expect(second.intraday).toBeCloseTo(-0.1, 10);
    expect(second.closeToClose).toBeCloseTo(-0.1, 10);
  });
});

describe("holdReturn", () => {
  const candles = [
    c("2025-01-02", 100, 100),
    c("2025-01-03", 100, 105),
    c("2025-01-06", 105, 110),
    c("2025-01-07", 110, 120),
  ];

  it("진입일 시가에 사서 N거래일 뒤 종가에 판 수익을 낸다", () => {
    // index 1 시가 100 → index 2 종가 110
    expect(holdReturn(candles, 1, 1)).toBeCloseTo(0.1, 10);
  });

  it("보유 기간이 데이터 끝을 넘으면 undefined를 낸다", () => {
    expect(holdReturn(candles, 3, 5)).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npm test -- returns`
Expected: FAIL — `Cannot find module './returns'`

- [ ] **Step 3: 구현한다**

```ts
// 하루 수익을 세 구간으로 나눈다.
//
//   갭        = 시가(t) / 종가(t-1) - 1   미국장 반응이 개장가에 이미 반영된 몫
//   장중      = 종가(t) / 시가(t)   - 1   매매로 취할 수 있는 유일한 구간
//   종가-종가 = 종가(t) / 종가(t-1) - 1   갭 + 장중
//
// 종가-종가만 보면 상관이 높게 나오는데, 그 일치가 전부 갭 안에 있으면 시초가 매수로는
// 아무것도 얻지 못한다. 그래서 셋을 따로 낸다.

import type { Candle } from "../types";

export interface DayReturn {
  date: string;
  gap: number;
  intraday: number;
  closeToClose: number;
}

/** 입력은 날짜 오름차순을 가정한다. 첫 캔들은 직전 종가가 없어 제외된다. */
export function decompose(candles: Candle[]): DayReturn[] {
  const out: DayReturn[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const cur = candles[i];
    out.push({
      date: cur.date,
      gap: cur.open / prev.close - 1,
      intraday: cur.close / cur.open - 1,
      closeToClose: cur.close / prev.close - 1,
    });
  }
  return out;
}

/**
 * entryIndex일 시가에 사서 days거래일 뒤 종가에 판 총수익(비용 미반영).
 * 데이터 끝을 넘으면 undefined — 표본에서 빼야 한다.
 */
export function holdReturn(
  candles: Candle[],
  entryIndex: number,
  days: number
): number | undefined {
  const exit = candles[entryIndex + days];
  const entry = candles[entryIndex];
  if (!exit || !entry) return undefined;
  return exit.close / entry.open - 1;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npm test -- returns`
Expected: PASS — 6개 전부 통과

- [ ] **Step 5: 커밋**

```bash
git add src/lib/backtest/returns.ts src/lib/backtest/returns.test.ts
git commit -m "feat(backtest): 갭·장중·종가-종가 수익 분해

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013P2fJR2eNjh72WPmca87FV"
```

---

### Task 4: 비용 (cost.ts)

보유 3~5일이면 연 약 50회 매매이므로 왕복 0.4%는 **연 20%**가 된다. 비용을 빼지 않은 백테스트는 이 사실을 숨긴다.

**Files:**
- Create: `src/lib/backtest/cost.ts`
- Test: `src/lib/backtest/cost.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `const DEFAULT_ROUND_TRIP = 0.004`
  - `applyCost(grossReturn: number, roundTrip?: number): number`
  - `annualCost(roundTrip: number, tradesPerYear: number): number`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_ROUND_TRIP, applyCost, annualCost } from "./cost";

describe("applyCost", () => {
  it("기본 왕복 비용은 0.4%다", () => {
    expect(DEFAULT_ROUND_TRIP).toBe(0.004);
  });

  it("총수익에서 왕복 비용을 곱셈으로 뺀다", () => {
    // (1 + 0.02) * (1 - 0.004) - 1
    expect(applyCost(0.02)).toBeCloseTo(0.015920, 6);
  });

  it("손실이어도 비용은 그대로 더 빠진다", () => {
    expect(applyCost(-0.02)).toBeCloseTo(-0.023920, 6);
  });

  it("비용을 0으로 주면 총수익 그대로다", () => {
    expect(applyCost(0.05, 0)).toBeCloseTo(0.05, 10);
  });
});

describe("annualCost", () => {
  it("왕복 0.4%로 연 50회 매매하면 연 18% 남짓이 비용으로 나간다", () => {
    // 복리이므로 0.004 * 50 = 0.2 가 아니라 1 - 0.996^50 = 0.1816 이다.
    expect(annualCost(0.004, 50)).toBeCloseTo(0.1816, 3);
  });

  it("매매를 안 하면 비용도 0이다", () => {
    expect(annualCost(0.004, 0)).toBeCloseTo(0, 10);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npm test -- cost`
Expected: FAIL — `Cannot find module './cost'`

- [ ] **Step 3: 구현한다**

```ts
// 왕복 거래 비용 — 매수·매도 수수료 + 증권거래세 + 슬리피지.
//
// 보유 3~5일이면 연 약 50회 매매이므로 왕복 0.4%는 복리로 연 18% 남짓이 된다. 그만큼
// 먼저 벌어야 본전이다. 비용을 빼지 않은 백테스트는 "되는 것처럼 보이는데 실제로는
// 안 되는" 결과를 낸다.
//
// 증권거래세율은 최근 몇 년간 반복 개정되었다. 실제 매매에 쓰기 전 현행 세율을 확인할 것.

/** 왕복 0.4%. 수수료·거래세·슬리피지를 합친 보수적 기본값. */
export const DEFAULT_ROUND_TRIP = 0.004;

/** 총수익에 왕복 비용을 곱셈으로 적용한다. */
export function applyCost(
  grossReturn: number,
  roundTrip: number = DEFAULT_ROUND_TRIP
): number {
  return (1 + grossReturn) * (1 - roundTrip) - 1;
}

/** 연간 매매 횟수로 환산한 누적 비용. 보고서에 "본전 문턱"으로 찍는다. */
export function annualCost(roundTrip: number, tradesPerYear: number): number {
  return 1 - (1 - roundTrip) ** tradesPerYear;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npm test -- cost`
Expected: PASS — 5개 전부 통과

- [ ] **Step 5: 커밋**

```bash
git add src/lib/backtest/cost.ts src/lib/backtest/cost.test.ts
git commit -m "feat(backtest): 왕복 거래 비용 반영

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013P2fJR2eNjh72WPmca87FV"
```

---

### Task 5: 통계 (stats.ts)

승률만 보면 상승장에서 아무 규칙이나 좋아 보인다. 대조군·손익비·MDD·표본 수를 같이 낸다.

**Files:**
- Create: `src/lib/backtest/stats.ts`
- Test: `src/lib/backtest/stats.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `interface Summary { n: number; winRate: number; mean: number; payoff: number; mdd: number }`
  - `summarize(returns: number[]): Summary`
  - `interface Comparison { signal: Summary; control: Summary; deltaMean: number; deltaWinRate: number }`
  - `compare(signal: number[], control: number[]): Comparison`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
import { describe, expect, it } from "vitest";
import { summarize, compare } from "./stats";

describe("summarize", () => {
  it("표본 수·승률·평균을 낸다", () => {
    const s = summarize([0.1, -0.05, 0.2, -0.05]);
    expect(s.n).toBe(4);
    expect(s.winRate).toBeCloseTo(0.5, 10);
    expect(s.mean).toBeCloseTo(0.05, 10);
  });

  it("손익비는 평균이익 나누기 평균손실 절대값이다", () => {
    // 이익 평균 0.15, 손실 평균 절대값 0.05
    expect(summarize([0.1, -0.05, 0.2, -0.05]).payoff).toBeCloseTo(3, 10);
  });

  it("MDD는 누적 곡선의 최대 낙폭을 양수로 낸다", () => {
    // 1 → 1.5 → 0.75 : 고점 1.5 대비 0.75이므로 -50%
    expect(summarize([0.5, -0.5]).mdd).toBeCloseTo(0.5, 10);
  });

  it("계속 오르기만 하면 MDD는 0이다", () => {
    expect(summarize([0.1, 0.1, 0.1]).mdd).toBeCloseTo(0, 10);
  });

  it("손실이 없으면 손익비는 Infinity다", () => {
    expect(summarize([0.1, 0.2]).payoff).toBe(Infinity);
  });

  it("빈 입력이면 표본 0에 나머지는 0이다", () => {
    expect(summarize([])).toEqual({
      n: 0,
      winRate: 0,
      mean: 0,
      payoff: 0,
      mdd: 0,
    });
  });
});

describe("compare", () => {
  it("신호와 대조군의 평균·승률 차이를 낸다", () => {
    const out = compare([0.1, 0.1, -0.05], [0.0, 0.0, -0.05]);
    expect(out.signal.n).toBe(3);
    expect(out.control.n).toBe(3);
    expect(out.deltaMean).toBeCloseTo(out.signal.mean - out.control.mean, 10);
    expect(out.deltaWinRate).toBeCloseTo(
      out.signal.winRate - out.control.winRate,
      10
    );
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npm test -- stats`
Expected: FAIL — `Cannot find module './stats'`

- [ ] **Step 3: 구현한다**

```ts
// 백테스트 결과 요약.
//
// 승률과 평균만으로는 부족하다. 상승장에서는 아무 규칙이나 승률이 높게 나오므로 대조군과
// 비교해야 하고, 승률이 좋아도 손익비가 나쁘면 계좌는 줄어든다. 그리고 실제로 규칙을
// 포기하게 되는 지점은 MDD다. 표본 수(n)를 같이 내는 이유는, 필터를 더할수록 승률은
// 올라 보이지만 표본이 말라 착시가 생기기 때문이다.

export interface Summary {
  /** 표본 수 — 승률과 반드시 같이 본다. */
  n: number;
  winRate: number;
  mean: number;
  /** 평균이익 / 평균손실(절대값). 손실이 없으면 Infinity. */
  payoff: number;
  /** 누적 곡선 최대낙폭. 양수 비율(0.25 = -25%). */
  mdd: number;
}

export function summarize(returns: number[]): Summary {
  if (returns.length === 0) return { n: 0, winRate: 0, mean: 0, payoff: 0, mdd: 0 };

  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r < 0);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  let equity = 1;
  let peak = 1;
  let mdd = 0;
  for (const r of returns) {
    equity *= 1 + r;
    peak = Math.max(peak, equity);
    mdd = Math.max(mdd, 1 - equity / peak);
  }

  return {
    n: returns.length,
    winRate: wins.length / returns.length,
    mean: avg(returns),
    payoff: losses.length === 0 ? Infinity : avg(wins) / Math.abs(avg(losses)),
    mdd,
  };
}

export interface Comparison {
  signal: Summary;
  control: Summary;
  deltaMean: number;
  deltaWinRate: number;
}

/** 신호가 무작위 매수보다 나은지. 대조군 없는 승률은 정보가 아니다. */
export function compare(signal: number[], control: number[]): Comparison {
  const s = summarize(signal);
  const c = summarize(control);
  return {
    signal: s,
    control: c,
    deltaMean: s.mean - c.mean,
    deltaWinRate: s.winRate - c.winRate,
  };
}
```

주의: `summarize([0.1, 0.2])`에서 `losses`가 비어 `avg([])`가 `NaN`이 되지 않도록, `payoff`는 `losses.length === 0`을 먼저 검사한다(위 코드가 그렇게 되어 있다). `wins`가 비었을 때 `avg(wins)`는 `NaN`이 되므로, 손실만 있는 입력에서는 `payoff`가 `NaN`이다 — 이는 의도된 동작이고 보고서에서 `-`로 찍는다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npm test -- stats`
Expected: PASS — 7개 전부 통과

- [ ] **Step 5: 커밋**

```bash
git add src/lib/backtest/stats.ts src/lib/backtest/stats.test.ts
git commit -m "feat(backtest): 승률·손익비·MDD·대조군 비교

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013P2fJR2eNjh72WPmca87FV"
```

---

### Task 6: 전이 계수 (transfer.ts)

25년 전체로 계수 하나를 뽑으면 서로 다른 두 세계의 평균이 나온다. 자를 지점을 미리 정하지 않고 롤링 창으로 변화를 그린다.

**Files:**
- Create: `src/lib/backtest/transfer.ts`
- Test: `src/lib/backtest/transfer.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `pearson(xs: number[], ys: number[]): number`
  - `interface RollingPoint { date: string; corr: number; n: number }`
  - `rollingCorr(dates: string[], xs: number[], ys: number[], window: number): RollingPoint[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
import { describe, expect, it } from "vitest";
import { pearson, rollingCorr } from "./transfer";

describe("pearson", () => {
  it("완전히 같이 움직이면 1이다", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
  });

  it("정반대로 움직이면 -1이다", () => {
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 10);
  });

  it("한쪽이 전혀 변하지 않으면 0을 낸다", () => {
    expect(pearson([1, 2, 3], [5, 5, 5])).toBe(0);
  });

  it("표본이 2개 미만이면 0을 낸다", () => {
    expect(pearson([1], [2])).toBe(0);
  });

  it("길이가 다르면 던진다", () => {
    expect(() => pearson([1, 2], [1])).toThrow();
  });
});

describe("rollingCorr", () => {
  const dates = ["d1", "d2", "d3", "d4", "d5"];
  const xs = [1, 2, 3, 4, 5];
  const ys = [2, 4, 6, 8, 10];

  it("창 크기만큼 모인 뒤부터 창의 마지막 날짜로 점을 낸다", () => {
    const out = rollingCorr(dates, xs, ys, 3);
    expect(out.map((p) => p.date)).toEqual(["d3", "d4", "d5"]);
    expect(out.every((p) => p.n === 3)).toBe(true);
    for (const p of out) expect(p.corr).toBeCloseTo(1, 10);
  });

  it("표본이 창보다 적으면 빈 배열이다", () => {
    expect(rollingCorr(["d1"], [1], [2], 3)).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npm test -- transfer`
Expected: FAIL — `Cannot find module './transfer'`

- [ ] **Step 3: 구현한다**

```ts
// 전이 계수 — 전날 미국 등락과 다음 한국 거래일 수익이 같이 움직이는 정도.
//
// 한국 투자자의 미국 시장 참여는 2020~2021년을 지나며 크게 달라졌다. 25년 전체로 계수
// 하나를 뽑으면 서로 다른 두 세계의 평균이 나온다. 그렇다고 "2021년 이후"로 미리 자르지도
// 않는다 — 자를 지점을 롤링 창으로 찾는다. 변곡점이 눈에 보이면 그것이 근거 있는 분할점이다.

export function pearson(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length) throw new Error("길이가 다르다");
  const n = xs.length;
  if (n < 2) return 0;

  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;

  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const denom = Math.sqrt(sxx * syy);
  return denom === 0 ? 0 : sxy / denom;
}

export interface RollingPoint {
  /** 창의 마지막 날짜. */
  date: string;
  corr: number;
  n: number;
}

/** 창 크기만큼 모인 뒤부터 한 점씩 낸다. window=250이면 약 1년. */
export function rollingCorr(
  dates: string[],
  xs: number[],
  ys: number[],
  window: number
): RollingPoint[] {
  if (dates.length !== xs.length || xs.length !== ys.length)
    throw new Error("길이가 다르다");

  const out: RollingPoint[] = [];
  for (let end = window; end <= xs.length; end++) {
    const start = end - window;
    out.push({
      date: dates[end - 1],
      corr: pearson(xs.slice(start, end), ys.slice(start, end)),
      n: window,
    });
  }
  return out;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npm test -- transfer`
Expected: PASS — 7개 전부 통과

- [ ] **Step 5: 커밋**

```bash
git add src/lib/backtest/transfer.ts src/lib/backtest/transfer.test.ts
git commit -m "feat(backtest): 전이 계수 (전체 + 롤링 창)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013P2fJR2eNjh72WPmca87FV"
```

---

### Task 7: 데이터 적재 스크립트

`scripts/news-setup.mjs`와 같은 패턴 — `.mjs`, 자체 fetch, 한국어 출력. TS 모듈을 import하지 않는다.

**Files:**
- Create: `scripts/backtest-fetch.mjs`
- Modify: `package.json` (scripts에 `backtest:fetch` 추가)
- Modify: `.gitignore` (`/data` 추가)

**Interfaces:**
- Consumes: 없음
- Produces: `data/candles/<market>-<code>-D.json` — 아래 형태. Task 8이 이 파일을 읽는다.
  ```json
  {
    "market": "KR",
    "code": "0001",
    "kind": "index",
    "label": "코스피",
    "period": "D",
    "fetchedAt": "2026-09-06T04:00:00.000Z",
    "candles": [
      { "date": "1997-01-03", "open": 0, "high": 0, "low": 0, "close": 0, "volume": 0, "value": 0 }
    ]
  }
  ```
  `candles`는 날짜 오름차순. 해외지수는 `value` 없음.

- [ ] **Step 1: .gitignore에 data를 추가한다**

`.gitignore` 끝에 한 줄 더한다.

```
/data
```

- [ ] **Step 2: 적재 스크립트를 쓴다**

`scripts/backtest-fetch.mjs`를 만든다.

```js
// 백테스트용 지수 일봉 적재 — 한 번 받아 파일로 떨어뜨린다.
//   npm run backtest:fetch
// 백테스트는 설정을 바꿔가며 수백 번 도는 물건이라 매번 API를 호출하면 즉시 차단된다.
// 여러 번 실행해도 안전하다(이미 받은 구간은 건너뛴다).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const BASE = "https://openapi.koreainvestment.com:9443";
const OUT_DIR = "data/candles";
const TOKEN_FILE = "data/.kis-token.json";
const GAP_MS = 1500; // 0.35초는 간헐 실패한다. 1.5초가 안정적.

const appkey = process.env.KIS_APP_KEY;
const appsecret = process.env.KIS_APP_SECRET;

// code는 KIS 지수 코드. src/lib/indices.ts와 같은 목록이다.
const INDICES = [
  { market: "KR", code: "0001", label: "코스피", from: "19970101" },
  { market: "KR", code: "1001", label: "코스닥", from: "19970101" },
  { market: "US", code: "COMP", label: "나스닥", from: "20000101" },
  { market: "US", code: "SPX", label: "S&P 500", from: "20000101" },
  { market: "US", code: ".DJI", label: "다우존스", from: "20000101" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ymd = (d) => d.toISOString().slice(0, 10).replaceAll("-", "");
const iso = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

if (!appkey || !appsecret) {
  console.error("FAIL .env.local에 KIS_APP_KEY / KIS_APP_SECRET 이 없습니다.");
  process.exit(1);
}

// ── 토큰: 발급 자체에 분당 제한이 있어 파일에 캐시한다 ──────────────────────
async function getToken() {
  if (existsSync(TOKEN_FILE)) {
    const c = JSON.parse(await readFile(TOKEN_FILE, "utf8"));
    if (c.expiresAt > Date.now()) {
      console.log("  캐시된 토큰 재사용");
      return c.token;
    }
  }
  for (let i = 1; i <= 8; i++) {
    const res = await fetch(`${BASE}/oauth2/tokenP`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "client_credentials", appkey, appsecret }),
    });
    const body = await res.json();
    if (body.access_token) {
      await writeFile(
        TOKEN_FILE,
        JSON.stringify({
          token: body.access_token,
          expiresAt: Date.now() + (body.expires_in - 120) * 1000,
        })
      );
      console.log("  새 토큰 발급");
      return body.access_token;
    }
    console.log(`  토큰 대기 ${i}/8 — ${body.error_description ?? body.msg1 ?? "?"}`);
    await sleep(30000);
  }
  throw new Error("토큰 발급 실패");
}

// ── 조회: rt_cd를 반드시 검사한다. 안 하면 오류가 빈 배열로 위장된다 ───────
async function fetchChunk(token, idx, from, to) {
  const isKR = idx.market === "KR";
  const path = isKR
    ? "/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice"
    : "/uapi/overseas-price/v1/quotations/inquire-daily-chartprice";
  const trId = isKR ? "FHKUP03500100" : "FHKST03030100";
  const qs =
    `FID_COND_MRKT_DIV_CODE=${isKR ? "U" : "N"}` +
    `&FID_INPUT_ISCD=${encodeURIComponent(idx.code)}` +
    `&FID_INPUT_DATE_1=${from}&FID_INPUT_DATE_2=${to}&FID_PERIOD_DIV_CODE=D`;

  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${BASE}${path}?${qs}`, {
      headers: { authorization: `Bearer ${token}`, appkey, appsecret, tr_id: trId, custtype: "P" },
    });
    const body = await res.json();
    if (body.rt_cd === "0") return body.output2 ?? [];
    if (attempt === 4) throw new Error(`조회 실패 ${idx.code}: ${body.msg1?.trim() ?? body.rt_cd}`);
    await sleep(GAP_MS * 2);
  }
}

function toCandle(row, isKR) {
  const num = (v) => (v === undefined || v === "" ? undefined : Number(v));
  return {
    date: iso(row.stck_bsop_date),
    open: Number(isKR ? row.bstp_nmix_oprc : row.ovrs_nmix_oprc),
    high: Number(isKR ? row.bstp_nmix_hgpr : row.ovrs_nmix_hgpr),
    low: Number(isKR ? row.bstp_nmix_lwpr : row.ovrs_nmix_lwpr),
    close: Number(isKR ? row.bstp_nmix_prpr : row.ovrs_nmix_prpr),
    volume: num(row.acml_vol),
    value: isKR ? num(row.acml_tr_pbmn) : undefined,
  };
}

// ── 적재: 1회 반환에 상한이 있으므로 끝 날짜를 뒤로 밀어가며 반복한다 ───────
// 상한이 50이든 100이든 동작하므로 정확한 값을 알 필요가 없다.
async function loadIndex(token, idx) {
  const file = `${OUT_DIR}/${idx.market}-${idx.code}-D.json`;
  const seen = new Map(); // date -> candle

  if (existsSync(file)) {
    const prev = JSON.parse(await readFile(file, "utf8"));
    for (const c of prev.candles) seen.set(c.date, c);
    console.log(`  기존 ${prev.candles.length}건 로드`);
  }

  const isKR = idx.market === "KR";
  let cursor = ymd(new Date());
  let stalls = 0;

  while (cursor > idx.from && stalls < 3) {
    const rows = await fetchChunk(token, idx, idx.from, cursor);
    if (rows.length === 0) break;

    const before = seen.size;
    let oldest = cursor;
    for (const row of rows) {
      if (!row.stck_bsop_date) continue;
      const c = toCandle(row, isKR);
      seen.set(c.date, c);
      if (row.stck_bsop_date < oldest) oldest = row.stck_bsop_date;
    }

    // 새로 얻은 게 없으면 더 밀어도 소용없다. 3번 연속이면 중단.
    stalls = seen.size === before ? stalls + 1 : 0;

    // 가장 오래된 날짜의 하루 전으로 커서를 민다.
    const d = new Date(`${iso(oldest)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    cursor = ymd(d);

    process.stdout.write(`\r  ${idx.label}: ${seen.size}건 (${iso(oldest)}까지)   `);
    await sleep(GAP_MS);
  }

  const candles = [...seen.values()].sort((a, b) => a.date.localeCompare(b.date));
  await writeFile(
    file,
    JSON.stringify(
      {
        market: idx.market,
        code: idx.code,
        kind: "index",
        label: idx.label,
        period: "D",
        fetchedAt: new Date().toISOString(),
        candles,
      },
      null,
      0
    )
  );
  console.log(`\r  ${idx.label}: ${candles.length}건 저장 (${candles[0]?.date} ~ ${candles.at(-1)?.date})`);
}

await mkdir(OUT_DIR, { recursive: true });
console.log("\n[1] 토큰");
const token = await getToken();

console.log("\n[2] 지수 일봉 적재 (25년치, 약 10분)");
for (const idx of INDICES) await loadIndex(token, idx);

console.log("\n완료. 다음: npm run backtest:run\n");
```

- [ ] **Step 3: package.json에 명령을 추가한다**

`scripts`에 한 줄을 더한다. `backtest:run`은 Task 8에서 추가한다 — 그때 실행 방식이 정해지므로 여기서 미리 넣지 않는다.

```json
"backtest:fetch": "node --env-file-if-exists=.env.local scripts/backtest-fetch.mjs"
```

- [ ] **Step 4: 실제로 적재한다**

Run: `npm run backtest:fetch`
Expected: 5개 지수 각각 수천 건 저장. 코스피는 1997년대, 미국 지수는 2000년대부터 시작해야 한다. 약 10분 소요.

확인:

```bash
ls -la data/candles/
node -e "for (const f of require('fs').readdirSync('data/candles')) { const j = JSON.parse(require('fs').readFileSync('data/candles/'+f)); console.log(f, j.candles.length, j.candles[0].date, '~', j.candles.at(-1).date); }"
```

기대: 각 파일 4,000건 이상, 코스피 시작이 1997년, 나스닥 시작이 2000년.

- [ ] **Step 5: 커밋**

데이터 파일은 gitignore되므로 스크립트와 설정만 커밋된다.

```bash
git add scripts/backtest-fetch.mjs package.json .gitignore
git commit -m "feat(backtest): 지수 일봉 적재 스크립트

토큰 파일 캐시, rt_cd 검사, 1.5초 간격, 커서 역방향 페이징. 멱등.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013P2fJR2eNjh72WPmca87FV"
```

---

### Task 8: 백테스트 실행 + 보고서

Task 2~6의 로직을 조립해 실제 답을 낸다. `.mjs`가 TS를 import할 수 없으므로, 조립 로직도 `src/lib/backtest/`에 TS로 두고 테스트한 뒤, 스크립트는 얇게 출력만 맡는다.

**Files:**
- Create: `src/lib/backtest/run.ts`
- Test: `src/lib/backtest/run.test.ts`
- Create: `scripts/backtest-run.mjs`

**Interfaces:**
- Consumes: `alignUsToKr`, `applyHolidayMode`, `HolidayMode`, `AlignedDay` (Task 2) · `decompose`, `DayReturn` (Task 3) · `applyCost`, `DEFAULT_ROUND_TRIP` (Task 4) · `summarize`, `compare`, `Comparison` (Task 5) · `pearson`, `rollingCorr` (Task 6) · `Candle` (Task 1)
- Produces:
  - `interface TransferInput { krCandles: Candle[]; usCandles: Candle[]; mode: HolidayMode; roundTrip: number; window: number; threshold: number; horizons: number[] }`
  - `interface HorizonResult { days: number; comparison: Comparison }`
  - `interface TransferReport { corr: { gap: number; intraday: number; closeToClose: number }; rolling: RollingPoint[]; conditional: Comparison; horizons: HorizonResult[]; annualCostAt50: number }`
  - `analyzeTransfer(input: TransferInput): TransferReport`

`horizons`는 스펙 §4의 보유 기간이다 — 단기 `3`·`5`일, 중기 `20`·`60`일. `conditional`은 당일 장중(시초가 매수 → 당일 종가 매도)이고, `horizons`는 시초가 매수 → N거래일 뒤 종가 매도다. 둘 다 비용을 적용하고 대조군과 비교한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/backtest/run.test.ts`를 만든다. 합성 데이터로 "미국이 오른 다음날 한국 장중도 오르게" 만들어 놓고, 분석이 그걸 잡아내는지 본다.

```ts
import { describe, expect, it } from "vitest";
import { analyzeTransfer } from "./run";
import type { Candle } from "../types";

// 미국이 오른 다음 한국 거래일의 장중이 오르도록 만든 합성 데이터.
// 분석이 이 심어둔 관계를 잡아내야 한다.
function build(days: number) {
  const kr: Candle[] = [];
  const us: Candle[] = [];
  let krClose = 100;
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.UTC(2020, 0, 6 + i * 7)); // 매주 월요일 — 주말 없이 단순화
    const date = d.toISOString().slice(0, 10);

    const usUp = i % 2 === 0 ? 0.02 : -0.02;
    us.push({ date, open: 100, high: 100, low: 100, close: 100 * (1 + usUp) });

    // 한국 i번째 날은 미국 (i-1)번째 신호를 받는다.
    const prevSignal = i === 0 ? 0 : (i - 1) % 2 === 0 ? 0.02 : -0.02;
    const open = krClose; // 갭 0 — 전부 장중으로 나오게 한다
    const close = open * (1 + prevSignal);
    kr.push({ date, open, high: Math.max(open, close), low: Math.min(open, close), close });
    krClose = close;
  }
  return { kr, us };
}

describe("analyzeTransfer", () => {
  const { kr, us } = build(60);
  const report = analyzeTransfer({
    krCandles: kr,
    usCandles: us,
    mode: "skip",
    roundTrip: 0,
    window: 20,
    threshold: 0.01,
    horizons: [3, 5],
  });

  it("심어둔 관계를 장중 상관에서 강하게 잡아낸다", () => {
    expect(report.corr.intraday).toBeGreaterThan(0.9);
  });

  it("갭을 0으로 만들었으므로 갭 상관은 거의 없다", () => {
    expect(Math.abs(report.corr.gap)).toBeLessThan(0.2);
  });

  it("롤링 점은 창 크기만큼 모인 뒤부터 나온다", () => {
    expect(report.rolling.length).toBeGreaterThan(0);
    expect(report.rolling[0].n).toBe(20);
  });

  it("신호일 성과가 대조군보다 낫다", () => {
    expect(report.conditional.deltaMean).toBeGreaterThan(0);
    expect(report.conditional.signal.n).toBeGreaterThan(0);
    expect(report.conditional.control.n).toBeGreaterThan(0);
  });

  const withCost = analyzeTransfer({
    krCandles: kr,
    usCandles: us,
    mode: "skip",
    roundTrip: 0.004,
    window: 20,
    threshold: 0.01,
    horizons: [3, 5],
  });

  it("비용을 0.4%로 주면 신호일 평균이 그만큼 낮아진다", () => {
    expect(withCost.conditional.signal.mean).toBeLessThan(
      report.conditional.signal.mean
    );
  });

  it("연 50회 매매 기준 비용을 같이 낸다", () => {
    // 복리이므로 1 - 0.996^50 = 0.1816
    expect(withCost.annualCostAt50).toBeCloseTo(0.1816, 3);
  });

  it("요청한 보유 기간마다 대조군 비교를 낸다", () => {
    expect(report.horizons.map((h) => h.days)).toEqual([3, 5]);
    for (const h of report.horizons) {
      expect(h.comparison.signal.n).toBeGreaterThan(0);
      expect(h.comparison.control.n).toBeGreaterThan(0);
    }
  });

  it("보유 기간 성과에도 비용이 적용된다", () => {
    for (let i = 0; i < report.horizons.length; i++) {
      expect(withCost.horizons[i].comparison.signal.mean).toBeLessThan(
        report.horizons[i].comparison.signal.mean
      );
    }
  });

  it("horizons가 비면 보유 기간 결과도 비어 있다", () => {
    const none = analyzeTransfer({
      krCandles: kr,
      usCandles: us,
      mode: "skip",
      roundTrip: 0,
      window: 20,
      threshold: 0.01,
      horizons: [],
    });
    expect(none.horizons).toEqual([]);
  });
});
```

두 번째 테스트의 삼항 표현은 잘못된 형태다. 이렇게 고쳐 쓴다:

```ts
  it("갭을 0으로 만들었으므로 갭 상관은 거의 없다", () => {
    expect(Math.abs(report.corr.gap)).toBeLessThan(0.2);
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npm test -- run`
Expected: FAIL — `Cannot find module './run'`

- [ ] **Step 3: 구현한다**

`src/lib/backtest/run.ts`를 만든다.

```ts
// 1단계 분석 조립 — 전날 미국 등락이 다음 한국 거래일 수익으로 이어지는가.
//
// 세 가지를 낸다.
//   1) 갭·장중·종가-종가 각각의 상관 — 일치가 전부 갭 안에 있으면 매매로는 못 먹는다
//   2) 롤링 상관 — 관계가 언제 바뀌었는지. 자를 지점을 미리 정하지 않고 여기서 찾는다
//   3) 조건부 성과 vs 대조군 — 대조군 없는 승률은 정보가 아니다

import type { Candle } from "../types";
import { alignUsToKr, applyHolidayMode, type HolidayMode } from "./align";
import { decompose, holdReturn } from "./returns";
import { applyCost, annualCost } from "./cost";
import { compare, type Comparison } from "./stats";
import { pearson, rollingCorr, type RollingPoint } from "./transfer";

export interface TransferInput {
  krCandles: Candle[];
  usCandles: Candle[];
  mode: HolidayMode;
  roundTrip: number;
  /** 롤링 창(거래일). 250이면 약 1년. */
  window: number;
  /** 신호로 볼 미국 등락률 하한. 0.01이면 +1% 이상인 날. */
  threshold: number;
  /** 보유 기간(거래일). 단기 3·5일, 중기 20·60일. */
  horizons: number[];
}

export interface HorizonResult {
  days: number;
  comparison: Comparison;
}

export interface TransferReport {
  corr: { gap: number; intraday: number; closeToClose: number };
  rolling: RollingPoint[];
  /** 당일 장중 — 시초가 매수 → 당일 종가 매도. */
  conditional: Comparison;
  /** 보유 기간별 — 시초가 매수 → N거래일 뒤 종가 매도. */
  horizons: HorizonResult[];
  annualCostAt50: number;
}

export function analyzeTransfer(input: TransferInput): TransferReport {
  const { krCandles, usCandles, mode, roundTrip, window, threshold, horizons } =
    input;

  const krRet = decompose(krCandles);
  const usRet = decompose(usCandles);
  const krByDate = new Map(krRet.map((r) => [r.date, r]));
  const usByDate = new Map(usRet.map((r) => [r.date, r]));

  const days = applyHolidayMode(
    alignUsToKr(
      usRet.map((r) => r.date),
      krRet.map((r) => r.date)
    ),
    mode
  );

  // 미국 신호는 종가-종가 등락률. 몰린 날(sum)은 복리로 합친다.
  const dates: string[] = [];
  const signal: number[] = [];
  const gap: number[] = [];
  const intraday: number[] = [];
  const c2c: number[] = [];

  for (const d of days) {
    const kr = krByDate.get(d.krDate);
    if (!kr) continue;
    let acc = 1;
    let ok = false;
    for (const u of d.usDates) {
      const r = usByDate.get(u);
      if (!r) continue;
      acc *= 1 + r.closeToClose;
      ok = true;
    }
    if (!ok) continue;
    dates.push(d.krDate);
    signal.push(acc - 1);
    gap.push(kr.gap);
    intraday.push(kr.intraday);
    c2c.push(kr.closeToClose);
  }

  // 조건부 성과: 시초가 매수 → 당일 종가 매도(장중 구간)에 비용을 적용한다.
  const net = intraday.map((r) => applyCost(r, roundTrip));
  const signalDays: number[] = [];
  const controlDays: number[] = [];
  for (let i = 0; i < net.length; i++) {
    if (signal[i] >= threshold) signalDays.push(net[i]);
    else controlDays.push(net[i]);
  }

  // 보유 기간별 성과: 신호일 시초가에 사서 N거래일 뒤 종가에 판다.
  // 데이터 끝을 넘는 표본은 holdReturn이 undefined를 내므로 제외된다.
  const krIndex = new Map(krCandles.map((c, i) => [c.date, i]));
  const horizonResults: HorizonResult[] = horizons.map((days) => {
    const sig: number[] = [];
    const ctl: number[] = [];
    for (let i = 0; i < dates.length; i++) {
      const idx = krIndex.get(dates[i]);
      if (idx === undefined) continue;
      const gross = holdReturn(krCandles, idx, days);
      if (gross === undefined) continue;
      (signal[i] >= threshold ? sig : ctl).push(applyCost(gross, roundTrip));
    }
    return { days, comparison: compare(sig, ctl) };
  });

  return {
    corr: {
      gap: pearson(signal, gap),
      intraday: pearson(signal, intraday),
      closeToClose: pearson(signal, c2c),
    },
    rolling: rollingCorr(dates, signal, intraday, window),
    conditional: compare(signalDays, controlDays),
    horizons: horizonResults,
    annualCostAt50: annualCost(roundTrip, 50),
  };
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npm test`
Expected: PASS — 전체 통과

- [ ] **Step 5: 실행 스크립트를 쓴다**

`.mjs`는 TS를 import할 수 없으므로, 스크립트는 vitest로 검증된 로직을 쓰기 위해 `npx tsx`를 쓰지 않고 **결과 계산까지 TS 쪽에 두고 스크립트는 얇은 CLI**로 만든다. 가장 단순한 방법은 실행 자체를 vitest가 아닌 별도 진입점으로 두는 것이다 — `scripts/backtest-run.mjs`가 `data/candles/*.json`을 읽어 `analyzeTransfer`에 넘겨야 하므로, TS를 실행할 수단이 필요하다.

이 저장소는 이미 `next`를 쓰므로 `tsx`를 개발 의존성으로 추가한다.

```bash
npm install --save-dev tsx
```

`package.json`의 `scripts`에 추가한다.

```json
"backtest:run": "tsx scripts/backtest-run.ts"
```

`scripts/backtest-run.ts`를 만든다(`.mjs`가 아니라 `.ts`다).

```ts
// 1단계 백테스트 실행 — data/candles의 파일만 읽는다. API를 호출하지 않는다.
//   npm run backtest:run
import { readFileSync } from "node:fs";
import { analyzeTransfer } from "../src/lib/backtest/run";
import { DEFAULT_ROUND_TRIP } from "../src/lib/backtest/cost";
import type { Candle } from "../src/lib/types";

const load = (f: string): Candle[] =>
  JSON.parse(readFileSync(`data/candles/${f}`, "utf8")).candles;

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const n2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "-");

const KR = [
  { file: "KR-0001-D.json", label: "코스피" },
  { file: "KR-1001-D.json", label: "코스닥" },
];
const US = [
  { file: "US-COMP-D.json", label: "나스닥" },
  { file: "US-SPX-D.json", label: "S&P 500" },
  { file: "US-.DJI-D.json", label: "다우존스" },
];

console.log(`\n비용 왕복 ${pct(DEFAULT_ROUND_TRIP)} · 연 50회 매매 기준 본전 문턱 확인\n`);

for (const kr of KR) {
  const krCandles = load(kr.file);
  console.log(`━━ ${kr.label} (${krCandles[0].date} ~ ${krCandles.at(-1)!.date}, ${krCandles.length}건) ━━`);
  console.log("미국지수     갭상관  장중상관  종종상관 |  신호일 장중  대조군 장중   차이   신호수  승률   손익비   MDD");

  for (const us of US) {
    const r = analyzeTransfer({
      krCandles,
      usCandles: load(us.file),
      mode: "skip",
      roundTrip: DEFAULT_ROUND_TRIP,
      window: 250,
      threshold: 0.01,
      horizons: [3, 5, 20, 60],
    });
    const s = r.conditional.signal;
    const c = r.conditional.control;
    console.log(
      `${us.label.padEnd(10)} ${r.corr.gap.toFixed(3).padStart(7)} ` +
        `${r.corr.intraday.toFixed(3).padStart(9)} ${r.corr.closeToClose.toFixed(3).padStart(9)} | ` +
        `${pct(s.mean).padStart(11)} ${pct(c.mean).padStart(12)} ${pct(r.conditional.deltaMean).padStart(8)} ` +
        `${String(s.n).padStart(7)} ${pct(s.winRate).padStart(7)} ${n2(s.payoff).padStart(7)} ${pct(s.mdd).padStart(7)}`
    );

    // 보유 기간별 성과 — 스펙 §4의 단기 3·5일, 중기 20·60일.
    for (const h of r.horizons) {
      const hs = h.comparison.signal;
      const hc = h.comparison.control;
      console.log(
        `  └ ${String(h.days).padStart(2)}일 보유: 신호 ${pct(hs.mean).padStart(8)} ` +
          `대조 ${pct(hc.mean).padStart(8)} 차이 ${pct(h.comparison.deltaMean).padStart(8)} ` +
          `n=${String(hs.n).padStart(5)} 승률 ${pct(hs.winRate).padStart(7)} ` +
          `손익비 ${n2(hs.payoff).padStart(5)} MDD ${pct(hs.mdd).padStart(7)}`
      );
    }

    // 롤링 상관을 연 단위로 요약해 변곡점을 눈으로 찾는다.
    const byYear = new Map<string, number[]>();
    for (const p of r.rolling) {
      const y = p.date.slice(0, 4);
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y)!.push(p.corr);
    }
    const line = [...byYear.entries()]
      .map(([y, xs]) => `${y.slice(2)}:${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2)}`)
      .join(" ");
    console.log(`  롤링(250일) 연평균 장중상관 → ${line}\n`);
  }
}

console.log("읽는 법: 갭상관이 높고 장중상관이 낮으면, 관계는 실재하지만 시초가에 이미 반영돼 매매로는 못 먹는다는 뜻이다.\n");
```

- [ ] **Step 6: 실행해서 결과를 본다**

Run: `npm run backtest:run`
Expected: 코스피·코스닥 각각에 대해 미국 3대지수별 상관과 조건부 성과가 표로 출력된다. 롤링 연평균 상관에서 관계가 바뀐 지점이 보여야 한다.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/backtest/run.ts src/lib/backtest/run.test.ts scripts/backtest-run.ts package.json package-lock.json
git commit -m "feat(backtest): 1단계 분석 조립 + CLI 보고서

갭/장중/종가-종가 상관, 롤링 250일 상관, 조건부 성과 vs 대조군(비용 반영).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013P2fJR2eNjh72WPmca87FV"
```

- [ ] **Step 8: 결과를 스펙에 기록한다**

`docs/superpowers/specs/2026-09-06-us-kr-transfer-design.md` 끝에 "## 12. 1단계 결과" 절을 추가하고, 실제로 나온 상관·조건부 성과·변곡점을 적는다. 2단계 이후의 판단 근거가 된다.

```bash
git add docs/superpowers/specs/2026-09-06-us-kr-transfer-design.md
git commit -m "docs: 1단계 전이 검증 결과 기록

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013P2fJR2eNjh72WPmca87FV"
```

---

## Self-Review 결과

**스펙 커버리지**

| 스펙 절 | 담당 태스크 |
|---|---|
| 1. 측정 대상 (갭·장중·종가) | Task 3, Task 8 |
| 2. 날짜 정렬 + 연휴 3모드 | Task 2 |
| 3. 데이터 적재 (파일·멱등·토큰 캐시) | Task 7 |
| 3. `Candle`에 volume·value | Task 1 |
| 4. 비용 | Task 4 |
| 4. 대조군 | Task 5, Task 8 |
| 4. 구조 변화 롤링 분석 | Task 6, Task 8 |
| 4. 보는 지표 (MDD·손익비·표본수) | Task 5 |
| 8. 파일 구조 | Task 2~8 |
| 9. 테스트 | 각 태스크 Step 1 |

**이 계획이 다루지 않는 것** (스펙 5·6·10·11절 — 의도적으로 2단계 이후)

- 자금 관리(5절)는 종목 매매가 없는 1단계에서는 적용 지점이 없다. 3단계에서 매도 규칙과 함께 들어간다.
- 매도 규칙·추세 필터(6절)도 3단계.
- 점수판 화면(7절)은 5단계.
- 과최적화 방지 기간 분할(4절)은 파라미터가 있는 3단계부터 필요하다. 1단계 전이 계수는 파라미터가 없다.

**타입 일관성 확인**

- `Candle`(Task 1) → Task 3·7·8이 동일 필드명 사용 ✓
- `AlignedDay { krDate, usDates }`(Task 2) → Task 8이 동일 ✓
- `DayReturn { date, gap, intraday, closeToClose }`(Task 3) → Task 8이 동일 ✓
- `Summary`/`Comparison`(Task 5) → Task 8 `conditional` 및 스크립트 출력이 동일 ✓
- `RollingPoint { date, corr, n }`(Task 6) → Task 8이 동일 ✓
- Task 7이 쓰는 JSON 형태 → Task 8 `load()`가 `.candles`를 읽음 ✓
