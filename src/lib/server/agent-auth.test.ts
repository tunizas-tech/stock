import { describe, expect, it } from "vitest";
import { checkAgentBearer, isAgentRoute } from "./agent-auth";

describe("isAgentRoute — (메서드, 경로) 완전 일치 3개만", () => {
  it.each([
    ["POST", "/api/journal/agent", true],
    ["GET", "/api/news", true],
    ["GET", "/api/observatory", true],
    ["GET", "/api/journal/agent", false],
    ["POST", "/api/news/sync", false],
    ["GET", "/api/journal", false],
    ["GET", "/api/news/", false],
    ["POST", "/api/journal/agent/", false],
    ["GET", "/journal/review", false],
  ])("%s %s → %s", (m, p, want) => {
    expect(isAgentRoute(m, p)).toBe(want);
  });
});

describe("checkAgentBearer", () => {
  it("토큰이 비면 무엇을 보내도 거부", () => {
    expect(checkAgentBearer("Bearer abc", undefined)).toBe(false);
    expect(checkAgentBearer("Bearer abc", "")).toBe(false);
  });
  it("정확히 일치해야 통과", () => {
    expect(checkAgentBearer("Bearer s3cret", "s3cret")).toBe(true);
    expect(checkAgentBearer("Bearer s3cre", "s3cret")).toBe(false);
    expect(checkAgentBearer("Bearer s3cret!", "s3cret")).toBe(false);
    expect(checkAgentBearer("Basic s3cret", "s3cret")).toBe(false);
    expect(checkAgentBearer(null, "s3cret")).toBe(false);
  });
});
