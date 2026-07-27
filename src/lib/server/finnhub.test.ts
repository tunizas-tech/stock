import { afterEach, describe, expect, it, vi } from "vitest";
import { getFinnhubQuote } from "./finnhub";

// Finnhub /quote 응답: c=현재가, d=전일 대비, dp=전일 대비 %
function stubFetch(json: unknown, ok = true) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 429,
    json: async () => json,
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("getFinnhubQuote", () => {
  it("응답을 Quote(US/USD)로 변환한다", async () => {
    stubFetch({ c: 189.5, d: 2.3, dp: 1.23 });

    const q = await getFinnhubQuote("AAPL", "test-key");

    expect(q).toEqual({
      ticker: "AAPL",
      market: "US",
      price: 189.5,
      change: 2.3,
      changePct: 1.23,
      currency: "USD",
    });
  });

  it("심볼과 키를 쿼리로 넘긴다", async () => {
    const fn = stubFetch({ c: 1, d: 0, dp: 0 });

    await getFinnhubQuote("MSFT", "my-key");

    const url = String(fn.mock.calls[0][0]);
    expect(url).toContain("symbol=MSFT");
    expect(url).toContain("token=my-key");
  });

  it("미지원 심볼(c=0, d=null)이면 throw한다", async () => {
    stubFetch({ c: 0, d: null, dp: null });

    await expect(getFinnhubQuote("NOPE", "k")).rejects.toThrow();
  });

  it("HTTP 오류면 throw한다", async () => {
    stubFetch({}, false);

    await expect(getFinnhubQuote("AAPL", "k")).rejects.toThrow();
  });
});
