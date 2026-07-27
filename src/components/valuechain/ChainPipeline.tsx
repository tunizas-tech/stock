// 밸류체인 파이프라인(디자인 §6.1). 단계 컬럼 + 사이 화살표, 반응형.
// 데스크톱: 가로 트랙(넘치면 overflow-x-auto 스크롤). 모바일: 세로 스택 + 화살표 90도.
// 순수 표현 컴포넌트 — 상호작용은 CSS hover뿐이라 서버 컴포넌트로 둔다.
import { Fragment } from "react";
import type { ChainStage } from "@/lib/types";
import { stageColor } from "@/lib/valuechain-theme";
import { StageIcon } from "./StageIcon";

export function ChainPipeline({ stages }: { stages: ChainStage[] }) {
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex flex-col gap-3 md:flex-row md:items-stretch md:gap-0">
        {stages.map((stage, i) => (
          <Fragment key={i}>
            {i > 0 && <Arrow />}
            <StageColumn stage={stage} index={i} />
          </Fragment>
        ))}
      </div>
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

function StageColumn({ stage, index }: { stage: ChainStage; index: number }) {
  const color = stageColor(index);
  return (
    <div className="flex min-w-[200px] flex-1 flex-col overflow-hidden rounded-xl2 border border-line bg-surface">
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
            <p className="mt-1 text-[11px] leading-relaxed text-muted">{node.role}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
