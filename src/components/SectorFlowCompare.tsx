"use client";

// 내 산업 vs 수급. 포트폴리오 비중 막대 아래 한 장 — "내 돈이 많이 실린 산업에서
// 외국인·기관이 빠지고 있나"를 보유 산업만 골라 보여준다. 숫자는 관측소 ②와 같은
// /api/observatory에서 오고(집계는 flow/aggregate.ts 한 곳), 창은 관측소 기본값과
// 같은 최근 20거래일이다. 수급 데이터가 없거나 API가 실패하면 카드를 그리지 않는다.
//
// 관측소와 같은 정직성 규칙: 이 숫자는 다음 수익률을 예측하지 못한다(5단계 검증에서
// 부호가 뒤집혔다). 그래서 캡션에 그 문장을 그대로 적는다.
import { useEffect, useState } from "react";
import { fmtEok, pnlClass } from "@/lib/format";
import type { FlowWindow, ObservatoryResponse } from "@/lib/observatory";
import { compareSectorFlow, persistenceLabel } from "@/lib/portfolio/flow-compare";
import { sectorColor, type SectorGroup } from "@/lib/portfolio/sector";

const WINDOW_DAYS = 20;

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

  return (
    <div className="mb-4 rounded-xl2 border border-line bg-surface p-4">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted">내 산업 vs 수급 (외국인+기관, 최근 {WINDOW_DAYS}거래일)</span>
        <a href="/observatory" className="text-xs text-muted hover:text-accent">관측소 ② →</a>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-muted">
        합계는 &ldquo;얼마나&rdquo;, 지속성은 &ldquo;꾸준히인가 하루인가&rdquo;를 말한다. 이 숫자는{" "}
        <strong className="text-ink">다음 수익률을 예측하지 못한다</strong> — 지금 무슨 일이 일어났는지를 보는 용도다.
      </p>
      <table className="tabular w-full whitespace-nowrap text-xs">
        <tbody>
          {rows.map((r) => (
            <tr key={r.sector} className="border-t border-line/40">
              <td className="py-1.5 pr-3">
                <span className="inline-flex items-center gap-1.5 text-ink">
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: sectorColor(r.sector) }} />
                  {r.sector}
                  {r.unreliable && (
                    <span
                      className="rounded border border-loss px-1 py-0.5 text-[10px] font-semibold text-loss"
                      title="기타법인(자사주 매입 등)이 흐름의 상당 부분이라 외국인·기관만으로 해석하면 안 된다"
                    >
                      unreliable
                    </span>
                  )}
                </span>
              </td>
              <td className="py-1.5 pr-3 text-right text-muted">비중 {r.weightPct.toFixed(1)}%</td>
              {r.total === null || r.persistence === null ? (
                <td className="py-1.5 text-right text-muted" colSpan={2}>관측 유니버스 밖 — 수급 없음</td>
              ) : (
                <>
                  <td className={`py-1.5 pr-3 text-right font-medium ${pnlClass(r.total)}`}>{fmtEok(r.total)}</td>
                  <td className={`py-1.5 text-right ${pnlClass(r.persistence.streak)}`}>
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
    </div>
  );
}
