// getPool을 가짜 Queryable로 바꿔 라우트의 배선만 검증한다(SQL은 journal-repo.test가 검증).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = { pool: null as null | { query: ReturnType<typeof vi.fn> } };
vi.mock("@/lib/server/db", () => ({ getPool: () => state.pool }));

import { GET, POST } from "./route";
import { GET as MODE } from "./mode/route";
import { PATCH, DELETE } from "./[id]/route";
import { POST as IMPORT } from "./import/route";

const ROW = {
  id: "u1", date: "2026-09-08", market: "KR", ticker: "005930", name: "삼성전자", action: "buy",
  price: 70000, qty: 10, reason: "r", emotion: 3, lesson: "", primaryTag: "수급", tags: null,
  snapshot: null, createdAt: new Date("2026-09-08T01:00:00.000Z"), author: "user", sector: null,
};

function req(method: string, url: string, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  state.pool = { query: vi.fn(async () => ({ rows: [ROW], rowCount: 1 })) };
});
afterEach(() => vi.clearAllMocks());

describe("mode", () => {
  it("풀이 있으면 server", async () => {
    const res = await MODE();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: "server" });
  });
  it("풀이 없으면 503", async () => {
    state.pool = null;
    expect((await MODE()).status).toBe(503);
  });
});

describe("GET /api/journal", () => {
  it("entries 배열을 돌려준다", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.entries[0].id).toBe("u1");
    expect(body.entries[0].createdAt).toBe("2026-09-08T01:00:00.000Z");
  });
});

describe("POST /api/journal", () => {
  const draft = {
    date: "2026-09-08", market: "KR", ticker: "005930", name: "삼성전자", action: "buy",
    price: 70000, qty: 10, reason: "r", emotion: 3, lesson: "", primaryTag: "수급",
  };
  it("id·author=user·createdAt을 채워 저장하고 201", async () => {
    const res = await POST(req("POST", "/api/journal", draft));
    expect(res.status).toBe(201);
    const params = state.pool!.query.mock.calls[0][1] as unknown[];
    expect(typeof params[0]).toBe("string");          // id
    expect(params[15]).toBe("user");                   // author
    expect(typeof params[14]).toBe("string");          // createdAt ISO
  });
  it("author=agent로 보내도 user로 덮어쓴다", async () => {
    await POST(req("POST", "/api/journal", { ...draft, author: "agent" }));
    const params = state.pool!.query.mock.calls[0][1] as unknown[];
    expect(params[15]).toBe("user");
  });
  it("emotion 6은 400 + field", async () => {
    const res = await POST(req("POST", "/api/journal", { ...draft, emotion: 6 }));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("emotion");
  });
  it("풀 없으면 503", async () => {
    state.pool = null;
    expect((await POST(req("POST", "/api/journal", draft))).status).toBe(503);
  });
});

describe("PATCH/DELETE /api/journal/[id]", () => {
  it("lesson만 갱신, 없는 id는 404", async () => {
    const res = await PATCH(req("PATCH", "/api/journal/u1", { lesson: "복기" }), { params: { id: "u1" } });
    expect(res.status).toBe(204);
    state.pool!.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const miss = await DELETE(req("DELETE", "/api/journal/zzz"), { params: { id: "zzz" } });
    expect(miss.status).toBe(404);
  });
  it("lesson이 문자열이 아니면 400", async () => {
    const res = await PATCH(req("PATCH", "/api/journal/u1", { lesson: 3 }), { params: { id: "u1" } });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/journal/import", () => {
  it("배열을 받아 inserted/skipped를 돌려준다", async () => {
    state.pool!.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await IMPORT(req("POST", "/api/journal/import", { entries: [{ ...ROW, id: "x1", createdAt: undefined }, { ...ROW, id: "x2" }] }));
    expect(await res.json()).toEqual({ inserted: 1, skipped: 1 });
  });
  it("entries가 배열이 아니면 400", async () => {
    expect((await IMPORT(req("POST", "/api/journal/import", { entries: "no" }))).status).toBe(400);
  });
});
