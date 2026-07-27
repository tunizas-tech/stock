import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
import { naverCreds } from "@/lib/server/news-config";
import { addKeyword, upsertItems } from "@/lib/server/news-repo";
import { fetchNews } from "@/lib/server/naver-news";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) {
    return NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });
  }
  const body = await req.json().catch(() => null);
  const keyword = typeof body?.keyword === "string" ? body.keyword.trim() : "";
  if (!keyword) {
    return NextResponse.json({ error: "keyword가 필요합니다" }, { status: 400 });
  }

  const kw = await addKeyword(pool, keyword);

  // 추가 즉시 한 번 조회해 채운다(키가 있을 때만). 실패해도 키워드 추가는 유지.
  const creds = naverCreds();
  if (creds) {
    try {
      const items = await fetchNews(keyword, creds);
      await upsertItems(pool, kw.id, items);
    } catch {
      // 무시 — 이후 [업데이트]로 재시도 가능
    }
  }

  return NextResponse.json({ keyword: kw });
}
