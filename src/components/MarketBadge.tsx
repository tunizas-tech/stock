// 시장 구분 칩(디자인 §3). KR=잉크 / US=테라코타.
import type { Market } from "@/lib/types";

export function MarketBadge({ market }: { market: Market }) {
  const isKR = market === "KR";
  return (
    <span
      className={`tabular inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium ${
        isKR
          ? "border-line text-ink"
          : "border-accent/40 text-accent"
      }`}
    >
      {market}
    </span>
  );
}
