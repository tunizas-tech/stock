// 네이버 검색(뉴스) API 어댑터 (서버 전용 — client id/secret을 다루므로 클라이언트 import 금지).
// GET /v1/search/news.json?query=&display=100&sort=date, 헤더에 X-Naver-Client-Id/Secret.
// 응답 title/description은 <b> 태그·HTML 엔티티를 포함 → 정규화한다.
import type { RawNewsItem } from "../types";

const ENDPOINT = "https://openapi.naver.com/v1/search/news.json";

export interface NaverCreds {
  clientId: string;
  clientSecret: string;
}

interface NaverItem {
  title: string;
  originallink?: string;
  link: string;
  description?: string;
  pubDate?: string;
}

/** <b> 등 태그 제거 + 주요 HTML 엔티티 디코드. */
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** RFC1123 → ISO. 파싱 실패 시 null. */
function toIso(pubDate: string | undefined): string | null {
  if (!pubDate) return null;
  const t = new Date(pubDate);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/** originallink 호스트에서 언론사/출처를 유추(best-effort). */
function sourceFrom(originallink: string | undefined): string | null {
  if (!originallink) return null;
  try {
    return new URL(originallink).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function fetchNews(
  keyword: string,
  creds: NaverCreds
): Promise<RawNewsItem[]> {
  const url =
    `${ENDPOINT}?query=${encodeURIComponent(keyword)}` + `&display=100&sort=date`;
  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": creds.clientId,
      "X-Naver-Client-Secret": creds.clientSecret,
    },
  });
  if (!res.ok) throw new Error(`네이버 뉴스 HTTP ${res.status} (${keyword})`);
  const body = (await res.json()) as { items?: NaverItem[] };
  return (body.items ?? []).map((it) => ({
    title: stripHtml(it.title),
    link: it.link,
    originalLink: it.originallink ?? null,
    description: it.description ? stripHtml(it.description) : null,
    source: sourceFrom(it.originallink),
    pubDate: toIso(it.pubDate),
  }));
}
