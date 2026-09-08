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
  /**
   * statSync가 어떤 경로로 불렸는지 전부 기록한다 — KOSPI 읽기가
   * readJsonCached(statSync 기반)로 바뀐 뒤로는 evil 티커가 existsSync를
   * 우회해 여기로 새어 들어올 수 있다는 걸 잡기 위한 별도 채널이다
   * (existsCalls만 보면 이 경로는 항상 비어 있어 단언이 무의미해진다).
   */
  statCalls: [] as string[],
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
  // KOSPI 종가는 라우트가 file-cache.ts(readJsonCached)를 거쳐 읽는다 — mtime을
  // 실제로 흉내 낼 필요는 없고(파일 내용은 fsState.files가 진실), "있으면 항상
  // 같은 값(1)"이면 file-cache.test.ts가 이미 검증한 캐시 로직과 맞물려 정상
  // 동작한다. 테스트 간에는 아래 afterEach의 clearFileCache()가 캐시를 비운다.
  statSync: (p: string) => {
    fsState.statCalls.push(p);
    if (fsState.files.has(p)) return { mtimeMs: 1 };
    throw new Error(`ENOENT: ${p}`);
  },
}));

import { POST } from "./route";
import { clearFileCache } from "@/lib/server/file-cache";

// KOSPI(0001) 조회는 사용자 입력이 아니라 라우트가 스스로 참조하는 고정
// 상수라 매 요청마다 항상 일어난다 — C-1 단언에서 유일하게 봐줄 fs 접근이다.
const KOSPI_PATH = "data/candles/KR-0001-D.json";

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
  fsState.statCalls.length = 0;
  // statSync 목이 mtimeMs를 항상 1로 고정 반환하므로, 캐시를 비우지 않으면
  // 다음 테스트가 다른 KOSPI 내용을 넣어도 "mtime이 같다"며 이전 값을 돌려준다.
  clearFileCache();
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
    // review.ts의 skipCounterfactual이 그대로 통과시킨 확신도별(byEmotion) 5개
    // 키 중 하나 — entries가 없어도 n:0으로 항상 실린다는 배선만 확인한다.
    expect(body.skip.agent.byEmotion["3"]).toBeDefined();
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

    // 이 evil 티커에 대해서는 fs 진입점 두 곳(existsSync·statSync) 중 어느
    // 쪽도 건드리지 않았어야 한다 — KOSPI는 라우트가 스스로 참조하는 고정
    // 상수라 statSync로만 걸리고(existsSync는 안 씀), 개별 종목 조회는
    // existsSync만 쓴다. 허용되는 건 KOSPI_PATH로의 statSync 하나뿐이라,
    // existsCalls는 통째로 비어야 하고 statCalls는 KOSPI_PATH를 뺀 나머지가
    // 비어야 한다 — 그래야 evil 티커가 둘 중 어느 진입점으로 새도 잡힌다.
    expect(fsState.existsCalls).toEqual([]);
    expect(fsState.statCalls.filter((p) => p !== KOSPI_PATH)).toEqual([]);
  });

  it("skip 액션의 ticker도 같은 검증을 거친다", async () => {
    const res = await post({
      entries: [entry({ ticker: "..", action: "skip", date: "2025-01-01" })],
      settings: { sealDays: 180 },
    });
    expect(res.status).toBe(200);
    // 허용되는 건 KOSPI_PATH로의 statSync 하나뿐 — 사용자가 준 evil 티커("..")는
    // existsSync·statSync 어느 쪽에도 흔적을 남기면 안 된다.
    expect(fsState.existsCalls).toEqual([]);
    expect(fsState.statCalls.filter((p) => p !== KOSPI_PATH)).toEqual([]);
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
      KOSPI_PATH,
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
