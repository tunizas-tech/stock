import { describe, expect, it } from "vitest";
import { parseHolding, parseImportId, parseSectorPatch, parseWatch } from "./validate";

const H = { market: "KR", ticker: "005930", name: "삼성전자", shares: 10, avgPrice: 70000, openedAt: "2026-09-01" };
const W = { market: "US", ticker: "NVDA", name: "엔비디아", memo: "", addedAt: "2026-09-01" };

describe("parseHolding", () => {
  it("정상 입력은 그대로", () => {
    const r = parseHolding(H);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(H);
  });
  it.each([
    ["market", { market: "JP" }],
    ["ticker", { ticker: "12345" }],
    ["ticker", { ticker: "nvda" }],
    ["name", { name: "" }],
    ["name", { name: "x".repeat(61) }],
    ["shares", { shares: 0 }],
    ["shares", { shares: -1 }],
    ["shares", { shares: "10" }],
    ["shares", { shares: Infinity }],
    ["avgPrice", { avgPrice: -1 }],
    ["avgPrice", { avgPrice: null }],
    ["openedAt", { openedAt: "2026/09/01" }],
  ])("%s 위반 → field=%s", (field, patch) => {
    const r = parseHolding({ ...H, ...patch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe(field);
  });
  it("소수 주식(미국)은 허용", () => {
    expect(parseHolding({ ...H, market: "US", ticker: "AAPL", shares: 0.5 }).ok).toBe(true);
  });
  it("avgPrice 0은 허용(무상 취득)", () => {
    expect(parseHolding({ ...H, avgPrice: 0 }).ok).toBe(true);
  });
  it("sector는 관측소 섹터·기타만 허용, 생략·빈 문자열은 키 없이", () => {
    const ok = parseHolding({ ...H, sector: "반도체" });
    expect(ok.ok && ok.value.sector).toBe("반도체");
    const bad = parseHolding({ ...H, sector: "우주" });
    expect(!bad.ok && bad.field).toBe("sector");
    const empty = parseHolding({ ...H, sector: "" });
    expect(empty.ok && "sector" in empty.value).toBe(false);
  });
});

describe("parseSectorPatch", () => {
  it("유효한 섹터는 그대로, 빈 문자열·null은 undefined(자동으로 되돌림)", () => {
    expect(parseSectorPatch({ sector: "기타" })).toEqual({ ok: true, value: "기타" });
    expect(parseSectorPatch({ sector: "" })).toEqual({ ok: true, value: undefined });
    expect(parseSectorPatch({ sector: null })).toEqual({ ok: true, value: undefined });
  });
  it("모르는 섹터·키 없음은 실패", () => {
    expect(parseSectorPatch({ sector: "우주" }).ok).toBe(false);
    expect(parseSectorPatch({}).ok).toBe(false);
  });
});

describe("parseWatch", () => {
  it("정상 입력·memo 생략 시 빈 문자열", () => {
    const r = parseWatch({ ...W, memo: undefined });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.memo).toBe("");
  });
  it("memo: null도 빈 문자열로 허용 — 옛 localStorage 행의 실제 유입 형태(validate.ts:30)", () => {
    const r = parseWatch({ ...W, memo: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.memo).toBe("");
  });
  it.each([
    ["memo", { memo: "x".repeat(501) }],
    ["memo", { memo: 3 }],
    ["addedAt", { addedAt: "" }],
    ["ticker", { ticker: "ABCDEF" }],
  ])("%s 위반 → field=%s", (field, patch) => {
    const r = parseWatch({ ...W, ...patch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe(field);
  });
});

describe("parseImportId", () => {
  it("1~64자 문자열만", () => {
    expect(parseImportId("h-1")).toBe("h-1");
    expect(parseImportId("")).toBeUndefined();
    expect(parseImportId("x".repeat(65))).toBeUndefined();
    expect(parseImportId(3)).toBeUndefined();
  });
  it("경계값 1자·64자는 허용", () => {
    expect(parseImportId("x")).toBe("x");
    expect(parseImportId("x".repeat(64))).toBe("x".repeat(64));
  });
});
