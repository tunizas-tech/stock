// 도메인 타입 단일 출처. 모든 레이어(페이지·데이터·시세·DB 스키마)가 이 타입을 공유한다.
// db/*.sql의 컬럼명도 이 타입과 일치(camelCase 컬럼은 따옴표).

export type Market = "KR" | "US";

// "skip"(검토는 했지만 사지 않음) — 6단계 자기검증 설계 N3: 안 산 거래가
// 없으면 "이 사람의 판단력 자체"를 잴 표본이 없다. skip에도 스냅샷을 붙여
// "봤는데 안 산 것"과 "산 것"을 같은 기준으로 비교한다.
export type JournalAction = "buy" | "sell" | "note" | "skip";

/**
 * 당시 확신도 1(낮음) ~ 5(높음). 필드명은 기존 데이터·Supabase 스키마 호환을
 * 위해 그대로 두지만(6단계 설계 §1), UI는 이제 이 값을 "이 거래가 수익으로
 * 끝날 확률"로 정의한다(설계 문서 I1 — 정의 없는 확신도는 보정 곡선을 못 그린다):
 * 1=50% · 2=60% · 3=70% · 4=80% · 5=90%. 선언한 확률과 실제 승률의 차이가
 * 자기검증 리뷰(§4)의 "보정 오차"다.
 */
export type Emotion = 1 | 2 | 3 | 4 | 5;

/**
 * 매매 이유 태그(6단계 설계 §1, 7종 고정). 국문 그대로 저장·표시한다 —
 * 자유 텍스트가 아니라 닫힌 집합이어야 묶음별 집계(주 이유별)가 가능하다.
 */
export type ReasonTag =
  | "수급" | "지표" | "섹터강세" | "미국장" | "뉴스" | "밸류체인" | "직관"
  // 7단계: 에이전트가 남긴 관망의 주 이유이자, 사용자가 에이전트 후보를 실제로 샀을 때 찍는 주 이유.
  | "에이전트";

/**
 * 매매 순간의 관측소 상태를 서버가 계산해 붙이는 스냅샷(6단계 설계 §1·§2).
 * best-effort다 — 계산에 실패해도 저널 저장 자체는 막지 않는다(`coverage`로
 * 실패 정도만 남긴다).
 */
export interface JournalSnapshot {
  /**
   * 기준 거래일 — 매매일 "이전"의 마지막 거래일. **절대 매매일 당일이 아니다.**
   * 적대적 리뷰 C1: 그날 마감 수급·시세가 스냅샷에 섞이면 아직 일어나지 않은
   * 결과를 이미 알고 "그래서 샀다"는 서사를 만들 수 있다(look-ahead) —
   * 1~5단계에서 하루 종일 막았던 바로 그 함정이라 이름을 따로 붙여 지킨다.
   */
  asOf: string;
  /**
   * 스냅샷이 얼마나 채워졌는지. "full"/"partial"/"none"을 구분하지 못하면
   * "수급 0"(정말 수급이 없었다)과 "수급 데이터 없음"(계산 실패·유니버스 밖)이
   * 섞여 분석이 오염된다 — 5단계 개인 열에서 이미 겪은 문제(설계 §1 "스냅샷은
   * best-effort" 절 참고).
   */
  coverage: "full" | "partial" | "none";
  /** FLOW_UNIVERSE 매핑으로 찾은 섹터. 매핑이 없으면 생략(coverage: "none"). */
  sector?: string;
  /**
   * 섹터 20거래일 수급 합계 — 반드시 `asOf`까지의 데이터로만 계산한다
   * (aggregate.ts의 `until` 인자로 강제). unreliable/tradingDays를 그대로
   * 실어 "3주체만으로 믿어도 되는 수치인가"를 스냅샷에도 남긴다.
   */
  sectorFlow20?: { foreign: number; institution: number; other: number; unreliable: boolean; tradingDays: number };
  /** 섹터→로테이션 ETF 매핑이 있을 때만 계산되는 `asOf` 기준 250일 상대강도 순위. */
  sectorRsRank?: { rank: number; of: number };
  /** 종목 RSI(14). 가격 데이터(30종목 flow 또는 candles)가 있을 때만. */
  rsi14?: number;
  /** `asOf` 일의 코스피 갭. */
  kospiGap?: number;
  /** `asOf` 일의 코스피 장중 등락. */
  kospiIntraday?: number;
  /** `asOf` 전 거래일의 나스닥 등락. */
  nasdaqPrevChange?: number;
}

