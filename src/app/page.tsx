"use client";

// 대시보드(디자인 §4). 3개 모듈 진입 카드 + 시장 지수 차트 + 현황 카운트.
import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { CandlePanel } from "@/components/CandlePanel";
import { db } from "@/lib/data";
import { INDICES } from "@/lib/indices";

type Counts = { holdings: number; watch: number; journal: number };

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

  useEffect(() => {
    (async () => {
      const [h, w, j] = await Promise.all([
        db.listHoldings(),
        db.listWatch(),
        db.listJournal(),
      ]);
      setCounts({ holdings: h.length, watch: w.length, journal: j.length });
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
          </Link>
        ))}
      </div>

      <IndexChartSection />

      <div className="mt-8 grid grid-cols-3 gap-4">
        <StatCard label="보유 종목" value={counts.holdings} />
        <StatCard label="관심 종목" value={counts.watch} />
        <StatCard label="일지 기록" value={counts.journal} />
      </div>
    </div>
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
