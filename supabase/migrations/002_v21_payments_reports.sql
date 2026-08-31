-- ============================================================
-- Scholary v21: оплаты, отчёты, новые поля квиза
-- Применять в SQL Editor Supabase (или supabase db push)
-- ============================================================

-- Лиды: поля квиза 3.0 и статусы доставки
alter table if exists leads
  add column if not exists gpa_uni text,
  add column if not exists gpa_phd text,
  add column if not exists uni_type text,
  add column if not exists phd_topic text,
  add column if not exists sat text,
  add column if not exists target_countries text,
  add column if not exists target_university text,
  add column if not exists target_major text,
  add column if not exists lead_source text,
  add column if not exists lead_interest text,
  add column if not exists tiptop_transaction_id text,
  add column if not exists report_id uuid,
  add column if not exists report_sent_at timestamptz,
  add column if not exists wa_status text,
  add column if not exists email_status text;

-- Отчёты: один сгенерированный отчёт = одна строка.
-- Доступ снаружи ТОЛЬКО через RPC get_report(token) — прямой select для anon закрыт.
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  data jsonb not null,           -- выход ScholaryEngine.evaluate()
  texts jsonb,                   -- тексты от Claude API (verdict, point_b, comments...)
  created_at timestamptz default now()
);
alter table reports enable row level security;
-- Никаких политик для anon: таблица недоступна напрямую. Сервисный ключ RLS обходит.

-- RPC: отдать отчёт по секретному токену из ссылки
create or replace function get_report(p_token text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object('data', data, 'texts', texts, 'created_at', created_at)
  from reports where token = p_token limit 1;
$$;
revoke all on function get_report(text) from public;
grant execute on function get_report(text) to anon;

-- Каталог программ (граф требований, v1): заполняется Диасом из
-- data/programs-expansion.json после проверки; движок читает его при генерации.
create table if not exists programs (
  id text primary key,
  name text not null,
  country text not null,
  cc text,
  levels text[] not null,
  funding text,
  base_adm numeric,      -- базовая вероятность поступления (0..1)
  base_sch numeric,      -- базовая вероятность стипендии (null = стипендии нет)
  req jsonb,             -- {"academics":6,"language":5,"budget":0,"sat":7}
  deadline text,
  note text,
  fields text[],         -- ограничение по направлениям (null = все)
  source_url text,
  verified boolean default false,
  verified_at date,
  updated_at timestamptz default now()
);
alter table programs enable row level security;
create policy programs_read on programs for select to anon using (verified = true);

-- События: индекс для воронки
create index if not exists events_lead_ts on events (lead_id, ts);
create index if not exists events_event_ts on events (event, ts);
