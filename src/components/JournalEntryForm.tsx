"use client";

// 접힘/펼침 기록 입력 폼(디자인 §3). 마찰 최소화(PRD §3): 가격·수량은 선택 입력.
//
// 6단계 자기검증 설계(§1 데이터 모델, I1·I2, N3) 이후 추가된 것:
// - action에 skip("관망 — 검토했으나 안 삼")이 생겼다. skip에도 매수와 같은
//   자격(주 이유 필수, 스냅샷 첨부)을 준다 — 안 산 거래가 없으면 판단력 자체를
//   잴 표본이 없어서다(N3).
// - 주 이유(primaryTag)는 buy·skip에서 하나 필수다(I2) — 태그를 다 찍으면
//   "이 이유로 산 거래가 나았나"를 물을 수 없어진다.
// - 확신도(emotion)를 "이 거래가 수익으로 끝날 확률"로 명시한다(I1) — 정의
//   없는 확신도는 보정 곡선을 못 그린다.
import { useState } from "react";
import type {
  Emotion,
  JournalAction,
  JournalEntry,
  JournalSnapshot,
  Market,
  ReasonTag,
} from "@/lib/types";
import { todayISO } from "@/lib/format";
import { DECLARED_PROB } from "@/lib/journal/review";

type Draft = Omit<JournalEntry, "id">;

const inputClass =
  "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent";

// ReasonTag(7종 고정, types.ts) — review.ts는 이 목록을 내부 전용으로만 쓰고
// export하지 않는다(주 이유별 묶음 계산에만 쓰면 되기 때문). 화면에 필요한
// 선택지는 같은 타입에서 여기 따로 든다.
const REASON_TAGS: ReasonTag[] = ["수급", "지표", "섹터강세", "미국장", "뉴스", "밸류체인", "직관"];

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
  const [primaryTag, setPrimaryTag] = useState<ReasonTag | "">("");
  const [tags, setTags] = useState<ReasonTag[]>([]);
  const [showSecondaryTags, setShowSecondaryTags] = useState(false);

  // 주 이유는 매수·관망에서만 의미가 있다(설계 §1) — 매도·메모는 그 순간의
  // "왜 샀나"가 아니라 다른 서사라 강제하지 않는다.
  const needsPrimaryTag = action === "buy" || action === "skip";

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
    setPrimaryTag("");
    setTags([]);
    setShowSecondaryTags(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim() || !reason.trim()) return;
    if (needsPrimaryTag && !primaryTag) return;
    setBusy(true);

    const trimmedTicker = ticker.trim().toUpperCase();
    const draft: Draft = {
      date,
      market,
      ticker: trimmedTicker,
      name: name.trim() || trimmedTicker,
      action,
      reason: reason.trim(),
      emotion,
      lesson: "",
      ...(price.trim() ? { price: Number(price) } : {}),
      ...(qty.trim() ? { qty: Number(qty) } : {}),
      ...(needsPrimaryTag && primaryTag
        ? { primaryTag, ...(tags.length > 0 ? { tags } : {}) }
        : {}),
    };

    // 매수·관망 저장 직전에 매매 시점 스냅샷을 붙인다(설계 §2). 실패해도(네트워크
    // 오류·비 200 응답) 저장 자체를 막지 않는다 — 스냅샷 없이 그대로 저장한다.
    // 여기서 에러를 보여주지 않는 것도 같은 원칙이다: 스냅샷은 best-effort이지
    // 사용자가 신경 써야 할 실패가 아니다(설계 §1).
    if (action === "buy" || action === "skip") {
      try {
        const res = await fetch(
          `/api/journal/snapshot?ticker=${encodeURIComponent(trimmedTicker)}&date=${encodeURIComponent(date)}`
        );
        if (res.ok) {
          draft.snapshot = (await res.json()) as JournalSnapshot;
        }
      } catch {
        // 조용히 스냅샷 없이 진행한다.
      }
    }

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
            <option value="skip">관망 (검토했으나 안 삼)</option>
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

      {needsPrimaryTag && (
        <div className="mt-3">
          <label className="text-xs text-muted">
            주 이유 *
            <select
              value={primaryTag}
              onChange={(e) => {
                const v = e.target.value as ReasonTag | "";
                setPrimaryTag(v);
                // 보조로 골라둔 값이 새 주 이유와 겹치면 빼준다 — 같은 태그가
                // 주·보조에 동시에 있으면 "주 이유로 집계"라는 규칙이 흐려진다.
                setTags((prev) => prev.filter((t) => t !== v));
              }}
              className={`mt-1 ${inputClass} sm:w-64`}
            >
              <option value="">선택하세요</option>
              {REASON_TAGS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => setShowSecondaryTags((s) => !s)}
            className="mt-2 text-xs text-accent"
          >
            {showSecondaryTags ? "− 보조 이유 접기" : "+ 보조 이유 추가"}
          </button>
          {showSecondaryTags && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 rounded-lg border border-line bg-bg p-3">
              {REASON_TAGS.filter((t) => t !== primaryTag).map((t) => (
                <label key={t} className="flex items-center gap-1.5 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={tags.includes(t)}
                    onChange={(e) =>
                      setTags((prev) =>
                        e.target.checked ? [...prev, t] : prev.filter((x) => x !== t)
                      )
                    }
                  />
                  {t}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

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

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
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
              <span className="tabular ml-1">
                {emotion}/5 · {DECLARED_PROB[emotion] * 100}%
              </span>
            </div>
          </div>
          <p className="mt-1 text-[11px] text-muted">이 거래가 수익으로 끝날 확률</p>
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
            disabled={busy || !ticker.trim() || !reason.trim() || (needsPrimaryTag && !primaryTag)}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-surface disabled:opacity-40"
          >
            {busy ? "저장 중…" : "기록"}
          </button>
        </div>
      </div>
    </form>
  );
}
