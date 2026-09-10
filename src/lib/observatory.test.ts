import { describe, expect, it } from "vitest";
import {
  buildBuyAndHold,
  buildFlowSection,
  buildMarketToday,
  buildRelativeStrength,
  individualRealFrom,
  isIndividualMissing,
  sectorIndividualCoverage,
} from "./observatory";
import type { StockFlow } from "./flow/aggregate";
import type { Candle } from "./types";

// ── ① 오늘의 시장 ────────────────────────────────────────────────────────────

function candle(date: string, open: number, close: number): Candle {
  return { date, open, high: Math.max(open, close), low: Math.min(open, close), close };
}

describe("buildMarketToday", () => {
  it("5개 지수와 코스피·코스닥 갭 분해를 계산한다", () => {
    const series = new Map<string, Candle[]>([
      ["코스피", [candle("2026-09-03", 100, 101), candle("2026-09-04", 103, 99)]],
      ["코스닥", [candle("2026-09-03", 50, 51), candle("2026-09-04", 52, 53)]],
      ["나스닥", [candle("2026-09-03", 200, 202), candle("2026-09-04", 203, 205)]],
      ["S&P 500", [candle("2026-09-03", 300, 301), candle("2026-09-04", 302, 303)]],
      ["다우존스", [candle("2026-09-03", 400, 401), candle("2026-09-04", 402, 403)]],
    ]);
    const result = buildMarketToday(series)!;

    expect(result.indices.map((i) => i.label)).toEqual([
      "코스피",
      "코스닥",
      "나스닥",
      "S&P 500",
      "다우존스",
    ]);
    const kospi = result.indices[0];
    expect(kospi.changePct).toBeCloseTo(99 / 101 - 1, 10);

    const gapKospi = result.gaps.find((g) => g.label === "코스피")!;
    expect(gapKospi.gapPct).toBeCloseTo(103 / 101 - 1, 10); // 시가÷전일종가
    expect(gapKospi.intradayPct).toBeCloseTo(99 / 103 - 1, 10); // 종가÷시가
  });

  it("데이터가 하나도 없으면(빈 맵) null을 돌려준다", () => {
    expect(buildMarketToday(new Map())).toBeNull();
  });

  it("어떤 지수도 2개 미만이면 null", () => {
    const series = new Map<string, Candle[]>([["코스피", [candle("2026-09-04", 100, 101)]]]);
    expect(buildMarketToday(series)).toBeNull();
  });
});

// ── ② 섹터별 자금 흐름 / 개인 열 결측 ────────────────────────────────────────

function flowDay(
  date: string,
  opts: Partial<{
    foreign: number;
    institution: number;
    individual: number;
    individualQty: number;
  }> = {}
) {
  return {
    date,
    close: 100,
    foreign: opts.foreign ?? 0,
    institution: opts.institution ?? 0,
    individual: opts.individual ?? 0,
    foreignQty: 0,
    institutionQty: 0,
    individualQty: opts.individualQty ?? opts.individual ?? 0,
  };
}

describe("isIndividualMissing", () => {
  it("금액·수량이 둘 다 0이면 결측(백필)으로 본다", () => {
    expect(isIndividualMissing({ individual: 0, individualQty: 0 })).toBe(true);
  });
  it("실측이 우연히 0일 수 있는 수량만 0인 경우는 결측이 아니다", () => {
    expect(isIndividualMissing({ individual: 5, individualQty: 0 })).toBe(false);
  });
});

