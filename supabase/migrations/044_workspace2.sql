-- ============================================================
-- Scholary 044 · Workspace профориентолога 2.0 (web-75)
--
-- Зачем. Workspace был списком учеников с дедлайнами. Теперь у профориентолога
-- есть очередь «Сейчас», «следующий шаг с датой» по каждому ученику, встречи
-- с временем, статусы для семьи, архив вместо удаления, ритм по неделям
-- (активность, как cab_activity у ученика), импорт из Excel и понедельничный
-- дайджест в Telegram. Всё считается для владельца workspace (ws_owner),
-- права выдаются здесь же (урок 043: без GRANT клиент молча пишет в localStorage).
-- Идемпотентно, деструктивного SQL нет.
-- ============================================================

-- ---------- 1. Ученик: следующий шаг, семья, архив ----------
alter table ws_students add column if not exists next_step     text check (length(next_step) <= 140);
alter table ws_students add column if not exists next_step_on  date;
alter table ws_students add column if not exists last_status_at timestamptz;   -- когда семья последний раз получала статус
alter table ws_students add column if not exists parent_email  text;
alter table ws_students add column if not exists archived      boolean not null default false;
create index if not exists ws_students_next_idx on ws_students (school_id, next_step_on);

-- ---------- 2. Заметки: встречи с временем, статусы семье, смены этапа ----------
alter table ws_notes add column if not exists at_time  time;          -- для kind = meeting
alter table ws_notes add column if not exists minutes  smallint check (minutes between 5 and 480);
alter table ws_notes drop constraint if exists ws_notes_kind_chk;
alter table ws_notes add constraint ws_notes_kind_chk check (kind in ('note','call','parent','meeting','task','status','stage','doc'));
create index if not exists ws_notes_due_idx on ws_notes (student_id, due_on);

-- done_at: когда задача закрыта — для «прогресса недели» (раньше знали только факт done)
alter table ws_notes add column if not exists done_at timestamptz;
create or replace function ws_notes_done_at()
returns trigger language plpgsql as $$
begin
  if new.kind = 'task' and coalesce(new.done, false) = true and (tg_op = 'INSERT' or coalesce(old.done, false) = false) then new.done_at := now(); end if;
  if new.kind = 'task' and coalesce(new.done, false) = false then new.done_at := null; end if;
  return new;
end $$;
drop trigger if exists ws_notes_done_at_trg on ws_notes;
create trigger ws_notes_done_at_trg before insert or update on ws_notes for each row execute function ws_notes_done_at();


-- ---------- 3. Место = активная карточка; архив освобождает место ----------
create or replace function school_used_seats(p_school uuid)
returns int language sql stable as $$
  select case when (select kind from schools where id = p_school) = 'counselor'
              then (select count(*)::int from ws_students where school_id = p_school and archived = false)
              else (select count(*)::int from school_members where school_id = p_school and status = 'active') end;
$$;

create or replace function ws_students_cap()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_seats int; v_used int;
begin
  if tg_op = 'UPDATE' and (old.archived = new.archived or new.archived = true) then return new; end if;
  select seats into v_seats from schools where id = new.school_id;
  select count(*) into v_used from ws_students where school_id = new.school_id and archived = false and id <> new.id;
  if v_used >= coalesce(v_seats, 0) then
    raise exception 'seats_full' using errcode = 'P0001', hint = 'Места по тарифу закончились';
  end if;
  return new;
end $$;
drop trigger if exists ws_students_cap_trg on ws_students;
create trigger ws_students_cap_trg before insert or update of archived on ws_students for each row execute function ws_students_cap();

-- ---------- 4. Ритм профориентолога: активность по дням ----------
create table if not exists ws_activity (
  school_id uuid not null references schools(id) on delete cascade,
  day       date not null,
  actions   int  not null default 1,
  progress  boolean not null default false,   -- «неделя спланирована» / шаг сделан
  primary key (school_id, day)
);
alter table ws_activity enable row level security;
drop policy if exists ws_activity_owner on ws_activity;
create policy ws_activity_owner on ws_activity for select to authenticated using (ws_owner(school_id));
grant select on ws_activity to authenticated;
revoke all on ws_activity from anon;

