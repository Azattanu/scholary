-- 032 · Вкладка «Документы»: что именно загружено.
-- Проблема: в карточке документа было видно только «Файл — Открыть». Человек
-- не помнил, что он туда положил месяц назад, не мог отличить черновик от
-- финальной версии и боялся нажимать «Заменить». Храним имя файла — это
-- дешёвый способ вернуть человеку контроль над своими документами.

alter table user_documents add column if not exists file_name text;

-- Страховка на права: у user_documents права выданы на таблицу целиком
-- (миграция 030 сюда не заходила), так что новая колонка наследует их.
-- Явный grant ничего не отнимает и защищает от того, что права позже
-- сузят поколоночно, как уже сделано для profiles.
grant select (file_name), insert (file_name), update (file_name)
  on user_documents to authenticated;

-- Самопроверка: колонка на месте
select column_name, data_type
from information_schema.columns
where table_name = 'user_documents' and column_name = 'file_name';
