-- ============================================================
-- Scholary 045 · Кабинет школы 2.0 (web-76)
--
-- Зачем. Кабинет школы был одной страницей «ссылка + список учеников». Теперь у школы
-- три роли (владелец, директор, профориентолог), свои записи по ученику (звонок, родители,
-- задача, следующий шаг, статус семье), сводка для директора одним запросом, отчёт года,
-- архив сезонов для сравнения «год к году» и ритм профориентолога (ws_activity по school_id).
-- Все права выдаются здесь же (урок 043). Идемпотентно, деструктивного SQL нет.
-- ============================================================

-- ---------- 1. Сотрудники школы ----------
create table if not exists school_staff (
  id          bigint generated always as identity primary key,
  school_id   uuid not null references schools(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  role        text not null default 'counselor' check (role in ('director','counselor')),
  name        text,
  email       text,
  token       text unique,
  invited_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  status      text not null default 'active' check (status in ('active','removed'))
);
create index if not exists school_staff_school_idx on school_staff (school_id, status);
create unique index if not exists school_staff_user_idx on school_staff (school_id, user_id) where user_id is not null;
alter table school_staff enable row level security;   -- политик нет: только RPC
revoke all on school_staff from anon, authenticated;

-- Роль текущего пользователя в школе: owner | director | counselor | null
create or replace function school_role(p_school uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from schools s where s.id = p_school and s.owner_user_id = auth.uid()) then 'owner'
    else (select st.role from school_staff st where st.school_id = p_school and st.user_id = auth.uid() and st.status = 'active' limit 1)
  end;
$$;
revoke all on function school_role(uuid) from public, anon;
grant execute on function school_role(uuid) to authenticated;

-- Школа текущего пользователя (владелец или сотрудник), только школьные кабинеты (kind <> 'counselor')
create or replace function school_current()
returns uuid language sql stable security definer set search_path = public as $$
  select id from (
    select s.id, s.created_at from schools s where s.owner_user_id = auth.uid() and s.kind <> 'counselor'
    union all
    select s.id, s.created_at from schools s join school_staff st on st.school_id = s.id
     where st.user_id = auth.uid() and st.status = 'active' and s.kind <> 'counselor'
  ) x order by created_at desc limit 1;
$$;
revoke all on function school_current() from public, anon;
grant execute on function school_current() to authenticated;

-- Приглашение: владелец/директор выпускает ссылку, сотрудник открывает её под своим аккаунтом
create or replace function school_staff_invite(p_role text, p_name text default null, p_email text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_school uuid := school_current(); v_role text; v_token text; v_id bigint;
begin
  if v_school is null then return jsonb_build_object('ok', false, 'why', 'forbidden'); end if;
  v_role := school_role(v_school);
  if v_role not in ('owner','director') then return jsonb_build_object('ok', false, 'why', 'forbidden'); end if;
  if (select count(*) from school_staff where school_id = v_school and status = 'active') >= 20 then return jsonb_build_object('ok', false, 'why', 'limit'); end if;
  v_token := encode(gen_random_bytes(18), 'hex');
  insert into school_staff (school_id, role, name, email, token)
  values (v_school, case when p_role = 'director' then 'director' else 'counselor' end, left(nullif(btrim(coalesce(p_name,'')), ''), 80), lower(nullif(btrim(coalesce(p_email,'')), '')), v_token)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'token', v_token);
end $$;
revoke all on function school_staff_invite(text, text, text) from public, anon;
grant execute on function school_staff_invite(text, text, text) to authenticated;

create or replace function school_staff_claim(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r school_staff; v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'why', 'unauthorized'); end if;
  select * into r from school_staff where token = p_token and status = 'active';
  if r.id is null then return jsonb_build_object('ok', false, 'why', 'not_found'); end if;
  if r.user_id is not null and r.user_id <> v_uid then return jsonb_build_object('ok', false, 'why', 'taken'); end if;
  if exists (select 1 from school_staff where school_id = r.school_id and user_id = v_uid and status = 'active' and id <> r.id) then
    update school_staff set status = 'removed' where id = r.id;   -- уже сотрудник этой школы
    return jsonb_build_object('ok', true, 'role', school_role(r.school_id));
  end if;
  update school_staff set user_id = v_uid, claimed_at = coalesce(claimed_at, now()) where id = r.id;
  return jsonb_build_object('ok', true, 'role', r.role);
end $$;
revoke all on function school_staff_claim(text) from public, anon;
grant execute on function school_staff_claim(text) to authenticated;

create or replace function school_staff_remove(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_school uuid := school_current(); n int;
begin
  if v_school is null or school_role(v_school) not in ('owner','director') then return jsonb_build_object('ok', false, 'why', 'forbidden'); end if;
  update school_staff set status = 'removed', token = null where id = p_id and school_id = v_school and status = 'active';
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end $$;
revoke all on function school_staff_remove(bigint) from public, anon;
grant execute on function school_staff_remove(bigint) to authenticated;

-- ---------- 2. school_mine / roster / regen / remove принимают сотрудников ----------
drop function if exists school_mine(text);
create or replace function school_mine(p_kind text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s schools; v_role text;
begin
  if p_kind = 'school' then
    select * into s from schools where id = school_current();
  else
    select * into s from schools
     where owner_user_id = auth.uid()
       and (p_kind is null or (p_kind = 'counselor' and kind = 'counselor') or (p_kind = 'school' and kind <> 'counselor'))
     order by created_at desc limit 1;
  end if;
  if s.id is null then return null; end if;
  v_role := school_role(s.id);
  return jsonb_build_object('id', s.id, 'name', s.name, 'city', s.city, 'kind', s.kind,
    'plan', s.plan, 'plan_label', school_plan_label(s.plan), 'period', s.period,
    'seats', s.seats, 'used', school_used_seats(s.id), 'status', s.status,
    'open', school_is_open(s), 'invite_code', case when v_role in ('owner','director','counselor') then s.invite_code end,
    'starts_on', s.starts_on, 'ends_on', s.ends_on, 'prefs', s.prefs, 'role', v_role,
    'contact_name', s.contact_name, 'contact_email', s.contact_email, 'contact_phone', s.contact_phone,
    'students', (select count(*) from ws_students where school_id = s.id),
    'staff', case when v_role in ('owner','director') then
      (select coalesce(jsonb_agg(jsonb_build_object('id', st.id, 'role', st.role, 'name', st.name, 'email', st.email, 'token', st.token, 'claimed', st.claimed_at is not null) order by st.invited_at), '[]'::jsonb)
         from school_staff st where st.school_id = s.id and st.status = 'active') else '[]'::jsonb end);
end $$;
grant execute on function school_mine(text) to authenticated;

drop function if exists school_regen_code(text);
create or replace function school_regen_code(p_kind text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_code text;
begin
  if p_kind = 'school' then v_id := school_current();
  else
    select id into v_id from schools
     where owner_user_id = auth.uid()
       and (p_kind is null or (p_kind = 'counselor' and kind = 'counselor') or (p_kind = 'school' and kind <> 'counselor'))
     order by created_at desc limit 1;
  end if;
  if v_id is null then return jsonb_build_object('ok', false, 'why', 'forbidden'); end if;
  v_code := school_gen_code();
  update schools set invite_code = v_code, updated_at = now() where id = v_id;
  return jsonb_build_object('ok', true, 'invite_code', v_code);
end $$;
grant execute on function school_regen_code(text) to authenticated;

create or replace function school_remove_member(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_school uuid := school_current(); n int;
begin
  if v_school is null then return jsonb_build_object('ok', false, 'why', 'forbidden'); end if;
  update school_members set status = 'removed' where school_id = v_school and user_id = p_user and status = 'active';
  get diagnostics n = row_count;
  update profiles set school_id = null where user_id = p_user and school_id = v_school;
  return jsonb_build_object('ok', n > 0);
end $$;
grant execute on function school_remove_member(uuid) to authenticated;

-- ---------- 3. Записи школы по ученику ----------
create table if not exists school_student_meta (
  school_id      uuid not null references schools(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  next_step      text check (length(next_step) <= 140),
  next_step_on   date,
  parent_name    text,
  parent_phone   text,
  last_status_at timestamptz,
  note           text check (length(note) <= 1000),
  updated_at     timestamptz not null default now(),
  primary key (school_id, user_id)
);
alter table school_student_meta enable row level security;
drop policy if exists school_student_meta_staff on school_student_meta;
create policy school_student_meta_staff on school_student_meta for all to authenticated
  using (school_role(school_id) is not null) with check (school_role(school_id) is not null);
grant select, insert, update, delete on school_student_meta to authenticated;
revoke all on school_student_meta from anon;

create table if not exists school_notes (
  id          bigint generated always as identity primary key,
  school_id   uuid not null references schools(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,     -- ученик; null = задача школы без ученика
  kind        text not null default 'note' check (kind in ('note','call','parent','meeting','task','status','doc')),
  text        text not null check (length(text) <= 2000),
  due_on      date,
  at_time     time,
  done        boolean,
  done_at     timestamptz,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists school_notes_school_idx on school_notes (school_id, created_at desc);
create index if not exists school_notes_due_idx on school_notes (school_id, due_on);
alter table school_notes enable row level security;
drop policy if exists school_notes_staff on school_notes;
create policy school_notes_staff on school_notes for all to authenticated
  using (school_role(school_id) is not null) with check (school_role(school_id) is not null);
grant select, insert, update, delete on school_notes to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on school_notes from anon;

create or replace function school_notes_done_at()
returns trigger language plpgsql as $$
begin
  if new.kind = 'task' and coalesce(new.done, false) = true and (tg_op = 'INSERT' or coalesce(old.done, false) = false) then new.done_at := now(); end if;
  if new.kind = 'task' and coalesce(new.done, false) = false then new.done_at := null; end if;
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  if new.kind = 'status' and new.user_id is not null then
    insert into school_student_meta (school_id, user_id, last_status_at) values (new.school_id, new.user_id, now())
    on conflict (school_id, user_id) do update set last_status_at = now(), updated_at = now();
  end if;
  return new;
end $$;
drop trigger if exists school_notes_done_at_trg on school_notes;
create trigger school_notes_done_at_trg before insert or update on school_notes for each row execute function school_notes_done_at();

-- ---------- 4. Ритм и настройки школы ----------
create or replace function school_touch(p_progress boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_school uuid := school_current(); v_day date := (now() at time zone 'Asia/Almaty')::date;
begin
  if v_school is null then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into ws_activity (school_id, day, actions, progress) values (v_school, v_day, 1, coalesce(p_progress, false))
  on conflict (school_id, day) do update set actions = ws_activity.actions + 1, progress = ws_activity.progress or excluded.progress;
  return jsonb_build_object('ok', true, 'day', v_day);
end $$;
revoke all on function school_touch(boolean) from public, anon;
grant execute on function school_touch(boolean) to authenticated;

create or replace function school_prefs_set(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_school uuid := school_current();
begin
  if v_school is null then raise exception 'forbidden' using errcode = '42501'; end if;
  update schools set prefs = coalesce(p, '{}'::jsonb) - 'secret', updated_at = now() where id = v_school;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function school_prefs_set(jsonb) from public, anon;
grant execute on function school_prefs_set(jsonb) to authenticated;

-- ---------- 5. Ростер с записями школы ----------
create or replace function school_roster()
returns json
language plpgsql stable security definer set search_path = public as $$
declare v_school uuid := school_current(); j json;
begin
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
      (pr.answers is not null and pr.answers <> '{}'::jsonb)   as quiz_done,
      (select ph.p_adm from probability_history ph where ph.user_id = m.user_id order by ph.ts desc limit 1) as p_adm,
      (select ph.p_sch from probability_history ph where ph.user_id = m.user_id order by ph.ts desc limit 1) as p_sch,
      (select count(*) from portfolio_items pi where pi.user_id = m.user_id)                                as apps,
      (select count(*) from portfolio_items pi where pi.user_id = m.user_id and pi.submitted_at is not null) as apps_sent,
      (select count(*) from portfolio_items pi where pi.user_id = m.user_id and pi.outcome = 'admit')          as offers,
      (select count(*) from user_documents d where d.user_id = m.user_id)                                    as docs,
      (select count(*) from user_documents d where d.user_id = m.user_id and d.status = 'ready')             as docs_ready,
      (select min(next_deadline(p.deadline_md))
         from portfolio_items pi join programs p on p.id = pi.program_id
        where pi.user_id = m.user_id and pi.submitted_at is null)                                          as next_deadline,
      greatest(pr.updated_at,
               (select max(pi.updated_at) from portfolio_items pi where pi.user_id = m.user_id),
               (select max(d.updated_at)  from user_documents d  where d.user_id = m.user_id))              as last_active,
      (select max(ca.day) from cab_activity ca where ca.user_id = m.user_id)                               as cab_last_day,
      (pr.pro_until >= current_date)                                                                        as pro,
      sm.next_step, sm.next_step_on, sm.parent_name, sm.parent_phone, sm.last_status_at, sm.note,
      (select max(n.created_at) from school_notes n where n.school_id = v_school and n.user_id = m.user_id and n.kind in ('note','call','parent','meeting','status')) as last_touch,
      (select count(*) from school_notes n where n.school_id = v_school and n.user_id = m.user_id and n.kind = 'task' and coalesce(n.done,false) = false) as tasks_open
    from school_members m
    left join profiles pr on pr.user_id = m.user_id
    left join school_student_meta sm on sm.school_id = m.school_id and sm.user_id = m.user_id
    where m.school_id = v_school and m.status = 'active'
  ) t;
  return j;
end $$;
grant execute on function school_roster() to authenticated;

-- ---------- 6. Сводка школы одним запросом ----------
create or replace function school_dashboard()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_school uuid := school_current(); v_today date := (now() at time zone 'Asia/Almaty')::date; v_mon date;
begin
  if v_school is null then raise exception 'forbidden' using errcode = '42501'; end if;
  v_mon := date_trunc('week', v_today)::date;
  return jsonb_build_object(
    'today', v_today, 'week_start', v_mon, 'role', school_role(v_school),
    'prefs', (select prefs from schools where id = v_school),
    'tasks', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'user_id', n.user_id, 'text', n.text, 'due_on', n.due_on, 'created_at', n.created_at) order by n.due_on nulls last, n.created_at), '[]'::jsonb)
              from school_notes n where n.school_id = v_school and n.kind = 'task' and coalesce(n.done, false) = false),
    'meetings', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'user_id', n.user_id, 'text', n.text, 'due_on', n.due_on, 'at_time', n.at_time) order by n.due_on, n.at_time nulls last), '[]'::jsonb)
                 from school_notes n where n.school_id = v_school and n.kind = 'meeting' and n.due_on between v_today - 7 and v_today + 60),
    'deadlines', (select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'program', x.name, 'cc', x.cc, 'deadline', x.d) order by x.d), '[]'::jsonb)
                  from (select m.user_id, p.name, p.cc, next_deadline(p.deadline_md) as d
                          from school_members m join portfolio_items pi on pi.user_id = m.user_id and pi.submitted_at is null
                          join programs p on p.id = pi.program_id
                         where m.school_id = v_school and m.status = 'active') x
                  where x.d between v_today and v_today + 120),
    'week', jsonb_build_object(
      'touches',    (select count(*) from school_notes n where n.school_id = v_school and n.created_at >= v_mon and n.kind in ('note','call','parent','meeting','status')),
      'tasks_done', (select count(*) from school_notes n where n.school_id = v_school and n.kind = 'task' and n.done = true and n.done_at >= v_mon),
      'statuses',   (select count(*) from school_notes n where n.school_id = v_school and n.kind = 'status' and n.created_at >= v_mon),
      'joined',     (select count(*) from school_members m where m.school_id = v_school and m.status = 'active' and m.joined_at >= v_mon),
      'quiz',       (select count(*) from school_members m join probability_history ph on ph.user_id = m.user_id where m.school_id = v_school and m.status = 'active' and ph.ts >= v_mon),
      'docs_ready', (select count(*) from school_members m join user_documents d on d.user_id = m.user_id where m.school_id = v_school and m.status = 'active' and d.status = 'ready' and d.updated_at >= v_mon),
      'apps_sent',  (select count(*) from school_members m join portfolio_items pi on pi.user_id = m.user_id where m.school_id = v_school and m.status = 'active' and pi.submitted_at >= v_mon),
      'prev', jsonb_build_object(
        'touches',    (select count(*) from school_notes n where n.school_id = v_school and n.created_at >= v_mon - 7 and n.created_at < v_mon and n.kind in ('note','call','parent','meeting','status')),
        'joined',     (select count(*) from school_members m where m.school_id = v_school and m.status = 'active' and m.joined_at >= v_mon - 7 and m.joined_at < v_mon))),
    'activity', (select coalesce(jsonb_agg(jsonb_build_object('day', a.day, 'progress', a.progress, 'actions', a.actions) order by a.day), '[]'::jsonb)
                 from ws_activity a where a.school_id = v_school and a.day >= v_today - 400),
    'seasons', (select coalesce(jsonb_agg(jsonb_build_object('season', s.season, 'snapshot', s.snapshot, 'archived_at', s.archived_at) order by s.season), '[]'::jsonb)
                from school_seasons s where s.school_id = v_school),
    'offers', (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', coalesce(pr.name, '—'), 'class_label', m.class_label, 'program', p.name, 'cc', p.cc, 'funding', p.funding) order by m.class_label, pr.name), '[]'::jsonb)
               from school_members m join portfolio_items pi on pi.user_id = m.user_id and pi.outcome = 'admit'
               join programs p on p.id = pi.program_id left join profiles pr on pr.user_id = m.user_id
               where m.school_id = v_school and m.status = 'active'));
