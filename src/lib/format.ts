// 통화·퍼센트·날짜·손익 색상 포맷 단일 출처.
// 규칙(디자인 §6): 손익은 색 + 부호(+/−) + 라벨 병행 — 색만으로 의미 전달 금지.

import type { Market } from "./types";

export type Currency = "KRW" | "USD";

export function currencyOf(market: Market): Currency {
  return market === "KR" ? "KRW" : "USD";
}

/** 통화 표기. KRW는 정수 원, USD는 소수 2자리 달러. */
export function fmtMoney(amount: number, currency: Currency): string {
  if (currency === "KRW") {
    return `₩${Math.round(amount).toLocaleString("ko-KR")}`;
  }
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** 부호를 항상 붙인 퍼센트. (+1.2% / −0.8% / 0.0%) */
export function fmtPct(pct: number): string {
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

/** 부호를 항상 붙인 통화. 손익 표기용. */
export function fmtSignedMoney(amount: number, currency: Currency): string {
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${sign}${fmtMoney(Math.abs(amount), currency)}`;
}

/** 손익 부호에 따른 색상 클래스. 0이면 보조색. */
export function pnlClass(value: number): string {
  if (value > 0) return "text-gain";
  if (value < 0) return "text-loss";
  return "text-muted";
}

/**
 * 시가총액 표기 — 시장 관용 단위(types.ts Fundamentals 참고).
 * KR: 억 원 단위 값 → 1조(10,000억) 이상은 "N.N조", 미만은 "N,NNN억".
 * US: 백만 달러 단위 값 → $1B(1,000M) 이상은 "$N,NNN.NB", 미만은 "$NNNM".
 */
export function fmtMarketCap(
  value: number | undefined,
  market: Market
): string {
  if (value === undefined) return "—";
  if (market === "KR") {
    return value >= 10000
      ? `${(value / 10000).toLocaleString("ko-KR", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })}조`
      : `${Math.round(value).toLocaleString("ko-KR")}억`;
  }
  return value >= 1000
    ? `$${(value / 1000).toLocaleString("en-US", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })}B`
    : `$${Math.round(value).toLocaleString("en-US")}M`;
}

/** YYYY-MM-DD → "2026년 5월 31일" */
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${y}년 ${m}월 ${d}일`;
}

/** 오늘 날짜 YYYY-MM-DD (로컬). */
export function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** ISO 시각 → "방금 전 / N분 전 / N시간 전 / N일 전". 파싱 불가면 "". */
export function fmtRelative(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diffMin = Math.max(0, Math.floor((now.getTime() - t) / 60000));
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}시간 전`;
  return `${Math.floor(diffHr / 24)}일 전`;
}
