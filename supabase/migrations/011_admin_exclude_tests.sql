-- ============================================================
-- Scholary · 011: тестовые аккаунты не портят метрики
-- Автотесты создают пользователей вида e2e.*/qa.* и @scholary-test.kz.
-- Удалять их нельзя (это данные), но и считать в статистике незачем —
-- исключаем из витрины и добавляем счётчик разборов ИИ.
-- Идемпотентно.
-- ============================================================

create or replace function is_test_account(p_email text)
returns boolean language sql immutable as $$
  select coalesce(
    lower(p_email) like '%@scholary-test.kz'
    or lower(p_email) like 'e2e.%'
    or lower(p_email) like 'qa.%'
    or lower(p_email) like 'ai.test.%'
  , false);
$$;

drop view if exists admin_overview;
create view admin_overview as
select
  (select count(*) from auth.users u where not is_test_account(u.email))                     as users_total,
  (select count(*) from auth.users u where not is_test_account(u.email)
     and u.created_at > now() - interval '7 days')                                           as users_7d,
  (select count(*) from profiles p join auth.users u on u.id = p.user_id
     where not is_test_account(u.email) and p.answers ? 'level')                             as profiles_with_quiz,
  (select count(*) from profiles where pro_until >= current_date)                            as pro_active,
  (select count(*) from leads)                                                               as leads_total,
  (select count(*) from leads where paid)                                                    as leads_paid,
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

revoke all on admin_overview from anon, authenticated;

select * from admin_overview;
