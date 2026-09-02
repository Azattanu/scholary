-- ============================================================
-- Scholary 016: приём оплат TipTop Pay
--
-- Зачем: RPC upsert_lead намеренно НЕ умеет писать поля оплаты,
-- поэтому с фронта saveLead({paid:true}) молча игнорируется.
-- Единственный доверенный источник факта оплаты — уведомление
-- платёжного шлюза на api/tiptop.php, подпись которого проверена
-- по HMAC. Этот файл даёт серверу узкую дверь: отметить лид
-- оплаченным и ничего больше.
-- ============================================================

alter table if exists leads
  add column if not exists paid_amount numeric,
  add column if not exists paid_kind text,      -- report | consult | package | pro_month | pro_season
  add column if not exists tiptop_status text;  -- success | fail | последняя реакция шлюза

-- Секреты приложения. Политик RLS нет вообще — значит ни anon,
-- ни authenticated не видят ни одной строки. Читают только
-- security-definer функции ниже.
create table if not exists app_secrets (
  name text primary key,
  value text not null,
  updated_at timestamptz default now()
);
alter table app_secrets enable row level security;
revoke all on table app_secrets from anon, authenticated;

-- Значение кладётся отдельным запросом из SQL-редактора, в git не хранится:
--   insert into app_secrets(name, value) values ('tiptop_webhook', '<секрет>')
--   on conflict (name) do update set value = excluded.value, updated_at = now();

create or replace function tiptop_mark_paid(
  p_secret text,
  p_lead   text,
  p_txn    text,
  p_amount numeric,
  p_email  text default null,
  p_kind   text default null,
  p_status text default 'success'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select value into v_secret from app_secrets where name = 'tiptop_webhook';
  -- Пустой или короткий секрет в таблице не должен превращаться
  -- в «пускаем всех»: сравнение с null всегда даёт null, но проверяем явно.
  if v_secret is null or length(v_secret) < 24 then
    raise exception 'not_configured';
  end if;
  if p_secret is null or p_secret <> v_secret then
    raise exception 'forbidden';
  end if;
  if p_lead is null or length(p_lead) < 8 or length(p_lead) > 64 then
    raise exception 'bad_lead';
  end if;
  if p_status not in ('success', 'fail') then
    raise exception 'bad_status';
  end if;

  -- Лид мог не сохраниться (человек закрыл вкладку до записи анкеты) —
  -- но деньги пришли, поэтому строку создаём в любом случае.
  insert into leads (id) values (p_lead) on conflict (id) do nothing;

  update leads set
    -- paid один раз ставший true больше не снимаем: возврат — отдельная операция
    paid        = (p_status = 'success') or coalesce(paid, false),
    paid_at     = case when p_status = 'success' and paid_at is null then now() else paid_at end,
    paid_amount = case when p_status = 'success' then coalesce(p_amount, paid_amount) else paid_amount end,
    paid_kind   = case when p_status = 'success' then coalesce(p_kind, paid_kind) else paid_kind end,
    tiptop_transaction_id = coalesce(nullif(p_txn, ''), tiptop_transaction_id),
    tiptop_status = p_status,
    email       = coalesce(email, nullif(p_email, '')),
    updated_at  = now()
  where id = p_lead;

  return jsonb_build_object('ok', true, 'lead', p_lead, 'status', p_status);
end $$;

revoke all on function tiptop_mark_paid(text, text, text, numeric, text, text, text) from public;
grant execute on function tiptop_mark_paid(text, text, text, numeric, text, text, text) to anon;

-- Быстрый разбор оплат в админке
create index if not exists leads_paid_at on leads (paid_at desc) where paid = true;

-- ---------- Журнал платежей ----------
-- Пишется только security-definer функциями ниже. Политик RLS нет —
-- значит ни anon, ни authenticated не читают его напрямую.
create table if not exists payments (
  txn         text primary key,
  lead_id     text,
  user_email  text,
  amount      numeric,
  kind        text,
  status      text,
  test_mode   boolean default false,
  created_at  timestamptz default now()
);
alter table payments enable row level security;
revoke all on table payments from anon, authenticated;

-- ---------- Подписка Pro по факту оплаты ----------
-- Кабинет передаёт в виджет AccountId = почта пользователя, поэтому
-- шлюз возвращает её нам в уведомлении и мы знаем, кому продлить доступ.
create or replace function tiptop_grant_pro(
  p_secret text,
  p_email  text,
  p_txn    text,
  p_amount numeric,
  p_plan   text,          -- month | season
  p_test   boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_secret text;
  v_days   int;
  v_uid    uuid;
  v_until  date;
  v_seen   boolean;
begin
  select value into v_secret from app_secrets where name = 'tiptop_webhook';
  if v_secret is null or length(v_secret) < 24 then raise exception 'not_configured'; end if;
  if p_secret is null or p_secret <> v_secret then raise exception 'forbidden'; end if;
  if p_plan not in ('month', 'season') then raise exception 'bad_plan'; end if;
  if p_email is null or position('@' in p_email) < 2 then raise exception 'bad_email'; end if;

  v_days := case p_plan when 'season' then 183 else 31 end;   -- сезон = сентябрь–февраль

  -- Шлюз повторяет уведомление при любой заминке. Без этой проверки
  -- один платёж продлевал бы подписку по разу на каждый повтор.
  select true into v_seen from payments where txn = p_txn and status = 'success';
  if v_seen then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  insert into payments (txn, user_email, amount, kind, status, test_mode)
  values (p_txn, lower(p_email), p_amount, 'pro_' || p_plan, 'success', coalesce(p_test, false))
  on conflict (txn) do update set status = 'success';

  update profiles p
     set pro_until  = greatest(coalesce(p.pro_until, current_date), current_date) + v_days,
         pro_plan   = p_plan,
         updated_at = now()
    from auth.users u
   where u.id = p.user_id and lower(u.email) = lower(p_email)
  returning p.user_id, p.pro_until into v_uid, v_until;

  if v_uid is null then
    -- Человек заплатил, но такого аккаунта нет (опечатка в почте, оплата
    -- до регистрации). Деньги не теряем: платёж записан, владельцу придёт
    -- письмо, доступ выдаётся вручную через grant_pro.
    return jsonb_build_object('ok', false, 'why', 'no_account', 'email', lower(p_email));
  end if;
  return jsonb_build_object('ok', true, 'user_id', v_uid, 'pro_until', v_until);
end $$;

revoke all on function tiptop_grant_pro(text, text, text, numeric, text, boolean) from public;
grant execute on function tiptop_grant_pro(text, text, text, numeric, text, boolean) to anon;

-- Тот же журнал для разовых покупок (отчёт, консультация, пакет)
create or replace function tiptop_log_payment(
  p_secret text, p_txn text, p_lead text, p_email text,
  p_amount numeric, p_kind text, p_status text, p_test boolean default false
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_secret text;
begin
  select value into v_secret from app_secrets where name = 'tiptop_webhook';
  if v_secret is null or length(v_secret) < 24 then raise exception 'not_configured'; end if;
  if p_secret is null or p_secret <> v_secret then raise exception 'forbidden'; end if;
  insert into payments (txn, lead_id, user_email, amount, kind, status, test_mode)
  values (p_txn, p_lead, nullif(lower(p_email), ''), p_amount, p_kind, p_status, coalesce(p_test, false))
  on conflict (txn) do update set status = excluded.status;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function tiptop_log_payment(text, text, text, text, numeric, text, text, boolean) from public;
grant execute on function tiptop_log_payment(text, text, text, text, numeric, text, text, boolean) to anon;
