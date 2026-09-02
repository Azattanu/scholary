-- ============================================================
-- Scholary 023: отчёты и время прохождения в дашборде
--
-- Владельцу негде было посмотреть две вещи: какие отчёты выданы
-- и сколько времени люди тратят на путь. Первое лежало в таблице
-- reports без единого экрана, второе не считалось вовсе.
-- Идемпотентно.
-- ============================================================

-- ---------- 1. Выданные отчёты ----------
create or replace function admin_reports(p_limit int default 100)
returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare j json;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(json_agg(t order by t.created_at desc), '[]'::json) into j from (
    select r.id, r.lead_id, r.created_at, r.token,
           l.name, l.whatsapp, l.email, l.level, l.paid, l.paid_at, l.report_sent_at,
           (r.texts is not null) as est_teksty,
           jsonb_array_length(coalesce(r.data->'portfolio', '[]'::jsonb)) as programm_v_otchete
      from reports r left join leads l on l.id = r.lead_id
     order by r.created_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) t;
  return j;
end $$;
grant execute on function admin_reports(int) to authenticated;

-- ---------- 2. Оплаты без отчёта ----------
-- Самый опасный список: человек заплатил, а результата не получил.
create or replace function admin_paid_without_report()
returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare j json;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(json_agg(t order by t.paid_at), '[]'::json) into j from (
    select l.id, l.name, l.whatsapp, l.email, l.paid_at, l.paid_amount, l.paid_kind,
           round(extract(epoch from (now() - l.paid_at)) / 3600)::int as chasov_zhdet
      from leads l
     where l.paid and not exists (select 1 from reports r where r.lead_id = l.id)
     limit 200
  ) t;
  return j;
end $$;
grant execute on function admin_paid_without_report() to authenticated;

-- ---------- 3. Время прохождения ----------
-- Считаем по событиям: для каждого устройства берём первое событие
-- каждого типа и меряем расстояния между ними.
create or replace function admin_timings(p_days int default 30)
returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare j json; d int := greatest(1, least(coalesce(p_days, 30), 365));
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  with e as (
    select lead_id, event, min(ts) as ts
      from events
     where ts > now() - (d || ' days')::interval and lead_id is not null
     group by lead_id, event
  ),
  w as (
    select lead_id,
           min(ts) filter (where event = 'landing_view')                        as landing,
           min(ts) filter (where event = 'quiz_start')                          as nachalo,
           min(ts) filter (where event = 'quiz_done')                           as konec_kviza,
           min(ts) filter (where event = 'paywall_view')                        as paywall,
           min(ts) filter (where event in ('pay_click', 'pay_kaspi_click'))     as klik_oplaty,
           min(ts) filter (where event = 'pay_success_screen')                  as oplata
      from e group by lead_id
  ),
  d1 as (
    select
      extract(epoch from (konec_kviza - nachalo))  as kviz_sek,
      extract(epoch from (paywall - nachalo))      as do_paywall_sek,
      extract(epoch from (klik_oplaty - paywall))  as razdumya_sek,
      extract(epoch from (oplata - nachalo))       as ves_put_sek,
      extract(epoch from (nachalo - landing))      as do_kviza_sek
    from w
  )
  select to_json(t) into j from (
    select
      -- медиана устойчивее среднего: один человек, ушедший на обед, не портит картину
      round(percentile_cont(0.5) within group (order by kviz_sek)      filter (where kviz_sek      between 5 and 3600))::int as kviz_mediana_sek,
      round(percentile_cont(0.9) within group (order by kviz_sek)      filter (where kviz_sek      between 5 and 3600))::int as kviz_p90_sek,
      round(percentile_cont(0.5) within group (order by do_paywall_sek)filter (where do_paywall_sek between 5 and 3600))::int as do_paywall_mediana_sek,
      round(percentile_cont(0.5) within group (order by razdumya_sek)  filter (where razdumya_sek  between 0 and 86400))::int as razdumya_mediana_sek,
      round(percentile_cont(0.5) within group (order by ves_put_sek)   filter (where ves_put_sek   between 5 and 604800))::int as ves_put_mediana_sek,
      round(percentile_cont(0.5) within group (order by do_kviza_sek)  filter (where do_kviza_sek  between 0 and 3600))::int as chtenie_lendinga_mediana_sek,
      count(*) filter (where kviz_sek between 5 and 3600)                                                                     as vyborka_kviz,
      count(*) filter (where ves_put_sek between 5 and 604800)                                                                as vyborka_put
    from d1
  ) t;
  return j;
end $$;
grant execute on function admin_timings(int) to authenticated;

-- ---------- 4. Прохождение по шагам квиза ----------
create or replace function admin_quiz_steps(p_days int default 30)
returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare j json; d int := greatest(1, least(coalesce(p_days, 30), 365));
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(json_agg(t order by t.shag), '[]'::json) into j from (
    select (data->>'step')::int as shag,
           coalesce(max(data->>'id'), '')   as vopros,
           count(distinct lead_id)          as doshli
      from events
     where event = 'quiz_step'
       and ts > now() - (d || ' days')::interval
       and (data->>'step') ~ '^[0-9]+$'
     group by 1
  ) t;
  return j;
end $$;
grant execute on function admin_quiz_steps(int) to authenticated;

select 'отчёты и тайминги готовы' as status;
