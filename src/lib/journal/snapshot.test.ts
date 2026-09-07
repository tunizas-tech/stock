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

  it("sectorRsRank는 3-ETF 픽스처에서 asOf 기준 250거래일 수익률로 순위를 매기고 of === 3", () => {
    // 251개 거래일짜리 캔들 생성 — 마지막 날짜가 asOf(=2025-09-03)가 되도록
    // kospi()의 asOf는 09-03. ETF 시리즈는 asOf를 마지막 날짜로 250거래일 전부터.
    function mkSeries(startClose: number, endClose: number, n: number, endDate: string): Candle[] {
      // endDate를 마지막 날짜로 n개의 연속 영업일(주말 제외 근사) 생성.
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
