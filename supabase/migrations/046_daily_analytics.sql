-- ============================================================
-- Scholary 046 · Ежедневная аналитика фаундера (web-77)
--
-- Зачем. Реклама идёт 1–2 дня, и на следующее утро нужно видеть по дням и по часам:
-- сколько людей пришло, сколько времени провели, сколько страниц посмотрели, сколько открыли
-- и прошли квиз, нажали «Оплатить через Kaspi» / «Купить подписку», вошли в кабинет, открыли
-- демо школы/профориентолога, кликнули WhatsApp — и с какого канала. Раньше в базе были только
-- события без сессий: ни визитов, ни времени, ни рефереров, ни дня по часам.
--
-- Что добавляется.
--   visits      — сессии (sid из sessionStorage, 30 мин тишины = новая), время активности,
--                 страницы, реферер, UTM, метка ссылки ?s=, канал, устройство.
--   page_views  — просмотры страниц с временем на странице.
--   link_tags   — короткие метки ссылок (scholary.kz/?s=wa-school → канал «WhatsApp · школы»).
--   channel_of  — единое правило канала: метка → UTM → click-id рекламы → реферер → direct.
--   visit_ping  — единственная точка записи с сайта (anon), без персональных данных.
--   admin_day / admin_days / admin_link_tags* — витрина для админки (только is_admin()).
--   founder_digest_due — утренний дайджест фаундеру в Telegram (anon по секрету, дедуп tg_sent).
-- Все права выдаются здесь же. Идемпотентно, деструктивного SQL нет. Время — Asia/Almaty.
-- ============================================================

-- ---------- 1. Метки ссылок ----------
create table if not exists link_tags (
  tag        text primary key check (tag ~ '^[a-z0-9][a-z0-9_-]{1,30}$'),
  label      text not null,          -- «WhatsApp · школы»
  channel    text not null,          -- машинный канал: whatsapp_schools
  note       text,
  created_at timestamptz not null default now()
);
alter table link_tags enable row level security;
revoke all on link_tags from anon, authenticated;
insert into link_tags (tag, label, channel, note) values
  ('wa-school',  'WhatsApp · школам',        'whatsapp_schools', 'ссылка, которую отправляем директорам и профориентологам школ'),
  ('wa-prof',    'WhatsApp · профориентологам', 'whatsapp_prof', 'ссылка частным профориентологам'),
  ('wa-parent',  'WhatsApp · родителям',     'whatsapp_parents', 'ссылка родителям и чатам классов'),
  ('ig-bio',     'Instagram · ссылка в профиле', 'instagram_bio', 'ссылка в шапке профиля'),
  ('tt-bio',     'TikTok · ссылка в профиле', 'tiktok_bio', 'ссылка в шапке профиля'),
  ('tg-post',    'Telegram · посты',         'telegram_posts', 'ссылка из постов и каналов'),
  ('offline',    'Офлайн · встречи и печать', 'offline', 'QR на буклетах, встречи в школах')
on conflict (tag) do nothing;

-- ---------- 2. Визиты и просмотры ----------
create table if not exists visits (
  sid        text primary key check (sid ~ '^[a-z0-9-]{8,48}$'),
  lead_id    text,
  started_at timestamptz not null default now(),
  last_at    timestamptz not null default now(),
  pages      int not null default 1,
  events     int not null default 0,
  active_s   int not null default 0,        -- секунды активности (вкладка видна), не «время между заходами»
  landing    text,
  referrer   text,
  ref_host   text,
  utm        jsonb,
  tag        text,
  device     text,                          -- mobile | desktop | tablet
  lang       text
);
create index if not exists visits_started_idx on visits (started_at desc);
create index if not exists visits_lead_idx on visits (lead_id);
alter table visits enable row level security;
revoke all on visits from anon, authenticated;

create table if not exists page_views (
  id        bigint generated always as identity primary key,
  sid       text not null,
  ts        timestamptz not null default now(),
  page      text not null,
  active_s  int not null default 0
);
create index if not exists page_views_ts_idx on page_views (ts desc);
create index if not exists page_views_sid_idx on page_views (sid, ts desc);
alter table page_views enable row level security;
revoke all on page_views from anon, authenticated;

