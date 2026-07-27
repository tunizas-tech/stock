"use client";

// 캔들(봉) 차트 — recharts 범위 Bar에 커스텀 셰이프로 몸통+꼬리를 그린다.
// 색은 손익 규칙(디자인 §6)과 동일: 상승 --gain, 하락 --loss.

import {
  Bar,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Candle, Period } from "@/lib/types";

interface CandleShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: Candle;
}

function CandleShape({ x, y, width, height, payload }: CandleShapeProps) {
  if (
    x === undefined ||
    y === undefined ||
    !width ||
    height === undefined ||
    !payload
  ) {
    return null;
  }
  const { open, close, high, low } = payload;
  const range = high - low || 1;
  const yAt = (v: number) => y + ((high - v) / range) * height;
  const color = close >= open ? "var(--gain)" : "var(--loss)";
  const cx = x + width / 2;
  const bodyW = Math.max(1.5, width * 0.6);
  const bodyTop = yAt(Math.max(open, close));
  const bodyH = Math.max(1, Math.abs(yAt(open) - yAt(close)));
  return (
    <g>
      <line
        x1={cx}
        x2={cx}
        y1={yAt(high)}
        y2={yAt(low)}
        stroke={color}
        strokeWidth={1}
      />
      <rect x={cx - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} fill={color} />
    </g>
  );
}

function CandleTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: Candle }[];
}) {
  if (!active || !payload?.length) return null;
  const c = payload[0].payload;
  const fmt = (v: number) => v.toLocaleString();
  return (
    <div className="tabular rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-ink">{c.date}</p>
      <p className="text-muted">시 {fmt(c.open)} · 고 {fmt(c.high)}</p>
      <p className="text-muted">저 {fmt(c.low)} · 종 {fmt(c.close)}</p>
    </div>
  );
}

export function CandleChart({
  candles,
  period,
}: {
  candles: Candle[];
  period: Period;
}) {
  const data = candles.map((c) => ({ ...c, range: [c.low, c.high] }));
  // 일봉 MM-DD, 주·월봉 YY-MM
  const fmtTick = (d: string) => (period === "D" ? d.slice(5) : d.slice(2, 7));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <XAxis
          dataKey="date"
          tickFormatter={fmtTick}
          minTickGap={28}
          tick={{ fontSize: 11, fill: "var(--muted)" }}
          axisLine={{ stroke: "var(--line)" }}
          tickLine={false}
        />
        <YAxis
          domain={["auto", "auto"]}
          width={64}
          tick={{ fontSize: 11, fill: "var(--muted)" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => v.toLocaleString()}
        />
        <Tooltip content={<CandleTooltip />} cursor={{ stroke: "var(--line)" }} />
        <Bar dataKey="range" shape={<CandleShape />} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
