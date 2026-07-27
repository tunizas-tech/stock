// 저장소 파사드(디자인 §5.2-1). 페이지는 오직 db.* 만 호출한다.
// 환경변수(Supabase) 유무로 Postgres ↔ localStorage 자동 분기.
// - 설정 O: Supabase(Postgres)
// - 설정 X: 브라우저 localStorage (+ 최초 1회 시드 주입)

import { supabase } from "./supabase";
import { todayISO } from "./format";
import type { Holding, JournalEntry, WatchItem } from "./types";

const LS_KEYS = {
  holdings: "ssn.holdings",
  watchlist: "ssn.watchlist",
  journal: "ssn.journal",
  seeded: "ssn.seeded",
} as const;

// ---------------------------------------------------------------------------
// 시드 데이터 — 빈 화면 대신 곧바로 만져볼 거리를 준다(디자인 §6: 빈 상태 안내).
// ---------------------------------------------------------------------------

const SEED_HOLDINGS: Holding[] = [
  {
    id: "h1",
    market: "KR",
    ticker: "005930",
    name: "삼성전자",
    shares: 30,
    avgPrice: 71200,
    openedAt: "2025-11-04",
  },
  {
    id: "h2",
    market: "US",
    ticker: "AAPL",
    name: "Apple",
    shares: 12,
    avgPrice: 178.4,
    openedAt: "2025-09-18",
  },
];

const SEED_WATCH: WatchItem[] = [
  {
    id: "w1",
    market: "KR",
    ticker: "035420",
    name: "NAVER",
    memo: "광고 회복 + 커머스 마진. 20만원 아래로 오면 분할 진입.",
    addedAt: "2026-01-12",
  },
  {
    id: "w2",
    market: "US",
    ticker: "NVDA",
    name: "NVIDIA",
    memo: "데이터센터 수요는 강함. 다만 밸류 부담 — 실적 후 변동성 관찰.",
    addedAt: "2026-02-02",
  },
];

const SEED_JOURNAL: JournalEntry[] = [
  {
    id: "j1",
    date: "2025-11-04",
    market: "KR",
    ticker: "005930",
    name: "삼성전자",
    action: "buy",
    price: 71200,
    qty: 30,
    reason: "반도체 업황 바닥 통과 신호. HBM 모멘텀 본격화 전 분할 1차 매수.",
    emotion: 4,
    lesson:
      "확신은 높았지만 한 번에 다 안 사고 분할한 건 잘한 선택. 변동성 구간을 견딜 여유가 생겼다.",
  },
  {
    id: "j2",
    date: "2026-02-02",
    market: "US",
    ticker: "NVDA",
    name: "NVIDIA",
    action: "note",
    reason: "실적은 좋은데 주가 반응이 미지근. 기대가 이미 가격에 반영된 듯.",
    emotion: 2,
    lesson: "",
  },
];

// ---------------------------------------------------------------------------
// localStorage 구현
// ---------------------------------------------------------------------------

function lsRead<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function lsWrite<T>(key: string, rows: T[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(rows));
}

function ensureSeed(): void {
  if (typeof window === "undefined") return;
  if (window.localStorage.getItem(LS_KEYS.seeded)) return;
  lsWrite(LS_KEYS.holdings, SEED_HOLDINGS);
  lsWrite(LS_KEYS.watchlist, SEED_WATCH);
  lsWrite(LS_KEYS.journal, SEED_JOURNAL);
  window.localStorage.setItem(LS_KEYS.seeded, "1");
}

/** 브라우저에서만 호출되는 ID 생성기. */
function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// ---------------------------------------------------------------------------
// 데이터 파사드 — 모든 메서드는 async. 페이지는 이 객체만 바라본다.
// ---------------------------------------------------------------------------

