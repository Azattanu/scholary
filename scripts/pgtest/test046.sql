\set ON_ERROR_STOP on
-- админ с Telegram, тестовый лид, живые лиды
insert into auth.users values ('a0a0a0a0-1111-1111-1111-111111111111','azat@gmail.com'),('a0a0a0a0-2222-2222-2222-222222222222','e2e.x@scholary-test.kz') on conflict do nothing;
insert into admins (user_id, email) values ('a0a0a0a0-1111-1111-1111-111111111111','azat@gmail.com') on conflict do nothing;
insert into tg_links (user_id, chat_id) values ('a0a0a0a0-1111-1111-1111-111111111111','777') on conflict do nothing;
insert into app_secrets values ('tiptop_webhook','secret-secret-secret-secret-1234') on conflict (name) do update set value = excluded.value;
insert into leads (id, whatsapp, email) values ('lead1','+77010000001','a@b.kz'),('lead2','+77010000002',null),('leadtest','+77010000003','e2e.t@scholary-test.kz');
-- визиты «вчера» по Алматы: 3 живых + 1 тестовый + 1 админка
select set_config('app.uid','', false);
set role anon;
select 'ping_bad_sid' as t, (visit_ping('{"sid":"x","kind":"view","page":"/"}'))->>'why' as why;
select 'ping_admin_skip' as t, (visit_ping('{"sid":"sid-admin-0001","kind":"view","page":"/admin/"}'))->>'skip' as skip;
select 'ping_ok' as t, (visit_ping('{"sid":"sid-0000-0001","kind":"view","page":"/","ref":"https://l.instagram.com/","utm":{"fbclid":"abc"},"device":"mobile","lead_id":"lead1"}'))->>'ok' as ok;
select visit_ping('{"sid":"sid-0000-0001","kind":"view","page":"/quiz/","lead_id":"lead1"}');
select visit_ping('{"sid":"sid-0000-0001","kind":"beat","active_s":40,"lead_id":"lead1"}');
select visit_ping('{"sid":"sid-0000-0001","kind":"beat","active_s":999}');   -- режется до 60
select visit_ping('{"sid":"sid-0000-0002","kind":"view","page":"/schools/","tag":"wa-school","device":"desktop","lead_id":"lead2"}');
select visit_ping('{"sid":"sid-0000-0002","kind":"view","page":"/schools/cabinet/?demo=1"}');
select visit_ping('{"sid":"sid-0000-0003","kind":"view","page":"/","utm":{"utm_source":"tiktok","utm_medium":"cpc","ttclid":"t1"},"device":"mobile"}');
select visit_ping('{"sid":"sid-0000-0004","kind":"view","page":"/quiz/","lead_id":"leadtest"}');
select visit_ping('{"sid":"sid-0000-0005","kind":"view","page":"/","ref":"https://www.google.com/"}');
reset role;
-- сдвигаем всё на вчера
update visits set started_at = started_at - interval '1 day', last_at = last_at - interval '1 day';
update page_views set ts = ts - interval '1 day';
insert into events (lead_id, event, ts, data) values
  ('lead1','quiz_start', now() - interval '1 day', '{}'), ('lead1','quiz_done', now() - interval '1 day', '{}'), ('lead1','pay_click', now() - interval '1 day', '{"via":"kaspi","kind":"report"}'),
  ('lead2','quiz_start', now() - interval '1 day', '{}'), ('lead2','wa_click', now() - interval '1 day', '{}'),
  ('leadtest','quiz_start', now() - interval '1 day', '{}');
insert into payments (txn, lead_id, amount, kind, status, created_at) values ('t1','lead1',4000,'report','success', now() - interval '1 day'), ('t2','leadtest',4000,'report','success', now() - interval '1 day');
update payments set test_mode = false;
-- проверки
select 'active_capped' as t, active_s from visits where sid = 'sid-0000-0001';   -- 40 + 60
select 'pages' as t, pages from visits where sid = 'sid-0000-0002';
select 'channels' as t, channel_of(utm, ref_host, tag) as ch from visits order by sid;
select 'label_tag' as t, channel_label('tag:wa-school') as l;
set role authenticated; select set_config('app.uid','a0a0a0a0-1111-1111-1111-111111111111', false);
select 'day' as t, (admin_day(((now() at time zone 'Asia/Almaty')::date - 1)))->'cur' as cur;
select 'day_channels' as t, jsonb_array_length(admin_day(((now() at time zone 'Asia/Almaty')::date - 1))->'channels') as n;
select 'day_hours' as t, jsonb_array_length(admin_day(((now() at time zone 'Asia/Almaty')::date - 1))->'hours') as n;
select 'days' as t, jsonb_array_length(admin_days(14)) as n;
select 'tags' as t, jsonb_array_length(admin_link_tags()) as n;
select 'tag_add' as t, (admin_link_tag_upsert('QR-Almaty', 'QR · Алматы'))->>'tag' as tag, (admin_link_tag_upsert('bad tag!', 'x'))->>'why' as why;
-- чужой (тестовый аккаунт, не админ)
reset role; select set_config('app.uid','a0a0a0a0-2222-2222-2222-222222222222', false); set role authenticated;
do $$ begin
  begin perform admin_day(current_date); raise exception 'ADMIN RLS FAILED';
  exception when others then if sqlerrm like '%forbidden%' then raise notice 'rls ok: non-admin forbidden'; else raise; end if; end;
end $$;
reset role; set role anon;
select 'digest' as t, (founder_digest_due('secret-secret-secret-secret-1234'))->'stats'->>'visits' as visits, jsonb_array_length((founder_digest_due('secret-secret-secret-secret-1234'))->'recipients') as recipients, (founder_digest_due('wrong'))->>'why' as wrong;
reset role;
select 'test046' as t, 'ok' as ok;
