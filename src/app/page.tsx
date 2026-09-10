"use client";

// 대시보드(디자인 §4). 3개 모듈 진입 카드 + 시장 지수 차트 + 현황 카운트.
import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { CandlePanel } from "@/components/CandlePanel";
import { db } from "@/lib/data";
import { INDICES } from "@/lib/indices";
import { loadSectorGroups } from "@/lib/portfolio/sector-summary";
import { sectorColor, type SectorGroup } from "@/lib/portfolio/sector";

type Counts = { holdings: number; watch: number; journal: number };

// 서버 모드에서 카운트 조회가 네트워크 호출이 된 뒤(8단계 Task 4)로 실패를
// 삼키면 카운트가 계속 0으로 보여 "보유·관심·기록이 하나도 없다"는 거짓
// 신호를 준다 — 다른 화면과 같은 원인·조치를 안내한다.
const LOAD_ERROR =
  "서버에서 보유·관심종목을 불러오지 못했습니다 — DATABASE_URL·db/portfolio-schema.sql을 적용했는지 확인하세요.";

const MODULES = [
  {
    href: "/journal",
    kicker: "journal",
    title: "매매일지",
    desc: "결정과 그 맥락을 남기고, 시간이 지나 복기한다. 학습 루프의 중심.",
    countKey: "journal" as const,
    unit: "건의 기록",
  },
  {
    href: "/portfolio",
    kicker: "portfolio",
    title: "포트폴리오",
    desc: "보유 종목의 평가손익을 통화별로 확인하고, 관심 종목을 관찰한다.",
    countKey: "holdings" as const,
    unit: "개 보유 종목",
  },
  {
    href: "/screener",
    kicker: "screener",
    title: "스크리너",
    desc: "지표 기반으로 한·미 종목을 거른다. 결과에서 바로 관심 종목에 추가.",
    countKey: null,
    unit: "지표 6종 필터",
  },
];

export default function DashboardPage() {
  const [counts, setCounts] = useState<Counts>({
    holdings: 0,
    watch: 0,
    journal: 0,
  });
  const [error, setError] = useState<string | null>(null);
  // 포트폴리오 카드 밑에 붙는 "어느 산업에 얼마나" 한 줄(9단계). 시세가 필요해 카운트와
  // 따로 받는다 — 시세가 늦어도 카운트는 먼저 뜬다.
  const [sectors, setSectors] = useState<SectorGroup[]>([]);

  useEffect(() => {
    loadSectorGroups().then(setSectors).catch(() => setSectors([]));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [h, w, j] = await Promise.all([
          db.listHoldings(),
          db.listWatch(),
          db.listJournal(),
        ]);
        setCounts({ holdings: h.length, watch: w.length, journal: j.length });
        setError(null);
      } catch {
        setError(LOAD_ERROR);
      }
    })();
  }, []);

  return (
    <div>
      <PageHeader
        kicker="quiet analysis room"
        title="차분히 되돌아보는 공부 노트"
      />

      <p className="mb-8 max-w-2xl text-sm leading-relaxed text-muted">
        사고파는 도구가 아니라, 결정을 기록하고 복기하며 패턴을 발견하는 곳입니다.
        지금 무엇을 보유했고 무엇을 지켜보는지, 그리고 왜 그렇게 결정했는지를 한곳에
        모읍니다.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        {MODULES.map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className="group rounded-xl2 border border-line bg-surface p-5 transition-all hover:-translate-y-0.5 hover:shadow-md"
          >
            <p className="tabular text-xs lowercase tracking-widest text-accent">
              {m.kicker}
            </p>
            <h2 className="mt-1 font-serif text-xl font-semibold text-ink">
              {m.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{m.desc}</p>
            <p className="tabular mt-4 text-sm text-ink">
              {m.countKey ? (
                <>
                  <span className="text-lg font-semibold">
                    {counts[m.countKey]}
                  </span>{" "}
                  <span className="text-muted">{m.unit}</span>
                </>
              ) : (
                <span className="text-muted">{m.unit}</span>
              )}
            </p>
            {m.countKey === "holdings" && <TopSectors groups={sectors} />}
          </Link>
        ))}
      </div>

      <IndexChartSection />

      <div className="mt-8">
        {error && <p className="mb-4 text-xs text-loss">{error}</p>}
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="보유 종목" value={counts.holdings} />
          <StatCard label="관심 종목" value={counts.watch} />
          <StatCard label="일지 기록" value={counts.journal} />
        </div>
      </div>
    </div>
  );
}

/** 보유 비중 상위 3개 산업. KR 비중이 없으면(전부 해외 등) 아무것도 안 보인다. */
function TopSectors({ groups }: { groups: SectorGroup[] }) {
  const top = groups.filter((g) => g.weightPct !== null && g.weightPct > 0).slice(0, 3);
  if (top.length === 0) return null;
  return (
    <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      {top.map((g) => (
        <span key={g.sector} className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: sectorColor(g.sector) }} />
          {g.sector} <span className="tabular">{g.weightPct!.toFixed(0)}%</span>
        </span>
      ))}
    </p>
  );
}

function IndexChartSection() {
  const [selected, setSelected] = useState(INDICES[0]);
  return (
    <section className="mt-10">
      <h2 className="mb-3 font-serif text-xl font-semibold text-ink">
        시장 지수
      </h2>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {INDICES.map((idx) => (
          <button
            key={idx.code}
            onClick={() => setSelected(idx)}
            className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
              selected.code === idx.code
                ? "border-accent bg-accent/10 text-accent"
                : "border-line text-muted hover:text-ink"
            }`}
          >
            {idx.label}
          </button>
        ))}
      </div>
      <div className="rounded-xl2 border border-line bg-surface p-4">
        <CandlePanel
          kind="index"
          market={selected.market}
          code={selected.code}
          title={selected.label}
        />
      </div>
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl2 border border-line bg-surface/60 px-5 py-4 text-center">
      <p className="tabular text-2xl font-semibold text-ink">{value}</p>
      <p className="mt-1 text-xs text-muted">{label}</p>
    </div>
  );
}
