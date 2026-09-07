import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHoldings, postWatch } from "./portfolio-client";

afterEach(() => vi.restoreAllMocks());

describe("portfolio-client", () => {
  it("fetchHoldings는 holdings를 꺼낸다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ holdings: [{ id: "h" }] }), { status: 200 })));
    expect(await fetchHoldings()).toEqual([{ id: "h" }]);
  });
  it("실패는 field: error 메시지로 던진다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "YYYY-MM-DD", field: "addedAt" }), { status: 400 })));
    await expect(postWatch({} as never)).rejects.toThrow(/addedAt: YYYY-MM-DD/);
  });
});
