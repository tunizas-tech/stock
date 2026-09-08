import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = { pool: null as null | { query: ReturnType<typeof vi.fn> } };
vi.mock("@/lib/server/db", () => ({ getPool: () => state.pool }));

import { GET as HGET, POST as HPOST } from "./holdings/route";
import { DELETE as HDEL } from "./holdings/[id]/route";
import { POST as HIMPORT } from "./holdings/import/route";
import { GET as WGET, POST as WPOST } from "./watchlist/route";
import { POST as WIMPORT } from "./watchlist/import/route";
import { GET as MODE } from "./storage/mode/route";

const HROW = { id: "h1", market: "KR", ticker: "005930", name: "삼성전자", shares: 30, avgPrice: 71200, openedAt: "2025-11-04" };
const WROW = { id: "w1", market: "US", ticker: "NVDA", name: "엔비디아", memo: "", addedAt: "2026-01-02" };
const req = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => { state.pool = { query: vi.fn(async () => ({ rows: [HROW], rowCount: 1 })) }; });
afterEach(() => vi.clearAllMocks());

describe("storage/mode", () => {
  it("풀 있으면 server, 없으면 local — 둘 다 200", async () => {
    expect(await (await MODE()).json()).toEqual({ mode: "server" });
    state.pool = null;
    const res = await MODE();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: "local" });
  });
});

describe("holdings", () => {
  it("GET → {holdings}", async () => {
    expect((await (await HGET()).json()).holdings[0].id).toBe("h1");
  });
  it("POST는 id를 서버가 채우고 201", async () => {
    const { id: _omit, ...draft } = HROW; void _omit;
    const res = await HPOST(req("POST", "/api/holdings", { ...draft, id: "attacker" }));
    expect(res.status).toBe(201);
    const params = state.pool!.query.mock.calls[0][1] as unknown[];
    expect(params[0]).not.toBe("attacker");
    expect(typeof params[0]).toBe("string");
  });
  it("shares 0 → 400 field=shares", async () => {
    const res = await HPOST(req("POST", "/api/holdings", { ...HROW, shares: 0 }));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("shares");
  });
  it("DELETE 204 / 없는 id 404", async () => {
    expect((await HDEL(req("DELETE", "/api/holdings/h1"), { params: { id: "h1" } })).status).toBe(204);
    state.pool!.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect((await HDEL(req("DELETE", "/api/holdings/zzz"), { params: { id: "zzz" } })).status).toBe(404);
  });
  it("풀 없으면 503", async () => {
    state.pool = null;
    expect((await HGET()).status).toBe(503);
  });
  it("import는 거절 행을 index와 함께 보고하고 나머지는 넣는다", async () => {
    state.pool!.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await HIMPORT(req("POST", "/api/holdings/import", { rows: [HROW, { ...HROW, id: "h2", shares: -1 }, { ...HROW, id: "" }] }));
    const body = await res.json();
    expect(body.inserted).toBe(1);
    expect(body.rejected.map((r: { index: number; field: string }) => [r.index, r.field])).toEqual([[1, "shares"], [2, "id"]]);
  });
  it("깨진 JSON 본문 → 400 field=body (POST 라우트와 형태 동일)", async () => {
    const res = await HIMPORT(new Request("http://localhost/api/holdings/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" }));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("body");
  });
});

describe("watchlist", () => {
  beforeEach(() => { state.pool = { query: vi.fn(async () => ({ rows: [WROW], rowCount: 1 })) }; });
  it("GET → {watchlist}; POST 201; memo 생략 허용", async () => {
    expect((await (await WGET()).json()).watchlist[0].id).toBe("w1");
    const res = await WPOST(req("POST", "/api/watchlist", { market: "US", ticker: "NVDA", name: "엔비디아", addedAt: "2026-01-02" }));
    expect(res.status).toBe(201);
  });
  it("import 응답 모양", async () => {
    const body = await (await WIMPORT(req("POST", "/api/watchlist/import", { rows: [WROW] }))).json();
    expect(body).toEqual({ inserted: 1, skipped: 0, rejected: [] });
  });
  it("rows가 배열이 아니면 400", async () => {
    expect((await WIMPORT(req("POST", "/api/watchlist/import", { rows: "no" }))).status).toBe(400);
  });
  it("깨진 JSON 본문 → 400 field=body (POST 라우트와 형태 동일)", async () => {
    const res = await WIMPORT(new Request("http://localhost/api/watchlist/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" }));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("body");
  });
});
