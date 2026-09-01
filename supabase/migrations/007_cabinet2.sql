-- ============================================================
-- Scholary · Кабинет 2.0
-- Подачи (готовность, отправка, исход), документы 2.0 (поля,
-- связи с подачами, вердикты, письма и версии), история
-- вероятности, привязка Telegram. Всё под RLS auth.uid().
-- Идемпотентно: можно накатывать повторно.
-- ============================================================

-- ---------- ПОДАЧИ (расширение portfolio_items) ----------
alter table portfolio_items add column if not exists readiness    int         not null default 0;
alter table portfolio_items add column if not exists submitted_at timestamptz;
alter table portfolio_items add column if not exists outcome      text;          -- admit | reject | waitlist
alter table portfolio_items add column if not exists outcome_at   timestamptz;
alter table portfolio_items add column if not exists checklist    jsonb       not null default '{}'::jsonb;  -- {doc_type: true}
alter table portfolio_items add column if not exists custom       jsonb;         -- своя программа вне каталога
alter table portfolio_items add column if not exists updated_at   timestamptz not null default now();

-- ---------- ДОКУМЕНТЫ 2.0 ----------
alter table user_documents add column if not exists fields      jsonb   not null default '{}'::jsonb;   -- распознанные/введённые поля
alter table user_documents add column if not exists program_ids text[]  not null default '{}';          -- к каким подачам относится
alter table user_documents add column if not exists verdicts    jsonb   not null default '[]'::jsonb;   -- результат проверки
alter table user_documents add column if not exists checked_at  timestamptz;
alter table user_documents add column if not exists content     text;                                    -- текст письма (мотивационное)
alter table user_documents add column if not exists score       numeric;                                 -- оценка письма 0–10
alter table user_documents add column if not exists version     int     not null default 1;
alter table user_documents add column if not exists created_at  timestamptz not null default now();

-- один тип документа может существовать в нескольких экземплярах (письмо под каждую программу),
-- поэтому уникальности по (user_id, doc_type) нет — связь задаётся program_ids.
create index if not exists user_documents_user_idx on user_documents (user_id);
create index if not exists portfolio_items_user_idx on portfolio_items (user_id);

-- ---------- ИСТОРИЯ ВЕРОЯТНОСТИ ----------
create table if not exists probability_history (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ts      timestamptz not null default now(),
  p_adm   numeric,
  p_sch   numeric,
  reason  text
);
create index if not exists probability_history_user_idx on probability_history (user_id, ts);

alter table probability_history enable row level security;
drop policy if exists prob_hist_own on probability_history;
create policy prob_hist_own on probability_history for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- ПРИВЯЗКА TELEGRAM ----------
create table if not exists tg_links (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  chat_id    text,
  code       text unique,
  linked_at  timestamptz,
  prefs      jsonb not null default '{"step":true,"deadlines":true,"verdicts":true,"digest":true,"quiet":true}'::jsonb,
  created_at timestamptz not null default now()
);
alter table tg_links enable row level security;
drop policy if exists tg_links_own on tg_links;
create policy tg_links_own on tg_links for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- ТРЕБУЕМЫЕ ДОКУМЕНТЫ У ПРОГРАММ ----------
-- Необязательное поле: если у программы список заполнен, клиент берёт его,
-- иначе выводит список по правилам (страна/уровень/финансирование).
alter table programs add column if not exists docs text[];

-- ---------- ПРОВЕРКА ----------
select
  (select count(*) from information_schema.columns
     where table_name='portfolio_items' and column_name in ('readiness','submitted_at','outcome','checklist','custom')) as portfolio_new_cols,
  (select count(*) from information_schema.columns
     where table_name='user_documents' and column_name in ('fields','program_ids','verdicts','content','score','version')) as documents_new_cols,
  (select count(*) from information_schema.tables where table_name='probability_history') as has_prob_hist,
  (select count(*) from information_schema.tables where table_name='tg_links') as has_tg_links,
  (select count(*) from programs) as programs_total;
