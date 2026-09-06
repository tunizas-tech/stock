// node:fs를 메모리 맵으로 대체해 라우트의 배선(파일을 찾아 읽고, 없으면 null +
// meta로 안내하는지)만 검증한다. 집계·수익률 계산 자체는 src/lib/observatory.test.ts가
// 이미 충분히 검증하므로 여기서는 다시 검증하지 않는다.
import { afterEach, describe, expect, it, vi } from "vitest";

const fsState = {
  dirs: new Map<string, string[]>(),
  files: new Map<string, string>(),
};

vi.mock("node:fs", () => ({
  existsSync: (p: string) => fsState.dirs.has(p) || fsState.files.has(p),
  readdirSync: (p: string) => fsState.dirs.get(p) ?? [],
  readFileSync: (p: string) => {
    const v = fsState.files.get(p);
    if (v === undefined) throw new Error(`ENOENT: ${p}`);
    return v;
  },
}));

import { GET } from "./route";

function setCandles(path: string, candles: unknown[]) {
  fsState.files.set(path, JSON.stringify({ candles }));
}

afterEach(() => {
  fsState.dirs.clear();
  fsState.files.clear();
  vi.unstubAllEnvs();
});

describe("GET /api/observatory", () => {
  it("data/가 전혀 없으면 모든 섹션이 null이고 meta가 무엇을 실행할지 알린다", async () => {
    const res = await GET();
    const body = await res.json();

    expect(body.market).toBeNull();
    expect(body.flow).toBeNull();
    expect(body.relativeStrength).toBeNull();
    expect(body.buyAndHold).toBeNull();
    expect(body.meta).toEqual({ candleDataMissing: true, flowDataMissing: true });
  });

  it("디렉터리는 있지만 비어 있으면 여전히 missing으로 표시한다", async () => {
    fsState.dirs.set("data/candles", []);
    fsState.dirs.set("data/flow", []);

    const res = await GET();
    const body = await res.json();

    expect(body.meta).toEqual({ candleDataMissing: true, flowDataMissing: true });
  });

  it("지수 캔들이 있으면 오늘의 시장 섹션을 채운다", async () => {
    fsState.dirs.set("data/candles", ["KR-0001-D.json", "KR-1001-D.json"]);
    setCandles("data/candles/KR-0001-D.json", [
      { date: "2026-09-03", open: 100, high: 102, low: 99, close: 101 },
      { date: "2026-09-04", open: 103, high: 104, low: 98, close: 99 },
    ]);
    setCandles("data/candles/KR-1001-D.json", [
      { date: "2026-09-03", open: 50, high: 52, low: 49, close: 51 },
      { date: "2026-09-04", open: 52, high: 53, low: 51, close: 52.5 },
    ]);

    const res = await GET();
    const body = await res.json();

    expect(body.meta.candleDataMissing).toBe(false);
    expect(body.market).not.toBeNull();
    expect(body.market.indices.map((i: { label: string }) => i.label)).toEqual(["코스피", "코스닥"]);
    const kospiGap = body.market.gaps.find((g: { label: string }) => g.label === "코스피");
    expect(kospiGap.gapPct).toBeCloseTo(103 / 101 - 1, 10);
    expect(kospiGap.intradayPct).toBeCloseTo(99 / 103 - 1, 10);
    // 로테이션 9종목 캔들은 없으므로 이 두 섹션은 여전히 null이어야 한다(부분 결측을 정직하게 반영)
    expect(body.relativeStrength).toBeNull();
    expect(body.buyAndHold).toBeNull();
  });

  it("수급 파일이 있으면 섹터별 자금 흐름 섹션을 채운다", async () => {
    fsState.dirs.set("data/flow", ["005930.json"]);
    fsState.files.set(
      "data/flow/005930.json",
      JSON.stringify({
        ticker: "005930",
        name: "삼성전자",
        sector: "반도체",
        updatedAt: "2026-09-06T00:00:00.000Z",
        days: [
          {
            date: "2026-09-04",
            close: 100,
            foreign: 10,
            institution: 5,
            individual: -15,
            foreignQty: 1,
            institutionQty: 1,
            individualQty: -2,
          },
        ],
      })
    );

    const res = await GET();
    const body = await res.json();

    expect(body.meta.flowDataMissing).toBe(false);
    expect(body.flow).not.toBeNull();
    expect(body.flow.windows.map((w: { days: number }) => w.days)).toEqual([5, 20, 60]);
    expect(body.flow.windows[0].sectors[0].sector).toBe("반도체");
  });

  it("손상된 종목 파일 하나가 있어도 나머지로 계속 계산한다", async () => {
    fsState.dirs.set("data/flow", ["broken.json", "005930.json"]);
    fsState.files.set("data/flow/broken.json", "{ 이건 JSON이 아니다");
    fsState.files.set(
      "data/flow/005930.json",
      JSON.stringify({
        ticker: "005930",
        name: "삼성전자",
        sector: "반도체",
        days: [
          {
            date: "2026-09-04",
            close: 100,
            foreign: 10,
            institution: 5,
            individual: -15,
            foreignQty: 1,
            institutionQty: 1,
            individualQty: -2,
          },
        ],
      })
    );

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.flow).not.toBeNull();
  });
});
