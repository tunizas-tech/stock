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

  // I-2: 캐시하는 것은 "답"이지 "실패"가 아니다. 재배포·콜드스타트로 프로브가 한 번
  // 실패했다고 그 세션 내내 localStorage에 갇히면, 그 뒤의 기록이 전부 브라우저에만
  // 남고(서버엔 없다) 사용자는 아무 신호도 못 받는다.
  it("한 번 실패해도 캐시하지 않고 다음 호출에서 다시 물어본다", async () => {
    const f = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ mode: "server" }), { status: 200 }));
    expect(await detectStorageMode(f as unknown as typeof fetch)).toBe("local");
    expect(await detectStorageMode(f as unknown as typeof fetch)).toBe("server");
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("200 {mode:'local'}은 답이므로 캐시한다 — 한 번만 부른다", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ mode: "local" }), { status: 200 }));
    expect(await detectStorageMode(f as unknown as typeof fetch)).toBe("local");
    expect(await detectStorageMode(f as unknown as typeof fetch)).toBe("local");
    expect(f).toHaveBeenCalledTimes(1);
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
