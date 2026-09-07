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

-- 7단계부터 매매일지는 `db/journal-schema.sql`(Coolify Postgres)로 이동.
-- 아래 journal 정의는 Supabase를 계속 쓰는 보유·관심종목과 무관하며
-- 참고용으로만 남긴다.
create table if not exists journal (
  id        uuid primary key default gen_random_uuid(),
  date      date not null,
  market    text not null check (market in ('KR','US')),
  ticker    text not null,
  name      text not null,
  action    text not null check (action in ('buy','sell','note','skip')),
  price     numeric,
  qty       numeric,
  reason    text not null,
  emotion   smallint not null check (emotion between 1 and 5),
  lesson    text not null default ''
);

-- 6단계 자기검증(2026-09-07-journal-review-design.md §1) — 추가 컬럼 3개는 전부
-- nullable이라 기존 행은 영향받지 않는다(전부 NULL로 남고 분석에서 "태그
-- 없음"/"스냅샷 없음" 그룹이 된다). `if not exists`로 이미 컬럼이 있는 배포에도
-- 안전하게 재실행할 수 있다.
-- 컬럼명은 lib/data.ts의 db.addJournal이 TS 객체를 그대로 supabase.insert()에
-- 넘기고 별도 필드 매핑을 하지 않으므로, 파일 상단 규약대로 타입 필드명과
-- 정확히 같아야 한다(camelCase는 따옴표: "primaryTag". tags/snapshot은
-- 원래 소문자 한 단어라 date/reason/lesson처럼 따옴표가 필요 없다).
alter table journal add column if not exists "primaryTag" text;
alter table journal add column if not exists tags text[];
alter table journal add column if not exists snapshot jsonb;

-- 기록을 남긴 시각(§4 N2 봉인의 기준일). date(거래일)와 다르다 — 폼이 저장
-- 순간에 찍어 넣으므로 과거로 되돌릴 수 없고, 그래서 백필로 봉인을 못 연다.
-- 이 컬럼이 생기기 전의 행은 NULL로 남고 분석은 "봉인 시작 안 함"으로 다룬다.
alter table journal add column if not exists "createdAt" timestamptz;

-- action 체크 제약에 'skip'을 추가하는 것은 위 create table 문의 in (...) 목록을
-- 새 배포에서만 적용한다 — 이미 테이블이 있는 배포는 create table if not exists가
-- 아무것도 바꾸지 않으므로, 기존 제약을 지우고 'skip'을 포함해 다시 만들어야
-- 한다. 제약 이름은 Postgres가 자동 생성한 "journal_action_check"를 가정한다
-- (이 파일로 처음 만든 테이블이면 기본값이 이 이름이다 — 수동으로 이름을 바꿨다면
-- 그 이름으로 바꿔서 실행할 것).
alter table journal drop constraint if exists journal_action_check;
alter table journal add constraint journal_action_check check (action in ('buy','sell','note','skip'));

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
