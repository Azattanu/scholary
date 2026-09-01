-- ============================================================
-- Scholary · Подписка Pro + витрина метрик для владельца
-- 008: pro_until в профиле, вью admin_overview (агрегаты без персональных данных),
--      функция grant_pro для ручной выдачи доступа до подключения эквайринга.
-- Идемпотентно.
-- ============================================================

-- ---------- ПОДПИСКА ----------
alter table profiles add column if not exists pro_until date;
alter table profiles add column if not exists pro_plan  text;      -- month | season | manual

-- Выдать Pro вручную (пока не подключён эквайринг): вызывать из SQL-редактора
--   select grant_pro('почта@пользователя', 30);
create or replace function grant_pro(p_email text, p_days int default 30, p_plan text default 'manual')
returns table (user_id uuid, pro_until date)
language plpgsql security definer set search_path = public, auth as $$
begin
  return query
  update profiles p
     set pro_until = greatest(coalesce(p.pro_until, current_date), current_date) + p_days,
         pro_plan  = p_plan,
         updated_at = now()
   from auth.users u
  where u.id = p.user_id and lower(u.email) = lower(p_email)
  returning p.user_id, p.pro_until;
end $$;
revoke all on function grant_pro(text,int,text) from public, anon, authenticated;

-- ---------- ВИТРИНА МЕТРИК ДЛЯ ВЛАДЕЛЬЦА ----------
-- Читается только сервисным ключом (админка), персональных данных не отдаёт.
create or replace view admin_overview as
select
  (select count(*) from auth.users)                                              as users_total,
  (select count(*) from auth.users where created_at > now() - interval '7 days')  as users_7d,
  (select count(*) from profiles where answers ? 'level')                         as profiles_with_quiz,
  (select count(*) from profiles where pro_until >= current_date)                 as pro_active,
  (select count(*) from leads)                                                    as leads_total,
  (select count(*) from leads where paid)                                         as leads_paid,
  (select count(*) from reports)                                                  as reports_total,
  (select count(*) from portfolio_items)                                          as applications_total,
  (select count(*) from portfolio_items where submitted_at is not null)           as applications_submitted,
  (select count(*) from portfolio_items where outcome is not null)                as applications_with_outcome,
  (select round(avg(readiness), 1) from portfolio_items where submitted_at is null) as avg_readiness,
  (select count(*) from user_documents)                                           as documents_total,
  (select count(*) from user_documents where status = 'ready')                    as documents_ready,
  (select count(*) from user_documents where file_path is not null)               as documents_with_file,
  (select count(*) from tg_links where chat_id is not null)                       as telegram_linked,
  (select count(*) from events where ts > now() - interval '24 hours')            as events_24h;

revoke all on admin_overview from anon, authenticated;

-- Топ программ по числу подач — что реально выбирают (для контента и приоритетов базы)
create or replace view admin_top_programs as
select pi.program_id,
       coalesce(p.name, pi.program_id) as name,
       coalesce(p.country, '—')        as country,
       count(*)                        as picks,
       count(*) filter (where pi.submitted_at is not null) as submitted,
       round(avg(pi.readiness), 1)     as avg_readiness
from portfolio_items pi
left join programs p on p.id = pi.program_id
group by pi.program_id, p.name, p.country
order by picks desc;

revoke all on admin_top_programs from anon, authenticated;

-- ---------- ПРОВЕРКА ----------
select * from admin_overview;
