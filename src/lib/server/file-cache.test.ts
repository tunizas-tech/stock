// mtime 기반 JSON 파일 캐시 — "같은 mtime이면 다시 읽지 않는다"는 계약만
// 검증한다. 실제 사용처(리뷰 라우트의 KOSPI 종가)는 route.test.ts가 배선만
// 확인한다.
import { afterEach, describe, expect, it, vi } from "vitest";

const fsState = {
  files: new Map<string, { content: string; mtimeMs: number }>(),
  readCalls: [] as string[],
};

vi.mock("node:fs", () => ({
  statSync: (p: string) => {
    const f = fsState.files.get(p);
    if (!f) throw new Error(`ENOENT: ${p}`);
    return { mtimeMs: f.mtimeMs };
  },
  readFileSync: (p: string) => {
    fsState.readCalls.push(p);
    const f = fsState.files.get(p);
    if (!f) throw new Error(`ENOENT: ${p}`);
    return f.content;
  },
}));

import { clearFileCache, readJsonCached } from "./file-cache";

afterEach(() => {
  fsState.files.clear();
  fsState.readCalls.length = 0;
  clearFileCache();
});

const parse = (raw: unknown) => raw as { n: number };

describe("readJsonCached", () => {
  it("같은 mtime이면 readFileSync를 한 번만 호출한다", () => {
    fsState.files.set("a.json", { content: JSON.stringify({ n: 1 }), mtimeMs: 100 });
    const r1 = readJsonCached("a.json", parse);
    const r2 = readJsonCached("a.json", parse);
    expect(r1).toEqual({ n: 1 });
    expect(r2).toEqual({ n: 1 });
    expect(fsState.readCalls).toEqual(["a.json"]);
  });

  it("mtime이 바뀌면 다시 읽는다", () => {
    fsState.files.set("a.json", { content: JSON.stringify({ n: 1 }), mtimeMs: 100 });
    readJsonCached("a.json", parse);
    fsState.files.set("a.json", { content: JSON.stringify({ n: 2 }), mtimeMs: 200 });
    const r2 = readJsonCached("a.json", parse);
    expect(r2).toEqual({ n: 2 });
    expect(fsState.readCalls).toEqual(["a.json", "a.json"]);
  });

  it("파일이 없으면 undefined", () => {
    expect(readJsonCached("missing.json", parse)).toBeUndefined();
  });

  it("parse가 예외를 던지면 undefined이고, 이후 정상 파일로 재시도하면 다시 읽어 성공한다(캐시하지 않았다는 증거)", () => {
    fsState.files.set("bad.json", { content: JSON.stringify({ n: "nope" }), mtimeMs: 1 });
    const strictParse = (raw: unknown) => {
      const shape = raw as { n: number };
      if (typeof shape.n !== "number") throw new Error("invalid shape");
      return shape;
    };
    expect(readJsonCached("bad.json", strictParse)).toBeUndefined();
    fsState.files.set("bad.json", { content: JSON.stringify({ n: 9 }), mtimeMs: 1 });
    expect(readJsonCached("bad.json", strictParse)).toEqual({ n: 9 });
  });
});
