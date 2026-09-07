import { describe, expect, it } from "vitest";
import { splitImportResult } from "./journal-import";
import type { JournalEntry } from "./types";

const row = (id: string): JournalEntry => ({
  id, date: "2026-09-08", market: "KR", ticker: "005930", name: "삼성전자",
  action: "buy", reason: "r", emotion: 3, lesson: "",
});

describe("splitImportResult", () => {
  it("전부 성공하면 남길 것이 없다 — 브라우저 사본을 비운다", () => {
    const r = splitImportResult([row("a"), row("b")], { inserted: 2, skipped: 0, rejected: [] });
    expect(r.keep).toEqual([]);
    expect(r.message).toBe("2건 올림, 0건은 이미 있어 건너뜀");
  });

  // 거절된 행은 서버에 들어가지 않았다 — 여기서 지우면 그대로 사라진다.
  it("거절된 행만 브라우저에 남기고 이유를 말한다", () => {
    const local = [row("a"), row("b"), row("c")];
    const r = splitImportResult(local, {
      inserted: 1,
      skipped: 1,
      rejected: [{ index: 2, id: "c", field: "emotion", error: "1~5" }],
    });
    expect(r.keep).toEqual([row("c")]);
    expect(r.message).toBe(
      "1건 올림, 1건 건너뜀, 1건은 형식 오류로 이 브라우저에 남겨 둠 — emotion: 1~5"
    );
  });

  it("id가 없는 옛 행은 index로 되짚어 남긴다", () => {
    const local = [row("a"), row("b")];
    const r = splitImportResult(local, {
      inserted: 1,
      skipped: 0,
      rejected: [{ index: 1, field: "id", error: "id 필요" }],
    });
    expect(r.keep).toEqual([row("b")]);
  });
});
