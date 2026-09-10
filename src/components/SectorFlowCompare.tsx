"use client";

// 내 산업 vs 큰손. 포트폴리오 비중 막대 아래 한 장 — "내 돈이 많이 실린 산업에서
// 외국인·기관은 나와 같은 편인가"를 결론 한 줄 → 산업별 상태 → (펼치면) 억 단위 숫자
// 순서로 보여준다. 판단(같은 방향/반대 방향/돌아서는 중)은 flow-compare.ts의 순수 함수가
// 하고 여기서는 그리기만 한다. 숫자는 관측소 ②와 같은 /api/observatory, 창은 20거래일.
//
// 관측소와 같은 정직성 규칙: 이 숫자는 다음 수익률을 예측하지 못한다(5단계 검증에서
// 부호가 뒤집혔다). 그래서 캡션에 그 문장을 그대로 적는다.
import { useEffect, useState } from "react";
import { fmtEok, pnlClass } from "@/lib/format";
import type { FlowWindow, ObservatoryResponse } from "@/lib/observatory";
import {
  compareSectorFlow,
  flowStance,
  persistenceLabel,
  stanceLabel,
  summarizeFlowCompare,
  type FlowStance,
} from "@/lib/portfolio/flow-compare";
import { sectorColor, type SectorGroup } from "@/lib/portfolio/sector";

const WINDOW_DAYS = 20;

// 상태별 점 색. 초록=같은 편, 빨강=반대편, 노랑=바뀌는 중, 회색=모름.
const STANCE_DOT: Record<FlowStance, string> = {
  aligned: "bg-gain",
  opposed: "bg-loss",
  "turning-in": "bg-amber-400",
  "turning-out": "bg-amber-400",
  outside: "bg-line",
};

export function SectorFlowCompare({ groups }: { groups: SectorGroup[] }) {
  const [window, setWindow] = useState<FlowWindow | undefined>(undefined);
  useEffect(() => {
    fetch("/api/observatory")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("조회 실패"))))
      .then((body: ObservatoryResponse) => setWindow(body.flow?.windows.find((w) => w.days === WINDOW_DAYS)))
      .catch(() => setWindow(undefined));
  }, []);

  const rows = compareSectorFlow(groups, window);
  if (rows.length === 0) return null;
  const summary = summarizeFlowCompare(rows);
  const maxWeight = Math.max(...rows.map((r) => r.weightPct), 1);

  return (
    <div className="mb-4 rounded-xl2 border border-line bg-surface p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted">내 산업 vs 큰손 (외국인+기관, 최근 {WINDOW_DAYS}거래일)</span>
        <a href="/observatory" className="text-xs text-muted hover:text-accent">관측소 ② →</a>
      </div>

      {summary.headline && (
        <div className="mb-3 rounded-lg bg-bg px-3 py-2 text-sm">
          <p className="font-medium text-ink">▶ {summary.headline}</p>
          {(summary.turningIn.length > 0 || summary.turningOut.length > 0) && (
            <p className="mt-0.5 text-xs text-muted">
              {summary.turningIn.length > 0 && <>최근 사는 쪽으로 돌아선 곳: {summary.turningIn.join(", ")}</>}
              {summary.turningIn.length > 0 && summary.turningOut.length > 0 && " · "}
              {summary.turningOut.length > 0 && <>최근 파는 쪽으로 돌아선 곳: {summary.turningOut.join(", ")}</>}
            </p>
          )}
        </div>
      )}

      <ul className="space-y-1.5 text-xs">
        {rows.map((r) => {
          const stance = flowStance(r);
          return (
            <li key={r.sector} className="flex items-center gap-3">
              <span className="inline-flex w-20 shrink-0 items-center gap-1.5 text-ink">
                <span className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: sectorColor(r.sector) }} />
                <span className="truncate">{r.sector}</span>
              </span>
              <span className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-bg" role="img" aria-label={`비중 ${r.weightPct.toFixed(1)}%`}>
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${(r.weightPct / maxWeight) * 100}%`, backgroundColor: sectorColor(r.sector) }}
                />
              </span>
              <span className="tabular w-10 shrink-0 text-right text-muted">{r.weightPct.toFixed(0)}%</span>
              <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${STANCE_DOT[stance]}`} />
              <span className={stance === "outside" ? "text-muted" : "text-ink"}>{stanceLabel(r)}</span>
              {r.unreliable && (
                <span
                  className="rounded border border-loss px-1 py-0.5 text-[10px] font-semibold text-loss"
                  title="기타법인(자사주 매입 등)이 흐름의 상당 부분이라 외국인·기관만으로 해석하면 안 된다"
                >
                  unreliable
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted hover:text-accent">자세히 (억 단위 합계)</summary>
        <table className="tabular mt-2 w-full whitespace-nowrap">
          <tbody>
            {rows.map((r) => (
              <tr key={r.sector} className="border-t border-line/40">
                <td className="py-1 pr-3 text-ink">{r.sector}</td>
                <td className="py-1 pr-3 text-right text-muted">비중 {r.weightPct.toFixed(1)}%</td>
                {r.total === null || r.persistence === null ? (
                  <td className="py-1 text-right text-muted" colSpan={2}>관측 유니버스 밖 — 수급 없음</td>
                ) : (
                  <>
                    <td className={`py-1 pr-3 text-right font-medium ${pnlClass(r.total)}`}>{fmtEok(r.total)}</td>
                    <td className={`py-1 text-right ${pnlClass(r.persistence.streak)}`}>
                      {persistenceLabel(r.persistence)}
                      {r.persistence.tradingDays < WINDOW_DAYS && (
                        <span className="text-muted"> ({r.persistence.tradingDays}일치)</span>
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        &ldquo;큰손이 판다&rdquo;는 20일 합계, &ldquo;돌아서는 중&rdquo;은 최근 연속일이다. 이 숫자는{" "}
        <strong className="text-ink">다음 수익률을 예측하지 못한다</strong> — 내가 시장의 큰돈과 같은 편인지 반대편인지를 아는 용도다.
      </p>
    </div>
  );
}
