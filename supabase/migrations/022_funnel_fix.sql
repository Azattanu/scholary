-- ============================================================
-- Scholary 022: правка воронки
--
-- НАЙДЕНО НА ЖИВОМ ДАШБОРДЕ. В admin_funnel последний шаг считал
-- «count(distinct lead_id) from leads», но в таблице leads колонка
-- называется id, а не lead_id — функция падала с
-- «column "lead_id" does not exist», и дашборд не открывался вовсе.
-- Проверка SQL по частям этого не поймала: я прогонял упрощённый
-- вариант блока. Ловится только вызовом функции целиком.
-- ============================================================

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
      (select count(distinct lead_id) from e)                                               as vsego,
      (select count(distinct lead_id) from e where event = 'quiz_start')                    as nachali_kviz,
      (select count(distinct lead_id) from e where event in ('quiz_done', 'paywall_view'))   as doshli_do_rezultata,
      (select count(distinct lead_id) from e where event = 'paywall_view')                  as uvideli_paywall,
      (select count(distinct lead_id) from e where event = 'free_cabinet_click')            as poshli_v_kabinet,
      (select count(distinct lead_id) from e where event in ('pay_click', 'pay_kaspi_click')) as nazhali_oplatit,
      (select count(*) from leads
        where paid and updated_at > now() - (d || ' days')::interval)                       as oplatili
  ) t;
  return j;
end $$;
grant execute on function admin_funnel(int) to authenticated;

select 'воронка исправлена' as status;
