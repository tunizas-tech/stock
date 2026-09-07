// 복기(lesson) 갱신·삭제 문 — 사람 문 전용, id 하나를 가리킨다.
import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
import { deleteJournal, updateLesson } from "@/lib/server/journal-repo";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: { id: string } };

/** 복기(lesson)만 나중에 채우는 경로 — 다른 필드는 이 문으로 못 바꾼다. */
export async function PATCH(req: Request, { params }: Ctx): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });
  let body: { lesson?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "잘못된 본문" }, { status: 400 }); }
  if (typeof body.lesson !== "string") return NextResponse.json({ error: "lesson은 문자열", field: "lesson" }, { status: 400 });
  const ok = await updateLesson(pool, params.id, body.lesson);
  return ok ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "없는 기록" }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });
  const ok = await deleteJournal(pool, params.id);
  return ok ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "없는 기록" }, { status: 404 });
}
