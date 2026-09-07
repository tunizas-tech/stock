// 보유종목 삭제 문 — id 하나를 가리킨다.
import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
import { deleteHolding } from "@/lib/server/portfolio-repo";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function DELETE(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });
  const ok = await deleteHolding(pool, params.id);
  return ok ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "없는 기록" }, { status: 404 });
}