-- Канал по единому правилу. Метка ссылки сильнее UTM, UTM сильнее click-id, click-id сильнее реферера.
create or replace function channel_of(p_utm jsonb, p_ref_host text, p_tag text)
returns text language plpgsql immutable as $$
declare src text; med text; h text := lower(coalesce(p_ref_host, ''));
begin
  if p_tag is not null and p_tag <> '' then return 'tag:' || p_tag; end if;
  src := lower(coalesce(p_utm->>'utm_source', '')); med := lower(coalesce(p_utm->>'utm_medium', ''));
  if src <> '' then
    if med in ('cpc','paid','ads','ad','paid_social','ppc') or (p_utm ? 'ttclid') or (p_utm ? 'fbclid') or (p_utm ? 'gclid') then return src || '_ads'; end if;
    return src;
  end if;
  if p_utm ? 'ttclid' then return 'tiktok_ads'; end if;
  if p_utm ? 'fbclid' then return 'meta_ads'; end if;
  if p_utm ? 'gclid'  then return 'google_ads'; end if;
  if h = '' or h like '%scholary.kz' then return 'direct'; end if;
  if h like '%instagram.%' or h like 'l.instagram.%' then return 'instagram'; end if;
  if h like '%tiktok.%' or h = 'vm.tiktok.com' then return 'tiktok'; end if;
  if h like '%facebook.%' or h like '%fb.com' or h like 'lm.facebook.com' or h = 'm.facebook.com' then return 'facebook'; end if;
  if h like '%whatsapp.%' or h = 'wa.me' then return 'whatsapp'; end if;
  if h like '%telegram.%' or h = 't.me' or h like '%telegra.ph' then return 'telegram'; end if;
  if h like '%google.%' or h like '%yandex.%' or h like '%bing.com' or h like 'duckduckgo.com' then return 'search'; end if;
  if h like '%youtube.%' or h = 'youtu.be' then return 'youtube'; end if;
  return 'referral:' || h;
end $$;

-- Человеческое имя канала (для админки и дайджеста)
create or replace function channel_label(p_channel text)
returns text language sql stable as $$
  select case
    when p_channel like 'tag:%' then coalesce((select l.label from link_tags l where l.tag = substr(p_channel, 5)), 'ссылка ' || substr(p_channel, 5))
    when p_channel = 'direct' then 'Прямые заходы'
    when p_channel = 'tiktok_ads' then 'TikTok · реклама'
    when p_channel = 'meta_ads' then 'Instagram/Facebook · реклама'
    when p_channel = 'google_ads' then 'Google · реклама'
    when p_channel = 'instagram' then 'Instagram · органика'
    when p_channel = 'tiktok' then 'TikTok · органика'
    when p_channel = 'facebook' then 'Facebook · органика'
    when p_channel = 'whatsapp' then 'WhatsApp'
    when p_channel = 'telegram' then 'Telegram'
    when p_channel = 'search' then 'Поиск (Google/Яндекс)'
    when p_channel = 'youtube' then 'YouTube'
    when p_channel like 'referral:%' then 'Переход с ' || substr(p_channel, 10)
    when p_channel like '%\_ads' then initcap(replace(p_channel, '_ads', '')) || ' · реклама (UTM)'
    else initcap(p_channel) || ' (UTM)' end;
$$;

