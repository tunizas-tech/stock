// "내 비중이 큰 산업에서 돈이 빠지고 있나" — 포트폴리오의 산업별 비중(groupBySector)과
// 관측소 ②의 섹터 수급(FlowWindow)을 산업 이름으로 이어 붙이는 순수 함수. 두 화면이
// 같은 12섹터를 쓰기 때문에 이름 매칭만으로 충분하다. IO는 없다 — 컴포넌트가
// /api/observatory 응답과 보유 묶음을 들고 와 여기 넘긴다.
import type { FlowPersistence } from "@/lib/flow/aggregate";
import type { FlowWindow } from "@/lib/observatory";
import type { SectorGroup } from "./sector";

/** "N일 연속"이라고 부르기 시작하는 최소 일수. 그 아래는 비율로만 말한다. */
export const STREAK_MIN_DAYS = 3;

export interface SectorFlowCompareRow {
  sector: string;
  weightPct: number;
  /** 외국인+기관 순매수 합계(백만원). 수급 유니버스에 없는 산업이면 null. */
  total: number | null;
  unreliable: boolean;
  persistence: FlowPersistence | null;
}

export function persistenceLabel(p: FlowPersistence): string {
  if (p.streak >= STREAK_MIN_DAYS) return `▲ ${p.streak}일 연속 순매수`;
  if (p.streak <= -STREAK_MIN_DAYS) return `▼ ${-p.streak}일 연속 순매도`;
  return `순매수 ${p.buyDays}/${p.tradingDays}일`;
}

/**
 * KR 비중이 있는 묶음만(해외 전용 묶음은 비중이 없어 비교할 축이 없다), groupBySector가
 * 준 순서(비중 큰 순) 그대로. 창이 없으면 빈 배열 — 카드를 아예 그리지 않게 한다.
 */
export function compareSectorFlow(groups: SectorGroup[], window: FlowWindow | undefined): SectorFlowCompareRow[] {
  if (!window) return [];
  return groups
    .filter((g): g is SectorGroup & { weightPct: number } => g.weightPct !== null)
    .map((g) => {
      const total = window.sectors.find((s) => s.sector === g.sector);
      return {
        sector: g.sector,
        weightPct: g.weightPct,
        total: total ? total.foreign + total.institution : null,
        unreliable: total?.unreliable ?? false,
        persistence: window.persistenceBySector[g.sector] ?? null,
      };
    });
}
