-- ============================================================
-- Scholary 019: витрина для дашборда владельца
--
-- Раньше админка тянула 20 000 событий в браузер и считала воронку
-- на клиенте: это медленно, а при росте перестанет открываться вовсе.
-- Здесь всё считается в базе и отдаётся готовыми числами.
-- Каждая функция закрыта is_admin(). Идемпотентно.
-- ============================================================

-- ---------- 1. Сводка: деньги, люди, продукт ----------
create or replace function admin_dash_summary(p_days int default 30)
returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare j json; d int := greatest(1, least(coalesce(p_days, 30), 365));
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select to_json(t) into j from (
    select
      -- деньги (боевые платежи, тестовые не считаем)
      (select coalesce(sum(amount), 0) from payments
        where status = 'success' and not coalesce(test_mode, false))                       as revenue_all,
      (select coalesce(sum(amount), 0) from payments
        where status = 'success' and not coalesce(test_mode, false)
          and created_at > now() - (d || ' days')::interval)                               as revenue_period,
      (select count(*) from payments
        where status = 'success' and not coalesce(test_mode, false))                       as payments_all,
      (select count(*) from payments
        where status = 'success' and not coalesce(test_mode, false)
          and created_at > now() - (d || ' days')::interval)                               as payments_period,
      (select count(*) from payments where status = 'refunded')                            as refunds_all,
      (select coalesce(sum(coalesce(refund_amount, amount)), 0) from payments
        where status = 'refunded')                                                         as refunded_sum,
      -- люди
      (select count(*) from auth.users u where not is_test_account(u.email))               as users_total,
      (select count(*) from auth.users u where not is_test_account(u.email)
         and u.created_at > now() - (d || ' days')::interval)                              as users_period,
      (select count(*) from profiles p join auth.users u on u.id = p.user_id
         where not is_test_account(u.email) and p.answers ? 'level')                       as users_with_answers,
      (select count(*) from profiles where pro_until >= current_date)                      as pro_active,
      -- заявки
      (select count(*) from leads)                                                         as leads_total,
      (select count(*) from leads where updated_at > now() - (d || ' days')::interval)     as leads_period,
      (select count(*) from leads where paid)                                              as leads_paid,
      (select count(*) from leads where whatsapp is not null and whatsapp <> '')           as leads_with_contact,
      -- продукт
      (select count(*) from portfolio_items)                                               as applications_total,
      (select count(*) from portfolio_items where submitted_at is not null)                as applications_submitted,
      (select count(*) from user_documents where status = 'ready')                         as documents_ready,
      (select count(*) from reports)                                                       as reports_total,
      (select count(*) from tg_links where chat_id is not null)                            as telegram_linked,
      (select count(*) from programs where duplicate_of is null)                           as programs_total,
      (select count(*) from events where ts > now() - interval '24 hours')                 as events_24h,
      d                                                                                    as period_days
  ) t;
  return j;
end $$;
grant execute on function admin_dash_summary(int) to authenticated;

-- ---------- 2. Выручка и оплаты по дням ----------
create or replace function admin_revenue_daily(p_days int default 30)
returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare j json; d int := greatest(1, least(coalesce(p_days, 30), 365));
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(json_agg(t order by t.den), '[]'::json) into j from (
    select g::date                                                     as den,
           coalesce(sum(p.amount) filter (where p.status = 'success'), 0) as summa,
           count(p.txn) filter (where p.status = 'success')            as oplat
      from generate_series(current_date - (d - 1), current_date, '1 day') g
      left join payments p
        on p.created_at::date = g::date and not coalesce(p.test_mode, false)
     group by g
  ) t;
  return j;
end $$;
grant execute on function admin_revenue_daily(int) to authenticated;

-- ---------- 3. Выручка по видам продукта ----------
create or replace function admin_revenue_by_kind(p_days int default 30)
returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare j json; d int := greatest(1, least(coalesce(p_days, 30), 365));
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(json_agg(t order by t.summa desc), '[]'::json) into j from (
    select coalesce(kind, 'не определён') as vid,
           count(*)                       as oplat,
           coalesce(sum(amount), 0)       as summa
      from payments
     where status = 'success' and not coalesce(test_mode, false)
       and created_at > now() - (d || ' days')::interval
     group by kind
  ) t;
  return j;
end $$;
grant execute on function admin_revenue_by_kind(int) to authenticated;

