import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mode = { value: "local" as "local" | "server" };
vi.mock("./storage-mode", () => ({ detectStorageMode: async () => mode.value }));
const patchMock = vi.fn();
vi.mock("./portfolio-client", () => ({
  fetchHoldings: vi.fn(), postHolding: vi.fn(), deleteHoldingEntry: vi.fn(),
  fetchWatch: vi.fn(), postWatch: vi.fn(), deleteWatchEntry: vi.fn(),
  patchHoldingSector: (...a: unknown[]) => patchMock(...a),
}));

import { db } from "./data";

// node 환경엔 window가 없다 — localStorage 흉내만 낸다.
function fakeWindow() {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  });
  return store;
}

beforeEach(() => { mode.value = "local"; fakeWindow(); });
afterEach(() => { vi.unstubAllGlobals(); patchMock.mockReset(); });

describe("db.setHoldingSector", () => {
  it("로컬 모드: 해당 행의 sector만 바꿔 저장하고, undefined면 키를 지운다", async () => {
    await db.listHoldings(); // 최초 1회 시드 — 실제 화면도 항상 목록을 먼저 읽는다
    const added = await db.addHolding({ market: "KR", ticker: "003850", name: "보령", shares: 1, avgPrice: 1, openedAt: "2026-01-01" });
    const changed = await db.setHoldingSector(added.id, "제약바이오");
    expect(changed.sector).toBe("제약바이오");
    expect((await db.listHoldings()).find((h) => h.id === added.id)?.sector).toBe("제약바이오");
    const reverted = await db.setHoldingSector(added.id, undefined);
    expect("sector" in reverted).toBe(false);
  });
  it("로컬 모드: 없는 id는 throw", async () => {
    await expect(db.setHoldingSector("nope", "기타")).rejects.toThrow();
  });
  it("서버 모드: patchHoldingSector로 위임한다", async () => {
    mode.value = "server";
    patchMock.mockResolvedValue({ id: "h1", sector: "금융" });
    expect(await db.setHoldingSector("h1", "금융")).toEqual({ id: "h1", sector: "금융" });
    expect(patchMock).toHaveBeenCalledWith("h1", "금융");
  });
});
