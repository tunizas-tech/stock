import { describe, expect, it } from "vitest";
import { isAfterCloseKst, kstDate, todayKst } from "./kst";

describe("kstDate", () => {
  it("UTC 15:30은 KST 다음 날 00:30이다", () => {
    expect(kstDate("2026-09-07T15:30:00.000Z")).toBe("2026-09-08");
  });
  it("UTC 14:59는 KST 같은 날 23:59다", () => {
    expect(kstDate("2026-09-07T14:59:00.000Z")).toBe("2026-09-07");
  });
  it("Date 객체도 받는다", () => {
    expect(kstDate(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01-01");
  });
});

describe("todayKst", () => {
  it("now를 주입해 결정적으로 계산한다", () => {
    expect(todayKst(new Date("2026-09-07T16:00:00.000Z"))).toBe("2026-09-08");
  });
});

describe("isAfterCloseKst — 그 날짜의 15:30 KST(=06:30Z) 기준", () => {
  it("07:30 KST 기록은 마감 전", () => {
    expect(isAfterCloseKst("2026-09-07T22:30:00.000Z", "2026-09-08")).toBe(false);
  });
  it("15:30 KST 정각은 마감 후", () => {
    expect(isAfterCloseKst("2026-09-08T06:30:00.000Z", "2026-09-08")).toBe(true);
  });
  it("15:29 KST는 마감 전", () => {
    expect(isAfterCloseKst("2026-09-08T06:29:59.000Z", "2026-09-08")).toBe(false);
  });
  it("어제 날짜 기록을 오늘 아침에 쓰면 어제 마감 후다", () => {
    expect(isAfterCloseKst("2026-09-08T22:30:00.000Z", "2026-09-08")).toBe(true);
  });
  it("깨진 createdAt은 마감 후로 본다(보수적: 다음 거래일 진입)", () => {
    expect(isAfterCloseKst("nope", "2026-09-08")).toBe(true);
  });
});
