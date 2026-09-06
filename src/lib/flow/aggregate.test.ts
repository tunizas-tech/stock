import { describe, expect, it } from "vitest";
import {
  aggregateBySector,
  OTHER_RATIO_UNRELIABLE_THRESHOLD,
  sectorTotals,
  stockTotals,
  type StockFlow,
} from "./aggregate";

// 반도체 2종목 — 날짜 커버리지가 일부러 어긋나 있다(둘 다 09-04는 있지만
// 09-03은 A만, 09-05는 B만 있다). "일부 종목만 보고했는데 전체 섹터가
// 보고한 것처럼 보이면 안 된다"는 정직성 요구를 검증하기 위해서다.
const semiA: StockFlow = {
  ticker: "AAA",
  name: "A전자",
  sector: "반도체",
  days: [
    { date: "2025-09-03", close: 100, foreign: 10, institution: 5, individual: -15, foreignQty: 1, institutionQty: 1, individualQty: -2 },
    { date: "2025-09-04", close: 101, foreign: 20, institution: -3, individual: -17, foreignQty: 2, institutionQty: -1, individualQty: -1 },
  ],
};
const semiB: StockFlow = {
  ticker: "BBB",
  name: "B반도체",
  sector: "반도체",
  days: [
    { date: "2025-09-04", close: 50, foreign: 5, institution: 5, individual: -10, foreignQty: 3, institutionQty: 2, individualQty: -5 },
    { date: "2025-09-05", close: 51, foreign: -8, institution: 2, individual: 6, foreignQty: -1, institutionQty: 1, individualQty: 0 },
  ],
};
const auto: StockFlow = {
  ticker: "CCC",
  name: "C자동차",
  sector: "자동차",
  days: [
    { date: "2025-09-04", close: 200, foreign: 100, institution: -50, individual: -50, foreignQty: 5, institutionQty: -2, individualQty: -3 },
  ],
};

const flows = [semiA, semiB, auto];

describe("aggregateBySector", () => {
  it("같은 섹터 여러 종목의 대금을 날짜별로 단순 합산한다", () => {
    const out = aggregateBySector(flows, "반도체");
    const day0904 = out.find((d) => d.date === "2025-09-04");
    // 이 픽스처는 개인+외국인+기관이 이미 0으로 맞춰져 있어(잔차 없음) other는 0이다.
    expect(day0904).toEqual({
      date: "2025-09-04",
      foreign: 20 + 5,
      institution: -3 + 5,
      individual: -17 + (-10),
      other: 0,
      stocks: 2,
    });
  });

  it("한 종목만 보고한 날짜는 그 종목만 반영하고 stocks로 몇 종목이 기여했는지 드러낸다", () => {
    const out = aggregateBySector(flows, "반도체");
    const day0903 = out.find((d) => d.date === "2025-09-03");
    const day0905 = out.find((d) => d.date === "2025-09-05");

    // 09-03은 A만 보고 → 섹터 합계 = A 단독, stocks: 1 (이 픽스처도 잔차 0)
    expect(day0903).toEqual({
      date: "2025-09-03",
      foreign: 10,
      institution: 5,
      individual: -15,
      other: 0,
      stocks: 1,
    });
    // 09-05는 B만 보고 → 섹터 합계 = B 단독, stocks: 1 (A가 보고 안 했다고 0으로 깔리지 않는다)
    expect(day0905).toEqual({
      date: "2025-09-05",
      foreign: -8,
      institution: 2,
      individual: 6,
      other: 0,
      stocks: 1,
    });
  });

  it("날짜 오름차순으로 정렬해 반환한다", () => {
    const out = aggregateBySector(flows, "반도체");
    expect(out.map((d) => d.date)).toEqual(["2025-09-03", "2025-09-04", "2025-09-05"]);
  });

  it("해당 섹터에 속한 종목이 없으면 빈 배열을 반환한다", () => {
    expect(aggregateBySector(flows, "존재하지않는섹터")).toEqual([]);
  });

  it("다른 섹터 종목은 섞이지 않는다", () => {
    const out = aggregateBySector(flows, "자동차");
    expect(out).toEqual([
      { date: "2025-09-04", foreign: 100, institution: -50, individual: -50, other: 0, stocks: 1 },
    ]);
  });
});

