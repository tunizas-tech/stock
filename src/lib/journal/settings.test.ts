import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  isSealed,
  loadSettings,
  saveSettings,
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

describe("isSealed — 경계값(179일째 봉인, 180일째 해제)", () => {
  const firstEntryDate = "2026-01-01"; // sealOpensOn = 2026-06-30

  it("179일째(오픈 하루 전)는 봉인 상태다", () => {
    expect(isSealed(firstEntryDate, 180, "2026-06-29")).toBe(true);
  });

  it("180일째(오픈 당일)는 봉인이 풀린다", () => {
    expect(isSealed(firstEntryDate, 180, "2026-06-30")).toBe(false);
  });

  it("sealDays: 0이면 언제든 봉인되지 않는다", () => {
    expect(isSealed(firstEntryDate, 0, "2026-01-01")).toBe(false);
  });

  it("첫 기록이 없으면(아직 기록 자체가 없음) 봉인되지 않는다", () => {
    expect(isSealed(undefined, 180, "2026-06-30")).toBe(false);
  });
});
