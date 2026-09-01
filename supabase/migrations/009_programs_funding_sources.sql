-- ============================================================
-- Scholary · 009: чем именно программа платит + официальный источник
-- Данные собраны с официальных сайтов операторов (сентябрь 2026).
-- Дедлайны у части программ были указаны неверно — исправлены,
-- в note добавлено, кто именно назначает дату (посольство / вуз / оператор).
-- Идемпотентно: только update по id.
-- ============================================================

update programs set
  funding    = 'обучение 0 ₸ + 43 700 HUF/мес + общежитие или 40 000 HUF/мес и страховка',
  source_url = 'https://stipendiumhungaricum.hu/apply/',
  note       = 'второй трек через Sending Partner — дедлайн раньше; подача до 14:00 CET'
where id = 'sh';

update programs set
  funding    = 'освобождение от платы за учёбу + стипендия 3 800–8 097 € в год + общежитие',
  source_url = 'https://www.edisu.piemonte.it/borse-e-contributi/benefici-economici/borsa-di-studio',
  deadline   = '4 сентября',
  note       = 'грант по доходу семьи (ISEE); окно подачи открывается в конце июля'
where id = 'edisu';

update programs set
  funding    = 'стипендия 2 290–7 557 € в год по доходу семьи + питание + общежитие',
  source_url = 'https://laziodisco.it/bando-diritto-allo-studio-2026-2027/',
  deadline   = '22 июля',
  note       = 'крупнейший региональный фонд Италии; окно подачи открывается в июне'
where id = 'disco';

update programs set
  funding    = 'стипендия 10 800 € за 9 месяцев + медстраховка; плату за учёбу снимает вуз',
  source_url = 'https://www.esteri.it/it/opportunita/borse-di-studio/',
  deadline   = '26 марта',
  note       = 'конкурс объявляют в марте — сверяйся с бандо текущего года'
where id = 'maeci';

update programs set
  funding    = 'обучение 0 ₸ + 4 500–9 000 TL/мес + общежитие + перелёт + год языка',
  source_url = 'https://www.turkiyeburslari.gov.tr/fulltimeprograms',
  deadline   = '20 февраля',
  note       = 'подача открывается 10 января; после отбора — интервью'
where id = 'tb';

update programs set
  funding    = 'обучение 0 ₸ (в Баден-Вюртемберге 1 500 €/сем.) + семестровый взнос 100–350 €',
  source_url = 'https://www.study-in-germany.de/en/',
  note       = 'стипендии нет: нужен блокированный счёт на год жизни'
where id = 'de_pub';

update programs set
  funding    = 'стипендия 992 €/мес (магистратура) или 1 300 €/мес (PhD) + страховка + перелёт',
  source_url = 'https://www.daad.de/en/studying-in-germany/scholarships/daad-scholarships/',
  note       = 'единого дедлайна нет — своя дата у каждой программы в базе DAAD'
where id = 'daad';

update programs set
  funding    = 'обучение бесплатно, если учишься на чешском; жильё и сборы — свои',
  source_url = 'https://studyin.gov.cz/plan-your-studies/learn-czech-study-tuition-free/',
  note       = 'дату ставит сам вуз: обычно февраль–апрель на сентябрьский набор'
where id = 'cz_free';

update programs set
  funding    = 'обучение 0 ₸ + общежитие + 2 500–3 500 CNY/мес + медстраховка',
  source_url = 'https://www.campuschina.org/',
  deadline   = '15 февраля',
  note       = 'точную дату ставит посольство КНР или вуз — обычно январь–февраль, уточни'
where id = 'csc';

update programs set
  funding    = 'обучение 0 ₸ + 3 000 CNY/мес (магистратура), 6 000–7 000 (PhD) + перелёт',
  source_url = 'https://www.anso.org.cn/programmes/talent/scholarship/',
  deadline   = '31 января',
  note       = 'приём открывается в середине октября'
where id = 'anso';

update programs set
  funding    = 'обучение + перелёт + год корейского + 1,14–1,38 млн KRW/мес',
  source_url = 'https://www.studyinkorea.go.kr/in/plan/scholarship.do',
  deadline   = '17 октября',
  note       = 'бакалавриат (GKS-U) подаётся до середины октября, магистратура (GKS-G) — в феврале'
where id = 'gks';

update programs set
  funding    = 'обучение 0 ₸ + 117 000 ¥/мес + авиабилеты в обе стороны',
  source_url = 'https://www.studyinjapan.go.jp/en/planning/scholarship/',
  deadline   = '29 мая',
  note       = 'для Казахстана дату ставит посольство Японии в Астане — сверяйся с их объявлением'
where id = 'mext';

-- ---------- ПРОВЕРКА ----------
select id, name, deadline, left(coalesce(funding,'—'), 40) as funding, (source_url is not null) as has_link
from programs
where id in ('sh','edisu','disco','maeci','tb','de_pub','daad','cz_free','csc','anso','gks','mext')
order by id;
