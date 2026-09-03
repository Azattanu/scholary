-- 035 · Scholary для школ (B2B).
-- Школа подаёт заявку → владелец активирует в админке → школа получает
-- закрытую ссылку → ученики регистрируются по ней и получают Pro на срок
-- договора → профориентолог видит свой класс в кабинете школы.
--
-- Принципы:
--   · таблицы закрыты RLS полностью — весь доступ через узкие RPC;
--   · место списывается при регистрации ученика, а не при отправке ссылки;
--   · повторная регистрация того же ученика место не съедает (upsert);
--   · продление срока школы автоматически продлевает Pro всем её ученикам;
--   · ИИН не собираем: школа + класс + имя достаточно, лишних персональных
--     данных детей не храним.

-- ---------- школы ----------
create table if not exists schools (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  city             text,
  kind             text,                      -- state | private | other
  contact_name     text,
  contact_role     text,
  contact_email    text not null,
  contact_phone    text,
  students_expected int,
  plan             text not null default 'pilot',   -- pilot | s100 | s500 | s1000
  period           text not null default 'year',    -- year | month | pilot
  seats            int  not null default 50,
  status           text not null default 'pending', -- pending | active | paused | expired | rejected
  invite_code      text unique,
  claim_token      text unique,
  owner_user_id    uuid references auth.users(id) on delete set null,
  starts_on        date,
  ends_on          date,
  note             text,                      -- что написала школа в заявке
  admin_note       text,
  source           text,
  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists schools_status_idx on schools (status, created_at desc);
alter table schools enable row level security;   -- политик нет: только RPC

-- ---------- ученики школы ----------
create table if not exists school_members (
  id          bigint generated always as identity primary key,
  school_id   uuid not null references schools(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  grade       text,          -- 9 | 10 | 11 | other
  class_label text,          -- «9А»
  status      text not null default 'active',   -- active | removed
  joined_at   timestamptz not null default now(),
  unique (school_id, user_id)
);
create index if not exists school_members_school_idx on school_members (school_id, status);
alter table school_members enable row level security;   -- политик нет: только RPC

alter table profiles add column if not exists school_id uuid references schools(id) on delete set null;

-- ---------- служебное ----------
-- Код приглашения: 8 знаков без похожих символов (0/O, 1/I/L).
create or replace function school_gen_code()
returns text language plpgsql volatile as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  out text := '';
  i int;
begin
  loop
    out := '';
    for i in 1..8 loop
      out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from schools where invite_code = out);
  end loop;
  return out;
end $$;

create or replace function school_used_seats(p_school uuid)
returns int language sql stable as $$
  select count(*)::int from school_members where school_id = p_school and status = 'active';
$$;

create or replace function school_plan_label(p_plan text)
returns text language sql immutable as $$
  select case p_plan
    when 'pilot' then 'Пилот'
    when 's100'  then 'Класс · до 100'
    when 's500'  then 'Школа · до 500'
    when 's1000' then 'Сеть · до 1000'
    else coalesce(p_plan, '—') end;
$$;

create or replace function school_is_open(s schools)
returns boolean language sql stable as $$
  select s.status = 'active'
     and (s.ends_on is null or s.ends_on >= current_date)
     and (s.starts_on is null or s.starts_on <= current_date);
$$;

-- ---------- 1. заявка школы (только сервер, с секретом) ----------
create or replace function school_apply(p_secret text, p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_secret text; v_id uuid; v_email text;
begin
  select value into v_secret from app_secrets where name = 'tiptop_webhook';
  if v_secret is null or length(v_secret) < 24 or p_secret is null or p_secret <> v_secret then
    return jsonb_build_object('ok', false, 'why', 'forbidden');
  end if;
  v_email := lower(btrim(coalesce(p->>'contact_email', '')));
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then return jsonb_build_object('ok', false, 'why', 'bad_email'); end if;
  if length(btrim(coalesce(p->>'name', ''))) < 3 then return jsonb_build_object('ok', false, 'why', 'bad_name'); end if;

  -- та же школа с той же почтой за последние сутки — не плодим дубли
  select id into v_id from schools
   where contact_email = v_email and status = 'pending' and created_at > now() - interval '1 day'
   order by created_at desc limit 1;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'dup', true); end if;

  insert into schools (name, city, kind, contact_name, contact_role, contact_email, contact_phone,
                       students_expected, plan, period, seats, note, source)
  values (left(btrim(p->>'name'), 120), left(btrim(coalesce(p->>'city','')), 60),
          case when p->>'kind' in ('state','private','other') then p->>'kind' else 'other' end,
          left(btrim(coalesce(p->>'contact_name','')), 80), left(btrim(coalesce(p->>'contact_role','')), 80),
          v_email, left(btrim(coalesce(p->>'contact_phone','')), 32),
          nullif(p->>'students_expected','')::int,
          case when p->>'plan' in ('pilot','s100','s500','s1000') then p->>'plan' else 'pilot' end,
          case when p->>'period' in ('year','month','pilot') then p->>'period' else 'pilot' end,
          case p->>'plan' when 's100' then 100 when 's500' then 500 when 's1000' then 1000 else 50 end,
          left(btrim(coalesce(p->>'note','')), 1000), left(btrim(coalesce(p->>'source','')), 60))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
-- Вызывает PHP с anon-ключом: роли anon нужен EXECUTE, защита — секрет внутри.
revoke all on function school_apply(text, jsonb) from public, authenticated;
grant execute on function school_apply(text, jsonb) to anon;

-- ---------- 2. школа по коду (для страницы регистрации) ----------
create or replace function school_by_code(p_code text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s schools; v_used int;
begin
  select * into s from schools where invite_code = upper(btrim(coalesce(p_code, '')));
  if s.id is null then return jsonb_build_object('ok', false, 'why', 'not_found'); end if;
  v_used := school_used_seats(s.id);
  return jsonb_build_object(
    'ok', true, 'name', s.name, 'city', s.city, 'plan', school_plan_label(s.plan),
    'seats', s.seats, 'used', v_used, 'ends_on', s.ends_on,
    'open', school_is_open(s) and v_used < s.seats,
    'why', case when not school_is_open(s) then 'closed' when v_used >= s.seats then 'full' else null end);
end $$;
grant execute on function school_by_code(text) to anon, authenticated;

-- ---------- 3. ученик присоединяется к школе ----------
create or replace function school_join(p_code text, p_grade text, p_class text, p_name text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare s schools; v_uid uuid := auth.uid(); v_used int; v_exists boolean;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'why', 'unauthorized'); end if;
  select * into s from schools where invite_code = upper(btrim(coalesce(p_code, '')));
  if s.id is null then return jsonb_build_object('ok', false, 'why', 'not_found'); end if;
  if not school_is_open(s) then return jsonb_build_object('ok', false, 'why', 'closed'); end if;

  select exists(select 1 from school_members where school_id = s.id and user_id = v_uid and status = 'active') into v_exists;
  v_used := school_used_seats(s.id);
  if not v_exists and v_used >= s.seats then return jsonb_build_object('ok', false, 'why', 'full'); end if;

  insert into school_members (school_id, user_id, grade, class_label)
  values (s.id, v_uid,
          case when p_grade in ('9','10','11','other') then p_grade else 'other' end,
          left(btrim(coalesce(p_class, '')), 12))
  on conflict (school_id, user_id) do update
    set grade = excluded.grade, class_label = excluded.class_label, status = 'active';

  -- профиль всегда существует (017), но на всякий случай
  insert into profiles (user_id, name) values (v_uid, nullif(btrim(coalesce(p_name,'')), ''))
  on conflict (user_id) do nothing;

  update profiles
     set school_id = s.id,
         name      = coalesce(nullif(btrim(coalesce(p_name,'')), ''), name),
         pro_until = greatest(coalesce(pro_until, current_date), coalesce(s.ends_on, current_date + 30)),
         pro_plan  = 'school',
         updated_at = now()
   where user_id = v_uid;

  return jsonb_build_object('ok', true, 'school', s.name, 'ends_on', s.ends_on, 'already', v_exists);
end $$;
grant execute on function school_join(text, text, text, text) to authenticated;

-- ---------- 4. школа глазами ученика (контакт профориентолога) ----------
create or replace function school_for_student()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s schools; m school_members;
begin
  select sm.* into m from school_members sm where sm.user_id = auth.uid() and sm.status = 'active'
   order by sm.joined_at desc limit 1;
  if m.id is null then return null; end if;
  select * into s from schools where id = m.school_id;
  return jsonb_build_object('name', s.name, 'city', s.city, 'grade', m.grade, 'class_label', m.class_label,
    'contact_name', s.contact_name, 'contact_role', s.contact_role,
    'contact_email', s.contact_email, 'contact_phone', s.contact_phone,
    'ends_on', s.ends_on, 'active', school_is_open(s));
end $$;
grant execute on function school_for_student() to authenticated;

-- ---------- 5. профориентолог забирает кабинет по токену из письма ----------
create or replace function school_claim(p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare s schools; v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'why', 'unauthorized'); end if;
  select * into s from schools where claim_token = btrim(coalesce(p_token, '')) and length(btrim(coalesce(p_token,''))) >= 20;
  if s.id is null then return jsonb_build_object('ok', false, 'why', 'not_found'); end if;
  if s.owner_user_id is not null and s.owner_user_id <> v_uid then
    return jsonb_build_object('ok', false, 'why', 'taken');
  end if;
  update schools set owner_user_id = v_uid, updated_at = now() where id = s.id;
  return jsonb_build_object('ok', true, 'name', s.name);
end $$;
grant execute on function school_claim(text) to authenticated;

-- ---------- 6. моя школа (кабинет профориентолога) ----------
create or replace function school_mine()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s schools;
begin
  select * into s from schools where owner_user_id = auth.uid() order by created_at desc limit 1;
  if s.id is null then return null; end if;
  return jsonb_build_object('id', s.id, 'name', s.name, 'city', s.city, 'kind', s.kind,
    'plan', s.plan, 'plan_label', school_plan_label(s.plan), 'period', s.period,
    'seats', s.seats, 'used', school_used_seats(s.id), 'status', s.status,
    'open', school_is_open(s), 'invite_code', s.invite_code,
    'starts_on', s.starts_on, 'ends_on', s.ends_on,
    'contact_name', s.contact_name, 'contact_email', s.contact_email, 'contact_phone', s.contact_phone);
end $$;
grant execute on function school_mine() to authenticated;

-- ---------- 7. список учеников с прогрессом ----------
-- Только то, что нужно профориентологу для работы: направление, вероятность,
-- сколько подач и документов, ближайший дедлайн, когда был активен.
-- Ни ответов анкеты целиком, ни файлов документов наружу не отдаём.
create or replace function school_roster()
returns json
language plpgsql stable security definer set search_path = public as $$
declare v_school uuid; j json;
begin
  select id into v_school from schools where owner_user_id = auth.uid() order by created_at desc limit 1;
  if v_school is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(json_agg(t order by t.class_label, t.name), '[]'::json) into j
  from (
    select
      m.user_id,
      coalesce(pr.name, '—')                                   as name,
      m.grade, m.class_label, m.joined_at,
      pr.answers->>'level'                                      as level,
      pr.answers->>'field'                                      as field,
      pr.answers->>'target_countries'                           as countries,
      (select ph.p_adm from probability_history ph where ph.user_id = m.user_id order by ph.ts desc limit 1) as p_adm,
      (select ph.p_sch from probability_history ph where ph.user_id = m.user_id order by ph.ts desc limit 1) as p_sch,
      (select count(*) from portfolio_items pi where pi.user_id = m.user_id)                                as apps,
      (select count(*) from portfolio_items pi where pi.user_id = m.user_id and pi.submitted_at is not null) as apps_sent,
      (select count(*) from user_documents d where d.user_id = m.user_id)                                    as docs,
      (select count(*) from user_documents d where d.user_id = m.user_id and d.status = 'ready')             as docs_ready,
      (select min(next_deadline(p.deadline_md))
         from portfolio_items pi join programs p on p.id = pi.program_id
        where pi.user_id = m.user_id and pi.submitted_at is null)                                          as next_deadline,
      greatest(pr.updated_at,
               (select max(pi.updated_at) from portfolio_items pi where pi.user_id = m.user_id),
               (select max(d.updated_at)  from user_documents d  where d.user_id = m.user_id))              as last_active,
      (pr.pro_until >= current_date)                                                                        as pro
    from school_members m
    left join profiles pr on pr.user_id = m.user_id
    where m.school_id = v_school and m.status = 'active'
  ) t;
  return j;
end $$;
grant execute on function school_roster() to authenticated;

-- ---------- 8. новая ссылка (старую разослали не тем) ----------
create or replace function school_regen_code()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_school uuid; v_code text;
begin
  select id into v_school from schools where owner_user_id = auth.uid() order by created_at desc limit 1;
  if v_school is null then return jsonb_build_object('ok', false, 'why', 'forbidden'); end if;
  v_code := school_gen_code();
  update schools set invite_code = v_code, updated_at = now() where id = v_school;
  return jsonb_build_object('ok', true, 'invite_code', v_code);
end $$;
grant execute on function school_regen_code() to authenticated;

-- ---------- 9. убрать ученика (место освобождается; Pro не отбираем) ----------
create or replace function school_remove_member(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_school uuid; n int;
begin
  select id into v_school from schools where owner_user_id = auth.uid() order by created_at desc limit 1;
  if v_school is null then return jsonb_build_object('ok', false, 'why', 'forbidden'); end if;
  update school_members set status = 'removed' where school_id = v_school and user_id = p_user and status = 'active';
  get diagnostics n = row_count;
  update profiles set school_id = null where user_id = p_user and school_id = v_school;
  return jsonb_build_object('ok', n > 0);
end $$;
grant execute on function school_remove_member(uuid) to authenticated;

-- ---------- 10. админка ----------
create or replace function admin_schools()
returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare j json;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(json_agg(t order by
           case t.status when 'pending' then 0 when 'active' then 1 when 'paused' then 2 else 3 end, t.created_at desc), '[]'::json)
    into j
  from (
    select s.id, s.name, s.city, s.kind, s.contact_name, s.contact_role, s.contact_email, s.contact_phone,
           s.students_expected, s.plan, school_plan_label(s.plan) as plan_label, s.period, s.seats,
           school_used_seats(s.id) as used, s.status, s.invite_code, s.claim_token,
           (s.owner_user_id is not null) as claimed,
           (select u.email from auth.users u where u.id = s.owner_user_id) as owner_email,
           s.starts_on, s.ends_on, s.note, s.admin_note, s.source, s.is_test, s.created_at,
           (select max(m.joined_at) from school_members m where m.school_id = s.id) as last_join
    from schools s
  ) t;
  return j;
end $$;
grant execute on function admin_schools() to authenticated;

-- Активация / изменение. p_months: срок от сегодня (если ещё не активна) или
-- продление от текущего ends_on. Продление автоматически продлевает Pro ученикам.
create or replace function admin_school_set(p_id uuid, p_status text default null, p_plan text default null,
                                            p_seats int default null, p_months int default null,
                                            p_admin_note text default null, p_is_test boolean default null)
returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare s schools; v_new_end date;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into s from schools where id = p_id;
  if s.id is null then return jsonb_build_object('ok', false, 'why', 'not_found'); end if;

  if p_plan is not null and p_plan in ('pilot','s100','s500','s1000') then s.plan := p_plan; end if;
  if p_seats is not null and p_seats between 1 and 100000 then s.seats := p_seats; end if;
  if p_admin_note is not null then s.admin_note := left(p_admin_note, 2000); end if;
  if p_is_test is not null then s.is_test := p_is_test; end if;

  if p_status is not null and p_status in ('pending','active','paused','expired','rejected') then
    if p_status = 'active' and s.status <> 'active' then
      if s.invite_code is null then s.invite_code := school_gen_code(); end if;
      -- gen_random_uuid() встроен в Postgres: pgcrypto на Supabase живёт в схеме
      -- extensions и из функции с search_path=public не виден
      if s.claim_token is null then s.claim_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''); end if;
      if s.starts_on is null then s.starts_on := current_date; end if;
      if s.ends_on is null or s.ends_on < current_date then
        s.ends_on := current_date + (coalesce(p_months, case when s.plan = 'pilot' then 1 else 12 end) * interval '1 month');
        p_months := null;   -- уже учли
      end if;
    end if;
    s.status := p_status;
  end if;

  if p_months is not null and p_months between 1 and 60 then
    s.ends_on := greatest(coalesce(s.ends_on, current_date), current_date) + (p_months * interval '1 month');
  end if;

  update schools set plan = s.plan, seats = s.seats, admin_note = s.admin_note, is_test = s.is_test,
         status = s.status, invite_code = s.invite_code, claim_token = s.claim_token,
         starts_on = s.starts_on, ends_on = s.ends_on, updated_at = now()
   where id = s.id;

  -- продление срока → продление Pro всем активным ученикам школы
  if s.status = 'active' and s.ends_on is not null then
    update profiles p set pro_until = greatest(coalesce(p.pro_until, current_date), s.ends_on), pro_plan = 'school'
     where p.user_id in (select user_id from school_members where school_id = s.id and status = 'active');
  end if;

  return jsonb_build_object('ok', true, 'id', s.id, 'status', s.status, 'invite_code', s.invite_code,
                            'claim_token', s.claim_token, 'seats', s.seats, 'ends_on', s.ends_on);
end $$;
grant execute on function admin_school_set(uuid, text, text, int, int, text, boolean) to authenticated;

-- Самопроверка
select school_gen_code() as sample_code, school_plan_label('s500') as label;
