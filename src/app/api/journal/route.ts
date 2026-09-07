// 매매일지 사람 문(설계 §3.1) — Basic Auth 뒤. 브라우저 폼·페이지가 쓴다.
// 에이전트는 이 문을 쓰지 않는다(/api/journal/agent). 여기로 author:"agent"가 와도 user로 덮는다.
import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
import { insertJournal, listJournal } from "@/lib/server/journal-repo";
import { parseUserEntry } from "@/lib/journal/user-input";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });
  return NextResponse.json({ entries: await listJournal(pool) });
}

export async function POST(req: Request): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "잘못된 본문", field: "body" }, { status: 400 }); }
  const parsed = parseUserEntry(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });
  const entry = await insertJournal(pool, {
    ...parsed.value,
    id: crypto.randomUUID(),
    author: "user",
    // createdAt은 본문 값을 절대 쓰지 않고 서버 시각으로 못 박는다. 폼은 언제나 now를
    // 보내므로 잃는 기능이 없고, 통과시키면 두 가지가 뚫린다: (1) 거래일 종가 이전
    // 시각을 보내 "그날 종가 진입"(이미 아는 종가)을 만들 수 있고, (2) 과거 시각이
    // 봉인 기준일(첫 createdAt)을 뒤로 밀어 자기검증 봉인이 열린다.
    // 옛 기록 이관은 id까지 유지해야 하므로 /api/journal/import만 createdAt을 받는다.
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json(entry, { status: 201 });
}
