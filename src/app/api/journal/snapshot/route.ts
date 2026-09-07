// 매매 시점 스냅샷 API(6단계 설계 §2) — GET /api/journal/snapshot?ticker=005930&date=2026-09-05
//
// data/ 아래 코스피·나스닥·수급(30종목)·섹터 로테이션 ETF·종목 캔들을 읽어
// buildSnapshot(순수 함수, src/lib/journal/snapshot.ts)에 그대로 넘기고 결과만
// 돌려준다. 파일을 찾아 읽는 것과 "없으면 무엇을 돌려줄지"는
// loadSnapshotInputs(src/lib/server/snapshot-data.ts, Task 6에서 추출 — 에이전트
// 문도 같은 로더를 쓴다)가 맡고, 이 라우트는 입력 검증과 응답 모양만 맡는다.
//
// buildSnapshot 자체는 절대 throw하지 않지만, data/ 디렉터리가 통째로 없을 때는
// (로컬에서 flow:fetch/backtest:fetch를 아직 안 돌린 상태) 애초에 계산을 시도하지
// 않고 바로 coverage:"none"을 200으로 준다 — 저널 폼은 이 API가 실패하든
// 성공하든 저장 자체를 절대 막지 않는다(설계 §1). 그래서 이 라우트는 입력 검증
// 실패(400) 외에는 절대 5xx를 내지 않는다.

import { NextResponse } from "next/server";
import type { JournalSnapshot } from "@/lib/types";
import { buildSnapshot } from "@/lib/journal/snapshot";
import { DATE_RE, TICKER_RE } from "@/lib/journal/validate";
import { loadSnapshotInputs } from "@/lib/server/snapshot-data";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const params = new URL(req.url).searchParams;
  const ticker = params.get("ticker") ?? "";
  const date = params.get("date") ?? "";

  if (!TICKER_RE.test(ticker) || !DATE_RE.test(date)) {
    return NextResponse.json(
      { error: "ticker(6자리 숫자 또는 1~5자리 대문자)와 date(YYYY-MM-DD)가 필요합니다" },
      { status: 400 }
    );
  }

  const input = loadSnapshotInputs(ticker, date);
  if (!input) {
    const empty: JournalSnapshot = { asOf: "", coverage: "none" };
    return NextResponse.json(empty);
  }

  return NextResponse.json(buildSnapshot(input));
}