describe("sectorTotals", () => {
  it("최근 N 거래일만 합산한다", () => {
    // days: 1 → 가장 최신 날짜(09-05)만 대상. 반도체는 그날 B만 존재.
    const out = sectorTotals(flows, 1);
    const semi = out.find((s) => s.sector === "반도체");
    // 이 창(09-05, B 단독)도 개인+외국인+기관 합이 0인 픽스처라 other/otherRatio도 0.
    expect(semi).toEqual({
      sector: "반도체",
      foreign: -8,
      institution: 2,
      individual: 6,
      other: 0,
      otherRatio: 0,
      unreliable: false,
      tradingDays: 1,
    });
  });

  it("종목별로 날짜 커버리지가 다르면 tradingDays가 실제 관측 일수를 정직하게 보고한다", () => {
    // days: 3 → 09-03, 09-04, 09-05 전부 포함. 반도체는 세 날짜 모두 최소 한 종목이 보고했다.
    const out = sectorTotals(flows, 3);
    const semi = out.find((s) => s.sector === "반도체");
    expect(semi?.tradingDays).toBe(3);

    // 자동차는 09-04 하루치 데이터뿐이므로 3일 창을 요청해도 실제 관측일은 1.
    const autoTotal = out.find((s) => s.sector === "자동차");
    expect(autoTotal?.tradingDays).toBe(1);
  });

  it("foreign + institution 내림차순으로 정렬한다", () => {
    const out = sectorTotals(flows, 3);
    // 반도체 foreign+institution = (10+5)+(20-3)+(5+5)+(-8+2) = 15+17+10-6 = 36
    // 자동차 foreign+institution = 100-50 = 50
    expect(out.map((s) => s.sector)).toEqual(["자동차", "반도체"]);
  });

  it("foreign + institution 값이 같으면 섹터명으로 타이브레이크해 정렬을 결정적으로 만든다", () => {
    const tieA: StockFlow = {
      ticker: "T1",
      name: "티1",
      sector: "다",
      days: [{ date: "2025-09-04", close: 1, foreign: 10, institution: 0, individual: -10, foreignQty: 0, institutionQty: 0, individualQty: 0 }],
    };
    const tieB: StockFlow = {
      ticker: "T2",
      name: "티2",
      sector: "가",
      days: [{ date: "2025-09-04", close: 1, foreign: 10, institution: 0, individual: -10, foreignQty: 0, institutionQty: 0, individualQty: 0 }],
    };
    const out = sectorTotals([tieA, tieB], 1);
    expect(out.map((s) => s.sector)).toEqual(["가", "다"]);
  });

  it("days 창보다 저장된 날짜 수가 적으면 있는 만큼만 쓰고 tradingDays로 알린다", () => {
    const out = sectorTotals(flows, 100);
    const semi = out.find((s) => s.sector === "반도체");
    // 반도체 전체 고유 날짜: 09-03, 09-04, 09-05 = 3일뿐인데 100일을 요청했다.
    expect(semi?.tradingDays).toBe(3);
  });
});