create or replace function ws_touch(p_progress boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_school uuid; v_day date := (now() at time zone 'Asia/Almaty')::date;
begin
  select id into v_school from schools where owner_user_id = auth.uid() and kind = 'counselor' order by created_at desc limit 1;
  if v_school is null then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into ws_activity (school_id, day, actions, progress) values (v_school, v_day, 1, coalesce(p_progress, false))
  on conflict (school_id, day) do update set actions = ws_activity.actions + 1, progress = ws_activity.progress or excluded.progress;
  return jsonb_build_object('ok', true, 'day', v_day);
end $$;
revoke all on function ws_touch(boolean) from public, anon;
grant execute on function ws_touch(boolean) to authenticated;

-- ---------- 5. Настройки ритма владельца ----------
alter table schools add column if not exists prefs jsonb not null default '{}'::jsonb;   -- {touch_goal, quiet:[пн], digest, rhythm}
create or replace function school_set_prefs(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_school uuid;
begin
  select id into v_school from schools where owner_user_id = auth.uid() order by created_at desc limit 1;
  if v_school is null then raise exception 'forbidden' using errcode = '42501'; end if;
  update schools set prefs = coalesce(p, '{}'::jsonb) - 'secret' where id = v_school;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function school_set_prefs(jsonb) from public, anon;
grant execute on function school_set_prefs(jsonb) to authenticated;

-- ---------- 6. Ростер с новыми полями ----------
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
      st.id, st.user_id, st.name, st.grade, st.level, st.stage, st.target, st.phone, st.email, st.parent_name, st.parent_phone, st.parent_email, st.note,
      st.next_step, st.next_step_on, st.last_status_at, st.archived,
      st.created_at, st.updated_at,
      (st.user_id is not null) as linked,
      (select count(*) from ws_apps a where a.student_id = st.id)                                         as ws_apps,
      (select count(*) from ws_apps a where a.student_id = st.id and a.status in ('applied','admit','reject','waitlist')) as ws_apps_sent,
      (select count(*) from ws_apps a where a.student_id = st.id and a.status = 'admit')                  as ws_offers,
      (select min(a.deadline) from ws_apps a where a.student_id = st.id and a.status in ('study','prep') and a.deadline >= current_date) as ws_next_deadline,
      (select count(*) from ws_docs d where d.student_id = st.id)                                         as ws_docs,
      (select count(*) from ws_docs d where d.student_id = st.id and d.status = 'ready')                  as ws_docs_ready,
      (select count(*) from ws_notes n where n.student_id = st.id and n.kind = 'task' and coalesce(n.done,false) = false) as tasks_open,
      (select min(n.due_on) from ws_notes n where n.student_id = st.id and n.kind = 'task' and coalesce(n.done,false) = false and n.due_on is not null) as task_due,
      (select max(n.created_at) from ws_notes n where n.student_id = st.id)                               as last_note,
      (select max(n.created_at) from ws_notes n where n.student_id = st.id and n.kind in ('note','call','parent','meeting','status')) as last_touch,
      (select min(n.due_on) from ws_notes n where n.student_id = st.id and n.kind = 'meeting' and n.due_on >= current_date) as next_meeting,
      (select ph.p_adm from probability_history ph where ph.user_id = st.user_id order by ph.ts desc limit 1) as p_adm,
      (select count(*) from portfolio_items pi where pi.user_id = st.user_id)                             as cab_apps,
      (select count(*) from portfolio_items pi where pi.user_id = st.user_id and pi.submitted_at is not null) as cab_apps_sent,
      (select count(*) from portfolio_items pi where pi.user_id = st.user_id and pi.outcome = 'admit')    as cab_offers,
      (select min(next_deadline(p.deadline_md)) from portfolio_items pi join programs p on p.id = pi.program_id
        where pi.user_id = st.user_id and pi.submitted_at is null)                                        as cab_next_deadline,
      (select count(*) from user_documents d where d.user_id = st.user_id)                                as cab_docs,
      (select count(*) from user_documents d where d.user_id = st.user_id and d.status = 'ready')         as cab_docs_ready,
      (select greatest(pr.updated_at, (select max(pi.updated_at) from portfolio_items pi where pi.user_id = st.user_id))
         from profiles pr where pr.user_id = st.user_id)                                                  as cab_last_active,
      (select max(ca.day) from cab_activity ca where ca.user_id = st.user_id)                             as cab_last_day
    from ws_students st
    where st.school_id = v_school
  ) t;
  return j;
end $$;
grant execute on function ws_roster() to authenticated;

-- ---------- 7. Всё для «Сегодня», «Недели» и «Календаря» одним запросом ----------
-- Очередь, здоровье и календарь считает клиент — база отдаёт сырьё:
-- подачи с дедлайнами, открытые задачи, встречи, движение за неделю, активность, настройки.
create or replace function ws_dashboard()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_school uuid; v_mon date := date_trunc('week', (now() at time zone 'Asia/Almaty')::date)::date; v_today date := (now() at time zone 'Asia/Almaty')::date;
begin
  select id into v_school from schools where owner_user_id = auth.uid() and kind = 'counselor' order by created_at desc limit 1;
  if v_school is null then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'today', v_today, 'week_start', v_mon,
    'prefs', (select prefs from schools where id = v_school),
    'apps', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'student_id', a.student_id, 'name', a.name, 'country', a.country,
                'deadline', a.deadline, 'status', a.status, 'url', a.apply_url) order by a.deadline nulls last), '[]'::jsonb)
             from ws_apps a join ws_students st on st.id = a.student_id where st.school_id = v_school and st.archived = false and a.deadline is not null),
    'tasks', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'student_id', n.student_id, 'text', n.text, 'due_on', n.due_on, 'created_at', n.created_at) order by n.due_on nulls last, n.created_at), '[]'::jsonb)
              from ws_notes n join ws_students st on st.id = n.student_id
              where st.school_id = v_school and st.archived = false and n.kind = 'task' and coalesce(n.done, false) = false),
    'meetings', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'student_id', n.student_id, 'text', n.text, 'due_on', n.due_on, 'at_time', n.at_time, 'minutes', n.minutes) order by n.due_on, n.at_time nulls last), '[]'::jsonb)
                 from ws_notes n join ws_students st on st.id = n.student_id
                 where st.school_id = v_school and n.kind = 'meeting' and n.due_on between v_today - 7 and v_today + 60),
    'week', jsonb_build_object(
      'touches',   (select count(*) from ws_notes n join ws_students st on st.id = n.student_id where st.school_id = v_school and n.created_at >= v_mon and n.kind in ('note','call','parent','meeting','status')),
      'tasks_done', (select count(*) from ws_notes n join ws_students st on st.id = n.student_id where st.school_id = v_school and n.kind = 'task' and n.done = true and n.done_at >= v_mon),
      'docs_ready', (select count(*) from ws_docs d join ws_students st on st.id = d.student_id where st.school_id = v_school and d.status = 'ready' and d.updated_at >= v_mon),
      'apps_sent',  (select count(*) from ws_apps a join ws_students st on st.id = a.student_id where st.school_id = v_school and a.status in ('applied','admit','waitlist') and a.updated_at >= v_mon),
      'statuses',   (select count(*) from ws_notes n join ws_students st on st.id = n.student_id where st.school_id = v_school and n.kind = 'status' and n.created_at >= v_mon),
      'moved',      (select coalesce(jsonb_agg(distinct st.id), '[]'::jsonb) from ws_students st where st.school_id = v_school and (
                        exists (select 1 from ws_notes n where n.student_id = st.id and (n.created_at >= v_mon or n.done_at >= v_mon))
                        or exists (select 1 from ws_docs d where d.student_id = st.id and d.updated_at >= v_mon and d.status = 'ready')
                        or exists (select 1 from ws_apps a where a.student_id = st.id and a.updated_at >= v_mon))),
      'prev', jsonb_build_object(
        'touches',    (select count(*) from ws_notes n join ws_students st on st.id = n.student_id where st.school_id = v_school and n.created_at >= v_mon - 7 and n.created_at < v_mon and n.kind in ('note','call','parent','meeting','status')),
        'tasks_done', (select count(*) from ws_notes n join ws_students st on st.id = n.student_id where st.school_id = v_school and n.kind = 'task' and n.done = true and n.done_at >= v_mon - 7 and n.done_at < v_mon))),
    'activity', (select coalesce(jsonb_agg(jsonb_build_object('day', a.day, 'progress', a.progress, 'actions', a.actions) order by a.day), '[]'::jsonb)
                 from ws_activity a where a.school_id = v_school and a.day >= v_today - 400));
