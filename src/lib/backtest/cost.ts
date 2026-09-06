// 왕복 거래 비용 — 매수·매도 수수료 + 증권거래세 + 슬리피지.
//
// 보유 3~5일이면 연 약 50회 매매이므로 왕복 0.4%는 복리로 연 18% 남짓이 된다. 그만큼
// 먼저 벌어야 본전이다. 비용을 빼지 않은 백테스트는 "되는 것처럼 보이는데 실제로는
// 안 되는" 결과를 낸다.
//
// 증권거래세율은 최근 몇 년간 반복 개정되었다. 실제 매매에 쓰기 전 현행 세율을 확인할 것.

/** 왕복 0.4%. 수수료·거래세·슬리피지를 합친 보수적 기본값. */
export const DEFAULT_ROUND_TRIP = 0.004;

/** 총수익에 왕복 비용을 곱셈으로 적용한다. */
export function applyCost(
  grossReturn: number,
  roundTrip: number = DEFAULT_ROUND_TRIP
): number {
  return (1 + grossReturn) * (1 - roundTrip) - 1;
}

/** 연간 매매 횟수로 환산한 누적 비용. 보고서에 "본전 문턱"으로 찍는다. */
export function annualCost(roundTrip: number, tradesPerYear: number): number {
  return 1 - (1 - roundTrip) ** tradesPerYear;
}
