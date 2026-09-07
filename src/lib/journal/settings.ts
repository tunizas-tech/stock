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
 * 봉인이 풀리는 날짜(YYYY-MM-DD) = 첫 기록일 + sealDays. 첫 기록 자체가 없으면
 * 봉인할 대상이 없으므로 undefined.
 */
export function sealOpensOn(
  firstEntryDate: string | undefined,
  sealDays: number
): string | undefined {
  if (firstEntryDate === undefined) return undefined;
  const d = new Date(`${firstEntryDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + sealDays);
  return d.toISOString().slice(0, 10);
}

/**
 * 오늘이 봉인 기간 안인가. `sealDays <= 0`이면 설정에서 봉인을 껐다는 뜻이라
 * 언제나 false. 오픈일(`sealOpensOn`) 당일부터는 봉인이 풀린다 — 즉 봉인은
 * `[첫 기록일, 오픈일)` 반열린 구간이다.
 */
export function isSealed(
  firstEntryDate: string | undefined,
  sealDays: number,
  today: string
): boolean {
  if (firstEntryDate === undefined) return false;
  if (sealDays <= 0) return false;
  const opensOn = sealOpensOn(firstEntryDate, sealDays);
  if (opensOn === undefined) return false;
  return today < opensOn;
}
