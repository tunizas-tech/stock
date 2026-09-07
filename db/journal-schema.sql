-- 매매일지 스키마 (7단계). Coolify PostgreSQL에 1회 적용 — 뉴스 스키마(news-schema.sql)와 같은 DB.
-- 컬럼명은 src/lib/types.ts JournalEntry 필드명과 같다(camelCase는 따옴표).
-- 행 <-> JournalEntry 변환은 src/lib/server/journal-repo.ts 한 곳에서만 한다.
create table if not exists journal (
  id           text primary key,
  date         text not null,                                   -- YYYY-MM-DD (거래일)
  market       text not null check (market in ('KR','US')),
  ticker       text not null,
  name         text not null,
  action       text not null check (action in ('buy','sell','note','skip')),
  price        double precision,
  qty          double precision,
  reason       text not null default '',
  emotion      int  not null check (emotion between 1 and 5),
  lesson       text not null default '',
  "primaryTag" text,
  tags         text[],
  snapshot     jsonb,
  "createdAt"  timestamptz,
  author       text check (author in ('user','agent')),
  sector       text
);
create index if not exists journal_date_idx on journal (date desc);
-- 에이전트 하루 상한(3건)·같은 날 같은 종목 중복 판정용
create index if not exists journal_agent_day_idx on journal (date, ticker) where author = 'agent';
