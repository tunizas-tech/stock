"use client";

// 뉴스 키워드 대시보드(/news). 키워드=검색어 분류, 상단 칩 탭 필터 + 세로 섹션 피드.
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { fmtRelative } from "@/lib/format";
import type { NewsFeedGroup } from "@/lib/types";

export default function NewsPage() {
  const [feed, setFeed] = useState<NewsFeedGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [configMissing, setConfigMissing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<number | "all">("all");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState("");

  async function load() {
    const res = await fetch("/api/news");
    if (res.status === 503) {
      setConfigMissing(true);
      setLoading(false);
      return;
    }
    const body = await res.json();
    setFeed(body.feed ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/news/sync", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      await load();
      setToast(res.ok ? `신규 ${body.inserted ?? 0}건 반영` : "갱신 실패");
    } finally {
      setSyncing(false);
      setTimeout(() => setToast(""), 3000);
    }
  }

  async function handleAdd() {
    const keyword = draft.trim();
    setDraft("");
    setAdding(false);
    if (!keyword) return;
    await fetch("/api/news/keywords", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keyword }),
    });
    await load();
  }

  async function handleDelete(id: number) {
    await fetch(`/api/news/keywords/${id}`, { method: "DELETE" });
    if (filter === id) setFilter("all");
    await load();
  }

  if (configMissing) {
    return (
      <div>
        <PageHeader kicker="news" title="뉴스" />
        <EmptyState
          title="설정이 필요합니다"
          hint="서버에 DATABASE_URL, NAVER_CLIENT_ID, NAVER_CLIENT_SECRET를 설정하세요."
        />
      </div>
    );
  }

  const shown =
    filter === "all" ? feed : feed.filter((g) => g.keyword.id === filter);

  return (
    <div>
      <PageHeader kicker="news" title="뉴스">
        <button
          onClick={handleSync}
          disabled={syncing}
          className="rounded-lg border border-accent bg-accent/10 px-3 py-1.5 text-sm text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
        >
          {syncing ? "갱신 중…" : "↻ 업데이트"}
        </button>
      </PageHeader>

      {toast && (
        <p className="mb-4 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-muted">
          {toast}
        </p>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Chip label="전체" active={filter === "all"} onClick={() => setFilter("all")} />
        {feed.map((g) => (
          <Chip
            key={g.keyword.id}
            label={g.keyword.keyword}
            active={filter === g.keyword.id}
            onClick={() => setFilter(g.keyword.id)}
          />
        ))}
        {adding ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
              if (e.key === "Escape") {
                setAdding(false);
                setDraft("");
              }
            }}
            onBlur={handleAdd}
            placeholder="키워드 입력 후 Enter"
            className="rounded-full border border-accent bg-bg px-3 py-1.5 text-sm outline-none"
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="rounded-full border border-dashed border-line px-3 py-1.5 text-sm text-muted transition-colors hover:text-ink"
          >
            + 키워드
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted">불러오는 중…</p>
      ) : feed.length === 0 ? (
        <EmptyState
          title="아직 키워드가 없습니다"
          hint="관심 있는 키워드를 추가하면 관련 뉴스를 모아 보여줍니다."
        />
      ) : (
        <div className="space-y-6">
          {shown.map((g) => (
            <NewsSection
              key={g.keyword.id}
              group={g}
              onDelete={() => handleDelete(g.keyword.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
        active
          ? "border-accent bg-accent/10 text-accent"
          : "border-line text-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function NewsSection({
  group,
  onDelete,
}: {
  group: NewsFeedGroup;
  onDelete: () => void;
}) {
  return (
    <section className="group rounded-xl2 border border-line bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-serif text-lg font-semibold text-accent">
          {group.keyword.keyword}
          <span className="ml-2 text-sm font-normal text-muted">
            {group.items.length}건
          </span>
        </h2>
        <button
          onClick={onDelete}
          aria-label="키워드 삭제"
          className="text-xs text-muted opacity-0 transition-opacity hover:text-loss group-hover:opacity-100"
        >
          삭제
        </button>
      </div>
      {group.items.length === 0 ? (
        <p className="text-sm text-muted">
          아직 수집된 뉴스가 없습니다. [업데이트]를 눌러보세요.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {group.items.map((it) => (
            <li key={it.id} className="py-2.5">
              <a
                href={it.originalLink ?? it.link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium leading-snug text-ink transition-colors hover:text-accent"
              >
                {it.title}
              </a>
              <p className="tabular mt-0.5 text-xs text-muted">
                {it.source ?? "출처 미상"}
                {it.pubDate ? ` · ${fmtRelative(it.pubDate)}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
