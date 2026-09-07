import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  pool: null as null | { query: ReturnType<typeof vi.fn> },
  token: "t0k" as string | undefined,
  now: new Date("2026-09-07T22:30:00.000Z"), // 09-08 07:30 KST
};
vi.mock("@/lib/server/db", () => ({ getPool: () => state.pool }));
vi.mock("@/lib/server/snapshot-data", () => ({
  loadSnapshotInputs: () => ({ ticker: "247540", date: "2026-09-08", sector: "배터리", kospiCandles: [], nasdaqCandles: [], flows: [], sectorEtfCandles: {}, stockCandles: undefined }),
}));

import { POST } from "./route";

const OK = { ticker: "247540", name: "에코프로비엠", sector: "배터리", reason: "뉴스 https://a.b/c", emotion: 3 };
const INSERTED = { id: "a1", date: "2026-09-08", market: "KR", ticker: "247540", name: "에코프로비엠", action: "skip", price: null, qty: null, reason: "뉴스 https://a.b/c", emotion: 3, lesson: "", primaryTag: "에이전트", tags: null, snapshot: { asOf: "", coverage: "none" }, createdAt: state.now, author: "agent", sector: "배터리" };

function post(body: unknown) {
  return POST(new Request("http://localhost/api/journal/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.useFakeTimers({ now: state.now });
  process.env.AGENT_TOKEN = "t0k";
  state.pool = { query: vi.fn(async (text: string) => {
    if (/count\(\*\)/.test(text)) return { rows: [{ n: 0 }], rowCount: 1 };
    if (/select 1 as one/.test(text)) return { rows: [], rowCount: 0 };
    return { rows: [INSERTED], rowCount: 1 };
  }) };
});
afterEach(() => { vi.useRealTimers(); delete process.env.AGENT_TOKEN; });

describe("POST /api/journal/agent", () => {
  it("201 — 서버가 skip·오늘(KST)·author=agent·primaryTag=에이전트·createdAt·snapshot을 채운다", async () => {
    const res = await post(OK);
    expect(res.status).toBe(201);
    const params = state.pool!.query.mock.calls.find((c) => /insert into journal/.test(c[0] as string))![1] as unknown[];
    expect(params[1]).toBe("2026-09-08");     // date = todayKst
    expect(params[5]).toBe("skip");            // action
    expect(params[11]).toBe("에이전트");        // primaryTag
    expect(params[15]).toBe("agent");          // author
    expect(params[16]).toBe("배터리");          // sector
    expect(typeof params[13]).toBe("string");  // snapshot jsonb
    expect(params[14]).toBe(state.now.toISOString());
  });
  it("검증 실패 400 + field", async () => {
    const res = await post({ ...OK, action: "buy" });
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("action");
  });
  it("오늘 3건이면 429", async () => {
    state.pool!.query.mockImplementation(async (text: string) => /count\(\*\)/.test(text) ? { rows: [{ n: 3 }], rowCount: 1 } : { rows: [], rowCount: 0 });
    expect((await post(OK)).status).toBe(429);
  });
  it("같은 종목 이미 있으면 409", async () => {
    state.pool!.query.mockImplementation(async (text: string) => {
      if (/count\(\*\)/.test(text)) return { rows: [{ n: 1 }], rowCount: 1 };
      if (/select 1 as one/.test(text)) return { rows: [{ one: 1 }], rowCount: 1 };
      return { rows: [INSERTED], rowCount: 1 };
    });
    expect((await post(OK)).status).toBe(409);
  });
  it("AGENT_TOKEN 없으면 503(미들웨어를 우회해 들어와도 닫혀 있다)", async () => {
    delete process.env.AGENT_TOKEN;
    expect((await post(OK)).status).toBe(503);
  });
  it("풀 없으면 503", async () => {
    state.pool = null;
    expect((await post(OK)).status).toBe(503);
  });
});
