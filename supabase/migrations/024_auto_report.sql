-- ============================================================
-- 024: автоматическая выдача отчёта после оплаты.
-- Закрывает главную дыру: человек платил, а отчёт делался руками.
-- Схема: квиз сохраняет снимок расчёта движка на лиде (leads.result),
-- вебхук оплаты создаёт строку в reports из этого снимка и шлёт ссылку.
-- Тексты ИИ остаются опциональными: отчёт «только расчёт» — валидное
-- состояние, страница /report/ рендерит его целиком.
-- ============================================================

-- 1) Снимок полного расчёта движка (выход ScholaryEngine.evaluate()).
alter table leads add column if not exists result jsonb;

-- 2) upsert_lead принимает снимок. Ограничения:
--    · структура похожа на выход движка (portfolio + profile), не мусор;
--    · размер до 200 КБ;
--    · после оплаты снимок больше не переписывается — отчёт уже выдан из него.
create or replace function upsert_lead(p_id text, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_id is null or length(p_id) < 8 or length(p_id) > 64 then
    return;
  end if;
  insert into leads (id) values (p_id) on conflict (id) do nothing;
  update leads set
    updated_at = now(),
    utm = coalesce(p->'utm', utm),
    name = coalesce(p->>'name', name),
    whatsapp = coalesce(p->>'whatsapp', whatsapp),
    email = coalesce(p->>'email', email),
    level = coalesce(p->>'level', level),
    year = coalesce(p->>'year', year),
    gpa_band = coalesce(p->>'gpa_band', gpa_band),
    school_type = coalesce(p->>'school_type', school_type),
    gpa_uni = coalesce(p->>'gpa_uni', gpa_uni),
    gpa_phd = coalesce(p->>'gpa_phd', gpa_phd),
    uni_type = coalesce(p->>'uni_type', uni_type),
    phd_topic = coalesce(p->>'phd_topic', phd_topic),
    lang_status = coalesce(p->>'lang_status', lang_status),
    ielts_band = coalesce(p->>'ielts_band', ielts_band),
    sat = coalesce(p->>'sat', sat),
    field = coalesce(p->>'field', field),
    achievements = coalesce(p->>'achievements', achievements),
    budget = coalesce(p->>'budget', budget),
    priority = coalesce(p->>'priority', priority),
    target_countries = coalesce(p->>'target_countries', target_countries),
    target_university = coalesce(p->>'target_university', target_university),
    target_major = coalesce(p->>'target_major', target_major),
    lead_source = coalesce(p->>'lead_source', lead_source),
    lead_interest = coalesce(p->>'lead_interest', lead_interest),
    p2_gpa_exact = coalesce(p->>'p2_gpa_exact', p2_gpa_exact),
    p2_city_school = coalesce(p->>'p2_city_school', p2_city_school),
    p2_ielts_date = coalesce(p->>'p2_ielts_date', p2_ielts_date),
    p2_docs_ready = coalesce(p->>'p2_docs_ready', p2_docs_ready),
    p2_blocked_account = coalesce(p->>'p2_blocked_account', p2_blocked_account),
    p2_lang_year = coalesce(p->>'p2_lang_year', p2_lang_year),
    p2_decision_maker = coalesce(p->>'p2_decision_maker', p2_decision_maker),
    p2_email = coalesce(p->>'p2_email', p2_email),
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

revoke all on function upsert_lead(text, jsonb) from public;
grant execute on function upsert_lead(text, jsonb) to anon;

-- 3) Выдача отчёта. Зовёт только вебхук (секрет тот же, что у tiptop_mark_paid).
--    Идемпотентна: повтор уведомления шлюза вернёт уже выданный отчёт,
--    а не создаст второй.
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

  select * into v_row from leads where id = p_lead;
  if not found then
    return jsonb_build_object('ok', false, 'why', 'no_lead');
  end if;

  -- отчёт уже есть — возвращаем его, ничего не задваивая
  select id, token into v_report_id, v_token
  from reports where lead_id = p_lead
  order by created_at desc limit 1;

  if v_token is not null then
    update leads set report_id = coalesce(report_id, v_report_id) where id = p_lead;
    return jsonb_build_object('ok', true, 'existing', true, 'token', v_token,
      'name', v_row.name, 'whatsapp', v_row.whatsapp,
      'email', coalesce(nullif(v_row.email, ''), nullif(v_row.p2_email, '')));
  end if;

  -- снимка расчёта нет (старый лид или движок не загрузился) —
  -- честно говорим «не смогли», дальше сработает ручной путь
  if v_row.result is null or jsonb_typeof(v_row.result) <> 'object'
     or not (v_row.result ? 'portfolio') then
    return jsonb_build_object('ok', false, 'why', 'no_result');
  end if;

  insert into reports (lead_id, data)
  values (p_lead, v_row.result)
  returning id, token into v_report_id, v_token;

  update leads set report_id = v_report_id, updated_at = now() where id = p_lead;

  return jsonb_build_object('ok', true, 'existing', false, 'token', v_token,
    'name', v_row.name, 'whatsapp', v_row.whatsapp,
    'email', coalesce(nullif(v_row.email, ''), nullif(v_row.p2_email, '')));
end $$;

revoke all on function tiptop_issue_report(text, text) from public;
grant execute on function tiptop_issue_report(text, text) to anon;

-- 4) Отметка «ссылка отправлена» — чтобы дашборд и владелец видели, дошло ли.
create or replace function tiptop_mark_report_sent(
  p_secret text, p_lead text, p_wa text default null, p_email text default null
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
  update leads set
    report_sent_at = coalesce(report_sent_at, now()),
    wa_status    = coalesce(nullif(p_wa, ''), wa_status),
    email_status = coalesce(nullif(p_email, ''), email_status),
    updated_at   = now()
  where id = p_lead;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function tiptop_mark_report_sent(text, text, text, text) from public;
grant execute on function tiptop_mark_report_sent(text, text, text, text) to anon;
