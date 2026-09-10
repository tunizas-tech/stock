// 보유 종목의 산업 분류. 체계는 관측소 ② 섹터별 자금 흐름과 같은 12섹터
// (FLOW_SECTORS)를 그대로 쓴다 — 포트폴리오에서 본 섹터와 관측소에서 본 섹터가
// 같은 말이어야 "내가 어느 산업에 얼마나 들어가 있나"를 두 화면에서 이어 읽을 수
// 있다. 유니버스에 없는 종목은 사용자가 직접 고르고(holding.sector), 안 고르면
// "기타"로 묶는다. AI 추론은 하지 않는다 — 틀린 자동 분류보다 빈 칸이 낫다.
import { FLOW_SECTORS, FLOW_UNIVERSE } from "@/lib/flow/universe";
import { quoteKey } from "@/lib/quotes";
import type { Holding, Quote } from "@/lib/types";

export const OTHER_SECTOR = "기타";

/** 드롭다운 선택지: 관측소 12섹터 + 기타(마지막). */
export const SECTOR_OPTIONS: readonly string[] = [...FLOW_SECTORS, OTHER_SECTOR];

const UNIVERSE_SECTOR = new Map(FLOW_UNIVERSE.map((s) => [s.ticker, s.sector]));

/** 유니버스에서 자동으로 찾은 섹터. 없으면 undefined (US 종목은 항상 undefined). */
export function universeSector(market: Holding["market"], ticker: string): string | undefined {
  if (market !== "KR") return undefined;
  return UNIVERSE_SECTOR.get(ticker);
}

/** 사용자 지정 > 유니버스 자동 > 기타. */
export function resolveSector(h: Holding): string {
  return h.sector || universeSector(h.market, h.ticker) || OTHER_SECTOR;
}

export interface SectorGroup {
  sector: string;
  holdings: Holding[];
  /** KR 종목 평가금액 합(원). US만 있는 묶음이면 null. */
  marketValue: number | null;
  /** KR 종목 손익 합(원). US만 있는 묶음이면 null. */
  pnl: number | null;
  /** KR 전체 평가금액 대비 %. KR 종목이 없으면 null. */
  weightPct: number | null;
}

/**
 * 섹터별로 묶어 평가금액·손익·비중을 낸다. 비중은 통화를 섞을 수 없어 KR 종목만
 * 계산한다(US는 표시만, 비중 없음). 정렬은 비중 큰 순, 비중 없는 묶음은 뒤로.
 */
export function groupBySector(holdings: Holding[], priceOf: (h: Holding) => number): SectorGroup[] {
  const map = new Map<string, Holding[]>();
  for (const h of holdings) {
    const s = resolveSector(h);
    const list = map.get(s);
    if (list) list.push(h);
    else map.set(s, [h]);
  }

  const krTotal = holdings
    .filter((h) => h.market === "KR")
    .reduce((sum, h) => sum + priceOf(h) * h.shares, 0);

  const groups: SectorGroup[] = [];
  for (const [sector, list] of map) {
    const kr = list.filter((h) => h.market === "KR");
    if (kr.length === 0) {
      groups.push({ sector, holdings: list, marketValue: null, pnl: null, weightPct: null });
      continue;
    }
    const marketValue = kr.reduce((sum, h) => sum + priceOf(h) * h.shares, 0);
    const cost = kr.reduce((sum, h) => sum + h.avgPrice * h.shares, 0);
    groups.push({
      sector,
      holdings: list,
      marketValue,
      pnl: marketValue - cost,
      weightPct: krTotal > 0 ? (marketValue / krTotal) * 100 : 0,
    });
  }

  groups.sort((a, b) => (b.weightPct ?? -1) - (a.weightPct ?? -1));
  return groups;
}

/** 시세 표에서 현재가를 꺼내는 priceOf. 시세가 없으면 평단가(포트폴리오 표와 같은 규칙). */
export function priceFromQuotes(quotes: Record<string, Quote>): (h: Holding) => number {
  return (h) => quotes[quoteKey(h.market, h.ticker)]?.price ?? h.avgPrice;
}

// 섹터별 고정 색 — 비중 막대·범례·관측소 표시가 같은 색을 써야 눈으로 이어진다.
// 색상환을 13등분해 이웃끼리 멀리 떨어뜨렸다(기타는 회색).
const SECTOR_HUES: Record<string, number> = {
  반도체: 215, 자동차: 20, 배터리: 145, 제약바이오: 340, 인터넷: 260, 금융: 45,
  조선: 190, 방산: 0, 소재: 95, 통신: 285, 에너지: 30, 소비재: 320,
};
export function sectorColor(sector: string): string {
  if (sector === OTHER_SECTOR) return "hsl(0 0% 62%)";
  const hue = SECTOR_HUES[sector];
  if (hue === undefined) return "hsl(0 0% 45%)";
  return `hsl(${hue} 55% 52%)`;
}
