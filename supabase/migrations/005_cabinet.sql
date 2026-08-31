-- ============================================================
-- Scholary: личный кабинет (auth-пользователи).
-- profiles, portfolio_items, user_documents, claim_lead, my_reports,
-- storage-бакет docs. Все данные закрыты RLS по auth.uid().
-- ============================================================

-- ПРОФИЛЬ: 1 строка на пользователя
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text,
  whatsapp text,
  lead_ids text[] not null default '{}',
  answers jsonb,                -- редактируемая анкета (из квиза + правки)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ПОРТФЕЛЬ ПРОГРАММ
create table if not exists portfolio_items (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  program_id text not null,
  status text not null default 'study',   -- study | prep | applied | admit | reject
  note text,
  added_at timestamptz default now(),
  unique (user_id, program_id)
);

-- ДОКУМЕНТЫ (метаданные; файлы в Storage 'docs/{uid}/...')
create table if not exists user_documents (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  doc_type text not null,       -- diploma | apostille | ielts | motivation | recommendation | passport | other
  title text,
  status text not null default 'none',    -- none | progress | ready
  file_path text,
  expires_on date,
  note text,
  updated_at timestamptz default now()
);

-- ============ RLS ============
alter table profiles enable row level security;
alter table portfolio_items enable row level security;
alter table user_documents enable row level security;

drop policy if exists profiles_own on profiles;
create policy profiles_own on profiles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists portfolio_own on portfolio_items;
create policy portfolio_own on portfolio_items for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists documents_own on user_documents;
create policy documents_own on user_documents for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Каталог программ доступен вошедшим целиком (клиент помечает verified=false как «проверяется»)
drop policy if exists programs_read_auth on programs;
create policy programs_read_auth on programs for select to authenticated using (true);

-- ============ ПРИВЯЗКА КВИЗА К АККАУНТУ ============
-- Забирает lead_id (из localStorage браузера) в профиль:
-- копирует имя/WhatsApp/ответы анкеты. Токен отчёта, если есть, подтверждает владение.
create or replace function claim_lead(p_lead_id text, p_token text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_lead leads%rowtype;
  v_answers jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_lead_id is null or length(p_lead_id) < 8 then
    return jsonb_build_object('ok', false, 'reason', 'bad_lead');
  end if;

  select * into v_lead from leads where id = p_lead_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'lead_not_found');
  end if;

  -- если по лиду есть отчёты, требуем токен одного из них (защита оплаченных данных)
  if exists (select 1 from reports where lead_id = p_lead_id) then
    if p_token is null or not exists (select 1 from reports where lead_id = p_lead_id and token = p_token) then
      return jsonb_build_object('ok', false, 'reason', 'token_required');
    end if;
  end if;

  v_answers := jsonb_strip_nulls(jsonb_build_object(
    'level', v_lead.level, 'year', v_lead.year,
    'gpa_band', v_lead.gpa_band, 'school_type', v_lead.school_type,
    'gpa_uni', v_lead.gpa_uni, 'gpa_phd', v_lead.gpa_phd, 'uni_type', v_lead.uni_type,
    'phd_topic', v_lead.phd_topic, 'lang_status', v_lead.lang_status,
    'ielts_band', v_lead.ielts_band, 'sat', v_lead.sat,
    'field', v_lead.field, 'achievements', v_lead.achievements,
    'budget', v_lead.budget, 'priority', v_lead.priority,
    'target_countries', v_lead.target_countries,
    'target_university', v_lead.target_university, 'target_major', v_lead.target_major
  ));

  insert into profiles (user_id, name, whatsapp, lead_ids, answers)
  values (v_uid, v_lead.name, v_lead.whatsapp, array[p_lead_id], v_answers)
  on conflict (user_id) do update set
    name = coalesce(profiles.name, excluded.name),
    whatsapp = coalesce(profiles.whatsapp, excluded.whatsapp),
    lead_ids = (select array(select distinct unnest(profiles.lead_ids || p_lead_id))),
    answers = coalesce(profiles.answers, '{}'::jsonb) || coalesce(v_answers, '{}'::jsonb),
    updated_at = now();

  return jsonb_build_object('ok', true, 'answers', v_answers,
    'name', v_lead.name, 'paid', coalesce(v_lead.paid, false));
end $$;

revoke all on function claim_lead(text, text) from public;
grant execute on function claim_lead(text, text) to authenticated;

-- ОТЧЁТЫ ПОЛЬЗОВАТЕЛЯ: по привязанным lead_id
create or replace function my_reports()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'token', r.token, 'data', r.data, 'created_at', r.created_at)
           order by r.created_at desc), '[]'::jsonb)
  from reports r
  where r.lead_id = any (select unnest(lead_ids) from profiles where user_id = auth.uid());
$$;
revoke all on function my_reports() from public;
grant execute on function my_reports() to authenticated;

-- ============ STORAGE: бакет для документов ============
insert into storage.buckets (id, name, public)
values ('docs', 'docs', false)
on conflict (id) do nothing;

drop policy if exists docs_select on storage.objects;
create policy docs_select on storage.objects for select to authenticated
  using (bucket_id = 'docs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists docs_insert on storage.objects;
create policy docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'docs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists docs_update on storage.objects;
create policy docs_update on storage.objects for update to authenticated
  using (bucket_id = 'docs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists docs_delete on storage.objects;
create policy docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'docs' and (storage.foldername(name))[1] = auth.uid()::text);
