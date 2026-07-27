import { afterEach, describe, expect, it, vi } from "vitest";
import { getCandles } from "./candles";
import { mockCandles } from "./mock-candles";
import { mockQuote } from "./mock-quotes";
import { todayISO } from "./format";

// 클라이언트 캔들 어댑터: /api/candles 프록시 호출, 실패 시 mock 폴백 (quotes.ts와 동일 원칙).

afterEach(() => vi.unstubAllGlobals());

describe("getCandles", () => {
  it("/api/candles를 쿼리 파라미터로 호출하고 응답을 돌려준다", async () => {
    const server = [
      { date: "2026-07-15", open: 1, high: 2, low: 0.5, close: 1.5 },
    ];
    const fn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candles: server }),
    });
    vi.stubGlobal("fetch", fn);

    const out = await getCandles({
      kind: "index",
      market: "KR",
      code: "0001",
      period: "W",
    });

    expect(out).toEqual(server);
    const url = String(fn.mock.calls[0][0]);
    expect(url).toContain("/api/candles?");
    expect(url).toContain("kind=index");
    expect(url).toContain("code=0001");
    expect(url).toContain("period=W");
  });

  it("네트워크 실패면 mock으로 폴백한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const out = await getCandles({
      kind: "stock",
      market: "US",
      code: "AAPL",
      period: "D",
    });

    expect(out).toEqual(
      mockCandles("US:AAPL", "D", todayISO(), mockQuote("AAPL", "US").price)
    );
  });
});