describe("individualRealFrom", () => {
  it("종목마다 전환일이 다르면 가장 늦은 날짜를 쓴다(보수적)", () => {
    const a: StockFlow = {
      ticker: "A",
      name: "A",
      sector: "반도체",
      days: [
        flowDay("2026-07-01", { individual: 0, individualQty: 0 }),
        flowDay("2026-07-02", { individual: 10, individualQty: 5 }),
      ],
    };
    const b: StockFlow = {
      ticker: "B",
      name: "B",
      sector: "반도체",
      days: [
        flowDay("2026-07-01", { individual: 0, individualQty: 0 }),
        flowDay("2026-07-02", { individual: 0, individualQty: 0 }),
        flowDay("2026-07-03", { individual: -3, individualQty: -1 }),
      ],
    };
    expect(individualRealFrom([a, b])).toBe("2026-07-03");
  });

  it("실측 구간이 전혀 없는 종목이 있으면 undefined", () => {
    const allZero: StockFlow = {
      ticker: "Z",
      name: "Z",
      sector: "반도체",
      days: [flowDay("2026-07-01"), flowDay("2026-07-02")],
    };
    expect(individualRealFrom([allZero])).toBeUndefined();
  });

  it("빈 입력이면 undefined", () => {
    expect(individualRealFrom([])).toBeUndefined();
  });
});

describe("sectorIndividualCoverage", () => {
  it("창 안에서 실측 날짜 수를 백필 날짜와 구분해 센다", () => {
    const a: StockFlow = {
      ticker: "A",
      name: "A",
      sector: "반도체",
      days: [
        flowDay("2026-07-01"),
        flowDay("2026-07-02"),
        flowDay("2026-07-03", { individual: 10, individualQty: 5 }),
        flowDay("2026-07-06", { individual: -4, individualQty: -2 }),
      ],
    };
    const coverage = sectorIndividualCoverage([a], "반도체", 4, "2026-07-03");
    expect(coverage.tradingDays).toBe(4);
    expect(coverage.realDays).toBe(2); // 07-03, 07-06만 실측
  });

  it("realFrom이 undefined면 실측 날짜를 0으로 본다(신뢰 불가)", () => {
    const a: StockFlow = {
      ticker: "A",
      name: "A",
      sector: "반도체",
      days: [flowDay("2026-07-01", { individual: 5, individualQty: 5 })],
    };
    const coverage = sectorIndividualCoverage([a], "반도체", 5, undefined);
    expect(coverage.realDays).toBe(0);
  });
});

describe("buildFlowSection", () => {
  it("빈 배열이면 null", () => {
    expect(buildFlowSection([])).toBeNull();
  });

  it("5·20·60일 창을 모두 계산하고 섹터별 종목 내역·개인열 커버리지를 함께 낸다", () => {
    const stocks: StockFlow[] = [
      {
        ticker: "005930",
        name: "삼성전자",
        sector: "반도체",
        days: Array.from({ length: 65 }, (_, i) =>
          flowDay(seqDate("2026-06-01", i), {
            foreign: 100,
            institution: 50,
            individual: i >= 35 ? -140 : 0, // 마지막 30일만 실측
            individualQty: i >= 35 ? -70 : 0,
          })
        ),
      },
    ];
    const section = buildFlowSection(stocks)!;
    expect(section.windows.map((w) => w.days)).toEqual([5, 20, 60]);
    const w60 = section.windows.find((w) => w.days === 60)!;
    expect(w60.sectors[0].sector).toBe("반도체");
    expect(w60.stocksBySector["반도체"]).toHaveLength(1);
    expect(w60.coverageBySector["반도체"].tradingDays).toBe(60);
    expect(w60.coverageBySector["반도체"].realDays).toBeLessThan(60); // 백필 구간이 섞여 있다
  });

  it("창마다 섹터별 지속성(persistenceBySector)을 싣는다 — 합계와 별개로 부호가 며칠 이어졌는가", () => {
    const stocks: StockFlow[] = [
      {
        ticker: "009540",
        name: "HD한국조선해양",
        sector: "조선",
        // 25일: 앞 13일은 순매수, 뒤 12일은 순매도 → 20일 창에서는 순매도 12일 연속, 순매수 8/20일
        days: Array.from({ length: 25 }, (_, i) =>
          flowDay(seqDate("2026-08-01", i), {
            foreign: i >= 13 ? -100 : 100,
            institution: 0,
            individual: i >= 13 ? 100 : -100,
            individualQty: 1,
          })
        ),
      },
    ];
    const w20 = buildFlowSection(stocks)!.windows.find((w) => w.days === 20)!;
    expect(w20.persistenceBySector["조선"]).toEqual({ streak: -12, buyDays: 8, tradingDays: 20 });
  });
});

