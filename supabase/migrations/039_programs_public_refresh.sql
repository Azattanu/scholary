-- 039 · programs_public создана в 015 как select * — и «заморозила» список
-- колонок того времени: deadline_md / apply_open_md / available_kz из 027 в
-- представление не попали. Каталог в workspace профориентолога их просит.
-- Пересоздаём с тем же условием; права сохраняем.
drop view if exists programs_public;
create view programs_public as
  select * from programs where duplicate_of is null;
grant select on programs_public to anon, authenticated;

select count(*) as programs, count(deadline_md) as with_deadline_md from programs_public;
