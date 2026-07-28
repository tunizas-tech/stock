import { describe, expect, it } from "vitest";
import { fmtMarketCap, fmtRatio, fmtRelative } from "./format";

// PER·PBR 표기: KIS는 데이터가 없을 때 0을 주므로 0과 undefined는 모두 "—".
// 음수는 적자를 뜻하는 유의미한 값이라 그대로 보여준다.

describe("fmtRatio", () => {
  it("소수 1자리로 자른다", () => {
    expect(fmtRatio(80.39)).toBe("80.4");
  });

  it("데이터 없음(0)은 —", () => {
    expect(fmtRatio(0)).toBe("—");
  });

  it("undefined는 —", () => {
    expect(fmtRatio(undefined)).toBe("—");
  });

  it("음수(적자)는 그대로 보여준다", () => {
    expect(fmtRatio(-15.24)).toBe("-15.2");
  });
});

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

describe("fmtRelative", () => {
  const now = new Date("2026-07-27T12:00:00.000Z");

  it("1분 미만은 '방금 전'", () => {
    expect(fmtRelative("2026-07-27T11:59:30.000Z", now)).toBe("방금 전");
  });
  it("분 단위", () => {
    expect(fmtRelative("2026-07-27T11:30:00.000Z", now)).toBe("30분 전");
  });
  it("시간 단위", () => {
    expect(fmtRelative("2026-07-27T09:00:00.000Z", now)).toBe("3시간 전");
  });
  it("일 단위", () => {
    expect(fmtRelative("2026-07-25T12:00:00.000Z", now)).toBe("2일 전");
  });
  it("파싱 불가면 빈 문자열", () => {
    expect(fmtRelative("nope", now)).toBe("");
  });
});
