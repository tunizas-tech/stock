// 브라우저 localStorage 기록을 서버로 올리는 1회성 문(설계 §1). id를 유지해 두 번 눌러도 중복되지 않는다.
import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
import { importJournal } from "@/lib/server/journal-repo";
import type { JournalEntry } from "@/lib/types";
import { parseUserEntry } from "@/lib/journal/user-input";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });
  let body: { entries?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "잘못된 본문" }, { status: 400 }); }
  if (!Array.isArray(body.entries)) return NextResponse.json({ error: "entries 배열 필요", field: "entries" }, { status: 400 });
  const entries: JournalEntry[] = [];
  for (const raw of body.entries as Record<string, unknown>[]) {
    const parsed = parseUserEntry(raw);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field, id: raw?.id }, { status: 400 });
    if (typeof raw.id !== "string" || raw.id.length === 0) return NextResponse.json({ error: "id 필요", field: "id" }, { status: 400 });
    entries.push({ ...parsed.value, id: raw.id, author: "user" });
  }
  return NextResponse.json(await importJournal(pool, entries));
}
