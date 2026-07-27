import type { NaverCreds } from "./naver-news";

/** 네이버 자격증명(둘 다 있어야 유효). 없으면 null. */
export function naverCreds(): NaverCreds | null {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}
