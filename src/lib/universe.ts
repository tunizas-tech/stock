// 스크리너 기본 유니버스 — 무료 API는 전종목 스캔이 불가하므로(호출 유량),
// 내장 대표 종목 + 보유 + 관심 종목을 대상으로 거른다(스크리너 페이지에서 병합).

import type { Market } from "./types";

export interface UniverseItem {
  ticker: string;
  market: Market;
  name: string;
}

export const DEFAULT_UNIVERSE: UniverseItem[] = [
  // 한국 — 시총 상위 대표
  { ticker: "005930", market: "KR", name: "삼성전자" },
  { ticker: "000660", market: "KR", name: "SK하이닉스" },
  { ticker: "373220", market: "KR", name: "LG에너지솔루션" },
  { ticker: "207940", market: "KR", name: "삼성바이오로직스" },
  { ticker: "005380", market: "KR", name: "현대차" },
  { ticker: "000270", market: "KR", name: "기아" },
  { ticker: "068270", market: "KR", name: "셀트리온" },
  { ticker: "035420", market: "KR", name: "NAVER" },
  { ticker: "035720", market: "KR", name: "카카오" },
  { ticker: "051910", market: "KR", name: "LG화학" },
  { ticker: "105560", market: "KR", name: "KB금융" },
  { ticker: "005490", market: "KR", name: "POSCO홀딩스" },
  // 미국 — 대형주 대표
  { ticker: "AAPL", market: "US", name: "Apple" },
  { ticker: "MSFT", market: "US", name: "Microsoft" },
  { ticker: "NVDA", market: "US", name: "NVIDIA" },
  { ticker: "GOOGL", market: "US", name: "Alphabet" },
  { ticker: "AMZN", market: "US", name: "Amazon" },
  { ticker: "META", market: "US", name: "Meta" },
  { ticker: "TSLA", market: "US", name: "Tesla" },
  { ticker: "JPM", market: "US", name: "JPMorgan Chase" },
  { ticker: "JNJ", market: "US", name: "Johnson & Johnson" },
  { ticker: "V", market: "US", name: "Visa" },
  { ticker: "KO", market: "US", name: "Coca-Cola" },
  { ticker: "XOM", market: "US", name: "Exxon Mobil" },
];
