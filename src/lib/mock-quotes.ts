// 결정론적 mock 시세·펀더멘털 — 키가 없거나 실데이터 조회가 실패할 때의 폴백.
// 클라이언트 어댑터와 서버 라우트(/api/quotes, /api/fundamentals)가 공유한다.

import { currencyOf } from "./format";
import type { Fundamentals, Market, Quote } from "./types";

/** 티커 문자열에서 안정적인 의사난수(0~1)를 만든다 — 새로고침해도 같은 값. */
export function seededUnit(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // 0~1 정규화
  return ((h >>> 0) % 100000) / 100000;
}

export function mockQuote(ticker: string, market: Market): Quote {
  const base = seededUnit(ticker + market);
  const currency = currencyOf(market);
  // 시장별로 그럴듯한 가격대
  const price =
    market === "KR"
      ? Math.round((10000 + base * 190000) / 10) * 10 // 1만~20만 원, 10원 단위
      : Math.round((20 + base * 480) * 100) / 100; // $20~$500
  const changePct = (seededUnit(ticker + market + "chg") - 0.5) * 6; // -3% ~ +3%
  const change = Math.round(price * (changePct / 100) * 100) / 100;
  return { ticker, market, price, change, changePct, currency };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function mockFundamentals(
  ticker: string,
  market: Market,
  name: string
): Fundamentals {
  const u = (salt: string) => seededUnit(ticker + market + salt);
  return {
    ticker,
    market,
    name,
    // 시장별 관용 단위(types.ts 참고): KR 억 원, US 백만 달러
    marketCap: Math.round(
      market === "KR" ? 500 + u("cap") * 3_999_500 : 300 + u("cap") * 2_999_700
    ),
    per: round2(4 + u("per") * 36), // 4~40
    pbr: round2(0.4 + u("pbr") * 4.6), // 0.4~5
    dividendYield: round2(u("div") * 5), // 0~5%
    revenueGrowth: round2(-10 + u("grw") * 50), // -10~+40%
    off52wHigh: round2(-u("52w") * 45), // 0~-45%
  };
}
