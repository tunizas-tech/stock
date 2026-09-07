import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  isSealed,
  loadSettings,
  saveSettings,
  sealBaseDate,
  sealOpensOn,
} from "./settings";

// 가짜 localStorage — Map 하나로 window.localStorage의 get/set만 흉내낸다.
// vitest 기본 환경이 "node"라 window 자체가 없다(SSR과 같은 조건) — 그래서
// SSR-safe 테스트는 아무것도 스텁하지 않은 기본 상태로 충분하다.
function fakeWindow() {
  const store = new Map<string, string>();
  return {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadSettings/saveSettings — SSR-safe, localStorage 전용(기기별)", () => {
  it("window가 없으면(SSR) 기본값을 돌려준다", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("저장한 값을 그대로 불러온다", () => {
    vi.stubGlobal("window", fakeWindow());
    saveSettings({ sealDays: 30, stopLossPct: 0.08 });
    expect(loadSettings()).toEqual({ sealDays: 30, stopLossPct: 0.08 });
  });

  it("아무것도 저장한 적 없으면 기본값(180일)을 돌려준다", () => {
    vi.stubGlobal("window", fakeWindow());
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("손상된 값이 저장돼 있어도 크래시 없이 기본값으로 떨어진다", () => {
    const w = fakeWindow();
    w.localStorage.setItem("ssn.journal.settings", "{ 이건 JSON이 아니다");
    vi.stubGlobal("window", w);
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("sealOpensOn — 첫 기록일 + sealDays", () => {
  it("첫 기록일이 없으면 undefined(아직 봉인할 기록 자체가 없다)", () => {
    expect(sealOpensOn(undefined, 180)).toBeUndefined();
  });

  it("180일 뒤 날짜를 계산한다", () => {
    expect(sealOpensOn("2026-01-01", 180)).toBe("2026-06-30");
  });
});

describe("sealBaseDate — 봉인 기준일은 거래일이 아니라 기록 시점(createdAt)", () => {
  it("createdAt이 있는 기록들의 최솟값(날짜 부분)을 낸다", () => {
    const base = sealBaseDate([
      { createdAt: "2026-03-05T11:20:00.000Z" },
      { createdAt: "2026-01-02T23:59:59.000Z" },
      { createdAt: "2026-02-01T00:00:00.000Z" },
    ]);
    expect(base).toBe("2026-01-02");
  });

  it("createdAt이 없는 기록은 무시한다 — 있는 것들 중에서만 고른다", () => {
    const base = sealBaseDate([{}, { createdAt: "2026-04-01T00:00:00.000Z" }, {}]);
    expect(base).toBe("2026-04-01");
  });

  it("createdAt이 있는 기록이 하나도 없으면 undefined(아직 시작 안 함)", () => {
    expect(sealBaseDate([{}, {}])).toBeUndefined();
    expect(sealBaseDate([])).toBeUndefined();
  });

  it("형식이 깨진 createdAt은 기준일로 쓰지 않는다", () => {
    expect(sealBaseDate([{ createdAt: "어제" }])).toBeUndefined();
  });
});

describe("isSealed — 경계값(179일째 봉인, 180일째 해제), createdAt 기준", () => {
  // 기준일은 "기록을 남긴 시점"이다 — date(거래일)를 기준으로 하면 2년 전
  // 날짜로 기록 하나만 백필해도 봉인이 즉시 열린다(설계 §4의 "기록을 남긴 뒤
  // N일"이 무의미해진다).
  const entries = [{ createdAt: "2026-01-01T09:00:00.000Z" }]; // sealOpensOn = 2026-06-30
  const base = sealBaseDate(entries);

  it("179일째(오픈 하루 전)는 봉인 상태다", () => {
    expect(isSealed(base, 180, "2026-06-29")).toBe(true);
  });

  it("180일째(오픈 당일)는 봉인이 풀린다", () => {
    expect(isSealed(base, 180, "2026-06-30")).toBe(false);
  });

  it("거래일(date)이 2년 전이어도 오늘 기록했으면 봉인이 오늘부터 시작한다", () => {
    // date는 2024-01-01이지만 createdAt은 오늘 — 백필로는 봉인을 못 연다.
    const backfilled = sealBaseDate([{ createdAt: "2026-09-07T01:00:00.000Z" }]);
    expect(backfilled).toBe("2026-09-07");
    expect(isSealed(backfilled, 180, "2026-09-07")).toBe(true);
  });

  it("sealDays: 0이면 언제든 봉인되지 않는다", () => {
    expect(isSealed(base, 0, "2026-01-01")).toBe(false);
    // createdAt이 하나도 없는 옛 일지도 0으로 설정하면 바로 열 수 있다(탈출구).
    expect(isSealed(undefined, 0, "2026-06-30")).toBe(false);
  });

  it("createdAt이 있는 기록이 하나도 없으면 봉인 상태로 둔다(아직 시작 안 함)", () => {
    // 열어주면 date만 있는 옛 기록·백필로 봉인을 우회할 수 있다. 봉인을 유지하고
    // 화면은 "첫 기록을 남기면 그날부터 봉인이 시작됩니다"를 보여준다.
    expect(isSealed(undefined, 180, "2026-06-30")).toBe(true);
  });
});
