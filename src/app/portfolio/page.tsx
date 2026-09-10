"use client";

// 포트폴리오(디자인 §4, PRD §6.2). 보유 종목 표(평가손익) + 관심 종목 그리드.
// 행/카드를 클릭하면 일/주/월봉 차트 모달이 열린다.
// 9단계: 보유 표는 산업(관측소 12섹터)별로 묶어 소계·비중을 보이고, 표 위에 비중 막대를 둔다.
import { Fragment, useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { MarketBadge } from "@/components/MarketBadge";
import { EmptyState } from "@/components/EmptyState";
import { ChartModal } from "@/components/ChartModal";
import { ImportCard } from "@/components/ImportCard";
import { HoldingForm } from "@/components/HoldingForm";
import { SectorWeightBar } from "@/components/SectorWeightBar";
import { SectorSelect } from "@/components/SectorSelect";
import { db } from "@/lib/data";
import {
  groupBySector,
  priceFromQuotes,
  sectorColor,
  universeSector,
} from "@/lib/portfolio/sector";
import { getQuotes, quoteKey } from "@/lib/quotes";
import {
  currencyOf,
  fmtMoney,
  fmtPct,
  fmtSignedMoney,
  pnlClass,
} from "@/lib/format";
import { detectStorageMode, type StorageMode } from "@/lib/storage-mode";
import { importHoldingRows, importWatchRows } from "@/lib/portfolio-client";
import { splitImportResult } from "@/lib/import-split";
import type { Holding, Market, Quote, WatchItem } from "@/lib/types";

type ChartTarget = { market: Market; ticker: string; name: string };

// 서버 모드에서 목록 읽기가 네트워크 호출이 된 뒤(8단계 Task 4)로 실패를
// 삼키면 setLoading(false)가 영원히 안 돌아 "불러오는 중…"에 갇힌다(스키마
// 미적용 배포에서 실제로 그렇다) — 일지 페이지와 같은 문구.
const LOAD_ERROR =
  "서버에서 보유·관심종목을 불러오지 못했습니다 — DATABASE_URL·db/portfolio-schema.sql을 적용했는지 확인하세요.";

export default function PortfolioPage() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [watch, setWatch] = useState<WatchItem[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [loading, setLoading] = useState(true);
  const [chart, setChart] = useState<ChartTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 서버 전환 직후 이 브라우저에만 남은 보유·관심을 한 번 올리는 이관 카드용 상태.
  const [mode, setMode] = useState<StorageMode>("local");
  const [localH, setLocalH] = useState<Holding[]>([]);
  const [localW, setLocalW] = useState<WatchItem[]>([]);
  // 보유·관심 이관 결과를 하나로 합치면(구 importMsg) 관심종목 카드에서 올린
  // 결과가 위쪽 보유 종목 섹션에 뜬다 — 카드별로 분리해 각자 자기 카드 밑에 뜨게 한다.
  const [importMsgH, setImportMsgH] = useState<string | null>(null);
  const [importMsgW, setImportMsgW] = useState<string | null>(null);

  async function refresh() {
    try {
      const [h, w] = await Promise.all([db.listHoldings(), db.listWatch()]);
      setHoldings(h);
      setWatch(w);
      const q = await getQuotes([
        ...h.map((x) => ({ ticker: x.ticker, market: x.market })),
        ...w.map((x) => ({ ticker: x.ticker, market: x.market })),
      ]);
      setQuotes(q);
      setError(null);
    } catch {
      setError(LOAD_ERROR);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    detectStorageMode().then((m) => {
      setMode(m);
      if (m === "server") {
        setLocalH(db.localHoldingsForImport());
        setLocalW(db.localWatchForImport());
      }
    });
  }, []);

  async function handleAddHolding(draft: Omit<Holding, "id">) {
    try {
      await db.addHolding(draft);
      await refresh();
    } catch (e) {
      // 폼은 이 예외를 받아 초안을 지키기만 한다 — 문구는 여기서만 보여준다.
      setError(e instanceof Error ? e.message : "추가 실패");
      throw e;
    }
  }

  async function importHoldings() {
    try {
      const r = await importHoldingRows(localH);
      // 서버가 받지 않은 행(rejected)까지 지우면 그 기록은 어디에도 남지
      // 않는다 — 무엇을 남길지는 순수 함수(splitImportResult)에 두고 테스트로
      // 못 박는다.
      const { keep, message } = splitImportResult(localH, r);
      if (keep.length === 0) db.clearLocalHoldings();
      else db.replaceLocalHoldings(keep);
      setLocalH(keep);
      setImportMsgH(message);
      await refresh();
    } catch (e) {
      setImportMsgH(e instanceof Error ? e.message : "이관 실패");
    }
  }

  async function importWatch() {
    try {
      const r = await importWatchRows(localW);
      const { keep, message } = splitImportResult(localW, r);
      if (keep.length === 0) db.clearLocalWatch();
      else db.replaceLocalWatch(keep);
      setLocalW(keep);
      setImportMsgW(message);
      await refresh();
    } catch (e) {
      setImportMsgW(e instanceof Error ? e.message : "이관 실패");
    }
  }

  return (
    <div>
      <PageHeader kicker="portfolio" title="포트폴리오" />

      {error && <p className="mb-4 text-xs text-loss">{error}</p>}

      {/* ---- 보유 종목 ---- */}
      <section className="mb-10">
        <h2 className="mb-3 font-serif text-xl font-semibold text-ink">
          보유 종목
        </h2>

        <ImportCard
          label="보유종목"
          rows={mode === "server" ? localH : []}
          seedNote="예시 데이터(삼성전자·Apple)는 올리지 않습니다 — 실제 보유면 직접 추가하세요."
          onImport={importHoldings}
        />
        {importMsgH && <p className="mb-4 text-xs text-muted">{importMsgH}</p>}

        <div className="mb-6">
          <HoldingForm onSubmit={handleAddHolding} />
        </div>

        {loading ? (
          <p className="text-sm text-muted">불러오는 중…</p>
        ) : holdings.length === 0 ? (
          <EmptyState
            title="보유 종목이 없습니다"
            hint="매수한 종목을 추가하면 평가손익을 자동으로 계산합니다."
          />
        ) : (
          <HoldingsTable
            holdings={holdings}
            quotes={quotes}
            onOpenChart={setChart}
            onSetSector={async (id, sector) => {
              try {
                const row = await db.setHoldingSector(id, sector);
                // 시세는 그대로라 목록만 갈아끼운다 — refresh()로 시세까지 다시 받을 이유가 없다.
                setHoldings((prev) => prev.map((h) => (h.id === id ? row : h)));
              } catch (e) {
                setError(e instanceof Error ? e.message : "분류 변경 실패");
              }
            }}
            onRemove={async (id) => {
              try {
                await db.removeHolding(id);
                await refresh();
              } catch (e) {
                setError(e instanceof Error ? e.message : "삭제 실패");
              }
            }}
          />
        )}
      </section>

      {/* ---- 관심 종목 ---- */}
      <section>
        <h2 className="mb-3 font-serif text-xl font-semibold text-ink">
          관심 종목
        </h2>

        <ImportCard
          label="관심종목"
          rows={mode === "server" ? localW : []}
          seedNote="예시 데이터(NAVER·NVIDIA)는 올리지 않습니다 — 실제 관심 종목이면 직접 추가하세요."
          onImport={importWatch}
        />
        {importMsgW && <p className="mb-4 text-xs text-muted">{importMsgW}</p>}

        {loading ? (
          <p className="text-sm text-muted">불러오는 중…</p>
        ) : watch.length === 0 ? (
          <EmptyState
            title="관심 종목이 없습니다"
            hint="지켜볼 종목과 진입 조건을 메모로 남겨보세요."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {watch.map((w) => (
              <WatchCard
                key={w.id}
                item={w}
                quote={quotes[quoteKey(w.market, w.ticker)]}
                onOpenChart={setChart}
                onRemove={async () => {
                  try {
                    await db.removeWatch(w.id);
                    await refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "삭제 실패");
                  }
                }}
              />
            ))}
          </div>
        )}
      </section>

      {chart && <ChartModal {...chart} onClose={() => setChart(null)} />}
    </div>
  );
}

