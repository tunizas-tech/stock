"use client";

// 섹터별 비중 막대(9단계). 포트폴리오 표 위 한 줄 — "내 돈이 어느 산업에 얼마나
// 들어가 있나"를 표를 읽기 전에 한눈에 보여준다. 비중은 KR 평가금액 기준이고(통화를
// 섞을 수 없다) US만 있는 묶음은 막대에 안 들어가며 범례에 "비중 없음"으로만 뜬다.
import type { SectorGroup } from "@/lib/portfolio/sector";
import { sectorColor } from "@/lib/portfolio/sector";
import { fmtMoney } from "@/lib/format";

export function SectorWeightBar({ groups }: { groups: SectorGroup[] }) {
  const weighted = groups.filter((g) => g.weightPct !== null && g.weightPct > 0);
  const unweighted = groups.filter((g) => g.weightPct === null);
  if (weighted.length === 0 && unweighted.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl2 border border-line bg-surface p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted">산업별 비중 (KR 평가금액 기준)</span>
        {weighted.length > 0 && (
          <span className="tabular text-xs text-muted">
            {fmtMoney(weighted.reduce((s, g) => s + (g.marketValue ?? 0), 0), "KRW")}
          </span>
        )}
      </div>

      {weighted.length > 0 && (
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-bg" role="img" aria-label="섹터별 비중 막대">
          {weighted.map((g) => (
            <div
              key={g.sector}
              title={`${g.sector} ${g.weightPct!.toFixed(1)}%`}
              style={{ width: `${g.weightPct}%`, backgroundColor: sectorColor(g.sector) }}
            />
          ))}
        </div>
      )}

      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {weighted.map((g) => (
          <li key={g.sector} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: sectorColor(g.sector) }} />
            <span className="text-ink">{g.sector}</span>
            <span className="tabular text-muted">{g.weightPct!.toFixed(1)}%</span>
          </li>
        ))}
        {unweighted.map((g) => (
          <li key={g.sector} className="flex items-center gap-1.5 text-muted">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: sectorColor(g.sector) }} />
            {g.sector} · {g.holdings.length}종목 (해외, 비중 없음)
          </li>
        ))}
      </ul>
    </div>
  );
}
