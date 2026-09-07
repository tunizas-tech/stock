// 에이전트 전용 Bearer 인증(설계 §4). 사람 비밀번호(APP_PASS)를 Hermes 설정에 넣지 않기 위한 별도 문.
// 허용 경로는 (메서드, 경로) 완전 일치 3개뿐이다 — 접두사 매칭을 하면 /api/news/sync(동기화 실행)처럼
// 의도치 않은 문이 같이 열린다. 토큰이 새도 피해는 "하루 관망 3건 + 뉴스·관측소 읽기"로 끝난다.
import { timingSafeEqual } from "./basic-auth";

export const AGENT_ROUTES = [
  { method: "POST", path: "/api/journal/agent" },
  { method: "GET", path: "/api/news" },
  { method: "GET", path: "/api/observatory" },
] as const;

export function isAgentRoute(method: string, pathname: string): boolean {
  return AGENT_ROUTES.some((r) => r.method === method && r.path === pathname);
}

/** AGENT_TOKEN이 비어 있으면 어떤 헤더도 통과하지 못한다 — 미설정 = 에이전트 경로 닫힘. */
export function checkAgentBearer(header: string | null, token: string | undefined): boolean {
  if (!token) return false;
  if (!header || !header.startsWith("Bearer ")) return false;
  return timingSafeEqual(header.slice(7), token);
}
