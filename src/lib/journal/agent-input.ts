// 에이전트 문의 본문 검증(설계 §3.2) — 순수 함수. 라우트는 이 결과로 400/201만 가른다.
// action·date·price·qty는 "받지 않는다"가 규칙이다: 무시하면 에이전트가 buy를 보내도 조용히
// skip으로 저장되어 절차서 위반을 못 알아챈다. 있으면 400으로 되돌려 절차서를 고치게 한다.
import type { Emotion, ReasonTag } from "@/lib/types";
import { FLOW_SECTORS } from "@/lib/flow/universe";
import { REASON_TAGS, type ParseResult } from "./validate";

export const AGENT_DAILY_CAP = 3;
const KR_TICKER_RE = /^\d{6}$/;
const FORBIDDEN = ["action", "date", "price", "qty"] as const;

export interface AgentInput {
  ticker: string; name: string; sector: string; reason: string; emotion: Emotion; tags?: ReasonTag[];
}

export function parseAgentInput(body: unknown): ParseResult<AgentInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const fail = (field: string, error: string): ParseResult<never> => ({ ok: false, field, error });
  for (const f of FORBIDDEN) if (f in b) return fail(f, "에이전트 문은 이 필드를 받지 않는다(서버가 정한다)");
  if (typeof b.ticker !== "string" || !KR_TICKER_RE.test(b.ticker)) return fail("ticker", "한국 6자리 종목코드");
  if (typeof b.name !== "string" || b.name.length === 0 || b.name.length > 60) return fail("name", "1~60자");
  if (typeof b.sector !== "string" || !FLOW_SECTORS.includes(b.sector)) return fail("sector", `다음 중 하나: ${FLOW_SECTORS.join(", ")}`);
  if (typeof b.reason !== "string" || b.reason.length === 0 || b.reason.length > 1000) return fail("reason", "1~1000자");
  if (!/https?:\/\//.test(b.reason)) return fail("reason", "출처 URL(http…)이 있어야 한다");
  if (![1, 2, 3, 4, 5].includes(b.emotion as number)) return fail("emotion", "정수 1~5");
  let tags: ReasonTag[] | undefined;
  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags) || !b.tags.every((t) => REASON_TAGS.includes(t as ReasonTag) && t !== "에이전트"))
      return fail("tags", "정해진 태그 배열(에이전트 제외)");
    tags = [...new Set(b.tags as ReasonTag[])];
  }
  const value: AgentInput = { ticker: b.ticker, name: b.name, sector: b.sector, reason: b.reason, emotion: b.emotion as Emotion };
  if (tags) value.tags = tags;
  return { ok: true, value };
}
