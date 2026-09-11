// node:fs를 메모리 맵으로 대체해 라우트의 배선(파라미터 검증, 파일 찾기, 없으면 404 + hint)만
// 검증한다. 평단 계산은 src/lib/flow/avg-price.test.ts가 이미 검증한다.
import { afterEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();

vi.mock("node:fs", () => ({
  existsSync: (p: string) => files.has(p),
  readFileSync: (p: string) => {
    const v = files.get(p);
    if (v === undefined) throw new Error(`ENOENT: ${p}`);
    return v;
  },
}));

import { GET } from "./route";

const req = (qs: string) => new Request(`http://localhost/api/flow${qs}`);

afterEach(() => files.clear());

describe("GET /api/flow", () => {
  it("ticker가 6자리 숫자가 아니면 400", async () => {
    expect((await GET(req(""))).status).toBe(400);
    expect((await GET(req("?ticker=../x"))).status).toBe(400);
  });

  it("window가 5·20·60이 아니면 400", async () => {
    files.set("data/flow/009540.json", JSON.stringify({ ticker: "009540", name: "HD한국조선해양", sector: "조선", days: [] }));
    expect((await GET(req("?ticker=009540&window=7"))).status).toBe(400);
  });

  it("파일이 없으면 404와 flow:fetch 안내", async () => {
    const res = await GET(req("?ticker=009540"));
    expect(res.status).toBe(404);
    expect((await res.json()).hint).toContain("flow:fetch");
  });

  it("파일이 있으면 buildAvgPriceView 결과를 돌려주고 window 기본은 20", async () => {
    const days = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-08-${String(11 + i).padStart(2, "0")}`, close: 346500,
      foreign: i === 0 ? 50906 : 0, institution: 0, individual: 0,
      foreignQty: i === 0 ? 127674 : 0, institutionQty: 0, individualQty: 0,
    }));
    files.set("data/flow/009540.json", JSON.stringify({ ticker: "009540", name: "HD한국조선해양", sector: "조선", days }));
    const res = await GET(req("?ticker=009540"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.window).toBe(20);
    expect(body.actors.foreign.avgPrice).toBe(398719);
    expect(body.close).toBe(346500);
  });

  it("손상된 파일은 500이 아니라 404로 다룬다", async () => {
    files.set("data/flow/009540.json", "{not json");
    expect((await GET(req("?ticker=009540"))).status).toBe(404);
  });
});
