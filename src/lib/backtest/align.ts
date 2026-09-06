// 미국 거래일을 한국 거래일에 붙이는 규칙.
//
//   미국 거래일 D → 한국 거래일 중 D보다 큰 첫 번째 날
//
// 미국장은 한국시간 새벽에 끝나므로, D가 한국 거래일이더라도 그날 한국장은 이미
// 끝난 뒤다. 뒤집으면 한국 거래일 k에 붙는 미국 거래일은 prevKr <= D < k 구간의 것들이다.
//
// 하루만 어긋나도 아직 일어나지 않은 일을 알고 매매한 셈이 되어 백테스트가 전부
// 거짓이 된다. align.test.ts의 날짜는 KIS 실호출로 확인한 실제 거래일이다.

/** 연휴로 미국 여러 거래일이 한국 하루에 몰릴 때의 처리 방식. */
export type HolidayMode = "skip" | "sum" | "last";

export interface AlignedDay {
  krDate: string;
  /** 이 한국 거래일에 반영되는 미국 거래일들. 보통 1개, 연휴면 여러 개, 미국이 쉬었으면 0개. */
  usDates: string[];
}

/** 날짜는 YYYY-MM-DD이므로 문자열 비교가 곧 시간 순서다. 입력은 오름차순을 가정한다. */
export function alignUsToKr(usDates: string[], krDates: string[]): AlignedDay[] {
  const out: AlignedDay[] = [];
  for (let i = 1; i < krDates.length; i++) {
    const prevKr = krDates[i - 1];
    const krDate = krDates[i];
    out.push({
      krDate,
      usDates: usDates.filter((d) => d >= prevKr && d < krDate),
    });
  }
  return out;
}

/**
 * 미국 거래일이 하나도 없는 날은 신호 자체가 없으므로 어느 모드에서든 버린다.
 * 기본은 skip — 연휴 표본은 전체의 몇 %도 안 되면서 영향력만 커서, 소수의 연휴 건이
 * "미국 신호가 통했다/안 통했다"를 뒤집을 수 있다.
 */
export function applyHolidayMode(
  days: AlignedDay[],
  mode: HolidayMode
): AlignedDay[] {
  const nonEmpty = days.filter((d) => d.usDates.length > 0);
  if (mode === "skip") return nonEmpty.filter((d) => d.usDates.length === 1);
  if (mode === "last")
    return nonEmpty.map((d) => ({
      krDate: d.krDate,
      usDates: [d.usDates[d.usDates.length - 1]],
    }));
  if (mode === "sum") return nonEmpty;
  // HolidayMode는 위 세 값뿐이므로 여기 도달하면 타입이 깨진 것이다.
  const exhaustive: never = mode;
  throw new Error(`알 수 없는 mode: ${exhaustive}`);
}
