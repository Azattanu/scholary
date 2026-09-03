-- ============================================================
-- 030: усиление безопасности по итогам аудита (сентябрь 2026).
-- Каждый пункт закрывает конкретную дыру, найденную и подтверждённую
-- на проде. Все правки идемпотентны.
-- ============================================================

-- ---------- 1. profiles: Pro и привязку лидов пользователь не пишет сам ----------
-- Было: политика «for all на свою строку» + GRANT ALL по умолчанию →
-- любой залогиненный мог PATCH'ем поставить себе pro_until=2099 и
-- подменить lead_ids, а my_reports() отдал бы чужие отчёты с токенами.
-- Стало: писать можно только name/whatsapp/answers/updated_at;
-- pro_* ставит только вебхук (tiptop_grant_pro), lead_ids — только claim_lead.
revoke insert, update on profiles from anon, authenticated;
grant insert (user_id, name, whatsapp, answers, created_at, updated_at) on profiles to authenticated;
grant update (name, whatsapp, answers, updated_at) on profiles to authenticated;

-- ---------- 2. admin_overview: view была пересоздана без revoke ----------
revoke all on admin_overview from anon, authenticated;

-- ---------- 3. Telegram: код привязки генерирует сервер, chat_id пишет только бот ----------
revoke insert, update on tg_links from anon, authenticated;
grant insert (user_id, prefs) on tg_links to authenticated;
grant update (prefs) on tg_links to authenticated;

alter table tg_links add column if not exists code_expires_at timestamptz;

-- Новый код: 16 hex-символов (64 бита) вместо ~50 бит Math.random(), живёт 30 минут.
create or replace function tg_new_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  v_code := upper(encode(gen_random_bytes(8), 'hex'));
  insert into tg_links (user_id, code, code_expires_at)
  values (v_uid, v_code, now() + interval '30 minutes')
  on conflict (user_id) do update
    set code = excluded.code, code_expires_at = excluded.code_expires_at;
  return v_code;
end $$;
revoke all on function tg_new_code() from public;
grant execute on function tg_new_code() to authenticated;