-- ---------- 4. Воронка за период ----------
-- Считаем по уникальным lead_id: один человек = одна единица на каждом шаге.
create or replace function admin_funnel(p_days int default 30)
returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare j json; d int := greatest(1, least(coalesce(p_days, 30), 365));
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  with e as (
    select lead_id, event from events
     where ts > now() - (d || ' days')::interval and lead_id is not null
  )
  select to_json(t) into j from (
    select
      (select count(distinct lead_id) from e)                                              as vsego,
      (select count(distinct lead_id) from e where event = 'quiz_start')                   as nachali_kviz,
      (select count(distinct lead_id) from e where event in ('quiz_done', 'paywall_view'))  as doshli_do_rezultata,
      (select count(distinct lead_id) from e where event = 'paywall_view')                 as uvideli_paywall,
      (select count(distinct lead_id) from e where event = 'free_cabinet_click')           as poshli_v_kabinet,
      (select count(distinct lead_id) from e where event in ('pay_click', 'pay_kaspi_click')) as nazhali_oplatit,
      (select count(distinct lead_id) from leads
        where paid and updated_at > now() - (d || ' days')::interval)                      as oplatili
  ) t;
  return j;
end $$;
grant execute on function admin_funnel(int) to authenticated;

-- ---------- 5. Источники трафика ----------
-- Главный отчёт для маркетолога: сколько заявок и денег принёс каждый канал.
create or replace function admin_sources(p_days int default 30)
returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare j json; d int := greatest(1, least(coalesce(p_days, 30), 365));
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(json_agg(t order by t.zayavok desc), '[]'::json) into j from (
    select coalesce(nullif(l.utm->>'utm_source', ''), 'прямой заход')  as istochnik,
           coalesce(nullif(l.utm->>'utm_medium', ''), '—')            as kanal,
           coalesce(nullif(l.utm->>'utm_campaign', ''), '—')          as kampaniya,
           count(*)                                                    as zayavok,
           count(*) filter (where l.whatsapp is not null and l.whatsapp <> '') as s_kontaktom,
           count(*) filter (where l.paid)                              as oplat,
           coalesce(sum(l.paid_amount) filter (where l.paid), 0)       as summa
      from leads l
     where l.updated_at > now() - (d || ' days')::interval
     group by 1, 2, 3
  ) t;
  return j;
end $$;
grant execute on function admin_sources(int) to authenticated;

-- ---------- 6. Заявки и регистрации по дням ----------
create or replace function admin_daily(p_days int default 30)
returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare j json; d int := greatest(1, least(coalesce(p_days, 30), 365));
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(json_agg(t order by t.den), '[]'::json) into j from (
    select g::date as den,
      (select count(*) from leads l where l.updated_at::date = g::date)                    as zayavki,
      (select count(*) from auth.users u
        where u.created_at::date = g::date and not is_test_account(u.email))               as registracii,
      (select count(distinct e.lead_id) from events e
        where e.ts::date = g::date and e.event = 'quiz_start')                             as nachali_kviz
      from generate_series(current_date - (d - 1), current_date, '1 day') g
  ) t;
  return j;
end $$;
grant execute on function admin_daily(int) to authenticated;

-- ---------- 7. Журнал платежей ----------
create or replace function admin_payments(p_limit int default 100)
returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare j json;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(json_agg(t order by t.created_at desc), '[]'::json) into j from (
    select txn, lead_id, user_email, amount, kind, status, test_mode, created_at, refunded_at
      from payments order by created_at desc limit greatest(1, least(coalesce(p_limit, 100), 1000))
  ) t;
  return j;
end $$;
grant execute on function admin_payments(int) to authenticated;

-- ---------- 8. Подписки ----------
create or replace function admin_subscriptions()
returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare j json;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(json_agg(t order by t.pro_until desc), '[]'::json) into j from (
    select u.email, p.pro_until, p.pro_plan, (p.pro_until >= current_date) as aktivna
      from profiles p join auth.users u on u.id = p.user_id
     where p.pro_until is not null and not is_test_account(u.email)
     limit 200
  ) t;
  return j;
end $$;
grant execute on function admin_subscriptions() to authenticated;

-- ---------- 9. Страны и уровни в подачах ----------
create or replace function admin_countries(p_limit int default 15)
returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare j json;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(json_agg(t order by t.podach desc), '[]'::json) into j from (
    select coalesce(pr.country, '—') as strana, count(*) as podach,
           count(*) filter (where pi.submitted_at is not null) as otpravleno
      from portfolio_items pi left join programs pr on pr.id = pi.program_id
     group by 1 limit greatest(1, least(coalesce(p_limit, 15), 60))
  ) t;
  return j;
end $$;
grant execute on function admin_countries(int) to authenticated;

select 'витрина дашборда готова' as status;
