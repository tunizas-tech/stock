import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getKisStockCandles,
  getKisIndexCandles,
  getKisOverseasStockCandles,
  getKisOverseasIndexCandles,
} from "./kis";

// KIS 기간별시세 4종. 응답은 모두 최신순(output2) — 어댑터는 오름차순 Candle[]로 뒤집는다.
// 국내주식 FHKST03010100 · 국내지수 FHKUP03500100 · 해외주식 HHDFS76240000 · 해외지수 FHKST03030100

const TOKEN_RES = { access_token: "tok-c", expires_in: 86400 };

function stubFetch(handler: (url: string) => unknown) {
  const fn = vi.fn().mockImplementation(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/oauth2/tokenP")) {
      return { ok: true, status: 200, json: async () => TOKEN_RES };
    }
    return { ok: true, status: 200, json: async () => handler(url) };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

let seq = 0;
function creds() {
  seq += 1;
  return { appKey: `ckey-${seq}`, appSecret: "secret" };
}

const END = "20260715";

describe("getKisStockCandles (국내주식)", () => {
  it("output2(최신순)를 오름차순 Candle[]로 변환한다", async () => {
    const fn = stubFetch(() => ({
      rt_cd: "0",
      output2: [
        { stck_bsop_date: "20260715", stck_oprc: "71000", stck_hgpr: "72500", stck_lwpr: "70800", stck_clpr: "71900" },
        { stck_bsop_date: "20260714", stck_oprc: "70500", stck_hgpr: "71200", stck_lwpr: "70100", stck_clpr: "71000" },
      ],
    }));

    const candles = await getKisStockCandles("005930", "D", creds(), END);

    expect(candles).toEqual([
      { date: "2026-07-14", open: 70500, high: 71200, low: 70100, close: 71000 },
      { date: "2026-07-15", open: 71000, high: 72500, low: 70800, close: 71900 },
    ]);
    const url = String(
      fn.mock.calls.find(([u]) => String(u).includes("itemchartprice"))![0]
    );
    expect(url).toContain("FID_INPUT_ISCD=005930");
    expect(url).toContain("FID_PERIOD_DIV_CODE=D");
    expect(url).toContain("FID_INPUT_DATE_2=20260715");
  });

  it("tr_id는 FHKST03010100이다", async () => {
    const fn = stubFetch(() => ({ rt_cd: "0", output2: [] }));

    await getKisStockCandles("005930", "W", creds(), END);

    const call = fn.mock.calls.find(([u]) =>
      String(u).includes("itemchartprice")
    )!;
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers.tr_id).toBe("FHKST03010100");
  });
});

describe("getKisIndexCandles (국내지수)", () => {
  it("bstp_nmix_* 필드를 파싱하고 지수 코드로 조회한다", async () => {
    const fn = stubFetch(() => ({
      rt_cd: "0",
      output2: [
        { stck_bsop_date: "20260715", bstp_nmix_oprc: "2690.10", bstp_nmix_hgpr: "2710.55", bstp_nmix_lwpr: "2685.00", bstp_nmix_prpr: "2705.42" },
      ],
    }));

    const candles = await getKisIndexCandles("0001", "M", creds(), END);

    expect(candles).toEqual([
      { date: "2026-07-15", open: 2690.1, high: 2710.55, low: 2685, close: 2705.42 },
    ]);
    const call = fn.mock.calls.find(([u]) =>
      String(u).includes("indexchartprice")
    )!;
    expect(String(call[0])).toContain("FID_INPUT_ISCD=0001");
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers.tr_id).toBe("FHKUP03500100");
  });
});

describe("getKisOverseasStockCandles (해외주식)", () => {
  it("xymd/open/high/low/clos를 파싱하고 주기를 GUBN으로 넘긴다", async () => {
    const fn = stubFetch(() => ({
      rt_cd: "0",
      output2: [
        { xymd: "20260715", open: "208.1", high: "212.4", low: "207.0", clos: "211.2" },
        { xymd: "20260714", open: "205.0", high: "209.0", low: "204.2", clos: "208.1" },
      ],
    }));

    const candles = await getKisOverseasStockCandles("AAPL", "W", creds());

    expect(candles[0].date).toBe("2026-07-14");
    expect(candles[1]).toEqual({
      date: "2026-07-15",
      open: 208.1,
      high: 212.4,
      low: 207,
      close: 211.2,
    });
    const url = String(
      fn.mock.calls.find(([u]) => String(u).includes("dailyprice"))![0]
    );
    expect(url).toContain("SYMB=AAPL");
    expect(url).toContain("GUBN=1"); // D=0, W=1, M=2
    expect(url).toContain("EXCD=NAS");
  });

  it("NAS에 없으면 NYS로 폴백한다", async () => {
    const fn = stubFetch((url) => {
      if (url.includes("EXCD=NAS")) return { rt_cd: "0", output2: [] };
      return {
        rt_cd: "0",
        output2: [
          { xymd: "20260715", open: "1", high: "2", low: "0.5", clos: "1.5" },
        ],
      };
    });

    const candles = await getKisOverseasStockCandles("KO", "D", creds());

    expect(candles).toHaveLength(1);
    const urls = fn.mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes("EXCD=NAS"))).toBe(true);
    expect(urls.some((u) => u.includes("EXCD=NYS"))).toBe(true);
  });
});

describe("getKisOverseasIndexCandles (해외지수)", () => {
  it("ovrs_nmix_* 필드를 파싱하고 지수 구분(N)으로 조회한다", async () => {
    const fn = stubFetch(() => ({
      rt_cd: "0",
      output2: [
        { stck_bsop_date: "20260715", ovrs_nmix_oprc: "5580.20", ovrs_nmix_hgpr: "5612.00", ovrs_nmix_lwpr: "5570.10", ovrs_nmix_prpr: "5605.87" },
      ],
    }));

    const candles = await getKisOverseasIndexCandles("SPX", "D", creds(), END);

    expect(candles).toEqual([
      { date: "2026-07-15", open: 5580.2, high: 5612, low: 5570.1, close: 5605.87 },
    ]);
    const call = fn.mock.calls.find(([u]) =>
      String(u).includes("inquire-daily-chartprice")
    )!;
    expect(String(call[0])).toContain("FID_COND_MRKT_DIV_CODE=N");
    expect(String(call[0])).toContain("FID_INPUT_ISCD=SPX");
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers.tr_id).toBe("FHKST03030100");
  });
});
