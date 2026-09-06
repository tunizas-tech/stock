// 서버에 올릴 때 전체 앱에 Basic Auth를 건다. APP_USER/APP_PASS 가 없으면 아무것도 하지 않는다.
// 관측소·매매일지·API 전부가 대상이다 — 예외를 두면 그 예외가 곧 구멍이 된다.
// Coolify 예약 작업이 /api/news/sync 를 호출할 때는 curl -u "$APP_USER:$APP_PASS" 로 같은 문을 지난다.

import { NextResponse, type NextRequest } from "next/server";
import { checkBasicAuth, isAuthConfigured } from "@/lib/server/basic-auth";

export function middleware(req: NextRequest) {
  const user = process.env.APP_USER;
  const pass = process.env.APP_PASS;
  if (!isAuthConfigured(user, pass)) return NextResponse.next();

  if (checkBasicAuth(req.headers.get("authorization"), user, pass)) {
    return NextResponse.next();
  }
  return new NextResponse("인증이 필요합니다.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="stock-study-note", charset="UTF-8"' },
  });
}

// Next 내부 자산(_next/static 등)은 인증 없이도 무해하고, 막으면 로그인 화면 자체가 깨진다.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
