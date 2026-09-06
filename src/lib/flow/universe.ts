// 일일 수급(투자자별 순매수) 관측 대상 유니버스.
//
// 왜 개별 종목이고 ETF가 아닌가: 2026-09-06 실호출로 확인한 결과 ETF 수급은
// 규모가 개별 종목보다 몇 자릿수 작다(헬스케어 ETF 외국인 순매수 13 vs
// 삼성전자 28,616 — 같은 날, 같은 단위). 신호로 쓰기엔 너무 얇아서
// 이 관측 대상은 개별 종목 30개로 구성한다.
//
// 아래 30종목은 2026-09-06 KIS API에 하나씩 조회해 종목명이 정확히 일치함을
// 확인했다(30/30, us-kr-transfer/indicator-backtest/sector-rotation 3단계와
// 같은 날 진행한 라이브 프로브). 섹터 라벨은 태스크 스펙에 명시된 값 그대로다.
//
// src/lib/universe.ts(스크리너 기본 유니버스)와는 별개다 — 그쪽은 스크리너용,
// 이쪽은 수급 관측용이라 서로 건드리지 않는다.

export interface FlowStock {
  ticker: string;
  name: string;
  sector: string;
}

export const FLOW_UNIVERSE: FlowStock[] = [
  // 반도체
  { ticker: "005930", name: "삼성전자", sector: "반도체" },
  { ticker: "000660", name: "SK하이닉스", sector: "반도체" },
  { ticker: "042700", name: "한미반도체", sector: "반도체" },
  // 자동차
  { ticker: "005380", name: "현대차", sector: "자동차" },
  { ticker: "000270", name: "기아", sector: "자동차" },
  { ticker: "012330", name: "현대모비스", sector: "자동차" },
  // 배터리
  { ticker: "373220", name: "LG에너지솔루션", sector: "배터리" },
  { ticker: "006400", name: "삼성SDI", sector: "배터리" },
  { ticker: "096770", name: "SK이노베이션", sector: "배터리" },
  // 제약바이오
  { ticker: "207940", name: "삼성바이오로직스", sector: "제약바이오" },
  { ticker: "068270", name: "셀트리온", sector: "제약바이오" },
  { ticker: "128940", name: "한미약품", sector: "제약바이오" },
  // 인터넷
  { ticker: "035420", name: "NAVER", sector: "인터넷" },
  { ticker: "035720", name: "카카오", sector: "인터넷" },
  // 금융
  { ticker: "105560", name: "KB금융", sector: "금융" },
  { ticker: "055550", name: "신한지주", sector: "금융" },
  { ticker: "086790", name: "하나금융지주", sector: "금융" },
  // 조선
  { ticker: "009540", name: "HD한국조선해양", sector: "조선" },
  { ticker: "042660", name: "한화오션", sector: "조선" },
  { ticker: "010140", name: "삼성중공업", sector: "조선" },
  // 방산
  { ticker: "012450", name: "한화에어로스페이스", sector: "방산" },
  { ticker: "047810", name: "한국항공우주", sector: "방산" },
  { ticker: "064350", name: "현대로템", sector: "방산" },
  // 소재
  { ticker: "005490", name: "POSCO홀딩스", sector: "소재" },
  { ticker: "051910", name: "LG화학", sector: "소재" },
  // 통신
  { ticker: "017670", name: "SK텔레콤", sector: "통신" },
  { ticker: "030200", name: "KT", sector: "통신" },
  // 에너지
  { ticker: "015760", name: "한국전력", sector: "에너지" },
  // 소비재
  { ticker: "051900", name: "LG생활건강", sector: "소비재" },
  { ticker: "097950", name: "CJ제일제당", sector: "소비재" },
];

// 정렬된 고유 섹터 목록.
export const FLOW_SECTORS: string[] = [...new Set(FLOW_UNIVERSE.map((s) => s.sector))].sort();
