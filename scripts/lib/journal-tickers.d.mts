// journal-tickers.mjs의 타입 선언 — tsc는 .mjs를 직접 타입 추론하지 못하므로 여기 명시한다.
export declare function yesterdayOf(today: string): string;
export declare function journalTickersToFetch(
  tickers: string[],
  lastDates: Map<string, string | undefined>,
  today: string,
  /** 이미 다른 단계가 label·kind를 갖춰 적재 중인 코드 — 덮어쓰면 안 된다. */
  exclude?: Set<string>
): { ticker: string; from: string }[];
