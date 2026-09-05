-- 036 · Workspace профориентолога (B2B для частных консультантов).
-- Профориентолог ведёт 15–150 учеников: контакты и родители, этап, подачи с
-- дедлайнами и ссылками, документы (файлы), заметки. Ученик может быть
-- «ручным» (карточку завёл профориентолог) или «связанным» (ученик вошёл по
-- ссылке — тогда его кабинет виден профориентологу в сводке).
--
-- Переиспользуем schools как «рабочее пространство»: kind = 'counselor',
-- тарифы c15 / c50 / c150, ссылка, места, срок, привязка владельца, админка —
-- всё уже работает. Ниже только то, чего у школ нет.

-- ---------- тарифы профориентологов в school_apply ----------
create or replace function school_apply(p_secret text, p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_secret text; v_id uuid; v_email text; v_plan text; v_kind text;
begin
  select value into v_secret from app_secrets where name = 'tiptop_webhook';
  if v_secret is null or length(v_secret) < 24 or p_secret is null or p_secret <> v_secret then
    return jsonb_build_object('ok', false, 'why', 'forbidden');
  end if;
  v_email := lower(btrim(coalesce(p->>'contact_email', '')));
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then return jsonb_build_object('ok', false, 'why', 'bad_email'); end if;
  if length(btrim(coalesce(p->>'name', ''))) < 3 then return jsonb_build_object('ok', false, 'why', 'bad_name'); end if;
  v_kind := case when p->>'kind' in ('state','private','other','counselor') then p->>'kind' else 'other' end;
  v_plan := case when p->>'plan' in ('pilot','s100','s500','s1000','c15','c50','c150') then p->>'plan' else 'pilot' end;

  select id into v_id from schools
   where contact_email = v_email and status = 'pending' and created_at > now() - interval '1 day'
   order by created_at desc limit 1;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'dup', true); end if;

  insert into schools (name, city, kind, contact_name, contact_role, contact_email, contact_phone,
                       students_expected, plan, period, seats, note, source)
  values (left(btrim(p->>'name'), 120), left(btrim(coalesce(p->>'city','')), 60), v_kind,
          left(btrim(coalesce(p->>'contact_name','')), 80), left(btrim(coalesce(p->>'contact_role','')), 80),
          v_email, left(btrim(coalesce(p->>'contact_phone','')), 32),
          nullif(p->>'students_expected','')::int, v_plan,
          case when p->>'period' in ('year','month','pilot') then p->>'period' else 'pilot' end,
          case v_plan when 's100' then 100 when 's500' then 500 when 's1000' then 1000
                      when 'c15' then 15 when 'c50' then 50 when 'c150' then 150
                      else case when v_kind = 'counselor' then 5 else 50 end end,
          left(btrim(coalesce(p->>'note','')), 1000), left(btrim(coalesce(p->>'source','')), 60))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function school_plan_label(p_plan text)
returns text language sql immutable as $$
  select case p_plan
    when 'pilot' then 'Пилот'
    when 's100'  then 'Класс · до 100'
    when 's500'  then 'Школа · до 500'
    when 's1000' then 'Сеть · до 1000'
    when 'c15'   then 'Старт · до 15'
    when 'c50'   then 'Практика · до 50'
    when 'c150'  then 'Агентство · до 150'
    else coalesce(p_plan, '—') end;
$$;

-- ---------- владелец рабочего пространства ----------
-- schools закрыта RLS целиком, поэтому политикам нужен security-definer помощник.
create or replace function ws_owner(p_school uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from schools s where s.id = p_school and s.owner_user_id = auth.uid());
$$;
grant execute on function ws_owner(uuid) to authenticated;

