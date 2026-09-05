-- ============================================================
-- Scholary 041: метрики рекламы в панели владельца (web-71)
--
-- Расход по рекламе (TikTok Ads и др.) заносится в таблицу ad_spend —
-- вручную из кабинета или импортом CSV-выгрузки Ads Manager. Всё
-- остальное (визиты, квизы, заявки, оплаты, выручка) уже есть в events /
-- leads / payments; связываем по меткам utm_source и click-id (ttclid,
-- fbclid, gclid), которые сайт кладёт в utm каждой заявки и события.
-- Отсюда — CPM, CPC, CPV, цена визита, цена квиза, CPL, CAC, ROAS.
-- Все функции закрыты is_admin(). Идемпотентно.
-- ============================================================

create table if not exists ad_spend (
  day         date    not null,
  platform    text    not null default 'tiktok',   -- tiktok | meta | google | other
  campaign    text    not null default '',
  spend       numeric not null default 0,          -- ₸, с НДС как в кабинете
  impressions bigint  not null default 0,
  clicks      bigint  not null default 0,
  views       bigint  not null default 0,          -- просмотры видео (2 с / 6 с — как выгружено)
  results     bigint  not null default 0,          -- «результаты»/конверсии по данным площадки
  note        text,
  updated_at  timestamptz not null default now(),
  primary key (day, platform, campaign)
);
alter table ad_spend enable row level security;
revoke all on table ad_spend from anon, authenticated;

-- К какой рекламной площадке относится посетитель по его меткам
create or replace function ad_platform_of(u jsonb)
returns text language sql immutable as $$
  select case
    when u is null then null
    when u ? 'ttclid' or lower(coalesce(u->>'utm_source', '')) in ('tiktok', 'tt', 'tiktok_ads', 'tiktokads') then 'tiktok'
    when u ? 'fbclid' or lower(coalesce(u->>'utm_source', '')) in ('instagram', 'facebook', 'meta', 'ig', 'fb') then 'meta'
    when u ? 'gclid' or lower(coalesce(u->>'utm_source', '')) in ('google', 'google_ads', 'adwords') then 'google'
    else null end
$$;

-- ---------- запись расхода: массив строк [{day, platform, campaign, spend, impressions, clicks, views, results, note}] ----------
create or replace function admin_ad_spend_upsert(p_rows jsonb)
returns json
language plpgsql security definer set search_path = public, auth as $$
declare r jsonb; n int := 0;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be array'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if r->>'day' is null then continue; end if;
    insert into ad_spend (day, platform, campaign, spend, impressions, clicks, views, results, note, updated_at)
    values ((r->>'day')::date,
            coalesce(nullif(lower(r->>'platform'), ''), 'tiktok'),
            left(coalesce(r->>'campaign', ''), 120),
            greatest(0, coalesce((r->>'spend')::numeric, 0)),
            greatest(0, coalesce((r->>'impressions')::bigint, 0)),
            greatest(0, coalesce((r->>'clicks')::bigint, 0)),
            greatest(0, coalesce((r->>'views')::bigint, 0)),
            greatest(0, coalesce((r->>'results')::bigint, 0)),
            left(r->>'note', 200), now())
    on conflict (day, platform, campaign) do update set
      spend = excluded.spend, impressions = excluded.impressions, clicks = excluded.clicks,
      views = excluded.views, results = excluded.results, note = excluded.note, updated_at = now();
    n := n + 1;
  end loop;
  return json_build_object('ok', true, 'saved', n);
end $$;
grant execute on function admin_ad_spend_upsert(jsonb) to authenticated;

create or replace function admin_ad_spend_delete(p_day date, p_platform text, p_campaign text default '')
returns json
language plpgsql security definer set search_path = public, auth as $$
declare n int;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from ad_spend where day = p_day and platform = p_platform and campaign = coalesce(p_campaign, '');
  get diagnostics n = row_count;
  return json_build_object('ok', true, 'deleted', n);
end $$;
grant execute on function admin_ad_spend_delete(date, text, text) to authenticated;

