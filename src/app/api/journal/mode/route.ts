// 클라이언트가 저장 백엔드를 런타임에 알아내는 문(설계 §1) — 빌드에 굽는 NEXT_PUBLIC_ 변수 없이
// DATABASE_URL 유무만으로 서버/localStorage를 가른다.
import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 항상 200이다 — "DATABASE_URL이 없다"는 오류가 아니라 로컬 개발의 정상 답(local)이다.
// 503으로 답하면 브라우저 콘솔에 매번 오류가 남고, 무엇보다 클라이언트가 "네트워크
// 실패"와 "local이라는 답"을 구분할 수 없다(storage-mode.ts는 그 둘을 다르게 다룬다).
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ mode: getPool() ? "server" : "local" });
}
