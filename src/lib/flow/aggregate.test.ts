import { describe, expect, it } from "vitest";
import {
  aggregateBySector,
  flowPersistence,
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

// ---------------------------------------------------------------------------
// until 옵션 — 스냅샷은 매매일 "전" 거래일 종가까지만 알아야 한다(설계 문서 C1:
// 그날 마감 데이터가 스냅샷에 들어가면 look-ahead다). sectorTotals/stockTotals/
// aggregateBySector에 후행 선택 인자를 추가해 "이 날짜까지만 본다"를 표현한다.
// 생략하면 기존 동작과 완전히 같아야 한다 — 관측소 API(/api/observatory)는
// until 없이 이 함수들을 호출하므로 하위 호환이 깨지면 그 라우트가 바로 영향받는다.
// ---------------------------------------------------------------------------
const untilFixture: StockFlow = {
  ticker: "U1",
  name: "유틸전자",
  sector: "필터섹터",
  days: [
    { date: "2025-09-01", close: 1, foreign: 10, institution: 5, individual: -15, foreignQty: 0, institutionQty: 0, individualQty: 0 },
    { date: "2025-09-02", close: 1, foreign: 20, institution: 10, individual: -30, foreignQty: 0, institutionQty: 0, individualQty: 0 },
    // until 테스트 전용 — 이 거대한 흐름이 09-03(기준일 이후)에 있다.
    // until을 걸었을 때 이 값이 섞이면 look-ahead가 재발했다는 뜻이다.
    { date: "2025-09-03", close: 1, foreign: 1_000_000, institution: 1_000_000, individual: -2_000_000, foreignQty: 0, institutionQty: 0, individualQty: 0 },
  ],
};

describe("until 옵션 — 매매일 전 거래일까지만 집계(C1 가드)", () => {
  it("sectorTotals: until 이후 날짜의 거대한 흐름이 합계에 섞이지 않는다", () => {
    const [total] = sectorTotals([untilFixture], 10, "2025-09-02");
    expect(total.foreign).toBe(10 + 20);
    expect(total.institution).toBe(5 + 10);
    expect(total.individual).toBe(-15 + -30);
  });

  it("sectorTotals: tradingDays는 until 이하 날짜만 센다", () => {
    const [total] = sectorTotals([untilFixture], 10, "2025-09-02");
    expect(total.tradingDays).toBe(2);
  });

  it("sectorTotals: until이 전체 데이터보다 이르면 크래시 없이 0으로 수렴한다", () => {
    const [total] = sectorTotals([untilFixture], 10, "2025-08-01");
    expect(total.tradingDays).toBe(0);
    expect(total.foreign).toBe(0);
    expect(total.institution).toBe(0);
    expect(total.individual).toBe(0);
    expect(total.other).toBe(0);
    expect(total.otherRatio).toBe(0);
    expect(total.unreliable).toBe(false);
  });

  it("sectorTotals: until을 생략하면 이전 동작과 동일하다(하위호환 고정)", () => {
    const withoutUntil = sectorTotals([untilFixture], 10);
    const withUntilAtLastDate = sectorTotals([untilFixture], 10, "2025-09-03");
    expect(withUntilAtLastDate).toEqual(withoutUntil);
  });

  it("stockTotals: until 이후 날짜는 제외하고, 생략 시 기존과 동일하다", () => {
    const [limited] = stockTotals([untilFixture], 10, "2025-09-02");
    expect(limited.tradingDays).toBe(2);
    expect(limited.foreign).toBe(30);

    const withoutUntil = stockTotals([untilFixture], 10);
    const withUntilAtLastDate = stockTotals([untilFixture], 10, "2025-09-03");
    expect(withUntilAtLastDate).toEqual(withoutUntil);
  });

  it("aggregateBySector: until 이후 날짜는 결과 배열에 아예 나타나지 않는다", () => {
    const out = aggregateBySector([untilFixture], "필터섹터", "2025-09-02");
    expect(out.map((d) => d.date)).toEqual(["2025-09-01", "2025-09-02"]);
  });

  it("aggregateBySector: until이 전체 데이터보다 이르면 빈 배열을 반환한다", () => {
    expect(aggregateBySector([untilFixture], "필터섹터", "2025-08-01")).toEqual([]);
  });

  it("aggregateBySector: until을 생략하면 이전 동작과 동일하다(하위호환 고정)", () => {
    const withoutUntil = aggregateBySector([untilFixture], "필터섹터");
    const withUntilAtLastDate = aggregateBySector([untilFixture], "필터섹터", "2025-09-03");
    expect(withUntilAtLastDate).toEqual(withoutUntil);
  });

  // 1단계 태스크 2에서 미룬 항목(F) — "최근 days일"이 저장된 마지막 days개
  // 날짜가 아니라 until 이하 날짜 중 최근 days개여야 한다는 걸 못박는다.
  // 날짜 5개(09-01~09-05) 중 09-04·09-05는 until("2025-09-03") 이후이고,
  // until 이하 날짜는 3개(09-01~09-03)라 days=2 < 3 조건을 만족한다 — 만약
  // 구현이 "저장 배열의 마지막 days개"를 먼저 자르고 나서 until로 걸렀다면
  // (필터 전 슬라이스), 09-04·09-05가 선택돼 버렸을 것이다. 09-04·09-05에는
  // 눈에 띄게 큰 값을 심어 그 잘못이 섞이면 합계가 확 달라지게 한다.
  const filterBeforeSliceFixture: StockFlow = {
    ticker: "U2",
    name: "유틸전자2",
    sector: "필터섹터2",
    days: [
      { date: "2025-09-01", close: 1, foreign: 1, institution: 1, individual: -2, foreignQty: 0, institutionQty: 0, individualQty: 0 },
      { date: "2025-09-02", close: 1, foreign: 10, institution: 10, individual: -20, foreignQty: 0, institutionQty: 0, individualQty: 0 },
      { date: "2025-09-03", close: 1, foreign: 100, institution: 100, individual: -200, foreignQty: 0, institutionQty: 0, individualQty: 0 },
      // until("2025-09-03") 이후 — 걸러져야 한다. 저장 순서상으로는 "마지막
      // days개"에 해당해 필터-후-슬라이스 순서가 깨지면 이 값이 새어 들어온다.
      { date: "2025-09-04", close: 1, foreign: 1_000_000, institution: 1_000_000, individual: -2_000_000, foreignQty: 0, institutionQty: 0, individualQty: 0 },
      { date: "2025-09-05", close: 1, foreign: 10_000_000, institution: 10_000_000, individual: -20_000_000, foreignQty: 0, institutionQty: 0, individualQty: 0 },
    ],
  };

  it("sectorTotals: 저장된 마지막 days개가 아니라 until 이하 날짜 중 최근 days개를 고른다(필터 후 슬라이스 순서 고정)", () => {
    const [total] = sectorTotals([filterBeforeSliceFixture], 2, "2025-09-03");
    // until 이하(09-01~09-03) 중 최근 2개 = 09-02, 09-03. 09-04·09-05가
    // 섞였다면 foreign은 수백만~천만 단위로 튀었을 것이다.
    expect(total.foreign).toBe(10 + 100);
    expect(total.institution).toBe(10 + 100);
    expect(total.tradingDays).toBe(2);
  });
});

describe("flowPersistence — 합계가 아니라 지속성", () => {
  // 외국인+기관 합의 부호만 본다. 값은 일부러 작게.
  const day = (date: string, fi: number) => ({
    date, foreign: fi, institution: 0, individual: -fi, other: 0, stocks: 1,
  });

  it("최근일부터 거꾸로 같은 부호가 이어진 일수를 부호와 함께 돌려준다", () => {
    const days = [day("2025-09-01", 5), day("2025-09-02", -1), day("2025-09-03", -2), day("2025-09-04", -3)];
    expect(flowPersistence(days, 20)).toEqual({ streak: -3, buyDays: 1, tradingDays: 4 });
  });

  it("순매수 연속이면 양수 streak", () => {
    const days = [day("2025-09-01", -5), day("2025-09-02", 1), day("2025-09-03", 2)];
    expect(flowPersistence(days, 20).streak).toBe(2);
  });

  it("창(window) 밖의 날짜는 세지 않는다 — 최근 N일만", () => {
    const days = [day("2025-09-01", 9), day("2025-09-02", 9), day("2025-09-03", -1), day("2025-09-04", -1)];
    expect(flowPersistence(days, 2)).toEqual({ streak: -2, buyDays: 0, tradingDays: 2 });
  });

  it("마지막 날 합이 정확히 0이면 streak 0 (부호 없음), 0인 날은 순매수일로 세지 않는다", () => {
    const days = [day("2025-09-01", 3), day("2025-09-02", 0)];
    expect(flowPersistence(days, 20)).toEqual({ streak: 0, buyDays: 1, tradingDays: 2 });
  });

  it("빈 입력이면 전부 0", () => {
    expect(flowPersistence([], 20)).toEqual({ streak: 0, buyDays: 0, tradingDays: 0 });
  });
});
