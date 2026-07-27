// 밸류체인 목록(디자인 §6.3). 산업 카드 → 상세 링크. 정적 데이터 서버 컴포넌트.
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { VALUE_CHAINS } from "@/lib/valuechains";

export default function ValueChainListPage() {
  return (
    <div>
      <PageHeader kicker="valuechain" title="산업 밸류체인" />

      {VALUE_CHAINS.length === 0 ? (
        <EmptyState
          title="아직 정리된 밸류체인이 없습니다"
          hint="src/lib/valuechains.ts 에 산업을 추가하면 여기에 나타납니다."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {VALUE_CHAINS.map((c) => (
            <Link
              key={c.slug}
              href={`/valuechain/${c.slug}`}
              className="group rounded-xl2 border border-line bg-surface p-5 transition-colors hover:border-accent"
            >
              <h2 className="font-serif text-lg font-semibold text-ink group-hover:text-accent">
                {c.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{c.summary}</p>
              <div className="tabular mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                {c.anchor && <span className="text-accent">◆ {c.anchor}</span>}
                <span>{c.stages.length}단계</span>
                <span>업데이트 {c.updatedAt}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
