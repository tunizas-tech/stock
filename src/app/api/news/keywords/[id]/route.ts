import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
import { deleteKeyword } from "@/lib/server/news-repo";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) {
    return NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });
  }
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "잘못된 id" }, { status: 400 });
  }
  await deleteKeyword(pool, id);
  return NextResponse.json({ ok: true });
}
