// 관심종목 서버 문(8단계 설계 §2) — Basic Auth 뒤. id는 서버가 정한다(본문 id 무시).
import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
import { insertWatch, listWatch } from "@/lib/server/portfolio-repo";
import { parseWatch } from "@/lib/portfolio/validate";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_DB = () => NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });

export async function GET(): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) return NO_DB();
  return NextResponse.json({ watchlist: await listWatch(pool) });
}
export async function POST(req: Request): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) return NO_DB();
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "잘못된 본문", field: "body" }, { status: 400 }); }
  const parsed = parseWatch(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });
  return NextResponse.json(await insertWatch(pool, { ...parsed.value, id: crypto.randomUUID() }), { status: 201 });
}
