import { describe, it, expect } from "vitest";
import { stageColor, STAGE_PALETTE } from "./valuechain-theme";

describe("stageColor", () => {
  it("인덱스 순서로 팔레트 색을 반환한다", () => {
    expect(stageColor(0)).toBe(STAGE_PALETTE[0]);
    expect(stageColor(2)).toBe(STAGE_PALETTE[2]);
  });
  it("팔레트 길이를 넘으면 순환한다", () => {
    expect(stageColor(STAGE_PALETTE.length)).toBe(STAGE_PALETTE[0]);
    expect(stageColor(STAGE_PALETTE.length + 1)).toBe(STAGE_PALETTE[1]);
  });
});
