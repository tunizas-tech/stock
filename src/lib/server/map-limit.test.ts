import { describe, it, expect } from "vitest";
import { mapLimit } from "./map-limit";

// 외부 API(KIS)는 초당 요청 수를 제한한다. 한꺼번에 던지면 일부가 실패해
// 조용히 mock으로 떨어지므로 동시 실행 수를 묶는다.

describe("mapLimit", () => {
  it("입력 순서대로 결과를 돌려준다", async () => {
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => n * 2);
    expect(out).toEqual([2, 4, 6, 8, 10]);
  });

  it("동시 실행 수가 limit을 넘지 않는다", async () => {
    let running = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 10 }, (_, i) => i), 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("빈 배열은 빈 배열", async () => {
    expect(await mapLimit([], 3, async (n) => n)).toEqual([]);
  });
});
