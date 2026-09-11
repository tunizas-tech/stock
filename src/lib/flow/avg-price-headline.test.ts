import { describe, expect, it } from "vitest";
import type { SupplyAvgPrice } from "./avg-price";
import { actorSentence, avgPriceHeadline } from "./avg-price-headline";

const base = (over: Partial<SupplyAvgPrice>): SupplyAvgPrice => ({
  actor: "foreign", window: 20, avgPrice: null, side: null, returnPct: null,
  sumValue: 0, sumQty: 0, tradingDays: 20, ...over,
});

describe("actorSentence", () => {
  it("매수평단이 내 평단보다 높고 지금 손실이면 '비싸게 샀고 물려 있음'", () => {
    const a = base({ avgPrice: 398719, side: "buy", returnPct: -13.1 });
    expect(actorSentence(a, 346500)).toBe("외국인은 나보다 15.1% 비싸게 샀고 지금 −13.1% 물려 있음");
  });

  it("매수평단이 내 평단보다 낮고 지금 이익이면 '싸게 샀고 이익 중'", () => {
    const a = base({ avgPrice: 132937, side: "buy", returnPct: 15.2 });
    expect(actorSentence(a, 137000)).toBe("외국인은 나보다 3.0% 싸게 샀고 지금 +15.2% 이익 중");
  });

  it("내 평단과 0.5% 안이면 '나와 비슷한 값에'", () => {
    const a = base({ avgPrice: 100200, side: "buy", returnPct: 0 });
    expect(actorSentence(a, 100000)).toBe("외국인은 나와 비슷한 값에 샀고 지금 평단과 같음");
  });

  it("매도평단은 '평균 N원에 팔았고 종가는 그보다 X% 아래/위'", () => {
    const a = base({ actor: "institution", avgPrice: 383475, side: "sell", returnPct: -9.64 });
    expect(actorSentence(a, 300000)).toBe("기관은 평균 383,475원에 팔았고 종가는 그보다 9.6% 아래");
    const b = base({ actor: "institution", avgPrice: 100000, side: "sell", returnPct: 4 });
    expect(actorSentence(b, 300000)).toBe("기관은 평균 100,000원에 팔았고 종가는 그보다 4.0% 위");
  });

  it("평단이 없으면 이유를 말한다", () => {
    expect(actorSentence(base({ reason: "zero-qty" }), 1)).toBe("외국인은 20일 매매 없음");
    expect(actorSentence(base({ actor: "institution", reason: "sign-mismatch" }), 1)).toBe("기관은 20일 매매가 엇갈려 평단 없음");
    expect(actorSentence(base({ reason: "corp-action" }), 1)).toBe("외국인은 창 안 주가 급변으로 평단 없음");
  });
});

describe("avgPriceHeadline", () => {
  it("외국인 문장 · 기관 문장 순으로 잇는다", () => {
    const foreign = base({ avgPrice: 398719, side: "buy", returnPct: -13.1 });
    const institution = base({ actor: "institution", avgPrice: 383475, side: "sell", returnPct: -9.64 });
    expect(avgPriceHeadline({ actors: { foreign, institution } }, 346500)).toBe(
      "외국인은 나보다 15.1% 비싸게 샀고 지금 −13.1% 물려 있음 · 기관은 평균 383,475원에 팔았고 종가는 그보다 9.6% 아래",
    );
  });

  it("둘 다 없으면 한 문장으로 합친다", () => {
    const foreign = base({ reason: "sign-mismatch" });
    const institution = base({ actor: "institution", reason: "sign-mismatch" });
    expect(avgPriceHeadline({ actors: { foreign, institution } }, 1)).toBe("외국인·기관 모두 20일 평단 없음 (매매가 엇갈림)");
  });
});
