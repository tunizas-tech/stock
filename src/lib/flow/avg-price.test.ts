import { describe, expect, it } from "vitest";
import type { FlowDay } from "./aggregate";
import { buildAvgPriceView, closeRange, pricePositionPct, supplyAvgPrice } from "./avg-price";

// 테스트용 하루치. 값은 백만원·주 — 실제 파일과 같은 단위.
function day(
  date: string,
  close: number,
  v: Partial<Pick<FlowDay, "foreign" | "institution" | "individual">> = {},
  q: Partial<Pick<FlowDay, "foreignQty" | "institutionQty" | "individualQty">> = {},
): FlowDay {
  return {
    date, close,
    foreign: v.foreign ?? 0, institution: v.institution ?? 0, individual: v.individual ?? 0,
    foreignQty: q.foreignQty ?? 0, institutionQty: q.institutionQty ?? 0, individualQty: q.individualQty ?? 0,
  };
}

// 20일을 한 줄로: 첫날에 ΣV·ΣQ를 몰아 넣고 나머지 19일은 0 — 창 슬라이싱과 무관하게
// 합계만 검증하기 위해. 종가는 마지막 날만 의미 있다.
function twentyDays(last: Partial<FlowDay>, first: Partial<FlowDay> = {}): FlowDay[] {
  const days: FlowDay[] = [];
  for (let i = 0; i < 20; i++) {
    const d = day(`2026-08-${String(11 + i).padStart(2, "0")}`, 346500);
    days.push(i === 0 ? { ...d, ...first } : i === 19 ? { ...d, ...last } : d);
  }
  return days;
}

describe("supplyAvgPrice", () => {
  it("백만원 × 1,000,000 / 주 = 원 — 009540 20일 외국인 실측값 398,719원, 종가 대비 −13.10%", () => {
    const days = twentyDays({ close: 346500 }, { foreign: 50906, foreignQty: 127674 });
    const r = supplyAvgPrice(days, "foreign", 20);
    expect(r.avgPrice).toBe(398719);
    expect(r.side).toBe("buy");
    expect(r.returnPct).toBeCloseTo(-13.1, 1);
    expect(r.sumValue).toBe(50906);
    expect(r.sumQty).toBe(127674);
    expect(r.tradingDays).toBe(20);
    expect(r.reason).toBeUndefined();
  });

  it("ΣQ=0이면 null, reason zero-qty (백필 구간 개인처럼 매매 자체가 없는 창)", () => {
    const r = supplyAvgPrice(twentyDays({}), "individual", 20);
    expect(r).toMatchObject({ avgPrice: null, side: null, returnPct: null, reason: "zero-qty", sumQty: 0 });
  });

  it("ΣV와 ΣQ의 부호가 엇갈리면 null, reason sign-mismatch", () => {
    // 비싸게 사고(+금액 크게) 더 많이 싸게 팔아(−수량) 금액은 +인데 수량은 −인 창
    const days = twentyDays({}, { foreign: 1000, foreignQty: -500 });
    const r = supplyAvgPrice(days, "foreign", 20);
    expect(r).toMatchObject({ avgPrice: null, reason: "sign-mismatch", sumValue: 1000, sumQty: -500 });
  });

  it("ΣQ<0이고 ΣV<0이면 매도평단 side=sell — 009540 기관 383,475원, 종가는 그보다 9.64% 아래", () => {
    const days = twentyDays({ close: 346500 }, { institution: -77980, institutionQty: -203351 });
    const r = supplyAvgPrice(days, "institution", 20);
    expect(r.avgPrice).toBe(383475);
    expect(r.side).toBe("sell");
    expect(r.returnPct).toBeCloseTo(-9.64, 1);
  });

  it("창 안에 하루 종가 변동이 40% 이상이면 null, reason corp-action (액면분할 근사)", () => {
    const days = twentyDays({ close: 50000 }, { foreign: 100, foreignQty: 1000 });
    // 11일째부터 1/7 가격 — 분할로 본다
    for (let i = 10; i < 20; i++) days[i] = { ...days[i], close: 50000 };
    const r = supplyAvgPrice(days, "foreign", 20);
    expect(r).toMatchObject({ avgPrice: null, reason: "corp-action" });
  });

  it("창은 마지막 W일만 쓰고, 데이터가 W보다 짧으면 tradingDays가 실제 일수다", () => {
    const days = twentyDays({}, { foreign: 999, foreignQty: 1 });
    // 마지막 5일엔 첫날의 큰 값이 안 들어간다 → ΣQ=0
    expect(supplyAvgPrice(days, "foreign", 5)).toMatchObject({ reason: "zero-qty", tradingDays: 5 });
    expect(supplyAvgPrice(days.slice(0, 3), "foreign", 20).tradingDays).toBe(3);
  });
});

describe("closeRange / pricePositionPct", () => {
  it("창 안 종가의 최저·최고 — 빈 창이면 null", () => {
    const days = twentyDays({ close: 346500 });
    days[3] = { ...days[3], close: 329500 };
    days[7] = { ...days[7], close: 398000 };
    expect(closeRange(days, 20)).toEqual({ low: 329500, high: 398000 });
    expect(closeRange([], 20)).toBeNull();
  });

  it("값의 위치를 0~100으로, 범위 밖은 클램프, low=high면 50", () => {
    expect(pricePositionPct(329500, 329500, 398000)).toBe(0);
    expect(pricePositionPct(398000, 329500, 398000)).toBe(100);
    expect(pricePositionPct(363750, 329500, 398000)).toBe(50);
    expect(pricePositionPct(100, 329500, 398000)).toBe(0);
    expect(pricePositionPct(999999, 329500, 398000)).toBe(100);
    expect(pricePositionPct(5, 5, 5)).toBe(50);
  });
});

describe("buildAvgPriceView", () => {
  it("종목 메타 + 창 종가 범위 + 3주체 평단을 한 응답으로 묶는다", () => {
    const days = twentyDays({ close: 346500 }, { foreign: 50906, foreignQty: 127674, institution: -77980, institutionQty: -203351 });
    const view = buildAvgPriceView({ ticker: "009540", name: "HD한국조선해양", sector: "조선", days }, 20);
    expect(view).toMatchObject({
      ticker: "009540", name: "HD한국조선해양", sector: "조선", window: 20,
      asOf: "2026-08-30", close: 346500, closeLow: 346500, closeHigh: 346500, tradingDays: 20,
    });
    expect(view.actors.foreign.avgPrice).toBe(398719);
    expect(view.actors.institution.side).toBe("sell");
    expect(view.actors.individual.reason).toBe("zero-qty");
  });

  it("days가 비어 있으면 asOf·close·범위는 null이고 주체는 전부 zero-qty", () => {
    const view = buildAvgPriceView({ ticker: "x", name: "x", sector: "x", days: [] }, 20);
    expect(view).toMatchObject({ asOf: null, close: null, closeLow: null, closeHigh: null, tradingDays: 0 });
    expect(view.actors.foreign.reason).toBe("zero-qty");
  });
});
