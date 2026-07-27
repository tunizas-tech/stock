-- 네이버 뉴스 키워드 대시보드 전용 스키마 (Coolify PostgreSQL에 1회 적용).
create table if not exists news_keyword (
  id          serial primary key,
  keyword     text not null unique,
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists news_item (
  id            bigserial primary key,
  keyword_id    int not null references news_keyword(id) on delete cascade,
  title         text not null,
  link          text not null,
  original_link text,
  description   text,
  source        text,
  pub_date      timestamptz,
  fetched_at    timestamptz not null default now(),
  unique (keyword_id, link)
);

create index if not exists idx_news_item_kw_pub
  on news_item (keyword_id, pub_date desc);
