-- 038 · Права на таблицы workspace и выбор кабинета по типу.
-- Живой прогон показал: политики RLS есть, а GRANT на таблицы ws_* для
-- authenticated не было — вставка карточки падала с permission denied.
-- Плюс school_mine(p_kind): у одного аккаунта могут быть и школа, и workspace
-- профориентолога — каждый кабинет просит своё.

grant select, insert, update, delete on ws_students, ws_apps, ws_docs, ws_notes to authenticated;
grant usage, select on all sequences in schema public to authenticated;

drop function if exists school_mine();
create or replace function school_mine(p_kind text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s schools;
begin
  select * into s from schools
   where owner_user_id = auth.uid()
     and (p_kind is null
          or (p_kind = 'counselor' and kind = 'counselor')
          or (p_kind = 'school' and kind <> 'counselor'))
   order by created_at desc limit 1;
  if s.id is null then return null; end if;
  return jsonb_build_object('id', s.id, 'name', s.name, 'city', s.city, 'kind', s.kind,
    'plan', s.plan, 'plan_label', school_plan_label(s.plan), 'period', s.period,
    'seats', s.seats, 'used', school_used_seats(s.id), 'status', s.status,
    'open', school_is_open(s), 'invite_code', s.invite_code,
    'starts_on', s.starts_on, 'ends_on', s.ends_on,
    'contact_name', s.contact_name, 'contact_email', s.contact_email, 'contact_phone', s.contact_phone,
    'students', (select count(*) from ws_students where school_id = s.id));
end $$;
grant execute on function school_mine(text) to authenticated;

-- school_regen_code / school_roster / school_remove_member работают по owner_user_id
-- без учёта kind — при двух кабинетах у одного аккаунта берут самый новый.
-- Для профориентолога ссылку выпускаем по kind явно.
drop function if exists school_regen_code();
create or replace function school_regen_code(p_kind text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_code text;
begin
  select id into v_id from schools
   where owner_user_id = auth.uid()
     and (p_kind is null or (p_kind = 'counselor' and kind = 'counselor') or (p_kind = 'school' and kind <> 'counselor'))
   order by created_at desc limit 1;
  if v_id is null then return jsonb_build_object('ok', false, 'why', 'forbidden'); end if;
  v_code := school_gen_code();
  update schools set invite_code = v_code, updated_at = now() where id = v_id;
  return jsonb_build_object('ok', true, 'invite_code', v_code);
end $$;
grant execute on function school_regen_code(text) to authenticated;

-- Школьные сводка и удаление ученика — только по школьному кабинету.
create or replace function school_roster()
returns json
language plpgsql stable security definer set search_path = public as $$
declare v_school uuid; j json;
begin
  select id into v_school from schools where owner_user_id = auth.uid() and kind <> 'counselor' order by created_at desc limit 1;
  if v_school is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(json_agg(t order by t.class_label, t.name), '[]'::json) into j
  from (
    select
      m.user_id,
      coalesce(pr.name, '—')                                   as name,
      m.grade, m.class_label, m.joined_at,
      pr.answers->>'level'                                      as level,
      pr.answers->>'field'                                      as field,
      pr.answers->>'target_countries'                           as countries,
      (select ph.p_adm from probability_history ph where ph.user_id = m.user_id order by ph.ts desc limit 1) as p_adm,
      (select ph.p_sch from probability_history ph where ph.user_id = m.user_id order by ph.ts desc limit 1) as p_sch,
      (select count(*) from portfolio_items pi where pi.user_id = m.user_id)                                as apps,
      (select count(*) from portfolio_items pi where pi.user_id = m.user_id and pi.submitted_at is not null) as apps_sent,
      (select count(*) from portfolio_items pi where pi.user_id = m.user_id and pi.outcome = 'admit')          as offers,
      (select count(*) from user_documents d where d.user_id = m.user_id)                                    as docs,
      (select count(*) from user_documents d where d.user_id = m.user_id and d.status = 'ready')             as docs_ready,
      (select min(next_deadline(p.deadline_md))
         from portfolio_items pi join programs p on p.id = pi.program_id
        where pi.user_id = m.user_id and pi.submitted_at is null)                                          as next_deadline,
      greatest(pr.updated_at,
               (select max(pi.updated_at) from portfolio_items pi where pi.user_id = m.user_id),
               (select max(d.updated_at)  from user_documents d  where d.user_id = m.user_id))              as last_active,
      (pr.pro_until >= current_date)                                                                        as pro
    from school_members m
    left join profiles pr on pr.user_id = m.user_id
    where m.school_id = v_school and m.status = 'active'
  ) t;
  return j;
end $$;

create or replace function school_remove_member(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_school uuid; n int;
begin
  select id into v_school from schools where owner_user_id = auth.uid() and kind <> 'counselor' order by created_at desc limit 1;
  if v_school is null then return jsonb_build_object('ok', false, 'why', 'forbidden'); end if;
  update school_members set status = 'removed' where school_id = v_school and user_id = p_user and status = 'active';
  get diagnostics n = row_count;
  update profiles set school_id = null where user_id = p_user and school_id = v_school;
  return jsonb_build_object('ok', n > 0);
end $$;

select has_table_privilege('authenticated', 'ws_students', 'INSERT') as ins_ok, 'ok' as ok;
