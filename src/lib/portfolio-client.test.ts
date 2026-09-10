import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteHoldingEntry, fetchHoldings, patchHoldingSector, postWatch } from "./portfolio-client";

afterEach(() => vi.restoreAllMocks());

describe("portfolio-client", () => {
  it("fetchHoldings는 holdings를 꺼낸다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ holdings: [{ id: "h" }] }), { status: 200 })));
    expect(await fetchHoldings()).toEqual([{ id: "h" }]);
  });
  it("실패는 field: error 메시지로 던진다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "YYYY-MM-DD", field: "addedAt" }), { status: 400 })));
    await expect(postWatch({} as never)).rejects.toThrow(/addedAt: YYYY-MM-DD/);
  });
  it("deleteHoldingEntry는 id를 URL 인코딩한다 — 슬래시가 섞인 id가 경로를 바꾸면 안 된다", async () => {
    // vi.fn(async () => ...)로 쓰면 인자 없는 화살표 함수 시그니처를 그대로 물려받아
    // mock.calls[0][0] 인덱싱이 타입 에러가 난다 — mockResolvedValue로 우회(다른 테스트와 동일 패턴).
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await deleteHoldingEntry("a/b");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/holdings/a%2Fb");
  });
  it("patchHoldingSector는 PATCH /api/holdings/:id 에 {sector}를 보내고 바뀐 행을 받는다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "h1", sector: "소재" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await patchHoldingSector("h1", "소재");
    expect(r.sector).toBe("소재");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/holdings/h1");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ sector: "소재" });
  });
  it("patchHoldingSector(undefined)는 sector: null 로 자동 판정 복귀를 요청한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "h1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await patchHoldingSector("h1", undefined);
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ sector: null });
  });
});
