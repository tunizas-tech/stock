// 7단계의 옛 경로. 8단계에서 /api/storage/mode로 옮겼다 — 배포 직후 옛 JS를 든 탭이 여기를 부르면
// 404로 localStorage 모드에 갇히므로 한 단계만 307로 넘긴다. 다음 단계에서 이 파일을 지운다.
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request): Promise<NextResponse> {
  return NextResponse.redirect(new URL("/api/storage/mode", req.url), 307);
}
