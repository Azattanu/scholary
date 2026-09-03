/* ============================================================
   Scholary Report Engine v3 — единая логика персонального отчёта.
   Работает и в браузере (window.ScholaryEngine — превью на пейволле),
   и в Node на бэкенде (module.exports — генерация полного отчёта).

   ПОТОК ДАННЫХ:
   ответы квиза (фаза 1 [+ фаза 2]) → profile (6 осей, 0–10)
   → матчинг по каталогу программ → ДВЕ вероятности на программу
   (поступление и стипендия) → портфель 8–10 → вердикт, бустеры,
   P(хотя бы один оффер).

   ВАЖНО ДЛЯ КАЛИБРОВКИ: базовые ставки (baseAdm/baseSch) — экспертные
   оценки с приорами из публичной статистики программ (там, где она
   публикуется: SH, Türkiye, GKS...). Они честно «около-правильные»,
   не точные. С первых исходов их калибруем данными. Формулы простые
   и монотонные специально: их легко объяснить и легко калибровать.

   НОВОЕ В v3 (сентябрь 2026):
   · каталог загружается из Supabase (витрина programs_engine) с жёсткой
     валидацией и фолбэком на встроенный список — сайт живёт при любом
     состоянии базы;
   · ТОЧКА Б: вероятность считается дважды — «профиль сегодня» и «профиль
     к дедлайну при выполнении плана» (рост языка ~0.5 балла IELTS за
     8–10 недель подготовки — ориентир Cambridge/IELTS о ~100–200 часах
     на балл; письма; SAT по плану);
   · ОКНА ЦИКЛА: у программ есть машиночитаемые деадлайны (MM-DD) —
     движок говорит «осталось N недель» и честно помечает, куда в этот
     цикл уже не успеть;
   · УВЕРЕННОСТЬ: интервал вокруг вероятности; ширина зависит от полноты
     данных (7 ответов квиза → шире, фаза 2 и кабинет → уже).
   Выход evaluate() — строгое НАДМНОЖЕСТВО v1/v2: старые отчёты и старые
   страницы продолжают работать без изменений.
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ScholaryEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- 1. ПРОФИЛЬ: 6 осей из ответов ---------- */
  function profileFromAnswers(a) {
    a = a || {};
    var level = a.level === "master" || a.level === "phd" ? a.level : "bachelor";

    // Академика
    var academics;
    if (level === "bachelor") {
      academics = { "5.0-4.5": 8.5, "4.4-4.0": 7, "3.9-3.5": 5, "<3.5": 3.5 }[a.gpa_band] || 5;
      academics += { nis: 1, rfmsh: 1, lyceum: 0.5 }[a.school_type] || 0;
    } else {
      var g = level === "phd" ? a.gpa_phd : a.gpa_uni;
      academics = { "3.67+": 8.5, "3.33-3.66": 7, "3.0-3.32": 5.5, "<3.0": 4, unknown: 5.5 }[g] || 5.5;
      academics += { nu: 1, foreign: 1, top_kz: 0.5 }[a.uni_type] || 0;
    }
    // точный GPA из фазы 2 уточняет ось (если есть)
    if (a.p2_gpa_exact) {
      var x = parseFloat(String(a.p2_gpa_exact).replace(",", "."));
      if (x > 0 && x <= 5 && level === "bachelor") academics = 2 + (x / 5) * 7 + ({ nis: 1, rfmsh: 1 }[a.school_type] || 0);
      if (x > 0 && x <= 4 && level !== "bachelor") academics = 2 + (x / 4) * 7;
    }

    // Язык (+ небольшой бонус за SAT — он же сигнал академической готовности)
    // Значения приходят из квиза строками. Если однажды появится новый вариант
    // ответа, а таблицу забудут дополнить, балл молча станет средним и отчёт
    // будет врать — поэтому такие случаи отмечаем в аналитике, а не проглатываем.
    var LANG_HAVE = { "7+": 9, "6.5": 7.5, "6.0": 6, "5.5": 4.5, "<5.5": 3, unknown: 5.5 };
    var LANG_SOON = { "7+": 7, "6.5": 6, "6.0": 5, "5.5": 4, "<5.5": 3, unknown: 4.5 };
    var language = 2;
    if (a.lang_status === "have" || a.lang_status === "soon") {
      var tbl = a.lang_status === "have" ? LANG_HAVE : LANG_SOON;
      if (Object.prototype.hasOwnProperty.call(tbl, a.ielts_band)) language = tbl[a.ielts_band];
      else {
        language = a.lang_status === "have" ? 5.5 : 4.5;
        try { if (typeof window !== "undefined" && window.track) window.track("engine_unknown_value", { field: "ielts_band" }); } catch (e) {}
      }
    }
    var sat = { "1400+": 9, "1200-1399": 6.5, "<1200": 4, plan: 0, no: 0 }[a.sat] || 0;

    // Достижения
    var W = { intl_olymp: 4, rep_olymp: 3, publications: 3, city_olymp: 2, project: 2, work_exp: 2, volunteer: 1, sport_art: 1 };
    var achievements = (a.achievements || []).reduce(function (s, k) { return s + (W[k] || 0); }, 0);
    achievements = Math.min(10, 2 + achievements);

    // Мотивационное: до разбора письма — среднее; PhD с темой — выше
    var motivation = 5;
    if (a.phd_topic === "defined") motivation = 7;
    if (a.phd_topic === "none") motivation = 4;

    // Бюджет как ресурсная ось
    var budget = { "0": 2, "<1m": 4, "1-3m": 7, "3m+": 10 }[a.budget] || 4;
    if (a.p2_blocked_account === "Да") budget = Math.max(budget, 8);

    // Соответствие: осознанность выбора
    var fit = 5.5 + ((a.field || []).length > 1 ? 0.75 : 0) + (a.priority ? 0.75 : 0) + ((a.target_countries || []).length ? 0.5 : 0);

    return {
      level: level,
      axes: {
        academics: clamp(academics, 0, 10),
        language: clamp(language, 0, 10),
        achievements: achievements,
        motivation: motivation,
        budget: budget,
        fit: clamp(fit, 0, 10)
      },
      sat: sat
    };
  }

  /* ---------- 2. КАТАЛОГ (ядро; полный — в Supabase, синхронизировать!) ----------
     req: минимально комфортный уровень оси (0–10); baseAdm/baseSch — базовая
     вероятность для «ровно подходящего» профиля; sch:null = стипендии нет
     (например, бесплатное обучение без стипендии). */
  var PROGRAMS = [
    { id: "sh", name: "Stipendium Hungaricum", country: "Венгрия", cc: "hu", levels: ["bachelor", "master", "phd"], baseAdm: .52, baseSch: .45, req: { academics: 6, language: 5, budget: 0 }, deadline: "15 января", note: "второй трек через Sending Partner — дедлайн раньше; подача до 14:00 CET", funding: "обучение 0 ₸ + 43 700 HUF/мес + общежитие или 40 000 HUF/мес и страховка", source_url: "https://stipendiumhungaricum.hu/apply/" },
    { id: "edisu", name: "EDISU Piemonte", country: "Италия", cc: "it", levels: ["bachelor", "master"], baseAdm: .55, baseSch: .5, req: { academics: 5, language: 5.5, budget: 2 }, deadline: "4 сентября", note: "грант по доходу семьи (ISEE); окно подачи открывается в конце июля", funding: "освобождение от платы за учёбу + стипендия 3 800–8 097 € в год + общежитие", source_url: "https://www.edisu.piemonte.it/borse-e-contributi/benefici-economici/borsa-di-studio" },
    { id: "disco", name: "DiSCo Lazio", country: "Италия", cc: "it", levels: ["bachelor", "master"], baseAdm: .52, baseSch: .47, req: { academics: 5, language: 5.5, budget: 2 }, deadline: "22 июля", note: "крупнейший региональный фонд Италии; окно подачи открывается в июне", funding: "стипендия 2 290–7 557 € в год по доходу семьи + питание + общежитие", source_url: "https://laziodisco.it/bando-diritto-allo-studio-2026-2027/" },
    { id: "maeci", name: "MAECI (правительство Италии)", country: "Италия", cc: "it", levels: ["master", "phd"], baseAdm: .3, baseSch: .3, req: { academics: 7, language: 6.5, budget: 0 }, deadline: "26 марта", note: "конкурс объявляют в марте — сверяйся с бандо текущего года", funding: "стипендия 10 800 € за 9 месяцев + медстраховка; плату за учёбу снимает вуз", source_url: "https://www.esteri.it/it/opportunita/borse-di-studio/" },
    { id: "tb", name: "Türkiye Burslari", country: "Турция", cc: "tr", levels: ["bachelor", "master", "phd"], langYear: true, baseAdm: .3, baseSch: .3, req: { academics: 6.5, language: 3, budget: 0 }, deadline: "20 февраля", note: "подача открывается 10 января; после отбора — интервью", funding: "обучение 0 ₸ + 4 500–9 000 TL/мес + общежитие + перелёт + год языка", source_url: "https://www.turkiyeburslari.gov.tr/fulltimeprograms" },
    { id: "de_pub", name: "Гос. вузы Германии (0 ₸)", country: "Германия", cc: "de", levels: ["bachelor", "master"], baseAdm: .6, baseSch: null, req: { academics: 6, language: 6, budget: 7 }, deadline: "15 июля / 15 янв", note: "стипендии нет: нужен блокированный счёт на год жизни", funding: "обучение 0 ₸ (в Баден-Вюртемберге 1 500 €/сем.) + семестровый взнос 100–350 €", source_url: "https://www.study-in-germany.de/en/" },
    { id: "daad", name: "DAAD EPOS", country: "Германия", cc: "de", levels: ["master"], baseAdm: .25, baseSch: .25, req: { academics: 7, language: 6.5, budget: 0 }, deadline: "авг–окт", note: "единого дедлайна нет — своя дата у каждой программы в базе DAAD", funding: "стипендия 992 €/мес (магистратура) или 1 300 €/мес (PhD) + страховка + перелёт", source_url: "https://www.daad.de/en/studying-in-germany/scholarships/daad-scholarships/" },
    { id: "cz_free", name: "Чехия: гос. вузы на чешском (0 ₸)", country: "Чехия", cc: "cz", levels: ["bachelor", "master"], langYear: true, baseAdm: .42, baseSch: null, req: { academics: 5, language: 3, budget: 4 }, deadline: "28 февраля", note: "дату ставит сам вуз: обычно февраль–апрель на сентябрьский набор", funding: "обучение бесплатно, если учишься на чешском; жильё и сборы — свои", source_url: "https://studyin.gov.cz/plan-your-studies/learn-czech-study-tuition-free/" },
    { id: "csc", name: "CSC (гранты Китая)", country: "Китай", cc: "cn", levels: ["bachelor", "master", "phd"], langYear: true, baseAdm: .45, baseSch: .4, req: { academics: 5.5, language: 4, budget: 0 }, deadline: "15 февраля", note: "точную дату ставит посольство КНР или вуз — обычно январь–февраль, уточни", funding: "обучение 0 ₸ + общежитие + 2 500–3 500 CNY/мес + медстраховка", source_url: "https://www.campuschina.org/" },
    { id: "anso", name: "ANSO (Академия наук КНР)", country: "Китай", cc: "cn", levels: ["master", "phd"], baseAdm: .35, baseSch: .35, req: { academics: 7, language: 6, budget: 0 }, deadline: "31 января", note: "приём открывается в середине октября", funding: "обучение 0 ₸ + 3 000 CNY/мес (магистратура), 6 000–7 000 (PhD) + перелёт", source_url: "https://www.anso.org.cn/programmes/talent/scholarship/" },
    { id: "gks", name: "GKS (Корея)", country: "Корея", cc: "kr", levels: ["bachelor", "master", "phd"], langYear: true, baseAdm: .25, baseSch: .25, req: { academics: 7.5, language: 5, budget: 0 }, deadline: "17 октября", note: "бакалавриат (GKS-U) подаётся до середины октября, магистратура (GKS-G) — в феврале", funding: "обучение + перелёт + год корейского + 1,14–1,38 млн KRW/мес", source_url: "https://www.studyinkorea.go.kr/in/plan/scholarship.do" },
    { id: "mext", name: "MEXT (Япония)", country: "Япония", cc: "jp", levels: ["bachelor", "master", "phd"], langYear: true, baseAdm: .22, baseSch: .22, req: { academics: 7.5, language: 5.5, budget: 0 }, deadline: "29 мая", note: "для Казахстана дату ставит посольство Японии в Астане — сверяйся с их объявлением", funding: "обучение 0 ₸ + 117 000 ¥/мес + авиабилеты в обе стороны", source_url: "https://www.studyinjapan.go.jp/en/planning/scholarship/" },
    { id: "erasmus", name: "Erasmus Mundus", country: "ЕС", cc: "eu", levels: ["master"], baseAdm: .28, baseSch: .28, req: { academics: 7, language: 6.5, budget: 0 }, deadline: "окт–янв", note: "единого дедлайна нет: дату ставит консорциум программы, обычно октябрь–январь", funding: "обучение бесплатно + 1 400 €/мес на жизнь, переезд и визу (до 33 600 € за 2 года)", source_url: "https://www.eacea.ec.europa.eu/scholarships/erasmus-mundus-catalogue_en" },
    { id: "si", name: "SI Global Professionals (Швеция)", country: "Швеция", cc: "se", levels: ["master"], baseAdm: .18, baseSch: .18, req: { academics: 7.5, language: 7, budget: 0 }, deadline: "февраль", note: "Казахстана нет в списке стран программы — подать нельзя", funding: "обучение 0 kr + 12 000 SEK в месяц + 15 000 SEK на перелёт", source_url: "https://si.se/en/apply/scholarships/swedish-institute-scholarships-for-global-professionals/", availableKz: false },
    { id: "us_need", name: "Need-based aid (США, топ-вузы)", country: "США", cc: "us", levels: ["bachelor"], baseAdm: .1, baseSch: .55, req: { academics: 9, language: 8.5, budget: 0, sat: 7 }, deadline: "1 января", note: "это не стипендия, а помощь по доходу семьи; Harvard, Yale и MIT смотрят заявку без оглядки на деньги", funding: "доход семьи до 100 000 $ — учёба и жизнь бесплатно; до 200 000 $ — бесплатное обучение", source_url: "https://college.harvard.edu/financial-aid" },
    { id: "kaust", name: "KAUST (Сауд. Аравия)", country: "Саудовская Аравия", cc: "sa", levels: ["master", "phd"], baseAdm: .3, baseSch: .95, req: { academics: 7.5, language: 6.5, budget: 0 }, deadline: "3 января", note: "для осеннего набора один раунд; финансирование оформляют уже принятым, бывают интервью", funding: "обучение 0 $ + стипендия 20 000–30 000 $ в год + жильё, страховка и перелёт", source_url: "https://admissions.kaust.edu.sa/fees-funding" },
    { id: "mbzuai", name: "MBZUAI (ОАЭ, AI)", country: "ОАЭ", cc: "ae", levels: ["master", "phd"], baseAdm: .3, baseSch: .95, req: { academics: 7.5, language: 6.5, budget: 0 }, deadline: "15 декабря", note: "сумму стипендии вуз не публикует; решения приходят к концу марта", fields: ["it", "eng"], funding: "обучение 0 + ежемесячная стипендия + жильё в кампусе, страховка и перелёт домой", source_url: "https://mbzuai.ac.ae/study/graduate-admission-process/" },
    { id: "nawa", name: "NAWA Banach (Польша)", country: "Польша", cc: "pl", levels: ["master"], baseAdm: .35, baseSch: .35, req: { academics: 6, language: 5.5, budget: 0 }, deadline: "8 мая", note: "Казахстан в списке стран; набор закрывается досрочно, когда кончается квота заявок", funding: "обучение 0 zł в госвузах + 2 500 zł в месяц + бесплатный курс польского", source_url: "https://nawa.gov.pl/en/students/foreign-students/the-banach-scholarship-programme/landing" },
    { id: "hkphd", name: "Hong Kong PhD Fellowship", country: "Гонконг", cc: "hk", levels: ["phd"], baseAdm: .2, baseSch: .2, req: { academics: 8, language: 7, budget: 0 }, deadline: "1 декабря", note: "подача в RGC до 12:00 по Гонконгу и отдельно в сам вуз; максимум две программы", funding: "стипендия 344 400 HK$ в год + 14 400 HK$ на конференции, до 3 лет", source_url: "https://cerg1.ugc.edu.hk/hkpfs/index.html" },
    { id: "singa", name: "SINGA (Сингапур)", country: "Сингапур", cc: "sg", levels: ["phd"], baseAdm: .22, baseSch: .22, req: { academics: 8, language: 6.5, budget: 0 }, deadline: "1 июня / 1 дек", note: "программа снята с публикации у A*STAR — приём приостановлен, следи за их сайтом", funding: "обучение + ежемесячная стипендия + перелёт и подъёмные", source_url: "https://www.a-star.edu.sg/scholarships/home/international-awards", availableKz: false },

    /* ---- программы, добавленные после ручной проверки официальных сайтов (сентябрь 2026) ----
       У каждой сверены: доступность для граждан Казахстана, дедлайн, что покрывает
       финансирование, минимальный балл и языковое требование. Программы, куда
       казахстанец подать не может, в этот список не попали вовсе. ---- */
    { id: "chevening", name: "Chevening", country: "Великобритания", cc: "gb", levels: ["master"], baseAdm: .12, baseSch: .12, req: { academics: 7.5, language: 7, budget: 0 }, deadline: "6 октября", note: "нужен опыт работы 2 года и обязательство вернуться в Казахстан на 2 года; безусловный оффер вуза — до дедлайна", funding: "обучение полностью + стипендия на жизнь + перелёт и подъёмные", source_url: "https://www.chevening.org/scholarship/kazakhstan/" },
    { id: "clarendon", name: "Clarendon Fund (Оксфорд)", country: "Великобритания", cc: "gb", levels: ["master", "phd"], baseAdm: .1, baseSch: .1, req: { academics: 9, language: 8, budget: 0 }, deadline: "декабрь – январь", note: "отдельной заявки нет: рассматривают всех, кто подался к декабрьскому или январскому дедлайну курса", funding: "обучение полностью + около £20 780 в год на жизнь", source_url: "https://www.ox.ac.uk/clarendon" },
    { id: "gates_cam", name: "Gates Cambridge", country: "Великобритания", cc: "gb", levels: ["master", "phd"], baseAdm: .06, baseSch: .06, req: { academics: 9.2, language: 8.5, budget: 0 }, deadline: "8 декабря / 6 января", note: "6 184 заявки на 75 мест — примерно 1 %; MBA, MFin и клиническую медицину не финансируют", funding: "обучение + £22 050 в год + два перелёта + виза и медсбор", source_url: "https://www.gatescambridge.org/apply/eligibility/" },
    { id: "goi_ies", name: "Government of Ireland IES", country: "Ирландия", cc: "ie", levels: ["master", "phd"], baseAdm: .12, baseSch: .12, req: { academics: 8, language: 7, budget: 3 }, deadline: "12 марта", note: "оффер ирландского вуза нужен ДО подачи; финансируется только один год — на PhD остальное ищешь сам", funding: "€10 000 на год + вуз снимает плату за обучение", source_url: "https://hea.ie/policy/internationalisation/goi-ies/" },
    { id: "eth_esop", name: "ETH Zurich Excellence (ESOP)", country: "Швейцария", cc: "ch", levels: ["master"], baseAdm: .12, baseSch: .12, req: { academics: 9, language: 8.5, budget: 0 }, deadline: "1–30 ноября", note: "нужен топ-10 % выпуска бакалавриата и собственный план магистерской работы; со второй магистратурой не берут", funding: "CHF 12 000 за семестр + полное освобождение от платы", source_url: "https://ethz.ch/students/en/studies/financial/scholarships/excellencescholarship.html" },
    { id: "swiss_gov", name: "Swiss Government Excellence", country: "Швейцария", cc: "ch", levels: ["phd"], baseAdm: .12, baseSch: .12, req: { academics: 8.5, language: 7, budget: 6 }, deadline: "27 ноября", note: "казахстанцам доступны только PhD и исследовательская стажировка; плату за обучение стипендия НЕ покрывает", funding: "CHF 2 450 в месяц + страховка + обратный перелёт", source_url: "https://www.sbfi.admin.ch/en/swiss-government-excellence-scholarships" },
    { id: "eiffel", name: "Eiffel Excellence", country: "Франция", cc: "fr", levels: ["master", "phd"], baseAdm: .15, baseSch: .15, req: { academics: 8.5, language: 6.5, budget: 3 }, deadline: "8 января", fields: ["sci", "eng", "med", "bus", "hum", "law"], note: "подаёт французский вуз, сам студент не может; возраст до 29 (магистратура) и до 35 (PhD); плату за учёбу не покрывает", funding: "€1 200/мес магистратура или €2 000/мес PhD + перелёт и страховка", source_url: "https://www.campusfrance.org/en/the-france-excellence-eiffel-scholarship-program" },
    { id: "abai_verne", name: "Abai–Verne (посольство Франции)", country: "Франция", cc: "fr", levels: ["master", "phd"], baseAdm: .28, baseSch: .28, req: { academics: 7, language: 6, budget: 4 }, deadline: "17 мая", note: "программа сделана специально для казахстанцев; французский B1 или английский B2; перелёт свой", funding: "€900/мес магистратура или €1 850/мес PhD + виза и страховка", source_url: "https://kz.diplomatie.gouv.fr/fr/la-campagne-de-bourses-abai-verne-2026-2027-est-ouverte" },
    { id: "kuleuven_sci", name: "Science@Leuven (KU Leuven)", country: "Бельгия", cc: "be", levels: ["master"], baseAdm: .1, baseSch: .1, req: { academics: 8.5, language: 8, budget: 4 }, deadline: "15 февраля", fields: ["sci", "it"], note: "только магистратуры факультета наук; на интервью зовут около 8 человек в год; со второй магистратурой не берут", funding: "€12 000 в год до двух лет + плата за учёбу снижена до €3 253", source_url: "https://www.kuleuven.be/scholarships/year/2026-2027/science-leuven-scholarship" },
    { id: "tudelft_vef", name: "TU Delft van Effen Excellence", country: "Нидерланды", cc: "nl", levels: ["master"], baseAdm: .08, baseSch: .08, req: { academics: 8.8, language: 8.5, budget: 0 }, deadline: "1 декабря", fields: ["eng", "sci", "it"], note: "две стипендии на факультет; один недосланный документ — и заявку снимают; подавать всё одним пакетом", funding: "полная плата за обучение + вклад в расходы на жизнь", source_url: "https://www.tudelft.nl/en/education/study-programme-orientation/practical-matters/scholarships/justus-louise-van-effen-excellence-scholarships" },
    { id: "nl_scholarship", name: "NL Scholarship (Нидерланды)", country: "Нидерланды", cc: "nl", levels: ["bachelor", "master"], baseAdm: .3, baseSch: .26, req: { academics: 7, language: 7, budget: 7 }, deadline: "31 января", note: "это разовые €5 000 в первый год, не полное покрытие; список вузов-участников меняется каждый год", funding: "€5 000 единоразово в первый год обучения", source_url: "https://www.studyinnl.org/finances/nl-scholarship" },
    { id: "dk_gov", name: "Danish Government Scholarships", country: "Дания", cc: "dk", levels: ["master"], baseAdm: .14, baseSch: .14, req: { academics: 8, language: 7, budget: 5 }, deadline: "15 января", note: "отдельной заявки нет — рассматривают автоматически при поступлении; обычно 2–3 стипендии на факультет в год", funding: "освобождение от платы за обучение и/или грант на жизнь", source_url: "https://studyindenmark.dk/study-options/scholarships" },
    { id: "fi_uni", name: "Стипендии вузов Финляндии", country: "Финляндия", cc: "fi", levels: ["bachelor", "master"], baseAdm: .25, baseSch: null, req: { academics: 7.5, language: 7, budget: 7 }, deadline: "5 января", note: "Aalto прямо пишет, что денег на жизнь не даёт: это только освобождение от платы, всё остальное своё", funding: "освобождение от платы за обучение (Aalto 100 %, Helsinki 50–100 %)", source_url: "https://www.aalto.fi/en/international-students/scholarships-study-right-started-on-or-after-1-august-2025" },
    { id: "ee_national", name: "Эстонская национальная стипендия", country: "Эстония", cc: "ee", levels: ["master", "phd"], baseAdm: .1, baseSch: .1, req: { academics: 7, language: 6, budget: 6 }, deadline: "сентябрь – октябрь", note: "стипендию получают около 10 % подавших; плату за обучение она не покрывает", funding: "€350/мес магистратура или €660/мес докторантура, до 12 месяцев", source_url: "https://harno.ee/en/scholarships-and-grants/scholarships-studying-and-working-estonia/scholarships-international" },
    { id: "lv_state", name: "Государственные стипендии Латвии", country: "Латвия", cc: "lv", levels: ["bachelor", "master", "phd"], baseAdm: .24, baseSch: .24, req: { academics: 6.5, language: 6, budget: 6 }, deadline: "1 февраля – 1 апреля", note: "Казахстан в списке стран соглашения; 104 стипендии на 427 заявок; плату за обучение платишь сам", funding: "€500/мес бакалавр и магистр, €700/мес докторант", source_url: "https://www.viaa.gov.lv/en/latvian-state-scholarships" },
    { id: "lt_state", name: "Государственные стипендии Литвы", country: "Литва", cc: "lt", levels: ["master"], baseAdm: .16, baseSch: .16, req: { academics: 7, language: 6, budget: 3 }, deadline: "20 апреля", note: "56 из 70 стипендий уходят выпускникам литовских бакалавриатов — подающему из Казахстана заметно сложнее", funding: "€592/мес + оплата обучения по государственному нормативу", source_url: "https://studyin.lt/scholarships/full-time-master-degree-studies/" },
    { id: "ro_gov", name: "Стипендии правительства Румынии", country: "Румыния", cc: "ro", levels: ["bachelor", "master", "phd"], langYear: true, baseAdm: .3, baseSch: .3, req: { academics: 6, language: 3, budget: 4 }, deadline: "31 марта", fields: ["it", "eng", "sci", "bus", "hum", "law", "art"], note: "учёба на румынском: без B1 сначала год языка. Медицину и фармацию по этой программе не дают. Стипендия €65–85 — на жизнь не хватит", funding: "обучение и общежитие бесплатно + €65–85 в месяц", source_url: "https://scholarships.studyinromania.gov.ro/" },
    { id: "ceu", name: "Central European University (Вена)", country: "Австрия", cc: "at", levels: ["master", "phd"], baseAdm: .25, baseSch: .22, req: { academics: 7.5, language: 7.5, budget: 5 }, deadline: "15 октября / 2 февраля", fields: ["bus", "hum", "law", "sci", "it"], note: "полное финансирование бывает только на PhD; на магистратуре чаще частичная скидка, разницу и жизнь в Вене закрываешь сам", funding: "магистратура 50–80 % платы + €300–750/мес; PhD — полная плата и €2 002/мес", source_url: "https://www.ceu.edu/financialaid" },
    { id: "ada_az", name: "ADA University (Азербайджан)", country: "Азербайджан", cc: "az", levels: ["bachelor", "master"], baseAdm: .5, baseSch: .35, req: { academics: 6, language: 6, budget: 5 }, deadline: "8 апреля", fields: ["bus", "hum", "it", "eng", "law"], note: "чтобы попасть на стипендию, подавать надо в ранний раунд; размер Topchubashov Fellowship нигде не публикуется", funding: "стипендия Topchubashov или скидка 20 %; на магистратуре бывает 100 % платы", source_url: "https://www.ada.edu.az/en/admission/financial-aid" },
    { id: "ge_uni", name: "Скидки вузов Грузии (TSU, Ilia)", country: "Грузия", cc: "ge", levels: ["bachelor", "master"], baseAdm: .55, baseSch: .3, req: { academics: 5, language: 4.5, budget: 6 }, deadline: "уточняй в вузе", note: "государственные гранты Грузии привязаны к местным экзаменам и иностранцам недоступны; реально это скидка вуза до 50 %", funding: "скидка на обучение до 50 % (Ilia); TSU — около 1 125 лари за семестр", source_url: "https://admissions.iliauni.edu.ge/en/tuition-fees-and-scholarship-opportunities/" },
    { id: "hk_ug", name: "Стипендии вузов Гонконга", country: "Гонконг", cc: "hk", levels: ["bachelor"], baseAdm: .12, baseSch: .2, req: { academics: 8.5, language: 6, budget: 4 }, deadline: "26 ноября", note: "CUHK прямо называет Казахстан в Belt and Road Scholarship; у HKUST отдельная заявка на Future Leaders Award", funding: "от разовой выплаты до полной платы с общежитием и стипендией — зависит от награды", source_url: "https://admission.cuhk.edu.hk/fees-financing-your-studies/scholarships/admission-scholarships-for-undergraduates-only/" },
    { id: "macau_ug", name: "Стипендия Университета Макао", country: "Макао", cc: "mo", levels: ["bachelor", "master"], baseAdm: .25, baseSch: .3, req: { academics: 7.5, language: 6, budget: 4 }, deadline: "3 февраля – 9 апреля", note: "полная награда только для КНР, Гонконга и Тайваня; казахстанцу доступна International Student Scholarship, денег на жизнь в ней нет", funding: "100 % или 50 % платы за обучение и проживания в кампусе", source_url: "https://gao.um.edu.mo/international-admission/scholarship-assistantship-academic-prizes/admission-scholarship/" },
    { id: "kaist_ug", name: "KAIST для иностранцев (Корея)", country: "Корея", cc: "kr", levels: ["bachelor"], baseAdm: .12, baseSch: .6, req: { academics: 8.5, language: 6.5, budget: 4 }, deadline: "22 октября / 14 января", fields: ["it", "eng", "sci"], note: "отдельной заявки нет — отметить стипендию в анкете; по расчётам самого KAIST доплачивать придётся около 280 000 вон в месяц", funding: "обучение 8 семестров бесплатно + 350 000 вон в месяц + медстраховка", source_url: "https://admission.kaist.ac.kr/intl-undergraduate/support/scholarships/kaist" },
    { id: "kr_unis", name: "SNU, POSTECH, Yonsei (Корея)", country: "Корея", cc: "kr", levels: ["bachelor", "master"], baseAdm: .2, baseSch: .7, req: { academics: 8, language: 6.5, budget: 6 }, deadline: "осенний и весенний набор", note: "покрывают почти всегда только обучение — жильё и жизнь свои; в SNU стипендия не даётся в первом семестре", funding: "100 % платы за обучение (POSTECH, Yonsei UIC); SNU — со второго семестра", source_url: "https://www.postech.ac.kr/eng/admission-aid/scholarship_information.do" },
    { id: "cn_provincial", name: "Стипендии провинций и городов КНР", country: "Китай", cc: "cn", levels: ["bachelor", "master", "phd"], langYear: true, baseAdm: .4, baseSch: .35, req: { academics: 6.5, language: 4, budget: 3 }, deadline: "февраль – апрель", note: "единого портала нет, подавать надо в конкретный вуз; для программ на китайском нужен HSK 4; возраст 25 / 35 / 40 лет", funding: "категория A — обучение, общежитие, стипендия и страховка; B и C — только обучение", source_url: "https://edu.sh.gov.cn/study_en_scholarships/" },
    { id: "cis_cn", name: "Стипендия по китайскому языку (CIS)", country: "Китай", cc: "cn", levels: ["bachelor", "master", "phd"], langYear: true, baseAdm: .45, baseSch: .45, req: { academics: 6, language: 3, budget: 2 }, deadline: "15 апреля / 15 мая", fields: ["hum"], note: "нужен готовый HSK нужного уровня и рекомендация Института Конфуция или посольства КНР; направление — китайский язык и преподавание", funding: "обучение, общежитие, страховка + 2 500–3 500 юаней в месяц", source_url: "https://www.chinese.cn/" },
    { id: "schwarzman", name: "Schwarzman Scholars (Цинхуа)", country: "Китай", cc: "cn", levels: ["master"], baseAdm: .08, baseSch: .08, req: { academics: 8.5, language: 8.5, budget: 0 }, deadline: "9 сентября", note: "возраст строго до 29 лет на 1 августа; один жёсткий дедлайн в году, второй попытки в этом сезоне не будет", funding: "обучение, жильё и питание, перелёт, ноутбук и телефон, страховка и стипендия", source_url: "https://www.schwarzmanscholars.org/admissions/application-instructions/" },
    { id: "yenching", name: "Yenching Academy (Пекин)", country: "Китай", cc: "cn", levels: ["master"], baseAdm: .1, baseSch: .1, req: { academics: 8.5, language: 8.5, budget: 0 }, deadline: "30 ноября", fields: ["hum", "law", "bus"], note: "китайский при подаче не нужен; Европа и Северная Америка занимают больше половины мест, остальной мир делит 30–35 %", funding: "обучение, проживание, стипендия, перелёт и расходы на полевое исследование", source_url: "https://yenchingacademy.pku.edu.cn/ADMISSIONS.htm" },
    { id: "malaysia_mis", name: "Malaysia International Scholarship", country: "Малайзия", cc: "my", levels: ["master", "phd"], baseAdm: .25, baseSch: .25, req: { academics: 7, language: 6, budget: 5 }, deadline: "уточняй окно на сайте", note: "Казахстан прямо есть в списке стран; бакалавриата нет; перелёт и жильё не оплачиваются; возраст до 40 и 45 лет", funding: "плата за обучение на весь срок + 1 500 ринггитов в месяц", source_url: "https://biasiswa.mohe.gov.my/INTER/index.php" },
    { id: "ait_th", name: "AIT и SIIT (Таиланд)", country: "Таиланд", cc: "th", levels: ["master", "phd"], baseAdm: .5, baseSch: .35, req: { academics: 6.5, language: 4.5, budget: 6 }, deadline: "15 июля", fields: ["eng", "it", "sci", "bus"], note: "стипендия AIT почти всегда частичная: регистрационный сбор и жизнь остаются на тебе", funding: "обучение полностью или частично; у SIIT бывает стипендия, перелёт и страховка", source_url: "https://ait.ac.th/scholarship/ait-scholarships/" },
    { id: "iccr_in", name: "Стипендия ICCR (Индия)", country: "Индия", cc: "in", levels: ["bachelor", "master", "phd"], baseAdm: .4, baseSch: .4, req: { academics: 6, language: 5, budget: 3 }, deadline: "27 февраля – 22 апреля", note: "набор ведёт посольство Индии в Астане; перелёт не оплачивается, на обустройство нужно около 1 500 долларов своих", funding: "обучение + 18–22 тыс. рупий в месяц + доплата на жильё", source_url: "https://www.indembastana.gov.in/page/iccr/" },
    { id: "brunei_gov", name: "Стипендия правительства Брунея", country: "Бруней", cc: "bn", levels: ["bachelor", "master"], baseAdm: .25, baseSch: .25, req: { academics: 7, language: 5, budget: 0 }, deadline: "15 декабря – 15 февраля", note: "возраст строго до 25 лет на бакалавриате и до 35 на магистратуре; кто уже учился в Брунее — не допускается", funding: "обучение + 500 брунейских долларов в месяц + питание, книги, перелёт и общежитие", source_url: "https://www.mfa.gov.bn/pages/online-bdgs.aspx" },
    { id: "berea", name: "Berea College (США)", country: "США", cc: "us", levels: ["bachelor"], baseAdm: .08, baseSch: .9, req: { academics: 8, language: 6, budget: 4 }, deadline: "30 ноября", note: "иностранцев берут не больше 40 в год при сотнях заявок; для визы нужен депозит около 2 200 долларов", funding: "обучение, жильё, питание и сборы — 100 %, без кредитов", source_url: "https://www.berea.edu/tuition-free-since-1892" },
    { id: "pearson_utoronto", name: "Lester B. Pearson (Торонто)", country: "Канада", cc: "ca", levels: ["bachelor"], baseAdm: .05, baseSch: .05, req: { academics: 9, language: 7, budget: 0 }, deadline: "6 ноября", note: "самовыдвижение невозможно — нужна номинация школы; около 37 стипендий в год на весь мир", funding: "обучение, книги, сборы и проживание в кампусе на 4 года", source_url: "https://future.utoronto.ca/pearson-scholarships" },
    { id: "ubc_isp", name: "UBC International Scholars (Канада)", country: "Канада", cc: "ca", levels: ["bachelor"], langYear: true, baseAdm: .07, baseSch: .07, req: { academics: 9, language: 6.5, budget: 0 }, deadline: "15 ноября", note: "нужна номинация школы и документы о доходе семьи; подача на эту программу закрывает доступ к merit-стипендиям UBC", funding: "награда по нужде — вплоть до полной стоимости обучения и проживания", source_url: "https://you.ubc.ca/financial-planning/scholarships-awards-international-students/international-scholars/" },
    { id: "fulbright_kz", name: "Fulbright (США, для Казахстана)", country: "США", cc: "us", levels: ["master"], baseAdm: .04, baseSch: .04, req: { academics: 8, language: 7.5, budget: 0 }, deadline: "15 июля", note: "нужны 2+ года работы после диплома; обязательны TOEFL и GRE или GMAT; из Казахстана подают 150–300 человек на единицы мест", funding: "обучение и сборы, стипендия, страховка, книги, авиабилеты и виза", source_url: "https://kz.usembassy.gov/fulbright-foreign-student-program/" },
    { id: "nyuad", name: "NYU Abu Dhabi (помощь по доходу)", country: "ОАЭ", cc: "ae", levels: ["bachelor"], baseAdm: .05, baseSch: .6, req: { academics: 9, language: 7.5, budget: 0 }, deadline: "1 ноября / 5 января", note: "merit-стипендий нет, только помощь по доходу семьи; нужен CSS Profile обоих родителей", funding: "грант по финансовой нужде, размер считают по CSS Profile", source_url: "https://nyuad.nyu.edu/en/admissions/undergraduate/financial-support.html" },
    { id: "khalifa", name: "Khalifa University (ОАЭ)", country: "ОАЭ", cc: "ae", levels: ["bachelor", "master", "phd"], baseAdm: .3, baseSch: .45, req: { academics: 7.5, language: 6, budget: 5 }, deadline: "2 марта", fields: ["it", "eng", "sci", "med"], note: "бакалаврам-иностранцам дают только обучение — жильё и стипендия положены гражданам ОАЭ; на входе тест KUAT и видеоинтервью", funding: "бакалавриат — до 100 % обучения; магистратура и PhD — обучение, жильё, стипендия и перелёт", source_url: "https://www.ku.ac.ae/scholarships-undergraduate" },
    { id: "qatar_uni", name: "Qatar University для иностранцев", country: "Катар", cc: "qa", levels: ["bachelor"], langYear: true, baseAdm: .2, baseSch: .2, req: { academics: 9, language: 4.5, budget: 2 }, deadline: "1–25 марта", note: "порог по аттестату жёсткий — 95 %; Foundation нужно закрыть за два семестра, иначе придётся уехать", funding: "обучение, учебники, общежитие с транспортом, 500 риалов в месяц и билет домой раз в год", source_url: "https://www.qu.edu.qa/en-us/students/admission/scholarships/Pages/types.aspx" },
    { id: "au_merit", name: "Merit-стипендии вузов Австралии", country: "Австралия", cc: "au", levels: ["bachelor", "master"], baseAdm: .35, baseSch: .3, req: { academics: 8, language: 7, budget: 10 }, deadline: "вместе с заявкой в вуз", note: "это 20 % платы, а не полная стипендия: остальное и жизнь — свои деньги. Награда UNSW казахстанцам недоступна", funding: "скидка 20 % на обучение (Melbourne, Sydney) или 15 000 австралийских долларов в год (Monash)", source_url: "https://scholarships.unimelb.edu.au/awards/melbourne-international-excellence-scholarship-undergraduate" },
    { id: "auckland_nz", name: "Auckland Excellence (Новая Зеландия)", country: "Новая Зеландия", cc: "nz", levels: ["master"], baseAdm: .3, baseSch: .28, req: { academics: 8, language: 7, budget: 10 }, deadline: "заявка не нужна", note: "только 25 % платы за первый год магистратуры; недоступна тем, кто уже учился в Новой Зеландии", funding: "25 % платы за обучение за первые два семестра магистратуры", source_url: "https://www.auckland.ac.nz/en/study/scholarships-and-awards/find-a-scholarship/university-of-auckland-international-student-excellence-scholarship-844-all.html" },
    { id: "adb_jsp", name: "ADB–Japan Scholarship", country: "Япония", cc: "jp", levels: ["master"], baseAdm: .1, baseSch: .1, req: { academics: 7.5, language: 7, budget: 0 }, deadline: "за 6 месяцев до набора", fields: ["bus", "hum", "sci", "eng", "law"], note: "Казахстан входит в список стран; нужны 2+ года работы, возраст до 35 и возвращение домой на 2 года", funding: "обучение полностью, пособие с жильём, книги, страховка и перелёты", source_url: "https://www.adb.org/work-with-us/careers/japan-scholarship-program" },
    { id: "isdb_msp", name: "Merit-стипендия Исламского банка", country: "Саудовская Аравия", cc: "sa", levels: ["phd"], baseAdm: .08, baseSch: .08, req: { academics: 8, language: 6, budget: 0 }, deadline: "уточняй окно на сайте", fields: ["it", "eng", "sci", "med"], note: "подать самому нельзя — нужна номинация научного института Казахстана; возраст до 35 и опыт исследований", funding: "обучение, стипендия, страховка, билет и обустройство, поездки на конференции", source_url: "https://www.isdb.org/scholarships/scholarship-programs" }
  ];

  var WINDOWS = {"sh": {"md": "01-15", "open": "11-15"}, "edisu": {"md": "09-04", "open": "07-20"}, "disco": {"md": "07-22", "open": "06-10"}, "maeci": {"md": "03-26", "open": "03-01"}, "tb": {"md": "02-20", "open": "01-10"}, "de_pub": {"md": "07-15", "open": "05-01"}, "daad": {"md": "10-15", "open": "08-01"}, "cz_free": {"md": "02-28", "open": "11-01"}, "csc": {"md": "02-15", "open": "01-01"}, "anso": {"md": "01-31", "open": "10-15"}, "gks": {"md": "10-17", "open": "09-01"}, "mext": {"md": "05-29", "open": "04-20"}, "erasmus": {"md": "01-15", "open": "10-15"}, "si": {"md": "02-15", "open": "02-01"}, "us_need": {"md": "01-01", "open": "08-01"}, "kaust": {"md": "01-03", "open": "09-01"}, "mbzuai": {"md": "12-15", "open": "09-01"}, "nawa": {"md": "05-08", "open": "03-15"}, "hkphd": {"md": "12-01", "open": "09-01"}, "singa": {"md": "12-01", "open": "10-01"}, "chevening": {"md": "10-06", "open": "08-05"}, "clarendon": {"md": "01-06", "open": "09-01"}, "gates_cam": {"md": "01-06", "open": "09-01"}, "goi_ies": {"md": "03-12", "open": "01-15"}, "eth_esop": {"md": "11-30", "open": "11-01"}, "swiss_gov": {"md": "11-27", "open": "08-01"}, "eiffel": {"md": "01-08", "open": "10-01"}, "abai_verne": {"md": "05-17", "open": "03-15"}, "kuleuven_sci": {"md": "02-15", "open": "10-01"}, "tudelft_vef": {"md": "12-01", "open": "10-15"}, "nl_scholarship": {"md": "01-31", "open": "10-01"}, "dk_gov": {"md": "01-15", "open": "11-01"}, "fi_uni": {"md": "01-05", "open": "12-01"}, "ee_national": {"md": "10-15", "open": "09-01"}, "lv_state": {"md": "04-01", "open": "02-01"}, "lt_state": {"md": "04-20", "open": "03-01"}, "ro_gov": {"md": "03-31", "open": "01-15"}, "ceu": {"md": "02-02", "open": "10-15"}, "ada_az": {"md": "04-08", "open": "02-01"}, "hk_ug": {"md": "11-26", "open": "09-15"}, "macau_ug": {"md": "04-09", "open": "02-03"}, "kaist_ug": {"md": "01-14", "open": "09-01"}, "cn_provincial": {"md": "04-30", "open": "02-01"}, "cis_cn": {"md": "05-15", "open": "03-01"}, "schwarzman": {"md": "09-09", "open": "04-01"}, "yenching": {"md": "11-30", "open": "08-15"}, "ait_th": {"md": "07-15", "open": "03-01"}, "iccr_in": {"md": "04-22", "open": "02-27"}, "brunei_gov": {"md": "02-15", "open": "12-15"}, "berea": {"md": "11-30", "open": "09-01"}, "pearson_utoronto": {"md": "11-06", "open": "09-01"}, "ubc_isp": {"md": "11-15", "open": "09-01"}, "fulbright_kz": {"md": "07-15", "open": "03-01"}, "nyuad": {"md": "01-05", "open": "09-01"}, "khalifa": {"md": "03-02", "open": "12-01"}, "qatar_uni": {"md": "03-25", "open": "03-01"}};
  PROGRAMS.forEach(function (p) {
    var w = WINDOWS[p.id];
    if (w) { p.deadlineMd = p.deadlineMd || w.md; p.openMd = p.openMd || w.open; }
  });
  if (typeof PROGRAMS !== "undefined") PROGRAMS.forEach(function (p) { p.exam = p.exam || (p.id === "csc" ? "csca" : null); });

  /* ---------- 3. ВЕРОЯТНОСТИ ---------- */
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // Взвешенное отклонение профиля от требований → множитель к базовой ставке.
  function fitDelta(profile, prog) {
    var ax = profile.axes;
    var d = 0.45 * (ax.academics - prog.req.academics)
          + 0.4 * (ax.language - prog.req.language)
          + 0.12 * (ax.achievements - 5)
          + 0.08 * (ax.motivation - 5);
    if (prog.req.sat != null) d += 0.25 * (profile.sat - prog.req.sat);
    return d; // ~ -5..+5
  }

  function probabilities(profile, prog) {
    var d = fitDelta(profile, prog);
    var adm = clamp(prog.baseAdm * (1 + 0.16 * d), 0.03, 0.92);
    var sch = prog.baseSch == null ? null : clamp(prog.baseSch * (1 + 0.16 * d), 0.02, 0.9);

    /* Жёсткая отсечка по языку.
       Раньше модель была чисто множительной: не хватает трёх баллов языка —
       вероятность падала всего на четверть, и абитуриент без единого сертификата
       видел «40 % на итальянский грант». Это не «шанс поменьше», это закрытая
       дверь: без сертификата заявку просто не примут. Программам, которые сами
       дают год языка (Турция, Корея, Япония, Китай, чешские госвузы), поблажка
       в 2,5 балла — там язык действительно учат уже внутри программы. */
    var gap = (prog.req.language || 0) - profile.axes.language - (prog.langYear ? 2.5 : 0);
    if (gap >= 2) {
      var k = Math.pow(0.5, gap - 1);           // не хватает 2 → ×0,5; 3 → ×0,25; 4 → ×0,125
      adm = clamp(adm * k, 0.02, 0.92);
      if (sch != null) sch = clamp(sch * k, 0.01, 0.9);
    }
    return { adm: adm, sch: sch };
  }

  /* ---------- 4. ПОРТФЕЛЬ ---------- */
  function buildPortfolio(profile, a) {
    var list = PROGRAMS
      // программы, куда казахстанец подать не может, в портфель не попадают вообще
      .filter(function (p) { return p.availableKz !== false; })
      .filter(function (p) { return p.levels.indexOf(profile.level) !== -1; })
      .filter(function (p) { return profile.axes.budget >= (p.req.budget || 0); })
      .filter(function (p) { return !p.fields || (a.field || []).some(function (f) { return p.fields.indexOf(f) !== -1; }); })
      .map(function (p) {
        var pr = probabilities(profile, p);
        var score = pr.adm + (pr.sch == null ? 0.25 : pr.sch); // бесплатное обучение без стипендии тоже ценно
        // предпочтение выбранных стран — буст позиции, не вероятности (честность!)
        if ((a.target_countries || []).indexOf(p.cc) !== -1) score += 0.35;
        return Object.assign({ p: pr, score: score }, p);
      })
      .sort(function (x, y) { return y.score - x.score; });

    /* Портфель собираем СМЕСЬЮ, а не просто «топ-9 по баллу».
       Раньше сортировка по баллу оставляла только надёжные варианты: сильный
       школьник с международной олимпиадой и IELTS 7+ не видел ни Оксфорда,
       ни Торонто — они «слишком рискованные» по числу. Но именно ради них
       такой человек и приходит. Поэтому берём три корзины:
       якорные (шанс высокий), рабочие (средний) и амбициозные (низкий, но
       высокая ценность). Так портфель похож на нормальный совет, а не на
       список самого лёгкого. */
    function pick(arr, from, to, n) {
      var out = [], perCc = {};
      for (var i = 0; i < arr.length && out.length < n; i++) {
        var p = arr[i];
        if (p.p.adm < from || p.p.adm >= to) continue;
        var k = p.cc || p.country;
        if ((perCc[k] || 0) >= 2) continue;   // портфель — это диверсификация, а не три гранта одной страны
        perCc[k] = (perCc[k] || 0) + 1;
        out.push(p);
      }
      return out;
    }
    var anchors    = pick(list, 0.45, 1.01, 4);
    var targets    = pick(list, 0.20, 0.45, 3);
    var ambitious  = pick(list, 0.00, 0.20, 2);
    var portfolio  = anchors.concat(targets, ambitious);
    // если какой-то корзины не хватило — добираем лучшими из оставшихся
    if (portfolio.length < 9) {
      var taken = {};
      portfolio.forEach(function (p) { taken[p.id] = true; });
      for (var i = 0; i < list.length && portfolio.length < 9; i++) {
        if (!taken[list[i].id]) { portfolio.push(list[i]); taken[list[i].id] = true; }
      }
    }
    portfolio.forEach(function (p) {
      p.tier = p.p.adm >= 0.45 ? "anchor" : (p.p.adm >= 0.20 ? "target" : "ambitious");
    });
    portfolio.sort(function (x, y) {
      var rank = { anchor: 0, target: 1, ambitious: 2 };
      return rank[x.tier] - rank[y.tier] || y.score - x.score;
    });
    return portfolio;
  }

  // P(хотя бы один оффер). Исходы сильно коррелируют (слабый язык валит
  // сразу все похожие программы), поэтому НЕ считаем заявки независимыми:
  // смешиваем лучший одиночный шанс с «независимой» оценкой по топ-6.
  function pAtLeastOne(portfolio) {
    if (!portfolio.length) return 0.05;
    /* Внутри одной страны исходы почти полностью коррелированы: три
       итальянских DSU решаются одним и тем же доходом семьи и одним
       пакетом, поэтому страна даёт один «бросок», а не три. Берём лучший
       шанс на страну и только потом считаем квази-независимость стран. */
    var byCc = {};
    portfolio.forEach(function (p) {
      var k = p.cc || p.country || p.id;
      if (!byCc[k] || p.p.adm > byCc[k]) byCc[k] = p.p.adm;
    });
    var ps = Object.keys(byCc).map(function (k) { return byCc[k]; }).sort(function (a, b) { return b - a; });
    var maxP = ps[0];
    var pNone = 1;
    ps.slice(0, 6).forEach(function (p) { pNone *= (1 - Math.min(p, 0.85)); });
    var indep = 1 - pNone;
    var CORR_BLEND = 0.35; // 0 = полностью коррелированы, 1 = независимы; калибруем исходами
    return clamp(maxP + (indep - maxP) * CORR_BLEND, 0.05, 0.95);
  }

  /* ---------- 5. ВЕРДИКТ И БУСТЕРЫ ---------- */
  function verdictFor(pAny, profile) {
    if (pAny >= 0.6) return { t: "Поступление со стипендией — реалистичная цель", s: "Полный отчёт покажет, какие программы дают лучший шанс и что усилить." };
    if (pAny >= 0.35) return { t: "Реалистично — при одном условии", s: "Есть слабое место, которое можно закрыть. В отчёте видно, что именно это меняет." };
    return { t: "Прямо сейчас шансы низкие — но есть план", s: "В отчёте — программы, куда путь открыт, и шаги с наибольшим приростом." };
  }

  function boosters(profile, a) {
    var out = [];
    var base = pAtLeastOne(buildPortfolio(profile, a));
    // язык +1.5 балла оси
    var p2 = JSON.parse(JSON.stringify(profile)); p2.axes.language = clamp(p2.axes.language + 1.5, 0, 10);
    out.push({ what: "Поднять язык на ступень (напр. IELTS +0.5)", pp: Math.round((pAtLeastOne(buildPortfolio(p2, a)) - base) * 100) });
    // мотивационное 5→8
    var p3 = JSON.parse(JSON.stringify(profile)); p3.axes.motivation = 8;
    out.push({ what: "Мотивационное письмо под каждую программу", pp: Math.round((pAtLeastOne(buildPortfolio(p3, a)) - base) * 100) });
    // достижения +2
    var p4 = JSON.parse(JSON.stringify(profile)); p4.axes.achievements = clamp(p4.axes.achievements + 2, 0, 10);
    out.push({ what: "Добавить проект/олимпиаду в профиль", pp: Math.round((pAtLeastOne(buildPortfolio(p4, a)) - base) * 100) });
    out = out.filter(function (b) { return b.pp > 0; }).sort(function (x, y) { return y.pp - x.pp; });
    // ценность широкой подачи: портфель против одной лучшей заявки
    var port = buildPortfolio(profile, a);
    if (port.length > 1) {
      var maxP = Math.max.apply(null, port.map(function (p) { return p.p.adm; }));
      var widePP = Math.round((base - maxP) * 100);
      if (widePP > 0) out.push({ what: "Подать во все " + port.length + " программ, а не в одну", pp: widePP });
    }
    return out.slice(0, 3);
  }

  /* ---------- 6. v3: ОКНА ЦИКЛА И РЕАЛИЗУЕМОСТЬ ---------- */
  // 'MM-DD' → ближайшая будущая дата этого дня (типовое окно цикла; год к году дрейфует на дни)
  function nextWindowDate(md, now) {
    if (!md || !/^\d\d-\d\d$/.test(md)) return null;
    var m = +md.slice(0, 2), d = +md.slice(3, 5);
    var y = now.getFullYear();
    var dt = new Date(Date.UTC(y, m - 1, d, 23, 59));
    if (dt.getTime() < now.getTime()) dt = new Date(Date.UTC(y + 1, m - 1, d, 23, 59));
    return dt;
  }
  function weeksUntil(dt, now) { return dt ? Math.max(0, Math.round((dt.getTime() - now.getTime()) / 6048e5)) : null; }
  var MONTHS_RU = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  function fmtRu(dt) { return dt ? dt.getUTCDate() + " " + MONTHS_RU[dt.getUTCMonth()] + " " + dt.getUTCFullYear() : null; }
  // сессии CSCA (csca.cn): янв, мар, апр, июн, дек
  var CSCA_MONTHS = [1, 3, 4, 6, 12];

  var DEFAULT_HORIZON_WEEKS = 16;   // для программ без известного окна

  /* Окно и реализуемость цикла для программы.
     needsCertNow: сертификат нужен уже при подаче, а его нет и получить
     не успеть — тогда честно говорим «в этот цикл не успеть». */
  function windowFor(prog, a, profile, now) {
    var dt = nextWindowDate(prog.deadlineMd, now);
    var weeks = weeksUntil(dt, now);
    var w = { known: !!dt, date: dt ? dt.toISOString().slice(0, 10) : null,
              human: fmtRu(dt), weeksLeft: weeks, feasible: true, note: null, nextCycle: false };
    if (!dt) return w;
    /* Окно закрывается на днях: собрать пакет за пару недель нереально почти
       всем, поэтому честно целимся в СЛЕДУЮЩЕЕ окно этой программы (+1 год) —
       программа остаётся в портфеле, а не выбрасывается. */
    if (weeks < 4) {
      var dt2 = new Date(Date.UTC(dt.getUTCFullYear() + 1, dt.getUTCMonth(), dt.getUTCDate(), 23, 59));
      w.nextCycle = true;
      w.note = "ближайшее окно закрывается " + fmtRu(dt) + " — реалистичная цель: следующее, до " + fmtRu(dt2);
      w.date = dt2.toISOString().slice(0, 10);
      w.human = fmtRu(dt2);
      w.weeksLeft = weeksUntil(dt2, now);
      weeks = w.weeksLeft;
    }
    var needsCert = (prog.req.language || 0) >= 4.5 && !prog.langYear && a.lang_status !== "have";
    if (needsCert && weeks < 6 && a.lang_status !== "soon") {
      w.feasible = false; w.note = "нужен сертификат при подаче — в это окно уже не успеть, целься в следующий цикл";
    } else if (needsCert && weeks < 4) {
      w.feasible = false; w.note = "до закрытия окна меньше месяца — сертификат получить не успеть";
    } else if (weeks <= 6 && !w.nextCycle) {
      w.note = "окно закрывается через " + weeks + " нед — документы должны быть почти готовы";
    }
    if (prog.exam === "csca" && w.feasible) {
      // ближайшая сессия CSCA минимум за 3 недели подготовки и до дедлайна
      var ses = null;
      for (var k = 0; k < 18; k++) {
        var cand = new Date(now.getTime()); cand.setUTCDate(15); cand.setUTCMonth(cand.getUTCMonth() + k);
        if (CSCA_MONTHS.indexOf(cand.getUTCMonth() + 1) !== -1 && cand.getTime() > now.getTime() + 3 * 6048e5) { ses = cand; break; }
      }
      if (ses && dt && ses.getTime() > dt.getTime()) { w.note = "сессию экзамена CSCA до дедлайна поймать не успеть — планируй следующий цикл"; w.feasible = false; }
      else if (ses) { w.note = (w.note ? w.note + " · " : "") + "нужен экзамен CSCA (csca.cn), ближайшие сессии: янв/мар/апр/июн/дек"; }
    }
    return w;
  }

  /* ---------- 7. v3: ТОЧКА Б — профиль к дедлайну ---------- */
  /* Ориентир скорости языка: ~100–200 часов направленной подготовки на +1.0
     балла IELTS (Cambridge/IELTS.org), т.е. при 10–12 ч/нед ≈ +0.5 балла за
     8–10 недель. Наша ось языка: 1.0 балла IELTS ≈ 3 балла оси. */
  function projectProfile(profile, a, weeks) {
    var eff = Math.max(0, (weeks == null ? DEFAULT_HORIZON_WEEKS : weeks) - 5); // буфер: слот экзамена + результат + подача
    var p2 = JSON.parse(JSON.stringify(profile));
    var gains = [];
    // язык растёт, только если человек сам заявил, что готовится
    if (a.lang_status === "soon" && eff >= 4) {
      var perWeek = profile.axes.language < 7.5 ? 1.5 / 9 : 1.5 / 13;
      var gain = Math.min(3, eff * perWeek, 9 - profile.axes.language);
      if (gain > 0.2) {
        p2.axes.language = clamp(profile.axes.language + gain, 0, 10);
        gains.push({ what: "Подготовка к IELTS по плану (~10 ч/нед)", axis: "language",
                     detail: "+" + (Math.round(gain / 3 * 10) / 10) + " балла IELTS реалистично за " + Math.min(eff, 18) + " нед" });
      }
    }
    if (eff >= 3 && profile.axes.motivation < 7.5) {
      p2.axes.motivation = 7.5;
      gains.push({ what: "Мотивационные письма под каждую программу", axis: "motivation",
                   detail: "письмо под требования программы, не одно на всех" });
    }
    if (eff >= 12 && profile.axes.achievements < 9) {
      p2.axes.achievements = clamp(profile.axes.achievements + 1, 0, 10);
      gains.push({ what: "Добавить проект или олимпиаду в профиль", axis: "achievements",
                   detail: "один завершённый пункт портфолио за 3 месяца" });
    }
    if (a.sat === "plan" && eff >= 10 && (profile.sat || 0) < 6.5) {
      p2.sat = 6.5;
      gains.push({ what: "Сдать SAT по плану", axis: "sat", detail: "важно для США и части топ-вузов" });
    }
    return { profile: p2, gains: gains };
  }

  /* ---------- 8. v3: УВЕРЕННОСТЬ ---------- */
  /* Ширина интервала = зрелость модели + полнота данных. Экспертная модель
     с приорами из публичной статистики даёт базовые ±10 п.п.; каждый
     неотвеченный ключевой вопрос расширяет интервал. */
  function confidenceFor(a, pAny) {
    var keys = ["level", "lang_status", "field", "achievements", "budget", "priority"];
    keys.push(a.level === "master" ? "gpa_uni" : (a.level === "phd" ? "gpa_phd" : "gpa_band"));
    if (a.lang_status === "have" || a.lang_status === "soon") keys.push("ielts_band");
    var have = 0;
    keys.forEach(function (k) { var v = a[k]; if (v != null && v !== "" && !(Array.isArray(v) && !v.length) && v !== "unknown") have++; });
    var completeness = have / keys.length;
    if (a.p2_gpa_exact) completeness = Math.min(1, completeness + 0.08);
    if (a.p2_ielts_date) completeness = Math.min(1, completeness + 0.04);
    if (a.p2_docs_ready) completeness = Math.min(1, completeness + 0.03);
    var width = 0.10 + 0.10 * (1 - completeness);
    return {
      completeness: Math.round(completeness * 100) / 100,
      low: clamp(Math.round((pAny - width) * 100) / 100, 0.02, 0.97),
      high: clamp(Math.round((pAny + width) * 100) / 100, 0.02, 0.97),
      label: completeness >= 0.8 ? "высокая" : (completeness >= 0.5 ? "средняя" : "низкая")
    };
  }

  /* ---------- 9. ГЛАВНАЯ ФУНКЦИЯ ---------- */
  // evaluate(answers[, opts]) → всё, что нужно и превью, и полному отчёту.
  // Выход — надмножество v1/v2: старые поля не менялись.
  function evaluate(a, opts) {
    a = a || {}; opts = opts || {};
    var now = opts.now ? new Date(opts.now) : new Date();
    var profile = profileFromAnswers(a);
    var portfolio = buildPortfolio(profile, a);
    var pAny = pAtLeastOne(portfolio);

    // точка Б: по каждой программе — своё окно и своя проекция
    var anyDl = [];
    portfolio.forEach(function (p) {
      var w = windowFor(p, a, profile, now);
      p.window = w;
      var proj = projectProfile(profile, a, w.weeksLeft);
      var pd = w.feasible ? probabilities(proj.profile, p) : { adm: p.p.adm, sch: p.p.sch };
      p.p.admAtDeadline = Math.max(p.p.adm, pd.adm);
      p.p.schAtDeadline = pd.sch == null ? null : Math.max(p.p.sch || 0, pd.sch);
      anyDl.push({ p: { adm: p.p.admAtDeadline } });
    });
    var pAnyDl = Math.max(pAny, pAtLeastOne(anyDl));

    // глобальный план — по медианному окну портфеля
    var wks = portfolio.map(function (p) { return p.window && p.window.weeksLeft; })
                       .filter(function (x) { return x != null; }).sort(function (x, y) { return x - y; });
    var horizon = wks.length ? wks[Math.floor(wks.length / 2)] : DEFAULT_HORIZON_WEEKS;
    var plan = projectProfile(profile, a, horizon).gains;

    var confidence = confidenceFor(a, pAny);

    var axes = profile.axes;
    var axisNames = { academics: "Академика", language: "Язык", achievements: "Достижения", motivation: "Мотивационное", budget: "Бюджет", fit: "Соответствие" };
    var sorted = ["academics", "language", "achievements", "motivation"].sort(function (x, y) { return axes[y] - axes[x]; });

    var verdict = verdictFor(pAny, profile);
    if (pAny < 0.35 && pAnyDl >= 0.5) {
      verdict = { t: "К дедлайнам — реалистично, если начать сейчас",
                  s: "Сегодняшние шансы низкие, но к окнам подачи профиль успевает вырасти. В отчёте — план по неделям." };
    }

    return {
      profile: profile,
      portfolio: portfolio,
      pAtLeastOne: pAny,
      pAtLeastOneAtDeadline: Math.round(pAnyDl * 100) / 100,
      confidence: confidence,
      plan: plan,
      programsCount: portfolio.length,
      topCountry: portfolio.length ? portfolio[0].country : "—",
      strongest: axisNames[sorted[0]],
      weakest: axisNames[sorted[sorted.length - 1]],
      verdict: verdict,
      boosters: boosters(profile, a),
      engineVersion: 3,
      catalogSource: CATALOG.source,
      catalogSize: PROGRAMS.length,
      generatedFor: now.toISOString().slice(0, 10)
    };
  }

  /* ---------- 10. v3: КАТАЛОГ ИЗ БАЗЫ ---------- */
  var CATALOG = { source: "builtin" };
  var BUILTIN = PROGRAMS.slice();

  // Строка витрины programs_engine → формат движка. Мусор не пропускаем:
  // сломанная строка каталога не должна ломать расчёт.
  function normalizeRow(r) {
    if (!r || !r.id || !r.name || !r.country || !Array.isArray(r.levels) || !r.levels.length) return null;
    var adm = Number(r.baseAdm != null ? r.baseAdm : r.base_adm);
    if (!(adm > 0 && adm < 1)) return null;
    var bs = r.baseSch != null ? r.baseSch : r.base_sch;
    var sch = (bs == null || bs === "") ? null : Number(bs);
    if (sch != null && !(sch >= 0 && sch <= 1)) sch = null;
    var req = (r.req && typeof r.req === "object") ? r.req : {};
    if (typeof req.academics !== "number" || typeof req.language !== "number") return null;
    return {
      id: String(r.id), name: String(r.name), country: String(r.country), cc: r.cc || "",
      levels: r.levels, fields: (Array.isArray(r.fields) && r.fields.length) ? r.fields : null,
      baseAdm: adm, baseSch: sch,
      req: { academics: req.academics, language: req.language, budget: typeof req.budget === "number" ? req.budget : 0, sat: typeof req.sat === "number" ? req.sat : undefined },
      deadline: r.deadline || "уточняется", note: r.note || "", funding: r.funding || "",
      langYear: !!(r.langYear || r.lang_year),
      deadlineMd: r.deadlineMd || r.deadline_md || null,
      openMd: r.openMd || r.apply_open_md || null,
      exam: r.exam || null,
      source_url: r.source_url || ""
    };
  }

  function setPrograms(rows, source) {
    if (!Array.isArray(rows)) return false;
    var out = [];
    for (var i = 0; i < rows.length; i++) { var n = normalizeRow(rows[i]); if (n) out.push(n); }
    if (out.length < 40) return false;   // подозрительно мало — каталог не подменяем
    PROGRAMS = out;
    CATALOG.source = source || "db";
    return true;
  }

  // Загрузка каталога (только браузер). Фолбэк — встроенный список: сайт
  // обязан считать даже при лежащей базе. Кэш на 6 часов.
  function initCatalog(cfg) {
    if (typeof fetch === "undefined" || !cfg || !cfg.SUPABASE_URL) return Promise.resolve(false);
    var CK = "scholary_catalog_v3";
    try {
      var c = JSON.parse(sessionStorage.getItem(CK) || "null");
      if (c && c.t && Date.now() - c.t < 216e5 && setPrograms(c.rows, "db-cache")) return Promise.resolve(true);
    } catch (e) {}
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    if (ctrl) setTimeout(function () { ctrl.abort(); }, 3500);
    return fetch(cfg.SUPABASE_URL + "/rest/v1/programs_engine?select=*", {
      headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + cfg.SUPABASE_ANON_KEY },
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rows) {
        var ok = rows ? setPrograms(rows, "db") : false;
        if (ok) { try { sessionStorage.setItem(CK, JSON.stringify({ t: Date.now(), rows: rows })); } catch (e) {} }
        try { if (typeof window !== "undefined" && window.track) window.track("engine_catalog", { source: ok ? "db" : "fallback", n: PROGRAMS.length }); } catch (e) {}
        return ok;
      })
      .catch(function () {
        try { if (typeof window !== "undefined" && window.track) window.track("engine_catalog", { source: "fallback_error", n: PROGRAMS.length }); } catch (e) {}
        return false;
      });
  }

  var api = {
    evaluate: evaluate,
    profileFromAnswers: profileFromAnswers,
    setPrograms: setPrograms,
    initCatalog: initCatalog,
    VERSION: 3,
    get PROGRAMS() { return PROGRAMS; },
    get BUILTIN() { return BUILTIN; }
  };
  // автозагрузка каталога в браузере: страницы могут ждать ScholaryEngine.ready
  if (typeof window !== "undefined" && window.SCHOLARY_CONFIG) {
    api.ready = initCatalog(window.SCHOLARY_CONFIG);
  }
  return api;
});
