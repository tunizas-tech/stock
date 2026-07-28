import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { mockFundamentals } from "@/lib/mock-quotes";

// 펀더멘털 서버 프록시 — /api/quotes와 같은 원칙:
// 키가 있는 시장만 실데이터, 없거나 실패하면 mock 폴백. 종목명은 요청에서 그대로 돌려준다.

function req(body: unknown): Request {
  return new Request("http://localhost/api/fundamentals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/fundamentals", () => {
  it("키가 없으면 mock 펀더멘털을 quoteKey로 돌려준다", async () => {
    vi.stubEnv("KIS_APP_KEY", "");
    vi.stubEnv("KIS_APP_SECRET", "");
    vi.stubEnv("FINNHUB_API_KEY", "");

    const res = await POST(
      req({ items: [{ ticker: "005930", market: "KR", name: "삼성전자" }] })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.fundamentals["KR:005930"]).toEqual(
      mockFundamentals("005930", "KR", "삼성전자")
    );
  });

  it("FINNHUB_API_KEY가 있으면 US는 실데이터를 쓰고 name을 합친다", async () => {
    vi.stubEnv("FINNHUB_API_KEY", "fh-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: unknown) => {
        const url = String(input);
        if (url.includes("/stock/metric")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              metric: { peTTM: 29.8, "52WeekHigh": 100 },
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ c: 90 }) };
      })
    );

    const res = await POST(
      req({ items: [{ ticker: "AAPL", market: "US", name: "Apple" }] })
    );
    const body = await res.json();

    expect(body.fundamentals["US:AAPL"].per).toBe(29.8);
    expect(body.fundamentals["US:AAPL"].off52wHigh).toBe(-10);
    expect(body.fundamentals["US:AAPL"].name).toBe("Apple");
    // 실데이터에는 mock 표시가 붙지 않는다
    expect(body.fundamentals["US:AAPL"].isMock).toBeUndefined();
  });

  // 폴백이 조용히 일어나면 화면의 PER·PBR을 실데이터로 오인하게 된다.
  it("mock 폴백에는 isMock 표시가 붙는다", async () => {
    vi.stubEnv("FINNHUB_API_KEY", "fh-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) })
    );

    const res = await POST(
      req({ items: [{ ticker: "AAPL", market: "US", name: "Apple" }] })
    );
    const body = await res.json();

    expect(body.fundamentals["US:AAPL"].isMock).toBe(true);
  });

  it("실데이터 조회가 실패한 종목은 mock으로 폴백한다", async () => {
    vi.stubEnv("FINNHUB_API_KEY", "fh-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) })
    );

    const res = await POST(
      req({ items: [{ ticker: "AAPL", market: "US", name: "Apple" }] })
    );
    const body = await res.json();

    expect(body.fundamentals["US:AAPL"]).toEqual(
      mockFundamentals("AAPL", "US", "Apple")
    );
  });

  it("잘못된 본문이면 400을 돌려준다", async () => {
    const res = await POST(req({ nope: true }));
    expect(res.status).toBe(400);
  });
});
