// 보유·관심종목 Postgres 저장소(8단계 설계 §2). 서버 전용. 행 <-> 타입 변환은 이 파일 밖에서 하지 않는다
// — pg는 double precision을 number로 주지만 numeric/count는 문자열로 주고 NULL은 null로 준다(journal-repo와 같은 이유).
import type { Queryable } from "./db";
import type { Holding, WatchItem } from "../types";

const H_COLS = 'id, market, ticker, name, shares, "avgPrice", "openedAt", sector';
const W_COLS = 'id, market, ticker, name, memo, "addedAt"';

export function holdingRow(row: Record<string, unknown>): Holding {
  const h: Holding = {
    id: String(row.id), market: row.market as Holding["market"], ticker: String(row.ticker), name: String(row.name),
    shares: Number(row.shares), avgPrice: Number(row.avgPrice), openedAt: String(row.openedAt),
  };
  // sector NULL = "자동 판정"(유니버스 기준). 키 자체를 빼서 클라이언트의 `sector?:` 와 같은 모양으로 맞춘다.
  if (row.sector !== null && row.sector !== undefined) h.sector = String(row.sector);
  return h;
}
export function watchRow(row: Record<string, unknown>): WatchItem {
  return {
    id: String(row.id), market: row.market as WatchItem["market"], ticker: String(row.ticker), name: String(row.name),
    memo: row.memo === null || row.memo === undefined ? "" : String(row.memo), addedAt: String(row.addedAt),
  };
}

const hParams = (h: Holding): unknown[] => [h.id, h.market, h.ticker, h.name, h.shares, h.avgPrice, h.openedAt, h.sector ?? null];
const wParams = (w: WatchItem): unknown[] => [w.id, w.market, w.ticker, w.name, w.memo ?? "", w.addedAt];
const H_INSERT = `insert into holdings (${H_COLS}) values ($1,$2,$3,$4,$5,$6,$7,$8)`;
const W_INSERT = `insert into watchlist (${W_COLS}) values ($1,$2,$3,$4,$5,$6)`;

export async function listHoldings(q: Queryable): Promise<Holding[]> {
  const { rows } = await q.query(`select ${H_COLS} from holdings order by "openedAt" desc, id desc`);
  return rows.map(holdingRow);
}
export async function insertHolding(q: Queryable, h: Holding): Promise<Holding> {
  const { rows } = await q.query(`${H_INSERT} returning ${H_COLS}`, hParams(h));
  return holdingRow(rows[0]);
}
/** 산업 분류만 바꾼다. undefined = 자동 판정으로 되돌림(NULL). 없는 id면 null. */
export async function updateHoldingSector(q: Queryable, id: string, sector: string | undefined): Promise<Holding | null> {
  const { rows } = await q.query(`update holdings set sector = $1 where id = $2 returning ${H_COLS}`, [sector ?? null, id]);
  return rows[0] ? holdingRow(rows[0]) : null;
}
export async function deleteHolding(q: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await q.query(`delete from holdings where id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}
/** 브라우저 기록 이관 — 같은 id는 건너뛴다(두 번 눌러도 안전). */
export async function importHoldings(q: Queryable, rows: Holding[]): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  for (const h of rows) {
    const { rowCount } = await q.query(`${H_INSERT} on conflict (id) do nothing`, hParams(h));
    if ((rowCount ?? 0) > 0) inserted += 1;
  }
  return { inserted, skipped: rows.length - inserted };
}

export async function listWatch(q: Queryable): Promise<WatchItem[]> {
  const { rows } = await q.query(`select ${W_COLS} from watchlist order by "addedAt" desc, id desc`);
  return rows.map(watchRow);
}
export async function insertWatch(q: Queryable, w: WatchItem): Promise<WatchItem> {
  const { rows } = await q.query(`${W_INSERT} returning ${W_COLS}`, wParams(w));
  return watchRow(rows[0]);
}
export async function deleteWatch(q: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await q.query(`delete from watchlist where id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}
export async function importWatch(q: Queryable, rows: WatchItem[]): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  for (const w of rows) {
    const { rowCount } = await q.query(`${W_INSERT} on conflict (id) do nothing`, wParams(w));
    if ((rowCount ?? 0) > 0) inserted += 1;
  }
  return { inserted, skipped: rows.length - inserted };
}
