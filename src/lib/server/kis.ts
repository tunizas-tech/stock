// KIS Developers 국내주식 시세·펀더멘털 어댑터 (서버 전용 — 앱키/시크릿을 다루므로 클라이언트 import 금지).
// 토큰 발급(POST /oauth2/tokenP)은 유량 제한이 있어 모듈 전역으로 캐시한다(PRD §12).
// 현재가: GET /uapi/domestic-stock/v1/quotations/inquire-price (tr_id FHKST01010100).
// 이 응답에 per/pbr/hts_avls(시가총액, 억 원)/w52_hgpr(52주 최고가)도 실려 온다.
// 기간별시세(일/주/월봉) 4종: 국내주식 FHKST03010100 · 국내지수 FHKUP03500100
// · 해외주식 HHDFS76240000 · 해외지수 FHKST03030100. 응답 output2는 최신순 → 오름차순으로 뒤집는다.

import type { Candle, Fundamentals, Period, Quote } from "../types";

const BASE = "https://openapi.koreainvestment.com:9443";

export interface KisCredentials {
  appKey: string;
  appSecret: string;
}

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

const tokenCache = new Map<string, CachedToken>();

async function getToken({ appKey, appSecret }: KisCredentials): Promise<string> {
  const cached = tokenCache.get(appKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const res = await fetch(`${BASE}/oauth2/tokenP`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: appKey,
      appsecret: appSecret,
    }),
  });
  if (!res.ok) throw new Error(`KIS 토큰 발급 실패 HTTP ${res.status}`);
  const body = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  tokenCache.set(appKey, {
    token: body.access_token,
    // 만료 60초 전까지만 사용
    expiresAt: Date.now() + (body.expires_in - 60) * 1000,
  });
  return body.access_token;
}

/** 현재가 조회 공통 — 시세와 펀더멘털이 같은 응답을 쓴다. */
async function fetchInquirePrice(
  ticker: string,
  creds: KisCredentials
): Promise<Record<string, string>> {
  const token = await getToken(creds);
  const url =
    `${BASE}/uapi/domestic-stock/v1/quotations/inquire-price` +
    `?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${encodeURIComponent(ticker)}`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      appkey: creds.appKey,
      appsecret: creds.appSecret,
      tr_id: "FHKST01010100",
    },
  });
  if (!res.ok) throw new Error(`KIS HTTP ${res.status} (${ticker})`);
  const body = (await res.json()) as {
    rt_cd: string;
    msg1?: string;
    output?: Record<string, string>;
  };
  if (body.rt_cd !== "0" || !body.output) {
    throw new Error(`KIS 조회 실패 (${ticker}): ${body.msg1 ?? body.rt_cd}`);
  }
  return body.output;
}

export async function getKisQuote(
  ticker: string,
  creds: KisCredentials
): Promise<Quote> {
  const output = await fetchInquirePrice(ticker, creds);
  return {
    ticker,
    market: "KR",
    price: Number(output.stck_prpr),
    change: Number(output.prdy_vrss),
    changePct: Number(output.prdy_ctrt),
    currency: "KRW",
  };
}

/** 문자열 수치 → number. 비어 있거나 숫자가 아니면 undefined. */
function num(v: string | undefined): number | undefined {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

/** KIS 공통 GET — 토큰·헤더·rt_cd 검사. */
async function kisGet(
  path: string,
  query: string,
  trId: string,
  creds: KisCredentials
): Promise<Record<string, unknown>> {
  const token = await getToken(creds);
  const res = await fetch(`${BASE}${path}?${query}`, {
    headers: {
      authorization: `Bearer ${token}`,
      appkey: creds.appKey,
      appsecret: creds.appSecret,
      tr_id: trId,
    },
  });
  if (!res.ok) throw new Error(`KIS HTTP ${res.status} (${path})`);
  const body = (await res.json()) as Record<string, unknown> & {
    rt_cd: string;
    msg1?: string;
  };
  if (body.rt_cd !== "0") {
    throw new Error(`KIS 조회 실패 (${path}): ${body.msg1 ?? body.rt_cd}`);
  }
  return body;
}

/** "20260715" → "2026-07-15" */
function isoDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/** 주기별로 넉넉한 조회 시작일(YYYYMMDD) — KIS는 최대 100봉 내외를 돌려준다. */
function startDateFor(end: string, period: Period): string {
  const d = new Date(
    `${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6, 8)}T00:00:00Z`
  );
  const monthsBack = period === "D" ? 6 : period === "W" ? 30 : 96;
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - monthsBack);
  return d.toISOString().slice(0, 10).replaceAll("-", "");
}

type ChartRow = Record<string, string>;

/** output2(최신순) → 오름차순 Candle[]. 필드명은 API마다 달라 매핑을 받는다. */
function toCandles(
  rows: ChartRow[],
  f: { date: string; open: string; high: string; low: string; close: string }
): Candle[] {
  return rows
    .filter((r) => r[f.date])
    .map((r) => ({
      date: isoDate(r[f.date]),
      open: Number(r[f.open]),
      high: Number(r[f.high]),
      low: Number(r[f.low]),
      close: Number(r[f.close]),
    }))
    .reverse();
}

