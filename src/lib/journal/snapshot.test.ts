import { describe, expect, it } from "vitest";
import type { Candle } from "../types";
import type { StockFlow } from "../flow/aggregate";
import { buildSnapshot, SECTOR_ROTATION_ETF } from "./snapshot";

// 코스피 캔들 — 09-01(월)~09-10(수). 주말(09-06,09-07) 없이 거래일만.
function kospi(): Candle[] {
  const dates = ["2025-09-01", "2025-09-02", "2025-09-03", "2025-09-04", "2025-09-05", "2025-09-08", "2025-09-09", "2025-09-10"];
  return dates.map((date, i) => ({ date, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i }));
}

// 나스닥은 미국 거래일 기준 — 한국시간 새벽에 끝나므로 KR 날짜와 하루 이상 어긋날 수 있지만
// 여기서는 같은 날짜 문자열로 단순화해 <= asOf 규칙만 검증한다.
function nasdaq(): Candle[] {
  const dates = ["2025-09-01", "2025-09-02", "2025-09-03", "2025-09-04", "2025-09-05", "2025-09-08", "2025-09-09"];
  return dates.map((date, i) => ({ date, open: 200 + i, high: 201 + i, low: 199 + i, close: 200 + i }));
}

const ticker = "005930"; // 삼성전자 — 반도체

// endDate를 마지막 날짜로 n개의 연속 영업일(주말 제외 근사) 생성. sectorRsRank(250거래일
// 창)와 rsi14 픽스처에서 공유해 쓴다.
function mkSeries(startClose: number, endClose: number, n: number, endDate: string): Candle[] {
  const out: Candle[] = [];
  const end = new Date(endDate + "T00:00:00Z");
  const dates: string[] = [];
  const d = new Date(end);
  while (dates.length < n) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) dates.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  for (let i = 0; i < n; i++) {
    const close = startClose + ((endClose - startClose) * i) / (n - 1);
    out.push({ date: dates[i], open: close, high: close, low: close, close });
  }
  return out;
}

/**
 * sectorRsRank·rsi14 둘 다 정상 계산되는 픽스처(sectorEtfCandles 3섹터 + stockCandles).
 * "sectorFlow20만 빠졌을 때도 coverage가 partial로 떨어지는가"를 sectorRsRank/rsi14가
 * 이미 undefined라서 우연히 partial이 되는 가짜 통과와 구분하려면, 이 둘은 항상 채워
 * 둬야 한다.
 */
function fullCoverageExtras(asOf: string): { sectorEtfCandles: Record<string, Candle[]>; stockCandles: Candle[] } {
  return {
    sectorEtfCandles: {
      "반도체": mkSeries(100, 150, 251, asOf),
      "자동차": mkSeries(100, 120, 251, asOf),
      "금융": mkSeries(100, 90, 251, asOf),
    },
    stockCandles: mkSeries(100, 130, 30, asOf),
  };
}

function baseFlows(): StockFlow[] {
  return [
    {
      ticker: "005930",
      name: "삼성전자",
      sector: "반도체",
      days: [
        { date: "2025-09-01", close: 100, foreign: 10, institution: 5, individual: -15, foreignQty: 1, institutionQty: 1, individualQty: -2 },
        { date: "2025-09-02", close: 101, foreign: 8, institution: 3, individual: -11, foreignQty: 1, institutionQty: 1, individualQty: -2 },
        { date: "2025-09-03", close: 102, foreign: 12, institution: 2, individual: -14, foreignQty: 1, institutionQty: 1, individualQty: -2 },
        // 매매일(date) 당일의 거대한 수급 — look-ahead 시험용
        { date: "2025-09-04", close: 103, foreign: 10_000_000, institution: 0, individual: -10_000_000, foreignQty: 1, institutionQty: 0, individualQty: -1 },
      ],
    },
  ];
}

