// 서버 모드에서 data.ts가 쓰는 얇은 HTTP 클라이언트(journal-client와 같은 규약). 실패는 Error로 던진다.
import type { Holding, WatchItem } from "./types";
import type { ImportResult } from "./import-split";

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
const J = { "Content-Type": "application/json" };

export async function fetchHoldings(): Promise<Holding[]> {
  const res = await fetch("/api/holdings", { cache: "no-store" });
  if (!res.ok) return fail(res);
  return ((await res.json()) as { holdings: Holding[] }).holdings;
}
export async function postHolding(draft: Omit<Holding, "id">): Promise<Holding> {
  const res = await fetch("/api/holdings", { method: "POST", headers: J, body: JSON.stringify(draft) });
  if (!res.ok) return fail(res);
  return (await res.json()) as Holding;
}
/** 산업 분류만 바꾼다. undefined = 자동 판정(유니버스)으로 되돌림 → 서버엔 null로 보낸다. */
export async function patchHoldingSector(id: string, sector: string | undefined): Promise<Holding> {
  const res = await fetch(`/api/holdings/${encodeURIComponent(id)}`, { method: "PATCH", headers: J, body: JSON.stringify({ sector: sector ?? null }) });
  if (!res.ok) return fail(res);
  return (await res.json()) as Holding;
}
export async function deleteHoldingEntry(id: string): Promise<void> {
  const res = await fetch(`/api/holdings/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) return fail(res);
}
export async function importHoldingRows(rows: Holding[]): Promise<ImportResult> {
  const res = await fetch("/api/holdings/import", { method: "POST", headers: J, body: JSON.stringify({ rows }) });
  if (!res.ok) return fail(res);
  return (await res.json()) as ImportResult;
}
export async function fetchWatch(): Promise<WatchItem[]> {
  const res = await fetch("/api/watchlist", { cache: "no-store" });
  if (!res.ok) return fail(res);
  return ((await res.json()) as { watchlist: WatchItem[] }).watchlist;
}
export async function postWatch(draft: Omit<WatchItem, "id">): Promise<WatchItem> {
  const res = await fetch("/api/watchlist", { method: "POST", headers: J, body: JSON.stringify(draft) });
  if (!res.ok) return fail(res);
  return (await res.json()) as WatchItem;
}
export async function deleteWatchEntry(id: string): Promise<void> {
  const res = await fetch(`/api/watchlist/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) return fail(res);
}
export async function importWatchRows(rows: WatchItem[]): Promise<ImportResult> {
  const res = await fetch("/api/watchlist/import", { method: "POST", headers: J, body: JSON.stringify({ rows }) });
  if (!res.ok) return fail(res);
  return (await res.json()) as ImportResult;
}
