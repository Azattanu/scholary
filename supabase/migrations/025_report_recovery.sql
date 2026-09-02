-- ============================================================
-- Scholary · 025: «оплатил — но отчёта нет» больше не тупик.
--
-- ЗАЧЕМ. Три дыры, найденные на аудите:
--   1) Клиент потерял ссылку / письмо ушло в спам / номер WhatsApp с опечаткой →
--      единственный выход был «напиши нам», и отчёт доставал человек руками.
--   2) Оплата прошла до миграции 024 (нет снимка leads.result) → отчёт вообще
--      нечем выдать автоматически, и об этом никто не узнаёт вовремя.
--   3) Тестовые платежи ставили leads.paid = true и портили и счётчик выручки,
--      и срочный список «оплатил, но отчёта нет».
--
-- ЧТО ДЕЛАЕМ.
--   · leads.test_mode — платёж боевой или тестовый; витрины считают только боевые.
--   · find_paid_report() — самообслуживание: человек вводит свой телефон/почту
--     на /report/, сервер сам шлёт ссылку НА СОХРАНЁННЫЕ контакты. Токен в
--     браузер не возвращается никогда — иначе перебор чужих почт даст чужой отчёт.
--   · admin_lead_answers() / admin_save_report() — админ может собрать отчёт
--     задним числом из ответов анкеты прямо в браузере (движок тот же, js).
--   · admin_report_link() — достать ссылку на уже существующий отчёт.
--
-- Идемпотентно: можно запускать повторно.
-- ============================================================

-- ---------- 1. тестовые платежи отделены от боевых ----------
alter table leads add column if not exists test_mode boolean not null default false;

-- Старая 7-аргументная версия удаляется: если оставить обе, PostgREST не сможет
-- выбрать между ними и будет отвечать 300 Multiple Choices.
drop function if exists tiptop_mark_paid(text, text, text, numeric, text, text, text);

