// Basic Auth 검사 — 순수 함수라 Edge 미들웨어와 vitest 양쪽에서 쓴다.
// 개인용 앱을 서버에 올릴 때 관측소·매매일지가 인터넷에 그대로 노출되지 않게 막는 최소 장치다.
// APP_USER/APP_PASS 환경변수가 없으면 인증을 걸지 않는다 — 로컬 개발은 지금과 똑같이 열려 있다.

/** 길이가 달라도 같은 시간이 걸리도록 비교한다. 개인용이라 과하지만 비용이 0이다. */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Authorization 헤더가 APP_USER:APP_PASS 와 일치하는가.
 * user/pass 중 하나라도 비어 있으면 "인증 미설정"으로 보고 통과시킨다.
 */
export function checkBasicAuth(
  header: string | null,
  user: string | undefined,
  pass: string | undefined
): boolean {
  if (!user || !pass) return true;
  if (!header || !header.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = atob(header.slice(6));
  } catch {
    return false;
  }
  const idx = decoded.indexOf(":");
  if (idx < 0) return false;
  const gotUser = decoded.slice(0, idx);
  const gotPass = decoded.slice(idx + 1);
  // 두 비교를 항상 둘 다 수행해 어느 쪽이 틀렸는지 시간으로 새지 않게 한다.
  const u = timingSafeEqual(gotUser, user);
  const p = timingSafeEqual(gotPass, pass);
  return u && p;
}

export const isAuthConfigured = (user?: string, pass?: string): boolean =>
  Boolean(user && pass);
