"use client";

// 매매일지(디자인 §4, PRD §6.1). 입력 폼 + 기록 카드 목록(최신순).
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { MarketBadge } from "@/components/MarketBadge";
import { EmotionDots } from "@/components/EmotionDots";
import { EmptyState } from "@/components/EmptyState";
import { JournalEntryForm } from "@/components/JournalEntryForm";
import { db } from "@/lib/data";
import {
  currencyOf,
  fmtDate,
  fmtMoney,
} from "@/lib/format";
import { detectStorageMode, type StorageMode } from "@/lib/storage-mode";
import { importJournalEntries } from "@/lib/journal-client";
import type { JournalAction, JournalEntry } from "@/lib/types";

const ACTION_LABEL: Record<JournalAction, string> = {
  buy: "매수",
  sell: "매도",
  note: "메모",
  // skip = 검토했으나 매수하지 않음. 스냅샷은 같이 찍혀 "놓친 것"의 크기를 잰다 (스펙 §1, N3)
  skip: "관망",
};

const ACTION_STYLE: Record<JournalAction, string> = {
  buy: "border-gain/40 text-gain",
  sell: "border-loss/40 text-loss",
  note: "border-line text-muted",
  skip: "border-line text-muted",
};

export default function JournalPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // 서버 전환 직후 이 브라우저에만 남은 기록을 한 번 올리는 이관 카드용 상태.
  const [mode, setMode] = useState<StorageMode>("local");
  const [localLeft, setLocalLeft] = useState<JournalEntry[]>([]);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  async function refresh() {
    setEntries(await db.listJournal());
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    detectStorageMode().then((m) => {
      setMode(m);
      if (m === "server") setLocalLeft(db.localJournalForImport());
    });
  }, []);

  async function handleAdd(draft: Omit<JournalEntry, "id">) {
    await db.addJournal(draft);
    await refresh();
  }

  async function handleImport() {
    try {
      const r = await importJournalEntries(localLeft);
      db.clearLocalJournal();
      setLocalLeft([]);
      setImportMsg(`${r.inserted}건 올림, ${r.skipped}건은 이미 있어 건너뜀`);
      await refresh();
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : "이관 실패");
    }
  }

  async function handleDelete(id: string) {
    await db.removeJournal(id);
    await refresh();
  }

  async function handleLesson(id: string, lesson: string) {
    await db.updateJournalLesson(id, lesson);
    await refresh();
  }

  return (
    <div>
      <PageHeader kicker="journal" title="매매일지">
        <Link href="/journal/review" className="text-sm text-accent hover:underline">
          자기검증 →
        </Link>
      </PageHeader>

      {mode === "server" && localLeft.length > 0 && (
        <div className="mb-6 rounded-xl2 border border-accent/40 bg-surface p-4 text-sm">
          <p className="text-ink">
            이 브라우저에 남아 있는 기록 <b>{localLeft.length}건</b>이 서버에 없습니다.
          </p>
          <p className="mt-1 text-xs text-muted">
            한 번 올리면 이 브라우저의 사본은 비웁니다. 같은 기록은 두 번 들어가지 않습니다.
          </p>
          <button
            onClick={handleImport}
            className="mt-3 rounded-md border border-accent px-3 py-1.5 text-xs text-accent hover:bg-accent/10"
          >
            서버로 올리기
          </button>
        </div>
      )}
      {importMsg && <p className="mb-4 text-xs text-muted">{importMsg}</p>}

      <div className="mb-6">
        <JournalEntryForm onSubmit={handleAdd} />
      </div>

      {loading ? (
        <p className="text-sm text-muted">불러오는 중…</p>
      ) : entries.length === 0 ? (
        <EmptyState
          title="아직 기록이 없습니다"
          hint="첫 결정을 남겨보세요. 가격·수량 없이 메모만으로도 충분합니다."
        />
      ) : (
        <ul className="space-y-4">
          {entries.map((e) => (
            <JournalCard
              key={e.id}
              entry={e}
              onDelete={() => handleDelete(e.id)}
              onLesson={(lesson) => handleLesson(e.id, lesson)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function JournalCard({
  entry,
  onDelete,
  onLesson,
}: {
  entry: JournalEntry;
  onDelete: () => void;
  onLesson: (lesson: string) => void;
}) {
  const [editingLesson, setEditingLesson] = useState(false);
  const [draft, setDraft] = useState(entry.lesson);
  const currency = currencyOf(entry.market);

  return (
    <li className="group rounded-xl2 border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <MarketBadge market={entry.market} />
          <span className="tabular text-sm font-medium text-ink">
            {entry.ticker}
          </span>
          <span className="text-sm text-muted">{entry.name}</span>
          <span
            className={`tabular rounded-md border px-1.5 py-0.5 text-xs ${ACTION_STYLE[entry.action]}`}
          >
            {ACTION_LABEL[entry.action]}
          </span>
          {entry.primaryTag && (
            <span className="inline-flex items-center rounded-md border border-line px-1.5 py-0.5 text-xs font-medium text-muted">
              {entry.primaryTag}
            </span>
          )}
        </div>
        <button
          onClick={onDelete}
          aria-label="기록 삭제"
          className="text-xs text-muted opacity-0 transition-opacity hover:text-loss group-hover:opacity-100"
        >
          삭제
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="tabular">{fmtDate(entry.date)}</span>
        {entry.price != null && (
          <span className="tabular">
            가격 {fmtMoney(entry.price, currency)}
          </span>
        )}
        {entry.qty != null && <span className="tabular">수량 {entry.qty}</span>}
        <EmotionDots value={entry.emotion} />
      </div>

      <p className="mt-3 text-sm leading-relaxed text-ink">{entry.reason}</p>

      {/* 복기 — 인용선으로 "당시 생각"과 분리(디자인/PRD §6.1) */}
      {entry.lesson && !editingLesson ? (
        <blockquote className="mt-4 border-l-2 border-accent pl-3 text-sm italic leading-relaxed text-muted">
          {entry.lesson}
          <button
            onClick={() => {
              setDraft(entry.lesson);
              setEditingLesson(true);
            }}
            className="ml-2 not-italic text-xs text-accent opacity-0 transition-opacity group-hover:opacity-100"
          >
            수정
          </button>
        </blockquote>
      ) : editingLesson ? (
        <div className="mt-4">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder="지나고 나서의 깨달음을 적어보세요."
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm italic outline-none focus:border-accent"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => setEditingLesson(false)}
              className="text-xs text-muted hover:text-ink"
            >
              취소
            </button>
            <button
              onClick={() => {
                onLesson(draft.trim());
                setEditingLesson(false);
              }}
              className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-surface"
            >
              복기 저장
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => {
            setDraft("");
            setEditingLesson(true);
          }}
          className="mt-4 text-xs text-accent opacity-0 transition-opacity group-hover:opacity-100"
        >
          + 복기 추가 — 지나고 나서의 깨달음
        </button>
      )}
    </li>
  );
}
