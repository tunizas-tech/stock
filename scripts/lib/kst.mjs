// 한국 시간 판정 — src/lib/kst.ts의 kstDate/todayKst를 JS로 옮긴 것.
// 스크립트(.mjs)는 TS 파일을 직접 import할 수 없어 여기 별도로 둔다. 두 구현이
// 같은 값을 내는지는 src/lib/kst.test.ts에서 대조한다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** ISO 시각(또는 Date)의 한국 날짜 YYYY-MM-DD. */
export function kstDate(iso) {
  const t = typeof iso === "string" ? Date.parse(iso) : iso.getTime();
  return new Date(t + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 오늘(KST). now를 주입받아 테스트가 결정적이다. */
export function todayKst(now = new Date()) {
  return kstDate(now);
}
