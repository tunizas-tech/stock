-- 보유종목·관심종목 (8단계). Coolify PostgreSQL에 1회 적용 — 뉴스·일지 스키마와 같은 DB.
-- 컬럼명은 src/lib/types.ts Holding / WatchItem 필드명과 같다(camelCase는 따옴표).
create table if not exists holdings (
  id         text primary key,
  market     text not null check (market in ('KR','US')),
  ticker     text not null,
  name       text not null,
  shares     double precision not null check (shares > 0),
  "avgPrice" double precision not null check ("avgPrice" >= 0),
  "openedAt" text not null                          -- YYYY-MM-DD
);
create index if not exists holdings_opened_idx on holdings ("openedAt" desc);

create table if not exists watchlist (
  id        text primary key,
  market    text not null check (market in ('KR','US')),
  ticker    text not null,
  name      text not null,
  memo      text not null default '',
  "addedAt" text not null                           -- YYYY-MM-DD
);
create index if not exists watchlist_added_idx on watchlist ("addedAt" desc);
