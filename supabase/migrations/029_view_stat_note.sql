-- ============================================================
-- 029: programs_engine отдаёт stat_note.
-- Движок v4 использует силу приора: программа, чья базовая ставка
-- опёрта на публичную статистику приёма (stat_note заполнен),
-- даёт более узкий интервал уверенности, чем экспертная оценка.
-- ============================================================
drop view if exists programs_engine;
create or replace view programs_engine as
  select id, name, country, cc, levels, funding,
         base_adm, base_sch, req, deadline, deadline_md, apply_open_md,
         note, fields, lang_year, exam, stat_note, source_url
    from programs
   where duplicate_of is null
     and coalesce(available_kz, true)
     and base_adm is not null and base_adm > 0 and base_adm < 1
     and req is not null and (req ? 'academics') and (req ? 'language');
grant select on programs_engine to anon, authenticated;