-- ---------- 3. Запись с сайта ----------
-- p: {sid, kind: view|beat|event, page, ref, utm, tag, device, lang, lead_id, active_s, event}
-- Персональных данных нет: только идентификатор сессии, страница, реферер, UTM.
create or replace function visit_ping(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sid text := p->>'sid'; v_kind text := coalesce(p->>'kind', 'view'); v_page text := left(coalesce(p->>'page', '/'), 200);
        v_ref text := left(coalesce(p->>'ref', ''), 300); v_host text; v_utm jsonb; v_tag text; v_add int; v_lead text := left(nullif(p->>'lead_id', ''), 64);
begin
  if v_sid is null or v_sid !~ '^[a-z0-9-]{8,48}$' then return jsonb_build_object('ok', false, 'why', 'sid'); end if;
  if v_page like '/admin%' then return jsonb_build_object('ok', true, 'skip', 'admin'); end if;
  if v_kind = 'view' then
    v_utm := case when jsonb_typeof(p->'utm') = 'object' then p->'utm' else null end;
    v_tag := nullif(left(regexp_replace(lower(coalesce(p->>'tag', '')), '[^a-z0-9_-]', '', 'g'), 32), '');
    v_host := lower(substring(v_ref from '^(?:https?://)?([^/?#]+)'));
    insert into visits (sid, lead_id, landing, referrer, ref_host, utm, tag, device, lang)
    values (v_sid, v_lead, v_page, nullif(v_ref, ''), v_host, v_utm, v_tag,
            case when p->>'device' in ('mobile','desktop','tablet') then p->>'device' else null end, left(p->>'lang', 8))
    on conflict (sid) do update set last_at = now(), pages = visits.pages + 1,
      lead_id = coalesce(visits.lead_id, excluded.lead_id),
      utm = coalesce(visits.utm, excluded.utm), tag = coalesce(visits.tag, excluded.tag);
    insert into page_views (sid, page) values (v_sid, v_page);
    return jsonb_build_object('ok', true);
  elsif v_kind = 'beat' then
    v_add := least(greatest(coalesce((p->>'active_s')::int, 0), 0), 60);
    update visits set last_at = now(), active_s = active_s + v_add, lead_id = coalesce(lead_id, v_lead) where sid = v_sid;
    if not found then return jsonb_build_object('ok', false, 'why', 'nosid'); end if;
    update page_views set active_s = active_s + v_add where id = (select id from page_views where sid = v_sid order by ts desc limit 1);
    return jsonb_build_object('ok', true);
  elsif v_kind = 'event' then
    update visits set last_at = now(), events = events + 1, lead_id = coalesce(lead_id, v_lead) where sid = v_sid;
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', false, 'why', 'kind');
end $$;
revoke all on function visit_ping(jsonb) from public;
grant execute on function visit_ping(jsonb) to anon, authenticated;

-- ---------- 4. Метрики дня ----------
-- Тестовые лиды (e2e, @scholary-test.kz) и визиты админки не считаются.
create or replace function day_stats(p_day date)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare t0 timestamptz := (p_day::timestamp) at time zone 'Asia/Almaty'; t1 timestamptz := ((p_day + 1)::timestamp) at time zone 'Asia/Almaty'; j jsonb;
begin
  with v as (
    select * from visits vv where vv.started_at >= t0 and vv.started_at < t1
      and not exists (select 1 from leads l where l.id = vv.lead_id and (is_test_account(l.email) or is_test_account(l.whatsapp)))
  ), ev as (
    select e.* from events e where e.ts >= t0 and e.ts < t1
      and not exists (select 1 from leads l where l.id = e.lead_id and (is_test_account(l.email) or is_test_account(l.whatsapp)))
  ), pv as (
    select p.* from page_views p join v on v.sid = p.sid where p.ts >= t0 and p.ts < t1
  ), pay as (
    select * from payments p where p.created_at >= t0 and p.created_at < t1 and coalesce(p.test_mode, false) = false and p.status = 'success'
  )
  select jsonb_build_object(
    'day', p_day,
    'visits', (select count(*) from v),
    'visitors', (select count(distinct coalesce(lead_id, sid)) from v),
    'pages_per_visit', (select round(coalesce(avg(pages), 0)::numeric, 1) from v),
    'avg_active_s', (select round(coalesce(avg(active_s), 0)::numeric) from v),
    'bounce', (select count(*) from v where pages <= 1 and active_s < 10),
    'mobile_share', (select case when count(*) = 0 then 0 else round(100.0 * count(*) filter (where device = 'mobile') / count(*)) end from v),
    'quiz_open', (select count(distinct sid) from pv where page like '/quiz%'),
    'quiz_start', (select count(distinct lead_id) from ev where event = 'quiz_start'),
    'quiz_done', (select count(distinct lead_id) from ev where event = 'quiz_done'),
    'paywall', (select count(distinct lead_id) from ev where event = 'paywall_view'),
    'contacts', (select count(distinct lead_id) from ev where event = 'lead_form_submit'),
    'pay_click', (select count(distinct lead_id) from ev where event in ('pay_click','pay_kaspi_click','pay_widget_open')),
    'kaspi_click', (select count(distinct lead_id) from ev where event in ('pay_kaspi_click') or (event = 'pay_click' and data->>'via' = 'kaspi')),
    'pro_click', (select count(distinct lead_id) from ev where event = 'pro_click'),
    'payments', (select count(*) from pay),
    'revenue', (select coalesce(sum(amount), 0) from pay),
    'pro_paid', (select count(*) from pay where kind like 'pro%'),
    'cab_open', (select count(distinct lead_id) from ev where event = 'cab_open'),
    'cab_signup', (select count(*) from auth.users u where u.created_at >= t0 and u.created_at < t1 and not is_test_account(u.email)),
    'school_demo', (select count(distinct sid) from pv where page like '/schools/cabinet%demo%'),
    'prof_demo', (select count(distinct sid) from pv where page like '/prof/cabinet%demo%'),
    'schools_page', (select count(distinct sid) from pv where page = '/schools/' or page = '/schools'),
    'prof_page', (select count(distinct sid) from pv where page = '/prof/' or page = '/prof'),
    'school_apply', (select count(*) from schools s where s.created_at >= t0 and s.created_at < t1 and s.kind <> 'counselor' and not s.is_test),
    'prof_apply', (select count(*) from schools s where s.created_at >= t0 and s.created_at < t1 and s.kind = 'counselor' and not s.is_test),
    'wa_click', (select count(*) from ev where event = 'wa_click'),
    'tg_click', (select count(*) from ev where event = 'tg_click')
  ) into j;
  return j;
end $$;
revoke all on function day_stats(date) from public, anon, authenticated;

create or replace function admin_day(p_day date default null)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare d date := coalesce(p_day, (now() at time zone 'Asia/Almaty')::date - 1);
        t0 timestamptz; t1 timestamptz; j jsonb;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  t0 := (d::timestamp) at time zone 'Asia/Almaty'; t1 := ((d + 1)::timestamp) at time zone 'Asia/Almaty';
  select jsonb_build_object(
    'day', d, 'today', (now() at time zone 'Asia/Almaty')::date, 'now_hour', extract(hour from now() at time zone 'Asia/Almaty')::int,
    'cur', day_stats(d), 'prev', day_stats(d - 1), 'week_ago', day_stats(d - 7),
    'hours', (select coalesce(jsonb_agg(jsonb_build_object('h', h,
        'visits', (select count(*) from visits v where v.started_at >= t0 + (h || ' hours')::interval and v.started_at < t0 + ((h + 1) || ' hours')::interval),
        'quiz', (select count(distinct lead_id) from events e where e.event = 'quiz_start' and e.ts >= t0 + (h || ' hours')::interval and e.ts < t0 + ((h + 1) || ' hours')::interval),
        'pay', (select count(distinct lead_id) from events e where e.event in ('pay_click','pay_kaspi_click','pay_widget_open') and e.ts >= t0 + (h || ' hours')::interval and e.ts < t0 + ((h + 1) || ' hours')::interval),
        'paid', (select count(*) from payments p where p.status = 'success' and coalesce(p.test_mode,false) = false and p.created_at >= t0 + (h || ' hours')::interval and p.created_at < t0 + ((h + 1) || ' hours')::interval)
      ) order by h), '[]'::jsonb) from generate_series(0, 23) h),
    'channels', (select coalesce(jsonb_agg(x order by x.visits desc), '[]'::jsonb) from (
        with vv as (
          select v.sid, v.lead_id, v.active_s, v.pages, channel_of(v.utm, v.ref_host, v.tag) as channel
          from visits v where v.started_at >= t0 and v.started_at < t1
            and not exists (select 1 from leads l where l.id = v.lead_id and (is_test_account(l.email) or is_test_account(l.whatsapp)))
        ), pp as (
          select p.lead_id, p.amount from payments p where p.status = 'success' and coalesce(p.test_mode,false) = false and p.created_at >= t0 and p.created_at < t1
        )
        select vv.channel, channel_label(vv.channel) as label,
          count(*) as visits, round(coalesce(avg(vv.active_s), 0)::numeric) as avg_active_s, round(coalesce(avg(vv.pages), 0)::numeric, 1) as pages,
          count(distinct vv.lead_id) filter (where exists (select 1 from events e where e.lead_id = vv.lead_id and e.event = 'quiz_start' and e.ts >= t0 and e.ts < t1)) as quiz_start,
          count(distinct vv.lead_id) filter (where exists (select 1 from events e where e.lead_id = vv.lead_id and e.event in ('pay_click','pay_kaspi_click','pay_widget_open') and e.ts >= t0 and e.ts < t1)) as pay_click,
          (select count(*) from pp where pp.lead_id in (select lead_id from vv v2 where v2.channel = vv.channel)) as payments,
          (select coalesce(sum(amount), 0) from pp where pp.lead_id in (select lead_id from vv v2 where v2.channel = vv.channel)) as revenue
        from vv group by vv.channel) x),
    'pages', (select coalesce(jsonb_agg(x order by x.views desc), '[]'::jsonb) from (
        select p.page, count(*) as views, count(distinct p.sid) as visitors, round(coalesce(avg(p.active_s), 0)::numeric) as avg_active_s
        from page_views p join visits v on v.sid = p.sid where p.ts >= t0 and p.ts < t1
          and not exists (select 1 from leads l where l.id = v.lead_id and (is_test_account(l.email) or is_test_account(l.whatsapp)))
        group by p.page order by views desc limit 14) x),
    'feed', (select coalesce(jsonb_agg(x order by x.ts desc), '[]'::jsonb) from (
        (select p.created_at as ts, 'pay' as kind, coalesce(p.kind, 'оплата') as what, p.amount as amount, p.lead_id as lead from payments p where p.status = 'success' and coalesce(p.test_mode,false) = false and p.created_at >= t0 and p.created_at < t1)
        union all
        (select e.ts, 'contact', coalesce(e.data->>'interest', 'заявка из квиза'), null, e.lead_id from events e join leads l on l.id = e.lead_id where e.event = 'lead_form_submit' and e.ts >= t0 and e.ts < t1 and not (is_test_account(l.email) or is_test_account(l.whatsapp)))
        union all
        (select e.ts, 'pay_click', coalesce(e.data->>'kind', '') || case when e.data->>'via' = 'kaspi' or e.event = 'pay_kaspi_click' then ' · Kaspi' else '' end, null, e.lead_id from events e where e.event in ('pay_click','pay_kaspi_click') and e.ts >= t0 and e.ts < t1)
        union all
        (select s.created_at, 'school', s.name || case when s.kind = 'counselor' then ' (профориентолог)' else ' (школа)' end, null, null from schools s where s.created_at >= t0 and s.created_at < t1 and not s.is_test)
        union all
        (select u.created_at, 'signup', 'регистрация в кабинете', null, null from auth.users u where u.created_at >= t0 and u.created_at < t1 and not is_test_account(u.email))
        order by 1 desc limit 60) x)
  ) into j;
  return j;
end $$;
revoke all on function admin_day(date) from public, anon;
grant execute on function admin_day(date) to authenticated;

-- Ряд дней для таблицы «последние N дней»
create or replace function admin_days(p_days int default 14)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare n int := greatest(1, least(coalesce(p_days, 14), 90)); today date := (now() at time zone 'Asia/Almaty')::date;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(day_stats(g::date) order by g desc), '[]'::jsonb) from generate_series(today - (n - 1), today, '1 day') g);
end $$;
revoke all on function admin_days(int) from public, anon;
grant execute on function admin_days(int) to authenticated;

