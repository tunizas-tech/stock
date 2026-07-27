"use client";

// 캔들차트 + 일/주/월 주기 토글. 대시보드(지수)와 포트폴리오 차트 모달이 공유한다.

import { useEffect, useState } from "react";
import { CandleChart } from "./CandleChart";
import { getCandles } from "@/lib/candles";
import type { Candle, Market, Period } from "@/lib/types";

const PERIODS: { value: Period; label: string }[] = [
  { value: "D", label: "일" },
  { value: "W", label: "주" },
  { value: "M", label: "월" },
];

export function CandlePanel({
  kind,
  market,
  code,
  title,
}: {
  kind: "stock" | "index";
  market: Market;
  code: string;
  title: string;
}) {
  const [period, setPeriod] = useState<Period>("D");
  const [candles, setCandles] = useState<Candle[] | null>(null);

  useEffect(() => {
    let alive = true;
    setCandles(null);
    getCandles({ kind, market, code, period }).then((c) => {
      if (alive) setCandles(c);
    });
    return () => {
      alive = false;
    };
  }, [kind, market, code, period]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-medium text-ink">{title}</p>
        <div className="flex items-center gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`tabular rounded-md border px-2 py-1 text-xs transition-colors ${
                period === p.value
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-line text-muted hover:text-ink"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {candles === null ? (
        <p className="flex h-[280px] items-center justify-center text-sm text-muted">
          불러오는 중…
        </p>
      ) : (
        <CandleChart candles={candles} period={period} />
      )}
    </div>
  );
}
