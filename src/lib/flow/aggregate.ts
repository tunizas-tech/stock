// 저장된 종목별 수급을 섹터 단위로 합산하는 순수 함수 모음.
// 파일 I/O는 하지 않는다 — 데이터는 호출자가 들고 온다(scripts/flow-fetch.mjs가
// data/flow/*.json에 적재한 것을 라우트/스크립트가 읽어 여기 넘기는 그림).

export interface FlowDay {
  date: string;
  close: number;
  foreign: number;
  institution: number;
  individual: number;
  foreignQty: number;
  institutionQty: number;
  individualQty: number;
}

export interface StockFlow {
  ticker: string;
  name: string;
  sector: string;
  days: FlowDay[];
}

/** 섹터별로 합산한 하루치. 종목 대금을 단순 합산한다. */
export interface SectorFlowDay {
  date: string;
  foreign: number;
  institution: number;
  individual: number;
  stocks: number;
}

/**
 * 특정 섹터에 속한 종목들의 수급을 날짜별로 합산한다.
 *
 * 정직성 요구: 종목마다 저장된 날짜 범위가 다를 수 있다(적재를 늦게 시작한
 * 종목, API 실패로 특정 날짜가 빠진 종목 등). 어떤 날짜에 섹터 3종목 중
 * 1종목만 데이터가 있어도 그 날짜를 결과에서 빼거나 없는 종목분을 0으로
 * 채워 넣지 않는다 — 있는 종목만 더하고, `stocks`에 몇 종목이 실제로
 * 그 날짜에 기여했는지를 그대로 남긴다. 그래야 "섹터 전체가 보고한 것"과
 * "일부만 보고했는데 우연히 합계가 비슷해 보이는 것"을 구분할 수 있다.
 */
export function aggregateBySector(flows: StockFlow[], sector: string): SectorFlowDay[] {
  const bySector = flows.filter((f) => f.sector === sector);

  const byDate = new Map<string, { foreign: number; institution: number; individual: number; stocks: number }>();
  for (const stock of bySector) {
    for (const day of stock.days) {
      const acc = byDate.get(day.date) ?? { foreign: 0, institution: 0, individual: 0, stocks: 0 };
      acc.foreign += day.foreign;
      acc.institution += day.institution;
      acc.individual += day.individual;
      acc.stocks += 1;
      byDate.set(day.date, acc);
    }
  }

  return [...byDate.entries()]
    .map(([date, acc]) => ({ date, ...acc }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 섹터별로 최근 `days` 거래일치를 합산해 "돈이 어디로 흐르는가" 순위를 만든다.
 * foreign + institution(외국인 + 기관 순매수 대금) 내림차순, 동률이면 섹터명
 * 오름차순으로 정렬해 결과가 항상 결정적이도록 한다.
 *
 * `tradingDays`는 실제로 합산에 쓰인 고유 날짜 수다. API가 최대 30일 창만
 * 주는 초기 단계에서는 이 값이 요청한 `days`보다 작을 수 있고, 그 값 자체가
 * "이 숫자를 얼마나 믿어도 되는가"를 나타내는 신호다 — 호출자가 반드시
 * 함께 표시해야 한다.
 */
export function sectorTotals(
  flows: StockFlow[],
  days: number
): { sector: string; foreign: number; institution: number; individual: number; tradingDays: number }[] {
  const sectors = [...new Set(flows.map((f) => f.sector))];

  const result = sectors.map((sector) => {
    const bySector = flows.filter((f) => f.sector === sector);

    // 섹터에 속한 종목들의 날짜를 모두 모아 최근 `days`개만 남긴다.
    // (종목별로 보유한 날짜가 다를 수 있으므로 종목 단위가 아니라
    // "섹터가 관측한 고유 날짜" 단위로 최근 N일을 정의한다.)
    const allDates = new Set<string>();
    for (const stock of bySector) {
      for (const day of stock.days) allDates.add(day.date);
    }
    const recentDates = new Set([...allDates].sort((a, b) => b.localeCompare(a)).slice(0, days));

    let foreign = 0;
    let institution = 0;
    let individual = 0;
    for (const stock of bySector) {
      for (const day of stock.days) {
        if (!recentDates.has(day.date)) continue;
        foreign += day.foreign;
        institution += day.institution;
        individual += day.individual;
      }
    }

    return { sector, foreign, institution, individual, tradingDays: recentDates.size };
  });

  return result.sort((a, b) => {
    const diff = b.foreign + b.institution - (a.foreign + a.institution);
    if (diff !== 0) return diff;
    return a.sector.localeCompare(b.sector);
  });
}
