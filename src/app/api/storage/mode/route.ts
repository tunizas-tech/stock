// 저장 백엔드 프로브(8단계부터 세 테이블 공용). 항상 200 — DATABASE_URL 없음은 오류가 아니라 "local"이라는 답이다.
import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ mode: getPool() ? "server" : "local" });
}
