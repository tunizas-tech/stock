// 대시보드 시장 지수 목록. code는 KIS 지수 코드(/api/candles의 code로 그대로 전달).

import type { Market } from "./types";

export interface IndexDef {
  code: string;
  market: Market;
  label: string;
}

export const INDICES: IndexDef[] = [
  { code: "0001", market: "KR", label: "코스피" },
  { code: "1001", market: "KR", label: "코스닥" },
  { code: "COMP", market: "US", label: "나스닥" },
  { code: "SPX", market: "US", label: "S&P 500" },
  { code: ".DJI", market: "US", label: "다우존스" },
];
