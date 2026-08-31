-- Scholary: безопасный upsert лида с фронта.
-- Anon не может ни читать, ни обновлять leads напрямую; вся запись идёт через RPC.
-- Поля оплаты (paid, paid_at, tiptop_*, report_*) через RPC НЕ доступны.

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
    p2_email = coalesce(p->>'p2_email', p2_email)
  where id = p_id;
end $$;

revoke all on function upsert_lead(text, jsonb) from public;
grant execute on function upsert_lead(text, jsonb) to anon;

-- Прямые политики anon на leads больше не нужны: вся запись через RPC.
drop policy if exists leads_insert on leads;
drop policy if exists leads_update on leads;
