import { describe, it, expect } from "vitest";
import { VALUE_CHAINS, getValueChain } from "./valuechains";

describe("valuechains", () => {
  it("SK이터닉스 시드를 slug로 찾는다", () => {
    const c = getValueChain("sk-eternix-renewable");
    expect(c?.title).toContain("SK이터닉스");
    expect(c?.stages.length).toBe(4);
  });
  it("없는 slug는 undefined", () => {
    expect(getValueChain("nope")).toBeUndefined();
  });
  it("모든 밸류체인 slug는 고유하다", () => {
    const slugs = VALUE_CHAINS.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
  it("각 단계는 최소 1개 종목을 가진다", () => {
    for (const c of VALUE_CHAINS) {
      for (const s of c.stages) {
        expect(s.nodes.length).toBeGreaterThan(0);
      }
    }
  });
  it("모든 밸류체인은 단계를 가진다", () => {
    for (const c of VALUE_CHAINS) {
      expect(c.stages.length).toBeGreaterThan(0);
    }
  });
  it("모든 밸류체인은 유효한 status를 가진다", () => {
    for (const c of VALUE_CHAINS) {
      expect(["draft", "published"]).toContain(c.status);
    }
  });
  it("모든 밸류체인은 출처를 2개 이상 가진다", () => {
    for (const c of VALUE_CHAINS) {
      expect(c.sources.length).toBeGreaterThanOrEqual(2);
    }
  });
});
