\set ON_ERROR_STOP on
-- школа: владелец o1, приглашённый профориентолог c1, чужой x1, ученики s1..s3
insert into auth.users values
  ('dddddddd-1111-1111-1111-111111111111','director@school.kz'),
  ('dddddddd-2222-2222-2222-222222222222','counselor@school.kz'),
  ('dddddddd-3333-3333-3333-333333333333','stranger@gmail.com'),
  ('dddddddd-4444-4444-4444-444444444444','s1@school.kz'),
  ('dddddddd-5555-5555-5555-555555555555','s2@school.kz'),
  ('dddddddd-6666-6666-6666-666666666666','s3@school.kz') on conflict do nothing;
insert into profiles (user_id, name, answers, pro_until) values
  ('dddddddd-4444-4444-4444-444444444444','Айгерим С.','{"level":"bachelor","field":"IT","target_countries":"Германия, Венгрия"}', current_date + 200),
  ('dddddddd-5555-5555-5555-555555555555','Данияр К.','{"level":"bachelor","field":"Инженерия","target_countries":"Турция"}', current_date + 200),
  ('dddddddd-6666-6666-6666-666666666666','Томирис Ж.','{}', current_date + 200) on conflict do nothing;
insert into schools (id, name, kind, seats, status, invite_code, owner_user_id, ends_on, contact_name, contact_email)
  values ('eeeeeeee-1111-1111-1111-111111111111','Школа-лицей №39','state',500,'active','SCH-TEST-1','dddddddd-1111-1111-1111-111111111111', current_date + 300, 'Директор', 'director@school.kz') on conflict do nothing;
insert into school_members (school_id, user_id, grade, class_label) values
  ('eeeeeeee-1111-1111-1111-111111111111','dddddddd-4444-4444-4444-444444444444','11','11А'),
  ('eeeeeeee-1111-1111-1111-111111111111','dddddddd-5555-5555-5555-555555555555','11','11Б'),
  ('eeeeeeee-1111-1111-1111-111111111111','dddddddd-6666-6666-6666-666666666666','10','10А') on conflict do nothing;
insert into programs (id, name, cc, levels, deadline_md, funding) values ('p-sh','Stipendium Hungaricum','hu','{bachelor}', to_char(current_date + 20, 'MM-DD'), 'full') on conflict do nothing;
insert into portfolio_items (user_id, program_id) values ('dddddddd-4444-4444-4444-444444444444','p-sh');
insert into probability_history (user_id, p_adm, p_sch) values ('dddddddd-4444-4444-4444-444444444444', 0.74, 0.5), ('dddddddd-5555-5555-5555-555555555555', 0.61, 0.4);

-- 1. владелец: сводка, ростер, приглашение
set role authenticated; select set_config('app.uid','dddddddd-1111-1111-1111-111111111111', false);
select 'owner_role' as t, school_role('eeeeeeee-1111-1111-1111-111111111111') as role, (school_mine('school')->>'role') as mine_role;
select 'roster_n' as t, json_array_length(school_roster()) as n;
select 'roster_quiz' as t, (select count(*) from json_array_elements(school_roster()) r where (r->>'quiz_done')::boolean) as quiz_done;
select 'invite' as t, (school_staff_invite('counselor', 'Айгуль', 'counselor@school.kz'))->>'ok' as ok;
select 'staff_listed' as t, jsonb_array_length(school_mine('school')->'staff') as n;
-- владелец пишет запись и шаг
insert into school_notes (school_id, user_id, kind, text, due_on, done) values ('eeeeeeee-1111-1111-1111-111111111111','dddddddd-5555-5555-5555-555555555555','task','Напомнить про апостиль', current_date - 1, false);
insert into school_notes (school_id, user_id, kind, text) values ('eeeeeeee-1111-1111-1111-111111111111','dddddddd-4444-4444-4444-444444444444','status','Статус семье');
insert into school_student_meta (school_id, user_id, next_step, next_step_on) values ('eeeeeeee-1111-1111-1111-111111111111','dddddddd-4444-4444-4444-444444444444','Финал письма', current_date + 3) on conflict (school_id, user_id) do update set next_step = excluded.next_step, next_step_on = excluded.next_step_on;
select 'status_sets_meta' as t, (select last_status_at is not null from school_student_meta where user_id = 'dddddddd-4444-4444-4444-444444444444') as ok;
select 'dash' as t, (school_dashboard()->'week'->>'touches')::int as touches, jsonb_array_length(school_dashboard()->'tasks') as tasks, jsonb_array_length(school_dashboard()->'deadlines') as deadlines;
select 'touch' as t, (school_touch(true))->>'ok' as ok;
select 'archive' as t, (school_archive_season('2025/26', '{"students":3}'))->>'ok' as ok;
select 'seasons' as t, jsonb_array_length(school_dashboard()->'seasons') as seasons;
select 'prefs' as t, (school_prefs_set('{"touch_goal":15}'))->>'ok' as ok;
select 'prefs_read' as t, (school_mine('school')->'prefs'->>'touch_goal') as goal;

-- 2. приглашённый профориентолог принимает ссылку
reset role; select set_config('app.uid','dddddddd-2222-2222-2222-222222222222', false); set role authenticated;
do $$ declare tok text; r jsonb; begin
  reset role;
  select token into tok from school_staff where email = 'counselor@school.kz';
  set role authenticated;
  r := school_staff_claim(tok);
  if (r->>'ok')::boolean and r->>'role' = 'counselor' then raise notice 'claim ok: counselor'; else raise exception 'CLAIM FAILED %', r; end if;
end $$;
select 'staff_sees_roster' as t, json_array_length(school_roster()) as n, (school_mine('school')->>'role') as role;
insert into school_notes (school_id, user_id, kind, text) values ('eeeeeeee-1111-1111-1111-111111111111','dddddddd-5555-5555-5555-555555555555','call','Позвонил маме');
select 'staff_notes_rls' as t, (select count(*) from school_notes) as visible;
select 'staff_no_invite' as t, (school_staff_invite('director'))->>'why' as why;

-- 3. чужой: ничего
reset role; select set_config('app.uid','dddddddd-3333-3333-3333-333333333333', false); set role authenticated;
select 'stranger_notes' as t, (select count(*) from school_notes) as visible, (select count(*) from school_student_meta) as meta;
do $$ begin
  begin perform school_roster(); raise exception 'RLS FAILED';
  exception when others then if sqlerrm like '%forbidden%' then raise notice 'rls ok: stranger forbidden'; else raise; end if; end;
end $$;
do $$ begin
  begin insert into school_notes (school_id, kind, text) values ('eeeeeeee-1111-1111-1111-111111111111','note','взлом'); raise exception 'RLS INSERT FAILED';
  exception when others then raise notice 'rls ok: stranger cannot insert (%)', left(sqlerrm, 40); end;
end $$;
reset role;
select 'test045' as t, 'ok' as ok;
