// 티커·날짜 형식 검증 — journal 라우트 두 개가 공유한다.
//
// 왜 별도 파일인가: 이 두 정규식은 "화면에 뭘 보여줄까"가 아니라 **파일 경로에
// 사용자 입력이 그대로 들어가는 것을 막는 방어선**이다. snapshot 라우트는
// `data/flow/<ticker>.json`을, review 라우트는 같은 경로를 티커별로 읽는다 —
// 검증 없이 통과시키면 "../../etc/passwd" 같은 값이 data/ 밖 파일을 가리킬 수
// 있다. 한쪽 라우트에만 있는 방어는 언젠가 다른 쪽에서 빠지므로 여기 한 곳에
// 두고 둘 다 import한다.

/** KR: 6자리 숫자. US: 1~5자리 대문자 알파벳(예: AAPL, NVDA). */
export const TICKER_RE = /^(\d{6}|[A-Z]{1,5})$/;

/** YYYY-MM-DD. */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 매매 이유 태그(6단계 설계 §1, 7종 고정 + 7단계 "에이전트" 1종). 사람 문
// 검증(user-input.ts)과 앞으로 올 에이전트 문 검증(Task 6)이 같은 닫힌 집합을
// 봐야 하므로 여기 한 곳에 둔다 — lib은 app을 import할 수 없어(R1) validate-entry.ts가
// 아니라 이 파일이 그 공유 지점이다.
import type { ReasonTag } from "../types";
export const REASON_TAGS: readonly ReasonTag[] = [
  "수급", "지표", "섹터강세", "미국장", "뉴스", "밸류체인", "직관", "에이전트",
];

/** 사람 문·에이전트 문 검증 함수가 공유하는 판정 결과 모양. */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string; field: string };

/**
 * 이 티커를 파일 경로에 넣어도 되는가. 경로 구분자·상위 디렉터리(..)는 물론
 * 형식에서 벗어난 값 전부를 막는다 — 화이트리스트라 새로운 우회를 걱정할 필요가
 * 없다(블랙리스트였다면 ".." 말고도 계속 늘어난다).
 */
export function isSafeTicker(ticker: unknown): ticker is string {
  return typeof ticker === "string" && TICKER_RE.test(ticker);
}