/** 국내주식 일/주/월봉. end는 YYYYMMDD. */
export async function getKisStockCandles(
  ticker: string,
  period: Period,
  creds: KisCredentials,
  end: string
): Promise<Candle[]> {
  const body = await kisGet(
    "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
    `FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${encodeURIComponent(ticker)}` +
      `&FID_INPUT_DATE_1=${startDateFor(end, period)}&FID_INPUT_DATE_2=${end}` +
      `&FID_PERIOD_DIV_CODE=${period}&FID_ORG_ADJ_PRC=0`,
    "FHKST03010100",
    creds
  );
  return toCandles((body.output2 as ChartRow[]) ?? [], {
    date: "stck_bsop_date",
    open: "stck_oprc",
    high: "stck_hgpr",
    low: "stck_lwpr",
    close: "stck_clpr",
  });
}

/** 국내지수 일/주/월봉. code: 코스피 0001, 코스닥 1001. */
export async function getKisIndexCandles(
  code: string,
  period: Period,
  creds: KisCredentials,
  end: string
): Promise<Candle[]> {
  const body = await kisGet(
    "/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice",
    `FID_COND_MRKT_DIV_CODE=U&FID_INPUT_ISCD=${encodeURIComponent(code)}` +
      `&FID_INPUT_DATE_1=${startDateFor(end, period)}&FID_INPUT_DATE_2=${end}` +
      `&FID_PERIOD_DIV_CODE=${period}`,
    "FHKUP03500100",
    creds
  );
  return toCandles((body.output2 as ChartRow[]) ?? [], {
    date: "stck_bsop_date",
    open: "bstp_nmix_oprc",
    high: "bstp_nmix_hgpr",
    low: "bstp_nmix_lwpr",
    close: "bstp_nmix_prpr",
  });
}

/** 해외주식 일/주/월봉. 거래소를 모르므로 NAS → NYS → AMS 순으로 폴백. */
export async function getKisOverseasStockCandles(
  ticker: string,
  period: Period,
  creds: KisCredentials
): Promise<Candle[]> {
  const gubn = period === "D" ? "0" : period === "W" ? "1" : "2";
  for (const excd of ["NAS", "NYS", "AMS"]) {
    const body = await kisGet(
      "/uapi/overseas-price/v1/quotations/dailyprice",
      `AUTH=&EXCD=${excd}&SYMB=${encodeURIComponent(ticker)}` +
        `&GUBN=${gubn}&BYMD=&MODP=1`,
      "HHDFS76240000",
      creds
    );
    const rows = (body.output2 as ChartRow[]) ?? [];
    if (rows.length > 0) {
      return toCandles(rows, {
        date: "xymd",
        open: "open",
        high: "high",
        low: "low",
        close: "clos",
      });
    }
  }
  throw new Error(`KIS 해외주식 기간별시세 없음 (${ticker})`);
}

/** 해외지수 일/주/월봉. code: S&P500 SPX, 나스닥종합 COMP, 다우 .DJI. */
export async function getKisOverseasIndexCandles(
  code: string,
  period: Period,
  creds: KisCredentials,
  end: string
): Promise<Candle[]> {
  const body = await kisGet(
    "/uapi/overseas-price/v1/quotations/inquire-daily-chartprice",
    `FID_COND_MRKT_DIV_CODE=N&FID_INPUT_ISCD=${encodeURIComponent(code)}` +
      `&FID_INPUT_DATE_1=${startDateFor(end, period)}&FID_INPUT_DATE_2=${end}` +
      `&FID_PERIOD_DIV_CODE=${period}`,
    "FHKST03030100",
    creds
  );
  return toCandles((body.output2 as ChartRow[]) ?? [], {
    date: "stck_bsop_date",
    open: "ovrs_nmix_oprc",
    high: "ovrs_nmix_hgpr",
    low: "ovrs_nmix_lwpr",
    close: "ovrs_nmix_prpr",
  });
}

export async function getKisFundamentals(
  ticker: string,
  creds: KisCredentials
): Promise<Omit<Fundamentals, "name">> {
  const output = await fetchInquirePrice(ticker, creds);
  const price = num(output.stck_prpr);
  const high52w = num(output.w52_hgpr);
  const per = num(output.per);
  return {
    ticker,
    market: "KR",
    marketCap: num(output.hts_avls),
    // KIS는 적자 기업의 per를 "0.00"으로 준다 → 의미 없는 값이라 결측 처리
    per: per === 0 ? undefined : per,
    pbr: num(output.pbr),
    dividendYield: undefined, // 현재가 응답에 없음
    revenueGrowth: undefined, // 현재가 응답에 없음
    off52wHigh:
      price && high52w
        ? Math.round((price / high52w - 1) * 10000) / 100
        : undefined,
  };
}
