-- 보유종목·관심종목 (8단계). Coolify PostgreSQL에 1회 적용 — 뉴스·일지 스키마와 같은 DB.
-- 컬럼명은 src/lib/types.ts Holding / WatchItem 필드명과 같다(camelCase는 따옴표).
create table if not exists holdings (
  id         text primary key,
  market     text not null check (market in ('KR','US')),
  ticker     text not null,
  name       text not null,
  shares     double precision not null check (shares > 0),
  "avgPrice" double precision not null check ("avgPrice" >= 0),
  "openedAt" text not null,                         -- YYYY-MM-DD
  sector     text                                   -- 사용자가 고른 산업(관측소 12섹터 또는 '기타'). NULL = 유니버스 자동 판정
);
create index if not exists holdings_opened_idx on holdings ("openedAt" desc);
-- 9단계(섹터 분류)에서 추가. 8단계로 이미 만든 테이블에도 같은 파일을 다시 돌리면 붙는다(멱등).
alter table holdings add column if not exists sector text;

create table if not exists watchlist (
  id        text primary key,
  market    text not null check (market in ('KR','US')),
  ticker    text not null,
  name      text not null,
  memo      text not null default '',
  "addedAt" text not null                           -- YYYY-MM-DD
);
create index if not exists watchlist_added_idx on watchlist ("addedAt" desc);
