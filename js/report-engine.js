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
    { id: "isdb_msp", name: "Merit-стипендия Исламского банка", country: "Саудовская Аравия", cc: "sa", levels: ["phd"], baseAdm: .08, baseSch: .08, req: { academics: 8, language: 6, budget: 0 }, deadline: "уточняй окно на сайте", fields: ["it", "eng", "sci", "med"], note: "подать самому нельзя — нужна номинация научного института Казахстана; возраст до 35 и опыт исследований", funding: "обучение, стипендия, страховка, билет и обустройство, поездки на конференции", source_url: "https://www.isdb.org/scholarships/scholarship-programs" },
    // ---- партия 3 (web-70): промоделировано по официальным источникам, verified:false до сверки ----
    { id: "tr_uni_merit", name: "Полные merit-стипендии частных вузов Турции (Koç, Sabancı, Bilkent)", country: "Турция", cc: "tr", levels: ["bachelor", "master"], baseAdm: .3, baseSch: .3, req: { budget: 0, language: 6, academics: 7.5 }, deadline: "апрель–май", note: "merit решается вместе с зачислением; сильный аттестат и олимпиады решают", funding: "до 100% платы + у части вузов стипендия и общежитие", source_url: "https://apply.ku.edu.tr/" },
    { id: "mext_univrec", name: "MEXT University Recommendation (Япония)", country: "Япония", cc: "jp", levels: ["master", "phd"], baseAdm: .15, baseSch: .15, req: { budget: 0, language: 6, academics: 7.5 }, deadline: "ноябрь–январь (у каждого вуза своё окно)", note: "второй трек MEXT: номинация университетом, минуя посольство; писать профессору заранее", funding: "обучение 0 ₸ + 144 000–145 000 ¥/мес + перелёт", source_url: "https://www.studyinjapan.go.jp/en/planning/scholarship/" },
    { id: "weidenfeld", name: "Weidenfeld-Hoffmann (Oxford)", country: "Великобритания", cc: "gb", levels: ["master"], baseAdm: .06, baseSch: .06, req: { budget: 0, language: 7, academics: 8.5 }, deadline: "вместе с январским дедлайном курса Oxford", fields: ["law", "hum", "bus", "sci"], note: "для будущих лидеров развивающихся стран; эссе и интервью", funding: "полное покрытие: плата + грант на жизнь", source_url: "https://www.whtrust.org/" },
    { id: "kfupm", name: "KFUPM (Саудовская Аравия) — магистратура/PhD", country: "Саудовская Аравия", cc: "sa", levels: ["master", "phd"], baseAdm: .25, baseSch: .25, req: { budget: 0, language: 5.5, academics: 7 }, deadline: "раунды: до середины марта и до октября", fields: ["it", "eng", "sci"], note: "инженерно-технический профиль; GRE у части программ", funding: "обучение 0 ₸ + стипендия + жильё + перелёт домой раз в год", source_url: "https://www.kfupm.edu.sa/" },
    { id: "oist_phd", name: "OIST PhD (Япония, Окинава)", country: "Япония", cc: "jp", levels: ["phd"], baseAdm: .12, baseSch: .95, req: { budget: 0, language: 6.5, academics: 8 }, deadline: "два окна: ~15 апреля и ~15 октября", fields: ["sci", "it", "eng"], note: "зачислен — значит профинансирован; исследовательский трек", funding: "полное финансирование всех аспирантов + relocation", source_url: "https://www.oist.jp/admissions" },
    { id: "epfl_excellence", name: "EPFL Excellence Fellowship (Швейцария)", country: "Швейцария", cc: "ch", levels: ["master"], baseAdm: .1, baseSch: .15, req: { budget: 2, language: 7, academics: 8.5 }, deadline: "вместе с заявкой в магистратуру, ~15 декабря / 15 апреля", fields: ["it", "eng", "sci"], note: "отдельной заявки нет — рассматривают всех поступающих", funding: "16 000 CHF/год + освобождение от платы", source_url: "https://www.epfl.ch/education/master/" },
    { id: "boell", name: "Heinrich-Böll-Stiftung Scholarship for International Students (Studienwerk)", country: "Германия", cc: "de", levels: ["master", "phd"], baseAdm: .15, baseSch: .15, req: { academics: 7, language: 6.5, budget: 0 }, deadline: "1 марта", note: "Только магистратура и PhD (бакалавриат для иностранцев закрыт). Приоритет — кандидаты из стран DAC-списка (Казахстан входит), ещё не проживающие в Германии. Отбор с интервью, важна общественная активность, экология, права человека; немецкий B2 обязателен.", funding: "Ежемесячная стипендия по ставкам BMBF (ориентир: ~€992/мес магистратура, ~€1 450/мес PhD) + доплаты на медстраховку/семью; обучение в гос. вузах Германии бесплатно. Продолжительность — весь нормативный срок программы.", source_url: "https://www.boell.de/en/application" },
    { id: "kas_intl", name: "Konrad-Adenauer-Stiftung — International Talent Development (scholarships for international students and doctoral candidates)", country: "Германия", cc: "de", levels: ["master", "phd"], baseAdm: .12, baseSch: .12, req: { academics: 7, language: 6.5, budget: 0 }, deadline: "15 июля", note: "Нужен немецкий B2 даже для англоязычных программ, отбор с интервью (в т.ч. в региональных офисах KAS). Ценностный фонд ХДС: важна общественная/политическая активность. Возрастного лимита нет.", funding: "До €992/мес (магистратура, постдиплом) и до €1 400/мес (PhD) + доплаты на страховку; стандартно 2 года (магистратура) / 3 года (PhD). Обучение в гос. вузах бесплатно.", source_url: "https://www.kas.de/en/web/begabtenfoerderung-und-kultur/international-talent-development" },
    { id: "rosalux", name: "Rosa-Luxemburg-Stiftung — Scholarships for international students (Studienwerk)", country: "Германия", cc: "de", levels: ["master", "phd"], baseAdm: .12, baseSch: .12, req: { academics: 7, language: 6.5, budget: 0 }, deadline: "1 октября", note: "Для иностранцев — только магистратура (Master only) и PhD (кроме медицины/стоматологии/ветеринарии); нужно проживать в Германии на период учёбы и планировать возврат на родину. Немецкий B2, левые/социально-политические ценности фонда, интервью.", funding: "Стипендия по стандартным ставкам немецких фондов (BMBF): ~€992/мес магистратура, ~€1 450/мес PhD + доплаты на страховку; обучение бесплатно.", source_url: "https://www.rosalux.de/en/foundation/studienwerk" },
    { id: "fnf_intl", name: "Friedrich-Naumann-Stiftung für die Freiheit — Stipendium für ausländische Studierende und Promovierende", country: "Германия", cc: "de", levels: ["master", "phd"], baseAdm: .12, baseSch: .12, req: { academics: 7, language: 6.5, budget: 0 }, deadline: "30 апреля", note: "Иностранцы — только очная магистратура или PhD в Германии; до начала выплат нельзя жить в Германии >15 месяцев (кроме учёбы). Заявка и собеседование полностью на немецком; либеральный фонд (СвДП).", funding: "€992/мес (магистратура), до €1 500/мес (PhD) + доплаты на супруга €276 и ребёнка €259, медстраховка. Обучение бесплатно.", source_url: "https://www.freiheit.org/scholarships" },
    { id: "daad_master", name: "DAAD Study Scholarships — Master Studies for All Academic Disciplines", country: "Германия", cc: "de", levels: ["master"], baseAdm: .22, baseSch: .22, req: { academics: 7.5, language: 6.5, budget: 0 }, deadline: "осень (обычно окт–ноя, approx) — через DAAD Information Centre Алматы; даты о…", note: "Подача через DAAD-портал и офис в Казахстане; нужен диплом бакалавра не старше 6 лет, отличная успеваемость, мотивация; часто требуют одновременно подать в вузы. Не путать с EPOS/Helmut-Schmidt (уже в каталоге).", funding: "€992/мес на 10–24 мес + медстраховка, проездной грант, при необходимости доплата на аренду/семью, оплата языкового курса; обучение в гос. вузах бесплатно.", source_url: "https://www.daad.de/en/studying-in-germany/scholarships/daad-scholarships/" },
    { id: "daad_phd", name: "DAAD Research Grants — Doctoral Programmes in Germany", country: "Германия", cc: "de", levels: ["phd"], baseAdm: .18, baseSch: .18, req: { academics: 7.5, language: 6.5, budget: 0 }, deadline: "осень (approx, по стране — см. DAAD Алматы); дедлайны публикуются ежегодно во…", note: "Нужны диплом магистра, письмо-согласие научного руководителя в Германии и проработанный исследовательский план; отбор комиссией DAAD. Доступно гражданам почти всех стран, включая Казахстан.", funding: "€1 300/мес до 4 лет + медстраховка, проездной грант, исследовательская надбавка €460/год, доплата на аренду и семью, оплата языкового курса.", source_url: "https://www2.daad.de/deutschland/stipendium/datenbank/en/21148-scholarship-database/?detail=57135739" },
    { id: "ista_phd", name: "ISTA PhD Program (Institute of Science and Technology Austria)", country: "Австрия", cc: "at", levels: ["phd"], baseAdm: .1, baseSch: .95, req: { academics: 8.5, language: 7, budget: 0 }, deadline: "8 января", fields: ["sci", "it", "eng"], note: "Можно поступать сразу после бакалавра; треки: биология, химия/материалы, CS, data science, математика, нейронауки, физика. Очень конкурентный отбор с интервью в кампусе под Веной.", funding: "Полностью оплачиваемая позиция: зарплата €3 053–3 673/мес брутто (2026), полное соцстрахование; обучение и подача бесплатны.", source_url: "https://phd.pages.ista.ac.at/phd-application-admission/" },
    { id: "unige_excellence", name: "University of Geneva — Excellence Master Fellowships (Faculty of Science)", country: "Швейцария", cc: "ch", levels: ["master"], baseAdm: .15, baseSch: .15, req: { academics: 8, language: 6.5, budget: 0 }, deadline: "28 февраля (ориентировочно)", fields: ["sci"], note: "Только факультет наук: астрономия, биология, химия/биохимия, CS, математика, физика, фармацевтика, науки о Земле. Отбор по досье (CV, транскрипт, мотивация, 2 рекомендации); продление после 1-го семестра при хороших оценках.", funding: "CHF 10 000–15 000 в год на весь срок магистратуры (3–4 семестра), без преподавательских обязанностей; плата за обучение в UNIGE — CHF 500/семестр.", source_url: "https://www.unige.ch/sciences/en/enseignements/formations/masters/excellencemasterfellowships" },
    { id: "unil_master", name: "Unil Master's Scholarship (UNIL Master's grants, Université de Lausanne)", country: "Швейцария", cc: "ch", levels: ["master"], baseAdm: .08, baseSch: .08, req: { academics: 8, language: 6.5, budget: 0 }, deadline: "1 ноября", note: "~10 стипендий в год, только для выпускников зарубежных вузов с очень высокими оценками. Не для медицины, педагогики и большинства юридических магистратур; 2 рекомендательных письма напрямую от авторов.", funding: "CHF 1 600/мес на нормативный срок магистратуры + освобождение от платы за обучение (остаётся CHF 80/семестр). Не покрывает всю стоимость жизни.", source_url: "https://www.unil.ch/unil/en/home/menuinst/etudier/mobilite-et-echange/etudiantes-et-etudiants-internationaux/etudiantes-internationaux-reguliers/bourse-de-master.html" },
    { id: "iheid", name: "Geneva Graduate Institute (IHEID) — Scholarships and financial aid for Master programmes", country: "Швейцария", cc: "ch", levels: ["master"], baseAdm: .2, baseSch: .2, req: { academics: 7.5, language: 7, budget: 3 }, deadline: "15 января (ориентировочно)", fields: ["hum", "law", "bus"], note: "Отдельно подавать не нужно — заявка на финансовую помощь идёт в общей анкете; решение по сочетанию академических успехов и финансовой нужды. Профиль: международные отношения, развитие, право, экономика.", funding: "Полная или частичная стипендия (по формулировке института — максимум CHF 20 000 на два года) и/или снижение платы за обучение; институт тратит >CHF 2 млн в год на поддержку студентов.", source_url: "https://www.graduateinstitute.ch/fees-financial-aid" },
    { id: "leiden_lexs", name: "Leiden University Excellence Scholarship (LExS)", country: "Нидерланды", cc: "nl", levels: ["master"], baseAdm: .1, baseSch: .1, req: { academics: 8.5, language: 7, budget: 0 }, deadline: "1 декабря", note: "Только для не-EEA студентов очной магистратуры (кроме обычных LLM и MSc юрфака); ~25 стипендий на >1000 заявок. Не полная стипендия — нужно доказать остаток средств для визы.", funding: "Фиксированные суммы к оплате обучения: €10 000 / €15 000 / €17 500 / €18 500 / €19 000 (из ~€20–25 тыс. non-EU tuition); проживание не покрывается.", source_url: "https://www.universiteitleiden.nl/en/scholarships/sea/leiden-university-excellence-scholarship-lexs" },
    { id: "um_high_potential", name: "UM NL-High Potential Scholarship (Maastricht University)", country: "Нидерланды", cc: "nl", levels: ["master"], baseAdm: .08, baseSch: .08, req: { academics: 8.5, language: 7, budget: 0 }, deadline: "1 февраля", note: "Только для не-EU/EEA, возраст до 35 лет на 1 сентября, GPA ≥7.5/10, желательно без имеющейся магистратуры; сначала нужно полностью подать в программу через Studielink. Выигрывают ~2% заявителей.", funding: "Полное покрытие: на проживание €20 150 (13 мес) или €38 750 (25 мес) + плата за обучение, виза, медстраховка.", source_url: "https://www.maastrichtuniversity.nl/studeren/toelating-inschrijving/financing-your-studies/scholarships/maastricht-university-nl-high" },
    { id: "twente_uts", name: "University of Twente Scholarship (UTS)", country: "Нидерланды", cc: "nl", levels: ["master"], baseAdm: .15, baseSch: .15, req: { academics: 8, language: 6.5, budget: 2 }, deadline: "1 апреля", note: "Только не-EU/EEA с (условным) зачислением на MSc в Twente; нужно входить в топ-5–10% своего выпуска. Часто покрывает лишь часть — уточняйте сумму по программе.", funding: "€3 000–22 000 на один год (в зависимости от программы); при хорошей успеваемости возможен второй год.", source_url: "https://www.utwente.nl/en/education/scholarship-finder/university-of-twente-scholarship/" },
    { id: "master_mind", name: "Master Mind Scholarships (Government of Flanders)", country: "Бельгия", cc: "be", levels: ["master"], baseAdm: .1, baseSch: .1, req: { academics: 8.5, language: 7, budget: 2 }, deadline: "15 января (ориентировочно)", note: "Открыто всем гражданствам, кроме России; нужен GPA ≥3.5/4.0 и IELTS 7.0. Подаёте через фламандский вуз (каждый выдвигает до 20 кандидатов) — сначала заявка на магистратуру, потом номинация.", funding: "€10 225 в год + освобождение от платы за обучение (tuition fee waiver) на 1 год (60 ECTS) или 2 года (120 ECTS).", source_url: "https://www.studyinflanders.be/scholarships/master-mind-scholarships/eligibility-criteria" },
    { id: "boutmy", name: "Émile Boutmy Scholarship (Sciences Po)", country: "Франция", cc: "fr", levels: ["bachelor", "master"], baseAdm: .2, baseSch: .2, req: { academics: 7.5, language: 6.5, budget: 2 }, deadline: "1 февраля", fields: ["hum", "law", "bus"], note: "Только для граждан не-ЕС, чья семья не платит налоги в ЕС, впервые поступающих в Sciences Po; учитываются и доход семьи, и academic excellence. Нельзя подать после зачисления — только в анкете поступления.", funding: "Бакалавриат: полное освобождение от tuition или скидка €9 500/год; магистратура: скидка €18 500/год на оба года. Возможны допвыплаты на проживание отдельным спонсорским стипендиатам.", source_url: "https://www.sciencespo.fr/students/en/fees-funding/bursaries-financial-aid/emile-boutmy-scholarship/" },
    { id: "paris_saclay", name: "Université Paris-Saclay International Master's Scholarships Program", country: "Франция", cc: "fr", levels: ["master"], baseAdm: .18, baseSch: .18, req: { academics: 8, language: 6.5, budget: 2 }, deadline: "31 марта (ориентировочно)", note: "Иностранцы до 30 лет, впервые учащиеся во Франции, зачисленные на магистратуру Paris-Saclay; кандидатуру выдвигает координатор программы. Нельзя совмещать с Eiffel/France Excellence/Erasmus Mundus.", funding: "€10 000 в год (на M1 и/или M2, продлевается на 2-й год) + до €900/год на дорогу и визу; обучение в гос. вузе ~€250/год.", source_url: "https://www.universite-paris-saclay.fr/en/admission/bourses-et-aides-financieres/international-masters-scholarships-program" },
    { id: "ens_intl", name: "ENS International Selection (École normale supérieure – PSL, Paris)", country: "Франция", cc: "fr", levels: ["master"], baseAdm: .05, baseSch: .95, req: { academics: 9, language: 7, budget: 0 }, deadline: "15 декабря (ориентировочно)", fields: ["sci", "hum"], note: "Возраст до 26 лет на 1 декабря, минимум 1–2 года бакалавриата в зарубежном вузе, нельзя жить во Франции >10 мес в год отбора и подавать повторно. Письменные и устные экзамены в Париже; крайне конкурентно.", funding: "€1 000/мес в течение 3 лет + комната в кампусе ENS; обучение бесплатно (диплом ENS + магистратура).", source_url: "https://www.ens.psl.eu/en/academics/admissions/international-selection" },
    { id: "ampere_lyon", name: "Ampère Scholarships of Excellence (ENS de Lyon)", country: "Франция", cc: "fr", levels: ["master"], baseAdm: .08, baseSch: .08, req: { academics: 8.5, language: 7, budget: 0 }, deadline: "23 января", note: "Для иностранных студентов, поступающих в магистратуру ENS Lyon по точным наукам, искусствам и гуманитарным наукам; заявка на стипендию подаётся вместе с заявкой на магистратуру. Результаты в середине марта.", funding: "€1 000/мес на 12 месяцев (1 учебный год), продляемо на M2 при условиях; обучение в ENS ~€250/год.", source_url: "https://www.ens-lyon.fr/en/studies/admissions/application-masters-degrees-and-scholarships" },
    { id: "iyt_italy", name: "Invest Your Talent in Italy (IYT) — MAECI / Uni-Italia", country: "Италия", cc: "it", levels: ["master"], baseAdm: .2, baseSch: .2, req: { academics: 7, language: 6.5, budget: 2 }, deadline: "11 мая (ориентировочно)", fields: ["eng", "it", "bus", "art", "sci"], note: "Казахстан входит в список стран IYT. Только англоязычные магистратуры-партнёры по инженерии/IT/экономике/дизайну; отбор по академическим результатам и мотивации, обязателен интерншип.", funding: "€10 800 (выплаты поквартально, ~9 мес/год) + освобождение от платы за обучение (остаются ~€156 регионального сбора) + курс итальянского + обязательная стажировка в итальянской компании.", source_url: "https://www.unipi.it/en/education/registration/enrolment-and-registration/enrolment-for-international-students/invest-your-talent-in-italy-scholarships/" },
    { id: "unibo_talents", name: "International Talents @Unibo — study grants for international students (University of Bologna)", country: "Италия", cc: "it", levels: ["master"], baseAdm: .2, baseSch: .2, req: { academics: 7.5, language: 6.5, budget: 2 }, deadline: "30 мая (ориентировочно)", note: "Для первокурсников магистратуры с дипломом, полученным вне итальянской системы (гражданство не важно). Ранжирование строго по GRE General (мин. V+Q 290, AW 3.0) — нужно сдать тест заранее. Есть требование по доходу семьи (ISEE €16 000–35 000) и возраст до 30 лет.", funding: "30 грантов по €6 500 в год на 2 года + полное освобождение от платы за обучение (остаётся ~€157 сборов).", source_url: "https://bandi.unibo.it/s/diri/bando-international-talents-unibo-borse-di-studio-per-studenti-internazionali-che-si-immatricolano-ai-corsi-di-laurea-magistrale-dell-universita-di-bologna-per-l-a-a-2025-26/call-for-application/en-bando_international-talents-2526_17-1-25.pdf/@@download/file/EN%20BANDO_INTERNATIONAL%20TALENTS%202526_17-1-25.pdf" },
    { id: "padua_excellence", name: "Padua International Excellence Scholarship Programme (Università di Padova)", country: "Италия", cc: "it", levels: ["bachelor", "master"], baseAdm: .15, baseSch: .15, req: { academics: 8, language: 6.5, budget: 0 }, deadline: "2 февраля (ориентировочно)", note: "Отдельно не подаётся — рассматриваются все, кто подал в англоязычную программу в первом раунде (иностранный диплом/аттестат, не резидент Италии). Нужно набрать ≥20 ECTS к 30 ноября, иначе стипендия отзывается.", funding: "€8 000 брутто в год + освобождение от платы за обучение (остаются региональный сбор и гербовая марка); до 2 лет магистратура / 3 года бакалавриат; до 68 стипендий.", source_url: "https://www.unipd.it/en/padua-excellence" },
    { id: "topolito", name: "TOPoliTO Scholarships (Politecnico di Torino)", country: "Италия", cc: "it", levels: ["master"], baseAdm: .1, baseSch: .1, req: { academics: 8, language: 6.5, budget: 0 }, deadline: "31 августа (ориентировочно)", fields: ["eng", "it"], note: "~10 стипендий (6 инженерия, 4 архитектура) для обладателей зарубежного бакалавра, не живших в Италии последние 5 лет; ранжирование по GRE. Небольшая программа — рассматривать как дополнение к DSU/EDISU (уже в каталоге).", funding: "€8 000 брутто в год (~€7 370 нетто) на 2 года магистратуры; плата за обучение, дорога и жильё НЕ покрываются (tuition для иностранцев по доходу семьи, часто снижена).", source_url: "https://www.polito.it/en/education/international-students/financial-aid" },
    { id: "inphinit", name: "\"la Caixa\" Foundation Doctoral INPhINIT Fellowships — Incoming", country: "Испания", cc: "es", levels: ["phd"], baseAdm: .08, baseSch: .95, req: { academics: 9, language: 7, budget: 0 }, deadline: "28 января (ориентировочно)", fields: ["sci", "eng", "it", "med"], note: "Любое гражданство; нельзя жить/работать в Испании или Португалии >12 мес за последние 3 года и иметь >4 лет исследовательского опыта. Только центры с аккредитацией Severo Ochoa / María de Maeztu / ISCIII (или португальские «excellent»); STEM-профиль, интервью.", funding: "Полная оплата труда и tuition за докторантуру + бюджет на исследования; 30 стипендий, до 4 лет (в прошлые годы ~€35 800/год + €3 564/год на расходы).", source_url: "https://lacaixafoundation.org/en/doctoral-inphinit-fellowships-incoming-call" },
    { id: "kth_scholarship", name: "KTH Scholarship (KTH Royal Institute of Technology)", country: "Швеция", cc: "se", levels: ["master"], baseAdm: .08, baseSch: .08, req: { academics: 8.5, language: 7, budget: 0 }, deadline: "15 января", fields: ["eng", "it", "sci"], note: "Только для fee-paying (не-EU) студентов, поставивших KTH-программу первым приоритетом на universityadmissions.se и оплативших сбор. В 2025 получили ~8% (65 из 803 заявителей).", funding: "Полное покрытие платы за обучение (~SEK 155 000–200 000/год) на 1-й и 2-й год; проживание не покрывается.", source_url: "https://www.kth.se/en/studies/master/admissions/scholarships/kth-scholarship-1.72827" },
    { id: "lund_global", name: "Lund University Global Scholarship", country: "Швеция", cc: "se", levels: ["bachelor", "master"], baseAdm: .12, baseSch: .12, req: { academics: 8, language: 6.5, budget: 2 }, deadline: "16 февраля", note: "Только граждане вне EU/EEA/Швейцарии, обязанные платить tuition, подавшие Lund первым приоритетом; отбор по академическим результатам, финансовая нужда не учитывается. Мотивационное письмо до 600 слов.", funding: "Покрытие 25–100% платы за обучение (сумма зависит от факультета); проживание не покрывается.", source_url: "https://www.lunduniversity.lu.se/admissions/scholarships-and-awards/lund-university-global-scholarship" },
    { id: "uppsala_global", name: "Uppsala University Global Scholarship (Master's)", country: "Швеция", cc: "se", levels: ["master"], baseAdm: .08, baseSch: .08, req: { academics: 8.5, language: 7, budget: 0 }, deadline: "2 февраля", note: "Для fee-paying студентов вне EU/EEA; отдельная заявка на стипендию после подачи в программу через universityadmissions.se. Отбор по академическим результатам; программы Uppsala первым приоритетом.", funding: "Полное покрытие платы за обучение на весь срок магистратуры; проживание не покрывается.", source_url: "https://www.uu.se/en/study/masters-studies/scholarships/uppsala-university-scholarships" },
    { id: "chalmers_ipoet", name: "Chalmers IPOET and Avancez Scholarships (Chalmers University of Technology)", country: "Швеция", cc: "se", levels: ["master"], baseAdm: .15, baseSch: .15, req: { academics: 8, language: 6.5, budget: 2 }, deadline: "15 января", fields: ["eng", "it", "sci"], note: "Доступно всем fee-paying (не-EU) студентам, подавшим на магистратуру Chalmers; нужен номер заявки universityadmissions.se. Финансовое положение не учитывается — только академические достижения.", funding: "Снижение платы за обучение на 75% на 4 семестра (IPOET — финансирует правительство Швеции; Avancez — Chalmers); при отличных результатах 1-го года — до 85%. Проживание не покрывается.", source_url: "https://www.chalmers.se/en/education/application-and-admission/scholarships-for-fee-paying-students/" },
    { id: "ki_global", name: "KI Global Master's Scholarship for fee-paying students (Karolinska Institutet)", country: "Швеция", cc: "se", levels: ["master"], baseAdm: .06, baseSch: .06, req: { academics: 8.5, language: 7, budget: 0 }, deadline: "15 февраля", fields: ["med"], note: "Только для fee-paying студентов, поставивших программу KI первым приоритетом; ~10–12 стипендий в год, по одной на программу (лучший по KI CV-форме). Медицина/биомедицина/общественное здоровье.", funding: "Полное покрытие платы за обучение на весь срок магистратуры; проживание, дорога и жильё не покрываются.", source_url: "https://education.ki.se/bachelors-masters-studies/scholarships/the-ki-global-masters-scholarships-for-fee-paying-students" },
    { id: "imperial_phd", name: "President's PhD Scholarships (Imperial College London)", country: "Великобритания", cc: "gb", levels: ["phd"], baseAdm: .08, baseSch: .08, req: { academics: 9, language: 7, budget: 0 }, deadline: "12 января (ориентировочно)", note: "Без ограничений по гражданству; нужны диплом с отличием (first class / distinction) и предварительное согласие научного руководителя. Заявка через обычный doctoral admissions с research proposal.", funding: "Полная оплата tuition + стипендия £26 500/год (2026–27) + £2 000/год на расходные материалы в первые 3 года; 50 стипендий.", source_url: "https://www.imperial.ac.uk/study/fees-and-funding/postgraduate-doctoral/grants-scholarships/presidents-phd/" },
    { id: "ucl_res", name: "UCL Research Excellence Scholarship (UCL-RES)", country: "Великобритания", cc: "gb", levels: ["phd"], baseAdm: .08, baseSch: .08, req: { academics: 9, language: 7, budget: 0 }, deadline: "9 января (ориентировочно)", note: "Для кандидатов из любой страны, подавших полную заявку на PhD в UCL; нужен диплом уровня UK 2:1+. Отдельная заявка на стипендию, конкурс очень высокий.", funding: "Полная оплата tuition (Overseas) + стипендия £22 780/год (ставка 2025/26) на исследовательскую часть программы + до £1 200/год на исследования; 40 стипендий.", source_url: "https://www.ucl.ac.uk/scholarships/research-excellence-scholarship" },
    { id: "lse_gss", name: "LSE Graduate Support Scheme (GSS)", country: "Великобритания", cc: "gb", levels: ["master"], baseAdm: .3, baseSch: .3, req: { academics: 7.5, language: 7, budget: 4 }, deadline: "23 апреля (ориентировочно)", fields: ["hum", "bus", "law"], note: "Открыт всем гражданствам на taught master's/diploma (кроме executive/модульных программ); оценивается финансовая нужда, а не успеваемость. Заявка через Graduate Financial Support после подачи на поступление; не влияет на решение о приёме.", funding: "£5 000–20 000 (need-based, разово на год) в дополнение к другим источникам; полный tuition не покрывает.", source_url: "https://www.lse.ac.uk/study-at-lse/Graduate/fees-and-funding/graduate-support-scheme" },
    { id: "warwick_phd", name: "Chancellor's International / Chancellor's Scholarships (University of Warwick, PGR)", country: "Великобритания", cc: "gb", levels: ["phd"], baseAdm: .08, baseSch: .08, req: { academics: 8.5, language: 7, budget: 0 }, deadline: "11 декабря (ориентировочно)", note: "Любое гражданство и fee status; нужен оффер на PGR-программу Warwick на октябрь, отсрочка невозможна. Проект по любой дисциплине или междисциплинарный в рамках Research Spotlights.", funding: "Полная оплата academic fees + стипендия по ставке UKRI (~£20 780/год) на 3.5 года + разовый грант RTSG £5 000; иммиграционная поддержка.", source_url: "https://warwick.ac.uk/services/dc/schols_fund/scholarships_and_funding/" },
    { id: "cam_intl", name: "Cambridge International Scholarship (Cambridge Trust)", country: "Великобритания", cc: "gb", levels: ["phd"], baseAdm: .08, baseSch: .08, req: { academics: 9, language: 7.5, budget: 0 }, deadline: "3 декабря (ориентировочно)", note: "Все страны, кроме UK/Ирландии, со статусом Overseas; отдельной заявки нет — отмечаете funding в общей аппликации в Cambridge до дедлайна по курсу. Решения март–июль; если не связались до конца июля — отказ.", funding: "Полная оплата University Composition Fee (International) + maintenance (~£20 000+/год) + иммиграционный медсбор; ~80 стипендий в год.", source_url: "https://www.student-funding.cam.ac.uk/fund/cambridge-international-scholarship-2024" },
    { id: "edinburgh_edcs", name: "Edinburgh Doctoral College Scholarships (EDCS, University of Edinburgh)", country: "Великобритания", cc: "gb", levels: ["phd"], baseAdm: .08, baseSch: .08, req: { academics: 8.5, language: 7, budget: 0 }, deadline: "31 января (ориентировочно)", note: "Открыто UK и overseas кандидатам на 1-й год PhD; нужен диплом уровня UK first/2:1. Сначала заявка на поступление, затем онлайн-заявка на стипендию через MyEd (Informatics и Physics рассматривают автоматически); в большинстве школ 1 стипендия.", funding: "Полная оплата tuition + стипендия по ставке UKRI (£20 780 в 2025–26) на 3–4 года (в зависимости от школы).", source_url: "https://registryservices.ed.ac.uk/student-funding/postgraduate/international/doctoral-college" },
    { id: "standrews_ug", name: "International Excellence Scholarship (University of St Andrews, undergraduate)", country: "Великобритания", cc: "gb", levels: ["bachelor"], baseAdm: .1, baseSch: .1, req: { academics: 8.5, language: 7, budget: 5 }, deadline: "27 января", note: "Только один победитель среди overseas-абитуриентов (кроме медицины и совместного BA с William & Mary); заявка через портал после подачи на курс, победитель обязан быть Student Ambassador. Есть и частичные International Undergraduate Scholarships.", funding: "Полная оплата tuition на весь срок бакалавриата (одна стипендия в год); проживание не покрывается.", source_url: "https://www.st-andrews.ac.uk/study/scholarships/scholarships-catalogue/undergraduate-scholarships/international-excellence-scholarship/" },
    { id: "standrews_phd", name: "St Leonard's College World-Leading Doctoral Scholarships (University of St Andrews)", country: "Великобритания", cc: "gb", levels: ["phd"], baseAdm: .08, baseSch: .08, req: { academics: 8.5, language: 7, budget: 0 }, deadline: "20 января", note: "Для любого fee status, включая Overseas; нужна поданная заявка на PhD в St Andrews. Отбор студентом-инициированных проектов (student-led) при поддержке школы/руководителя.", funding: "Полная оплата tuition + стипендия £20 467/год (2026–27); до 6 стипендий.", source_url: "https://www.st-andrews.ac.uk/study/fees-and-funding/scholarships/scholarships-catalogue/postgraduate-scholarships/world-leading-scholarships-student-led/" },
    { id: "ucd_global", name: "UCD Global Excellence Scholarships (University College Dublin)", country: "Ирландия", cc: "ie", levels: ["bachelor", "master"], baseAdm: .25, baseSch: .25, req: { academics: 7.5, language: 6.5, budget: 3 }, deadline: "31 марта (ориентировочно)", note: "Только для абитуриентов со статусом non-EU fee; нужно иметь оффер на программу UCD и подать как можно раньше. Не продлевается автоматически — успеваемость проверяют каждый год.", funding: "50% или 100% платы за обучение (tuition ~€20–30 тыс./год) на бакалавриат и taught master's; проживание не покрывается; ежегодная переоценка.", source_url: "https://www.ucd.ie/global/study-at-ucd/scholarshipsfinances/scholarships/globalexcellencescholarships/" },
    { id: "fsv_scholars", name: "FSV UK SCHOLARS Program — Faculty of Social Sciences, Charles University", country: "Чехия", cc: "cz", levels: ["bachelor", "master"], baseAdm: .3, baseSch: .3, req: { academics: 7, language: 6.5, budget: 3 }, deadline: "30 апреля", fields: ["hum", "bus"], note: "Гражданство не ограничено; отбор по мотивационному эссе, рекомендации, оценкам и финансовому положению. Действует год, продление — через повторную заявку.", funding: "Единовременная выплата ок. 75 000 CZK (≈3 000 EUR) в год студентам платных англоязычных программ факультета социальных наук; освобождения от платы нет, но сумма покрывает около половины годовой платы; подавать заново каждый год.", source_url: "https://fsv.cuni.cz/en/admissions/scholarships-funding-and-fees/fsv-uk-scholars-program" },
    { id: "matfyz_tuition", name: "Computer Science / Prague Mathematics / Prague Physics Tuition Fee Scholarships — Faculty of Mathematics and Physics, Charles University (Matfyz)", country: "Чехия", cc: "cz", levels: ["bachelor", "master"], baseAdm: .25, baseSch: .25, req: { academics: 7.5, language: 6.5, budget: 3 }, deadline: "30 апреля", fields: ["it", "sci"], note: "Отдельная заявка на стипендию (CV, мотивационное письмо, 2 рекомендации) параллельно с поступлением; нельзя совмещать с другой стипендией. Мест очень мало, отбор по академическим результатам.", funding: "Покрытие платы за обучение: 7 100 EUR в год для студентов не из ЕС (4 200 EUR для ЕС) на весь срок — 3 года бакалавриата или 2 года магистратуры на англоязычных программах Computer Science; аналогичные схемы для математики и физики. До 6 мест на бакалавриат и 2 на магистратуру по CS.", source_url: "https://www.mff.cuni.cz/en/admissions/scholarships/cstf-scholarships-2026" },
    { id: "stars_phd", name: "STARS PhD Programme — Faculty of Science, Charles University", country: "Чехия", cc: "cz", levels: ["phd"], baseAdm: .2, baseSch: .95, req: { academics: 7.5, language: 6.5, budget: 0 }, deadline: "30 апреля (ориентировочно)", fields: ["sci"], note: "Нужен диплом магистра по естественным наукам/медицине/фармации; выбираете до 3 проектов, отбор руководителем и интервью. Открыто для всех иностранцев.", funding: "Полностью финансируемые PhD-позиции: гарантированный минимум 20 500 CZK/мес (≈800 EUR) на 4 года, фактически часто выше за счёт грантов проектов; обучение без платы.", source_url: "https://stars-natur.cz/" },
    { id: "debrecen_intl", name: "University of Debrecen International Scholarship (UD International Scholarship)", country: "Венгрия", cc: "hu", levels: ["bachelor", "master"], baseAdm: .35, baseSch: .35, req: { academics: 6.5, language: 6, budget: 3 }, deadline: "15 июня", note: "Казахстан среди 100+ стран-участниц; нельзя быть уже зачисленным в венгерский вуз; только сентябрьский набор. Стипендия не покрывает проживание.", funding: "Скидка до 90% годовой платы за обучение (до 30% на медицине/стоматологии) на программах по инженерии, IT, естественным и аграрным наукам, здравоохранению и математике + медицинская страховка; размер зависит от оценок и вступительного экзамена.", source_url: "https://edu.unideb.hu/page.php?id=426" },
    { id: "corvinus_scholarship", name: "Corvinus Scholarship — Corvinus University of Budapest (tuition-free places on MSc Management and Leadership, MSc Finance, International MBA)", country: "Венгрия", cc: "hu", levels: ["master"], baseAdm: .2, baseSch: .2, req: { academics: 7.5, language: 6.5, budget: 3 }, deadline: "31 мая (ориентировочно)", fields: ["bus"], note: "Только для самофинансируемых студентов (не Stipendium Hungaricum); стипендия не покрывает проживание. Отбор по академическим результатам, решение принимает президентский комитет.", funding: "Полное или частичное покрытие платы за обучение (до 100% семестровой платы) для студентов платных программ; до 20 мест на каждую из трёх магистерских программ; для сохранения — ≥54 кредитов за 2 семестра и средний балл ≥3,8.", source_url: "https://corvinus-university.dreamapply.com/news/new/50-full-tuition-scholarships-available-corvinus" },
    { id: "aubg", name: "American University in Bulgaria (AUBG) — Distinguished, AUBG Funded and Donor-Funded Scholarships", country: "Болгария", cc: "bg", levels: ["bachelor"], baseAdm: .3, baseSch: .3, req: { academics: 7, language: 6.5, budget: 3 }, deadline: "15 января", note: "Все заявители автоматически рассматриваются на merit-стипендии; полных стипендий всего 9, для них нужны высокие оценки и тесты + лидерство. Для need-based нужны финансовые документы; лучшие шансы при подаче до 15 января.", funding: "9 полных стипендий (100% tuition) AUBG Distinguished Scholarship; AUBG Funded Scholarship до 40% платы автоматически по академическим данным; донорские стипендии 2 000–4 800 EUR/год, в т.ч. «Scholarships for International Students» для Восточной Европы и Центральной Азии и Huwiler/Khamatova для студентов из Центральной Азии (по нужде).", source_url: "https://www.aubg.edu/admissions/bachelors/cost-aid/scholarships/" },
    { id: "greece_mfa_ug", name: "Hellenic Ministry of Foreign Affairs — Undergraduate Scholarships in Greece for foreign nationals", country: "Греция", cc: "gr", levels: ["bachelor"], langYear: true, baseAdm: .25, baseSch: .85, req: { academics: 6, language: 3, budget: 2 }, deadline: "8 сентября (ориентировочно)", note: "Казахстан прямо указан в списке 33 стран; подача только через посольство/консульство Греции; нужна справка о постоянном проживании за пределами Греции ≥5 лет. Обучение на греческом — сначала языковой год.", funding: "50 полных стипендий: 650 EUR/мес, освобождение от платы за обучение, бесплатные учебники, при необходимости бесплатный год изучения греческого; на весь срок бакалавриата + 2 года.", source_url: "https://www.mfa.gr/missionsabroad/en/luxembourg-en/news/undergraduate-scholarships-in-greece-offered-by-the-hellenic-ministry-of-foreign-affairs-for-the-academic-year-20252026.html" },
    { id: "vu_waiver", name: "Vilnius University — Tuition fee waivers for non-EU master's applicants + Faculty of Law special scholarship", country: "Литва", cc: "lt", levels: ["master", "bachelor"], baseAdm: .25, baseSch: .25, req: { academics: 7, language: 6.5, budget: 3 }, deadline: "1 июня (ориентировочно)", note: "Казахстан прямо назван в списке стран для юридической стипендии. Освобождения покрывают только обучение, не проживание; количество мест минимально, отбор по академическим результатам.", funding: "5 полных освобождений от платы за обучение на англо-/русскоязычных магистерских программах для выдающихся кандидатов не из ЕС; полное освобождение на BA Politics of Global Challenges и MA Eastern European and Russian Studies (IIRPS); Faculty of Law — 50–100% платы на International and European Law для граждан Казахстана и ещё 6 стран.", source_url: "https://admissions.vu.lt/all-news/study-without-financial-burden-vilnius-university-offers-a-variety-of-funding-opportunities-1" },
    { id: "vilniustech", name: "VILNIUS TECH (Vilnius Gediminas Technical University) — Tuition-free and partial (50%/25%) scholarships for international students", country: "Литва", cc: "lt", levels: ["bachelor", "master"], baseAdm: .35, baseSch: .35, req: { academics: 6.5, language: 6, budget: 3 }, deadline: "20 апреля", fields: ["eng", "it", "bus"], note: "Отдельная заявка через apply.vilniustech.lt с мотивационным письмом (1 000–4 000 знаков) и 2 академическими рекомендациями; английский B2. Инженерия, IT, архитектура, бизнес.", funding: "100% освобождение от платы за обучение на весь срок (4 года бакалавриата / 2 года магистратуры при отсутствии задолженностей) для кандидатов с ≥80% максимальной оценки; 50% или 25% — при ≥70%. Проживание не покрывается.", source_url: "https://vilniustech.lt/en/international-students/full-time-students/scholarships/" },
    { id: "ktu_waiver", name: "Kaunas University of Technology (KTU) — Full or partial tuition fee waiver for international master's applicants", country: "Литва", cc: "lt", levels: ["master"], baseAdm: .35, baseSch: .35, req: { academics: 6.5, language: 6, budget: 3 }, deadline: "1 июня", fields: ["eng", "it", "bus", "sci"], note: "Отдельная заявка не нужна — отбор из всех поступающих; результаты в середине июля. Покрывает только обучение; для полного пакета можно параллельно подать на литовскую госстипендию.", funding: "Полное или частичное освобождение от платы за обучение (плата 4 690–7 116 EUR/год) для кандидатов с сильными академическими результатами и мотивацией; все подавшие заявку рассматриваются автоматически.", source_url: "https://admissions.ktu.edu/master/" },
    { id: "tlu_waiver", name: "Tallinn University — Tuition waivers for international students (School of Governance, Law and Society; Baltic Film, Media and Arts; Humanities)", country: "Эстония", cc: "ee", levels: ["bachelor", "master"], baseAdm: .25, baseSch: .25, req: { academics: 7, language: 6.5, budget: 3 }, deadline: "15 апреля (ориентировочно)", fields: ["hum", "law", "art"], note: "Освобождения назначаются по результатам вступительных испытаний, отдельная заявка не нужна; проживание не покрывается. Для сохранения скидки нужен минимальный GPA и очная форма.", funding: "Два 100%-х освобождения от платы в год в School of Governance, Law and Society (2 лучших по рейтингу приёма); 50–100% скидка со 2-го семестра на всех программах Baltic Film, Media and Arts; по два-четыре 50%-х освобождения на Liberal Arts in Humanities и Estonian Studies; 25–50% на Educational Innovation & Leadership.", source_url: "https://www.tlu.ee/en/scholarships" },
    { id: "heydar_aliyev", name: "Heydar Aliyev International Education Grant Program (Government of Azerbaijan)", country: "Азербайджан", cc: "az", levels: ["bachelor", "master", "phd"], langYear: true, baseAdm: .18, baseSch: .9, req: { academics: 7, language: 3, budget: 0 }, deadline: "15 апреля", note: "Открыт для граждан стран ОИС и Движения неприсоединения — Казахстан член ОИС. Обязательна официальная номинация госорганами своей страны; возраст до 35 (бакалавриат), 40 (магистратура), 45 (PhD); IELTS 5.0/5.5 для англоязычных программ.", funding: "100 грантов в год: полная плата за обучение и языковой подготовительный курс, авиабилеты в Баку и обратно раз в год, стипендия 800 AZN/мес (≈470 USD, 10 мес в году), 200 AZN/год на медицину, виза и регистрация.", source_url: "https://studyinazerbaijan.edu.az/heydar-aliyev-international-education-grant-program" },
    { id: "aua_armenia", name: "American University of Armenia (AUA) — International Scholarship (merit) and Need-Based Tuition Assistance", country: "Армения", cc: "am", levels: ["bachelor", "master"], baseAdm: .3, baseSch: .3, req: { academics: 6.5, language: 6, budget: 3 }, deadline: "30 июня", note: "Нужна отдельная заявка на стипендию в Office of Financial Aid; покрывает не более половины платы, проживание не входит. Аккредитован в США (WASC), обучение на английском.", funding: "Международная merit-стипендия покрывает до 50% международной платы за обучение (по результатам вступительных тестов, заявки и эссе); дополнительно need-based tuition assistance, рассрочка и work-study до 20 ч/нед.", source_url: "https://finaid.aua.am/international-scholarships/" },
    { id: "uca_naryn", name: "University of Central Asia (UCA, Naryn / Khorog) — Undergraduate admission with guaranteed financial aid", country: "Кыргызстан", cc: "kg", levels: ["bachelor"], baseAdm: .4, baseSch: .9, req: { academics: 6, language: 5.5, budget: 2 }, deadline: "14 февраля (ориентировочно)", note: "Вуз Ага-хана для Центральной Азии (кампусы Нарын, Хорог); нужны SAT/внутренний тест и отдельная заявка на financial aid (до апреля). Полное покрытие — только при подтверждённой финансовой нужде.", funding: "Приём по заслугам без учёта платёжеспособности: «никому не отказывают по финансовым причинам, а после зачисления финансовая помощь гарантирована»; пакет по нужде покрывает плату за обучение, проживание и питание в кампусе (доля зависит от дохода семьи).", source_url: "https://admissions.ucentralasia.org/" },
    { id: "osce_academy", name: "OSCE Academy in Bishkek — MA in Politics and Security / Economic Governance and Development / Human Rights and Sustainability", country: "Кыргызстан", cc: "kg", levels: ["master"], baseAdm: .2, baseSch: .95, req: { academics: 7.5, language: 6.5, budget: 0 }, deadline: "1 апреля (ориентировочно)", fields: ["hum", "law", "bus"], note: "Только для граждан государств-участников ОБСЕ (Казахстан входит) и Афганистана; нужен IELTS 6.5 / TOEFL 90 или внутренний экзамен по английскому; работать полный день во время учёбы нельзя.", funding: "Обучение бесплатное (полный tuition waiver всем зачисленным) + ежемесячная стипендия на проживание в Бишкеке (в т.ч. 450 EUR на жильё); годичные англоязычные MA-программы.", source_url: "https://osce-academy.net/en/admission/faq/" },
    { id: "manas_kg", name: "Kyrgyz-Turkish Manas University (Кыргызско-Турецкий университет «Манас») — tuition-free study + merit stipend", country: "Кыргызстан", cc: "kg", levels: ["bachelor", "master", "phd"], langYear: true, baseAdm: .35, baseSch: .7, req: { academics: 6, language: 3, budget: 2 }, deadline: "10 июля", note: "Языки обучения — кыргызский и турецкий (без сертификата нужно сдать языковой экзамен или пройти подготовительный год); диплом должен быть признан в КР/Турции. Стипендия небольшая, но обучение полностью бесплатное.", funding: "Бесплатное обучение для всех зачисленных (включая иностранцев) + merit-стипендия: не менее 7 200 сом/мес в магистратуре и 9 600 сом/мес в докторантуре; бакалавриат — бесплатно по результатам вступительного экзамена университета.", source_url: "https://manas.edu.kg/en/news/7970" },
    { id: "yoneyama", name: "Rotary Yoneyama Memorial Scholarship (Overseas Candidates) / ロータリー米山記念奨学金", country: "Япония", cc: "jp", levels: ["bachelor", "master", "phd"], baseAdm: .12, baseSch: .12, req: { academics: 7.5, language: 5.5, budget: 3 }, deadline: "31 октября", note: "Нужен JLPT N3 или выше и уже полученное (или подтверждённое) зачисление в японский вуз; research students не подходят. Стипендиат должен прибыть в Японию до начала выплат, иначе теряет право.", funding: "100 000 JPY/мес (бакалавриат) или 140 000 JPY/мес (магистратура и докторантура), плюс до 250 000 JPY на дорогу в Японию. Обучение не покрывается.", source_url: "https://www.rotary-yoneyama.or.jp/english/overseas" },
    { id: "honjo", name: "Honjo International Scholarship Foundation — Scholarship for Foreign Students", country: "Япония", cc: "jp", levels: ["master", "phd"], baseAdm: .06, baseSch: .06, req: { academics: 8.5, language: 6, budget: 3 }, deadline: "31 октября (ориентировочно)", note: "Всего ~5 стипендий на цикл, конкурс очень высокий. Нужно уже быть зачисленным (или иметь допуск) в магистратуру/докторантуру японского вуза; требуется 2-минутное видео о своём исследовании и очное собеседование в Токио.", funding: "210 000 JPY/мес при программе 1–2 года, 190 000 JPY/мес при 3 годах, 160 000 JPY/мес при 4–5 годах; выплачивается весь срок обучения. Обучение не покрывается.", source_url: "https://www.hisf.or.jp/en/scholarship/foreigner/" },
    { id: "kyoto_iup", name: "Kyoto University International Undergraduate Program (Kyoto iUP)", country: "Япония", cc: "jp", levels: ["bachelor"], baseAdm: .15, baseSch: .85, req: { academics: 8, language: 6.5, budget: 0 }, deadline: "3 декабря", note: "Программа 6 мес. подготовки + 4 года бакалавриата; японский учится с нуля, но лекции старших курсов на японском. Все документы на английском; предварительный скрининг соответствия требованиям; отбор по документам и собеседованию.", funding: "Полное освобождение от вступительного взноса и полное/частичное освобождение от платы за обучение на 4,5 года; до 120 000 JPY/мес на 6-месячном подготовительном курсе; далее merit-стипендии от компаний-партнёров.", source_url: "https://www.iup.kyoto-u.ac.jp/apply/" },
    { id: "nagoya_g30", name: "Nagoya University Global 30 (G30) Undergraduate Scholarship", country: "Япония", cc: "jp", levels: ["bachelor"], baseAdm: .2, baseSch: .2, req: { academics: 7.5, language: 6.5, budget: 3 }, deadline: "19 ноября", note: "10 англоязычных бакалавриатов, японский не требуется при поступлении. Отдельной заявки на стипендию нет — рассматриваются все поступающие (нужно приложить форму); учитываются успеваемость, внеучебная активность и финансовая потребность.", funding: "Полное освобождение от платы за обучение на 4 года + стипендия 500 000 JPY суммарно за 4 года. Также автоматическое рассмотрение на MEXT (University Recommendation: 117 000 JPY/мес + перелёт).", source_url: "https://admissions.g30.nagoya-u.ac.jp/studentlife/scholarships/" },
    { id: "gist_ug", name: "GIST International Undergraduate Admission — Full Scholarship", country: "Корея", cc: "kr", levels: ["bachelor"], baseAdm: .2, baseSch: .95, req: { academics: 8, language: 6.5, budget: 0 }, deadline: "15 марта (ориентировочно)", fields: ["sci", "eng", "it"], note: "Только для иностранцев, оба родителя которых не корейцы. Отбор по SAT/AP/IB/ACT, аттестату и рекомендациям + опциональное телефонное интервью в мае; только STEM-направления.", funding: "Полная плата за обучение + освобождение от вступительного взноса, 530 000 KRW/мес (питание 270 000 + стипендия 130 000 + надбавка иностранцу 130 000), общежитие (двухместное), билет в одну сторону в Корею.", source_url: "https://service.gist.ac.kr/applicationGuide/Brochure%20of%20International%20Undergraduate%20Admission.pdf" },
    { id: "korea_univ_grad", name: "Korea University Graduate School — Global Leader Scholarship (Type A) и стипендии Type B/C", country: "Корея", cc: "kr", levels: ["master", "phd"], baseAdm: .3, baseSch: .3, req: { academics: 7.5, language: 6.5, budget: 3 }, deadline: "10 сентября (ориентировочно)", note: "Заявка на стипендию подаётся вместе с заявлением на поступление; нужны рекомендация кафедры и согласие декана. Для Type A — GPA ≥4.0/4.5 и TOEFL iBT 90+/IELTS 7.0+/TOPIK 6; нельзя совмещать с GKS.", funding: "Type A: 100% платы за обучение + вступительный взнос + 500 000 KRW/мес × 4 месяца; Type B (гуманитарные/социальные): 60% платы; Type C (естественные/инженерные): 65% платы. Действует на 1-й семестр, далее пересмотр по GPA.", source_url: "https://graduate2.korea.ac.kr/scholarship/scholarships.html" },
    { id: "sutd_rainmaker", name: "SUTD Rainmaker (International) Scholarship", country: "Сингапур", cc: "sg", levels: ["bachelor"], baseAdm: .15, baseSch: .15, req: { academics: 8.5, language: 6.5, budget: 0 }, deadline: "2 марта (ориентировочно)", fields: ["eng", "it"], note: "Для иностранцев и PR; нужны сильные A-level/IB/эквивалент, лидерство и общественная активность. Учтите: сама MOE Tuition Grant подразумевает обязательство отработать 3 года в сингапурской компании.", funding: "Субсидированная плата за обучение (после MOE Tuition Grant) до 4 лет + пособие S$10 000/год (S$5 000 за семестр) + до S$5 000 на зарубежную программу от 4 недель. Без бонда по стипендии.", source_url: "https://www.sutd.edu.sg/admissions/undergraduate/scholarship/sutd-administered/sutd-rainmaker-scholarship-intl/" },
    { id: "hku_ps", name: "HKU Presidential PhD Scholar Programme (HKU-PS)", country: "Гонконг", cc: "hk", levels: ["phd"], baseAdm: .08, baseSch: .08, req: { academics: 9, language: 7, budget: 0 }, deadline: "1 декабря", note: "Отдельной заявки нет — рассматриваются все поступающие на full-time PhD; шорт-лист приглашают на интервью. Рекомендуется параллельно подавать на HK PhD Fellowship Scheme; конкурс очень высокий.", funding: "Год 1 до ~HK$445 800 (далее ~HK$428 300/год): стипендия HK$28 700/мес, cash award HK$40 000 (затем HK$20 000/год), освобождение от composition fee HK$49 500/год, HK$14 400/год на поездки, гарантированное общежитие в 1-й год.", source_url: "https://gradsch.hku.hk/prospective_students/fees_scholarships_and_financial_support/hku_presidential_phd_scholar_programme" },
    { id: "griffith_vc", name: "Griffith Vice Chancellor's International Scholarship", country: "Австралия", cc: "au", levels: ["bachelor", "master"], baseAdm: .2, baseSch: .2, req: { academics: 7.5, language: 6.5, budget: 5 }, deadline: "28 ноября", note: "Сначала нужно получить Letter of Offer, затем подать заявку на стипендию с транскриптами и мотивационным письмом; порог GPA 6.0/7 (или эквивалент). Не для граждан Австралии/НЗ.", funding: "Скидка 50% с платы за обучение на весь срок программы (coursework, бакалавриат и магистратура) при сохранении GPA ≥5.5/7.", source_url: "https://www.griffith.edu.au/international/scholarships-finance/scholarships/vice-chancellors-international-scholarship" },
    { id: "otago_phd", name: "University of Otago Doctoral Scholarship", country: "Новая Зеландия", cc: "nz", levels: ["phd"], baseAdm: .25, baseSch: .25, req: { academics: 8, language: 6.5, budget: 0 }, deadline: "1 марта", note: "Открыта иностранцам (PhD-иностранцы в НЗ платят по домашней ставке); заявка через eVision вместе с заявлением в докторантуру и оценкой кафедры. Вуз сейчас пересматривает схему — проверяйте актуальные условия.", funding: "NZ$34 128/год стипендия + освобождение от платы за обучение по ставке для домашних студентов на 36 месяцев (без student services fee и страховки). До 153 стипендий в год.", source_url: "https://www.otago.ac.nz/study/scholarships/database/university-of-otago-doctoral-scholarship" },
    { id: "knight_hennessy", name: "Knight-Hennessy Scholars (Stanford University)", country: "США", cc: "us", levels: ["master", "phd"], baseAdm: .04, baseSch: .95, req: { academics: 9.5, language: 8, budget: 0 }, deadline: "6 октября", note: "Граждане всех стран. Первый бакалавр должен быть получен не ранее января 2020 (для когорты 2027). Нужно параллельно поступить в graduate-программу Stanford; крайне высокий конкурс (~1–2%).", funding: "Полное покрытие tuition и сборов на срок до 3 лет любой full-time graduate-программы Stanford (MBA, MS, PhD, JD, MD и др.) + стипендия на проживание и учебные расходы (сумма на сайте не указана) + ежегодный авиабилет + разовое пособие на переезд.", source_url: "https://knight-hennessy.stanford.edu/admission/preparing-your-applications/application-deadlines" },
    { id: "robertson", name: "Robertson Scholars Leadership Program (Duke University / UNC Chapel Hill)", country: "США", cc: "us", levels: ["bachelor"], baseAdm: .03, baseSch: .95, req: { academics: 9.5, language: 8.5, budget: 0, sat: 7 }, deadline: "15 ноября", note: "Программа прямо принимает заявки от международных абитуриентов (единая анкета для всех). Отдельная заявка в Robertson + поступление в Duke или UNC; интервью финалистов. Студент сам должен обеспечить визу.", funding: "8 семестров: полное tuition, проживание и питание, большинство обязательных сборов; финансирование до 3 летних программ; средства на конференции и 2 семестра обучения за рубежом. ~25 первокурсников в год.", source_url: "https://robertsonscholars.org/apply/high-school-students/" },
    { id: "emory_scholars", name: "Emory University Scholar Programs (Woodruff, Emory Scholars и др.)", country: "США", cc: "us", levels: ["bachelor"], baseAdm: .04, baseSch: .04, req: { academics: 9.5, language: 8.5, budget: 0, sat: 7 }, deadline: "15 ноября", note: "«Все студенты независимо от гражданства» рассматриваются. Достаточно ответить «да» на вопрос о Scholar Programs в заявке до 15 ноября; ~175–200 финалистов из ~10 000, финалисты приезжают в кампус в марте.", funding: "Merit-стипендии от частичных до полного tuition (у топ-уровня — полное tuition, проживание и питание), возобновляемые на 8 семестров.", source_url: "https://apply.emory.edu/financial-aid/scholar-program.html" },
    { id: "washu_scholars", name: "WashU Signature Scholar Programs — Annika Rodriguez Scholars / Danforth Scholars (Washington University in St. Louis)", country: "США", cc: "us", levels: ["bachelor"], baseAdm: .04, baseSch: .04, req: { academics: 9.5, language: 8.5, budget: 0, sat: 7 }, deadline: "4 января", note: "Иностранцы допускаются только к программам Rodriguez и Danforth (Ervin — только для граждан/резидентов США). Нужны короткие эссе через портал Pathway и рекомендации; финалисты — интервью в марте.", funding: "Полное tuition + стипендия либо половина tuition (жильё не покрывается), на 4 года.", source_url: "https://scholars.washu.edu/about/scholar-program-faq/" },
    { id: "vanderbilt_merit", name: "Vanderbilt Signature Merit Scholarships — Cornelius Vanderbilt / Ingram Scholars", country: "США", cc: "us", levels: ["bachelor"], baseAdm: .04, baseSch: .04, req: { academics: 9.5, language: 8.5, budget: 0, sat: 7 }, deadline: "1 декабря (ориентировочно)", note: "FAQ прямо подтверждает: «international applicants are eligible to receive any of Vanderbilt's merit scholarships». Нужна отдельная заявка на стипендию через MyAppVU после подачи Common App; для Ingram — 2 рекомендации о волонтёрстве.", funding: "Полное tuition на 4 года + разовая летняя стипендия (учёба за рубежом, исследования или сервис-проект); >225 получателей суммарно.", source_url: "https://www.vanderbilt.edu/scholarships/faq.php" },
    { id: "bu_presidential", name: "Boston University Presidential Scholarship", country: "США", cc: "us", levels: ["bachelor"], baseAdm: .1, baseSch: .1, req: { academics: 9, language: 8, budget: 6, sat: 6 }, deadline: "1 декабря", note: "Иностранные студенты прямо перечислены среди тех, кто может получить merit-стипендии; отдельной заявки нет — по обычной заявке, поданной до 1 декабря. Остальные ~50% tuition и проживание — за свой счёт.", funding: "Половина tuition (half-tuition), возобновляется до 4 лет. Прежняя Trustee Scholarship (полное tuition) на текущей официальной странице merit-стипендий больше не указана.", source_url: "https://www.bu.edu/admissions/tuition-aid/scholarships-financial-aid/first-year-merit/" },
    { id: "alabama_intl", name: "University of Alabama International Freshman Scholarships (Presidential / Presidential Elite)", country: "США", cc: "us", levels: ["bachelor"], baseAdm: .5, baseSch: .6, req: { academics: 8, language: 7, budget: 5, sat: 7 }, deadline: "4 декабря", note: "Одна из немногих «предсказуемых» схем: стипендия начисляется автоматически по баллам SAT/ACT и GPA. Требуется сдать SAT/ACT; проживание и питание не покрываются (кроме Elite — жильё 1-й год по обычной цене).", funding: "Автоматические merit-стипендии по GPA 3.5+ и тестам: Presidential (SAT 1420+/ACT 32+) — $28 000 в год; Presidential Elite (SAT 1600/ACT 36, GPA 4.0) — полное tuition до 4 лет + $1 500/год + $2 000 на исследования; UA Scholar (SAT 1360+) — $24 000/год. Суммы одинаковы для out-of-state и иностранцев.", source_url: "https://afford.ua.edu/scholarships/international/" },
    { id: "iwu_intl", name: "Illinois Wesleyan University — International Student Merit Scholarships + need-based aid", country: "США", cc: "us", levels: ["bachelor"], baseAdm: .3, baseSch: .3, req: { academics: 7.5, language: 6.5, budget: 4 }, deadline: "1 марта", note: "Автоматическое рассмотрение всех подавших заявку; полное покрытие возможно только при комбинации merit + need-based (CSS Profile). Небольшой liberal-arts колледж, точная сумма зависит от оценок и тестов.", funding: "Merit-стипендии до $38 000 в год (возобновляются 4 года) автоматически по заявке; дополнительно need-based помощь для иностранцев по CSS Profile (гранты, займы, работа в кампусе).", source_url: "https://www.iwu.edu/international/scholarships.html" },
    { id: "minerva", name: "Minerva University — Need-based Financial Aid for international students", country: "США", cc: "us", levels: ["bachelor"], baseAdm: .12, baseSch: .5, req: { academics: 8.5, language: 7.5, budget: 3 }, deadline: "8 ноября", note: "Заявку на fin. aid нужно подать ДО решения о приёме, если без помощи учиться невозможно. Формат: 4 года в 7 городах мира, стоимость заметно ниже американских вузов, но не бесплатно.", funding: "Need-based пакет независимо от гражданства: стипендии + низкопроцентные займы + work-study до ~$5 000/год. Полная стоимость 2027/28 — $31 300 (tuition $19 900 + residential $2 800 + services $5 600); full-ride не предоставляется, семья всегда вносит вклад.", source_url: "https://www.minerva.edu/tuition-aid/" },
    { id: "mccall_macbain", name: "McCall MacBain Scholarships (McGill University)", country: "Канада", cc: "ca", levels: ["master"], baseAdm: .05, baseSch: .95, req: { academics: 9, language: 7.5, budget: 0 }, deadline: "19 августа", note: "Бакалавр должен быть получен не ранее 5 лет назад (или возраст ≤30). Много этапов: заявка, региональные интервью, финальные интервью в Монреале; отдельно нужно поступить в программу McGill.", funding: "Полное tuition и сборы за всю нормативную длительность магистратуры/профессиональной программы McGill + CAD 2 300/мес в учебные семестры + грант на переезд в Монреаль + до CAD 5 000 на летние инициативы. Для иностранцев: 10 полных стипендий, 25 Finalist Awards по CAD 20 000/год (до 2 лет), 15 Regional Awards по CAD 10 000.", source_url: "https://mccallmacbainscholars.org/apply/" },
    { id: "york_intl", name: "York University — President's International Scholarship of Excellence + International Scholarship of Distinction", country: "Канада", cc: "ca", levels: ["bachelor"], baseAdm: .1, baseSch: .1, req: { academics: 9, language: 7, budget: 3 }, deadline: "27 января", note: "PISE требует академического превосходства, волонтёрства и лидерства + номинации/рекомендации школы; автоматические стипендии дают лишь частичное покрытие (~10–25% стоимости).", funding: "PISE: CAD 180 000 (CAD 45 000/год × 4). Автоматические: York International Scholarship of Distinction — CAD 37 500 суммарно при среднем ≥85%; International Merit Award — CAD 25 000 при 80–84.9%; Entrance Award — CAD 5 000 при 75–79.9%. Гарантия общежития на 4 года.", source_url: "https://futurestudents.yorku.ca/financing-your-degree/international-scholarships" },
    { id: "dal_entrance", name: "Dalhousie University — General Entrance Award Program", country: "Канада", cc: "ca", levels: ["bachelor"], baseAdm: .35, baseSch: .35, req: { academics: 7.5, language: 6.5, budget: 5 }, deadline: "15 февраля", note: "Единая заявка на все entrance awards; крупные именные награды часто с региональными ограничениями (Карибы, Индия, Ямайка) — казахстанцу реально рассчитывать на общий пул по среднему баллу. Schulich Leader и Harrison McCain — только для канадцев.", funding: "2 000+ entrance awards ежегодно от CAD 1 000 до CAD 80 000 (в год / за 4 года, часть возобновляемые до 4 лет) по успеваемости (обычно ≥80% или 26 IB), лидерству, нужде и т.д. Иностранцы eligible.", source_url: "https://www.dal.ca/admissions/money_matters/awards-financial-aid/scholarships/prospective_students.html" },
    { id: "study_in_saudi", name: "Study in Saudi Arabia — стипендии Министерства образования КСА для иностранцев (единая платформа)", country: "Саудовская Аравия", cc: "sa", levels: ["bachelor", "master", "phd"], langYear: true, baseAdm: .3, baseSch: .85, req: { academics: 6, language: 3, budget: 0 }, deadline: "6 октября (ориентировочно)", note: "Единый портал МОН КСА (studyinsaudi.sa), через который подаются заявки в KSU, IUM, KAU, UQU и др. Для арабоязычных программ обязателен подготовительный год арабского; возрастные лимиты по уровням (у KAU: магистратура ≤35, PhD ≤40).", funding: "Категории Fully Funded (полное покрытие обучения в госвузах КСА, по правилам МОН — стипендия, общежитие, билеты, медстраховка; суммы на платформе не указаны), Partially Funded и Self-Funded. Заявка в несколько вузов одновременно.", source_url: "https://studyinsaudi.sa/en" },
    { id: "ksu_intl", name: "King Saud University — International Scholarship Program (Riyadh)", country: "Саудовская Аравия", cc: "sa", levels: ["bachelor"], langYear: true, baseAdm: .3, baseSch: .85, req: { academics: 6, language: 3, budget: 0 }, deadline: "18 сентября (ориентировочно)", note: "Возраст 17–25, аттестат не старше 5 лет со средним «очень хорошо», справка о несудимости, медосмотр, не получал ранее стипендию саудовского вуза. Отбор конкурсный по квотам на страну; сначала год арабского языка.", funding: "Освобождение от tuition, общежитие и льготное питание, ежемесячная стипендия + пособие за 2 месяца при приезде, авиабилет при зачислении и ежегодные билеты, медобслуживание студента и семьи, пособие на пересылку книг после выпуска (конкретные суммы в SAR в буклете не указаны).", source_url: "https://faculty.ksu.edu.sa/sites/default/files/KSU%20Scholarship%20Flyer%20EN.pdf" },
    { id: "alfaisal", name: "Alfaisal University (Riyadh) — Merit / Need-based / Distinguished Science Scholarships", country: "Саудовская Аравия", cc: "sa", levels: ["bachelor"], baseAdm: .4, baseSch: .5, req: { academics: 7, language: 6, budget: 5 }, deadline: "28 июля", note: "Частный вуз, скидки нельзя суммировать (merit ИЛИ need-based); максимум 50% и только для College of Science. Подходит как «бюджетный» вариант, но не как полная стипендия.", funding: "Частичные скидки: merit — 20% tuition (по SAT/ACT/IB, удержание GPA 3.25); need-based — 20% (GPA 2.75); Distinguished Science (College of Science) — 50% tuition. Проживание и стипендия не покрываются.", source_url: "https://admissions.alfaisal.edu/en/scholarship" },
    { id: "aus_presidents", name: "American University of Sharjah — President's Scholarship", country: "ОАЭ", cc: "ae", levels: ["bachelor"], baseAdm: .08, baseSch: .08, req: { academics: 9, language: 7, budget: 3 }, deadline: "19 марта (ориентировочно)", note: "Только для окончивших школу ЗА ПРЕДЕЛАМИ ОАЭ (казахстанские школы подходят): средний балл 98% за 10–11 классы, IELTS 7.0 / TOEFL iBT 94. Также автоматические merit-скидки 10–20% при 95%+.", funding: "100% tuition и лабораторных сборов, ежемесячная стипендия на весь срок (сумма не указана), общежитие, 3 авиабилета туда-обратно за время учёбы, медстраховка, отмена application fee.", source_url: "https://www.aus.edu/admissions/financial-grants-and-scholarships" },
    { id: "auc_excellence", name: "The American University in Cairo (AUC) — Excellence Scholarship Program", country: "Египет", cc: "eg", levels: ["bachelor"], baseAdm: .2, baseSch: .2, req: { academics: 8, language: 6.5, budget: 3 }, deadline: "1 июня", note: "Есть отдельная категория «International Diversity» для иностранцев; 100% достижимо только при сочетании нескольких категорий и ранней подаче (до 1 марта — выше процент). Донорские стипендии с жильём и стипендией имеют свои критерии.", funding: "Суммируемые (stackable) стипендии от 20% до 100% tuition: Academic Achievement 20–60%, International Diversity 20–30%, Talents 20–30%, Leadership 20–30%, Liberal Arts 20–30%. Проживание не входит.", source_url: "https://www.aucegypt.edu/admissions/scholarships/excellence-program" },
    { id: "rotary_peace", name: "Rotary Peace Fellowship (Rotary Foundation)", country: "Международные", cc: "", levels: ["master"], baseAdm: .12, baseSch: .95, req: { academics: 7.5, language: 6.5, budget: 0 }, deadline: "31 мая", fields: ["hum", "law"], note: "Нужно ≥3 лет full-time опыта в сфере мира/развития (для сертификата — ≥5), TOEFL/IELTS, поддержка местного Rotary-дистрикта; учиться нужно вне своей страны. Члены Rotary и их дети/внуки не допускаются.", funding: "Полное покрытие tuition и сборов, проживание и питание, перелёт туда-обратно, расходы на стажировку и полевое исследование. До 50 master's-стипендий (15–24 мес. в Rotary Peace Centers: Duke/UNC, Bradford, Uppsala, ICU Tokyo, Queensland) и до 120 сертификатных (1 год).", source_url: "https://www.rotary.org/get-involved/our-programs/peace-fellowships/how-to-become-a-rotary-peace-fellow" }
  ];

  var WINDOWS = {"sh": {"md": "01-15", "open": "11-15"}, "edisu": {"md": "09-04", "open": "07-20"}, "disco": {"md": "07-22", "open": "06-10"}, "maeci": {"md": "03-26", "open": "03-01"}, "tb": {"md": "02-20", "open": "01-10"}, "de_pub": {"md": "07-15", "open": "05-01"}, "daad": {"md": "10-15", "open": "08-01"}, "cz_free": {"md": "02-28", "open": "11-01"}, "csc": {"md": "02-15", "open": "01-01"}, "anso": {"md": "01-31", "open": "10-15"}, "gks": {"md": "10-17", "open": "09-01"}, "mext": {"md": "05-29", "open": "04-20"}, "erasmus": {"md": "01-15", "open": "10-15"}, "si": {"md": "02-15", "open": "02-01"}, "us_need": {"md": "01-01", "open": "08-01"}, "kaust": {"md": "01-03", "open": "09-01"}, "mbzuai": {"md": "12-15", "open": "09-01"}, "nawa": {"md": "05-08", "open": "03-15"}, "hkphd": {"md": "12-01", "open": "09-01"}, "singa": {"md": "12-01", "open": "10-01"}, "chevening": {"md": "10-06", "open": "08-05"}, "clarendon": {"md": "01-06", "open": "09-01"}, "gates_cam": {"md": "01-06", "open": "09-01"}, "goi_ies": {"md": "03-12", "open": "01-15"}, "eth_esop": {"md": "11-30", "open": "11-01"}, "swiss_gov": {"md": "11-27", "open": "08-01"}, "eiffel": {"md": "01-08", "open": "10-01"}, "abai_verne": {"md": "05-17", "open": "03-15"}, "kuleuven_sci": {"md": "02-15", "open": "10-01"}, "tudelft_vef": {"md": "12-01", "open": "10-15"}, "nl_scholarship": {"md": "01-31", "open": "10-01"}, "dk_gov": {"md": "01-15", "open": "11-01"}, "fi_uni": {"md": "01-05", "open": "12-01"}, "ee_national": {"md": "10-15", "open": "09-01"}, "lv_state": {"md": "04-01", "open": "02-01"}, "lt_state": {"md": "04-20", "open": "03-01"}, "ro_gov": {"md": "03-31", "open": "01-15"}, "ceu": {"md": "02-02", "open": "10-15"}, "ada_az": {"md": "04-08", "open": "02-01"}, "hk_ug": {"md": "11-26", "open": "09-15"}, "macau_ug": {"md": "04-09", "open": "02-03"}, "kaist_ug": {"md": "01-14", "open": "09-01"}, "cn_provincial": {"md": "04-30", "open": "02-01"}, "cis_cn": {"md": "05-15", "open": "03-01"}, "schwarzman": {"md": "09-09", "open": "04-01"}, "yenching": {"md": "11-30", "open": "08-15"}, "ait_th": {"md": "07-15", "open": "03-01"}, "iccr_in": {"md": "04-22", "open": "02-27"}, "brunei_gov": {"md": "02-15", "open": "12-15"}, "berea": {"md": "11-30", "open": "09-01"}, "pearson_utoronto": {"md": "11-06", "open": "09-01"}, "ubc_isp": {"md": "11-15", "open": "09-01"}, "fulbright_kz": {"md": "07-15", "open": "03-01"}, "nyuad": {"md": "01-05", "open": "09-01"}, "khalifa": {"md": "03-02", "open": "12-01"}, "qatar_uni": {"md": "03-25", "open": "03-01"}, "tr_uni_merit": {"md": "04-30", "open": "01-01"}, "mext_univrec": {"md": "12-15", "open": "10-01"}, "weidenfeld": {"md": "01-06", "open": "09-01"}, "kfupm": {"md": "03-15", "open": "01-01"}, "oist_phd": {"md": "04-15", "open": "02-01"}, "epfl_excellence": {"md": "12-15", "open": "10-01"}, "boell": {"md": "03-01", "open": "01-15"}, "kas_intl": {"md": "07-15"}, "rosalux": {"md": "10-01"}, "fnf_intl": {"md": "04-30", "open": "04-01"}, "ista_phd": {"md": "01-08"}, "unige_excellence": {"md": "02-28"}, "unil_master": {"md": "11-01"}, "iheid": {"md": "01-15"}, "leiden_lexs": {"md": "12-01"}, "um_high_potential": {"md": "02-01", "open": "10-01"}, "twente_uts": {"md": "04-01"}, "master_mind": {"md": "01-15"}, "boutmy": {"md": "02-01", "open": "10-01"}, "paris_saclay": {"md": "03-31"}, "ens_intl": {"md": "12-15", "open": "10-01"}, "ampere_lyon": {"md": "01-23", "open": "11-14"}, "iyt_italy": {"md": "05-11", "open": "03-01"}, "unibo_talents": {"md": "05-30"}, "padua_excellence": {"md": "02-02", "open": "11-01"}, "topolito": {"md": "08-31"}, "inphinit": {"md": "01-28", "open": "11-01"}, "kth_scholarship": {"md": "01-15", "open": "12-01"}, "lund_global": {"md": "02-16", "open": "02-01"}, "uppsala_global": {"md": "02-02", "open": "01-16"}, "chalmers_ipoet": {"md": "01-15", "open": "11-25"}, "ki_global": {"md": "02-15", "open": "02-01"}, "imperial_phd": {"md": "01-12", "open": "10-01"}, "ucl_res": {"md": "01-09", "open": "10-01"}, "lse_gss": {"md": "04-23", "open": "10-01"}, "warwick_phd": {"md": "12-11", "open": "10-01"}, "cam_intl": {"md": "12-03", "open": "09-01"}, "edinburgh_edcs": {"md": "01-31", "open": "10-01"}, "standrews_ug": {"md": "01-27", "open": "10-01"}, "standrews_phd": {"md": "01-20", "open": "10-01"}, "ucd_global": {"md": "03-31", "open": "10-01"}, "fsv_scholars": {"md": "04-30", "open": "02-01"}, "matfyz_tuition": {"md": "04-30", "open": "01-15"}, "stars_phd": {"md": "04-30", "open": "02-19"}, "debrecen_intl": {"md": "06-15", "open": "01-16"}, "corvinus_scholarship": {"md": "05-31", "open": "11-01"}, "aubg": {"md": "01-15", "open": "09-01"}, "greece_mfa_ug": {"md": "09-08", "open": "07-01"}, "vu_waiver": {"md": "06-01", "open": "11-01"}, "vilniustech": {"md": "04-20", "open": "11-01"}, "ktu_waiver": {"md": "06-01", "open": "10-15"}, "tlu_waiver": {"md": "04-15", "open": "01-02"}, "heydar_aliyev": {"md": "04-15", "open": "02-16"}, "aua_armenia": {"md": "06-30", "open": "11-01"}, "uca_naryn": {"md": "02-14", "open": "10-01"}, "osce_academy": {"md": "04-01", "open": "01-15"}, "manas_kg": {"md": "07-10", "open": "06-01"}, "yoneyama": {"md": "10-31", "open": "10-01"}, "honjo": {"md": "10-31", "open": "09-01"}, "kyoto_iup": {"md": "12-03", "open": "11-02"}, "nagoya_g30": {"md": "11-19", "open": "11-02"}, "gist_ug": {"md": "03-15"}, "korea_univ_grad": {"md": "09-10", "open": "09-01"}, "sutd_rainmaker": {"md": "03-02", "open": "01-02"}, "hku_ps": {"md": "12-01", "open": "09-01"}, "griffith_vc": {"md": "11-28"}, "otago_phd": {"md": "03-01"}, "knight_hennessy": {"md": "10-06"}, "robertson": {"md": "11-15", "open": "08-15"}, "emory_scholars": {"md": "11-15"}, "washu_scholars": {"md": "01-04"}, "vanderbilt_merit": {"md": "12-01"}, "bu_presidential": {"md": "12-01"}, "alabama_intl": {"md": "12-04"}, "iwu_intl": {"md": "03-01"}, "minerva": {"md": "11-08"}, "mccall_macbain": {"md": "08-19", "open": "06-01"}, "york_intl": {"md": "01-27"}, "dal_entrance": {"md": "02-15", "open": "10-01"}, "study_in_saudi": {"md": "10-06", "open": "09-16"}, "ksu_intl": {"md": "09-18", "open": "08-18"}, "alfaisal": {"md": "07-28"}, "aus_presidents": {"md": "03-19", "open": "01-15"}, "auc_excellence": {"md": "06-01"}, "rotary_peace": {"md": "05-31", "open": "02-01"}};
  PROGRAMS.forEach(function (p) {
    var w = WINDOWS[p.id];
    if (w) { p.deadlineMd = p.deadlineMd || w.md; p.openMd = p.openMd || w.open; }
  });
  if (typeof PROGRAMS !== "undefined") PROGRAMS.forEach(function (p) {
    p.exam = p.exam || (p.id === "csc" ? "csca" : null);
    // ставки этих программ опёрты на публичную статистику приёма → сильный приор
    if (["sh", "tb", "gks", "csc", "mext", "daad", "chevening", "erasmus"].indexOf(p.id) !== -1) p.statNote = p.statNote || "public-stats";
  });

  /* ================================================================
     3. ВЕРОЯТНОСТИ — ЯДРО v4
     ================================================================
     Что было (v1–v3): adm = clamp(base × (1 + 0.16·Σвес·(ось−треб)), …)
     — линейный множитель, одинаковый для Оксфорда и немецкого госвуза,
     компенсирующий провал по GPA мотивацией, с обрезкой clamp'ами,
     которая и делала всю работу в хвостах.

     Что стало (v4), по вердикту совета профориентологов:
     1) ЛОГ-ОДДСЫ вместо множителя: P = E × σ(logit(base) + λ·Σβ·s(ось−треб)).
        Якорь тот же, что в v1–v3: профиль «ровно по требованиям» → base.
        Возле якоря наклон совпадает с прежним (клиенты не видят скачка),
        в хвостах кривая насыщается сама — без обрезок-обрывов.
     2) ФОРМА ОТДАЧИ s(d): ниже требования — квадратично круче вниз
        (полбалла до порога — риск, два балла — почти стена), выше —
        логарифмически с убывающей отдачей (IELTS 8.5 против 8.0 даёт
        меньше, чем 6.5 против 6.0).
     3) ТИП ОТБОРА: формульный (немецкий NC: только цифры, мотивация не
        компенсирует), конкурс на квоту (SH/TB/GKS: важно место в очереди
        из Казахстана), холистический (США/топ-вузы: эссе и достижения
        весят почти как оценки). У каждого — свои веса осей.
     4) КОГОРТА: для конкурсных программ шанс зависит от позиции
        относительно других казахстанцев. Перцентиль считается по
        распределению реальных профилей из нашей базы, смешанному с
        экспертным приором по весу n/(n+n₀) — данные растут, вес растёт.
     5) ГЕЙТЫ (некомпенсируемые): язык ниже входного порога режет
        мультипликативно (те же якоря, что v2: −2 балла → ×0.5, −3 → ×0.25,
        теперь гладко); формульный отбор с провалом GPA — почти ноль;
        US need-based без SAT — ×0.3.
     6) СТИПЕНДИЯ ДВУМЯ СТУПЕНЯМИ: P(стипендия) = P(admit) × P(sch|admit),
        якорь P(sch|admit)=baseSch/baseAdm, меритная добавка — половина
        избыточной силы профиля. Стипендия математически не может
        превышать поступление.
     ================================================================ */
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function logit(p) { p = clamp(p, 0.005, 0.995); return Math.log(p / (1 - p)); }
  function sigma(z) { return 1 / (1 + Math.exp(-z)); }

  /* Форма отдачи оси относительно требования. s(0)=0, наклон у нуля ≈ 1. */
  function shape(d) { return d >= 0 ? 2.2 * Math.log(1 + d / 2) : d * (1 - d / 8); }

  /* --- Тип отбора программы --- */
  var SEL_CONTEST = ["sh", "tb", "gks", "csc", "mext", "mext_univrec", "daad", "chevening",
    "si", "maeci", "ro_gov", "lv_state", "lt_state", "ee_national", "nawa", "nawa_banach",
    "cis_cn", "cn_provincial", "iccr_in", "brunei_gov", "abai_verne", "fulbright_kz",
    "goi_ies", "eiffel", "swiss_gov", "ada_az", "anso", "erasmus", "tr_uni_merit"];
  var SEL_FORMULA = ["de_pub", "cz_free", "edisu", "disco", "macau_ug"];
  var SEL_HOLISTIC = ["us_need", "berea", "pearson_utoronto", "ubc_isp", "schwarzman",
    "yenching", "weidenfeld", "gates_cam", "clarendon", "hk_ug", "hkphd", "singa",
    "oist_phd", "epfl_excellence", "kaust", "mbzuai", "khalifa", "kfupm", "tudelft_vef",
    "ceu", "kuleuven_sci", "eth_esop", "qatar_uni", "ait_th"];
  function selType(prog) {
    if (prog.selType) return prog.selType; // когда появится в каталоге — каталог главнее
    if (SEL_FORMULA.indexOf(prog.id) !== -1) return "formula";
    if (SEL_HOLISTIC.indexOf(prog.id) !== -1) return "holistic";
    if (SEL_CONTEST.indexOf(prog.id) !== -1) return "contest";
    // эвристика для строк каталога без явной метки (x-*): госстипендии с полным
    // покрытием — конкурс на квоту; бесплатное обучение без стипендии — формула;
    // остальное — холистический вузовский отбор
    if (prog.baseSch == null) return "formula";
    if ((prog.req.budget || 0) === 0 && prog.baseSch >= 0.1) return "contest";
    return "holistic";
  }

  /* Веса осей по типу отбора (в единицах формы на логит) + вес когорты. */
  var SEL_W = {
    formula:  { academics: 0.55, language: 0.45, achievements: 0.04, motivation: 0.02, sat: 0.30, cohort: 0 },
    contest:  { academics: 0.34, language: 0.30, achievements: 0.14, motivation: 0.10, sat: 0.18, cohort: 0.25 },
    holistic: { academics: 0.30, language: 0.26, achievements: 0.22, motivation: 0.16, sat: 0.22, cohort: 0 }
  };
  var LAMBDA = 0.72; // глобальный масштаб: чувствительность у якоря ≈ прежним 0.16·base на взвешенную ось

  /* --- Когорта: где профиль стоит среди казахстанских абитуриентов ---
     Эмпирические децили композита посчитаны по УНИКАЛЬНЫМ профилям из нашей
     базы лидов (повторные тестовые прогоны схлопнуты — иначе пул был бы
     завышен) и смешаны с экспертным приором по весу n/(n+n₀). С ростом базы
     каждый деплой обновляет emp — вес данных растёт сам. */
  var COHORT = {
    asOf: "2026-09-03", n0: 60,
    emp: {
      bachelor: { n: 13, q: [6.47, 6.59, 6.74, 7.00, 7.08, 8.29, 8.53, 8.53, 8.61] },
      master:   { n: 3,  q: [4.98, 5.23, 5.48, 5.73, 5.98, 6.16, 6.35, 6.53, 6.72] },
      phd:      { n: 0,  q: null }
    },
    prior: {
      bachelor: [3.9, 4.5, 4.9, 5.3, 5.6, 5.9, 6.3, 6.7, 7.3],
      master:   [4.2, 4.8, 5.2, 5.5, 5.8, 6.1, 6.5, 6.9, 7.4],
      phd:      [4.4, 5.0, 5.4, 5.7, 6.0, 6.3, 6.7, 7.1, 7.6]
    }
  };
  function compositeOf(ax) {
    return 0.5 * ax.academics + 0.35 * ax.language + 0.10 * ax.achievements + 0.05 * ax.motivation;
  }
  function cohortQuantiles(level) {
    var lvl = COHORT.prior[level] ? level : "bachelor";
    var emp = COHORT.emp[lvl], prior = COHORT.prior[lvl];
    if (!emp || !emp.q || !emp.n) return prior;
    var w = emp.n / (emp.n + COHORT.n0);
    return prior.map(function (pv, i) { return (1 - w) * pv + w * emp.q[i]; });
  }
  // композит → перцентиль (0.02..0.98) линейной интерполяцией по децилям
  function percentileOf(C, q) {
    if (C <= q[0]) return clamp(0.02 + 0.08 * (C - (q[0] - 2)) / 2, 0.02, 0.1);
    if (C >= q[8]) return clamp(0.9 + 0.08 * (C - q[8]) / 2, 0.9, 0.98);
    for (var i = 0; i < 8; i++) {
      if (C <= q[i + 1]) {
        var span = q[i + 1] - q[i];
        var t = span > 1e-9 ? (C - q[i]) / span : 1;
        return 0.1 * (i + 1) + 0.1 * t;
      }
    }
    return 0.9;
  }

  /* Сохраняем публичную сигнатуру: «взвешенное отклонение от требований».
     Теперь это Σβ·s(ось−треб) в единицах формы (для бустеров и отладки). */
  function fitDelta(profile, prog) {
    var ax = profile.axes, w = SEL_W[selType(prog)];
    var d = w.academics * shape(ax.academics - prog.req.academics)
          + w.language * shape(ax.language - prog.req.language)
          + w.achievements * shape(ax.achievements - 5)
          + w.motivation * shape(ax.motivation - 5);
    if (prog.req.sat != null) d += w.sat * shape(profile.sat - prog.req.sat);
    return d;
  }

  function probabilities(profile, prog) {
    var type = selType(prog);
    var ax = profile.axes;

    /* 1) Конкурентный балл в лог-оддсах, якорь — базовая ставка программы. */
    var z = logit(prog.baseAdm) + LAMBDA * fitDelta(profile, prog);

    /* 2) Конкурс на квоту: добавка за место в казахстанской когорте.
       Центрируем по перцентилю «профиля ровно по требованиям» — якорь
       base не сдвигается, добавка меряет именно превосходство над
       типичным проходным. */
    if (type === "contest") {
      var q = cohortQuantiles(profile.level);
      var piMe = percentileOf(compositeOf(ax), q);
      var piRef = percentileOf(
        0.5 * prog.req.academics + 0.35 * prog.req.language + 0.10 * 5 + 0.05 * 5, q);
      // клэмп ±1.5 логита: когорта — поправка, а не главный фактор
      z += SEL_W.contest.cohort * clamp(logit(piMe) - logit(piRef), -1.5, 1.5);
    }

    /* 3) Гейты — то, что не компенсируется ничем. */
    var E = 1;
    // язык: без нужного уровня заявку не примут; программам с годом языка — поблажка 2.5
    var gap = (prog.req.language || 0) - ax.language - (prog.langYear ? 2.5 : 0);
    if (gap > 1) E *= Math.pow(0.5, gap - 1); // gap 2 → ×0.5, 3 → ×0.25 (как v2, но гладко)
    // формульный отбор: GPA ниже порога — стена, эссе не поможет
    if (type === "formula") {
      var da = ax.academics - prog.req.academics;
      if (da < -1) E *= Math.pow(0.3, Math.min(3, -da - 1));
    }
    // need-based США и т.п.: подача без SAT почти всегда мертва (test-optional — редкость)
    if (prog.req.sat != null && (profile.sat || 0) <= 0) E *= 0.3;

    var adm = clamp(E * sigma(z), 0.02, 0.95);

    /* 4) Стипендия — второй этап: P(sch|admit), якорь baseSch/baseAdm,
       меритная добавка — 45% избыточной силы сверх якоря. */
    var sch = null;
    if (prog.baseSch != null) {
      var r0 = clamp(prog.baseSch / Math.max(prog.baseAdm, 0.01), 0.03, 0.97);
      var zx = z - logit(prog.baseAdm); // избыток конкурентности сверх якоря
      sch = clamp(adm * sigma(logit(r0) + 0.45 * zx), 0.01, 0.9);
      if (sch > adm) sch = adm;
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

  /* ---------- 8. УВЕРЕННОСТЬ (v4: полнота данных + сила приоров) ---------- */
  /* Ширина интервала складывается из двух честных источников:
     1) полнота профиля — каждый неотвеченный ключевой вопрос расширяет;
     2) сила приоров портфеля — программы, чья базовая ставка опёрта на
        публичную статистику (stat_note в каталоге), несут эффективное
        n≈200; чисто экспертные оценки — n≈25. Ширина ~ бином. ошибке
        √(p(1−p)/n_eff): портфель из статистически обоснованных программ
        даёт более узкий интервал, чем портфель из экспертных догадок. */
  function confidenceFor(a, pAny, portfolio) {
    var keys = ["level", "lang_status", "field", "achievements", "budget", "priority"];
    keys.push(a.level === "master" ? "gpa_uni" : (a.level === "phd" ? "gpa_phd" : "gpa_band"));
    if (a.lang_status === "have" || a.lang_status === "soon") keys.push("ielts_band");
    var have = 0;
    keys.forEach(function (k) { var v = a[k]; if (v != null && v !== "" && !(Array.isArray(v) && !v.length) && v !== "unknown") have++; });
    var completeness = have / keys.length;
    if (a.p2_gpa_exact) completeness = Math.min(1, completeness + 0.08);
    if (a.p2_ielts_date) completeness = Math.min(1, completeness + 0.04);
    if (a.p2_docs_ready) completeness = Math.min(1, completeness + 0.03);

    var nEff = 25;
    if (portfolio && portfolio.length) {
      var s = 0;
      portfolio.forEach(function (p) { s += (p.statNote ? 200 : 25); });
      nEff = s / portfolio.length;
    }
    var priorW = 1.28 * Math.sqrt(Math.max(0.04, pAny * (1 - pAny)) / nEff);
    var width = 0.05 + 0.08 * (1 - completeness) + priorW;
    return {
      completeness: Math.round(completeness * 100) / 100,
      nEff: Math.round(nEff),
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

    var confidence = confidenceFor(a, pAny, portfolio);

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
      pAtLeastOneAtDeadline: pAnyDl,   // без округления: инвариант «к дедлайну не хуже» точный
      confidence: confidence,
      plan: plan,
      programsCount: portfolio.length,
      topCountry: portfolio.length ? portfolio[0].country : "—",
      strongest: axisNames[sorted[0]],
      weakest: axisNames[sorted[sorted.length - 1]],
      verdict: verdict,
      boosters: boosters(profile, a),
      engineVersion: 4,
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
      statNote: r.statNote || r.stat_note || null,
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
    var CK = "scholary_catalog_v4";
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
    VERSION: 4,
    get PROGRAMS() { return PROGRAMS; },
    get BUILTIN() { return BUILTIN; }
  };
  // автозагрузка каталога в браузере: страницы могут ждать ScholaryEngine.ready
  if (typeof window !== "undefined" && window.SCHOLARY_CONFIG) {
    api.ready = initCatalog(window.SCHOLARY_CONFIG);
  }
  return api;
});
