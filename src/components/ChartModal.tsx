"use client";

// 종목 차트 모달 — 포트폴리오·관심 종목 클릭 시 일/주/월봉을 보여준다.

import { CandlePanel } from "./CandlePanel";
import { MarketBadge } from "./MarketBadge";
import type { Market } from "@/lib/types";

export function ChartModal({
  market,
  ticker,
  name,
  onClose,
}: {
  market: Market;
  ticker: string;
  name: string;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-xl2 border border-line bg-surface p-5 shadow-lg"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <MarketBadge market={market} />
            <span className="tabular font-medium text-ink">{ticker}</span>
          </div>
          <button
            onClick={onClose}
            aria-label="차트 닫기"
            className="rounded-md px-2 py-1 text-sm text-muted hover:text-ink"
          >
            ✕
          </button>
        </div>
        <CandlePanel kind="stock" market={market} code={ticker} title={name} />
      </div>
    </div>
  );
}
