-- 037 · Админка для workspace профориентолога.
-- admin_school_set принимал только школьные тарифы — теперь и c15/c50/c150;
-- пробный период профориентолога — 14 дней (у школ пилот — месяц).
-- Смена тарифа подставляет места тарифа, если админ не задал их явно.

create or replace function admin_school_set(p_id uuid, p_status text default null, p_plan text default null,
                                            p_seats int default null, p_months int default null,
                                            p_admin_note text default null, p_is_test boolean default null)
returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare s schools;
begin
  if not is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into s from schools where id = p_id;
  if s.id is null then return jsonb_build_object('ok', false, 'why', 'not_found'); end if;

  if p_plan is not null and p_plan in ('pilot','s100','s500','s1000','c15','c50','c150') and p_plan <> s.plan then
    s.plan := p_plan;
    if p_seats is null then
      s.seats := case p_plan when 's100' then 100 when 's500' then 500 when 's1000' then 1000
                             when 'c15' then 15 when 'c50' then 50 when 'c150' then 150
                             else case when s.kind = 'counselor' then 5 else 50 end end;
    end if;
  end if;
  if p_seats is not null and p_seats between 1 and 100000 then s.seats := p_seats; end if;
  if p_admin_note is not null then s.admin_note := left(p_admin_note, 2000); end if;
  if p_is_test is not null then s.is_test := p_is_test; end if;

  if p_status is not null and p_status in ('pending','active','paused','expired','rejected') then
    if p_status = 'active' and s.status <> 'active' then
      if s.invite_code is null then s.invite_code := school_gen_code(); end if;
      if s.claim_token is null then s.claim_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''); end if;
      if s.starts_on is null then s.starts_on := current_date; end if;
      if s.ends_on is null or s.ends_on < current_date then
        if p_months is not null and p_months between 1 and 60 then
          s.ends_on := current_date + (p_months * interval '1 month');
        elsif s.plan = 'pilot' then
          s.ends_on := current_date + (case when s.kind = 'counselor' then interval '14 days' else interval '1 month' end);
        else
          s.ends_on := current_date + interval '12 months';
        end if;
        p_months := null;   -- уже учли
      end if;
    end if;
    s.status := p_status;
  end if;

  if p_months is not null and p_months between 1 and 60 then
    s.ends_on := greatest(coalesce(s.ends_on, current_date), current_date) + (p_months * interval '1 month');
  end if;

  update schools set plan = s.plan, seats = s.seats, admin_note = s.admin_note, is_test = s.is_test,
         status = s.status, invite_code = s.invite_code, claim_token = s.claim_token,
         starts_on = s.starts_on, ends_on = s.ends_on, updated_at = now()
   where id = s.id;

  if s.status = 'active' and s.ends_on is not null then
    update profiles p set pro_until = greatest(coalesce(p.pro_until, current_date), s.ends_on), pro_plan = 'school'
     where p.user_id in (select user_id from school_members where school_id = s.id and status = 'active');
  end if;

  return jsonb_build_object('ok', true, 'id', s.id, 'status', s.status, 'invite_code', s.invite_code,
                            'claim_token', s.claim_token, 'seats', s.seats, 'ends_on', s.ends_on, 'kind', s.kind, 'plan', s.plan);
end $$;
grant execute on function admin_school_set(uuid, text, text, int, int, text, boolean) to authenticated;

-- Файлы профориентолога лежат в его папке бакета docs ({uid}/ws/{student}/…):
-- существующие политики docs_select/insert/update по первому сегменту пути
-- уже это покрывают. Удаление файла при удалении карточки — на клиенте нет,
-- поэтому даём владельцу право удалять свои объекты.
drop policy if exists docs_delete on storage.objects;
create policy docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'docs' and (storage.foldername(name))[1] = auth.uid()::text);

select 'ok' as ok;