-- ---------- 5. Метки ссылок: админка ----------
create or replace function admin_link_tags()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('tag', l.tag, 'label', l.label, 'channel', l.channel, 'note', l.note, 'created_at', l.created_at,
      'visits_7d', (select count(*) from visits v where v.tag = l.tag and v.started_at >= now() - interval '7 days'),
      'visits_all', (select count(*) from visits v where v.tag = l.tag)) order by l.created_at), '[]'::jsonb) from link_tags l);
end $$;
revoke all on function admin_link_tags() from public, anon;
grant execute on function admin_link_tags() to authenticated;

create or replace function admin_link_tag_upsert(p_tag text, p_label text, p_channel text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tag text := lower(btrim(coalesce(p_tag, '')));
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_tag !~ '^[a-z0-9][a-z0-9_-]{1,30}$' then return jsonb_build_object('ok', false, 'why', 'tag'); end if;
  insert into link_tags (tag, label, channel, note) values (v_tag, left(btrim(coalesce(p_label, v_tag)), 80), left(coalesce(nullif(btrim(p_channel), ''), replace(v_tag, '-', '_')), 40), left(p_note, 300))
  on conflict (tag) do update set label = excluded.label, channel = excluded.channel, note = excluded.note;
  return jsonb_build_object('ok', true, 'tag', v_tag);
end $$;
revoke all on function admin_link_tag_upsert(text, text, text, text) from public, anon;
grant execute on function admin_link_tag_upsert(text, text, text, text) to authenticated;

create or replace function admin_link_tag_delete(p_tag text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from link_tags where tag = p_tag; get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end $$;
revoke all on function admin_link_tag_delete(text) from public, anon;
grant execute on function admin_link_tag_delete(text) to authenticated;

-- ---------- 6. Утренний дайджест фаундера ----------
-- Кому: все админы с привязанным Telegram (tg_links). Один раз в день: tg_sent 'founder:<день>', milestone 120.
create or replace function founder_digest_due(p_secret text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_secret text; d date := (now() at time zone 'Asia/Almaty')::date - 1; j jsonb;
begin
  select value into v_secret from app_secrets where name = 'tiptop_webhook';
  if v_secret is null or length(v_secret) < 24 or p_secret is null or p_secret <> v_secret then return jsonb_build_object('ok', false, 'why', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', a.user_id, 'chat_id', t.chat_id)), '[]'::jsonb) into j
    from admins a join tg_links t on t.user_id = a.user_id and t.chat_id is not null
    where not exists (select 1 from tg_sent x where x.user_id = a.user_id and x.program_id = 'founder:' || d::text and x.milestone = 120);
  return jsonb_build_object('ok', true, 'day', d, 'milestone', 120, 'stats', day_stats(d), 'prev', day_stats(d - 1),
    'top_channels', (select coalesce(jsonb_agg(x order by x.visits desc), '[]'::jsonb) from (
        select channel_label(channel_of(v.utm, v.ref_host, v.tag)) as label, count(*) as visits
        from visits v where v.started_at >= (d::timestamp) at time zone 'Asia/Almaty' and v.started_at < ((d + 1)::timestamp) at time zone 'Asia/Almaty'
        group by 1 order by 2 desc limit 3) x),
    'recipients', j);
end $$;
revoke all on function founder_digest_due(text) from public, authenticated;
grant execute on function founder_digest_due(text) to anon;

select 'daily analytics ok' as status,
  has_function_privilege('anon', 'visit_ping(jsonb)', 'execute') as ping_anon,
  has_function_privilege('authenticated', 'admin_day(date)', 'execute') as day_auth,
  has_function_privilege('anon', 'admin_day(date)', 'execute') as day_anon,
  (select count(*) from link_tags) as tags;
