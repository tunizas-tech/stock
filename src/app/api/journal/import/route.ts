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
  // 한 행이 형식에서 벗어났다고 전체를 400으로 되돌리면(예전 동작) 이관은 영영
  // 끝나지 않는다 — 사용자에게 localStorage를 고칠 화면이 없기 때문이다. 통과한 것만
  // 넣고 나머지는 index·id·field와 함께 돌려줘 화면이 "몇 건은 못 올렸다"를 말하게 한다.
  const entries: JournalEntry[] = [];
  const rejected: { index: number; id?: unknown; field: string; error: string }[] = [];
  (body.entries as Record<string, unknown>[]).forEach((raw, index) => {
    if (typeof raw?.id !== "string" || raw.id.length === 0) {
      rejected.push({ index, id: raw?.id, field: "id", error: "id 필요" });
      return;
    }
    const parsed = parseUserEntry(raw);
    if (!parsed.ok) {
      rejected.push({ index, id: raw.id, field: parsed.field, error: parsed.error });
      return;
    }
    // author는 본문에서 받지 않는다 — 사람이 올린 행이 에이전트 관망 채점에 섞이면
    // 7단계의 "내 판단력과 섞지 않는다"가 무너진다.
    entries.push({ ...parsed.value, id: raw.id, author: "user" });
  });
  const { inserted, skipped } = await importJournal(pool, entries);
  return NextResponse.json({ inserted, skipped, rejected });
}