export const db = {
  // ---- Holdings -----------------------------------------------------------
  async listHoldings(): Promise<Holding[]> {
    if (supabase) {
      const { data, error } = await supabase
        .from("holdings")
        .select("*")
        .order("openedAt", { ascending: false });
      if (error) throw error;
      return (data as Holding[]) ?? [];
    }
    ensureSeed();
    return lsRead<Holding>(LS_KEYS.holdings);
  },

  async addHolding(input: Omit<Holding, "id">): Promise<Holding> {
    if (supabase) {
      const { data, error } = await supabase
        .from("holdings")
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data as Holding;
    }
    const row: Holding = { ...input, id: newId() };
    const rows = lsRead<Holding>(LS_KEYS.holdings);
    lsWrite(LS_KEYS.holdings, [row, ...rows]);
    return row;
  },

  async removeHolding(id: string): Promise<void> {
    if (supabase) {
      const { error } = await supabase.from("holdings").delete().eq("id", id);
      if (error) throw error;
      return;
    }
    const rows = lsRead<Holding>(LS_KEYS.holdings).filter((r) => r.id !== id);
    lsWrite(LS_KEYS.holdings, rows);
  },

  // ---- Watchlist ----------------------------------------------------------
  async listWatch(): Promise<WatchItem[]> {
    if (supabase) {
      const { data, error } = await supabase
        .from("watchlist")
        .select("*")
        .order("addedAt", { ascending: false });
      if (error) throw error;
      return (data as WatchItem[]) ?? [];
    }
    ensureSeed();
    return lsRead<WatchItem>(LS_KEYS.watchlist);
  },

  async addWatch(input: Omit<WatchItem, "id">): Promise<WatchItem> {
    if (supabase) {
      const { data, error } = await supabase
        .from("watchlist")
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data as WatchItem;
    }
    const row: WatchItem = { ...input, id: newId() };
    const rows = lsRead<WatchItem>(LS_KEYS.watchlist);
    lsWrite(LS_KEYS.watchlist, [row, ...rows]);
    return row;
  },

  async removeWatch(id: string): Promise<void> {
    if (supabase) {
      const { error } = await supabase.from("watchlist").delete().eq("id", id);
      if (error) throw error;
      return;
    }
    const rows = lsRead<WatchItem>(LS_KEYS.watchlist).filter((r) => r.id !== id);
    lsWrite(LS_KEYS.watchlist, rows);
  },

  // ---- Journal ------------------------------------------------------------
  async listJournal(): Promise<JournalEntry[]> {
    if (supabase) {
      const { data, error } = await supabase
        .from("journal")
        .select("*")
        .order("date", { ascending: false });
      if (error) throw error;
      return (data as JournalEntry[]) ?? [];
    }
    ensureSeed();
    // 최신순 정렬(디자인 §4: 기록 카드 목록 최신순)
    return lsRead<JournalEntry>(LS_KEYS.journal).sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : 0
    );
  },

  async addJournal(input: Omit<JournalEntry, "id">): Promise<JournalEntry> {
    if (supabase) {
      const { data, error } = await supabase
        .from("journal")
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data as JournalEntry;
    }
    const row: JournalEntry = { ...input, id: newId() };
    const rows = lsRead<JournalEntry>(LS_KEYS.journal);
    lsWrite(LS_KEYS.journal, [row, ...rows]);
    return row;
  },

  /** 복기(lesson)만 나중에 채우는 경로. */
  async updateJournalLesson(id: string, lesson: string): Promise<void> {
    if (supabase) {
      const { error } = await supabase
        .from("journal")
        .update({ lesson })
        .eq("id", id);
      if (error) throw error;
      return;
    }
    const rows = lsRead<JournalEntry>(LS_KEYS.journal).map((r) =>
      r.id === id ? { ...r, lesson } : r
    );
    lsWrite(LS_KEYS.journal, rows);
  },

  async removeJournal(id: string): Promise<void> {
    if (supabase) {
      const { error } = await supabase.from("journal").delete().eq("id", id);
      if (error) throw error;
      return;
    }
    const rows = lsRead<JournalEntry>(LS_KEYS.journal).filter(
      (r) => r.id !== id
    );
    lsWrite(LS_KEYS.journal, rows);
  },
};

export { todayISO };
