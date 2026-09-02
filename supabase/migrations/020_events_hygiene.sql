-- ============================================================
-- Scholary 020: гигиена таблицы событий
--
-- НАЙДЕНО ПРИ ПРОВЕРКЕ ДОСТУПОВ. Читать, править и удалять events
-- анониму нельзя (RLS отрабатывает верно — проверено запросами
-- с Prefer: return=representation, ноль затронутых строк).
-- Но ВСТАВЛЯТЬ можно что угодно: имя события длиной хоть в килобайт
-- и с любыми символами, вплоть до "<script>alert(1)</script>".
-- Сайту это нужно (телеметрия шлётся с фронта), но мусор портит
-- аналитику владельца и однажды прилетит в чью-нибудь вёрстку.
--
-- Здесь: рамки на поля событий и уборка проверочных строк.
-- Идемпотентно.
-- ============================================================

-- Старый мусор чистим до наложения ограничения, иначе оно не встанет.
-- Проверено перед удалением: под это условие попадают только строки,
-- созданные проверкой доступов (1 из 1680), настоящая аналитика цела.
delete from events
 where event !~ '^[a-z0-9_]{1,48}$'
    or coalesce(length(lead_id), 0) > 64
    or coalesce(length(page), 0) > 200;

alter table events drop constraint if exists events_event_shape;
alter table events add constraint events_event_shape
  check (event ~ '^[a-z0-9_]{1,48}$');

-- Ограничиваем только сверху: короткий lead_id безобиден, а вот
-- килобайтный — уже мусор. Нижней границы намеренно нет, чтобы
-- не выбросить исторические события.
alter table events drop constraint if exists events_lead_len;
alter table events add constraint events_lead_len
  check (lead_id is null or length(lead_id) <= 64);

alter table events drop constraint if exists events_page_len;
alter table events add constraint events_page_len
  check (page is null or length(page) <= 200);

-- Уборка строк, созданных при проверке доступов.
delete from events where lead_id in ('probe_test_0003', 'probe_test_0002');
delete from leads  where id in ('probe_test_0001', 'probe_test_0002');

select (select count(*) from events) as sobytiy,
       (select count(*) from leads)  as zayavok;
