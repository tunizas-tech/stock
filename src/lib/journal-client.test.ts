import { afterEach, describe, expect, it, vi } from "vitest";
import { detectStorageMode, resetStorageModeForTests } from "./storage-mode";
import { fetchJournal, postJournal } from "./journal-client";

afterEach(() => {
  resetStorageModeForTests();
  vi.restoreAllMocks();
});

describe("detectStorageMode", () => {
  it("/api/journal/mode가 200이면 server, 한 번만 부른다", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ mode: "server" }), { status: 200 }));
    expect(await detectStorageMode(f as unknown as typeof fetch)).toBe("server");
    expect(await detectStorageMode(f as unknown as typeof fetch)).toBe("server");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("503이면 local", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 503 }));
    expect(await detectStorageMode(f as unknown as typeof fetch)).toBe("local");
  });
  it("네트워크 예외도 local", async () => {
    const f = vi.fn(async () => {
      throw new Error("down");
    });
    expect(await detectStorageMode(f as unknown as typeof fetch)).toBe("local");
  });
});

describe("journal-client", () => {
  it("fetchJournal은 entries를 꺼낸다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ entries: [{ id: "a" }] }), { status: 200 })));
    expect(await fetchJournal()).toEqual([{ id: "a" }]);
  });
  it("postJournal은 201 본문을 돌려주고 실패면 throw", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "x", field: "emotion" }), { status: 400 })));
    await expect(postJournal({} as never)).rejects.toThrow(/emotion/);
  });
});
