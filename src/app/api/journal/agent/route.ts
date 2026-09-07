// 에이전트 문(설계 §3.2) — Hermes가 하루 ≤3건의 "관망"을 남기는 유일한 경로.
// 미들웨어가 Bearer AGENT_TOKEN을 검사하지만 여기서도 토큰 유무를 다시 본다: 미들웨어 매처가
// 바뀌어 이 경로가 열리는 사고가 나도 토큰이 없으면 문은 닫혀 있어야 한다.
// 서버가 정하는 것(action/date/market/primaryTag/author/createdAt/snapshot)은 요청값을 보지 않는다.
import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
import { agentHasTicker, countAgentOn, insertJournal } from "@/lib/server/journal-repo";
import { loadSnapshotInputs } from "@/lib/server/snapshot-data";
import { buildSnapshot } from "@/lib/journal/snapshot";
import { AGENT_DAILY_CAP, parseAgentInput } from "@/lib/journal/agent-input";
import { todayKst } from "@/lib/kst";
import type { JournalEntry, JournalSnapshot } from "@/lib/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  if (!process.env.AGENT_TOKEN) return NextResponse.json({ error: "AGENT_TOKEN 미설정" }, { status: 503 });
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "잘못된 본문", field: "body" }, { status: 400 }); }
  const parsed = parseAgentInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });
  const v = parsed.value;

  const now = new Date();
  const date = todayKst(now);
  if ((await countAgentOn(pool, date)) >= AGENT_DAILY_CAP) {
    return NextResponse.json({ error: `오늘 에이전트 기록 상한 ${AGENT_DAILY_CAP}건` }, { status: 429 });
  }
  if (await agentHasTicker(pool, date, v.ticker)) {
    return NextResponse.json({ error: "오늘 이미 같은 종목을 기록했다" }, { status: 409 });
  }

  // 스냅샷은 로컬 data/만 — 실패해도 저장은 막지 않는다(6단계 §1과 같은 best-effort).
  let snapshot: JournalSnapshot = { asOf: "", coverage: "none" };
  try {
    const input = loadSnapshotInputs(v.ticker, date, v.sector);
    if (input) snapshot = buildSnapshot(input);
  } catch { /* coverage:none으로 저장 */ }

  const entry: JournalEntry = {
    id: crypto.randomUUID(), date, market: "KR", ticker: v.ticker, name: v.name, action: "skip",
    reason: v.reason, emotion: v.emotion, lesson: "", primaryTag: "에이전트", author: "agent",
    sector: v.sector, createdAt: now.toISOString(), snapshot,
  };
  if (v.tags) entry.tags = v.tags;
  return NextResponse.json(await insertJournal(pool, entry), { status: 201 });
}
