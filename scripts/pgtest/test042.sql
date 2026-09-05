\set ON_ERROR_STOP on
-- пользователи: u1 (реальный), u2 (реальный), t1 (тестовый), admin
insert into auth.users values ('11111111-1111-1111-1111-111111111111','aigerim@gmail.com'),('22222222-2222-2222-2222-222222222222','dias@gmail.com'),('33333333-3333-3333-3333-333333333333','e2e.cab2.1@scholary-test.kz'),('44444444-4444-4444-4444-444444444444','owner@gmail.com') on conflict do nothing;
insert into profiles (user_id, name, answers) values ('11111111-1111-1111-1111-111111111111','Айгерим Тест','{"level":"bachelor"}'),('22222222-2222-2222-2222-222222222222','Диас','{"level":"master"}'),('33333333-3333-3333-3333-333333333333','E2E','{}'),('44444444-4444-4444-4444-444444444444','Азат','{}') on conflict do nothing;
insert into admins values ('44444444-4444-4444-4444-444444444444','owner@gmail.com') on conflict do nothing;
insert into programs values ('sh','Stipendium Hungaricum','Венгрия','hu','{bachelor,master}','01-15','15 января'),('gks','GKS','Корея','kr','{bachelor}','10-17','17 октября') on conflict do nothing;
insert into portfolio_items (user_id, program_id) values ('11111111-1111-1111-1111-111111111111','sh'),('11111111-1111-1111-1111-111111111111','gks'),('22222222-2222-2222-2222-222222222222','sh') on conflict do nothing;
insert into tg_links (user_id, chat_id) values ('11111111-1111-1111-1111-111111111111','1001'),('22222222-2222-2222-2222-222222222222','1002') on conflict do nothing;

-- 1. cab_touch как u1: день ставит сервер, повтор увеличивает actions, progress «липкий»
set role authenticated; select set_config('app.uid','11111111-1111-1111-1111-111111111111', false);
select cab_touch(false); select cab_touch(true); select cab_touch(false);
select 'touch' as t, actions, progress from cab_activity where user_id = auth.uid();
-- 2. RLS: u1 видит только своё
insert into cab_task_state (user_id, task_key, status, week_start) values (auth.uid(), '2026-09-07:doc:apostille:start', 'done', date '2026-09-07');
insert into cab_achievements (user_id, key) values (auth.uid(), 'first_app');
insert into cab_achievements (user_id, key) values (auth.uid(), 'first_app') on conflict do nothing;
update profiles set cab = '{"goal":4,"quiet":["2026-09-07"]}'::jsonb, updated_at = now() where user_id = auth.uid();
select 'cab_pref_update' as t, (cab->>'goal') as goal from profiles where user_id = auth.uid();
select 'own_rows' as t, (select count(*) from cab_task_state) as tasks, (select count(*) from cab_achievements) as ach, (select count(*) from cab_activity) as act;
-- чужая строка не вставляется
do $$ begin
  begin insert into cab_task_state (user_id, task_key) values ('22222222-2222-2222-2222-222222222222', '2026-09-07:x:y'); raise exception 'RLS FAILED: inserted foreign row';
  exception when insufficient_privilege or check_violation then raise notice 'rls ok: foreign insert blocked'; end;
end $$;
-- 3. cab_content: пусто → селект работает, писать нельзя
select 'content_read' as t, count(*) from cab_content;
do $$ begin
  begin insert into cab_content (title) values ('hack'); raise exception 'RLS FAILED: content insert';
  exception when insufficient_privilege then raise notice 'rls ok: content insert blocked'; end;
end $$;
-- 4. admin RPC под обычным пользователем — forbidden
do $$ begin
  begin perform admin_retention(30); raise exception 'ADMIN FAILED: non-admin got data';
  exception when insufficient_privilege then raise notice 'admin ok: forbidden for user'; end;
end $$;
-- u2: другой пользователь не видит u1
select set_config('app.uid','22222222-2222-2222-2222-222222222222', false);
select 'u2_sees' as t, (select count(*) from cab_task_state) as tasks, (select count(*) from cab_activity) as act;
reset role;

-- 5. Дайджест/нудж (anon с секретом)
set role anon;
select 'digest' as t, jsonb_array_length(tg_week_due('x1234567890123456789012345678901234567890','digest')->'items') as n,
  (tg_week_due('x1234567890123456789012345678901234567890','digest')->'items'->0->>'name') as name0;
select 'digest_bad_secret' as t, tg_week_due('bad','digest')->>'ok' as ok;
-- нудж: у u1 есть прогресс на этой неделе → не в списке; u2 без прогресса и с открытой подачей → в списке
select 'nudge' as t, jsonb_array_length(tg_week_due('x1234567890123456789012345678901234567890','nudge')->'items') as n,
  (tg_week_due('x1234567890123456789012345678901234567890','nudge')->'items'->0->>'name') as who;
reset role;
-- отметка отправки убирает из списка
insert into tg_sent (user_id, program_id, milestone) select '22222222-2222-2222-2222-222222222222', 'week:' || (date_trunc('week', (now() at time zone 'Asia/Almaty')::date))::date::text, 101;
set role anon; select 'nudge_after_sent' as t, jsonb_array_length(tg_week_due('x1234567890123456789012345678901234567890','nudge')->'items') as n; reset role;

-- 6. admin_retention под админом
set role authenticated; select set_config('app.uid','44444444-4444-4444-4444-444444444444', false);
select 'retention' as t, (admin_retention(30))::jsonb - 'weekly' as j;
select 'content_upsert' as t, admin_cab_content_upsert('{"title":"Как попросить рекомендацию","kind":"guide","url":"https://scholary.kz/"}'::jsonb);
select 'content_list' as t, json_array_length(admin_cab_content_list()) as n;
reset role;
