import { afterEach, describe, expect, it, vi } from "vitest";
import { getKisQuote } from "./kis";

// KIS 국내주식 현재가: 토큰 발급(POST /oauth2/tokenP) 후
// GET /uapi/domestic-stock/v1/quotations/inquire-price. 수치는 문자열로 온다.

const TOKEN_RES = { access_token: "tok-1", expires_in: 86400 };
const QUOTE_RES = {
  rt_cd: "0",
  output: { stck_prpr: "71900", prdy_vrss: "-100", prdy_ctrt: "-0.14" },
};

/** URL에 따라 토큰/시세 응답을 돌려주는 fetch 스텁. */
function stubKisFetch(quoteRes: unknown = QUOTE_RES) {
  const fn = vi.fn().mockImplementation(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/oauth2/tokenP")) {
      return { ok: true, status: 200, json: async () => TOKEN_RES };
    }
    return { ok: true, status: 200, json: async () => quoteRes };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

// 토큰 캐시가 모듈 전역이므로 테스트마다 appKey를 달리해 격리한다.
let seq = 0;
function creds() {
  seq += 1;
  return { appKey: `key-${seq}`, appSecret: "secret" };
}

describe("getKisQuote", () => {
  it("응답을 Quote(KR/KRW)로 변환한다 — 문자열 수치 파싱", async () => {
    stubKisFetch();

    const q = await getKisQuote("005930", creds());

    expect(q).toEqual({
      ticker: "005930",
      market: "KR",
      price: 71900,
      change: -100,
      changePct: -0.14,
      currency: "KRW",
    });
  });

  it("시세 요청에 인증 헤더와 tr_id, 종목코드를 넣는다", async () => {
    const fn = stubKisFetch();
    const c = creds();

    await getKisQuote("005930", c);

    const quoteCall = fn.mock.calls.find(([u]) =>
      String(u).includes("inquire-price")
    )!;
    expect(String(quoteCall[0])).toContain("FID_INPUT_ISCD=005930");
    const headers = (quoteCall[1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers.authorization).toBe("Bearer tok-1");
    expect(headers.appkey).toBe(c.appKey);
    expect(headers.tr_id).toBe("FHKST01010100");
  });

  it("같은 키로 두 번 조회하면 토큰은 한 번만 발급한다", async () => {
    const fn = stubKisFetch();
    const c = creds();

    await getKisQuote("005930", c);
    await getKisQuote("000660", c);

    const tokenCalls = fn.mock.calls.filter(([u]) =>
      String(u).includes("/oauth2/tokenP")
    );
    expect(tokenCalls).toHaveLength(1);
  });

  it("rt_cd가 '0'이 아니면 throw한다", async () => {
    stubKisFetch({ rt_cd: "1", msg1: "유효하지 않은 종목" });

    await expect(getKisQuote("999999", creds())).rejects.toThrow();
  });
});
