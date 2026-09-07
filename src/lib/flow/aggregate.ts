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

/**
 * "3주체 view가 못 믿을 수준인가"를 가르는 임계값. otherRatio(|기타법인
 * 잔차| / 총유출입)가 이 값을 넘으면 unreliable이 true가 된다.
 *
 * 실측 근거(30종목 30거래일): 반도체 삼성전자 8.0%, SK하이닉스 17.7%,
 * 방산 한국항공우주 14.8%, 배터리 LG에너지솔루션 9.2% — 모두 알려진
 * 자사주 매입과 겹치는 종목이며 이 임계값을 넘는다. 반대로 조선
 * HD한국조선해양 0.2%, 금융 하나금융지주 0.0%처럼 잔차가 미미한
 * 26/30종목은 임계값 아래다. 즉 0.05는 "잔차가 노이즈 수준을 벗어나
 * 실제 4번째 주체(기타법인 등)의 움직임으로 봐야 하는 지점"과 대체로
 * 일치한다. 바로 그 판정 기준을 코드 속에 숨기지 않고 상수로 꺼내
 * 둔다 — 호출자가 이 숫자 자체를 보고 판단할 수 있어야 한다.
 */
export const OTHER_RATIO_UNRELIABLE_THRESHOLD = 0.05;

/** 섹터별로 합산한 하루치. 종목 대금을 단순 합산한다. */
export interface SectorFlowDay {
  date: string;
  foreign: number;
  institution: number;
  individual: number;
  /**
   * 기타법인 등(추정) — KIS API가 보고하지 않는 나머지 투자자 유형(대표적으로
   * 기타법인의 자사주 매입)의 순매수 잔차. 실측/보고 값이 아니라
   * -(individual + foreign + institution)으로 역산한 추정치다. 모든 거래는
   * 사는 쪽과 파는 쪽이 있어 전체 투자자 유형의 순매수 합은 0이어야 하므로,
   * KIS가 다루는 3주체 밖의 움직임은 전부 여기로 흡수된다 — KRX가 보고하지만
   * KIS가 다루지 않는 다른 유형이 있다면 그것도 포함될 수 있다.
   */
  other: number;
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
export function aggregateBySector(flows: StockFlow[], sector: string, until?: string): SectorFlowDay[] {
  const bySector = flows.filter((f) => f.sector === sector);

  const byDate = new Map<string, { foreign: number; institution: number; individual: number; other: number; stocks: number }>();
  for (const stock of bySector) {
    for (const day of stock.days) {
      // until(포함 상한)이 있으면 그 이후 날짜는 애초에 집계 대상에서 뺀다 — 매매일
      // 당일·이후 종가가 스냅샷에 섞이는 look-ahead(C1)를 여기서 막는다.
      if (until !== undefined && day.date > until) continue;
      const acc = byDate.get(day.date) ?? { foreign: 0, institution: 0, individual: 0, other: 0, stocks: 0 };
      acc.foreign += day.foreign;
      acc.institution += day.institution;
      acc.individual += day.individual;
      // 종목 단위 잔차를 그날그날 더한다 — 선형이라 나중에 섹터 합계에서
      // 한 번에 역산해도 같은 값이 나오지만, "구성 종목 잔차의 합"이라는
      // 의미를 코드에서도 그대로 드러내기 위해 여기서 누적한다.
      acc.other += -(day.foreign + day.institution + day.individual);
      acc.stocks += 1;
      byDate.set(day.date, acc);
    }
  }

  return [...byDate.entries()]
    .map(([date, acc]) => ({ date, ...acc }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * individual/foreign/institution 세 주체 합계로부터 기타법인(추정) 잔차와
 * "이 숫자를 3주체만으로 믿어도 되는가"를 함께 계산한다. sectorTotals와
 * stockTotals가 같은 규칙을 쓰도록 공유하는 내부 헬퍼다.
 *
 * gross(총유출입)는 individual/foreign/institution/other 네 총계의 절대값을
 * 더한 값이다. otherRatio = |other| / gross이며, gross가 0(창 안에 흐름 자체가
 * 없음)이면 나눗셈 대신 0을 반환한다.
 */
function computeOtherStats(
  foreign: number,
  institution: number,
  individual: number
): { other: number; otherRatio: number; unreliable: boolean } {
  // `|| 0`으로 -0을 0으로 정규화한다 — 합이 정확히 0일 때 부호 없는 0을
  // 돌려주기 위함이다(그 외 값은 부호를 그대로 보존한다).
  const other = -(foreign + institution + individual) || 0;
  const gross = Math.abs(foreign) + Math.abs(institution) + Math.abs(individual) + Math.abs(other);
  const otherRatio = gross === 0 ? 0 : Math.abs(other) / gross;
  const unreliable = otherRatio > OTHER_RATIO_UNRELIABLE_THRESHOLD;
  return { other, otherRatio, unreliable };
}

/** `sectorTotals`가 섹터 하나에 대해 반환하는 요약. */
export interface SectorTotal {
  sector: string;
  foreign: number;
  institution: number;
  individual: number;
  /** 기타법인 등(추정) 잔차. `SectorFlowDay.other`와 같은 정의 — 실측이 아닌 역산값. */
  other: number;
  /** |other| / gross. gross(총유출입)가 0이면 0. */
  otherRatio: number;
  /**
   * otherRatio가 {@link OTHER_RATIO_UNRELIABLE_THRESHOLD}를 넘으면 true.
   * true라면: 이 섹터는 세 주체(개인·외국인·기관) 숫자만으로 해석하면
   * 안 된다, 기타법인이 흐름의 상당 부분을 차지한다 — 즉 "어디서 돈이
   * 빠졌다/들어왔다"는 3주체 기준 서술이 실제로는 자사주 매입 등
   * 4번째 주체의 움직임을 반대로 읽었을 수 있다는 뜻이다.
   */
  unreliable: boolean;
  tradingDays: number;
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
 *
 * `until`(YYYY-MM-DD, 포함 상한)을 주면 그 날짜보다 뒤(초과)의 데이터는 아예
 * 없는 셈 치고, "최근 `days`일"을 `until` 기준으로 거꾸로 센다 — 저장된
 * 마지막 날짜부터가 아니다. 매매일지 스냅샷(설계 문서 C1)이 매매일 전
 * 거래일까지만 봐야 하기 때문에 필요하다. 생략하면 이전과 완전히 같다.
 */
export function sectorTotals(flows: StockFlow[], days: number, until?: string): SectorTotal[] {
  const sectors = [...new Set(flows.map((f) => f.sector))];

  const result = sectors.map((sector) => {
    const bySector = flows.filter((f) => f.sector === sector);

    // 섹터에 속한 종목들의 날짜를 모두 모아 최근 `days`개만 남긴다.
    // (종목별로 보유한 날짜가 다를 수 있으므로 종목 단위가 아니라
    // "섹터가 관측한 고유 날짜" 단위로 최근 N일을 정의한다.)
    // until이 있으면 그 이후 날짜는 애초에 후보에서 뺀다 — "최근 N일"의
    // 기준점이 until이 되도록.
    const allDates = new Set<string>();
    for (const stock of bySector) {
      for (const day of stock.days) {
        if (until !== undefined && day.date > until) continue;
        allDates.add(day.date);
      }
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

    const { other, otherRatio, unreliable } = computeOtherStats(foreign, institution, individual);

    return { sector, foreign, institution, individual, other, otherRatio, unreliable, tradingDays: recentDates.size };
  });

  return result.sort((a, b) => {
    const diff = b.foreign + b.institution - (a.foreign + a.institution);
    if (diff !== 0) return diff;
    return a.sector.localeCompare(b.sector);
  });
}

/** `stockTotals`가 종목 하나에 대해 반환하는 요약. `SectorTotal`과 같은 잔차/신뢰도 규칙을 쓴다. */
export interface StockTotal {
  ticker: string;
  name: string;
  sector: string;
  foreign: number;
  institution: number;
  individual: number;
  /** 기타법인 등(추정) 잔차. 실측이 아닌 역산값. */
  other: number;
  /** |other| / gross. gross(총유출입)가 0이면 0. */
  otherRatio: number;
  /**
   * otherRatio가 {@link OTHER_RATIO_UNRELIABLE_THRESHOLD}를 넘으면 true.
   * 섹터가 unreliable일 때 "섹터 안 어느 종목이 원인인가"를 이 필드로
   * 짚어낼 수 있다 — 예: 반도체가 unreliable이라도 한미반도체가 아니라
   * 삼성전자·SK하이닉스가 원인임을 구분한다.
   */
  unreliable: boolean;
  tradingDays: number;
}

/**
 * 종목별로 최근 `days` 거래일치를 합산한다. sectorTotals와 같은 정의의
 * other/otherRatio/unreliable을 종목 단위로 계산해, 섹터가 unreliable로
 * 표시됐을 때 그 섹터 안 어느 종목이 원인인지 짚을 수 있게 한다.
 *
 * foreign + institution 내림차순, 동률이면 ticker 오름차순으로 정렬해
 * 결과가 항상 결정적이도록 한다.
 *
 * `until`(YYYY-MM-DD, 포함 상한) 의미는 {@link sectorTotals}와 같다 — 그
 * 날짜보다 뒤의 데이터는 없는 셈 치고, "최근 `days`일"을 거기서부터
 * 거꾸로 센다. 생략하면 이전과 완전히 같다.
 */
export function stockTotals(flows: StockFlow[], days: number, until?: string): StockTotal[] {
  const result = flows.map((stock) => {
    const allDates = new Set(
      stock.days.filter((d) => until === undefined || d.date <= until).map((d) => d.date)
    );
    const recentDates = new Set([...allDates].sort((a, b) => b.localeCompare(a)).slice(0, days));

    let foreign = 0;
    let institution = 0;
    let individual = 0;
    for (const day of stock.days) {
      if (!recentDates.has(day.date)) continue;
      foreign += day.foreign;
      institution += day.institution;
      individual += day.individual;
    }

    const { other, otherRatio, unreliable } = computeOtherStats(foreign, institution, individual);

    return {
      ticker: stock.ticker,
      name: stock.name,
      sector: stock.sector,
      foreign,
      institution,
      individual,
      other,
      otherRatio,
      unreliable,
      tradingDays: recentDates.size,
    };
  });

  return result.sort((a, b) => {
    const diff = b.foreign + b.institution - (a.foreign + a.institution);
    if (diff !== 0) return diff;
    return a.ticker.localeCompare(b.ticker);
  });
}
