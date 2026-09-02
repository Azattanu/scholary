/* ============================================================
   Scholary Report Engine v1 — единая логика персонального отчёта.
   Работает и в браузере (window.ScholaryEngine — превью на пейволле),
   и в Node на бэкенде (module.exports — генерация полного отчёта).

   ПОТОК ДАННЫХ:
   ответы квиза (фаза 1 [+ фаза 2]) → profile (6 осей, 0–10)
   → матчинг по каталогу программ → ДВЕ вероятности на программу
   (поступление и стипендия) → портфель 8–10 → вердикт, бустеры,
   P(хотя бы один оффер).

   ВАЖНО ДЛЯ КАЛИБРОВКИ: базовые ставки (baseAdm/baseSch) — экспертные
   оценки v1. Они честно «около-правильные», не точные. С первых исходов
   (слой 4 видения) их калибруем данными. Формулы простые и монотонные
   специально: их легко объяснить абитуриенту и легко калибровать.
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
      return arr.filter(function (p) { return p.p.adm >= from && p.p.adm < to; }).slice(0, n);
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
    var ps = portfolio.map(function (p) { return p.p.adm; }).sort(function (a, b) { return b - a; });
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

  /* ---------- 6. ГЛАВНАЯ ФУНКЦИЯ ---------- */
  // evaluate(answers) → всё, что нужно и превью, и полному отчёту
  function evaluate(a) {
    var profile = profileFromAnswers(a);
    var portfolio = buildPortfolio(profile, a);
    var pAny = pAtLeastOne(portfolio);
    var axes = profile.axes;
    var axisNames = { academics: "Академика", language: "Язык", achievements: "Достижения", motivation: "Мотивационное", budget: "Бюджет", fit: "Соответствие" };
    // сильное/слабое место — только из осей, на которые человек может влиять
    var sorted = ["academics", "language", "achievements", "motivation"].sort(function (x, y) { return axes[y] - axes[x]; });
    return {
      profile: profile,
      portfolio: portfolio,
      pAtLeastOne: pAny,
      programsCount: portfolio.length,
      topCountry: portfolio.length ? portfolio[0].country : "—",
      strongest: axisNames[sorted[0]],
      weakest: axisNames[sorted[sorted.length - 1]],
      verdict: verdictFor(pAny, profile),
      boosters: boosters(profile, a)
    };
  }

  return { evaluate: evaluate, profileFromAnswers: profileFromAnswers, PROGRAMS: PROGRAMS };
});
