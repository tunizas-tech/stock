import { describe, expect, it } from "vitest";
import { parseAgentInput } from "./agent-input";

const OK = { ticker: "247540", name: "에코프로비엠", sector: "배터리", reason: "① 뉴스 ② 이유 ③ 반대 https://n.news.naver.com/x", emotion: 3, tags: ["뉴스", "뉴스"] };

describe("parseAgentInput", () => {
  it("정상 입력은 tags 중복을 제거해 돌려준다", () => {
    const r = parseAgentInput(OK);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.tags).toEqual(["뉴스"]);
  });
  it.each([
    ["ticker", { ticker: "AAPL" }],
    ["ticker", { ticker: "12345" }],
    ["name", { name: "" }],
    ["sector", { sector: "우주" }],
    ["reason", { reason: "출처 없음" }],
    ["reason", { reason: "x".repeat(1001) + " http://a" }],
    ["emotion", { emotion: 0 }],
    ["emotion", { emotion: 6 }],
    ["emotion", { emotion: 1.5 }],
    ["tags", { tags: ["에이전트"] }],
    ["tags", { tags: ["없는태그"] }],
    ["action", { action: "buy" }],
    ["action", { action: "skip" }],
    ["date", { date: "2026-09-08" }],
    ["price", { price: 1 }],
    ["qty", { qty: 1 }],
  ])("%s 위반 → ok:false, field=%s", (field, patch) => {
    const r = parseAgentInput({ ...OK, ...patch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe(field);
  });
});
