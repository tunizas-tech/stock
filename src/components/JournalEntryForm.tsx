"use client";

// 접힘/펼침 기록 입력 폼(디자인 §3). 마찰 최소화(PRD §3): 가격·수량은 선택 입력.
import { useState } from "react";
import type {
  Emotion,
  JournalAction,
  JournalEntry,
  Market,
} from "@/lib/types";
import { todayISO } from "@/lib/format";

type Draft = Omit<JournalEntry, "id">;

const inputClass =
  "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent";

export function JournalEntryForm({
  onSubmit,
}: {
  onSubmit: (entry: Omit<JournalEntry, "id">) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [date, setDate] = useState(todayISO());
  const [market, setMarket] = useState<Market>("KR");
  const [ticker, setTicker] = useState("");
  const [name, setName] = useState("");
  const [action, setAction] = useState<JournalAction>("buy");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [emotion, setEmotion] = useState<Emotion>(3);

  function reset() {
    setDate(todayISO());
    setMarket("KR");
    setTicker("");
    setName("");
    setAction("buy");
    setPrice("");
    setQty("");
    setReason("");
    setEmotion(3);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim() || !reason.trim()) return;
    setBusy(true);
    const draft: Draft = {
      date,
      market,
      ticker: ticker.trim().toUpperCase(),
      name: name.trim() || ticker.trim().toUpperCase(),
      action,
      reason: reason.trim(),
      emotion,
      lesson: "",
      ...(price.trim() ? { price: Number(price) } : {}),
      ...(qty.trim() ? { qty: Number(qty) } : {}),
    };
    try {
      await onSubmit(draft);
      reset();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-xl2 border border-dashed border-line bg-surface/60 px-5 py-4 text-left text-sm text-muted transition-colors hover:border-accent hover:text-ink"
      >
        + 새 기록 — 매수·매도·메모 무엇이든
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl2 border border-line bg-surface p-5 shadow-sm"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="text-xs text-muted">
          날짜
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={`tabular mt-1 ${inputClass}`}
          />
        </label>
        <label className="text-xs text-muted">
          시장
          <select
            value={market}
            onChange={(e) => setMarket(e.target.value as Market)}
            className={`mt-1 ${inputClass}`}
          >
            <option value="KR">KR 한국</option>
            <option value="US">US 미국</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          종목코드 / 티커 *
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder="005930 / AAPL"
            className={`tabular mt-1 ${inputClass}`}
          />
        </label>
        <label className="text-xs text-muted">
          종목명
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="삼성전자"
            className={`mt-1 ${inputClass}`}
          />
        </label>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <label className="text-xs text-muted">
          구분
          <select
            value={action}
            onChange={(e) => setAction(e.target.value as JournalAction)}
            className={`mt-1 ${inputClass}`}
          >
            <option value="buy">매수</option>
            <option value="sell">매도</option>
            <option value="note">메모</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          가격 (선택)
          <input
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="71200"
            className={`tabular mt-1 ${inputClass}`}
          />
        </label>
        <label className="text-xs text-muted">
          수량 (선택)
          <input
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="30"
            className={`tabular mt-1 ${inputClass}`}
          />
        </label>
      </div>

      <label className="mt-3 block text-xs text-muted">
        이유 *
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="왜 이 결정을 했는지, 당시 어떤 심리였는지."
          className={`mt-1 resize-y ${inputClass}`}
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted">
          당시 확신도
          <div className="flex items-center gap-1">
            {([1, 2, 3, 4, 5] as Emotion[]).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setEmotion(n)}
                aria-label={`확신도 ${n}`}
                className={`h-3.5 w-3.5 rounded-full transition-colors ${
                  n <= emotion ? "bg-accent" : "bg-line hover:bg-accent/40"
                }`}
              />
            ))}
            <span className="tabular ml-1">{emotion}/5</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              reset();
              setOpen(false);
            }}
            className="rounded-lg px-3 py-1.5 text-sm text-muted hover:text-ink"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={busy || !ticker.trim() || !reason.trim()}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-surface disabled:opacity-40"
          >
            {busy ? "저장 중…" : "기록"}
          </button>
        </div>
      </div>
    </form>
  );
}
