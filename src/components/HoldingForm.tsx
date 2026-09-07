"use client";

// 보유 종목 추가 폼(8단계 Task 5, 컨트롤러 판단 R2). 지금까지 /portfolio는
// db.addHolding을 호출하는 화면이 없었다 — 보유 종목은 오직 localStorage
// 시드로만 존재했다. 서버 전환 후에도 사용자가 보유 종목을 못 넣으면 이관
// 자체가 의미 없어지므로, 일지 입력 폼(JournalEntryForm)과 같은 접힘/펼침
// 형태·테두리·입력 스타일로 최소 폼을 둔다.
//
// 실패 표시는 이 폼 안이 아니라 /portfolio 페이지의 공용 에러 줄에서 한다
// (onSubmit이 던지면 이 폼은 초안을 지우지 않고 그대로 열어 둔다) — 로딩·삭제
// 실패와 같은 자리에서 보여줘야 "뭔가 실패했다"는 신호가 화면 여기저기 흩어지지
// 않는다.
import { useState } from "react";
import type { Holding, Market } from "@/lib/types";
import { todayKst } from "@/lib/kst";

type Draft = Omit<Holding, "id">;

const inputClass =
  "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent";

export function HoldingForm({
  onSubmit,
}: {
  onSubmit: (draft: Draft) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [market, setMarket] = useState<Market>("KR");
  const [ticker, setTicker] = useState("");
  const [name, setName] = useState("");
  const [shares, setShares] = useState("");
  const [avgPrice, setAvgPrice] = useState("");
  const [openedAt, setOpenedAt] = useState(todayKst());

  // 클라이언트 확인은 "숫자 형태를 갖췄나"만 본다 — 진짜 검증(양수·범위 등)은
  // 서버(portfolio-repo)가 한다. 여기서 서버 규칙을 베끼면 규칙이 두 곳에서
  // 따로 늙는다.
  const sharesNum = Number(shares);
  const avgPriceNum = Number(avgPrice);
  const valid =
    ticker.trim().length > 0 &&
    shares.trim().length > 0 &&
    !Number.isNaN(sharesNum) &&
    sharesNum > 0 &&
    avgPrice.trim().length > 0 &&
    !Number.isNaN(avgPriceNum) &&
    avgPriceNum >= 0 &&
    openedAt.trim().length > 0;

  function reset() {
    setMarket("KR");
    setTicker("");
    setName("");
    setShares("");
    setAvgPrice("");
    setOpenedAt(todayKst());
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);

    const trimmedTicker = ticker.trim().toUpperCase();
    const draft: Draft = {
      market,
      ticker: trimmedTicker,
      name: name.trim() || trimmedTicker,
      shares: sharesNum,
      avgPrice: avgPriceNum,
      openedAt,
    };

    try {
      await onSubmit(draft);
      // 성공했을 때만 초안을 지우고 접는다 — 실패 시엔 페이지 상단 에러 줄이
      // 뜨고, 사용자는 방금 입력을 다시 타이핑하지 않아도 된다.
      reset();
      setOpen(false);
    } catch {
      // 에러 문구는 페이지(useState error)가 보여준다. 여기선 초안만 지킨다.
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
        + 보유종목 추가
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl2 border border-line bg-surface p-5 shadow-sm"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
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
        <label className="text-xs text-muted">
          수량 *
          <input
            inputMode="decimal"
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            placeholder="30"
            className={`tabular mt-1 ${inputClass}`}
          />
        </label>
        <label className="text-xs text-muted">
          평단가 *
          <input
            inputMode="decimal"
            value={avgPrice}
            onChange={(e) => setAvgPrice(e.target.value)}
            placeholder="71200"
            className={`tabular mt-1 ${inputClass}`}
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <label className="text-xs text-muted">
          매수일
          <input
            type="date"
            value={openedAt}
            onChange={(e) => setOpenedAt(e.target.value)}
            className={`tabular mt-1 ${inputClass}`}
          />
        </label>

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
            disabled={busy || !valid}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-surface disabled:opacity-40"
          >
            {busy ? "추가 중…" : "추가"}
          </button>
        </div>
      </div>
    </form>
  );
}