function HoldingsTable({
  holdings,
  quotes,
  onOpenChart,
  onSetSector,
  onRemove,
}: {
  holdings: Holding[];
  quotes: Record<string, Quote>;
  onOpenChart: (t: ChartTarget) => void;
  onSetSector: (id: string, sector: string | undefined) => void;
  onRemove: (id: string) => void;
}) {
  const priceOf = priceFromQuotes(quotes);
  const groups = groupBySector(holdings, priceOf);

  return (
    <>
      <SectorWeightBar groups={groups} />
      <div className="overflow-x-auto rounded-xl2 border border-line bg-surface">
        <table className="w-full whitespace-nowrap text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-3 font-medium">종목</th>
              <th className="px-4 py-3 text-right font-medium">수량</th>
              <th className="px-4 py-3 text-right font-medium">평단가</th>
              <th className="px-4 py-3 text-right font-medium">현재가</th>
              <th className="px-4 py-3 text-right font-medium">평가금액</th>
              <th className="px-4 py-3 text-right font-medium">손익</th>
              <th className="px-4 py-3 text-right font-medium">손익률</th>
              <th className="px-4 py-3 font-medium">산업</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.sector}>
                {/* 섹터 머리행: 이름·종목 수·평가금액 소계·비중·손익. US만 있는 묶음은 금액 칸이 빈다. */}
                <tr className="border-b border-line/60 bg-bg/40">
                  <td className="px-4 py-2" colSpan={4}>
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-sm"
                        style={{ backgroundColor: sectorColor(g.sector) }}
                      />
                      <span className="font-medium text-ink">{g.sector}</span>
                      <span className="text-xs text-muted">{g.holdings.length}종목</span>
                      {g.weightPct !== null && (
                        <span className="tabular rounded border border-line px-1.5 py-0.5 text-[11px] text-muted">
                          비중 {g.weightPct.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="tabular px-4 py-2 text-right text-xs text-muted">
                    {g.marketValue !== null ? fmtMoney(g.marketValue, "KRW") : ""}
                  </td>
                  <td className={`tabular px-4 py-2 text-right text-xs ${g.pnl !== null ? pnlClass(g.pnl) : "text-muted"}`}>
                    {g.pnl !== null ? fmtSignedMoney(g.pnl, "KRW") : ""}
                  </td>
                  <td className={`tabular px-4 py-2 text-right text-xs ${g.pnl !== null ? pnlClass(g.pnl) : "text-muted"}`}>
                    {g.pnl !== null && g.marketValue !== null && g.marketValue - g.pnl > 0
                      ? fmtPct((g.pnl / (g.marketValue - g.pnl)) * 100)
                      : ""}
                  </td>
                  <td className="px-4 py-2" colSpan={2} />
                </tr>
                {g.holdings.map((h) => (
                  <HoldingRow
                    key={h.id}
                    h={h}
                    current={priceOf(h)}
                    onOpenChart={onOpenChart}
                    onSetSector={onSetSector}
                    onRemove={onRemove}
                  />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function HoldingRow({
  h,
  current,
  onOpenChart,
  onSetSector,
  onRemove,
}: {
  h: Holding;
  current: number;
  onOpenChart: (t: ChartTarget) => void;
  onSetSector: (id: string, sector: string | undefined) => void;
  onRemove: (id: string) => void;
}) {
  const currency = currencyOf(h.market);
  const marketValue = current * h.shares;
  const cost = h.avgPrice * h.shares;
  const pnl = marketValue - cost;
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
  return (
    <tr
      onClick={() => onOpenChart({ market: h.market, ticker: h.ticker, name: h.name })}
      title="차트 보기"
      className="group cursor-pointer border-b border-line/60 last:border-0 hover:bg-bg/60"
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 pl-4">
          <MarketBadge market={h.market} />
          <span className="tabular font-medium text-ink">{h.ticker}</span>
          <span className="text-muted">{h.name}</span>
        </div>
      </td>
      <td className="tabular px-4 py-3 text-right">{h.shares}</td>
      <td className="tabular px-4 py-3 text-right">{fmtMoney(h.avgPrice, currency)}</td>
      <td className="tabular px-4 py-3 text-right">{fmtMoney(current, currency)}</td>
      <td className="tabular px-4 py-3 text-right">{fmtMoney(marketValue, currency)}</td>
      <td className={`tabular px-4 py-3 text-right ${pnlClass(pnl)}`}>{fmtSignedMoney(pnl, currency)}</td>
      <td className={`tabular px-4 py-3 text-right ${pnlClass(pnlPct)}`}>{fmtPct(pnlPct)}</td>
      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
        {/* 행 클릭(차트)과 분리 — 드롭다운을 만지다 차트가 열리면 안 된다. */}
        <SectorSelect
          value={h.sector}
          autoSector={universeSector(h.market, h.ticker)}
          onChange={(sec) => onSetSector(h.id, sec)}
          className="rounded-lg border border-line bg-bg px-2 py-1 text-xs text-ink outline-none focus:border-accent"
        />
      </td>
      <td className="px-4 py-3 text-right">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(h.id);
          }}
          aria-label="보유 종목 삭제"
          className="text-xs text-muted opacity-0 transition-opacity hover:text-loss group-hover:opacity-100"
        >
          삭제
        </button>
      </td>
    </tr>
  );
}

function WatchCard({
  item,
  quote,
  onOpenChart,
  onRemove,
}: {
  item: WatchItem;
  quote?: Quote;
  onOpenChart: (t: ChartTarget) => void;
  onRemove: () => void;
}) {
  return (
    <div
      onClick={() =>
        onOpenChart({ market: item.market, ticker: item.ticker, name: item.name })
      }
      title="차트 보기"
      className="group cursor-pointer rounded-xl2 border border-line bg-surface p-4 transition-colors hover:bg-bg/60"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <MarketBadge market={item.market} />
          <span className="tabular font-medium text-ink">{item.ticker}</span>
          <span className="text-sm text-muted">{item.name}</span>
        </div>
        <div className="flex items-center gap-3">
          {quote && (
            <span className={`tabular text-sm ${pnlClass(quote.changePct)}`}>
              {fmtPct(quote.changePct)}
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            aria-label="관심 종목 삭제"
            className="text-xs text-muted opacity-0 transition-opacity hover:text-loss group-hover:opacity-100"
          >
            삭제
          </button>
        </div>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted">{item.memo}</p>
    </div>
  );
}
