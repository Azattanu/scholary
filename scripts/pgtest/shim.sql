-- Минимальный шим Supabase для проверки миграции 042 на локальном Postgres.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.uid', true), '')::uuid $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; end $$;
create extension if not exists pgcrypto;
create table if not exists profiles (user_id uuid primary key references auth.users(id) on delete cascade, name text, whatsapp text, lead_ids text[] default '{}', answers jsonb, pro_until timestamptz, pro_plan text, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists portfolio_items (id bigint generated always as identity primary key, user_id uuid not null references auth.users(id) on delete cascade, program_id text not null, status text default 'study', note text, added_at timestamptz default now(), updated_at timestamptz default now(), submitted_at timestamptz, outcome text, readiness int default 0, checklist jsonb default '{}', unique (user_id, program_id));
create table if not exists user_documents (id bigint generated always as identity primary key, user_id uuid not null references auth.users(id) on delete cascade, doc_type text not null, title text, status text default 'none', file_path text, expires_on date, note text, updated_at timestamptz default now(), fields jsonb default '{}', program_ids text[] default '{}', verdicts jsonb default '[]', content text, score numeric, version int default 1, created_at timestamptz default now());
create table if not exists programs (id text primary key, name text, country text, cc text, levels text[], deadline_md text, deadline text, duplicate_of text, updated_at timestamptz default now());
create or replace view programs_public as select * from programs where duplicate_of is null;
grant select on programs_public to anon, authenticated;
insert into programs (id, name, cc, levels) values ('p-old', 'Old', 'de', '{bachelor}') on conflict do nothing;
create table if not exists probability_history (id bigint generated always as identity primary key, user_id uuid not null references auth.users(id) on delete cascade, p_adm numeric, p_sch numeric, ts timestamptz default now());
create table if not exists tg_links (user_id uuid primary key references auth.users(id) on delete cascade, chat_id text, code text, linked_at timestamptz, prefs jsonb not null default '{"step":true,"deadlines":true,"verdicts":true,"digest":true,"quiet":true}'::jsonb, created_at timestamptz default now());
create table if not exists tg_sent (id bigint generated always as identity primary key, user_id uuid not null, program_id text not null, milestone int not null, sent_at timestamptz default now(), unique (user_id, program_id, milestone));
create table if not exists app_secrets (name text primary key, value text);
create table if not exists events (id bigint generated always as identity primary key, lead_id text, event text, data jsonb, utm jsonb, ts timestamptz default now(), page text);
create table if not exists payments (id bigint generated always as identity primary key, txn text, lead_id text, user_email text, amount numeric, kind text, status text, test_mode boolean default false, created_at timestamptz default now());
create table if not exists admins (user_id uuid primary key, email text);
create or replace function is_admin() returns boolean language sql stable security definer as $$ select exists (select 1 from admins a where a.user_id = auth.uid()) $$;
create or replace function is_test_account(p_email text) returns boolean language sql immutable as $$ select p_email ilike '%@scholary-test.kz' or p_email ilike 'e2e.%' $$;
create or replace function next_deadline(p_md text) returns date language plpgsql immutable as $$
declare mm int; dd int; y int := extract(year from current_date)::int; d date;
begin
  if p_md is null or p_md !~ '^\d{2}-\d{2}$' then return null; end if;
  mm := split_part(p_md, '-', 1)::int; dd := split_part(p_md, '-', 2)::int;
  begin d := make_date(y, mm, dd); exception when others then return null; end;
  if d < current_date then begin d := make_date(y + 1, mm, dd); exception when others then return null; end; end if;
  return d;
end $$;
insert into app_secrets values ('tiptop_webhook', 'x1234567890123456789012345678901234567890') on conflict do nothing;
grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
grant usage on schema public to authenticated, anon; grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on programs to anon;
