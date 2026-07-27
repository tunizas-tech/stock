// 전용 PostgreSQL 풀(서버 전용 — DATABASE_URL을 다루므로 클라이언트 import 금지).
// 환경변수가 없으면 null → 라우트가 503으로 분기한다.
import { Pool } from "pg";

/** repo 함수가 받는 최소 쿼리 인터페이스. pg Pool이 이 형태를 만족한다. */
export interface Queryable {
  query(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

let pool: Pool | null = null;

export function getPool(): Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!pool) pool = new Pool({ connectionString: url });
  return pool;
}
