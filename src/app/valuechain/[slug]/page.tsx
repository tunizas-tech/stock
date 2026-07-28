// 밸류체인 상세(디자인 §6.4). 정적 데이터만 읽는 서버 컴포넌트.
import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ChainPipeline } from "@/components/valuechain/ChainPipeline";
import { VALUE_CHAINS, getValueChain } from "@/lib/valuechains";

export function generateStaticParams() {
  return VALUE_CHAINS.map((c) => ({ slug: c.slug }));
}

export default function ValueChainDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const chain = getValueChain(params.slug);
  if (!chain) notFound();

  return (
    <div>
      <Link
        href="/valuechain"
        className="text-xs text-muted transition-colors hover:text-ink"
      >
        ← 밸류체인 목록
      </Link>

      <div className="mt-3">
        <PageHeader kicker="valuechain" title={chain.title} />
      </div>

      {chain.status === "draft" && (
        <p className="-mt-4 mb-4 rounded-lg border border-loss bg-surface px-3 py-2 text-xs font-semibold text-loss">
          검수 전 초안입니다 — 종목·내용이 바뀔 수 있습니다.
        </p>
      )}

      <p className="mb-6 max-w-3xl text-sm leading-relaxed text-muted">
        {chain.summary}
      </p>

      {chain.flows && (
        <div className="mb-6 space-y-2">
          <p className="rounded-lg border border-line bg-surface px-3 py-2 text-xs leading-relaxed text-muted">
            <span className="font-semibold text-gain">{chain.flows.forward}</span>
          </p>
          <p className="rounded-lg border border-line bg-surface px-3 py-2 text-xs leading-relaxed text-muted">
            <span className="font-semibold text-loss">{chain.flows.reverse}</span>
          </p>
        </div>
      )}

      <ChainPipeline stages={chain.stages} />

      <footer className="mt-8 space-y-3 text-xs leading-relaxed text-muted">
        {chain.thesis && (
          <p className="border-t border-line pt-4">
            <b className="text-ink">핵심 논리</b> — {chain.thesis}
          </p>
        )}
        {chain.disclaimer && (
          <p className="rounded-lg border border-line bg-surface px-3 py-3">
            ※ {chain.disclaimer}
          </p>
        )}
        {chain.sources && chain.sources.length > 0 && (
          <p>
            출처:{" "}
            {chain.sources.map((s, i) => (
              <span key={s.url}>
                {i > 0 && " · "}
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  {s.label}
                </a>
              </span>
            ))}
          </p>
        )}
        <p className="tabular text-[11px] text-muted">업데이트 {chain.updatedAt}</p>
      </footer>
    </div>
  );
}
