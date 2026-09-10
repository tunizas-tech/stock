// 보유종목 하나를 가리키는 문 — 삭제(DELETE)와 산업 분류 수정(PATCH {sector}).
// PATCH는 sector만 받는다: 수량·평단가는 "팔고 다시 산" 기록이라 지우고 다시 넣는 게 맞고,
// 분류는 종목의 속성이 아니라 사용자의 해석이라 자주 바뀔 수 있어 따로 문을 낸다.
import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
import { deleteHolding, updateHoldingSector } from "@/lib/server/portfolio-repo";
import { parseSectorPatch } from "@/lib/portfolio/validate";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_DB = () => NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });

export async function DELETE(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) return NO_DB();
  const ok = await deleteHolding(pool, params.id);
  return ok ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "없는 기록" }, { status: 404 });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) return NO_DB();
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "잘못된 본문", field: "body" }, { status: 400 }); }
  const parsed = parseSectorPatch(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });
  const row = await updateHoldingSector(pool, params.id, parsed.value);
  return row ? NextResponse.json(row) : NextResponse.json({ error: "없는 기록" }, { status: 404 });
}
