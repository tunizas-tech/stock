import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
import { naverCreds } from "@/lib/server/news-config";
import { syncAll } from "@/lib/server/news-sync";

export const runtime = "nodejs";

export async function POST(_req: Request): Promise<NextResponse> {
  const pool = getPool();
  const creds = naverCreds();
  if (!pool || !creds) {
    return NextResponse.json(
      { error: "DATABASE_URL 또는 NAVER_CLIENT_ID/SECRET 미설정" },
      { status: 503 }
    );
  }
  try {
    const results = await syncAll(pool, creds);
    const inserted = results.reduce((s, r) => s + r.inserted, 0);
    return NextResponse.json({ results, inserted });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "동기화 실패" },
      { status: 500 }
    );
  }
}
