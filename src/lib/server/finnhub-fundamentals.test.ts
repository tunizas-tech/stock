import { afterEach, describe, expect, it, vi } from "vitest";
import { getFinnhubFundamentals } from "./finnhub";

// Finnhub 펀더멘털: GET /stock/metric (metric=all) + GET /quote (52주 고가 대비 계산용).
// marketCapitalization은 백만 달러 단위. 없는 지표는 null → undefined로.

function stubFetch(metric: Record<string, unknown>, quote = { c: 90 }) {
  const fn = vi.fn().mockImplementation(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/stock/metric")) {
      return { ok: true, status: 200, json: async () => ({ metric }) };
    }
    return { ok: true, status: 200, json: async () => quote };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("getFinnhubFundamentals", () => {
  it("metric + quote 응답을 펀더멘털로 변환한다", async () => {
    stubFetch(
      {
        marketCapitalization: 2900000,
        peTTM: 29.8,
        pbAnnual: 45.2,
        currentDividendYieldTTM: 0.5,
        revenueGrowthTTMYoy: 8.1,
        "52WeekHigh": 100,
      },
      { c: 90 }
    );

    const f = await getFinnhubFundamentals("AAPL", "k");

    expect(f).toEqual({
      ticker: "AAPL",
      market: "US",
      marketCap: 2900000,
      per: 29.8,
      pbr: 45.2,
      dividendYield: 0.5,
      revenueGrowth: 8.1,
      off52wHigh: -10, // (90/100 - 1) * 100
    });
  });

  it("없는 지표는 undefined로 남긴다", async () => {
    stubFetch({ peTTM: 10 }, { c: 50 });

    const f = await getFinnhubFundamentals("XYZ", "k");

    expect(f.per).toBe(10);
    expect(f.pbr).toBeUndefined();
    expect(f.dividendYield).toBeUndefined();
    expect(f.off52wHigh).toBeUndefined(); // 52주 고가 없음 → 계산 불가
  });

  it("HTTP 오류면 throw한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) })
    );

    await expect(getFinnhubFundamentals("AAPL", "k")).rejects.toThrow();
  });
});
