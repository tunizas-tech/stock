// 서버 모드에서 data.ts가 쓰는 얇은 HTTP 클라이언트. 실패는 Error로 던진다 — 폼이 잡아 표시한다.
import type { JournalEntry } from "./types";
// ImportResult는 이제 ./import-split에서 공용으로 관리한다(보유·관심종목과 공유) —
// 기존 import 경로(@/lib/journal-client)를 쓰는 곳이 있을 수 있어 재export한다.
import type { ImportResult } from "./import-split";
export type { ImportResult };

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

export async function importJournalEntries(entries: JournalEntry[]): Promise<ImportResult> {
  const res = await fetch("/api/journal/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
  if (!res.ok) return fail(res);
  return (await res.json()) as ImportResult;
}
