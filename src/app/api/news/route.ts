import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
import { listFeed } from "@/lib/server/news-repo";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) {
    return NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });
  }
  try {
    const feed = await listFeed(pool);
    return NextResponse.json({ feed });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "조회 실패" },
      { status: 500 }
    );
  }
}