// 기타법인(추정) 잔차 — KIS API가 주는 3주체(개인·외국인·기관) 합만으로는
// 자사주 매입 같은 4번째 주체(기타법인)의 움직임이 보이지 않는다. 모든 거래는
// 사는 쪽과 파는 쪽이 있어 전체 투자자 유형의 순매수 합은 0이어야 하므로,
// 나머지는 -(개인+외국인+기관)으로 역산할 수 있다 — 이것이 other다.
describe("기타법인(추정) 잔차 — other", () => {
  it("네 주체 합이 0이 되도록 구성한 하루치에서 other가 네 번째 값을 정확히 복원한다", () => {
    // 개인 -1,000 + 외국인 300 + 기관 500 + 기타법인(진짜 값) 200 = 0
    const stock: StockFlow = {
      ticker: "ZZZ",
      name: "가상전자",
      sector: "테스트섹터",
      days: [
        {
          date: "2025-09-04",
          close: 10,
          foreign: 300,
          institution: 500,
          individual: -1000,
          foreignQty: 0,
          institutionQty: 0,
          individualQty: 0,
        },
      ],
    };
    const out = aggregateBySector([stock], "테스트섹터");
    expect(out[0].other).toBe(200);
  });

  it("aggregateBySector의 하루치 other는 구성 종목별 잔차의 합이다", () => {
    // A: 개인 -100 + 외국인 30 + 기관 20 = -50 → A의 잔차(기타법인) = 50
    // B: 개인 -500 + 외국인 480 + 기관 0  = -20 → B의 잔차(기타법인) = 20
    // 섹터 합산 other는 50 + 20 = 70이어야 한다(개별 종목 잔차의 단순 합).
    const a: StockFlow = {
      ticker: "AAA",
      name: "가전자",
      sector: "테스트섹터",
      days: [{ date: "2025-09-04", close: 1, foreign: 30, institution: 20, individual: -100, foreignQty: 0, institutionQty: 0, individualQty: 0 }],
    };
    const b: StockFlow = {
      ticker: "BBB",
      name: "나전자",
      sector: "테스트섹터",
      days: [{ date: "2025-09-04", close: 1, foreign: 480, institution: 0, individual: -500, foreignQty: 0, institutionQty: 0, individualQty: 0 }],
    };
    const out = aggregateBySector([a, b], "테스트섹터");
    expect(out[0].other).toBe(70);
  });

  it("기타법인 움직임이 없는 종목은 other가 0에 가깝고 unreliable이 false다", () => {
    // 개인 -300 + 외국인 100 + 기관 200 = 0 → 잔차 없음.
    const stock: StockFlow = {
      ticker: "CLEAN",
      name: "깨끗전자",
      sector: "테스트섹터",
      days: [{ date: "2025-09-04", close: 1, foreign: 100, institution: 200, individual: -300, foreignQty: 0, institutionQty: 0, individualQty: 0 }],
    };
    const [total] = stockTotals([stock], 1);
    expect(total.other).toBeCloseTo(0);
    expect(total.otherRatio).toBe(0);
    expect(total.unreliable).toBe(false);
  });

  it("otherRatio는 창 안에 흐름이 전혀 없어도 0으로 나누지 않는다", () => {
    const stock: StockFlow = {
      ticker: "EMPTY",
      name: "무흐름전자",
      sector: "테스트섹터",
      days: [{ date: "2025-09-04", close: 1, foreign: 0, institution: 0, individual: 0, foreignQty: 0, institutionQty: 0, individualQty: 0 }],
    };
    const [total] = stockTotals([stock], 1);
    expect(total.other).toBe(0);
    expect(total.otherRatio).toBe(0);
    expect(total.unreliable).toBe(false);
    expect(Number.isNaN(total.otherRatio)).toBe(false);
  });

  it("SK하이닉스 규모의 자사주 매입형 잔차는 unreliable을 true로 만든다", () => {
    // 백만원 단위. 외국인 +9.5조, 기관 +3조 순매수인데 개인이 -17조를 팔아
    // 셋의 합이 -4.5조 → 기타법인(자사주 매입 추정) +4.5조.
    // gross = 9.5조+3조+17조+4.5조 = 34조, otherRatio = 4.5/34 ≈ 13.2% > 5%.
    const stock: StockFlow = {
      ticker: "000660",
      name: "SK하이닉스",
      sector: "반도체",
      days: [
        {
          date: "2025-09-04",
          close: 200000,
          foreign: 9_500_000,
          institution: 3_000_000,
          individual: -17_000_000,
          foreignQty: 0,
          institutionQty: 0,
          individualQty: 0,
        },
      ],
    };
    const [total] = stockTotals([stock], 1);
    expect(total.other).toBe(4_500_000);
    expect(total.otherRatio).toBeGreaterThan(OTHER_RATIO_UNRELIABLE_THRESHOLD);
    expect(total.unreliable).toBe(true);
  });

  it("임계값(0.05) 바로 아래는 false, 바로 위는 true — 상수가 판정 기준임을 보장한다", () => {
    // gross를 1,000,000으로 고정하고 other를 각각 49,000(4.9%)과 51,000(5.1%)으로 구성.
    // institution은 0으로 두고, foreign/individual만으로 나머지를 맞춘다.
    // 4.9% 케이스: foreign 451,000 / individual -500,000 → other = -(451000-500000) = 49,000
    //   gross = 451000 + 0 + 500000 + 49000 = 1,000,000 → ratio = 0.049
    const justUnder: StockFlow = {
      ticker: "UNDER",
      name: "경계아래",
      sector: "테스트섹터",
      days: [{ date: "2025-09-04", close: 1, foreign: 451_000, institution: 0, individual: -500_000, foreignQty: 0, institutionQty: 0, individualQty: 0 }],
    };
    // 5.1% 케이스: foreign 449,000 / individual -500,000 → other = -(449000-500000) = 51,000
    //   gross = 449000 + 0 + 500000 + 51000 = 1,000,000 → ratio = 0.051
    const justOver: StockFlow = {
      ticker: "OVER",
      name: "경계위",
      sector: "테스트섹터",
      days: [{ date: "2025-09-04", close: 1, foreign: 449_000, institution: 0, individual: -500_000, foreignQty: 0, institutionQty: 0, individualQty: 0 }],
    };

    const [under] = stockTotals([justUnder], 1);
    expect(under.otherRatio).toBeCloseTo(0.049);
    expect(under.otherRatio).toBeLessThan(OTHER_RATIO_UNRELIABLE_THRESHOLD);
    expect(under.unreliable).toBe(false);

    const [over] = stockTotals([justOver], 1);
    expect(over.otherRatio).toBeCloseTo(0.051);
    expect(over.otherRatio).toBeGreaterThan(OTHER_RATIO_UNRELIABLE_THRESHOLD);
    expect(over.unreliable).toBe(true);
  });
});

