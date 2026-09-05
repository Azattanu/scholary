-- ============================================================
-- Scholary 042 · Кабинет: возвращаемость (web-74)
--
-- Зачем. Кабинет был инструментом «зайти и загрузить документ». Теперь у
-- него есть путь сезона по неделям, задачи недели, недели с прогрессом,
-- вехи и материалы недели — и всё это нужно помнить между заходами.
-- Задачи недели считает клиент детерминированно (уровень, подачи, документы,
-- дедлайны каталога) — база хранит только то, что человек с ними сделал.
-- Активность пишется по АККАУНТУ (а не по устройству, как events) — иначе
-- возвращаемость не посчитать. Всё под RLS «своё видит только владелец»,
-- админские функции закрыты is_admin(). Идемпотентно.
-- ============================================================

-- ---------- 1. Активность по дням: для «недель с прогрессом» и метрик ----------
create table if not exists cab_activity (
  user_id    uuid    not null references auth.users(id) on delete cascade,
  day        date    not null,                        -- день по Алматы
  actions    int     not null default 0,              -- заходы/действия за день
  progress   boolean not null default false,          -- было ли содержательное действие
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table cab_activity enable row level security;
drop policy if exists cab_activity_own on cab_activity;
create policy cab_activity_own on cab_activity for select to authenticated using (user_id = auth.uid());
create index if not exists cab_activity_day_idx on cab_activity (day);

-- Отметить сегодняшний день. Клиент не может подделать дату: день ставит сервер.
create or replace function cab_touch(p_progress boolean default false)
returns json
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Almaty')::date; r cab_activity;
begin
  if auth.uid() is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  insert into cab_activity (user_id, day, actions, progress)
  values (auth.uid(), d, 1, coalesce(p_progress, false))
  on conflict (user_id, day) do update
    set actions = cab_activity.actions + 1,
        progress = cab_activity.progress or excluded.progress,
        updated_at = now()
  returning * into r;
  return json_build_object('ok', true, 'day', r.day, 'progress', r.progress);
end $$;
grant execute on function cab_touch(boolean) to authenticated;

-- ---------- 2. Состояние задач недели ----------
-- Ключ задачи детерминированный: 'YYYY-MM-DD:тип:объект' (понедельник недели).
create table if not exists cab_task_state (
  user_id    uuid not null references auth.users(id) on delete cascade,
  task_key   text not null check (length(task_key) between 8 and 160),
  status     text not null default 'done' check (status in ('done', 'skipped', 'moved', 'open')),
  when_day   smallint check (when_day between 1 and 7),   -- день недели, когда человек планирует
  week_start date,
  title      text check (length(title) <= 200),            -- чтобы перенесённая задача читалась своими словами
  updated_at timestamptz not null default now(),
  primary key (user_id, task_key)
);
alter table cab_task_state add column if not exists title text check (length(title) <= 200);
alter table cab_task_state enable row level security;
drop policy if exists cab_task_own on cab_task_state;
create policy cab_task_own on cab_task_state for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists cab_task_week_idx on cab_task_state (user_id, week_start);

-- ---------- 3. Вехи (только за реальные события; без очков) ----------
create table if not exists cab_achievements (
  user_id   uuid not null references auth.users(id) on delete cascade,
  key       text not null check (length(key) between 3 and 60),
  earned_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table cab_achievements enable row level security;
drop policy if exists cab_ach_own on cab_achievements;
create policy cab_ach_own on cab_achievements for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- 4. Настройки недели в профиле ----------
-- {goal: 3, quiet: ['2026-12-21'], freeze: {'2026-11': '2026-11-09'}}
alter table profiles add column if not exists cab jsonb not null default '{}'::jsonb;

-- ---------- 5. Материалы для кабинета: заполняет владелец из админки ----------
-- Никаких выдуманных авторов: пока таблица пуста — блок в кабинете не показывается.
create table if not exists cab_content (
  id         bigint generated always as identity primary key,
  kind       text not null default 'tip' check (kind in ('tip', 'article', 'video', 'story', 'guide')),
  title      text not null check (length(title) between 3 and 140),
  url        text check (url is null or url ~* '^https?://'),        -- только веб-ссылки: в кабинете это href
  body       text,
  author     text,
  level      text check (level in ('bachelor', 'master', 'phd')),   -- null = всем
  week_from  smallint check (week_from between 1 and 44),            -- недели сезона; null = всегда
  week_to    smallint check (week_to between 1 and 44),
  active     boolean not null default true,
  sort       int not null default 100,
  created_at timestamptz not null default now()
);
alter table cab_content enable row level security;
drop policy if exists cab_content_read on cab_content;
create policy cab_content_read on cab_content for select to authenticated using (active);

create or replace function admin_cab_content_list()
returns json language plpgsql stable security definer set search_path = public, auth as $$
declare j json;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(json_agg(t order by t.sort, t.id desc), '[]'::json) into j
    from (select id, kind, title, url, body, author, level, week_from, week_to, active, sort, created_at from cab_content) t;
  return j;
end $$;
grant execute on function admin_cab_content_list() to authenticated;

create or replace function admin_cab_content_upsert(p jsonb)
returns json language plpgsql security definer set search_path = public, auth as $$
declare v_id bigint;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p is null or coalesce(p->>'title', '') = '' then raise exception 'title required'; end if;
  if (p->>'id') is not null and (p->>'id') ~ '^\d+$' then
    update cab_content set
      kind = coalesce(nullif(p->>'kind', ''), kind), title = left(p->>'title', 140),
      url = nullif(p->>'url', ''), body = left(p->>'body', 2000), author = left(nullif(p->>'author', ''), 80),
      level = nullif(p->>'level', ''), week_from = nullif(p->>'week_from', '')::smallint, week_to = nullif(p->>'week_to', '')::smallint,
      active = coalesce((p->>'active')::boolean, active), sort = coalesce((p->>'sort')::int, sort)
    where id = (p->>'id')::bigint returning id into v_id;
  else
    insert into cab_content (kind, title, url, body, author, level, week_from, week_to, active, sort)
    values (coalesce(nullif(p->>'kind', ''), 'tip'), left(p->>'title', 140), nullif(p->>'url', ''), left(p->>'body', 2000),
            left(nullif(p->>'author', ''), 80), nullif(p->>'level', ''), nullif(p->>'week_from', '')::smallint,
            nullif(p->>'week_to', '')::smallint, coalesce((p->>'active')::boolean, true), coalesce((p->>'sort')::int, 100))
    returning id into v_id;
  end if;
  return json_build_object('ok', true, 'id', v_id);
end $$;
grant execute on function admin_cab_content_upsert(jsonb) to authenticated;

create or replace function admin_cab_content_delete(p_id bigint)
returns json language plpgsql security definer set search_path = public, auth as $$
declare n int;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from cab_content where id = p_id; get diagnostics n = row_count;
  return json_build_object('ok', true, 'deleted', n);
end $$;
grant execute on function admin_cab_content_delete(bigint) to authenticated;

-- ---------- 5а. Всё состояние кабинета одним запросом ----------
-- Кабинет и так грузит профиль, подачи, документы и каталог; новым блокам
-- полагается один запрос, а не четыре.
create or replace function cab_state()
returns json
language plpgsql stable security definer set search_path = public as $$
declare j json;
begin
  if auth.uid() is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  select json_build_object(
    'tasks', (select coalesce(json_agg(t), '[]'::json) from (
       select task_key, status, when_day, week_start, title, updated_at from cab_task_state
       where user_id = auth.uid() and (week_start is null or week_start >= current_date - 60)) t),
    'activity', (select coalesce(json_agg(a order by a.day), '[]'::json) from (
       select day, progress, actions from cab_activity where user_id = auth.uid() and day >= current_date - 400) a),
    'ach', (select coalesce(json_agg(c), '[]'::json) from (
       select key, earned_at from cab_achievements where user_id = auth.uid()) c),
    'content', (select coalesce(json_agg(x order by x.sort, x.id desc), '[]'::json) from (
       select id, kind, title, url, body, author, level, week_from, week_to, sort from cab_content where active limit 30) x)
  ) into j;
  return j;
end $$;
grant execute on function cab_state() to authenticated;

-- ---------- 6. Недельный дайджест и «неделя ещё не засчитана» в Telegram ----------
-- Тот же секрет и тот же журнал tg_sent, что у дедлайнов: program_id = 'week:<пн недели>',
-- milestone 100 (дайджест) / 101 (напоминание) — так одно письмо в неделю на каждый вид.
create or replace function season_week(p_day date default (now() at time zone 'Asia/Almaty')::date)
returns int language sql immutable as $$
  select greatest(1, least(44,
    floor((p_day - make_date(case when extract(month from p_day) >= 9 then extract(year from p_day)::int else extract(year from p_day)::int - 1 end, 9, 1))::int / 7) + 1));
$$;

create or replace function tg_week_due(p_secret text, p_kind text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_secret text; v_rows jsonb;
  v_today date := (now() at time zone 'Asia/Almaty')::date;
  v_week  date := (now() at time zone 'Asia/Almaty')::date - ((extract(isodow from (now() at time zone 'Asia/Almaty'))::int) - 1);
  v_ms int := case when p_kind = 'nudge' then 101 else 100 end;
begin
  select value into v_secret from app_secrets where name = 'tiptop_webhook';
  if v_secret is null or length(v_secret) < 24 or p_secret is null or p_secret <> v_secret then
    return jsonb_build_object('ok', false, 'why', 'forbidden');
  end if;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_rows
  from (
    select
      t.user_id, t.chat_id,
      coalesce(pr.name, 'друг') as name,
      season_week(v_today) as week,
      (select count(*) from portfolio_items pi where pi.user_id = t.user_id and pi.submitted_at is null) as apps_open,
      (select count(*) from portfolio_items pi where pi.user_id = t.user_id) as apps_total,
      (select count(*) from user_documents d where d.user_id = t.user_id and d.status = 'ready') as docs_ready,
      (select count(*) from user_documents d where d.user_id = t.user_id) as docs_total,
      (select count(*) from cab_task_state s where s.user_id = t.user_id and s.week_start = v_week and s.status = 'done') as tasks_done,
      (select count(*) from cab_task_state s where s.user_id = t.user_id and s.week_start = v_week - 7 and s.status = 'done') as tasks_done_prev,
      nd.program as next_program, nd.dl as next_deadline, (nd.dl - v_today) as next_days,
      (select count(*) from cab_activity a where a.user_id = t.user_id and a.progress and a.day >= v_week) as progress_days
    from tg_links t
      join profiles pr on pr.user_id = t.user_id
      left join lateral (
        select p.name as program, next_deadline(p.deadline_md) as dl
        from portfolio_items pi join programs p on p.id = pi.program_id
        where pi.user_id = t.user_id and pi.submitted_at is null and next_deadline(p.deadline_md) is not null
        order by next_deadline(p.deadline_md) limit 1
      ) nd on true
    where t.chat_id is not null
      and (
        (p_kind = 'digest' and coalesce((t.prefs->>'digest')::boolean, true))
        or
        (p_kind = 'nudge' and coalesce((t.prefs->>'week')::boolean, true)
           and not exists (select 1 from cab_activity a where a.user_id = t.user_id and a.progress and a.day >= v_week)
           and exists (select 1 from portfolio_items pi where pi.user_id = t.user_id and pi.submitted_at is null))
      )
      and not exists (select 1 from tg_sent s where s.user_id = t.user_id and s.program_id = 'week:' || v_week::text and s.milestone = v_ms)
    limit 500
  ) x;
  return jsonb_build_object('ok', true, 'week_start', v_week, 'kind', p_kind, 'milestone', v_ms, 'items', v_rows);
end $$;
revoke all on function tg_week_due(text, text) from public, authenticated;
grant execute on function tg_week_due(text, text) to anon;

-- ---------- 7. Метрики возвращаемости для панели владельца ----------
create or replace function admin_retention(p_days int default 30)
returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare j json; d int := greatest(7, least(coalesce(p_days, 30), 365));
  today date := (now() at time zone 'Asia/Almaty')::date;
  wk date := (now() at time zone 'Asia/Almaty')::date - ((extract(isodow from (now() at time zone 'Asia/Almaty'))::int) - 1);
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  with
  act as (  -- активность реальных аккаунтов (тестовые исключены)
    select a.user_id, a.day, a.progress from cab_activity a
      join auth.users u on u.id = a.user_id
    where not is_test_account(u.email) and a.day >= today - d
  ),
  first as (select user_id, min(day) as d0 from cab_activity a join auth.users u on u.id = a.user_id where not is_test_account(u.email) group by 1),
  cohort as (
    select f.user_id, f.d0, date_trunc('week', f.d0)::date as w0,
      bool_or(a.day = f.d0 + 1) as d1,
      bool_or(a.day between f.d0 + 1 and f.d0 + 7) as w1,
      bool_or(a.day between f.d0 + 8 and f.d0 + 14) as w2,
      bool_or(a.day between f.d0 + 15 and f.d0 + 21) as w3,
      bool_or(a.day between f.d0 + 22 and f.d0 + 28) as w4,
      bool_or(a.day between f.d0 + 1 and f.d0 + 30) as d30,
      count(distinct a.day) as active_days
    from first f join cab_activity a on a.user_id = f.user_id
    where f.d0 >= today - d
    group by 1, 2, 3
  ),
  weekly as (
    select date_trunc('week', day)::date as w, count(distinct user_id) as wau,
      count(distinct user_id) filter (where cnt >= 2) as wau2,
      count(distinct user_id) filter (where prog) as wau_progress
    from (select user_id, day, count(*) over (partition by user_id, date_trunc('week', day)) as cnt,
                 bool_or(progress) over (partition by user_id, date_trunc('week', day)) as prog from act) x
    group by 1
  ),
  tasks as (
    select s.week_start as w, count(*) filter (where s.status = 'done') as done, count(distinct s.user_id) filter (where s.status = 'done') as users
    from cab_task_state s join auth.users u on u.id = s.user_id
    where not is_test_account(u.email) and s.week_start >= today - d group by 1
  ),
  streaks as (
    select user_id, count(distinct date_trunc('week', day)) as weeks_progress from act where progress group by 1
  )
  select to_json(t) into j from (
    select d as period_days,
      (select count(distinct user_id) from act where day >= today - 6)                       as active_7d,
      (select count(distinct user_id) from act where day >= today - 29)                      as active_30d,
      (select count(distinct user_id) from act where day >= wk)                              as active_this_week,
      (select count(distinct user_id) from act where day >= wk and user_id in
         (select user_id from act where day >= wk group by user_id having count(*) >= 2))    as active_this_week_2plus,
      (select count(*) from cohort)                                                          as cohort_users,
      (select round(100.0 * count(*) filter (where d1) / greatest(count(*), 1)) from cohort where d0 <= today - 1)   as d1_pct,
      (select round(100.0 * count(*) filter (where w1) / greatest(count(*), 1)) from cohort where d0 <= today - 7)   as w1_pct,
      (select round(100.0 * count(*) filter (where w2) / greatest(count(*), 1)) from cohort where d0 <= today - 14)  as w2_pct,
      (select round(100.0 * count(*) filter (where w3) / greatest(count(*), 1)) from cohort where d0 <= today - 21)  as w3_pct,
      (select round(100.0 * count(*) filter (where w4) / greatest(count(*), 1)) from cohort where d0 <= today - 28)  as w4_pct,
      (select round(100.0 * count(*) filter (where d30) / greatest(count(*), 1)) from cohort where d0 <= today - 30) as d30_pct,
      (select round(avg(active_days), 2) from cohort)                                          as avg_active_days,
      (select coalesce(sum(done), 0) from tasks)                                               as tasks_done,
      (select coalesce(sum(done), 0) from tasks where w = wk)                                  as tasks_done_this_week,
      (select round(avg(weeks_progress), 2) from streaks)                                      as avg_weeks_progress,
      (select count(*) from streaks where weeks_progress >= 4)                                 as users_4plus_weeks,
      (select count(*) from cab_achievements ca join auth.users u on u.id = ca.user_id
         where not is_test_account(u.email) and ca.earned_at >= today - d)                     as badges,
      (select count(*) from tg_links t join auth.users u on u.id = t.user_id
         where t.chat_id is not null and not is_test_account(u.email))                         as tg_linked,
      (select count(*) from payments p where p.status = 'success' and not coalesce(p.test_mode, false)
         and p.kind in ('pro_month', 'pro_season') and p.created_at >= today - d)              as pro_payments,
      (select count(*) from (select user_email from payments p where p.status = 'success' and not coalesce(p.test_mode, false)
         and p.kind in ('pro_month', 'pro_season') group by user_email having count(*) >= 2) r) as pro_renewals,
      (select count(distinct lead_id) from events e where e.event = 'cab_deeplink' and e.ts >= today - d) as deeplink_returns,
      (select coalesce(json_agg(w order by w.w), '[]'::json) from (
         select w.w, w.wau, w.wau2, w.wau_progress, coalesce(t.done, 0) as tasks_done, coalesce(t.users, 0) as task_users
         from weekly w left join tasks t on t.w = w.w) w)                                       as weekly
  ) t;
  return j;
end $$;
grant execute on function admin_retention(int) to authenticated;

-- ---------- 8. «Новое в каталоге» честно: дата добавления программы ----------
-- updated_at у всего каталога сдвинулся массовыми правками (web-70), и плашка «новое»
-- по нему стояла бы на каждой карточке. Заводим added_at: старые строки получают
-- дату базовой линии каталога (ничего не «новое»), новые вставки — now().
alter table programs add column if not exists added_at timestamptz;
update programs set added_at = timestamptz '2026-08-01 00:00:00+05' where added_at is null;
alter table programs alter column added_at set default now();
-- programs_public — select * с замороженным списком колонок (см. 039): добавляем колонку в конец
create or replace view programs_public as
  select * from programs where duplicate_of is null;
grant select on programs_public to anon, authenticated;

select 'cabinet_retention ok' as status, season_week(date '2026-09-01') as w1, season_week(date '2026-11-15') as w11, season_week(date '2027-01-15') as w20;
