\set ON_ERROR_STOP on
-- владелец workspace (u1), чужой (u2), тест-аккаунт t1
insert into auth.users values ('aaaaaaaa-1111-1111-1111-111111111111','aigul@gmail.com'),('bbbbbbbb-2222-2222-2222-222222222222','other@gmail.com') on conflict do nothing;
insert into profiles (user_id, name, answers) values ('aaaaaaaa-1111-1111-1111-111111111111','Айгуль','{}'),('bbbbbbbb-2222-2222-2222-222222222222','Чужой','{}') on conflict do nothing;
insert into schools (id, name, kind, seats, status, invite_code, owner_user_id, ends_on, contact_name, contact_email)
  values ('cccccccc-3333-3333-3333-333333333333','Workspace Айгуль','counselor',3,'active','WS-TEST-1','aaaaaaaa-1111-1111-1111-111111111111', current_date + 300, 'Айгуль Сериковна', 'aigul@gmail.com') on conflict do nothing;
insert into tg_links (user_id, chat_id) values ('aaaaaaaa-1111-1111-1111-111111111111','5001') on conflict do nothing;

set role authenticated; select set_config('app.uid','aaaaaaaa-1111-1111-1111-111111111111', false);
-- 1. ученики: 3 места
insert into ws_students (school_id, name, stage, email) values
  ('cccccccc-3333-3333-3333-333333333333','Данияр Касымов','docs','daniyar@example.kz'),
  ('cccccccc-3333-3333-3333-333333333333','Айгерим Сериккызы','applying','aigerim@example.kz'),
  ('cccccccc-3333-3333-3333-333333333333','Томирис Ж.','intake',null);
select 'seats_used' as t, (school_mine('counselor')->>'used')::int as n;
-- 4-й не влезает
do $$ begin
  begin insert into ws_students (school_id, name) values ('cccccccc-3333-3333-3333-333333333333','Лишний'); raise exception 'CAP FAILED';
  exception when others then if sqlerrm like '%seats_full%' then raise notice 'cap ok: seats_full'; else raise; end if; end;
end $$;
-- архив освобождает место, 4-й входит, разархивировать нельзя
update ws_students set archived = true where name = 'Томирис Ж.';
select 'seats_after_archive' as t, (school_mine('counselor')->>'used')::int as n;
insert into ws_students (school_id, name, stage) values ('cccccccc-3333-3333-3333-333333333333','Четвёртый','intake');
do $$ begin
  begin update ws_students set archived = false where name = 'Томирис Ж.'; raise exception 'UNARCHIVE CAP FAILED';
  exception when others then if sqlerrm like '%seats_full%' then raise notice 'cap ok: unarchive blocked'; else raise; end if; end;
end $$;
-- 2. следующий шаг, семья
update ws_students set next_step = 'Заказать апостиль', next_step_on = current_date + 3, parent_email = 'mama@example.kz' where name = 'Данияр Касымов';
update ws_students set next_step = 'Финал письма', next_step_on = current_date - 2 where name = 'Айгерим Сериккызы';
-- 3. подачи, задачи, встречи, статус
insert into ws_apps (student_id, name, country, deadline, status) select id, 'Türkiye Bursları', 'Турция', current_date + 5, 'prep' from ws_students where name = 'Данияр Касымов';
insert into ws_apps (student_id, name, country, deadline, status) select id, 'Stipendium Hungaricum', 'Венгрия', current_date + 40, 'study' from ws_students where name = 'Айгерим Сериккызы';
insert into ws_notes (student_id, kind, text, done, due_on) select id, 'task', 'Напомнить про апостиль', false, current_date - 1 from ws_students where name = 'Данияр Касымов';
insert into ws_notes (student_id, kind, text, done, due_on) select id, 'task', 'Правки письма', false, current_date from ws_students where name = 'Айгерим Сериккызы';
insert into ws_notes (student_id, kind, text, due_on, at_time, minutes) select id, 'meeting', 'Созвон с мамой', current_date + 1, '18:30', 30 from ws_students where name = 'Данияр Касымов';
insert into ws_notes (student_id, kind, text) select id, 'status', 'Статус семье: этап документы…' from ws_students where name = 'Данияр Касымов';
-- закрыть задачу → done_at
update ws_notes set done = true where text = 'Правки письма';
select 'done_at_set' as t, (done_at is not null) as ok from ws_notes where text = 'Правки письма';
-- 4. касание и ритм
select 'touch' as t, ws_touch(false)->>'ok' as ok; select ws_touch(true);
select 'activity' as t, actions, progress from ws_activity;
-- 5. дашборд: форма
select 'dashboard' as t, jsonb_array_length(d->'apps') as apps, jsonb_array_length(d->'tasks') as tasks, jsonb_array_length(d->'meetings') as meetings,
  (d->'week'->>'touches')::int as touches, (d->'week'->>'tasks_done')::int as tasks_done, (d->'week'->>'statuses')::int as statuses, jsonb_array_length(d->'week'->'moved') as moved, jsonb_array_length(d->'activity') as act
from ws_dashboard() d;
-- ростер: новые поля
select 'roster' as t, count(*) filter (where (r->>'archived')::boolean) as archived, count(*) filter (where r->>'next_step' is not null) as with_step, count(*) filter (where r->>'last_touch' is not null) as touched, count(*) filter (where r->>'next_meeting' is not null) as with_meeting
from json_array_elements(ws_roster()) r;
-- 6. импорт: дубли + лимит (мест 3, занято 3 → 0 входит)
select 'import_full' as t, ws_import('[{"name":"Данияр Касымов"},{"name":"Новый Ученик","email":"new@example.kz"}]'::jsonb) as r;
-- освободили место → импорт входит, дубль по имени пропущен
update ws_students set archived = true where name = 'Четвёртый';
select 'import_ok' as t, ws_import('[{"name":"Данияр Касымов"},{"name":"Новый Ученик","email":"new@example.kz","grade":"10","parent_name":"Мама"},{"name":"Ещё Один"}]'::jsonb) as r;
-- 7. настройки
select 'prefs' as t, school_set_prefs('{"touch_goal":12,"digest":true}'::jsonb)->>'ok' as ok;
select 'prefs_saved' as t, ws_dashboard()->'prefs'->>'touch_goal' as goal;
-- 8. чужой: forbidden, 0 строк
select set_config('app.uid','bbbbbbbb-2222-2222-2222-222222222222', false);
select 'other_sees' as t, (select count(*) from ws_students) as students, (select count(*) from ws_activity) as act;
do $$ begin
  begin perform ws_dashboard(); raise exception 'RLS FAILED: other got dashboard';
  exception when insufficient_privilege then raise notice 'rls ok: other forbidden'; end;
end $$;
reset role;
-- 9. дайджест anon с секретом
set role anon;
select 'digest' as t, jsonb_array_length(d->'items') as n, d->'items'->0->>'name' as who, (d->'items'->0->>'deadlines_7')::int as dl7, (d->'items'->0->>'overdue')::int as overdue, (d->'items'->0->>'no_step')::int as no_step, (d->'items'->0->>'meetings')::int as meetings
from ws_digest_due('x1234567890123456789012345678901234567890') d;
select 'digest_bad' as t, ws_digest_due('bad')->>'ok' as ok;
reset role;
select 'anon_table' as t, has_table_privilege('anon', 'ws_students', 'select') as anon_students, has_table_privilege('authenticated', 'ws_activity', 'select') as auth_act;