end $$;
grant execute on function ws_dashboard() to authenticated;

-- ---------- 8. Импорт из Excel/CSV ----------
-- p_rows: [{name, grade, level, phone, email, parent_name, parent_phone, target, stage}]; до 200 строк.
-- Дубли по почте или по имени пропускаются; при исчерпании мест — останавливаемся и говорим сколько вошло.
create or replace function ws_import(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_school uuid; r jsonb; v_in int := 0; v_dup int := 0; v_full boolean := false; v_name text; v_email text;
begin
  select id into v_school from schools where owner_user_id = auth.uid() and kind = 'counselor' order by created_at desc limit 1;
  if v_school is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then return jsonb_build_object('ok', false, 'why', 'rows'); end if;
  for r in select * from jsonb_array_elements(p_rows) limit 200 loop
    v_name := left(trim(coalesce(r->>'name', '')), 80); v_email := lower(nullif(trim(coalesce(r->>'email', '')), ''));
    if v_name = '' then continue; end if;
    if exists (select 1 from ws_students st where st.school_id = v_school and (lower(st.name) = lower(v_name) or (v_email is not null and lower(st.email) = v_email))) then v_dup := v_dup + 1; continue; end if;
    begin
      insert into ws_students (school_id, name, grade, level, phone, email, parent_name, parent_phone, target, stage)
      values (v_school, v_name,
        case when r->>'grade' in ('9','10','11','grad','other') then r->>'grade' else '11' end,
        case when r->>'level' in ('bachelor','master','phd') then r->>'level' else 'bachelor' end,
        left(nullif(trim(coalesce(r->>'phone','')), ''), 24), v_email, left(nullif(trim(coalesce(r->>'parent_name','')), ''), 80),
        left(nullif(trim(coalesce(r->>'parent_phone','')), ''), 24), left(nullif(trim(coalesce(r->>'target','')), ''), 120),
        case when r->>'stage' in ('intake','docs','applying','submitted','admitted','paused') then r->>'stage' else 'intake' end);
      v_in := v_in + 1;
    exception when others then
      if sqlerrm like '%seats_full%' then v_full := true; exit; else raise; end if;
    end;
  end loop;
  return jsonb_build_object('ok', true, 'inserted', v_in, 'skipped', v_dup, 'seats_full', v_full);
end $$;
revoke all on function ws_import(jsonb) from public, anon;
grant execute on function ws_import(jsonb) to authenticated;

-- ---------- 9. Дайджест понедельника профориентологу (Telegram) ----------
-- Тот же секрет и журнал tg_sent, что у дедлайнов: program_id = 'ws:<пн недели>', milestone 110.
create or replace function ws_digest_due(p_secret text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_secret text; v_today date := (now() at time zone 'Asia/Almaty')::date; v_mon date; j jsonb;
begin
  select value into v_secret from app_secrets where name = 'tiptop_webhook';
  if v_secret is null or length(v_secret) < 24 or p_secret is null or p_secret <> v_secret then return jsonb_build_object('ok', false, 'why', 'forbidden'); end if;
  v_mon := date_trunc('week', v_today)::date;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into j from (
    select s.owner_user_id as user_id, t.chat_id, coalesce(s.contact_name, s.name) as name, s.id as school_id,
      (select count(*) from ws_students st where st.school_id = s.id and st.archived = false) as students,
      (select count(*) from ws_apps a join ws_students st on st.id = a.student_id where st.school_id = s.id and st.archived = false and a.status in ('study','prep') and a.deadline between v_today and v_today + 7) as deadlines_7,
      (select count(*) from ws_apps a join ws_students st on st.id = a.student_id where st.school_id = s.id and st.archived = false and a.status in ('study','prep') and a.deadline between v_today and v_today + 45) as deadlines_45,
      (select count(*) from ws_notes n join ws_students st on st.id = n.student_id where st.school_id = s.id and st.archived = false and n.kind = 'task' and coalesce(n.done,false) = false and n.due_on < v_today) as overdue,
      (select count(*) from ws_notes n join ws_students st on st.id = n.student_id where st.school_id = s.id and n.kind = 'meeting' and n.due_on between v_today and v_today + 6) as meetings,
      (select count(*) from ws_students st where st.school_id = s.id and st.archived = false and st.stage not in ('admitted','paused') and (st.next_step is null or st.next_step_on < v_today)) as no_step,
      (select count(*) from ws_students st where st.school_id = s.id and st.archived = false and st.stage not in ('admitted','paused')
         and coalesce((select max(n.created_at) from ws_notes n where n.student_id = st.id), st.created_at) < now() - interval '14 days') as idle
    from schools s
    join tg_links t on t.user_id = s.owner_user_id and t.chat_id is not null
    join auth.users u on u.id = s.owner_user_id
    where s.kind = 'counselor' and s.status = 'active' and (s.ends_on is null or s.ends_on >= v_today)
      and coalesce((t.prefs->>'ws_digest')::boolean, true)
      and not is_test_account(u.email)
      and not exists (select 1 from tg_sent x where x.user_id = s.owner_user_id and x.program_id = 'ws:' || v_mon::text and x.milestone = 110)
  ) x where x.students > 0;
  return jsonb_build_object('ok', true, 'week_start', v_mon, 'milestone', 110, 'items', j);
end $$;
revoke all on function ws_digest_due(text) from public, authenticated;
grant execute on function ws_digest_due(text) to anon;

-- ---------- 10. Права (см. 043) ----------
grant select, insert, update, delete on ws_students, ws_apps, ws_docs, ws_notes to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on ws_students, ws_apps, ws_docs, ws_notes, ws_activity from anon;

select 'workspace2 ok' as status,
  has_table_privilege('authenticated', 'ws_activity', 'select') as act_select,
  (select count(*) from information_schema.columns where table_name = 'ws_students' and column_name in ('next_step','next_step_on','last_status_at','parent_email','archived')) as student_cols,
  (select count(*) from information_schema.columns where table_name = 'ws_notes' and column_name in ('at_time','minutes','done_at')) as note_cols;
