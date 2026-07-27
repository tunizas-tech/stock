"use client";

// 스크리너(디자인 §4, PRD §6.3) — 모듈 D.
// 유니버스(내장 대표 종목 + 보유 + 관심)의 펀더멘털을 받아 min~max 조건으로 거른다.
// 조건이 설정된 지표가 결측(예: KR 실데이터의 배당·매출성장)인 종목은 제외된다.
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { MarketBadge } from "@/components/MarketBadge";
import { EmptyState } from "@/components/EmptyState";
import { db, todayISO } from "@/lib/data";
import { getFundamentals } from "@/lib/fundamentals";
import { applyFilters, type MetricKey, type RangeCriterion } from "@/lib/screener";
import { fmtMarketCap, fmtPct, pnlClass } from "@/lib/format";
import { quoteKey } from "@/lib/quotes";
import { DEFAULT_UNIVERSE, type UniverseItem } from "@/lib/universe";
import type { Fundamentals, Market } from "@/lib/types";

type RangeFilter = {
  key: MetricKey;
  label: string;
  unit?: string;
  placeholderMin: string;
  placeholderMax: string;
};

const FILTERS: RangeFilter[] = [
  { key: "marketCap", label: "시가총액", unit: "KR 억₩ · US M$", placeholderMin: "1000", placeholderMax: "" },
  { key: "per", label: "PER", placeholderMin: "0", placeholderMax: "15" },
  { key: "pbr", label: "PBR", placeholderMin: "0", placeholderMax: "1.5" },
  { key: "dividendYield", label: "배당수익률", unit: "%", placeholderMin: "2", placeholderMax: "" },
  { key: "revenueGrowth", label: "매출 성장률", unit: "%", placeholderMin: "10", placeholderMax: "" },
  { key: "off52wHigh", label: "52주 고가 대비", unit: "%", placeholderMin: "-30", placeholderMax: "-10" },
];

type RangeInputs = Partial<Record<MetricKey, { min: string; max: string }>>;

function toCriterion(v?: { min: string; max: string }): RangeCriterion {
  const parse = (s?: string) => {
    if (!s?.trim()) return undefined;
    const n = Number(s);
    return Number.isNaN(n) ? undefined : n;
  };
  return { min: parse(v?.min), max: parse(v?.max) };
}

