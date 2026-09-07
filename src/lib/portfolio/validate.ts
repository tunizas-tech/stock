// 보유·관심종목 서버 문의 본문 검증(8단계 설계 §2) — 타입·enum만 본다. 순수 함수.
// 업무 규칙(중복 종목 금지 등)은 두지 않는다 — 옛 브라우저 기록 이관이 막히면 안 된다.
import type { Holding, WatchItem } from "@/lib/types";
import { DATE_RE, TICKER_RE, type ParseResult } from "@/lib/journal/validate";

const fail = (field: string, error: string): ParseResult<never> => ({ ok: false, field, error });
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function common(b: Record<string, unknown>): ParseResult<{ market: "KR" | "US"; ticker: string; name: string }> {
  if (b.market !== "KR" && b.market !== "US") return fail("market", "KR 또는 US");
  if (typeof b.ticker !== "string" || !TICKER_RE.test(b.ticker)) return fail("ticker", "6자리 숫자 또는 1~5자리 대문자");
  if (typeof b.name !== "string" || b.name.length === 0 || b.name.length > 60) return fail("name", "1~60자");
  return { ok: true, value: { market: b.market, ticker: b.ticker, name: b.name } };
}

export function parseHolding(body: unknown): ParseResult<Omit<Holding, "id">> {
  const b = (body ?? {}) as Record<string, unknown>;
  const c = common(b);
  if (!c.ok) return c;
  if (!isFiniteNumber(b.shares) || b.shares <= 0) return fail("shares", "0보다 큰 숫자");
  if (!isFiniteNumber(b.avgPrice) || b.avgPrice < 0) return fail("avgPrice", "0 이상 숫자");
  if (typeof b.openedAt !== "string" || !DATE_RE.test(b.openedAt)) return fail("openedAt", "YYYY-MM-DD");
  return { ok: true, value: { ...c.value, shares: b.shares, avgPrice: b.avgPrice, openedAt: b.openedAt } };
}

export function parseWatch(body: unknown): ParseResult<Omit<WatchItem, "id">> {
  const b = (body ?? {}) as Record<string, unknown>;
  const c = common(b);
  if (!c.ok) return c;
  const memo = b.memo === undefined || b.memo === null ? "" : b.memo;
  if (typeof memo !== "string" || memo.length > 500) return fail("memo", "500자 이하 문자열");
  if (typeof b.addedAt !== "string" || !DATE_RE.test(b.addedAt)) return fail("addedAt", "YYYY-MM-DD");
  return { ok: true, value: { ...c.value, memo, addedAt: b.addedAt } };
}

/** 이관 행의 id — 브라우저가 만든 값을 그대로 쓰되 길이만 막는다(SQL 파라미터·URL 인코딩으로만 쓰여 탐색 위험은 없다). */
export function parseImportId(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.length >= 1 && raw.length <= 64 ? raw : undefined;
}