describe("buildSnapshot — C1 asOf 규칙", () => {
  it("asOf는 매매일 이전 마지막 거래일이다(당일이 거래일이어도 그 전날)", () => {
    const snap = buildSnapshot({
      ticker,
      date: "2025-09-04", // 거래일
      kospiCandles: kospi(),
      nasdaqCandles: nasdaq(),
      flows: baseFlows(),
      sectorEtfCandles: {},
    });
    expect(snap.asOf).toBe("2025-09-03");
    expect(snap.asOf < "2025-09-04").toBe(true);
  });

  it("매매일 당일 수급이 아무리 커도 sectorFlow20에 섞이지 않는다(look-ahead 판별)", () => {
    const snap = buildSnapshot({
      ticker,
      date: "2025-09-04",
      kospiCandles: kospi(),
      nasdaqCandles: nasdaq(),
      flows: baseFlows(),
      sectorEtfCandles: {},
    });
    // until이 date였다면 foreign 합계가 10,000,000 이상으로 튀어야 한다.
    expect(snap.sectorFlow20?.foreign).toBeLessThan(1000);
  });

  it("date 이전에 거래 데이터가 전혀 없으면 coverage: none, throw하지 않는다", () => {
    expect(() => {
      const snap = buildSnapshot({
        ticker,
        date: "2025-01-01", // 위 캔들보다 훨씬 이전
        kospiCandles: kospi(),
        nasdaqCandles: nasdaq(),
        flows: baseFlows(),
        sectorEtfCandles: {},
      });
      expect(snap.coverage).toBe("none");
    }).not.toThrow();
  });

  it("FLOW_UNIVERSE 밖 종목은 coverage: none, sector는 undefined", () => {
    const snap = buildSnapshot({
      ticker: "999999",
      date: "2025-09-04",
      kospiCandles: kospi(),
      nasdaqCandles: nasdaq(),
      flows: baseFlows(),
      sectorEtfCandles: {},
    });
    expect(snap.coverage).toBe("none");
    expect(snap.sector).toBeUndefined();
  });

  it("FLOW_UNIVERSE 밖 종목이어도 input.sector를 주면 그 값을 쓴다(유니버스 조회보다 우선, 7단계 에이전트 문)", () => {
    const snap = buildSnapshot({
      ticker: "999999",
      date: "2025-09-04",
      sector: "배터리",
      kospiCandles: kospi(),
      nasdaqCandles: nasdaq(),
      flows: baseFlows(),
      sectorEtfCandles: {},
    });
    expect(snap.coverage).not.toBe("none");
    expect(snap.sector).toBe("배터리");
  });

  it("ETF 매핑이 없는 섹터(조선)는 sectorRsRank가 undefined, coverage는 partial", () => {
    const flows: StockFlow[] = [
      {
        ticker: "009540",
        name: "HD한국조선해양",
        sector: "조선",
        days: [
          { date: "2025-09-01", close: 100, foreign: 1, institution: 1, individual: -2, foreignQty: 0, institutionQty: 0, individualQty: 0 },
          { date: "2025-09-03", close: 101, foreign: 1, institution: 1, individual: -2, foreignQty: 0, institutionQty: 0, individualQty: 0 },
        ],
      },
    ];
    const snap = buildSnapshot({
      ticker: "009540",
      date: "2025-09-04",
      kospiCandles: kospi(),
      nasdaqCandles: nasdaq(),
      flows,
      sectorEtfCandles: {},
    });
    expect(snap.sector).toBe("조선");
    expect(snap.sectorRsRank).toBeUndefined();
    expect(snap.coverage).toBe("partial");
  });

  it("섹터는 유니버스에 있지만 flows에 그 섹터 종목이 아예 없으면 sectorFlow20 없음 + partial", () => {
    // 삼성전자(반도체)를 조회하는데 flows에는 자동차 종목만 있다 — 반도체
    // 수급 데이터 자체가 없는 상황. "수급 0"이 아니라 "수급 데이터 없음"이라
    // full로 새면 안 된다. sectorRsRank·rsi14는 일부러 정상 계산되게 채워서
    // (fullCoverageExtras) "다른 필드가 undefined라서 우연히 partial"이 아니라
    // sectorFlow20 결측 자체가 partial의 원인임을 못박는다.
    const flows: StockFlow[] = [
      {
        ticker: "005380",
        name: "현대차",
        sector: "자동차",
        days: [
          { date: "2025-09-01", close: 100, foreign: 1, institution: 1, individual: -2, foreignQty: 0, institutionQty: 0, individualQty: 0 },
        ],
      },
    ];
    const snap = buildSnapshot({
      ticker, // 005930, 반도체
      date: "2025-09-04",
      kospiCandles: kospi(),
      nasdaqCandles: nasdaq(),
      flows,
      ...fullCoverageExtras("2025-09-03"),
    });
    expect(snap.sector).toBe("반도체");
    expect(snap.sectorFlow20).toBeUndefined();
    expect(snap.sectorRsRank).toBeDefined(); // 다른 필드는 정상 — sectorFlow20만 원인
    expect(snap.rsi14).toBeDefined();
    expect(snap.coverage).toBe("partial");
  });

  it("섹터 수급이 전부 asOf 이후 날짜뿐이면 tradingDays: 0으로 남고 coverage는 partial(0을 그대로 믿지 않는다)", () => {
    // asOf(=09-03)보다 뒤 날짜(09-04, 09-05)만 있는 반도체 수급 — until 필터로
    // 전부 걸러져 sectorTotals가 foreign/institution/other를 0으로 채운
    // tradingDays:0 행을 돌려준다. 이 0은 "수급이 없었다"가 아니다.
    // 여기서도 sectorRsRank·rsi14는 fullCoverageExtras로 정상 계산되게 둔다.
    const flows: StockFlow[] = [
      {
        ticker: "005930",
        name: "삼성전자",
        sector: "반도체",
        days: [
          { date: "2025-09-04", close: 103, foreign: 5, institution: 5, individual: -10, foreignQty: 1, institutionQty: 1, individualQty: -1 },
          { date: "2025-09-05", close: 104, foreign: 5, institution: 5, individual: -10, foreignQty: 1, institutionQty: 1, individualQty: -1 },
        ],
      },
    ];
    const snap = buildSnapshot({
      ticker,
      date: "2025-09-04", // asOf = 09-03
      kospiCandles: kospi(),
      nasdaqCandles: nasdaq(),
      flows,
      ...fullCoverageExtras("2025-09-03"),
    });
    expect(snap.sectorFlow20?.tradingDays).toBe(0);
    expect(snap.sectorRsRank).toBeDefined();
    expect(snap.rsi14).toBeDefined();
    expect(snap.coverage).toBe("partial");
  });

  it("sectorRsRank는 3-ETF 픽스처에서 asOf 기준 250거래일 수익률로 순위를 매기고 of === 3", () => {
    // 251개 거래일짜리 캔들 생성 — 마지막 날짜가 asOf(=2025-09-03)가 되도록
    // kospi()의 asOf는 09-03. ETF 시리즈는 asOf를 마지막 날짜로 250거래일 전부터.
    const asOf = "2025-09-03";
    const semiEtf = mkSeries(100, 150, 251, asOf); // +50%
    const autoEtf = mkSeries(100, 120, 251, asOf); // +20%
    const bankEtf = mkSeries(100, 90, 251, asOf); // -10%

    const snap = buildSnapshot({
      ticker, // 반도체 -> KODEX 반도체
      date: "2025-09-04",
      kospiCandles: kospi(),
      nasdaqCandles: nasdaq(),
      flows: baseFlows(),
      sectorEtfCandles: {
        "반도체": semiEtf,
        "자동차": autoEtf,
        "금융": bankEtf,
      },
    });
    expect(snap.sectorRsRank).toEqual({ rank: 1, of: 3 });
  });

  it("나스닥 등락은 asOf 이하의 마지막 거래일 것을 쓴다(그 이후가 아니다)", () => {
    const snap = buildSnapshot({
      ticker,
      date: "2025-09-04", // asOf = 09-03
      kospiCandles: kospi(),
      nasdaqCandles: nasdaq(),
      flows: baseFlows(),
      sectorEtfCandles: {},
    });
    // nasdaq() 09-03 종가 202, 09-02 종가 201 -> closeToClose = 202/201-1
    expect(snap.nasdaqPrevChange).toBeCloseTo(202 / 201 - 1, 10);
  });

  it("SECTOR_ROTATION_ETF는 5개 섹터를 매핑한다", () => {
    expect(SECTOR_ROTATION_ETF["반도체"]).toBe("KODEX 반도체");
    expect(SECTOR_ROTATION_ETF["자동차"]).toBe("KODEX 자동차");
    expect(SECTOR_ROTATION_ETF["금융"]).toBe("KODEX 은행");
    expect(SECTOR_ROTATION_ETF["제약바이오"]).toBe("TIGER 헬스케어");
    expect(SECTOR_ROTATION_ETF["인터넷"]).toBe("TIGER 200 IT");
  });
});
