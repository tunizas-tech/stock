import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { mockCandles } from "@/lib/mock-candles";
import { mockQuote } from "@/lib/mock-quotes";
import { todayISO } from "@/lib/format";

// 캔들 서버 프록시 — 시세·펀더멘털과 같은 원칙: KIS 키가 있으면 실데이터, 없거나 실패하면 mock.
// GET /api/candles?kind=stock|index&market=KR|US&code=...&period=D|W|M

function req(qs: string): Request {
  return new Request(`http://localhost/api/candles?${qs}`);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /api/candles", () => {
  it("키가 없으면 mock 캔들을 돌려준다 (종목: mock 시세 앵커)", async () => {
    vi.stubEnv("KIS_APP_KEY", "");
    vi.stubEnv("KIS_APP_SECRET", "");

    const res = await GET(req("kind=stock&market=US&code=AAPL&period=D"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.candles).toEqual(
      mockCandles("US:AAPL", "D", todayISO(), mockQuote("AAPL", "US").price)
    );
  });

  it("KIS 키가 있으면 국내 종목은 실데이터를 쓴다", async () => {
    vi.stubEnv("KIS_APP_KEY", "candle-kis-key-1");
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
            output2: [
              { stck_bsop_date: "20260715", stck_oprc: "71000", stck_hgpr: "72500", stck_lwpr: "70800", stck_clpr: "71900" },
            ],
          }),
        };
      })
    );

    const res = await GET(req("kind=stock&market=KR&code=005930&period=D"));
    const body = await res.json();

    expect(body.candles).toEqual([
      { date: "2026-07-15", open: 71000, high: 72500, low: 70800, close: 71900 },
    ]);
  });

  it("지수도 같은 경로로 조회한다 (KR 지수 → 지수 차트 API)", async () => {
    vi.stubEnv("KIS_APP_KEY", "candle-kis-key-2");
    vi.stubEnv("KIS_APP_SECRET", "s");
    const fn = vi.fn().mockImplementation(async (input: unknown) => {
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
          output2: [
            { stck_bsop_date: "20260715", bstp_nmix_oprc: "2690.10", bstp_nmix_hgpr: "2710.55", bstp_nmix_lwpr: "2685.00", bstp_nmix_prpr: "2705.42" },
          ],
        }),
      };
    });
    vi.stubGlobal("fetch", fn);

    const res = await GET(req("kind=index&market=KR&code=0001&period=W"));
    const body = await res.json();

    expect(body.candles[0].close).toBe(2705.42);
    expect(
      fn.mock.calls.some(([u]) => String(u).includes("indexchartprice"))
    ).toBe(true);
  });

  it("실데이터 조회가 실패하면 mock으로 폴백한다", async () => {
    vi.stubEnv("KIS_APP_KEY", "candle-kis-key-3");
    vi.stubEnv("KIS_APP_SECRET", "s");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    );

    const res = await GET(req("kind=index&market=US&code=SPX&period=M"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.candles).toHaveLength(60); // 월봉 mock 개수
  });

  it("잘못된 파라미터면 400을 돌려준다", async () => {
    expect((await GET(req("kind=stock&market=KR&period=D"))).status).toBe(400); // code 없음
    expect(
      (await GET(req("kind=stock&market=KR&code=005930&period=X"))).status
    ).toBe(400);
    expect(
      (await GET(req("kind=nope&market=KR&code=005930&period=D"))).status
    ).toBe(400);
  });
});