export default function ScreenerPage() {
  const [markets, setMarkets] = useState<Record<Market, boolean>>({
    KR: true,
    US: true,
  });
  const [inputs, setInputs] = useState<RangeInputs>({});
  const [results, setResults] = useState<Fundamentals[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [watchedKeys, setWatchedKeys] = useState<Set<string>>(new Set());

  function setInput(key: MetricKey, side: "min" | "max", value: string) {
    setInputs((s) => ({
      ...s,
      [key]: { min: "", max: "", ...s[key], [side]: value },
    }));
  }

  async function runScreen() {
    setLoading(true);
    try {
      const [holdings, watch] = await Promise.all([
        db.listHoldings(),
        db.listWatch(),
      ]);
      setWatchedKeys(new Set(watch.map((w) => quoteKey(w.market, w.ticker))));

      // 유니버스 병합(내장 + 보유 + 관심), quoteKey로 중복 제거
      const merged = new Map<string, UniverseItem>();
      for (const item of [...DEFAULT_UNIVERSE, ...holdings, ...watch]) {
        merged.set(quoteKey(item.market, item.ticker), {
          ticker: item.ticker,
          market: item.market,
          name: item.name,
        });
      }
      const fundamentals = await getFundamentals([...merged.values()]);

      const ranges: Partial<Record<MetricKey, RangeCriterion>> = {};
      for (const f of FILTERS) ranges[f.key] = toCriterion(inputs[f.key]);
      const selected = (["KR", "US"] as Market[]).filter((m) => markets[m]);
      setResults(applyFilters(Object.values(fundamentals), { markets: selected, ranges }));
    } finally {
      setLoading(false);
    }
  }

  async function addToWatch(row: Fundamentals) {
    await db.addWatch({
      market: row.market,
      ticker: row.ticker,
      name: row.name,
      memo: "스크리너에서 추가",
      addedAt: todayISO(),
    });
    setWatchedKeys((s) => new Set(s).add(quoteKey(row.market, row.ticker)));
  }

  return (
    <div>
      <PageHeader kicker="screener" title="스크리너">
        <span className="tabular rounded-md border border-line px-2 py-1 text-xs text-muted">
          대상 {DEFAULT_UNIVERSE.length}+ 종목 (대표 종목 + 보유 + 관심)
        </span>
      </PageHeader>

      <p className="mb-6 max-w-2xl text-sm leading-relaxed text-muted">
        지표 기반으로 한·미 종목을 거릅니다. 조건을 비워두면 그 지표는 무시하고,
        조건을 건 지표의 값이 없는 종목(예: 한국 실데이터의 배당·매출 성장률)은
        제외됩니다. API 키가 없으면 mock 데이터로 동작합니다.
      </p>

      {/* 시장 선택 */}
      <div className="mb-4 flex items-center gap-2">
        {(["KR", "US"] as Market[]).map((m) => (
          <button
            key={m}
            onClick={() => setMarkets((s) => ({ ...s, [m]: !s[m] }))}
            className={`tabular rounded-lg border px-3 py-1.5 text-sm transition-colors ${
              markets[m]
                ? "border-accent bg-accent/10 text-accent"
                : "border-line text-muted hover:text-ink"
            }`}
          >
            {m} {m === "KR" ? "한국" : "미국"}
          </button>
        ))}
      </div>

      {/* 필터 카드 그리드 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FILTERS.map((f) => (
          <div
            key={f.key}
            className="rounded-xl2 border border-line bg-surface p-4"
          >
            <label className="text-sm font-medium text-ink">
              {f.label}
              {f.unit && (
                <span className="ml-1 text-xs text-muted">({f.unit})</span>
              )}
            </label>
            <div className="mt-2 flex items-center gap-2">
              <input
                value={inputs[f.key]?.min ?? ""}
                onChange={(e) => setInput(f.key, "min", e.target.value)}
                placeholder={f.placeholderMin || "최소"}
                inputMode="decimal"
                className="tabular w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent"
              />
              <span className="text-muted">~</span>
              <input
                value={inputs[f.key]?.max ?? ""}
                onChange={(e) => setInput(f.key, "max", e.target.value)}
                placeholder={f.placeholderMax || "최대"}
                inputMode="decimal"
                className="tabular w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex justify-end">
        <button
          onClick={runScreen}
          disabled={loading}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {loading ? "거르는 중…" : "종목 거르기"}
        </button>
      </div>

      {/* 결과 테이블 */}
      <div className="mt-8">
        {results === null ? (
          <EmptyState
            title="조건을 정하고 ‘종목 거르기’를 눌러보세요"
            hint="조건 없이 실행하면 유니버스 전체가 표시됩니다."
          />
        ) : results.length === 0 ? (
          <EmptyState
            title="조건에 맞는 종목이 없습니다"
            hint="범위를 넓히거나 일부 조건을 비워보세요."
          />
        ) : (
          <ResultsTable
            rows={results}
            watchedKeys={watchedKeys}
            onWatch={addToWatch}
          />
        )}
      </div>
    </div>
  );
}

function metricCell(v: number | undefined, digits = 2): string {
  return v === undefined ? "—" : v.toFixed(digits);
}

function ResultsTable({
  rows,
  watchedKeys,
  onWatch,
}: {
  rows: Fundamentals[];
  watchedKeys: Set<string>;
  onWatch: (row: Fundamentals) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl2 border border-line bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th className="px-4 py-3 font-medium">종목</th>
            <th className="px-4 py-3 text-right font-medium">시가총액</th>
            <th className="px-4 py-3 text-right font-medium">PER</th>
            <th className="px-4 py-3 text-right font-medium">PBR</th>
            <th className="px-4 py-3 text-right font-medium">배당</th>
            <th className="px-4 py-3 text-right font-medium">매출성장</th>
            <th className="px-4 py-3 text-right font-medium">52주 고가比</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const key = quoteKey(r.market, r.ticker);
            const watched = watchedKeys.has(key);
            return (
              <tr key={key} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <MarketBadge market={r.market} />
                    <span className="tabular font-medium text-ink">
                      {r.ticker}
                    </span>
                    <span className="text-muted">{r.name}</span>
                  </div>
                </td>
                <td className="tabular px-4 py-3 text-right">
                  {fmtMarketCap(r.marketCap, r.market)}
                </td>
                <td className="tabular px-4 py-3 text-right">
                  {metricCell(r.per, 1)}
                </td>
                <td className="tabular px-4 py-3 text-right">
                  {metricCell(r.pbr)}
                </td>
                <td className="tabular px-4 py-3 text-right">
                  {r.dividendYield === undefined
                    ? "—"
                    : `${r.dividendYield.toFixed(2)}%`}
                </td>
                <td className="tabular px-4 py-3 text-right">
                  {r.revenueGrowth === undefined ? "—" : fmtPct(r.revenueGrowth)}
                </td>
                <td
                  className={`tabular px-4 py-3 text-right ${
                    r.off52wHigh === undefined ? "" : pnlClass(r.off52wHigh)
                  }`}
                >
                  {r.off52wHigh === undefined ? "—" : fmtPct(r.off52wHigh)}
                </td>
                <td className="px-4 py-3 text-right">
                  {watched ? (
                    <span className="text-xs text-muted">관심 ✓</span>
                  ) : (
                    <button
                      onClick={() => onWatch(r)}
                      className="text-xs text-accent hover:underline"
                    >
                      + 관심
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
