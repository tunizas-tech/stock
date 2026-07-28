// 밸류체인 파이프라인(디자인 §6.1). 단계 컬럼 + 사이 화살표, 반응형.
// 데스크톱: 가로 트랙(넘치면 overflow-x-auto 스크롤). 모바일: 세로 스택 + 화살표 90도.
// 티커가 있는 노드는 마운트 후 /api/fundamentals에서 시총·PER·PBR을 받아 오른쪽에 붙인다
// (스크리너와 같은 방식). 티커가 없는 노드(비상장·개념)는 지표 없이 그대로 둔다.
"use client";

import { Fragment, useEffect, useState } from "react";
import type { ChainNode, ChainStage, Fundamentals } from "@/lib/types";
import { getFundamentals } from "@/lib/fundamentals";
import { quoteKey } from "@/lib/quotes";
import { fmtMarketCap, fmtRatio } from "@/lib/format";
import { stageColor } from "@/lib/valuechain-theme";
import { StageIcon } from "./StageIcon";

/** 모든 단계를 훑어 티커가 있는 노드만 모은다. */
function tickerNodes(stages: ChainStage[]): ChainNode[] {
  return stages.flatMap((s) => s.nodes).filter((n) => n.ticker !== undefined);
}

export function ChainPipeline({ stages }: { stages: ChainStage[] }) {
  const [fundamentals, setFundamentals] = useState<Record<
    string,
    Fundamentals
  > | null>(null);

  useEffect(() => {
    const nodes = tickerNodes(stages);
    if (nodes.length === 0) return;
    let alive = true;
    getFundamentals(
      nodes.map((n) => ({ ticker: n.ticker!, market: "KR" as const, name: n.name }))
    ).then((f) => {
      if (alive) setFundamentals(f);
    });
    return () => {
      alive = false;
    };
  }, [stages]);

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex flex-col gap-3 md:flex-row md:items-stretch md:gap-0">
        {stages.map((stage, i) => (
          <Fragment key={i}>
            {i > 0 && <Arrow />}
            <StageColumn stage={stage} index={i} fundamentals={fundamentals} />
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/** 종목명 오른편 지표 열 — 시총 / PER / PBR. 로딩 중에는 자리만 잡아 둔다. */
function NodeMetrics({ node, data }: { node: ChainNode; data: Fundamentals | undefined }) {
  if (node.ticker === undefined) return null;
  return (
    <div className="tabular shrink-0 text-right text-[10px] leading-tight text-muted">
      {data ? (
        <>
          {data.isMock && (
            <div
              className="mb-0.5 rounded border border-loss px-1 py-px text-[9px] font-bold text-loss"
              title="실시세 조회에 실패해 샘플 숫자를 보여주고 있습니다"
            >
              샘플
            </div>
          )}
          <div className={data.isMock ? "font-semibold" : "font-semibold text-ink"}>
            {fmtMarketCap(data.marketCap, "KR")}
          </div>
          <div>PER {fmtRatio(data.per)}</div>
          <div>PBR {fmtRatio(data.pbr)}</div>
        </>
      ) : (
        <div className="text-muted">···</div>
      )}
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex shrink-0 rotate-90 items-center justify-center py-1 text-muted md:w-10 md:rotate-0 md:py-0">
      <svg viewBox="0 0 46 34" className="h-5 w-8" aria-hidden="true">
        <path
          d="M2 17 H36"
          stroke="currentColor"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M32 9 L42 17 L32 25"
          stroke="currentColor"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function StageColumn({
  stage,
  index,
  fundamentals,
}: {
  stage: ChainStage;
  index: number;
  fundamentals: Record<string, Fundamentals> | null;
}) {
  const color = stageColor(index);
  return (
    <div className="flex min-w-[240px] flex-1 flex-col overflow-hidden rounded-xl2 border border-line bg-surface">
      {/* 헤더 */}
      <div className="border-b border-line p-3" style={{ borderTop: `3px solid ${color}` }}>
        <div className="mb-2 flex items-center justify-between gap-2">
          {stage.badge && (
            <span
              className="tabular rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white"
              style={{ backgroundColor: color }}
            >
              {stage.badge}
            </span>
          )}
          <StageIcon icon={stage.icon} index={index} color={color} />
        </div>
        <div className="font-serif text-base font-semibold" style={{ color }}>
          {stage.label}
        </div>
        {stage.en && (
          <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted">
            {stage.en}
          </div>
        )}
        {stage.desc && (
          <p className="mt-2 text-[11px] leading-relaxed text-muted">{stage.desc}</p>
        )}
      </div>

      {/* 종목 카드 */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        {stage.nodes.map((node, j) => (
          <div
            key={j}
            className={`rounded-lg border bg-bg p-2.5 transition-transform hover:-translate-y-0.5 ${
              node.anchor ? "border-accent bg-accent/5" : "border-line"
            }`}
            style={
              node.anchor
                ? { borderLeftWidth: 3, borderLeftColor: "var(--accent)" }
                : { borderLeftWidth: 3, borderLeftColor: color }
            }
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-sm font-medium ${
                      node.anchor ? "text-accent" : "text-ink"
                    }`}
                  >
                    {node.name}
                  </span>
                  {node.tag && (
                    <span className="tabular rounded bg-accent px-1.5 py-0.5 text-[9px] font-bold text-white">
                      {node.tag}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  {node.role}
                </p>
              </div>
              <NodeMetrics
                node={node}
                data={
                  node.ticker && fundamentals
                    ? fundamentals[quoteKey("KR", node.ticker)]
                    : undefined
                }
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
