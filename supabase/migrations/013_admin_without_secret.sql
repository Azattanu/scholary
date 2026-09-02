-- ============================================================
-- Scholary · 013: админка без секретного ключа в браузере
--
-- ЗАЧЕМ. Раньше admin.html просил вставить сервисный ключ Supabase и хранил
-- его в localStorage браузера. Такой ключ обходит ВСЕ правила доступа: любой,
-- кто получит его (чужое расширение, чужой компьютер, случайный скрипт на
-- странице), получает полный доступ к базе. Ключу не место в браузере.
--
-- КАК ТЕПЕРЬ. Есть список админов (таблица admins). Владелец заходит в админку
-- обычным логином Supabase — тем же, что и в кабинете. Данные отдают функции
-- security definer, которые сначала проверяют, что вызывающий есть в admins.
-- Никаких секретов на клиенте.
--
-- Идемпотентно: можно запускать повторно.
-- ============================================================

-- ---------- кто админ ----------
create table if not exists admins (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table admins enable row level security;
revoke all on admins from anon, authenticated;   -- список админов клиент не читает

create or replace function is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins a where a.user_id = auth.uid());
$$;
grant execute on function is_admin() to authenticated;

-- Добавить админа по почте. Вызывается ТОЛЬКО из SQL-редактора Supabase.
create or replace function seed_admin(p_email text)
returns int
language plpgsql security definer set search_path = public, auth as $$
declare n int;
begin
  insert into admins(user_id)
  select u.id from auth.users u where lower(u.email) = lower(p_email)
  on conflict (user_id) do nothing;
  get diagnostics n = row_count;
  return n;   -- 1 = добавлен, 0 = уже был админом или такой почты нет среди зарегистрированных
end $$;
revoke all on function seed_admin(text) from public, anon, authenticated;

-- ---------- сводка для админки ----------
create or replace function admin_stats()
returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare j json;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select to_json(t) into j from (select * from admin_overview) t;
  return j;
end $$;
grant execute on function admin_stats() to authenticated;

create or replace function admin_top_programs_json(p_limit int default 12)
returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare j json;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(json_agg(t), '[]'::json) into j
    from (select * from admin_top_programs limit greatest(1, least(p_limit, 50))) t;
  return j;
end $$;
grant execute on function admin_top_programs_json(int) to authenticated;

-- Заявки с сайта. Здесь есть персональные данные, поэтому только админам.
create or replace function admin_leads(p_limit int default 300)
returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare j json;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(json_agg(t), '[]'::json) into j
    from (select * from leads order by updated_at desc limit greatest(1, least(p_limit, 1000))) t;
  return j;
end $$;
grant execute on function admin_leads(int) to authenticated;

-- События для воронки: без персональных полей, только что и когда.
create or replace function admin_events(p_limit int default 20000)
returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare j json;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(json_agg(t), '[]'::json) into j
    from (select lead_id, event, ts from events order by ts desc limit greatest(1, least(p_limit, 50000))) t;
  return j;
end $$;
grant execute on function admin_events(int) to authenticated;

-- ---------- выдача Pro из админки ----------
-- Была доступна только сервисному ключу. Теперь — авторизованному админу.
create or replace function grant_pro(p_email text, p_days int default 30, p_plan text default 'manual')
returns table (user_id uuid, pro_until date)
language plpgsql security definer set search_path = public, auth as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_days is null or p_days < 1 or p_days > 730 then raise exception 'bad_days'; end if;
  return query
  update profiles p
     set pro_until  = greatest(coalesce(p.pro_until, current_date), current_date) + p_days,
         pro_plan   = p_plan,
         updated_at = now()
   from auth.users u
  where u.id = p.user_id and lower(u.email) = lower(p_email)
  returning p.user_id, p.pro_until;
end $$;
revoke all on function grant_pro(text,int,text) from public, anon;
grant execute on function grant_pro(text,int,text) to authenticated;

-- ---------- назначаем владельца ----------
select seed_admin('azattanu@gmail.com') as added;
select count(*) as admins_total from admins;
