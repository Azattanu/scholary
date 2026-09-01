-- ============================================================
-- Scholary · 012: доступность программы для казахстанца + данные ещё по 8 программам
-- Нашли две программы, куда гражданин РК подать не может:
--   · SI Global Professionals (Швеция) — Казахстана нет в списке 34 стран;
--   · SINGA (Сингапур) — A*STAR сняла страницу награды с публикации.
-- Такие программы больше не попадают ни в каталог, ни в платный отчёт:
-- рекомендовать то, куда нельзя подать, — худшее, что может сделать сервис.
-- Строки не удаляем: программа может вернуться, история подач остаётся валидной.
-- Идемпотентно.
-- ============================================================

alter table programs add column if not exists available_kz boolean not null default true;
alter table programs add column if not exists unavailable_note text;

update programs set
  funding    = 'обучение бесплатно + 1 400 €/мес на жизнь, переезд и визу (до 33 600 € за 2 года)',
  source_url = 'https://www.eacea.ec.europa.eu/scholarships/erasmus-mundus-catalogue_en',
  note       = 'единого дедлайна нет: дату ставит консорциум программы, обычно октябрь–январь'
where id = 'erasmus';

update programs set
  funding    = 'стипендия 344 400 HK$ в год + 14 400 HK$ на конференции, до 3 лет',
  source_url = 'https://cerg1.ugc.edu.hk/hkpfs/index.html',
  deadline   = '1 декабря',
  note       = 'подача в RGC до 12:00 по Гонконгу и отдельно в сам вуз; максимум две программы'
where id = 'hkphd';

update programs set
  funding    = 'обучение 0 $ + стипендия 20 000–30 000 $ в год + жильё, страховка и перелёт',
  source_url = 'https://admissions.kaust.edu.sa/fees-funding',
  deadline   = '3 января',
  note       = 'для осеннего набора один раунд; финансирование оформляют уже принятым, бывают интервью'
where id = 'kaust';

update programs set
  funding    = 'обучение 0 + ежемесячная стипендия + жильё в кампусе, страховка и перелёт домой',
  source_url = 'https://mbzuai.ac.ae/study/graduate-admission-process/',
  deadline   = '15 декабря',
  note       = 'сумму стипендии вуз не публикует; решения приходят к концу марта'
where id = 'mbzuai';

update programs set
  funding    = 'обучение 0 zł в госвузах + 2 500 zł в месяц + бесплатный курс польского',
  source_url = 'https://nawa.gov.pl/en/students/foreign-students/the-banach-scholarship-programme/landing',
  deadline   = '8 мая',
  note       = 'Казахстан в списке стран; набор закрывается досрочно, когда кончается квота заявок'
where id = 'nawa';

update programs set
  funding    = 'доход семьи до 100 000 $ — учёба и жизнь бесплатно; до 200 000 $ — бесплатное обучение',
  source_url = 'https://college.harvard.edu/financial-aid',
  deadline   = '1 января',
  note       = 'это не стипендия, а помощь по доходу семьи; Harvard, Yale и MIT смотрят заявку без оглядки на деньги'
where id = 'us_need';

-- ---------- НЕДОСТУПНЫЕ ----------
update programs set
  funding          = 'обучение 0 kr + 12 000 SEK в месяц + 15 000 SEK на перелёт',
  source_url       = 'https://si.se/en/apply/scholarships/swedish-institute-scholarships-for-global-professionals/',
  available_kz     = false,
  unavailable_note = 'Казахстана нет в списке 34 стран программы — гражданин РК подать не может'
where id = 'si';

update programs set
  funding          = 'обучение + ежемесячная стипендия + перелёт и подъёмные',
  source_url       = 'https://www.a-star.edu.sg/scholarships/home/international-awards',
  available_kz     = false,
  unavailable_note = 'A*STAR сняла страницу награды с публикации — приём приостановлен'
where id = 'singa';

-- ---------- ПРОВЕРКА ----------
select id, name, available_kz, coalesce(unavailable_note,'—') as why,
       (source_url is not null) as has_link, (funding is not null) as has_funding
from programs where available_kz = false or id in ('erasmus','hkphd','kaust','mbzuai','nawa','us_need')
order by available_kz, id;
