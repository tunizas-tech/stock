// 서버 모드에서 data.ts가 쓰는 얇은 HTTP 클라이언트. 실패는 Error로 던진다 — 폼이 잡아 표시한다.
import type { JournalEntry } from "./types";

async function fail(res: Response): Promise<never> {
  let msg = `HTTP ${res.status}`;
  try {
    const b = await res.json();
    if (b?.error) msg = b.field ? `${b.field}: ${b.error}` : b.error;
  } catch {
    /* 본문 없음 */
  }
  throw new Error(msg);
}

export async function fetchJournal(): Promise<JournalEntry[]> {
  const res = await fetch("/api/journal", { cache: "no-store" });
  if (!res.ok) return fail(res);
  return ((await res.json()) as { entries: JournalEntry[] }).entries;
}

export async function postJournal(draft: Omit<JournalEntry, "id">): Promise<JournalEntry> {
  const res = await fetch("/api/journal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  if (!res.ok) return fail(res);
  return (await res.json()) as JournalEntry;
}

export async function patchLesson(id: string, lesson: string): Promise<void> {
  const res = await fetch(`/api/journal/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lesson }),
  });
  if (!res.ok) return fail(res);
}

export async function deleteJournalEntry(id: string): Promise<void> {
  const res = await fetch(`/api/journal/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) return fail(res);
}

/** 이관 결과. `rejected`는 형식에서 벗어나 건너뛴 행 — 나머지는 그대로 들어간다(I-6). */
export interface ImportResult {
  inserted: number;
  skipped: number;
  rejected: { index: number; id?: unknown; field: string; error: string }[];
}

export async function importJournalEntries(entries: JournalEntry[]): Promise<ImportResult> {
  const res = await fetch("/api/journal/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
  if (!res.ok) return fail(res);
  return (await res.json()) as ImportResult;
}
