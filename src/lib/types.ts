// 도메인 타입 단일 출처. 모든 레이어(페이지·데이터·시세·DB 스키마)가 이 타입을 공유한다.
// Supabase 스키마(supabase/schema.sql)의 컬럼명도 이 타입과 일치(camelCase 컬럼은 따옴표).

export type Market = "KR" | "US";

export type JournalAction = "buy" | "sell" | "note";

/** 당시 확신도 1(낮음) ~ 5(높음) */
export type Emotion = 1 | 2 | 3 | 4 | 5;

export interface Holding {
  id: string;
  market: Market;
  ticker: string;
  name: string;
  shares: number;
  avgPrice: number;
  openedAt: string; // YYYY-MM-DD
}

export interface WatchItem {
  id: string;
  market: Market;
  ticker: string;
  name: string;
  memo: string;
  addedAt: string; // YYYY-MM-DD
}

export interface JournalEntry {
  id: string;
  date: string; // YYYY-MM-DD
  market: Market;
  ticker: string;
  name: string;
  action: JournalAction;
  price?: number; // 선택
  qty?: number; // 선택
  reason: string;
  emotion: Emotion;
  lesson: string; // 복기 — 나중에 채움
}

/**
 * 스크리너용 펀더멘털 지표(PRD §6.3). 소스가 주지 않는 지표는 undefined —
 * 조건이 설정된 지표가 결측인 종목은 필터에서 제외된다.
 * marketCap 단위: KR은 억 원, US는 백만 달러 (각 시장의 관용 단위).
 */
export interface Fundamentals {
  ticker: string;
  market: Market;
  name: string;
  marketCap?: number;
  per?: number;
  pbr?: number;
  dividendYield?: number; // %
  revenueGrowth?: number; // % (YoY)
  off52wHigh?: number; // 52주 고가 대비 % (보통 음수)
}

/** 차트 주기 — 일봉/주봉/월봉. */
export type Period = "D" | "W" | "M";

/** 기간별 시세 캔들. 날짜 오름차순으로 다룬다. */
export interface Candle {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Quote {
  ticker: string;
  market: Market;
  price: number;
  change: number; // 전일 대비 절대값
  changePct: number; // 전일 대비 %
  currency: "KRW" | "USD";
}

// ---------------------------------------------------------------------------
// 밸류체인(산업 종목 정리) — 정적 데이터 전용. db 파사드/Supabase와 무관.
// ---------------------------------------------------------------------------

export type IconKey =
  | "factory"
  | "solar"
  | "wind"
  | "server"
  | "chip"
  | "battery"
  | "grid"
  | "generic";

export interface ChainNode {
  name: string; // 종목명
  role: string; // 역할 한 줄
  ticker?: string;
  anchor?: boolean; // 대표 종목 강조
  tag?: string; // 앵커 배지 텍스트 (예: "ANCHOR")
}

export interface ChainStage {
  label: string; // 단계명 (예: "① 상류")
  en?: string; // 부제 (예: "소재 · 제조장비")
  badge?: string; // 상단 배지 (예: "UPSTREAM")
  desc?: string; // 단계 설명
  icon?: IconKey; // 생략 시 번호 배지
  nodes: ChainNode[];
}

export interface ValueChain {
  slug: string;
  title: string;
  summary: string;
  anchor?: string; // 대표 종목명
  updatedAt: string; // YYYY-MM-DD
  flows?: { forward: string; reverse: string };
  stages: ChainStage[];
  thesis?: string;
  disclaimer?: string;
  sources?: { label: string; url: string }[];
}