-- ---------- ученики профориентолога ----------
create table if not exists ws_students (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references schools(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,   -- связан с аккаунтом ученика
  name         text not null,
  grade        text,                 -- 9 | 10 | 11 | grad | other
  level        text,                 -- bachelor | master | phd
  phone        text,
  email        text,
  parent_name  text,
  parent_phone text,
  target       text,                 -- «Германия/Венгрия · IT» свободным текстом
  stage        text not null default 'intake',   -- intake | docs | applying | submitted | admitted | paused
  note         text,                 -- закреплённая заметка (что важно помнить)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists ws_students_school_idx on ws_students (school_id, stage);
create index if not exists ws_students_user_idx on ws_students (user_id);
alter table ws_students enable row level security;
drop policy if exists ws_students_owner on ws_students;
create policy ws_students_owner on ws_students for all to authenticated
  using (ws_owner(school_id)) with check (ws_owner(school_id));

-- ---------- подачи ученика (ведёт профориентолог) ----------
create table if not exists ws_apps (
  id          bigint generated always as identity primary key,
  student_id  uuid not null references ws_students(id) on delete cascade,
  program_id  text,                  -- из каталога programs, если оттуда
  name        text not null,
  country     text,
  deadline    date,
  apply_url   text,
  status      text not null default 'study',   -- study | prep | applied | admit | reject | waitlist
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists ws_apps_student_idx on ws_apps (student_id);
alter table ws_apps enable row level security;
drop policy if exists ws_apps_owner on ws_apps;
create policy ws_apps_owner on ws_apps for all to authenticated
  using (ws_owner((select school_id from ws_students st where st.id = student_id)))
  with check (ws_owner((select school_id from ws_students st where st.id = student_id)));

-- ---------- документы ученика (файлы в бакете docs под папкой профориентолога) ----------
create table if not exists ws_docs (
  id          bigint generated always as identity primary key,
  student_id  uuid not null references ws_students(id) on delete cascade,
  doc_type    text not null,         -- passport | diploma | transcript | ielts | motivation | recommendation | cv | photo | other
  title       text,
  status      text not null default 'none',   -- none | progress | ready
  file_path   text,                  -- {uid}/ws/{student_id}/{file}
  file_name   text,
  note        text,
  updated_at  timestamptz not null default now()
);
create index if not exists ws_docs_student_idx on ws_docs (student_id);
alter table ws_docs enable row level security;
drop policy if exists ws_docs_owner on ws_docs;
create policy ws_docs_owner on ws_docs for all to authenticated
  using (ws_owner((select school_id from ws_students st where st.id = student_id)))
  with check (ws_owner((select school_id from ws_students st where st.id = student_id)));

-- ---------- заметки / история ----------
create table if not exists ws_notes (
  id          bigint generated always as identity primary key,
  student_id  uuid not null references ws_students(id) on delete cascade,
  kind        text not null default 'note',   -- note | call | parent | meeting | task
  text        text not null,
  done        boolean,               -- для kind = task
  due_on      date,
  created_at  timestamptz not null default now()
);
create index if not exists ws_notes_student_idx on ws_notes (student_id, created_at desc);
alter table ws_notes enable row level security;
drop policy if exists ws_notes_owner on ws_notes;
create policy ws_notes_owner on ws_notes for all to authenticated
  using (ws_owner((select school_id from ws_students st where st.id = student_id)))
  with check (ws_owner((select school_id from ws_students st where st.id = student_id)));

-- ---------- места: у профориентолога место = карточка ученика ----------
create or replace function school_used_seats(p_school uuid)
returns int language sql stable as $$
  select case when (select kind from schools where id = p_school) = 'counselor'
              then (select count(*)::int from ws_students where school_id = p_school)
              else (select count(*)::int from school_members where school_id = p_school and status = 'active') end;
$$;

-- Лимит тарифа держит база, а не только интерфейс.
create or replace function ws_students_cap()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_seats int; v_used int;
begin
  select seats into v_seats from schools where id = new.school_id;
  select count(*) into v_used from ws_students where school_id = new.school_id;
  if v_used >= coalesce(v_seats, 0) then
    raise exception 'seats_full' using errcode = 'P0001', hint = 'Места по тарифу закончились';
  end if;
  return new;
end $$;
drop trigger if exists ws_students_cap_trg on ws_students;
create trigger ws_students_cap_trg before insert on ws_students for each row execute function ws_students_cap();

-- ---------- регистрация по ссылке: связываем с карточкой ----------
-- Ученик вошёл по ссылке профориентолога: если в workspace есть карточка с его
-- почтой — привязываем к ней, иначе создаём карточку. Для школ ничего не меняется.
create or replace function school_join(p_code text, p_grade text, p_class text, p_name text)
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

  insert into school_members (school_id, user_id, grade, class_label)
  values (s.id, v_uid,
          case when p_grade in ('9','10','11','other') then p_grade else 'other' end,
          left(btrim(coalesce(p_class, '')), 12))
  on conflict (school_id, user_id) do update
    set grade = excluded.grade, class_label = excluded.class_label, status = 'active';

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
grant execute on function school_join(text, text, text, text) to authenticated;

-- school_by_code отдаёт kind — странице регистрации нужны разные слова
create or replace function school_by_code(p_code text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s schools; v_used int;
begin
  select * into s from schools where invite_code = upper(btrim(coalesce(p_code, '')));
  if s.id is null then return jsonb_build_object('ok', false, 'why', 'not_found'); end if;
  v_used := school_used_seats(s.id);
  return jsonb_build_object(
    'ok', true, 'name', s.name, 'city', s.city, 'kind', s.kind, 'plan', school_plan_label(s.plan),
    'contact_name', case when s.kind = 'counselor' then s.contact_name else null end,
    'seats', s.seats, 'used', v_used, 'ends_on', s.ends_on,
    'open', school_is_open(s) and v_used < s.seats,
    'why', case when not school_is_open(s) then 'closed' when v_used >= s.seats then 'full' else null end);
end $$;

-- ---------- сводка по ученикам workspace ----------
-- Ручные ученики — данные из ws_*, связанные — плюс живые данные их кабинета.
create or replace function ws_roster()
returns json
language plpgsql stable security definer set search_path = public as $$
declare v_school uuid; j json;
begin
  select id into v_school from schools where owner_user_id = auth.uid() and kind = 'counselor' order by created_at desc limit 1;
  if v_school is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(json_agg(t order by t.name), '[]'::json) into j
  from (
    select
      st.id, st.user_id, st.name, st.grade, st.level, st.stage, st.target, st.phone, st.email, st.parent_name, st.parent_phone, st.note,
      st.created_at, st.updated_at,
      (st.user_id is not null) as linked,
      -- собственные данные workspace
      (select count(*) from ws_apps a where a.student_id = st.id)                                         as ws_apps,
      (select count(*) from ws_apps a where a.student_id = st.id and a.status in ('applied','admit','reject','waitlist')) as ws_apps_sent,
      (select count(*) from ws_apps a where a.student_id = st.id and a.status = 'admit')                  as ws_offers,
      (select min(a.deadline) from ws_apps a where a.student_id = st.id and a.status in ('study','prep') and a.deadline >= current_date) as ws_next_deadline,
      (select count(*) from ws_docs d where d.student_id = st.id)                                         as ws_docs,
      (select count(*) from ws_docs d where d.student_id = st.id and d.status = 'ready')                  as ws_docs_ready,
      (select count(*) from ws_notes n where n.student_id = st.id and n.kind = 'task' and coalesce(n.done,false) = false) as tasks_open,
      (select min(n.due_on) from ws_notes n where n.student_id = st.id and n.kind = 'task' and coalesce(n.done,false) = false and n.due_on is not null) as task_due,
      (select max(n.created_at) from ws_notes n where n.student_id = st.id)                               as last_note,
      -- живые данные кабинета ученика, если связан
      (select ph.p_adm from probability_history ph where ph.user_id = st.user_id order by ph.ts desc limit 1) as p_adm,
      (select count(*) from portfolio_items pi where pi.user_id = st.user_id)                             as cab_apps,
      (select count(*) from portfolio_items pi where pi.user_id = st.user_id and pi.submitted_at is not null) as cab_apps_sent,
      (select count(*) from portfolio_items pi where pi.user_id = st.user_id and pi.outcome = 'admit')    as cab_offers,
      (select min(next_deadline(p.deadline_md)) from portfolio_items pi join programs p on p.id = pi.program_id
        where pi.user_id = st.user_id and pi.submitted_at is null)                                        as cab_next_deadline,
      (select count(*) from user_documents d where d.user_id = st.user_id)                                as cab_docs,
      (select count(*) from user_documents d where d.user_id = st.user_id and d.status = 'ready')         as cab_docs_ready,
      (select greatest(pr.updated_at, (select max(pi.updated_at) from portfolio_items pi where pi.user_id = st.user_id))
         from profiles pr where pr.user_id = st.user_id)                                                  as cab_last_active
    from ws_students st
    where st.school_id = v_school
  ) t;
  return j;
end $$;
grant execute on function ws_roster() to authenticated;

-- ---------- карточка связанного ученика: что он сам ведёт в кабинете ----------
-- Только метаданные: названия программ и статусы, документы со статусами.
-- Файлы ученика профориентологу не отдаём — они под RLS ученика.
create or replace function ws_student_cabinet(p_student uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid; v_school uuid;
begin
  select st.user_id, st.school_id into v_uid, v_school from ws_students st where st.id = p_student;
  if v_school is null or not ws_owner(v_school) then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_uid is null then return jsonb_build_object('linked', false); end if;
  return jsonb_build_object(
    'linked', true,
    'profile', (select jsonb_build_object('name', pr.name, 'level', pr.answers->>'level', 'field', pr.answers->'field',
                  'countries', pr.answers->'target_countries', 'pro_until', pr.pro_until, 'updated_at', pr.updated_at)
                  from profiles pr where pr.user_id = v_uid),
    'apps', (select coalesce(jsonb_agg(jsonb_build_object('program_id', pi.program_id, 'name', coalesce(p.name, pi.custom->>'name'),
                  'country', coalesce(p.country, pi.custom->>'country'), 'status', pi.status, 'submitted_at', pi.submitted_at, 'outcome', pi.outcome,
                  'deadline', next_deadline(p.deadline_md), 'url', p.source_url, 'readiness', pi.readiness) order by pi.updated_at desc), '[]'::jsonb)
             from portfolio_items pi left join programs p on p.id = pi.program_id where pi.user_id = v_uid),
    'docs', (select coalesce(jsonb_agg(jsonb_build_object('doc_type', d.doc_type, 'title', d.title, 'status', d.status,
                  'file_name', d.file_name, 'expires_on', d.expires_on, 'updated_at', d.updated_at) order by d.updated_at desc), '[]'::jsonb)
             from user_documents d where d.user_id = v_uid),
    'p_adm', (select ph.p_adm from probability_history ph where ph.user_id = v_uid order by ph.ts desc limit 1),
    'p_sch', (select ph.p_sch from probability_history ph where ph.user_id = v_uid order by ph.ts desc limit 1));
end $$;
grant execute on function ws_student_cabinet(uuid) to authenticated;

-- ---------- сегодня: что горит по всему workspace ----------
create or replace function ws_today()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_school uuid;
begin
  select id into v_school from schools where owner_user_id = auth.uid() and kind = 'counselor' order by created_at desc limit 1;
  if v_school is null then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'deadlines', (select coalesce(jsonb_agg(jsonb_build_object('student_id', st.id, 'student', st.name, 'name', a.name, 'country', a.country,
                    'deadline', a.deadline, 'days', a.deadline - current_date, 'status', a.status, 'url', a.apply_url) order by a.deadline), '[]'::jsonb)
                  from ws_apps a join ws_students st on st.id = a.student_id
                  where st.school_id = v_school and a.status in ('study','prep') and a.deadline between current_date and current_date + 45),
    'tasks', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'student_id', st.id, 'student', st.name, 'text', n.text, 'due_on', n.due_on) order by n.due_on nulls last, n.created_at), '[]'::jsonb)
              from ws_notes n join ws_students st on st.id = n.student_id
              where st.school_id = v_school and n.kind = 'task' and coalesce(n.done, false) = false),
    'missing_docs', (select coalesce(jsonb_agg(jsonb_build_object('student_id', st.id, 'student', st.name, 'missing', m.cnt) order by m.cnt desc), '[]'::jsonb)
                     from ws_students st join lateral (select count(*) cnt from ws_docs d where d.student_id = st.id and d.status <> 'ready') m on true
                     where st.school_id = v_school and st.stage in ('docs','applying') and m.cnt > 0));
end $$;
grant execute on function ws_today() to authenticated;

-- ---------- школа глазами ученика: у профориентолога свои слова ----------
create or replace function school_for_student()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s schools; m school_members;
begin
  select sm.* into m from school_members sm where sm.user_id = auth.uid() and sm.status = 'active'
   order by sm.joined_at desc limit 1;
  if m.id is null then return null; end if;
  select * into s from schools where id = m.school_id;
  return jsonb_build_object('name', s.name, 'city', s.city, 'kind', s.kind, 'grade', m.grade, 'class_label', m.class_label,
    'contact_name', s.contact_name, 'contact_role', s.contact_role,
    'contact_email', s.contact_email, 'contact_phone', s.contact_phone,
    'ends_on', s.ends_on, 'active', school_is_open(s));
end $$;

-- школа/workspace самого владельца — отдаём kind, чтобы кабинеты не путались
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
    'contact_name', s.contact_name, 'contact_email', s.contact_email, 'contact_phone', s.contact_phone,
    'students', (select count(*) from ws_students where school_id = s.id));
end $$;

select school_plan_label('c50') as label, 'ok' as ok;
