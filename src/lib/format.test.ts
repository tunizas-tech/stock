import { describe, expect, it } from "vitest";
import { fmtMarketCap } from "./format";

// 시가총액 표기: 시장 관용 단위(KR 억 원 → 1조 이상은 조, US 백만 달러 → $1B 이상은 B).

describe("fmtMarketCap", () => {
  it("KR: 1조 미만은 억", () => {
    expect(fmtMarketCap(4500, "KR")).toBe("4,500억");
  });

  it("KR: 1조 이상은 조 (소수 1자리)", () => {
    expect(fmtMarketCap(4292122, "KR")).toBe("429.2조");
  });

  it("US: $1B 미만은 M", () => {
    expect(fmtMarketCap(850, "US")).toBe("$850M");
  });

  it("US: $1B 이상은 B (소수 1자리)", () => {
    expect(fmtMarketCap(2900000, "US")).toBe("$2,900.0B");
  });

  it("결측이면 — 를 돌려준다", () => {
    expect(fmtMarketCap(undefined, "KR")).toBe("—");
  });
});
