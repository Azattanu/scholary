-- ============================================================
-- Scholary · 026: тестовые лиды не попадают в витрины отчётов.
-- 025 убрал их из счётчиков лидов и оплат, но reports_total считал
-- все отчёты подряд — включая выданные на тестовых оплатах.
-- Плюс в списке отчётов теперь видно, боевой он или тестовый.
-- Идемпотентно.
-- ============================================================

drop view if exists admin_overview;
create view admin_overview as
select
  (select count(*) from auth.users u where not is_test_account(u.email))                     as users_total,
  (select count(*) from auth.users u where not is_test_account(u.email)
     and u.created_at > now() - interval '7 days')                                           as users_7d,
  (select count(*) from profiles p join auth.users u on u.id = p.user_id
     where not is_test_account(u.email) and p.answers ? 'level')                             as profiles_with_quiz,
  (select count(*) from profiles where pro_until >= current_date)                            as pro_active,
  (select count(*) from leads where not coalesce(test_mode, false))                          as leads_total,
  (select count(*) from leads where paid and not coalesce(test_mode, false))                 as leads_paid,
  (select count(*) from reports r
     where not exists (select 1 from leads l
                        where l.id = r.lead_id and coalesce(l.test_mode, false)))            as reports_total,
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

-- В списке отчётов помечаем тестовые: иначе на скриншоте дашборда
-- проверочный отчёт выглядит как настоящая продажа.
create or replace function admin_reports(p_limit int default 100)
returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare j json;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(json_agg(t order by t.created_at desc), '[]'::json) into j from (
    select r.id, r.lead_id, r.created_at, r.token,
           l.name, l.whatsapp, l.email, l.level, l.paid, l.paid_at, l.report_sent_at,
           coalesce(l.test_mode, false) as test_mode,
           l.wa_status, l.email_status,
           (r.texts is not null) as est_teksty,
           jsonb_array_length(coalesce(r.data->'portfolio', '[]'::jsonb)) as programm_v_otchete
      from reports r left join leads l on l.id = r.lead_id
     order by r.created_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) t;
  return j;
end $$;
grant execute on function admin_reports(int) to authenticated;
