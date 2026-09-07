// 자기검증 설정 — 봉인 기간과 손절 기준(6단계 설계 §5).
//
// localStorage 전용(v1) — 왜 Supabase 분기를 안 두는가: 봉인(N2)은 "이 기기에서
// 아직 안 열렸다"는 사실 자체가 의미다. 여러 기기가 설정을 공유하면 한 기기에서
// 봉인이 풀린 순간 다른 기기에서도 풀려버려, 오히려 "아직 결과를 몰라야 자기보고가
// 오염되지 않는다"는 목적을 해친다. 그래서 이 설정은 기기별로 따로 논다 —
// 사용자가 새 기기에서 쓰면 봉인이 다시 걸릴 수 있다는 뜻이고, 이는 의도한 동작이다.
//
// 왜 기본값이 180일인가(N2, "측정을 아는 순간 자기보고가 오염된다"): 확신도·이유를
// 적으면서 "이게 나중에 채점된다"를 의식하면, 실제 그 순간의 심리가 아니라
// 나중에 잘 보이고 싶은 값을 적게 된다. 이 페이지의 존재 자체를 몰랐던 첫 반년의
// 기록이 가장 오염이 적은 기준선이다 — 봉인은 그 기간 동안 결과 화면 자체를
// 가려 사용자가 자기 점수를 의식하지 못하게 한다.

export interface JournalSettings {
  sealDays: number;
  stopLossPct?: number;
}

export const DEFAULT_SETTINGS: JournalSettings = { sealDays: 180 };

const STORAGE_KEY = "ssn.journal.settings";

/** SSR-safe — window가 없으면(서버 렌더링 중) 기본값을 돌려준다. */
export function loadSettings(): JournalSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<JournalSettings>;
    return {
      sealDays:
        typeof parsed.sealDays === "number" ? parsed.sealDays : DEFAULT_SETTINGS.sealDays,
      stopLossPct: typeof parsed.stopLossPct === "number" ? parsed.stopLossPct : undefined,
    };
  } catch {
    // 손상된 JSON — 크래시 대신 기본값으로 떨어진다(다른 lsRead들과 같은 방어 패턴).
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: JournalSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

/**
 * 봉인 기준일 = 기록을 남긴 시점(`createdAt`)의 최솟값, 날짜 부분만.
 *
 * 왜 거래일(`date`)이 아닌가: 설계 §4의 봉인은 "**기록을 남긴 뒤** N일"이다.
 * 거래일을 기준으로 하면 2년 전 날짜로 기록 하나만 백필해도 봉인이 즉시
 * 열려버린다 — 봉인의 목적(결과를 모르는 채로 반년치 기록을 쌓는 것) 자체가
 * 사라진다. `createdAt`은 폼이 저장 순간에 찍으므로 과거로 되돌릴 수 없다.
 *
 * `createdAt`이 있는 기록이 하나도 없으면 undefined — "아직 봉인이 시작되지
 * 않았다"는 뜻이고, 이 필드가 생기기 전의 옛 기록만 있는 경우도 여기 해당한다.
 */
export function sealBaseDate(entries: readonly { createdAt?: string }[]): string | undefined {
  let min: string | undefined;
  for (const e of entries) {
    const c = e.createdAt;
    // ISO 8601(YYYY-MM-DD...)만 인정한다. 손상된 값이 최솟값으로 잡혀 봉인을
    // 영원히 걸어두거나 반대로 즉시 열어버리는 일을 막는다.
    if (typeof c !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(c)) continue;
    const day = c.slice(0, 10);
    if (min === undefined || day < min) min = day;
  }
  return min;
}

/**
 * 봉인이 풀리는 날짜(YYYY-MM-DD) = 기준일(sealBaseDate) + sealDays. 기준일이
 * 없으면(아직 기록을 시작하지 않음) 열리는 날짜도 정할 수 없으므로 undefined.
 */
export function sealOpensOn(
  baseDate: string | undefined,
  sealDays: number
): string | undefined {
  if (baseDate === undefined) return undefined;
  const d = new Date(`${baseDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + sealDays);
  return d.toISOString().slice(0, 10);
}

/**
 * 오늘이 봉인 기간 안인가. 오픈일(`sealOpensOn`) 당일부터는 봉인이 풀린다 —
 * 즉 봉인은 `[기준일, 오픈일)` 반열린 구간이다.
 *
 * 기준일이 없으면(아직 `createdAt`이 있는 기록이 하나도 없음) **봉인 상태로
 * 둔다**. 열어주면 `date`만 있는 옛 기록이나 백필로 봉인을 우회할 수 있기
 * 때문이다. 대신 `sealDays <= 0`을 먼저 본다 — 설정에서 봉인을 끈 것은 언제나
 * 존중해야 한다. 이 필드가 생기기 전의 일지만 가진 사용자에게는 이 설정이
 * 유일한 탈출구이고, 봉인 화면에 설정 카드를 같이 두는 이유이기도 하다.
 */
export function isSealed(
  baseDate: string | undefined,
  sealDays: number,
  today: string
): boolean {
  if (sealDays <= 0) return false;
  if (baseDate === undefined) return true;
  const opensOn = sealOpensOn(baseDate, sealDays);
  if (opensOn === undefined) return true;
  return today < opensOn;
}
