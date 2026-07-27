import { afterEach, describe, expect, it, vi } from "vitest";
import { getKisFundamentals } from "./kis";

// KIS 국내주식 현재가(FHKST01010100) 응답에는 시세 외에 펀더멘털도 실려 온다:
// per, pbr, hts_avls(시가총액, 억 원), w52_hgpr(52주 최고가). 모두 문자열.
// 배당수익률·매출성장률은 이 응답에 없다 → undefined.

const TOKEN_RES = { access_token: "tok-f", expires_in: 86400 };

function stubKisFetch(output: Record<string, string>) {
  const fn = vi.fn().mockImplementation(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/oauth2/tokenP")) {
      return { ok: true, status: 200, json: async () => TOKEN_RES };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ rt_cd: "0", output }),
    };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

let seq = 0;
function creds() {
  seq += 1;
  return { appKey: `fkey-${seq}`, appSecret: "secret" };
}

describe("getKisFundamentals", () => {
  it("현재가 응답의 펀더멘털 필드를 변환한다", async () => {
    stubKisFetch({
      stck_prpr: "71900",
      per: "12.50",
      pbr: "1.10",
      hts_avls: "4292122",
      w52_hgpr: "88800",
    });

    const f = await getKisFundamentals("005930", creds());

    expect(f).toEqual({
      ticker: "005930",
      market: "KR",
      marketCap: 4292122,
      per: 12.5,
      pbr: 1.1,
      off52wHigh: -19.03, // (71900/88800 - 1) * 100, 소수 2자리
      dividendYield: undefined,
      revenueGrowth: undefined,
    });
  });

  it("적자 기업의 per '0.00'은 undefined로 남긴다", async () => {
    stubKisFetch({
      stck_prpr: "5000",
      per: "0.00",
      pbr: "0.80",
      hts_avls: "1200",
      w52_hgpr: "9000",
    });

    const f = await getKisFundamentals("123456", creds());

    expect(f.per).toBeUndefined();
    expect(f.pbr).toBe(0.8);
  });

  it("rt_cd가 '0'이 아니면 throw한다", async () => {
    const fn = vi.fn().mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/oauth2/tokenP")) {
        return { ok: true, status: 200, json: async () => TOKEN_RES };
      }
      return { ok: true, status: 200, json: async () => ({ rt_cd: "1" }) };
    });
    vi.stubGlobal("fetch", fn);

    await expect(getKisFundamentals("999999", creds())).rejects.toThrow();
  });
});
