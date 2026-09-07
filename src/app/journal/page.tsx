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
import { splitImportResult } from "@/lib/journal-import";
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
  // 에이전트 기록 숨기기(8단계) — 사람 매매일지를 훑을 때 에이전트 관망이 섞여
  // 보이지 않게 한다. localStorage에만 두는 순수 화면 설정이라 서버 값과 무관하다.
  const [hideAgent, setHideAgent] = useState(false);
  // 서버 모드에선 목록 읽기가 네트워크 호출이다 — 실패를 삼키면 setLoading(false)가
  // 영원히 안 돌아 "불러오는 중…"에 갇힌다(스키마 미적용 배포에서 실제로 그렇다).
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setEntries(await db.listJournal());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    try {
      setHideAgent(localStorage.getItem("ssn.journal.hideAgent") === "1");
    } catch {
      /* 비공개 창 등 — 기본값(안 숨김) 유지 */
    }
  }, []);

  function toggleHideAgent() {
    const next = !hideAgent;
    setHideAgent(next);
    try {
      localStorage.setItem("ssn.journal.hideAgent", next ? "1" : "0");
    } catch {
      /* 무시 — 이번 방문에서만 토글이 적용된다 */
    }
  }

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
      // 서버가 받지 않은 행(rejected)까지 지우면 그 기록은 어디에도 남지 않는다 —
      // 무엇을 남길지는 순수 함수에 두고 테스트로 못 박는다(journal-import.ts).
      const { keep, message } = splitImportResult(localLeft, r);
      if (keep.length === 0) db.clearLocalJournal();
      else db.replaceLocalJournal(keep);
      setLocalLeft(keep);
      setImportMsg(message);
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

  // 에이전트 기록이 하나도 없으면 토글 자체를 숨긴다 — 켜봐야 할 일이 없는
  // 스위치를 항상 보여주면 "이게 뭐지"라는 질문만 남긴다.
  const agentCount = entries.filter((e) => e.author === "agent").length;
  const visible = hideAgent ? entries.filter((e) => e.author !== "agent") : entries;

  return (
    <div>
      <PageHeader kicker="journal" title="매매일지">
        <Link href="/journal/review" className="text-sm text-accent hover:underline">
          자기검증 →
        </Link>
        {agentCount > 0 && (
          <button onClick={toggleHideAgent} className="ml-4 text-xs text-muted hover:text-ink">
            {hideAgent ? `에이전트 기록 보이기 (${agentCount})` : `에이전트 기록 숨기기 (${agentCount})`}
          </button>
        )}
      </PageHeader>

      {mode === "server" && localLeft.length > 0 && (
        <div className="mb-6 rounded-xl2 border border-accent/40 bg-surface p-4 text-sm">
          <p className="text-ink">
            이 브라우저에 남아 있는 기록 <b>{localLeft.length}건</b>이 서버에 없습니다.
          </p>
          <p className="mt-1 text-xs text-muted">
            올라간 기록만 이 브라우저에서 지웁니다. 같은 기록은 두 번 들어가지 않습니다.
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
      ) : error ? (
        <p className="text-sm text-muted">
          서버에서 기록을 불러오지 못했습니다 — DATABASE_URL·db/journal-schema.sql을 확인하세요. ({error})
        </p>
      ) : visible.length === 0 ? (
        // M-4: 에이전트 기록만 있는 상태에서 숨기기를 켜면 entries는 비지 않지만
        // 화면에는 아무것도 없다 — 빈 <ul>만 남기지 말고 토글을 짚어준다.
        <EmptyState
          title="아직 기록이 없습니다"
          hint={
            hideAgent && agentCount > 0
              ? `에이전트 기록 ${agentCount}건은 숨겨져 있습니다. 위 "에이전트 기록 보이기"를 누르면 다시 나옵니다.`
              : "첫 결정을 남겨보세요. 가격·수량 없이 메모만으로도 충분합니다."
          }
        />
      ) : (
        <ul className="space-y-4">
          {visible.map((e) => (
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
          <span className="text-sm text-muted">
            {entry.name}
            {/* 섹터는 에이전트 기록에만 있다(수급 유니버스 밖 종목의 스냅샷 계산용) —
                사람 기록에선 항상 undefined라 이 span은 자동으로 안 보인다. */}
            {entry.sector && <span className="text-xs"> · {entry.sector}</span>}
          </span>
          <span
            className={`tabular rounded-md border px-1.5 py-0.5 text-xs ${ACTION_STYLE[entry.action]}`}
          >
            {ACTION_LABEL[entry.action]}
          </span>
          {entry.author === "agent" && (
            <span className="inline-flex items-center rounded-md border border-accent/50 px-1.5 py-0.5 text-xs font-medium text-accent">
              에이전트
            </span>
          )}
          {/* 에이전트 기록의 primaryTag는 항상 "에이전트"라 위 칩과 글자까지 같다 —
              같은 말을 두 번 붙이지 않는다. 사람 기록은 그대로 주 이유를 보여준다. */}
          {entry.author !== "agent" && entry.primaryTag && (
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
