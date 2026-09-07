// 클라이언트가 저장 백엔드를 런타임에 알아내는 문(설계 §1) — 빌드에 굽는 NEXT_PUBLIC_ 변수 없이
// DATABASE_URL 유무만으로 서버/localStorage를 가른다.
import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(): Promise<NextResponse> {
  if (!getPool()) return NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });
  return NextResponse.json({ mode: "server" });
}
