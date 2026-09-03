-- ============================================================
-- Scholary · 027: Data Core — каталог для движка v3 + слой исходов.
--
-- ЗАЧЕМ. Три вещи, которых не хватало, чтобы данные стали активом:
--   1) Движок считал по 63 программам, зашитым в JS, а база из 100+ строк
--      стояла в стороне. Теперь база — источник каталога для расчёта:
--      витрина programs_engine отдаёт только строки с полными модельными
--      параметрами, движок читает её с фолбэком на встроенный список.
--   2) У дедлайнов не было машиночитаемой даты — модель не могла ответить
--      «успеваешь ли ты в этот цикл». Добавляем deadline_md / apply_open_md
--      (месяц-день типового цикла, год к году сдвигается на дни).
--   3) Исходы (подал → оффер → стипендия) — самые ценные данные проекта —
--      было некуда класть. Таблицы outcomes и profile_snapshots — это
--      скелет «датасета, которого нет»: траектория → результат.
--
-- Идемпотентно: можно запускать повторно.
-- ============================================================

-- ---------- 1. каталог: машинные поля цикла и экзаменов ----------
alter table programs
  add column if not exists deadline_md   text,     -- 'MM-DD': типовое закрытие окна подачи
  add column if not exists apply_open_md text,     -- 'MM-DD': типовое открытие окна
  add column if not exists lang_year     boolean not null default false, -- программа сама даёт год языка
  add column if not exists exam          text,     -- обязательный внешний экзамен: 'csca' | 'sat' | null
  add column if not exists stat_note     text;     -- публичная статистика, на которую опёрта базовая ставка

-- ---------- 2. витрина каталога для движка ----------
-- Только строки, по которым модель может считать честно: есть базовые ставки
-- и требования. Никаких служебных полей наружу.
drop view if exists programs_engine;
create or replace view programs_engine as
  select id, name, country, cc, levels, funding,
         base_adm, base_sch, req, deadline, deadline_md, apply_open_md,
         note, fields, lang_year, exam, source_url
    from programs
   where duplicate_of is null
     and coalesce(available_kz, true)
     and base_adm is not null and base_adm > 0 and base_adm < 1
     and req is not null and (req ? 'academics') and (req ? 'language');
grant select on programs_engine to anon, authenticated;

-- ---------- 3. исходы: подал → оффер → стипендия ----------
-- Пишутся из кабинета (сам пользователь) и подтверждаются ИИ-проверкой
-- загруженного письма-оффера или админом. Это ядро будущей калибровки.
create table if not exists outcomes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  lead_id     text,
  program_id  text references programs(id),
  cycle       int  not null default 2027,          -- год intake
  stage       text not null check (stage in
              ('planned','applied','interview','offer','reject','waitlist',
               'scholarship','visa','enrolled','declined')),
  amount      numeric,                             -- размер стипендии, если есть
  currency    text,
  evidence_path text,                              -- файл-подтверждение (Storage)
  verified_by text check (verified_by in ('ai','human') or verified_by is null),
  reported_at timestamptz not null default now(),
  meta        jsonb
);
alter table outcomes enable row level security;
-- каждый видит и пишет только свои исходы; чужие — только через admin-RPC
drop policy if exists outcomes_own_select on outcomes;
create policy outcomes_own_select on outcomes for select to authenticated
  using (user_id = auth.uid());
drop policy if exists outcomes_own_insert on outcomes;
create policy outcomes_own_insert on outcomes for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists outcomes_own_update on outcomes;
create policy outcomes_own_update on outcomes for update to authenticated
  using (user_id = auth.uid());
create index if not exists outcomes_program on outcomes (program_id, cycle, stage);

-- ---------- 4. снимки профиля: траектория по неделям сезона ----------
-- Кабинет при каждом значимом пересчёте кладёт снимок осей. Из снимков
-- складывается «профиль по неделям» — второй слой уникального датасета.
create table if not exists profile_snapshots (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,
  lead_id    text,
  cycle      int not null default 2027,
  week_of    date not null default date_trunc('week', now())::date,
  axes       jsonb not null,          -- 6 осей 0–10
  signals    jsonb,                   -- sat, docsReady, weeksLeft и т.п.
  p_now      numeric,                 -- P(хотя бы один оффер) на момент снимка
  p_deadline numeric,                 -- прогноз к дедлайну
  created_at timestamptz not null default now()
);
alter table profile_snapshots enable row level security;
drop policy if exists snapshots_own_select on profile_snapshots;
create policy snapshots_own_select on profile_snapshots for select to authenticated
  using (user_id = auth.uid());
drop policy if exists snapshots_own_insert on profile_snapshots;
create policy snapshots_own_insert on profile_snapshots for insert to authenticated
  with check (user_id = auth.uid());
create unique index if not exists snapshots_week on profile_snapshots (user_id, cycle, week_of);

-- ---------- 5. админу: сводка исходов ----------
create or replace function admin_outcomes(p_cycle int default 2027)
returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare j json;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(json_agg(t order by t.n desc), '[]'::json) into j from (
    select o.program_id, p.name, o.stage, count(*) as n
      from outcomes o left join programs p on p.id = o.program_id
     where o.cycle = p_cycle
     group by o.program_id, p.name, o.stage
  ) t;
  return j;
end $$;
grant execute on function admin_outcomes(int) to authenticated;
