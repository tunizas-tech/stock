// 서버에 올릴 때 전체 앱에 Basic Auth를 건다. APP_USER/APP_PASS 가 없으면 아무것도 하지 않는다.
// 관측소·매매일지·API 전부가 대상이다 — 예외를 두면 그 예외가 곧 구멍이 된다.
// Coolify 예약 작업이 /api/news/sync 를 호출할 때는 curl -u "$APP_USER:$APP_PASS" 로 같은 문을 지난다.
// 에이전트 문(Bearer)은 POST /api/journal/agent, GET /api/news, GET /api/observatory 세 곳뿐이다.
// AGENT_TOKEN이 없으면 이 문은 항상 닫혀 있다 — POST /api/news/sync, GET /api/journal은 Basic Auth만 통과한다.

import { NextResponse, type NextRequest } from "next/server";
import { checkBasicAuth, isAuthConfigured } from "@/lib/server/basic-auth";
import { checkAgentBearer, isAgentRoute } from "@/lib/server/agent-auth";

export function middleware(req: NextRequest) {
  const user = process.env.APP_USER;
  const pass = process.env.APP_PASS;
  const auth = req.headers.get("authorization");

  // 에이전트 문: 정확히 세 (메서드,경로)만 Bearer로 연다. Basic Auth 설정 여부와 무관하게
  // 토큰이 맞으면 통과 — 토큰이 없거나 틀리면 아래 Basic Auth로 떨어진다.
  if (isAgentRoute(req.method, req.nextUrl.pathname) && checkAgentBearer(auth, process.env.AGENT_TOKEN)) {
    return NextResponse.next();
  }

  if (!isAuthConfigured(user, pass)) return NextResponse.next();
  if (checkBasicAuth(auth, user, pass)) return NextResponse.next();
  return new NextResponse("인증이 필요합니다.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="stock-study-note", charset="UTF-8"' },
  });
}

// Next 내부 자산(_next/static 등)은 인증 없이도 무해하고, 막으면 로그인 화면 자체가 깨진다.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
