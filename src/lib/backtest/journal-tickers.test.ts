import { describe, expect, it } from "vitest";
// scripts/의 .mjs를 그대로 import한다 — 스크립트와 테스트가 같은 코드를 본다.
import { journalTickersToFetch } from "../../../scripts/lib/journal-tickers.mjs";

describe("journalTickersToFetch", () => {
  const today = "2026-09-08";
  it("파일이 없으면 2년 전부터", () => {
    expect(journalTickersToFetch(["247540"], new Map(), today)).toEqual([{ ticker: "247540", from: "20240908" }]);
  });
  it("마지막 봉이 어제면 제외, 그제면 마지막 봉 다음날부터", () => {
    const last = new Map([
      ["005930", "2026-09-07"],
      ["000660", "2026-09-04"],
    ]);
    expect(journalTickersToFetch(["005930", "000660"], last, today)).toEqual([{ ticker: "000660", from: "20260905" }]);
  });
  it("6자리가 아닌 티커는 무시(US·손상값)", () => {
    expect(journalTickersToFetch(["AAPL", "../x", "005930"], new Map(), today)).toHaveLength(1);
  });
  it("중복 제거", () => {
    expect(journalTickersToFetch(["005930", "005930"], new Map(), today)).toHaveLength(1);
  });
});

// C-1 회귀: 이미 적재 중인 지수·섹터 ETF·로테이션 ETF 코드가 일지에 들어와도
// 따라 받지 않는다 — 받으면 label이 "091160"으로 덮여 snapshot-data.ts의
// label 기준 ETF 맵이 빗나가고 sectorRsRank가 조용히 사라진다.
describe("journalTickersToFetch — exclude", () => {
  const today = "2026-09-08";
  it("exclude에 있는 코드는 건너뛴다", () => {
    expect(
      journalTickersToFetch(["091160", "247540"], new Map(), today, new Set(["091160"]))
    ).toEqual([{ ticker: "247540", from: "20240908" }]);
  });
});
