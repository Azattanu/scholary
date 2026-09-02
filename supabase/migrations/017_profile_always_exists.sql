-- ============================================================
-- Scholary 017: у каждого пользователя всегда есть строка profiles
--
-- НАЙДЕНО ПРИ ПРОВЕРКЕ ЭКВАЙРИНГА. Строка profiles создавалась
-- ТОЛЬКО внутри claim_lead — то есть лишь если человек привязал
-- свою анкету из квиза. Кто зарегистрировался и нажал «пропустить»,
-- оставался без строки: 10 аккаунтов из 27.
-- Чем это грозило:
--   1) оплата Pro не находила кому продлить доступ — деньги ушли,
--      доступа нет (grant_pro и tiptop_grant_pro обновляли 0 строк);
--   2) правки анкеты в кабинете сохранялись «в никуда»
--      (update profiles ... where user_id = ... по нулю строк).
-- Идемпотентно.
-- ============================================================

-- ---------- 1. Строка заводится при регистрации ----------
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into profiles (user_id, name)
    values (new.id, nullif(new.raw_user_meta_data->>'name', ''))
    on conflict (user_id) do nothing;
  exception when others then
    -- Регистрация важнее профиля: если вставка почему-то не удалась,
    -- пользователь всё равно должен зарегистрироваться.
    null;
  end;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- 2. Добираем тех, кто уже зарегистрировался ----------
insert into profiles (user_id, name)
select u.id, nullif(u.raw_user_meta_data->>'name', '')
  from auth.users u
 where not exists (select 1 from profiles p where p.user_id = u.id);

-- ---------- 3. Оплата Pro больше не может «не найти» аккаунт ----------
create or replace function tiptop_grant_pro(
  p_secret text, p_email text, p_txn text, p_amount numeric,
  p_plan text, p_test boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_secret text; v_days int; v_uid uuid; v_until date; v_seen boolean;
begin
  select value into v_secret from app_secrets where name = 'tiptop_webhook';
  if v_secret is null or length(v_secret) < 24 then raise exception 'not_configured'; end if;
  if p_secret is null or p_secret <> v_secret then raise exception 'forbidden'; end if;
  if p_plan not in ('month', 'season') then raise exception 'bad_plan'; end if;
  if p_email is null or position('@' in p_email) < 2 then raise exception 'bad_email'; end if;

  v_days := case p_plan when 'season' then 183 else 31 end;   -- сезон = сентябрь–февраль

  -- Шлюз повторяет уведомление при любой заминке: без этой проверки
  -- один платёж продлевал бы подписку по разу на каждый повтор.
  select true into v_seen from payments where txn = p_txn and status = 'success';
  if v_seen then return jsonb_build_object('ok', true, 'duplicate', true); end if;

  insert into payments (txn, user_email, amount, kind, status, test_mode)
  values (p_txn, lower(p_email), p_amount, 'pro_' || p_plan, 'success', coalesce(p_test, false))
  on conflict (txn) do update set status = 'success';

  select u.id into v_uid from auth.users u where lower(u.email) = lower(p_email) limit 1;
  if v_uid is null then
    -- Аккаунта с такой почтой нет (оплатили до регистрации или опечатались).
    -- Платёж записан, владельцу уходит письмо, доступ выдаётся вручную.
    return jsonb_build_object('ok', false, 'why', 'no_account', 'email', lower(p_email));
  end if;

  insert into profiles (user_id) values (v_uid) on conflict (user_id) do nothing;

  update profiles
     set pro_until  = greatest(coalesce(pro_until, current_date), current_date) + v_days,
         pro_plan   = p_plan,
         updated_at = now()
   where user_id = v_uid
   returning pro_until into v_until;

  return jsonb_build_object('ok', true, 'user_id', v_uid, 'pro_until', v_until);
end $$;
revoke all on function tiptop_grant_pro(text, text, text, numeric, text, boolean) from public;
grant execute on function tiptop_grant_pro(text, text, text, numeric, text, boolean) to anon;

-- ---------- 4. Ручная выдача Pro — та же защита ----------
create or replace function grant_pro(p_email text, p_days int default 30, p_plan text default 'manual')
returns table (user_id uuid, pro_until date)
language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_days is null or p_days < 1 or p_days > 730 then raise exception 'bad_days'; end if;
  select u.id into v_uid from auth.users u where lower(u.email) = lower(p_email) limit 1;
  if v_uid is null then raise exception 'no_account'; end if;
  insert into profiles (user_id) values (v_uid) on conflict (user_id) do nothing;
  return query
  update profiles p
     set pro_until  = greatest(coalesce(p.pro_until, current_date), current_date) + p_days,
         pro_plan   = p_plan,
         updated_at = now()
   where p.user_id = v_uid
  returning p.user_id, p.pro_until;
end $$;
revoke all on function grant_pro(text,int,text) from public, anon;
grant execute on function grant_pro(text,int,text) to authenticated;

select (select count(*) from auth.users) as polzovateley,
       (select count(*) from profiles)   as profiley;
