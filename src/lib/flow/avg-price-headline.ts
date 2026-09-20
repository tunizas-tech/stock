// 수급평단 결론 문장. 새 지표 화면은 표보다 계산된 결론 한 줄이 먼저다(내 산업 vs 큰손
// 카드에서 배운 것). 문구는 여기 한 곳에만 두고 컴포넌트는 그리기만 한다.
import type { AvgPriceReason, FlowActor, SupplyAvgPrice } from "./avg-price";

export const ACTOR_LABEL: Record<FlowActor, string> = { foreign: "외국인", institution: "기관", individual: "개인" };

export const REASON_LABEL: Record<AvgPriceReason, string> = {
  "zero-qty": "매매 없음",
  "sign-mismatch": "매매가 엇갈림",
  "corp-action": "주가 급변",
};

/** 내 평단과 "같다"고 볼 폭. 이 안이면 비싸게/싸게 대신 "비슷한 값에". */
const SIMILAR_PCT = 0.5;

/** 부호 있는 소수 1자리. fmtPct(2자리)보다 짧게 — 문장 안에 들어가므로. */
function pct1(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(1)}%`;
}

function abs1(v: number): string {
  return `${Math.abs(v).toFixed(1)}%`;
}

export function actorSentence(a: SupplyAvgPrice, myAvgPrice: number): string {
  const who = ACTOR_LABEL[a.actor];
  if (a.avgPrice === null || a.returnPct === null || a.side === null) {
    switch (a.reason) {
      case "zero-qty":
        return `${who}은 ${a.window}일 매매 없음`;
      case "corp-action":
        return `${who}은 창 안 주가 급변으로 평단 없음`;
      default:
        return `${who}은 ${a.window}일 매매가 엇갈려 평단 없음`;
    }
  }
  if (a.side === "sell") {
    const dir = a.returnPct < 0 ? "아래" : "위";
    return `${who}은 평균 ${a.avgPrice.toLocaleString("ko-KR")}원에 팔았고 종가는 그보다 ${abs1(a.returnPct)} ${dir}`;
  }
  const diffPct = myAvgPrice > 0 ? ((a.avgPrice - myAvgPrice) / myAvgPrice) * 100 : 0;
  const bought =
    Math.abs(diffPct) < SIMILAR_PCT
      ? "나와 비슷한 값에 샀고"
      : diffPct > 0
        ? `나보다 ${abs1(diffPct)} 비싸게 샀고`
        : `나보다 ${abs1(diffPct)} 싸게 샀고`;
  const now =
    a.returnPct > 0 ? `지금 ${pct1(a.returnPct)} 이익 중` : a.returnPct < 0 ? `지금 ${pct1(a.returnPct)} 물려 있음` : "지금 평단과 같음";
  return `${who}은 ${bought} ${now}`;
}

export function avgPriceHeadline(
  view: { actors: Pick<Record<FlowActor, SupplyAvgPrice>, "foreign" | "institution"> },
  myAvgPrice: number,
): string {
  const { foreign, institution } = view.actors;
  if (foreign.avgPrice === null && institution.avgPrice === null) {
    const reasons = [...new Set([foreign.reason, institution.reason].filter((r): r is AvgPriceReason => !!r))]
      .map((r) => REASON_LABEL[r])
      .join("·");
    return `외국인·기관 모두 ${foreign.window}일 평단 없음 (${reasons})`;
  }
  return `${actorSentence(foreign, myAvgPrice)} · ${actorSentence(institution, myAvgPrice)}`;
}
