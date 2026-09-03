-- 033 · Отправка напоминаний о дедлайнах в Telegram.
-- Проблема: бот умел только привязать аккаунт. В кабинете и в самом боте мы
-- обещали «дедлайны за 30/14/7/3/1 день и шаг дня», но отправлять их было
-- некому — ни расписания, ни очереди. Обещание не выполнялось ни разу.
-- Здесь: журнал отправленного (чтобы не дублировать) и одна RPC, которая
-- отдаёт серверу готовый список «кому и что написать сегодня».

-- ---------- журнал: одно напоминание на связку пользователь+подача+рубеж ----------
create table if not exists tg_sent (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  program_id text not null,
  milestone  int  not null,             -- 30 | 14 | 7 | 3 | 1
  sent_at    timestamptz not null default now(),
  unique (user_id, program_id, milestone)
);
alter table tg_sent enable row level security;   -- пишет только сервер под секретом

create index if not exists tg_sent_user_idx on tg_sent (user_id, sent_at desc);

-- ---------- ближайшая дата дедлайна из 'MM-DD' ----------
-- В каталоге дедлайн хранится типовым днём цикла (deadline_md), потому что
-- год к году он сдвигается. Разворачиваем его в ближайшую будущую дату.
create or replace function next_deadline(p_md text)
returns date
language plpgsql immutable
as $$
declare
  mm int; dd int; y int := extract(year from current_date)::int; d date;
begin
  if p_md is null or p_md !~ '^\d{2}-\d{2}$' then return null; end if;
  mm := split_part(p_md, '-', 1)::int;
  dd := split_part(p_md, '-', 2)::int;
  if mm < 1 or mm > 12 or dd < 1 or dd > 31 then return null; end if;
  begin
    d := make_date(y, mm, dd);
  exception when others then return null;   -- 02-30 и подобное
  end;
  if d < current_date then
    begin d := make_date(y + 1, mm, dd); exception when others then return null; end;
  end if;
  return d;
end $$;

-- ---------- что рассылать сегодня ----------
-- Вызывает ТОЛЬКО сервер (api/tg-send.php) с тем же секретом, что у вебхука
-- эквайринга. Отдаёт минимум данных: chat_id, имя, название программы, срок.
create or replace function tg_due(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_rows   jsonb;
begin
  select value into v_secret from app_secrets where name = 'tiptop_webhook';
  -- пустой секрет в таблице не должен означать «пускаем всех»
  if v_secret is null or length(v_secret) < 24 or p_secret is null or p_secret <> v_secret then
    return jsonb_build_object('ok', false, 'why', 'forbidden');
  end if;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_rows
  from (
    select
      t.user_id                          as user_id,
      t.chat_id                          as chat_id,
      coalesce(pr.name, 'друг')          as name,
      p.id                               as program_id,
      p.name                             as program,
      p.country                          as country,
      d.dl                               as deadline,
      (d.dl - current_date)              as days,
      m.milestone                        as milestone
    from tg_links t
      join profiles pr        on pr.user_id = t.user_id
      join portfolio_items pi on pi.user_id = t.user_id and pi.submitted_at is null
      join programs p         on p.id = pi.program_id
      cross join lateral (select next_deadline(p.deadline_md) as dl) d
      cross join lateral (select unnest(array[30,14,7,3,1]) as milestone) m
    where t.chat_id is not null
      and coalesce((t.prefs->>'deadlines')::boolean, true)
      and d.dl is not null
      and (d.dl - current_date) = m.milestone
      and not exists (
        select 1 from tg_sent s
        where s.user_id = t.user_id and s.program_id = p.id and s.milestone = m.milestone
      )
    order by d.dl
    limit 500
  ) x;

  return jsonb_build_object('ok', true, 'items', v_rows);
end $$;

revoke all on function tg_due(text) from public, anon, authenticated;

-- ---------- отметить отправленное ----------
create or replace function tg_mark_sent(p_secret text, p_user uuid, p_program text, p_milestone int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_secret text;
begin
  select value into v_secret from app_secrets where name = 'tiptop_webhook';
  if v_secret is null or length(v_secret) < 24 or p_secret is null or p_secret <> v_secret then return false; end if;
  insert into tg_sent (user_id, program_id, milestone)
  values (p_user, p_program, p_milestone)
  on conflict (user_id, program_id, milestone) do nothing;
  return true;
end $$;

revoke all on function tg_mark_sent(text, uuid, text, int) from public, anon, authenticated;

-- Самопроверка: разворот 'MM-DD' в ближайшую дату работает
select next_deadline('01-15') as jan15, next_deadline('12-31') as dec31, next_deadline('02-30') as bad;