describe("stockTotals", () => {
  it("foreign + institution 내림차순, 동률이면 ticker 오름차순으로 정렬해 결정적이다", () => {
    // 셋 다 foreign+institution = 100으로 동률 → ticker 오름차순(005930 < 000660 순은 문자열 비교)
    const s1: StockFlow = {
      ticker: "005930",
      name: "삼성전자",
      sector: "반도체",
      days: [{ date: "2025-09-04", close: 1, foreign: 60, institution: 40, individual: -100, foreignQty: 0, institutionQty: 0, individualQty: 0 }],
    };
    const s2: StockFlow = {
      ticker: "000660",
      name: "SK하이닉스",
      sector: "반도체",
      days: [{ date: "2025-09-04", close: 1, foreign: 100, institution: 0, individual: -100, foreignQty: 0, institutionQty: 0, individualQty: 0 }],
    };
    const s3: StockFlow = {
      ticker: "042700",
      name: "한미반도체",
      sector: "반도체",
      days: [{ date: "2025-09-04", close: 1, foreign: 0, institution: 100, individual: -100, foreignQty: 0, institutionQty: 0, individualQty: 0 }],
    };

    const out = stockTotals([s1, s2, s3], 1);
    expect(out.map((s) => s.ticker)).toEqual(["000660", "005930", "042700"]);
  });

  it("종목별 tradingDays와 stocks 카운트 의미를 회귀시키지 않는다 — 요청보다 짧은 창은 있는 만큼만", () => {
    const stock: StockFlow = {
      ticker: "005930",
      name: "삼성전자",
      sector: "반도체",
      days: [
        { date: "2025-09-03", close: 1, foreign: 10, institution: 0, individual: -10, foreignQty: 0, institutionQty: 0, individualQty: 0 },
        { date: "2025-09-04", close: 1, foreign: 20, institution: 0, individual: -20, foreignQty: 0, institutionQty: 0, individualQty: 0 },
      ],
    };
    const [total] = stockTotals([stock], 100);
    expect(total.tradingDays).toBe(2);
  });
});
