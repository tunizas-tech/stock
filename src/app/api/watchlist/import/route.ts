// 브라우저 localStorage 관심종목 이관 — skip-and-report(7단계 I-6 교훈): 한 행이 틀려도 나머지는 올리고,
// 틀린 행은 index로 알려 브라우저가 그 행만 남겨 둔다.
import { NextResponse } from "next/server";
import { getPool } from "@/lib/server/db";
import { importWatch } from "@/lib/server/portfolio-repo";
import { parseWatch, parseImportId } from "@/lib/portfolio/validate";
import type { WatchItem } from "@/lib/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "DATABASE_URL 미설정" }, { status: 503 });
  let body: { rows?: unknown };
  // POST 라우트(holdings/route.ts)와 형태를 맞춘다 — field 없이 message만 오면
  // portfolio-client.ts가 "field:" 접두사 없이 보여준다(그 자체로는 동작하지만 어색함).
  try { body = await req.json(); } catch { return NextResponse.json({ error: "잘못된 본문", field: "body" }, { status: 400 }); }
  if (!Array.isArray(body.rows)) return NextResponse.json({ error: "rows 배열 필요", field: "rows" }, { status: 400 });
  const rows: WatchItem[] = [];
  const rejected: { index: number; id?: unknown; field: string; error: string }[] = [];
  (body.rows as Record<string, unknown>[]).forEach((raw, index) => {
    const id = parseImportId(raw?.id);
    if (id === undefined) { rejected.push({ index, id: raw?.id, field: "id", error: "1~64자 id 필요" }); return; }
    const parsed = parseWatch(raw);
    if (!parsed.ok) { rejected.push({ index, id, field: parsed.field, error: parsed.error }); return; }
    rows.push({ ...parsed.value, id });
  });
  const { inserted, skipped } = await importWatch(pool, rows);
  return NextResponse.json({ inserted, skipped, rejected });
}
