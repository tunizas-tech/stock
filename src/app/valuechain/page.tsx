// 밸류체인 목록(디자인 §6.3). 산업 카드 → 상세 링크. 정적 데이터 서버 컴포넌트.
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { VALUE_CHAINS, splitByStatus } from "@/lib/valuechains";
import type { ValueChain } from "@/lib/types";

function ChainCard({ chain }: { chain: ValueChain }) {
  return (
    <Link
      href={`/valuechain/${chain.slug}`}
      className="group rounded-xl2 border border-line bg-surface p-5 transition-colors hover:border-accent"
    >
      <h2 className="font-serif text-lg font-semibold text-ink group-hover:text-accent">
        {chain.title}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">{chain.summary}</p>
      <div className="tabular mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {chain.status === "draft" && (
          <span className="rounded border border-loss px-1.5 py-0.5 font-semibold text-loss">
            초안
          </span>
        )}
        {chain.anchor && <span className="text-accent">◆ {chain.anchor}</span>}
        <span>{chain.stages.length}단계</span>
        <span>업데이트 {chain.updatedAt}</span>
      </div>
    </Link>
  );
}

export default function ValueChainListPage() {
  const { published, drafts } = splitByStatus(VALUE_CHAINS);

  return (
    <div>
      <PageHeader kicker="valuechain" title="산업 밸류체인" />

      {VALUE_CHAINS.length === 0 ? (
        <EmptyState
          title="아직 정리된 밸류체인이 없습니다"
          hint="src/lib/valuechains/ 에 산업 파일을 추가하면 여기에 나타납니다."
        />
      ) : (
        <div className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-2">
            {published.map((c) => (
              <ChainCard key={c.slug} chain={c} />
            ))}
          </div>

          {drafts.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
                초안 — 검수 대기 {drafts.length}건
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {drafts.map((c) => (
                  <ChainCard key={c.slug} chain={c} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
