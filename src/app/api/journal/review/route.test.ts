// node:fs를 메모리 맵으로 대체해 라우트의 배선만 검증한다 — 집계 계산 자체는
// src/lib/journal/review.test.ts가 이미 검증하므로 여기서 다시 하지 않는다.
// (observatory/quotes 라우트 테스트와 같은 패턴)
//
// 이 파일의 핵심은 C-1: 사용자가 들고 온 entries의 ticker가 파일 경로에 그대로
// 들어가므로, 이상한 티커("../../etc/passwd")가 data/ 밖 파일을 건드리지 못해야
// 한다. 그러면서도 400을 내면 안 된다 — 옛 기록 하나가 전체 리뷰를 막으면
// 사용자는 자기검증 화면 자체를 잃는다.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JournalEntry } from "@/lib/types";

const fsState = {
  files: new Map<string, string>(),
  /** existsSync가 어떤 경로로 불렸는지 전부 기록한다(경로 탈출 단언용). */
  existsCalls: [] as string[],
};

vi.mock("node:fs", () => ({
  existsSync: (p: string) => {
    fsState.existsCalls.push(p);
    return fsState.files.has(p);
  },
  readFileSync: (p: string) => {
    const v = fsState.files.get(p);
    if (v === undefined) throw new Error(`ENOENT: ${p}`);
    return v;
  },
}));

import { POST } from "./route";

function entry(partial: Partial<JournalEntry>): JournalEntry {
  return {
    id: Math.random().toString(36),
    date: "2025-01-01",
    market: "KR",
    ticker: "005930",
    name: "삼성전자",
    action: "buy",
    reason: "",
    emotion: 3,
    lesson: "",
    ...partial,
  };
}

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/journal/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  ) as unknown as Promise<Response>;
}

afterEach(() => {
  fsState.files.clear();
  fsState.existsCalls.length = 0;
});

describe("POST /api/journal/review", () => {
  it("본문이 JSON이 아니면 400", async () => {
    const res = await (POST(
      new Request("http://localhost/api/journal/review", { method: "POST", body: "not json" })
    ) as unknown as Promise<Response>);
    expect(res.status).toBe(400);
  });

  it("entries가 비어 있어도 200 — 빈 결과를 그대로 돌려준다", async () => {
    const res = await post({ entries: [], settings: { sealDays: 180 } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.closedCount).toBe(0);
    expect(body.openCount).toBe(0);
    expect(body.missingPrices).toEqual([]);
  });

  it("가격 파일이 있으면 그 종가로 대조군·반사실을 계산한다", async () => {
    fsState.files.set(
      "data/flow/005930.json",
      JSON.stringify({
        ticker: "005930",
        days: Array.from({ length: 40 }, (_, i) => ({
          date: `2025-01-${String(i + 1).padStart(2, "0")}`,
          close: 100 + i,
        })),
      })
    );
    const res = await post({
      entries: [
        entry({ action: "buy", date: "2025-01-01", price: 100, qty: 10, primaryTag: "수급" }),
        entry({ action: "sell", date: "2025-01-05", price: 110, qty: 10 }),
      ],
      settings: { sealDays: 180 },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.closedCount).toBe(1);
    expect(body.missingPrices).toEqual([]);
    const tag = body.byTag.find((r: { key: string }) => r.key === "수급");
    expect(tag.randomMean).toBeDefined();
  });

  // ── C-1 경로 탈출 ──────────────────────────────────────────────────────────
  it("이상한 ticker는 파일시스템을 건드리지 않고 missingPrices로만 남는다(200 유지)", async () => {
    const evil = "../../etc/passwd";
    const res = await post({
      entries: [
        entry({ ticker: evil, action: "buy", date: "2025-01-01", price: 100, qty: 10 }),
        entry({ ticker: evil, action: "sell", date: "2025-01-05", price: 110, qty: 10 }),
      ],
      settings: { sealDays: 180 },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.closedCount).toBe(1); // 일지 자체 값(실제 수익)은 그대로 집계된다
    expect(body.missingPrices).toContain(evil);

    // 이 evil 티커에 대해서는 파일 존재 확인조차 하지 않았어야 한다 — 경로가
    // 안전한지가 아니라 "아예 안 갔다"를 단언한다. KOSPI(0001)는 사용자
    // 입력이 아니라 라우트가 스스로 참조하는 고정 상수라 항상 조회되고, 그
    // 하나만 찍혀 있어야 한다(빈 배열이면 아래 루프가 통째로 건너뛰므로
    // 루프만으로는 검증이 공허해진다).
    expect(fsState.existsCalls).toEqual(["data/candles/KR-0001-D.json"]);
    for (const p of fsState.existsCalls) {
      expect(p.startsWith("data/")).toBe(true);
      expect(p).not.toContain("..");
    }
  });

  it("skip 액션의 ticker도 같은 검증을 거친다", async () => {
    const res = await post({
      entries: [entry({ ticker: "..", action: "skip", date: "2025-01-01" })],
      settings: { sealDays: 180 },
    });
    expect(res.status).toBe(200);
    // KOSPI(0001) 조회는 고정 상수라 항상 일어난다 — 사용자가 준 evil
    // 티커("..")에 대해서만 아무 fs 접근도 없어야 한다는 것이 이 테스트의 요점.
    expect(fsState.existsCalls).toEqual(["data/candles/KR-0001-D.json"]);
  });

  // ── KOSPI 대조(관망 반사실 vs 시장) ──────────────────────────────────────
  it("KOSPI 종가 파일(KR-0001-D.json)이 있으면 skip.user.kospiMean20이 숫자로 붙는다", async () => {
    fsState.files.set(
      "data/candles/KR-X-D.json",
      JSON.stringify({
        candles: Array.from({ length: 30 }, (_, i) => ({
          date: `2025-01-${String(i + 1).padStart(2, "0")}`,
          close: 100 + i,
        })),
      })
    );
    fsState.files.set(
      "data/candles/KR-0001-D.json",
      JSON.stringify({
        candles: Array.from({ length: 30 }, (_, i) => ({
          date: `2025-01-${String(i + 1).padStart(2, "0")}`,
          close: 1000 + i * 5,
        })),
      })
    );
    const res = await post({
      entries: [entry({ ticker: "X", action: "skip", date: "2025-01-01" })],
      settings: { sealDays: 180 },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(typeof body.skip.user.kospiMean20).toBe("number");
  });

  it("KOSPI 종가 파일이 없으면 skip.user.kospiMean20은 undefined", async () => {
    fsState.files.set(
      "data/candles/KR-X-D.json",
      JSON.stringify({
        candles: Array.from({ length: 30 }, (_, i) => ({
          date: `2025-01-${String(i + 1).padStart(2, "0")}`,
          close: 100 + i,
        })),
      })
    );
    const res = await post({
      entries: [entry({ ticker: "X", action: "skip", date: "2025-01-01" })],
      settings: { sealDays: 180 },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.skip.user.kospiMean20).toBeUndefined();
  });
});
