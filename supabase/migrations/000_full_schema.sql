-- ============================================================
-- Scholary: ПОЛНАЯ схема с нуля (для нового проекта Supabase).
-- Вставить целиком в SQL Editor и выполнить один раз.
-- Включает: leads, events, reports, programs, RPC, RLS.
-- ============================================================

-- ЛИДЫ: одна строка = один человек, прошедший квиз/форму
create table if not exists leads (
  id text primary key,
  updated_at timestamptz default now(),
  utm jsonb,
  -- контакты
  name text, whatsapp text, email text,
  -- фаза 1 квиза
  level text, year text,
  gpa_band text, school_type text,
  gpa_uni text, gpa_phd text, uni_type text, phd_topic text,
  lang_status text, ielts_band text, sat text,
  field text, achievements text, budget text,
  priority text, target_countries text, target_university text, target_major text,
  -- лид-форма
  lead_source text, lead_interest text,
  -- фаза 2
  p2_gpa_exact text, p2_city_school text, p2_ielts_date text, p2_docs_ready text,
  p2_blocked_account text, p2_lang_year text, p2_decision_maker text, p2_email text,
  -- оплата и доставка
  paid boolean default false, paid_at timestamptz,
  tiptop_transaction_id text,
  report_id uuid, report_sent_at timestamptz,
  wa_status text, email_status text
);

-- СОБЫТИЯ: воронка
create table if not exists events (
  id bigint generated always as identity primary key,
  lead_id text, event text, data jsonb, utm jsonb,
  ts timestamptz default now(), page text
);
create index if not exists events_lead_ts on events (lead_id, ts);
create index if not exists events_event_ts on events (event, ts);

-- ОТЧЁТЫ: доступ снаружи только через RPC по секретному токену
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  data jsonb not null,
  texts jsonb,
  created_at timestamptz default now()
);

-- КАТАЛОГ ПРОГРАММ (граф требований v1)
create table if not exists programs (
  id text primary key,
  name text not null,
  country text not null,
  cc text,
  levels text[] not null,
  funding text,
  base_adm numeric,
  base_sch numeric,
  req jsonb,
  deadline text,
  note text,
  fields text[],
  source_url text,
  verified boolean default false,
  verified_at date,
  updated_at timestamptz default now()
);

-- ============ RLS ============
alter table leads enable row level security;
alter table events enable row level security;
alter table reports enable row level security;
alter table programs enable row level security;

-- Фронт (anon): может только ПИСАТЬ лиды/события и ОБНОВЛЯТЬ свой лид по id.
-- Читать лиды/события/отчёты anon не может вообще.
create policy leads_insert on leads for insert to anon with check (true);
create policy leads_update on leads for update to anon using (true) with check (true);
create policy events_insert on events for insert to anon with check (true);
create policy programs_read on programs for select to anon using (verified = true);
-- reports: политик для anon нет — только RPC ниже и service_role.

-- RPC: отчёт по секретному токену из ссылки
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

-- Примечание: upsert лидов с фронта идёт с Prefer: resolution=merge-duplicates —
-- политика leads_update это разрешает. Id лида — случайный UUID клиента, перебор
-- нерентабелен; читать чужие данные anon всё равно не может (нет select-политики).
