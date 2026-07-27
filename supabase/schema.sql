-- 주식 공부 노트 — Postgres 스키마 (선택)
-- lib/data.ts가 Supabase 환경변수를 감지하면 이 테이블들을 사용한다.
-- 컬럼명은 lib/types.ts의 도메인 타입과 일치(camelCase 컬럼은 따옴표 필수).

create table if not exists holdings (
  id        uuid primary key default gen_random_uuid(),
  market    text not null check (market in ('KR','US')),
  ticker    text not null,
  name      text not null,
  shares    numeric not null,
  "avgPrice" numeric not null,
  "openedAt" date not null
);

create table if not exists watchlist (
  id        uuid primary key default gen_random_uuid(),
  market    text not null check (market in ('KR','US')),
  ticker    text not null,
  name      text not null,
  memo      text not null default '',
  "addedAt" date not null
);

create table if not exists journal (
  id        uuid primary key default gen_random_uuid(),
  date      date not null,
  market    text not null check (market in ('KR','US')),
  ticker    text not null,
  name      text not null,
  action    text not null check (action in ('buy','sell','note')),
  price     numeric,
  qty       numeric,
  reason    text not null,
  emotion   smallint not null check (emotion between 1 and 5),
  lesson    text not null default ''
);

-- 예정: 시세 호출 절감 + 과거 종가 기반 복기(PRD §7, §8)
create table if not exists price_cache (
  ticker text not null,
  market text not null check (market in ('KR','US')),
  date   date not null,
  close  numeric not null,
  primary key (ticker, market, date)
);

-- ---------------------------------------------------------------------------
-- 멀티유저 전환 경로(디자인 §5.4): 각 테이블에 user_id 추가 후 RLS 적용.
--   alter table holdings add column user_id uuid references auth.users(id);
--   alter table holdings enable row level security;
--   create policy "own rows" on holdings
--     using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- watchlist / journal / price_cache 도 동일 패턴.
-- ---------------------------------------------------------------------------