create or replace function tiptop_mark_paid(
  p_secret text,
  p_lead   text,
  p_txn    text,
  p_amount numeric,
  p_email  text default null,
  p_kind   text default null,
  p_status text default 'success',
  p_test   boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select value into v_secret from app_secrets where name = 'tiptop_webhook';
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

  insert into leads (id) values (p_lead) on conflict (id) do nothing;

  update leads set
    paid        = (p_status = 'success') or coalesce(paid, false),
    paid_at     = case when p_status = 'success' and paid_at is null then now() else paid_at end,
    paid_amount = case when p_status = 'success' then coalesce(p_amount, paid_amount) else paid_amount end,
    paid_kind   = case when p_status = 'success' then coalesce(p_kind, paid_kind) else paid_kind end,
    -- Боевой платёж по тому же лиду снимает пометку «тест»: если человек
    -- сначала проверял оплату тестовой картой, а потом заплатил по-настоящему,
    -- он обычный клиент и должен попасть во все витрины.
    test_mode   = case when p_status = 'success' then coalesce(p_test, false)
                       else coalesce(test_mode, false) end,
    tiptop_transaction_id = coalesce(nullif(p_txn, ''), tiptop_transaction_id),
    tiptop_status = p_status,
    email       = coalesce(email, nullif(p_email, '')),
    updated_at  = now()
  where id = p_lead;

  return jsonb_build_object('ok', true, 'lead', p_lead, 'status', p_status, 'test', coalesce(p_test, false));
end $$;

revoke all on function tiptop_mark_paid(text, text, text, numeric, text, text, text, boolean) from public;
grant execute on function tiptop_mark_paid(text, text, text, numeric, text, text, text, boolean) to anon;

-- ---------- 2. нормализация контакта ----------
-- Телефон казахстанцы пишут как угодно: +7 701, 8701, 7 (701). Сравниваем по
-- последним 10 цифрам — это номер без кода страны, он однозначен.
create or replace function contact_key(p text)
returns text
language sql immutable
as $$
  select case
    when p is null or btrim(p) = '' then null
    when position('@' in p) > 0 then lower(btrim(p))
    when length(regexp_replace(p, '\D', '', 'g')) >= 10
      then 'tel:' || right(regexp_replace(p, '\D', '', 'g'), 10)
    else null
  end;
$$;

-- ---------- 3. самообслуживание: найти свой оплаченный отчёт ----------
-- Возвращает контакты И токен, но вызывать может ТОЛЬКО сервер (секрет тот же,
-- что у вебхука). Браузер ходит через api/report-recover.php, который ссылку
-- отправляет на сохранённые контакты и наружу не отдаёт.
create or replace function find_paid_report(p_secret text, p_contact text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_key    text;
  v_lead   leads%rowtype;
  v_token  text;
begin
  select value into v_secret from app_secrets where name = 'tiptop_webhook';
  if v_secret is null or length(v_secret) < 24 then
    raise exception 'not_configured';
  end if;
  if p_secret is null or p_secret <> v_secret then
    raise exception 'forbidden';
  end if;

  v_key := contact_key(p_contact);
  if v_key is null then
    return jsonb_build_object('ok', false, 'why', 'bad_contact');
  end if;

  select l.* into v_lead
  from leads l
  where coalesce(l.paid, false)
    and (contact_key(l.whatsapp) = v_key
      or contact_key(l.email)    = v_key
      or contact_key(l.p2_email) = v_key)
  order by l.paid_at desc nulls last, l.updated_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'why', 'no_paid_lead');
  end if;

  select r.token into v_token
  from reports r where r.lead_id = v_lead.id
  order by r.created_at desc limit 1;

  if v_token is null then
    -- Оплата есть, отчёта нет: это ЧП, владельца зовём отдельно из PHP.
    return jsonb_build_object('ok', false, 'why', 'no_report', 'lead', v_lead.id,
      'name', v_lead.name, 'whatsapp', v_lead.whatsapp,
      'email', coalesce(nullif(v_lead.email, ''), nullif(v_lead.p2_email, '')),
      'has_result', (v_lead.result is not null));
  end if;

  return jsonb_build_object('ok', true, 'lead', v_lead.id, 'token', v_token,
    'name', v_lead.name, 'whatsapp', v_lead.whatsapp,
    'email', coalesce(nullif(v_lead.email, ''), nullif(v_lead.p2_email, '')));
end $$;

revoke all on function find_paid_report(text, text) from public;
grant execute on function find_paid_report(text, text) to anon;

-- ---------- 4. админ: собрать отчёт задним числом ----------
-- Ответы анкеты лида в том виде, в каком их сохранил квиз (списки — строкой
-- через запятую). Админка разворачивает их обратно и считает тем же движком,
-- что и квиз, — второй реализации логики нет.
create or replace function admin_lead_answers(p_lead text)
returns jsonb
language plpgsql stable security definer set search_path = public, auth
as $$
declare j jsonb;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select to_jsonb(t) into j from (
    select l.id, l.name, l.whatsapp, l.email, l.p2_email, l.paid, l.paid_at, l.paid_kind,
           l.test_mode, l.report_id, l.result is not null as has_result,
           l.level, l.year, l.gpa_band, l.school_type, l.gpa_uni, l.gpa_phd, l.uni_type,
           l.phd_topic, l.lang_status, l.ielts_band, l.sat, l.field, l.achievements,
           l.budget, l.priority, l.target_countries, l.target_university, l.target_major,
           (select r.token from reports r where r.lead_id = l.id order by r.created_at desc limit 1) as token
    from leads l where l.id = p_lead
  ) t;
  return j;
end $$;
grant execute on function admin_lead_answers(text) to authenticated;

-- Создать отчёт из готового расчёта (или из сохранённого снимка), если его ещё нет.
create or replace function admin_save_report(p_lead text, p_data jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_lead leads%rowtype;
  v_token text;
  v_id uuid;
  v_data jsonb;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;

  select * into v_lead from leads where id = p_lead;
  if not found then return jsonb_build_object('ok', false, 'why', 'no_lead'); end if;

  select r.id, r.token into v_id, v_token from reports r
  where r.lead_id = p_lead order by r.created_at desc limit 1;
  if v_token is not null then
    update leads set report_id = coalesce(report_id, v_id) where id = p_lead;
    return jsonb_build_object('ok', true, 'existing', true, 'token', v_token);
  end if;

  v_data := case
    when jsonb_typeof(p_data) = 'object' and (p_data ? 'portfolio') and (p_data ? 'profile')
         and pg_column_size(p_data) < 200000 then p_data
    else v_lead.result
  end;
  if v_data is null then return jsonb_build_object('ok', false, 'why', 'no_data'); end if;

  insert into reports (lead_id, data) values (p_lead, v_data)
  returning id, token into v_id, v_token;
  update leads set report_id = v_id, updated_at = now() where id = p_lead;

  return jsonb_build_object('ok', true, 'existing', false, 'token', v_token);
end $$;
grant execute on function admin_save_report(text, jsonb) to authenticated;

-- ---------- 5. витрины: тестовые лиды не в счёт ----------
drop view if exists admin_overview;
create view admin_overview as
select
  (select count(*) from auth.users u where not is_test_account(u.email))                     as users_total,
  (select count(*) from auth.users u where not is_test_account(u.email)
     and u.created_at > now() - interval '7 days')                                           as users_7d,
  (select count(*) from profiles p join auth.users u on u.id = p.user_id
     where not is_test_account(u.email) and p.answers ? 'level')                             as profiles_with_quiz,
  (select count(*) from profiles where pro_until >= current_date)                            as pro_active,
  (select count(*) from leads where not coalesce(test_mode, false))                           as leads_total,
  (select count(*) from leads where paid and not coalesce(test_mode, false))                  as leads_paid,
  (select count(*) from reports)                                                             as reports_total,
  (select count(*) from portfolio_items pi join auth.users u on u.id = pi.user_id
     where not is_test_account(u.email))                                                     as applications_total,
  (select count(*) from portfolio_items pi join auth.users u on u.id = pi.user_id
     where not is_test_account(u.email) and pi.submitted_at is not null)                     as applications_submitted,
  (select count(*) from portfolio_items where outcome is not null)                           as applications_with_outcome,
  (select round(avg(readiness), 1) from portfolio_items where submitted_at is null)          as avg_readiness,
  (select count(*) from user_documents d join auth.users u on u.id = d.user_id
     where not is_test_account(u.email))                                                     as documents_total,
  (select count(*) from user_documents d join auth.users u on u.id = d.user_id
     where not is_test_account(u.email) and d.status = 'ready')                              as documents_ready,
  (select count(*) from user_documents where file_path is not null)                          as documents_with_file,
  (select count(*) from user_documents where verdicts is not null)                           as documents_ai_checked,
  (select count(*) from tg_links where chat_id is not null)                                  as telegram_linked,
  (select count(*) from events where ts > now() - interval '24 hours')                       as events_24h,
  (select count(*) from auth.users u where is_test_account(u.email))                         as test_accounts;

-- ---------- 6. срочный список: только боевые оплаты, и видно, чем чинить ----------
create or replace function admin_paid_without_report()
returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare j json;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(json_agg(t order by t.paid_at), '[]'::json) into j from (
    select l.id, l.name, l.whatsapp, l.email, l.paid_at, l.paid_amount, l.paid_kind,
           coalesce(l.test_mode, false) as test_mode,
           (l.result is not null) as est_raschet,      -- true → отчёт выдаётся в один клик
           round(extract(epoch from (now() - l.paid_at)) / 3600)::int as chasov_zhdet
      from leads l
     where l.paid
       and not coalesce(l.test_mode, false)
       and not exists (select 1 from reports r where r.lead_id = l.id)
     limit 200
  ) t;
  return j;
end $$;
grant execute on function admin_paid_without_report() to authenticated;
