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
    { id: "cz_free", name: "Чехия: гос. вузы на чешском (0 ₸)", country: "Чехия", cc: "cz", levels: ["bachelor", "master"], langYear: true, baseAdm: .55, baseSch: null, req: { academics: 5, language: 3, budget: 4 }, deadline: "28 февраля", note: "дату ставит сам вуз: обычно февраль–апрель на сентябрьский набор", funding: "обучение бесплатно, если учишься на чешском; жильё и сборы — свои", source_url: "https://studyin.gov.cz/plan-your-studies/learn-czech-study-tuition-free/" },
    { id: "csc", name: "CSC (гранты Китая)", country: "Китай", cc: "cn", levels: ["bachelor", "master", "phd"], langYear: true, baseAdm: .45, baseSch: .4, req: { academics: 5.5, language: 4, budget: 0 }, deadline: "15 февраля", note: "точную дату ставит посольство КНР или вуз — обычно январь–февраль, уточни", funding: "обучение 0 ₸ + общежитие + 2 500–3 500 CNY/мес + медстраховка", source_url: "https://www.campuschina.org/" },
    { id: "anso", name: "ANSO (Академия наук КНР)", country: "Китай", cc: "cn", levels: ["master", "phd"], baseAdm: .35, baseSch: .35, req: { academics: 7, language: 6, budget: 0 }, deadline: "31 января", note: "приём открывается в середине октября", funding: "обучение 0 ₸ + 3 000 CNY/мес (магистратура), 6 000–7 000 (PhD) + перелёт", source_url: "https://www.anso.org.cn/programmes/talent/scholarship/" },
    { id: "gks", name: "GKS (Корея)", country: "Корея", cc: "kr", levels: ["bachelor", "master", "phd"], langYear: true, baseAdm: .25, baseSch: .25, req: { academics: 7.5, language: 5, budget: 0 }, deadline: "17 октября", note: "бакалавриат (GKS-U) подаётся до середины октября, магистратура (GKS-G) — в феврале", funding: "обучение + перелёт + год корейского + 1,14–1,38 млн KRW/мес", source_url: "https://www.studyinkorea.go.kr/in/plan/scholarship.do" },
    { id: "mext", name: "MEXT (Япония)", country: "Япония", cc: "jp", levels: ["bachelor", "master", "phd"], langYear: true, baseAdm: .22, baseSch: .22, req: { academics: 7.5, language: 5.5, budget: 0 }, deadline: "29 мая", note: "для Казахстана дату ставит посольство Японии в Астане — сверяйся с их объявлением", funding: "обучение 0 ₸ + 117 000 ¥/мес + авиабилеты в обе стороны", source_url: "https://www.studyinjapan.go.jp/en/planning/scholarship/" },
    { id: "erasmus", name: "Erasmus Mundus", country: "ЕС", cc: "eu", levels: ["master"], baseAdm: .28, baseSch: .28, req: { academics: 7, language: 6.5, budget: 0 }, deadline: "окт–янв", note: "единого дедлайна нет: дату ставит консорциум программы, обычно октябрь–январь", funding: "обучение бесплатно + 1 400 €/мес на жизнь, переезд и визу (до 33 600 € за 2 года)", source_url: "https://www.eacea.ec.europa.eu/scholarships/erasmus-mundus-catalogue_en" },
    { id: "si", name: "SI Global Professionals (Швеция)", country: "Швеция", cc: "se", levels: ["master"], baseAdm: .18, baseSch: .18, req: { academics: 7.5, language: 7, budget: 0 }, deadline: "февраль", note: "Казахстана нет в списке стран программы — подать нельзя", funding: "обучение 0 kr + 12 000 SEK в месяц + 15 000 SEK на перелёт", source_url: "https://si.se/en/apply/scholarships/swedish-institute-scholarships-for-global-professionals/", availableKz: false },
    { id: "us_need", name: "Need-based aid (США, топ-вузы)", country: "США", cc: "us", levels: ["bachelor"], baseAdm: .1, baseSch: .55, req: { academics: 9, language: 8.5, budget: 0, sat: 7 }, deadline: "1 января", note: "это не стипендия, а помощь по доходу семьи; Harvard, Yale и MIT смотрят заявку без оглядки на деньги", funding: "доход семьи до 100 000 $ — учёба и жизнь бесплатно; до 200 000 $ — бесплатное обучение", source_url: "https://college.harvard.edu/financial-aid" },
    { id: "kaust", name: "KAUST (Сауд. Аравия)", country: "Сауд. Аравия", cc: "sa", levels: ["master", "phd"], baseAdm: .3, baseSch: .95, req: { academics: 7.5, language: 6.5, budget: 0 }, deadline: "3 января", note: "для осеннего набора один раунд; финансирование оформляют уже принятым, бывают интервью", funding: "обучение 0 $ + стипендия 20 000–30 000 $ в год + жильё, страховка и перелёт", source_url: "https://admissions.kaust.edu.sa/fees-funding" },
    { id: "mbzuai", name: "MBZUAI (ОАЭ, AI)", country: "ОАЭ", cc: "ae", levels: ["master", "phd"], baseAdm: .3, baseSch: .95, req: { academics: 7.5, language: 6.5, budget: 0 }, deadline: "15 декабря", note: "сумму стипендии вуз не публикует; решения приходят к концу марта", fields: ["it", "eng"], funding: "обучение 0 + ежемесячная стипендия + жильё в кампусе, страховка и перелёт домой", source_url: "https://mbzuai.ac.ae/study/graduate-admission-process/" },
    { id: "nawa", name: "NAWA Banach (Польша)", country: "Польша", cc: "pl", levels: ["master"], baseAdm: .35, baseSch: .35, req: { academics: 6, language: 5.5, budget: 0 }, deadline: "8 мая", note: "Казахстан в списке стран; набор закрывается досрочно, когда кончается квота заявок", funding: "обучение 0 zł в госвузах + 2 500 zł в месяц + бесплатный курс польского", source_url: "https://nawa.gov.pl/en/students/foreign-students/the-banach-scholarship-programme/landing" },
    { id: "hkphd", name: "Hong Kong PhD Fellowship", country: "Гонконг", cc: "hk", levels: ["phd"], baseAdm: .2, baseSch: .2, req: { academics: 8, language: 7, budget: 0 }, deadline: "1 декабря", note: "подача в RGC до 12:00 по Гонконгу и отдельно в сам вуз; максимум две программы", funding: "стипендия 344 400 HK$ в год + 14 400 HK$ на конференции, до 3 лет", source_url: "https://cerg1.ugc.edu.hk/hkpfs/index.html" },
    { id: "singa", name: "SINGA (Сингапур)", country: "Сингапур", cc: "sg", levels: ["phd"], baseAdm: .22, baseSch: .22, req: { academics: 8, language: 6.5, budget: 0 }, deadline: "1 июня / 1 дек", note: "программа снята с публикации у A*STAR — приём приостановлен, следи за их сайтом", funding: "обучение + ежемесячная стипендия + перелёт и подъёмные", source_url: "https://www.a-star.edu.sg/scholarships/home/international-awards", availableKz: false }
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

    var portfolio = list.slice(0, 9);
    portfolio.forEach(function (p) { p.tier = p.p.adm >= 0.5 ? "anchor" : "ambitious"; });
    // якорные вперёд
    portfolio.sort(function (x, y) { return (y.tier === "anchor") - (x.tier === "anchor") || y.score - x.score; });
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