-- tg_bind: принимает только живой код и стирает его после привязки
create or replace function tg_bind(p_code text, p_chat_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  if p_code is null or length(btrim(p_code)) < 8 or p_chat_id is null or length(p_chat_id) > 32 then
    return false;
  end if;
  update tg_links
     set chat_id = p_chat_id, linked_at = now(), code = null, code_expires_at = null
   where code = upper(btrim(p_code)) and chat_id is null
     and coalesce(code_expires_at, now() + interval '1 second') > now();
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

-- ---------- 4. get_report: возврат денег отзывает доступ к отчёту ----------
create or replace function get_report(p_token text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object('data', r.data, 'texts', r.texts, 'created_at', r.created_at)
  from reports r
  left join leads l on l.id = r.lead_id
  where r.token = p_token
    and coalesce(l.tiptop_status, '') <> 'refunded'
  limit 1;
$$;

-- ---------- 5. upsert_lead: после оплаты контакты замораживаются, id — только настоящий ----------
-- Было: анонимный вызов с чужим id мог сменить email/WhatsApp оплаченного лида
-- и через форму «пришлите ссылку заново» получить чужой отчёт.
create or replace function upsert_lead(p_id text, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- только криптостойкие id (uuid / hex); legacy «anon-<ms>» перебираемы и больше не принимаются
  if p_id is null or p_id !~ '^[0-9a-fA-F-]{20,64}$' then
    return;
  end if;
  if p is null or jsonb_typeof(p) <> 'object' or pg_column_size(p) > 250000 then
    return;
  end if;
  insert into leads (id) values (p_id) on conflict (id) do nothing;
  update leads set
    updated_at = now(),
    utm = coalesce(p->'utm', utm),
    -- контакты: до оплаты — как прислали, после оплаты — не трогаем
    name     = case when coalesce(paid, false) then name     else coalesce(left(p->>'name', 120), name) end,
    whatsapp = case when coalesce(paid, false) then whatsapp else coalesce(left(p->>'whatsapp', 32), whatsapp) end,
    email    = case when coalesce(paid, false) then email    else coalesce(left(p->>'email', 254), email) end,
    level = coalesce(p->>'level', level),
    year = coalesce(p->>'year', year),
    gpa_band = coalesce(p->>'gpa_band', gpa_band),
    school_type = coalesce(p->>'school_type', school_type),
    gpa_uni = coalesce(p->>'gpa_uni', gpa_uni),
    gpa_phd = coalesce(p->>'gpa_phd', gpa_phd),
    uni_type = coalesce(p->>'uni_type', uni_type),
    phd_topic = coalesce(left(p->>'phd_topic', 500), phd_topic),
    lang_status = coalesce(p->>'lang_status', lang_status),
    ielts_band = coalesce(p->>'ielts_band', ielts_band),
    sat = coalesce(p->>'sat', sat),
    field = coalesce(left(p->>'field', 200), field),
    achievements = coalesce(left(p->>'achievements', 200), achievements),
    budget = coalesce(p->>'budget', budget),
    priority = coalesce(p->>'priority', priority),
    target_countries = coalesce(left(p->>'target_countries', 200), target_countries),
    target_university = coalesce(left(p->>'target_university', 200), target_university),
    target_major = coalesce(left(p->>'target_major', 200), target_major),
    lead_source = coalesce(left(p->>'lead_source', 100), lead_source),
    lead_interest = coalesce(left(p->>'lead_interest', 100), lead_interest),
    p2_gpa_exact = coalesce(left(p->>'p2_gpa_exact', 20), p2_gpa_exact),
    p2_city_school = coalesce(left(p->>'p2_city_school', 200), p2_city_school),
    p2_ielts_date = coalesce(left(p->>'p2_ielts_date', 40), p2_ielts_date),
    p2_docs_ready = coalesce(left(p->>'p2_docs_ready', 200), p2_docs_ready),
    p2_blocked_account = coalesce(left(p->>'p2_blocked_account', 20), p2_blocked_account),
    p2_lang_year = coalesce(left(p->>'p2_lang_year', 20), p2_lang_year),
    p2_decision_maker = coalesce(left(p->>'p2_decision_maker', 40), p2_decision_maker),
    p2_email = case when coalesce(paid, false) then p2_email else coalesce(left(p->>'p2_email', 254), p2_email) end,
    result = case
      when not coalesce(paid, false)
           and jsonb_typeof(p->'result') = 'object'
           and (p->'result') ? 'portfolio'
           and (p->'result') ? 'profile'
           and pg_column_size(p->'result') < 200000
      then p->'result'
      else result
    end
  where id = p_id;
end $$;

-- ---------- 6. claim_lead: legacy-id не принимаются, чужой лид не переклеить ----------
create or replace function claim_lead(p_lead_id text, p_token text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_lead leads%rowtype;
  v_answers jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_lead_id is null or p_lead_id !~ '^[0-9a-fA-F-]{20,64}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_lead');
  end if;

  select * into v_lead from leads where id = p_lead_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'lead_not_found');
  end if;

  -- лид уже привязан к другому кабинету — без токена отчёта не отдаём
  if exists (select 1 from profiles where user_id <> v_uid and p_lead_id = any(lead_ids)) then
    if p_token is null or not exists (select 1 from reports where lead_id = p_lead_id and token = p_token) then
      return jsonb_build_object('ok', false, 'reason', 'token_required');
    end if;
  end if;

  -- если по лиду есть отчёты, требуем токен одного из них (защита оплаченных данных)
  if exists (select 1 from reports where lead_id = p_lead_id) then
    if p_token is null or not exists (select 1 from reports where lead_id = p_lead_id and token = p_token) then
      return jsonb_build_object('ok', false, 'reason', 'token_required');
    end if;
  end if;

  v_answers := jsonb_strip_nulls(jsonb_build_object(
    'level', v_lead.level, 'year', v_lead.year,
    'gpa_band', v_lead.gpa_band, 'school_type', v_lead.school_type,
    'gpa_uni', v_lead.gpa_uni, 'gpa_phd', v_lead.gpa_phd, 'uni_type', v_lead.uni_type,
    'phd_topic', v_lead.phd_topic, 'lang_status', v_lead.lang_status,
    'ielts_band', v_lead.ielts_band, 'sat', v_lead.sat,
    'field', v_lead.field, 'achievements', v_lead.achievements,
    'budget', v_lead.budget, 'priority', v_lead.priority,
    'target_countries', v_lead.target_countries,
    'target_university', v_lead.target_university, 'target_major', v_lead.target_major
  ));

  insert into profiles (user_id, name, whatsapp, lead_ids, answers)
  values (v_uid, v_lead.name, v_lead.whatsapp, array[p_lead_id], v_answers)
  on conflict (user_id) do update set
    name = coalesce(profiles.name, excluded.name),
    whatsapp = coalesce(profiles.whatsapp, excluded.whatsapp),
    lead_ids = (select array(select distinct unnest(profiles.lead_ids || p_lead_id))),
    answers = coalesce(profiles.answers, '{}'::jsonb) || coalesce(v_answers, '{}'::jsonb),
    updated_at = now();

  return jsonb_build_object('ok', true, 'answers', v_answers,
    'name', v_lead.name, 'paid', coalesce(v_lead.paid, false));
end $$;

-- ---------- 7. events: события из кабинета тоже пишутся; размер ограничен ----------
drop policy if exists events_insert on events;
create policy events_insert on events for insert to anon, authenticated with check (true);
alter table events drop constraint if exists events_payload_size;
alter table events add constraint events_payload_size
  check (pg_column_size(data) < 4096 and pg_column_size(utm) < 2048);

-- ---------- 8. profile_snapshots: снимок недели можно обновить (upsert) ----------
drop policy if exists snapshots_own_update on profile_snapshots;
create policy snapshots_own_update on profile_snapshots for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- 9. Индексы на горячих путях ----------
create index if not exists reports_lead_idx on reports (lead_id, created_at desc);
create index if not exists outcomes_user_idx on outcomes (user_id);
create index if not exists payments_lead_idx on payments (lead_id);
create index if not exists leads_updated_idx on leads (updated_at desc);

-- ---------- 10. Гонка выдачи отчёта: два ретрая вебхука → один отчёт ----------
create or replace function tiptop_issue_report(p_secret text, p_lead text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_row leads%rowtype;
  v_token text;
  v_report_id uuid;
begin
  select value into v_secret from app_secrets where name = 'tiptop_webhook';
  if v_secret is null or length(v_secret) < 24 then
    raise exception 'not_configured';
  end if;
  if p_secret is null or p_secret <> v_secret then
    raise exception 'forbidden';
  end if;

  -- сериализуем по лиду: параллельные уведомления шлюза не создадут два отчёта
  perform pg_advisory_xact_lock(hashtext('issue_report:' || p_lead));

  select * into v_row from leads where id = p_lead;
  if not found then
    return jsonb_build_object('ok', false, 'why', 'no_lead');
  end if;

  select id, token into v_report_id, v_token
  from reports where lead_id = p_lead
  order by created_at desc limit 1;

  if v_token is not null then
    update leads set report_id = coalesce(report_id, v_report_id) where id = p_lead;
    return jsonb_build_object('ok', true, 'existing', true, 'token', v_token,
      'name', v_row.name, 'whatsapp', v_row.whatsapp,
      'email', coalesce(nullif(v_row.email, ''), nullif(v_row.p2_email, '')));
  end if;

  if v_row.result is null or jsonb_typeof(v_row.result) <> 'object'
     or not (v_row.result ? 'portfolio') then
    return jsonb_build_object('ok', false, 'why', 'no_result', 'name', v_row.name,
      'whatsapp', v_row.whatsapp, 'email', coalesce(nullif(v_row.email, ''), nullif(v_row.p2_email, '')));
  end if;

  insert into reports (lead_id, data, texts)
  values (p_lead, v_row.result, null)
  returning id, token into v_report_id, v_token;

  update leads set report_id = v_report_id where id = p_lead;

  return jsonb_build_object('ok', true, 'existing', false, 'token', v_token,
    'name', v_row.name, 'whatsapp', v_row.whatsapp,
    'email', coalesce(nullif(v_row.email, ''), nullif(v_row.p2_email, '')));
end $$;

-- ---------- 11. Дефолтные привилегии: новые таблицы/функции больше не открыты по умолчанию ----------
-- Именно из-за дефолтного GRANT ALL пересозданная admin_overview стала публичной.
-- Дальше каждый новый объект получает доступ только явным grant'ом в миграции.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