end $$;
revoke all on function school_dashboard() from public, anon;
grant execute on function school_dashboard() to authenticated;

-- ---------- 7. Сезоны: снимок для «год к году» ----------
create table if not exists school_seasons (
  school_id   uuid not null references schools(id) on delete cascade,
  season      text not null,             -- '2025/26'
  snapshot    jsonb not null,            -- {students, quiz, plan, docs, sent, offers, by_class:[...], countries:[...]}
  archived_at timestamptz not null default now(),
  primary key (school_id, season)
);
alter table school_seasons enable row level security;
drop policy if exists school_seasons_staff on school_seasons;
create policy school_seasons_staff on school_seasons for select to authenticated using (school_role(school_id) is not null);
grant select on school_seasons to authenticated;
revoke all on school_seasons from anon;

create or replace function school_archive_season(p_season text, p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_school uuid := school_current();
begin
  if v_school is null or school_role(v_school) not in ('owner','director') then return jsonb_build_object('ok', false, 'why', 'forbidden'); end if;
  if p_season !~ '^\d{4}/\d{2}$' then return jsonb_build_object('ok', false, 'why', 'season'); end if;
  insert into school_seasons (school_id, season, snapshot) values (v_school, p_season, coalesce(p_snapshot, '{}'::jsonb))
  on conflict (school_id, season) do update set snapshot = excluded.snapshot, archived_at = now();
  return jsonb_build_object('ok', true);
end $$;
revoke all on function school_archive_season(text, jsonb) from public, anon;
grant execute on function school_archive_season(text, jsonb) to authenticated;

-- ---------- 8. Родительский контакт при регистрации (необязательно) ----------
alter table school_members add column if not exists parent_phone text;
drop function if exists school_join(text, text, text, text);
create or replace function school_join(p_code text, p_grade text, p_class text, p_name text, p_parent_phone text default null)
returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare s schools; v_uid uuid := auth.uid(); v_used int; v_exists boolean; v_email text; v_sid uuid;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'why', 'unauthorized'); end if;
  select * into s from schools where invite_code = upper(btrim(coalesce(p_code, '')));
  if s.id is null then return jsonb_build_object('ok', false, 'why', 'not_found'); end if;
  if not school_is_open(s) then return jsonb_build_object('ok', false, 'why', 'closed'); end if;

  select exists(select 1 from school_members where school_id = s.id and user_id = v_uid and status = 'active') into v_exists;
  v_used := school_used_seats(s.id);
  if not v_exists and v_used >= s.seats then return jsonb_build_object('ok', false, 'why', 'full'); end if;

  insert into school_members (school_id, user_id, grade, class_label, parent_phone)
  values (s.id, v_uid,
          case when p_grade in ('9','10','11','other') then p_grade else 'other' end,
          left(btrim(coalesce(p_class, '')), 12), left(nullif(btrim(coalesce(p_parent_phone, '')), ''), 24))
  on conflict (school_id, user_id) do update
    set grade = excluded.grade, class_label = excluded.class_label, status = 'active', parent_phone = coalesce(excluded.parent_phone, school_members.parent_phone);
  if s.kind <> 'counselor' and nullif(btrim(coalesce(p_parent_phone, '')), '') is not null then
    insert into school_student_meta (school_id, user_id, parent_phone) values (s.id, v_uid, left(btrim(p_parent_phone), 24))
    on conflict (school_id, user_id) do update set parent_phone = coalesce(school_student_meta.parent_phone, excluded.parent_phone), updated_at = now();
  end if;

  insert into profiles (user_id, name) values (v_uid, nullif(btrim(coalesce(p_name,'')), ''))
  on conflict (user_id) do nothing;

  update profiles
     set school_id = s.id,
         name      = coalesce(nullif(btrim(coalesce(p_name,'')), ''), name),
         pro_until = greatest(coalesce(pro_until, current_date), coalesce(s.ends_on, current_date + 30)),
         pro_plan  = 'school',
         updated_at = now()
   where user_id = v_uid;

  if s.kind = 'counselor' then
    select email into v_email from auth.users where id = v_uid;
    select id into v_sid from ws_students where school_id = s.id and user_id = v_uid limit 1;
    if v_sid is null and v_email is not null then
      update ws_students set user_id = v_uid, updated_at = now()
       where school_id = s.id and user_id is null and lower(email) = lower(v_email)
       returning id into v_sid;
    end if;
    if v_sid is null then
      insert into ws_students (school_id, user_id, name, grade, email)
      values (s.id, v_uid, coalesce(nullif(btrim(coalesce(p_name,'')), ''), 'Ученик'),
              case when p_grade in ('9','10','11','other') then p_grade else 'other' end, v_email);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'school', s.name, 'ends_on', s.ends_on, 'already', v_exists, 'kind', s.kind);
end $$;
grant execute on function school_join(text, text, text, text, text) to authenticated;

select 'school2 ok' as status,
  has_table_privilege('authenticated', 'school_notes', 'insert') as notes_ins,
  has_table_privilege('anon', 'school_staff', 'select') as anon_staff,
  (select count(*) from pg_proc where proname in ('school_current','school_role','school_dashboard','school_staff_invite','school_staff_claim','school_touch','school_prefs_set','school_archive_season')) as fns;
