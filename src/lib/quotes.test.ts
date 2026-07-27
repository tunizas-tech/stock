import { afterEach, describe, expect, it, vi } from "vitest";
import { getQuote, getQuotes } from "./quotes";
import { mockQuote } from "./mock-quotes";
import type { Quote } from "./types";

// 클라이언트 시세 어댑터: /api/quotes 프록시를 호출하고, 실패하면 mock으로 폴백.

const SERVER_QUOTE: Quote = {
  ticker: "AAPL",
  market: "US",
  price: 123.45,
  change: 1,
  changePct: 0.82,
  currency: "USD",
};

afterEach(() => vi.unstubAllGlobals());

describe("getQuotes", () => {
  it("/api/quotes에 items를 POST하고 서버 시세를 돌려준다", async () => {
    const fn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ quotes: { "US:AAPL": SERVER_QUOTE } }),
    });
    vi.stubGlobal("fetch", fn);

    const out = await getQuotes([{ ticker: "AAPL", market: "US" }]);

    expect(out["US:AAPL"]).toEqual(SERVER_QUOTE);
    expect(String(fn.mock.calls[0][0])).toContain("/api/quotes");
    const sent = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.items).toEqual([{ ticker: "AAPL", market: "US" }]);
  });

  it("네트워크 실패면 mock으로 폴백한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const out = await getQuotes([{ ticker: "005930", market: "KR" }]);

    expect(out["KR:005930"]).toEqual(mockQuote("005930", "KR"));
  });

  it("서버 오류 응답이어도 mock으로 폴백한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    );

    const out = await getQuotes([{ ticker: "AAPL", market: "US" }]);

    expect(out["US:AAPL"]).toEqual(mockQuote("AAPL", "US"));
  });
});

describe("getQuote", () => {
  it("단일 종목도 같은 경로로 조회한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ quotes: { "US:AAPL": SERVER_QUOTE } }),
      })
    );

    const q = await getQuote("AAPL", "US");

    expect(q).toEqual(SERVER_QUOTE);
  });
});
