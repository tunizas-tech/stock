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
// 날짜 기본값은 KST다(설계 §3.3) — 브라우저 시간대로 찍으면 해외에서 열었을 때
// 거래일이 하루 어긋난 채 저장된다.
import { todayKst } from "@/lib/kst";
import { DECLARED_PROB } from "@/lib/journal/review";
// 태그 목록은 validate.ts 한 곳에서만 관리한다 — 여기 손으로 베껴 두면 8번째
// "에이전트"를 넣었을 때처럼 한쪽만 늘어나 선택지가 조용히 어긋난다(M-5).
import { REASON_TAGS } from "@/lib/journal/validate";

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
  // 저장은 서버 모드에서 네트워크 호출이다(4단계 이후). 실패를 삼키면 사용자는
  // 저장 버튼을 누른 뒤 아무 일도 일어나지 않는 폼을 보게 된다 — 메시지를 띄우고
  // 초안은 그대로 열어 둔다(reset하지 않는다).
  const [saveError, setSaveError] = useState<string | null>(null);

  const [date, setDate] = useState(todayKst());
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
    setDate(todayKst());
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
      // 기록을 남긴 "지금" 시각. date(거래일)는 사용자가 과거로 바꿀 수 있지만
      // 이 값은 못 바꾼다 — 자기검증 봉인이 이걸 기준으로 시작한다(설계 §4 N2).
      createdAt: new Date().toISOString(),
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
          `/api/journal/snapshot?ticker=${encodeURIComponent(trimmedTicker)}&date=${encodeURIComponent(date)}`,
          // 스냅샷은 best-effort인데 타임아웃이 없으면 서버가 응답을 안 줄 때
          // "저장 중…" 버튼이 무한정 걸린 채로 남는다 — 사용자는 기록을 잃었다고
          // 생각하고 창을 닫는다. 5초면 포기하고 스냅샷 없이 저장한다.
          { signal: AbortSignal.timeout(5000) }
        );
        if (res.ok) {
          draft.snapshot = (await res.json()) as JournalSnapshot;
        }
      } catch {
        // 조용히 스냅샷 없이 진행한다.
      }
    }

    try {
      setSaveError(null);
      await onSubmit(draft);
      reset();
      setOpen(false);
    } catch (e) {
      // 초안을 그대로 둔다 — 사용자가 방금 쓴 이유를 다시 타이핑하게 만들지 않는다.
      setSaveError(e instanceof Error ? e.message : "저장하지 못했습니다");
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

      {saveError && (
        <p className="mt-3 text-right text-xs text-loss">
          저장하지 못했습니다 — {saveError}
        </p>
      )}
    </form>
  );
}
