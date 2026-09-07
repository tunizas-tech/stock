// getPool을 가짜 Queryable로 바꿔 라우트의 배선만 검증한다(SQL은 journal-repo.test가 검증).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = { pool: null as null | { query: ReturnType<typeof vi.fn> } };
vi.mock("@/lib/server/db", () => ({ getPool: () => state.pool }));

import { GET, POST } from "./route";
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

// mode 케이스는 src/app/api/portfolio.test.ts로 옮겼다 — /api/journal/mode는
// 이제 /api/storage/mode로 가는 307 리다이렉트이고, {mode} 200을 돌려주지 않는다.

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
  // I-4: 클라이언트가 준 createdAt을 그대로 쓰면 봉인 기준일(첫 createdAt)을 과거로
  // 밀어 봉인을 열 수 있고, 거래일 종가 이전 시각을 보내 "당일 종가 진입"을 만들 수도
  // 있다. 폼은 늘 now를 보내므로 이 문에서 통과시킬 이유가 없다(이관 문만 받는다).
  it("createdAt을 보내도 서버 시각으로 덮어쓴다", async () => {
    await POST(req("POST", "/api/journal", { ...draft, createdAt: "2020-01-01T00:00:00.000Z" }));
    const params = state.pool!.query.mock.calls[0][1] as unknown[];
    expect(params[14]).not.toBe("2020-01-01T00:00:00.000Z");
    expect(Date.parse(params[14] as string)).toBeGreaterThan(Date.parse("2025-01-01T00:00:00.000Z"));
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
    expect(await res.json()).toEqual({ inserted: 1, skipped: 1, rejected: [] });
  });
  it("entries가 배열이 아니면 400", async () => {
    expect((await IMPORT(req("POST", "/api/journal/import", { entries: "no" }))).status).toBe(400);
  });
  // M-8: 이관 문은 Basic Auth 뒤이지만 author를 본문에서 받지 않는다는 것이 이 갈래의
  // 가장 강한 불변식이다 — 사람이 올린 행이 에이전트 관망 채점에 섞이면 안 된다.
  it("author=agent를 실어 보내도 user로 저장한다", async () => {
    await IMPORT(req("POST", "/api/journal/import", { entries: [{ ...ROW, id: "x1", author: "agent" }] }));
    const params = state.pool!.query.mock.calls[0][1] as unknown[];
    expect(params[15]).toBe("user");
  });
  // I-6: 한 행이 형식에서 벗어났다고 전체 이관을 막으면, localStorage를 고칠 UI가
  // 없는 사용자에겐 이관 경로가 영영 닫힌다. 통과한 것만 넣고 나머지는 알려준다.
  it("깨진 행은 건너뛰고 rejected로 알린다", async () => {
    state.pool!.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await IMPORT(
      req("POST", "/api/journal/import", {
        entries: [{ ...ROW, id: "ok1" }, { ...ROW, id: "bad1", emotion: 6 }],
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inserted).toBe(1);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0]).toMatchObject({ index: 1, id: "bad1", field: "emotion" });
  });
});
