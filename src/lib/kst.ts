// 한국 시간 판정 — 순수 함수, 클라이언트·서버 공용.
// 컨테이너 TZ가 UTC라 Date.toISOString()의 날짜는 한국 자정~09:00 사이에 하루 어긋난다.
// "오늘", "장 마감 전인가"는 전부 여기서만 계산한다(설계 §3.3).

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** ISO 시각(또는 Date)의 한국 날짜 YYYY-MM-DD. */
export function kstDate(iso: string | Date): string {
  const t = typeof iso === "string" ? Date.parse(iso) : iso.getTime();
  return new Date(t + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 오늘(KST). now를 주입받아 테스트가 결정적이다. */
export function todayKst(now: Date = new Date()): string {
  return kstDate(now);
}

/**
 * `createdAt`이 `date`의 장 마감(15:30 KST = 06:30Z) 이후인가.
 * 마감 전에 쓴 기록은 그날 종가를 아직 모르므로 그날 종가 진입이 미리보기가 아니다(설계 §5).
 * 파싱 불가한 값은 "마감 후"로 본다 — 보수적으로 다음 거래일 진입.
 */
export function isAfterCloseKst(createdAtIso: string, date: string): boolean {
  const t = Date.parse(createdAtIso);
  if (!Number.isFinite(t)) return true;
  return t >= Date.parse(`${date}T06:30:00.000Z`);
}
