// 사람 문(POST /api/journal, import)의 본문 검증 — 타입·enum만 본다. "주 이유 필수" 같은
// 업무 규칙은 폼(JournalEntryForm)이 이미 강제하고, 여기서 다시 막으면 옛 기록 이관이 막힌다.
//
// lib/journal 밑에 두는 이유(컨트롤러 판정 R1): 이 함수는 원래 브리프가
// src/app/api/journal/validate-entry.ts에 두라고 했지만, Task 6(에이전트 문)이
// REASON_TAGS/ParseResult를 재사용해야 하고 lib은 app을 import할 수 없다 —
// 그래서 공유 타입·상수는 validate.ts에, 사람 문 전용 파서는 이 파일에 둔다.
import type { JournalEntry, ReasonTag } from "@/lib/types";
import { DATE_RE, REASON_TAGS, TICKER_RE, type ParseResult } from "./validate";

const ACTIONS = ["buy", "sell", "note", "skip"] as const;

// 이관(import) 대상은 옛 localStorage 기록이나 DB row를 그대로 들고 올 수 있어
// 선택 필드가 undefined 대신 null로 올 수 있다(예: Postgres가 없는 컬럼을 null로
// 준다). snapshot은 이미 null을 허용하는데 나머지 선택 필드만 안 그러면 같은
// 모양의 데이터가 필드에 따라 통과/거부가 갈리므로, 여기서 한 번에 null을
// undefined로 접어 이후 검증·조립 로직 전체가 "없음"을 한 가지로만 본다.
const OPTIONAL_KEYS = ["price", "qty", "lesson", "primaryTag", "tags", "snapshot", "createdAt"] as const;

export function parseUserEntry(body: unknown): ParseResult<Omit<JournalEntry, "id">> {
  const raw = (body ?? {}) as Record<string, unknown>;
  const b: Record<string, unknown> = { ...raw };
  for (const key of OPTIONAL_KEYS) if (b[key] === null) delete b[key];
  const fail = (field: string, error: string): ParseResult<never> => ({ ok: false, field, error });
  if (typeof b.date !== "string" || !DATE_RE.test(b.date)) return fail("date", "YYYY-MM-DD");
  if (b.market !== "KR" && b.market !== "US") return fail("market", "KR 또는 US");
  if (typeof b.ticker !== "string" || !TICKER_RE.test(b.ticker)) return fail("ticker", "6자리 숫자 또는 1~5자리 대문자");
  if (typeof b.name !== "string" || b.name.length === 0 || b.name.length > 60) return fail("name", "1~60자");
  if (!ACTIONS.includes(b.action as (typeof ACTIONS)[number])) return fail("action", "buy/sell/note/skip");
  if (b.price !== undefined && (typeof b.price !== "number" || !Number.isFinite(b.price))) return fail("price", "숫자");
  if (b.qty !== undefined && (typeof b.qty !== "number" || !Number.isFinite(b.qty))) return fail("qty", "숫자");
  if (typeof b.reason !== "string" || b.reason.length > 2000) return fail("reason", "문자열, 2000자 이하");
  if (![1, 2, 3, 4, 5].includes(b.emotion as number)) return fail("emotion", "1~5");
  if (b.lesson !== undefined && typeof b.lesson !== "string") return fail("lesson", "문자열");
  if (b.primaryTag !== undefined && !REASON_TAGS.includes(b.primaryTag as ReasonTag)) return fail("primaryTag", "정해진 태그");
  if (b.tags !== undefined && (!Array.isArray(b.tags) || !b.tags.every((t) => REASON_TAGS.includes(t as ReasonTag)))) return fail("tags", "정해진 태그 배열");
  if (b.createdAt !== undefined && (typeof b.createdAt !== "string" || !Number.isFinite(Date.parse(b.createdAt)))) return fail("createdAt", "ISO 시각");
  const value: Omit<JournalEntry, "id"> = {
    date: b.date, market: b.market, ticker: b.ticker, name: b.name,
    action: b.action as JournalEntry["action"], reason: b.reason,
    emotion: b.emotion as JournalEntry["emotion"], lesson: (b.lesson as string) ?? "",
  };
  if (b.price !== undefined) value.price = b.price as number;
  if (b.qty !== undefined) value.qty = b.qty as number;
  if (b.primaryTag !== undefined) value.primaryTag = b.primaryTag as ReasonTag;
  if (b.tags !== undefined) value.tags = b.tags as ReasonTag[];
  if (b.snapshot !== undefined && typeof b.snapshot === "object") value.snapshot = b.snapshot as JournalEntry["snapshot"];
  if (b.createdAt !== undefined) value.createdAt = b.createdAt as string;
  return { ok: true, value };
}
