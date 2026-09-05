-- 043 · Права на таблицы кабинета (web-74).
-- Та же ловушка, что в 038: политики RLS у cab_* есть, а GRANT для authenticated
-- при создании таблиц из SQL-редактора не выдаётся — вставка отметки задачи и вехи
-- падала с permission denied (клиент молча уходил в localStorage). Плюс profiles.cab:
-- после 030 обновлять можно только перечисленные колонки — добавляем cab.
-- Идемпотентно: GRANT повторно — без ошибок.
grant select on cab_activity to authenticated;                                  -- пишет только cab_touch()
grant select, insert, update, delete on cab_task_state, cab_achievements to authenticated;
grant select on cab_content to authenticated;                                   -- пишут только admin_cab_content_*
grant update (cab) on profiles to authenticated;                                -- цель недели, тихие недели
grant insert (cab) on profiles to authenticated;
revoke all on cab_activity, cab_task_state, cab_achievements, cab_content from anon;

select 'cabinet_grants ok' as status,
  has_table_privilege('authenticated', 'cab_task_state', 'insert') as task_insert,
  has_table_privilege('authenticated', 'cab_achievements', 'insert') as ach_insert,
  has_table_privilege('authenticated', 'cab_activity', 'select') as act_select,
  has_column_privilege('authenticated', 'profiles', 'cab', 'update') as cab_update,
  has_table_privilege('anon', 'cab_task_state', 'select') as anon_task_select;
