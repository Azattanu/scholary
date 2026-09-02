-- ============================================================
-- Scholary · 015: честный каталог
--
-- ЗАЧЕМ. Проверка официальных сайтов показала две проблемы.
-- 1) Часть программ казахстанцу подать НЕЛЬЗЯ: закрытые списки стран,
--    закрытые программы. Держать их в каталоге как доступные — это врать
--    человеку и тратить его время.
-- 2) В каталоге 21 запись дублирует другую (одна и та же программа заведена
--    дважды под разными названиями), из-за чего счётчик «129 программ»
--    завышен.
-- Ничего не удаляем: помечаем и исключаем из выдачи.
-- Идемпотентно.
-- ============================================================

alter table programs add column if not exists duplicate_of text;

-- ---------- 1. Куда казахстанец подать не может ----------
update programs set available_kz = false, unavailable_note = 'Закрытый список из 18 стран, Казахстана в нём нет'
 where id = 'x-great-scholarships';
update programs set available_kz = false, unavailable_note = 'Список из 13 стран, Казахстана в нём нет'
 where id = 'x-czech-government-scholarship';
update programs set available_kz = false, unavailable_note = 'Только страны V4, Восточного партнёрства и Западных Балкан — Казахстана нет'
 where id = 'x-visegrad-scholarship';
update programs set available_kz = false, unavailable_note = 'Версии для Казахстана не существует, программу больше не ведёт Nuffic'
 where id = 'x-orange-tulip-scholarship-kazakhstan';
update programs set available_kz = false, unavailable_note = 'Программа закрыта, заявки не принимаются; преемник — CGRS-D'
 where id = 'x-vanier-cgs';
update programs set available_kz = false, unavailable_note = 'Казахстана нет в списке стран программы'
 where id in ('x-aga-khan-foundation-isp', 'x-aga-khan-foundation-isp-50-50');
update programs set available_kz = false, unavailable_note = 'Программа PEAK закрыта; преемник — UTokyo College of Design'
 where id = 'x-university-of-tokyo-peak';
update programs set available_kz = false, unavailable_note = 'Подача только через представительство Тайваня, в Казахстане его нет'
 where id = 'x-taiwan-moe-scholarship-huayu';
update programs set available_kz = false, unavailable_note = 'Программа только для граждан Казахстана — это не учёба за рубежом'
 where id in ('x-nazarbayev-university');

-- Исламский банк развития: Казахстан — страна-член, но не LDMC,
-- поэтому доступна только Merit-программа для PhD.
update programs
   set levels = array['phd']::text[],
       note = coalesce(note, '') || ' Казахстану доступна только Merit-программа для PhD: бакалавриат и магистратура IsDB-ISFD — нет.'
 where id = 'x-islamic-development-bank-scholarship';

-- ---------- 2. Дубли ----------
update programs set duplicate_of = 'hkphd'    where id = 'x-hong-kong-phd-fellowship';
update programs set duplicate_of = 'kaust'    where id = 'x-kaust-fellowship';
update programs set duplicate_of = 'mbzuai'   where id = 'x-mbzuai-phd-ai';
update programs set duplicate_of = 'si'       where id = 'x-si-scholarship-for-global-professionals';
update programs set duplicate_of = 'singa'    where id = 'x-singa-a-star-phd';
update programs set duplicate_of = 'csc'      where id = 'x-csc-chinese-government-scholarship';
update programs set duplicate_of = 'gks'      where id = 'x-gks-global-korea-scholarship';
update programs set duplicate_of = 'mext'     where id = 'x-mext';
update programs set duplicate_of = 'anso'     where id = 'x-anso-scholarship-chinese-academy-of-scienc';
update programs set duplicate_of = 'nawa'     where id = 'x-nawa-banach';
update programs set duplicate_of = 'maeci'    where id = 'x-maeci';
update programs set duplicate_of = 'daad'     where id = 'x-daad-epos-development-related-postgraduate';
update programs set duplicate_of = 'erasmus'  where id = 'x-erasmus-mundus-joint-masters';
update programs set duplicate_of = 'us_need'  where id = 'x-need-based-aid-harvard-yale-mit-amherst';
update programs set duplicate_of = 'x-lester-b-pearson-u-of-toronto'   where id = 'x-lester-b-pearson-university-of-toronto';
update programs set duplicate_of = 'x-ubc-international-scholars'      where id = 'x-ubc-international-scholars-imes-karen-mcke';
update programs set duplicate_of = 'x-khalifa-university'              where id = 'x-khalifa-university-scholarship';
update programs set duplicate_of = 'x-fulbright-foreign-student'       where id = 'x-fulbright-foreign-student-program-kz';
update programs set duplicate_of = 'x-aga-khan-foundation-isp'         where id = 'x-aga-khan-foundation-isp-50-50';
update programs set duplicate_of = 'x-kaist-international-scholarship' where id = 'x-kaist-international-student-scholarship';
update programs set duplicate_of = 'x-holland-scholarship-radboud-uva' where id = 'x-nl-scholarship-holland';
update programs set duplicate_of = 'x-prog-11'                         where id = 'x-romania-government-scholarship';
update programs set duplicate_of = 'x-france-excellence-bgf'           where id = 'x-france-excellence-europa';

-- ---------- 3. Что показывать в кабинете ----------
-- Дубли из витрины убираем, недоступные оставляем с честной пометкой.
drop view if exists programs_public;
create view programs_public as
  select * from programs where duplicate_of is null;
grant select on programs_public to anon, authenticated;

-- ---------- ПРОВЕРКА ----------
select
  (select count(*) from programs)                                             as всего_записей,
  (select count(*) from programs where duplicate_of is not null)              as дублей,
  (select count(*) from programs where duplicate_of is null)                  as уникальных,
  (select count(*) from programs where duplicate_of is null and available_kz is not false) as доступно_казахстанцам,
  (select count(distinct country) from programs where duplicate_of is null)   as стран;
