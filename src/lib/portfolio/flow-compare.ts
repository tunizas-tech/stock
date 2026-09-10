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

/**
 * 한 산업에서 큰손(외국인+기관)이 나와 같은 편인가. 합계가 방향을, 연속일이 "지금 바뀌는
 * 중인가"를 정한다 — 합계만 보면 조선처럼 20일은 팔았지만 4일째 사는 중인 곳을 놓친다.
 */
export type FlowStance = "aligned" | "opposed" | "turning-in" | "turning-out" | "outside";

export function flowStance(row: SectorFlowCompareRow): FlowStance {
  if (row.total === null || row.persistence === null) return "outside";
  const streak = row.persistence.streak;
  if (row.total < 0) return streak >= STREAK_MIN_DAYS ? "turning-in" : "opposed";
  return streak <= -STREAK_MIN_DAYS ? "turning-out" : "aligned";
}

const STANCE_NAME: Record<FlowStance, string> = {
  aligned: "같은 방향",
  opposed: "반대 방향",
  "turning-in": "돌아서는 중",
  "turning-out": "빠져나가는 중",
  outside: "관측 밖",
};

export function stanceLabel(row: SectorFlowCompareRow): string {
  const stance = flowStance(row);
  if (stance === "outside" || row.persistence === null) return STANCE_NAME.outside;
  const p = row.persistence;
  const detail =
    p.streak >= STREAK_MIN_DAYS
      ? `${p.streak}일 연속 매수`
      : p.streak <= -STREAK_MIN_DAYS
        ? `${-p.streak}일 연속 매도`
        : `${p.tradingDays}일 중 ${p.buyDays}일 매수`;
  return `${STANCE_NAME[stance]} (${detail})`;
}

export interface FlowCompareSummary {
  /** 큰손이 20일 합계로 판 산업에 실린 내 비중 합(%). */
  sellingPct: number;
  buyingPct: number;
  turningIn: string[];
  turningOut: string[];
  /** 카드 맨 위 결론 한 줄. 관측 안 산업이 하나도 없으면 null. */
  headline: string | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function summarizeFlowCompare(rows: SectorFlowCompareRow[]): FlowCompareSummary {
  let sellingPct = 0;
  let buyingPct = 0;
  const turningIn: string[] = [];
  const turningOut: string[] = [];
  for (const r of rows) {
    const stance = flowStance(r);
    if (stance === "outside") continue;
    if (r.total! < 0) sellingPct += r.weightPct;
    else buyingPct += r.weightPct;
    if (stance === "turning-in") turningIn.push(r.sector);
    if (stance === "turning-out") turningOut.push(r.sector);
  }
  sellingPct = round1(sellingPct);
  buyingPct = round1(buyingPct);
  let headline: string | null = null;
  if (sellingPct + buyingPct > 0) {
    headline =
      sellingPct >= buyingPct
        ? `보유 ${Math.round(sellingPct)}%가 큰손이 파는 산업에 있음 — 반대 방향`
        : `보유 ${Math.round(buyingPct)}%가 큰손이 사는 산업에 있음 — 같은 방향`;
  }
  return { sellingPct, buyingPct, turningIn, turningOut, headline };
}
