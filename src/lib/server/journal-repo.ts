// 매매일지 Postgres 저장소(7단계 설계 §1). 서버 전용 — DATABASE_URL 풀만 받는다.
// 행 <-> JournalEntry 변환은 이 파일 밖에서 하지 않는다: pg는 NULL을 null로,
// timestamptz를 Date로 주는데 앱의 나머지는 전부 "없으면 undefined, 시각은 ISO 문자열"을
// 전제한다(6단계 리뷰 I-3: null이 undefined 가드를 통과해 NaN을 만든 전례).
import type { Queryable } from "./db";
import type { JournalEntry, JournalSnapshot, ReasonTag } from "../types";

const COLUMNS =
  'id, date, market, ticker, name, action, price, qty, reason, emotion, lesson, "primaryTag", tags, snapshot, "createdAt", author, sector';

function opt<T>(v: unknown): T | undefined {
  return v === null || v === undefined ? undefined : (v as T);
}

export function rowToEntry(row: Record<string, unknown>): JournalEntry {
  const e: JournalEntry = {
    id: String(row.id),
    date: String(row.date),
    market: row.market as JournalEntry["market"],
    ticker: String(row.ticker),
    name: String(row.name),
    action: row.action as JournalEntry["action"],
    reason: String(row.reason ?? ""),
    emotion: Number(row.emotion) as JournalEntry["emotion"],
    lesson: String(row.lesson ?? ""),
  };
  // 선택 필드는 값이 있을 때만 키를 만든다 — JSON으로 나갔을 때 옛 기록과 모양이 같아야
  // 클라이언트의 `"primaryTag" in e` 류 판정과 자기검증 그룹핑이 흔들리지 않는다.
  const price = opt<number>(row.price); if (price !== undefined) e.price = Number(price);
  const qty = opt<number>(row.qty); if (qty !== undefined) e.qty = Number(qty);
  const primaryTag = opt<ReasonTag>(row.primaryTag); if (primaryTag !== undefined) e.primaryTag = primaryTag;
  const tags = opt<ReasonTag[]>(row.tags); if (tags !== undefined) e.tags = tags;
  const snapshot = opt<JournalSnapshot>(row.snapshot); if (snapshot !== undefined) e.snapshot = snapshot;
  const createdAt = opt<Date | string>(row.createdAt);
  if (createdAt !== undefined) e.createdAt = createdAt instanceof Date ? createdAt.toISOString() : String(createdAt);
  const author = opt<"user" | "agent">(row.author); if (author !== undefined) e.author = author;
  const sector = opt<string>(row.sector); if (sector !== undefined) e.sector = sector;
  return e;
}

function entryParams(e: JournalEntry): unknown[] {
  return [
    e.id, e.date, e.market, e.ticker, e.name, e.action,
    e.price ?? null, e.qty ?? null, e.reason ?? "", e.emotion, e.lesson ?? "",
    e.primaryTag ?? null, e.tags ?? null,
    e.snapshot === undefined ? null : JSON.stringify(e.snapshot),
    e.createdAt ?? null, e.author ?? null, e.sector ?? null,
  ];
}

const INSERT_SQL = `insert into journal (${COLUMNS})
  values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17)`;

export async function listJournal(q: Queryable): Promise<JournalEntry[]> {
  const { rows } = await q.query(
    `select ${COLUMNS} from journal order by date desc, "createdAt" desc nulls last, id desc`
  );
  return rows.map(rowToEntry);
}

export async function insertJournal(q: Queryable, entry: JournalEntry): Promise<JournalEntry> {
  const { rows } = await q.query(`${INSERT_SQL} returning ${COLUMNS}`, entryParams(entry));
  return rowToEntry(rows[0]);
}

export async function updateLesson(q: Queryable, id: string, lesson: string): Promise<boolean> {
  const { rowCount } = await q.query(`update journal set lesson = $2 where id = $1`, [id, lesson]);
  return (rowCount ?? 0) > 0;
}

export async function deleteJournal(q: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await q.query(`delete from journal where id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

/** 그 날짜에 에이전트가 남긴 기록 수 — 하루 상한(3건) 판정. 사람 기록은 세지 않는다. */
export async function countAgentOn(q: Queryable, date: string): Promise<number> {
  const { rows } = await q.query(
    `select count(*)::int as n from journal where author = 'agent' and date = $1`,
    [date]
  );
  return Number(rows[0]?.n ?? 0);
}

/** 그 날짜에 에이전트가 같은 종목을 이미 썼나 — 중복(409). 사람이 쓴 같은 종목은 막지 않는다. */
export async function agentHasTicker(q: Queryable, date: string, ticker: string): Promise<boolean> {
  const { rows } = await q.query(
    `select 1 as one from journal where author = 'agent' and date = $1 and ticker = $2 limit 1`,
    [date, ticker]
  );
  return rows.length > 0;
}

/** 브라우저 localStorage 기록 이관 — 같은 id는 건너뛴다(두 번 눌러도 안전). */
export async function importJournal(
  q: Queryable,
  entries: JournalEntry[]
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  for (const e of entries) {
    const { rowCount } = await q.query(`${INSERT_SQL} on conflict (id) do nothing`, entryParams(e));
    if ((rowCount ?? 0) > 0) inserted += 1;
  }
  return { inserted, skipped: entries.length - inserted };
}