export interface Holding {
  id: string;
  market: Market;
  ticker: string;
  name: string;
  shares: number;
  avgPrice: number;
  openedAt: string; // YYYY-MM-DD
  /** 사용자가 고른 산업(관측소 12섹터 또는 "기타"). 비우면 유니버스에서 자동 판정. */
  sector?: string;
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

  // 아래 셋은 6단계 자기검증 설계(§1)에서 추가한 선택 필드다. 기존 기록은
  // 전부 undefined로 남고, 분석에서는 "태그 없음"/"스냅샷 없음" 그룹으로
  // 잡힌다 — 마이그레이션이나 기존 데이터 백필이 필요 없다.
  /**
   * 주 이유 하나. 매수·skip에서는 UI가 입력을 강제한다(설계 문서 I2 — 태그를
   * 다 찍게 허용하면 "이 이유로 산 거래가 나았나"를 물을 수 없어진다).
   */
  primaryTag?: ReasonTag;
  /** 보조 이유(복수 가능). 분석은 항상 `primaryTag` 기준으로 한다. */
  tags?: ReasonTag[];
  /** 저장 시 서버가 붙이는 시점 스냅샷. 계산 실패해도 저널 저장은 막지 않는다. */
  snapshot?: JournalSnapshot;
  /**
   * 이 기록을 실제로 남긴 시각(ISO 8601). `date`(거래일)와 다르다 — 어제 산 것을
   * 오늘 적으면 date는 어제, createdAt은 오늘이다.
   *
   * 자기검증 봉인(설계 §4 N2)의 기준일이 바로 이 값이다: "기록을 남긴 뒤 180일".
   * date를 기준으로 하면 2년 전 날짜로 기록 하나만 백필해도 봉인이 즉시 열려
   * 봉인의 목적 자체가 사라진다. 이 필드가 생기기 전의 옛 기록은 undefined로
   * 남고, 그 경우 봉인은 "아직 시작 안 함"으로 다룬다(settings.ts sealBaseDate).
   */
  createdAt?: string;
  /**
   * 누가 썼나(7단계). 서버가 채운다 — 사람 문은 "user", 에이전트 문은 "agent".
   * 옛 기록·localStorage 기록은 undefined(=user로 취급). 자기검증은 관망 절을
   * 이 값으로 나누고, 봉인 기준일 계산에서 "agent"를 제외한다.
   */
  author?: "user" | "agent";
  /**
   * 12개 섹터 중 하나(FLOW_SECTORS). 에이전트 기록에만 있고 스냅샷 계산에 쓴다 —
   * 수급 유니버스 30종목 밖의 종목은 이 값이 없으면 섹터를 알 수 없어 스냅샷이
   * 통째로 "none"이 된다. 사람 폼에는 노출하지 않는다.
   */
  sector?: string;
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
  isMock?: boolean; // 실데이터 조회 실패로 샘플값을 쓴 경우 true (화면에 표시해 오인을 막는다)
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
  volume?: number; // 거래량 — 소스가 주지 않으면 undefined
  value?: number; // 거래대금 — 국내만 제공
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
  status: "draft" | "published"; // 초안은 목록에서 "초안" 그룹으로 분리 표시
  anchor?: string; // 대표 종목명
  updatedAt: string; // YYYY-MM-DD
  flows?: { forward: string; reverse: string };
  stages: ChainStage[];
  thesis?: string;
  disclaimer?: string;
  sources: { label: string; url: string }[]; // 정확도 규약상 2개 이상
}

// ---------------------------------------------------------------------------
// 뉴스 키워드 대시보드(/news) — 전용 PostgreSQL. 기존 db 파사드/Supabase와 무관.
// ---------------------------------------------------------------------------

export interface NewsKeyword {
  id: number;
  keyword: string;
  sortOrder: number;
  active: boolean;
  createdAt: string; // ISO
}

export interface NewsItem {
  id: number;
  keywordId: number;
  title: string;
  link: string; // 네이버 link (키워드 내 중복제거 키)
  originalLink: string | null; // 언론사 원문
  description: string | null;
  source: string | null; // 언론사/호스트 (best-effort)
  pubDate: string | null; // ISO
  fetchedAt: string; // ISO
}

/** 네이버 API 응답을 정규화한, DB 저장 직전 형태(id/fetchedAt 없음). */
export interface RawNewsItem {
  title: string;
  link: string;
  originalLink: string | null;
  description: string | null;
  source: string | null;
  pubDate: string | null; // ISO
}

export interface NewsFeedGroup {
  keyword: NewsKeyword;
  items: NewsItem[];
}
