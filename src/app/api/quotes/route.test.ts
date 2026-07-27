import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { mockQuote } from "@/lib/mock-quotes";

// 서버 프록시(디자인 §5.2-4): 키가 있는 시장만 실시세, 없거나 실패하면 mock 폴백.

function req(body: unknown): Request {
  return new Request("http://localhost/api/quotes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/quotes", () => {
  it("키가 없으면 mock 시세를 quoteKey로 돌려준다", async () => {
    vi.stubEnv("KIS_APP_KEY", "");
    vi.stubEnv("KIS_APP_SECRET", "");
    vi.stubEnv("FINNHUB_API_KEY", "");

    const res = await POST(
      req({ items: [{ ticker: "005930", market: "KR" }] })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.quotes["KR:005930"]).toEqual(mockQuote("005930", "KR"));
  });

  it("FINNHUB_API_KEY가 있으면 US는 Finnhub 실시세를 쓴다", async () => {
    vi.stubEnv("FINNHUB_API_KEY", "fh-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ c: 200.5, d: 1.5, dp: 0.75 }),
      })
    );

    const res = await POST(req({ items: [{ ticker: "AAPL", market: "US" }] }));
    const body = await res.json();

    expect(body.quotes["US:AAPL"]).toEqual({
      ticker: "AAPL",
      market: "US",
      price: 200.5,
      change: 1.5,
      changePct: 0.75,
      currency: "USD",
    });
  });

  it("KIS 키가 있으면 KR은 KIS 실시세를 쓴다", async () => {
    vi.stubEnv("KIS_APP_KEY", "route-test-kis-key");
    vi.stubEnv("KIS_APP_SECRET", "s");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: unknown) => {
        const url = String(input);
        if (url.includes("/oauth2/tokenP")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ access_token: "t", expires_in: 86400 }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            rt_cd: "0",
            output: { stck_prpr: "71900", prdy_vrss: "-100", prdy_ctrt: "-0.14" },
          }),
        };
      })
    );

    const res = await POST(
      req({ items: [{ ticker: "005930", market: "KR" }] })
    );
    const body = await res.json();

    expect(body.quotes["KR:005930"].price).toBe(71900);
  });

  it("실시세 조회가 실패한 종목은 mock으로 폴백한다", async () => {
    vi.stubEnv("FINNHUB_API_KEY", "fh-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) })
    );

    const res = await POST(req({ items: [{ ticker: "AAPL", market: "US" }] }));
    const body = await res.json();

    expect(body.quotes["US:AAPL"]).toEqual(mockQuote("AAPL", "US"));
  });

  it("잘못된 본문이면 400을 돌려준다", async () => {
    const res = await POST(req({ nope: true }));
    expect(res.status).toBe(400);
  });
});