// ── ③ 섹터 상대강도 ──────────────────────────────────────────────────────────

/** 달력일 기준으로 매일 하나씩 늘어나는 날짜(주말 포함, 겹치지 않음)를 만든다.
 * 실제 거래일 캘린더는 아니지만 이 파일의 순수 함수들은 날짜 문자열의 사전순
 * 정렬·유일성만 가정하므로 테스트 목적에는 충분하다. */
function seqDate(startISO: string, offsetDays: number): string {
  const base = new Date(`${startISO}T00:00:00Z`);
  return new Date(base.getTime() + offsetDays * 86400000).toISOString().slice(0, 10);
}

function series(days: number, start: number, dailyReturn: number): Candle[] {
  const out: Candle[] = [];
  let price = start;
  for (let i = 0; i < days; i++) {
    out.push(candle(seqDate("2020-01-01", i), price, price));
    price *= 1 + dailyReturn;
  }
  return out;
}

describe("buildRelativeStrength", () => {
  it("표본이 창보다 긴 종목만으로 순위를 매기고 수익률 내림차순 정렬한다", () => {
    const assets = [
      { label: "A", ticker: "A", candles: series(300, 100, 0.001) },
      { label: "B", ticker: "B", candles: series(300, 100, 0.003) },
      { label: "C(짧음)", ticker: "C", candles: series(10, 100, 0.1) }, // 250일 창엔 못 낌
    ];
    const result = buildRelativeStrength(assets)!;
    const w250 = result.windows.find((w) => w.days === 250)!;
    expect(w250.rows.map((r) => r.label)).toEqual(["B", "A"]);
    expect(w250.rows[0].returnPct).toBeGreaterThan(w250.rows[1].returnPct);
  });

  it("자산이 없으면 null", () => {
    expect(buildRelativeStrength([])).toBeNull();
  });
});

// ── ④ 장기 매수후보유 ────────────────────────────────────────────────────────

describe("buildBuyAndHold", () => {
  it("lookback을 채운 뒤 순위로 진입해 공통 종료일까지 매수후보유 수익을 계산한다", () => {
    // 작은 lookback(5)으로 실제 rotation.ts 로직을 그대로 태워 검증한다.
    // 재조정이 최소 한 번 "완결"되려면 월말 후보가 2개는 있어야 하므로(설계상
    // 마지막 후보는 청산일이 없어 결과에서 빠진다) 두 달 경계를 넘기는 길이로 잡는다.
    const assets = [
      { label: "빠른", ticker: "F", candles: series(70, 100, 0.02) },
      { label: "느린", ticker: "S", candles: series(70, 100, 0.001) },
    ];
    const section = buildBuyAndHold(assets, 5, 1)!;
    expect(section.rows[0].label).toBe("빠른"); // 훨씬 많이 오른 자산이 1위
    expect(section.rows[0].returnPct).toBeGreaterThan(section.rows[1].returnPct);
    expect(section.from < section.to).toBe(true);
  });

  it("후보가 1개뿐이면 null(로테이션 순위를 매길 수 없다)", () => {
    expect(buildBuyAndHold([{ label: "A", ticker: "A", candles: series(300, 100, 0.001) }])).toBeNull();
  });

  it("lookback을 채울 공통 데이터가 없으면 null", () => {
    const assets = [
      { label: "A", ticker: "A", candles: series(3, 100, 0.01) },
      { label: "B", ticker: "B", candles: series(3, 100, 0.02) },
    ];
    expect(buildBuyAndHold(assets, 250, 1)).toBeNull();
  });
});
