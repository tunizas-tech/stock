import { afterEach, describe, expect, it, vi } from "vitest";
import { getFundamentals } from "./fundamentals";
import { mockFundamentals } from "./mock-quotes";

// 클라이언트 펀더멘털 어댑터: /api/fundamentals 프록시 호출, 실패 시 mock 폴백 (quotes.ts와 동일 원칙).

const ITEM = { ticker: "AAPL", market: "US" as const, name: "Apple" };

afterEach(() => vi.unstubAllGlobals());

describe("getFundamentals", () => {
  it("/api/fundamentals에 items를 POST하고 서버 응답을 돌려준다", async () => {
    const server = { ...mockFundamentals("AAPL", "US", "Apple"), per: 99 };
    const fn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ fundamentals: { "US:AAPL": server } }),
    });
    vi.stubGlobal("fetch", fn);

    const out = await getFundamentals([ITEM]);

    expect(out["US:AAPL"]).toEqual(server);
    expect(String(fn.mock.calls[0][0])).toContain("/api/fundamentals");
  });

  it("네트워크 실패면 mock으로 폴백한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const out = await getFundamentals([ITEM]);

    expect(out["US:AAPL"]).toEqual(mockFundamentals("AAPL", "US", "Apple"));
  });
});
