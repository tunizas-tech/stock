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
    createdAt: parsed.value.createdAt ?? new Date().toISOString(),
  });
  return NextResponse.json(entry, { status: 201 });
}