-- ---------- список внесённых строк за период ----------
create or replace function admin_ad_spend_list(p_days int default 30)
returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare j json; d int := greatest(1, least(coalesce(p_days, 30), 365));
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(json_agg(t order by t.day desc, t.platform, t.campaign), '[]'::json) into j
    from (select day, platform, campaign, spend, impressions, clicks, views, results, note
            from ad_spend where day >= current_date - (d - 1)) t;
  return j;
end $$;
grant execute on function admin_ad_spend_list(int) to authenticated;

-- ---------- сводка по площадке: расход + наша воронка + по дням ----------
create or replace function admin_ads(p_days int default 30, p_platform text default 'tiktok')
returns json
language plpgsql stable security definer set search_path = public, auth as $$
declare j json; d int := greatest(1, least(coalesce(p_days, 30), 365)); pf text := coalesce(nullif(lower(p_platform), ''), 'tiktok');
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  with
  sp as (select day, sum(spend) spend, sum(impressions) impressions, sum(clicks) clicks, sum(views) views, sum(results) results
           from ad_spend where platform = pf and day >= current_date - (d - 1) group by day),
  ev as (select lead_id, event, ts::date as day from events
          where ts >= (current_date - (d - 1))::timestamptz and lead_id is not null and ad_platform_of(utm) = pf),
  ld as (select id, updated_at::date as day, whatsapp, email, paid, paid_amount from leads
          where updated_at >= (current_date - (d - 1))::timestamptz and ad_platform_of(utm) = pf),
  pay as (select p.txn, p.amount, p.created_at::date as day from payments p
           where p.status = 'success' and not coalesce(p.test_mode, false)
             and p.created_at >= (current_date - (d - 1))::timestamptz
             and (p.lead_id in (select id from leads where ad_platform_of(utm) = pf)
                  or (p.user_email is not null and lower(p.user_email) in (select lower(email) from leads where email is not null and ad_platform_of(utm) = pf))))
  select to_json(t) into j from (
    select pf as platform, d as period_days,
      (select coalesce(sum(spend), 0) from sp)                                   as spend,
      (select coalesce(sum(impressions), 0) from sp)                             as impressions,
      (select coalesce(sum(clicks), 0) from sp)                                  as clicks,
      (select coalesce(sum(views), 0) from sp)                                   as views,
      (select coalesce(sum(results), 0) from sp)                                 as results,
      (select count(*) from sp where spend > 0)                                  as days_with_spend,
      (select max(day) from sp where spend > 0)                                  as last_spend_day,
      (select count(distinct lead_id) from ev)                                   as visitors,
      (select count(distinct lead_id) from ev where event = 'quiz_start')        as quiz_start,
      (select count(distinct lead_id) from ev where event in ('quiz_done', 'paywall_view')) as quiz_done,
      (select count(distinct lead_id) from ev where event in ('pay_click', 'pay_kaspi_click')) as pay_clicks,
      (select count(*) from ld where (whatsapp is not null and whatsapp <> '') or (email is not null and email <> '')) as leads,
      (select count(*) from pay)                                                 as payments,
      (select coalesce(sum(amount), 0) from pay)                                 as revenue,
      (select coalesce(json_agg(x order by x.day), '[]'::json) from (
         select g::date as day,
           (select coalesce(sum(spend), 0) from sp where sp.day = g::date)                      as spend,
           (select coalesce(sum(impressions), 0) from sp where sp.day = g::date)                as impressions,
           (select coalesce(sum(clicks), 0) from sp where sp.day = g::date)                     as clicks,
           (select coalesce(sum(views), 0) from sp where sp.day = g::date)                      as views,
           (select count(distinct lead_id) from ev where ev.day = g::date)                      as visitors,
           (select count(distinct lead_id) from ev where ev.day = g::date and event in ('quiz_done', 'paywall_view')) as quiz_done,
           (select count(*) from ld where ld.day = g::date and ((whatsapp is not null and whatsapp <> '') or (email is not null and email <> ''))) as leads,
           (select count(*) from pay where pay.day = g::date)                                   as payments,
           (select coalesce(sum(amount), 0) from pay where pay.day = g::date)                   as revenue
           from generate_series(current_date - (d - 1), current_date, '1 day') g) x)             as daily
  ) t;
  return j;
end $$;
grant execute on function admin_ads(int, text) to authenticated;

select 'ad_metrics ok' as status, (select count(*) from ad_spend) as rows;
