/* ============================================================
   Scholary · Правила документов и проверок (клиентский слой)
   ------------------------------------------------------------
   Здесь живёт ДЕТЕРМИНИРОВАННАЯ часть «ИИ-проверки»: какие документы
   нужны программе, что с ними не так и как их довести до готовности.
   Она работает всегда — без сети к модели, мгновенно и воспроизводимо.

   Когда включим Edge Function с ключом модели (SCHOLARY_CONFIG.AI_CHECK_URL),
   поверх этих правил добавится слой распознавания файла и формулировок —
   контракт вердикта один и тот же, поэтому UI менять не придётся.

   ВАЖНО: сроки и требования — ориентировочные, у каждого вердикта есть
   источник и оговорка. Мы не выдаём это за юридическую консультацию.
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ScholaryDocs = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- типы документов ---------- */
  var TYPES = {
    diploma:       { title: "Диплом / аттестат + транскрипт", ic: "🎓", lead: 3,  hint: "нужен всем программам" },
    translation:   { title: "Нотариальный перевод (англ.)",   ic: "📑", lead: 7,  hint: "переводим ПОСЛЕ апостиля" },
    apostille:     { title: "Апостиль на документ об образовании", ic: "📜", lead: 28, hint: "до 20 рабочих дней · ЦОН / egov" },
    ielts:         { title: "Сертификат языка (IELTS / TOEFL)", ic: "🗣", lead: 21, hint: "действует 2 года" },
    passport:      { title: "Загранпаспорт",                  ic: "🛂", lead: 21, hint: "должен действовать весь срок учёбы" },
    motivation:    { title: "Мотивационное письмо",           ic: "✍️", lead: 10, hint: "пишется под конкретную программу", perProgram: true },
    recommendation:{ title: "Рекомендательные письма ×2",     ic: "📮", lead: 21, hint: "преподаватели пишут медленно — проси заранее" },
    cv:            { title: "CV / резюме",                    ic: "📋", lead: 3,  hint: "академический формат, 1–2 страницы" },
    medical:       { title: "Медицинская справка",            ic: "🏥", lead: 10, hint: "у части программ — с апостилем" },
    income:        { title: "Справка о доходах семьи",        ic: "💶", lead: 10, hint: "гранты по доходу считают по ней" },
    research:      { title: "Исследовательское предложение",  ic: "🔬", lead: 21, hint: "для PhD — ключевой документ" },
    photo:         { title: "Фото по требованиям программы",  ic: "🖼", lead: 1,  hint: "обычно 3.5×4.5, белый фон" },
    finance:       { title: "Подтверждение финансов / блок-счёт", ic: "🏦", lead: 21, hint: "Германия: Sperrkonto для визы" }
  };

  /* Зависимости: что нельзя начинать раньше, чем готово другое.
     Перевод строго ПОСЛЕ апостиля — иначе апостиль не попадёт в перевод
     и перевод придётся заказывать и оплачивать заново. Это самая частая
     и самая дорогая ошибка в сборе документов. */
  var AFTER = { translation: "apostille" };

  /* Документы, которые не требует ни одна подача, но которые заметно
     усиливают заявку. Показываем отдельным блоком, чтобы не путать
     с обязательными. */
  var NICE_TO_HAVE = {
    cv:             "Академическое CV усиливает почти любую заявку — и его просят на интервью",
    recommendation: "Даже там, где рекомендации не обязательны, они выделяют заявку",
    research:       "Набросок исследовательских интересов помогает на магистратуре с наукой"
  };

  /* Буфер между готовностью документа и дедлайном: неделя на форс-мажор
     (переделка, курьер, ошибка в имени). Без буфера план врёт. */
  var BUFFER = 7;

  /* страны, где для документов об образовании обычно нужен апостиль */
  var APOSTILLE = ["hu","it","de","cz","pl","nl","fr","es","pt","gr","ee","lv","lt","ro","sk","si","hr","tr","kr","jp","us","uk","ie","fi","se","no","dk","at","be","ch","lu"];
  /* страны, где чаще требуют консульскую легализацию, а не апостиль */
  var LEGALIZATION = ["cn","ae","qa","sa","eg"];
  /* программы/страны, где обычно нужна медсправка */
  var MEDICAL = ["hu","cn","kr","tr","jp","ae","qa"];
  /* гранты, считающие поддержку по доходу семьи */
  var INCOME = ["it","es","pt"];

  function has(arr, v) { return (arr || []).indexOf(v) !== -1; }
  function lvlOf(ans) { return (ans && ans.level) === "master" || (ans && ans.level) === "phd" ? ans.level : "bachelor"; }

  /* ось языка (0–10) → минимальный балл IELTS */
  function ieltsFromAxis(axis) {
    if (axis == null) return null;
    if (axis >= 8.5) return 7.0;
    if (axis >= 7.0) return 6.5;
    if (axis >= 5.5) return 6.0;
    if (axis >= 4.0) return 5.5;
    return null;
  }

  /* ---------- какие документы нужны программе ---------- */
  function requiredFor(prog, ans) {
    if (!prog) return [];
    if (prog.docs && prog.docs.length) {               // если у программы список задан в базе — он главнее правил
      return prog.docs.map(function (t) { return { t: t, why: "указано в требованиях программы", source: "db" }; })
        .filter(function (d) { return TYPES[d.t]; });
    }
    var cc = (prog.cc || "").toLowerCase(), lvl = lvlOf(ans), out = [];
    var need = ieltsFromAxis(prog.req && prog.req.language);

    out.push({ t: "diploma", why: lvl === "bachelor" ? "аттестат и приложение с оценками" : "диплом и транскрипт" });
    out.push({ t: "passport", why: "загранпаспорт нужен для заявки и визы" });
    if (has(APOSTILLE, cc)) out.push({ t: "apostille", why: (prog.country || "страна") + " принимает документы с апостилем" });
    else if (has(LEGALIZATION, cc)) out.push({ t: "apostille", why: (prog.country || "Эта страна") + ": нужна консульская легализация — уточни в посольстве" });
    out.push({ t: "translation", why: "документы подаются на английском" });
    if (need) out.push({ t: "ielts", why: "порог программы ≈ IELTS " + need.toFixed(1) });
    out.push({ t: "motivation", why: "мотивационное под эту программу" });
    if (lvl !== "bachelor" || (prog.funding || "").indexOf("стипенд") !== -1) out.push({ t: "recommendation", why: "стипендиальные и магистерские программы почти всегда просят 2 рекомендации" });
    if (lvl !== "bachelor") out.push({ t: "cv", why: "академическое CV" });
    if (lvl === "phd") out.push({ t: "research", why: "исследовательское предложение — основа отбора на PhD" });
    if (has(MEDICAL, cc)) out.push({ t: "medical", why: "медицинская справка по требованиям программы" });
    if (has(INCOME, cc)) out.push({ t: "income", why: "размер гранта считается по доходу семьи" });
    out.push({ t: "photo", why: "фото по формату программы" });
    if (cc === "de") out.push({ t: "finance", why: "для визы Германии нужен блокированный счёт" });
    return out;
  }

  /* ---------- готовность подачи ---------- */
  function readiness(app, docs, ans, prog) {
    var req = requiredFor(prog, ans);
    var ck = app.checklist || {};
    var done = 0, missing = [];
    req.forEach(function (r) {
      var byDoc = (docs || []).some(function (d) {
        return d.doc_type === r.t && d.status === "ready" &&
          (!d.program_ids || !d.program_ids.length || has(d.program_ids, app.program_id));
      });
      if (ck[r.t] === true || byDoc) done++; else missing.push(r);
    });
    return { pct: req.length ? Math.round(done / req.length * 100) : 0, done: done, total: req.length, missing: missing, required: req };
  }

  /* ---------- критический путь: что начинать сегодня ----------
     Документ нельзя «сделать к дедлайну»: у каждого свой срок изготовления.
     Дата старта = ближайший дедлайн − срок изготовления − буфер.
     Для документа с зависимостью (перевод после апостиля) складываем сроки
     всей цепочки, иначе план обещает невозможное.

     apps: [{program_id, prog, deadline:Date, title}] — из кабинета
     docs: строки user_documents
     Возвращает по каждому типу документа полную картину для UI. */
  function docPlan(apps, docs, ans) {
    apps = (apps || []).filter(function (a) { return a && a.prog; });
    docs = docs || [];
    var today = new Date(); today.setHours(0, 0, 0, 0);

    /* какие типы вообще нужны — объединение требований всех подач */
    var need = {};          // t -> [{app, why}]
    apps.forEach(function (a) {
      requiredFor(a.prog, ans).forEach(function (r) {
        if (!TYPES[r.t]) return;
        (need[r.t] = need[r.t] || []).push({ app: a, why: r.why });
      });
    });

    function docOf(t, programId) {
      var list = docs.filter(function (d) { return d.doc_type === t; });
      var exact = list.filter(function (d) { return has(d.program_ids || [], programId); });
      return exact[0] || list.filter(function (d) { return !(d.program_ids || []).length; })[0] || list[0] || null;
    }
    function isReady(t, programId) {
      var d = docOf(t, programId);
      return !!(d && d.status === "ready");
    }

    var out = [];
    Object.keys(need).forEach(function (t) {
      var T = TYPES[t], uses = need[t];
      var d = docOf(t, uses[0].app.program_id);
      var status = d ? d.status : "none";

      /* ближайший дедлайн среди подач, которым этот документ нужен */
      var dls = uses.map(function (u) { return u.app.deadline; }).filter(Boolean).sort(function (a, b) { return a - b; });
      var nearest = dls[0] || null;

      /* цепочка: если есть незакрытая зависимость — её срок прибавляется */
      var dep = AFTER[t] || null;
      var depOpen = dep && !isReady(dep, uses[0].app.program_id);
      var chainLead = (T.lead || 7) + (depOpen ? (TYPES[dep] ? TYPES[dep].lead : 0) : 0);

      var startBy = nearest ? new Date(nearest.getTime() - (chainLead + BUFFER) * 864e5) : null;
      var daysToStart = startBy ? Math.round((startBy - today) / 864e5) : null;

      var urgency;
      if (status === "ready") urgency = "done";
      else if (daysToStart == null) urgency = "later";
      else if (daysToStart < 0) urgency = "overdue";
      else if (daysToStart <= 14) urgency = "now";
      else if (daysToStart <= 45) urgency = "soon";
      else urgency = "later";

      out.push({
        t: t, T: T, required: true, doc: d, status: status,
        uses: uses, usesCount: uses.length,
        why: uses[0].why,
        nearest: nearest, nearestTitle: (uses.filter(function (u) { return u.app.deadline === nearest; })[0] || uses[0]).app.title,
        lead: T.lead || 7, chainLead: chainLead,
        blockedBy: depOpen ? dep : null,
        startBy: startBy, daysToStart: daysToStart, urgency: urgency
      });
    });

    /* дополнительные — не требует никто, но помогают */
    Object.keys(NICE_TO_HAVE).forEach(function (t) {
      if (need[t] || !TYPES[t]) return;
      var d = docOf(t, null);
      out.push({
        t: t, T: TYPES[t], required: false, doc: d, status: d ? d.status : "none",
        uses: [], usesCount: 0, why: NICE_TO_HAVE[t],
        nearest: null, nearestTitle: "", lead: TYPES[t].lead || 7, chainLead: TYPES[t].lead || 7,
        blockedBy: null, startBy: null, daysToStart: null,
        urgency: (d && d.status === "ready") ? "done" : "optional"
      });
    });

    var ORDER = { overdue: 0, now: 1, soon: 2, later: 3, optional: 4, done: 5 };
    out.sort(function (a, b) {
      if (ORDER[a.urgency] !== ORDER[b.urgency]) return ORDER[a.urgency] - ORDER[b.urgency];
      if (a.daysToStart != null && b.daysToStart != null) return a.daysToStart - b.daysToStart;
      return (b.usesCount || 0) - (a.usesCount || 0);
    });
    return out;
  }

  /* Сводка по плану — то, что человек должен понять за две секунды. */
  function planSummary(plan) {
    var req = plan.filter(function (p) { return p.required; });
    var s = {
      required: req.length,
      ready: req.filter(function (p) { return p.status === "ready"; }).length,
      progress: req.filter(function (p) { return p.status === "progress"; }).length,
      none: req.filter(function (p) { return p.status === "none"; }).length,
      overdue: req.filter(function (p) { return p.urgency === "overdue"; }).length,
      now: req.filter(function (p) { return p.urgency === "now"; }).length,
      optional: plan.filter(function (p) { return !p.required; }).length
    };
    s.pct = s.required ? Math.round(s.ready / s.required * 100) : 0;
    return s;
  }

  /* ---------- вспомогательное ---------- */
  function parseDate(s) {
    if (!s) return null;
    var d = new Date(s);
    return isNaN(d) ? null : d;
  }
  function daysBetween(a, b) { return Math.round((a - b) / 864e5); }
  function fmt(d) { return d ? d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }) : ""; }

  /* ---------- проверка документа против всех подач ---------- */
  /* apps: [{program_id, prog, deadline:Date}] — уже с датами; ans — анкета */
  function checkDocument(doc, apps, ans, profile) {
    var v = [], t = doc.doc_type, f = doc.fields || {};
    var linked = (apps || []).filter(function (a) {
      return !doc.program_ids || !doc.program_ids.length || has(doc.program_ids, a.program_id);
    });

    if (t === "ielts") {
      var band = parseFloat(f.band);
      var issued = parseDate(f.issued_on);
      var expires = parseDate(doc.expires_on) || (issued ? new Date(issued.getTime() + 730 * 864e5) : null);
      var lowFor = [], expFor = [], okN = 0;
      linked.forEach(function (a) {
        var need = ieltsFromAxis(a.prog && a.prog.req && a.prog.req.language);
        var bad = false;
        if (need && band && band + 1e-9 < need) { lowFor.push({ a: a, need: need }); bad = true; }
        if (expires && a.deadline && expires < a.deadline) { expFor.push({ a: a, exp: expires }); bad = true; }
        if (!bad) okN++;
      });
      lowFor.forEach(function (x) {
        v.push({ level: "blocker", title: x.a.title + ": нужен балл " + x.need.toFixed(1) + " — у тебя " + (band ? band.toFixed(1) : "не указан"),
          text: "Подача возможна после пересдачи. Разница " + (band ? (x.need - band).toFixed(1) : "?") + " балла — это обычно один заход.",
          action: { label: "Добавить пересдачу в план", kind: "plan", doc: "ielts" }, source: x.a.prog && x.a.prog.source_url });
      });
      expFor.forEach(function (x) {
        v.push({ level: "warn", title: x.a.title + ": сертификат истекает до дедлайна",
          text: "Действует до " + fmt(x.exp) + ", а подача — " + fmt(x.a.deadline) + ". Большинство программ требует действующий сертификат на дату подачи: пересдай заранее.",
          source: x.a.prog && x.a.prog.source_url });
      });
      if (okN) v.push({ level: "ok", title: okN + " " + plural(okN, "подача", "подачи", "подач") + ": порог пройден", text: "Балл выше требований и срок действия покрывает дедлайн." });
      if (!band) v.push({ level: "warn", title: "Не указан балл", text: "Впиши балл — без него мы не сверим сертификат с порогами программ.", action: { label: "Указать балл", kind: "fields" } });
    }

    if (t === "diploma") {
      var gpaAx = profile && profile.axes ? profile.axes.academics : null;
      var low = [], okA = 0;
      linked.forEach(function (a) {
        var need = a.prog && a.prog.req ? a.prog.req.academics : null;
        if (need != null && gpaAx != null && gpaAx + 1e-9 < need) low.push(a); else okA++;
      });
      low.forEach(function (a) {
        v.push({ level: "warn", title: a.title + ": академика ниже типичного порога",
          text: "Это не запрет на подачу: слабую академику компенсируют мотивационное, проект и рекомендации. Но шанс модель снижает честно.",
          source: a.prog && a.prog.source_url });
      });
      if (okA) v.push({ level: "ok", title: okA + " " + plural(okA, "подача", "подачи", "подач") + ": порог по оценкам пройден", text: "Средний балл соответствует требованиям." });
      var needAp = linked.filter(function (a) { return has(APOSTILLE.concat(LEGALIZATION), (a.prog && a.prog.cc || "").toLowerCase()); });
      if (needAp.length) v.push({ level: "warn", title: "Нужен апостиль на диплом · " + needAp.length + " " + plural(needAp.length, "подача", "подачи", "подач"),
        text: "Апостиль делается до 20 рабочих дней (≈4 недели). Порядок: нотариальная копия → апостиль → перевод → заверение перевода. Перевод строго ПОСЛЕ апостиля, иначе придётся делать заново.",
        action: { label: "Как заказать апостиль", kind: "howto", doc: "apostille" } });
      if (f.lang && f.lang !== "en") v.push({ level: "warn", title: "Документ не на английском",
        text: "Нужен нотариальный перевод: 3–5 рабочих дней, ориентировочно 10–15 000 ₸ за комплект.", action: { label: "Отметить перевод в плане", kind: "plan", doc: "translation" } });
    }

    if (t === "passport") {
      var exp = parseDate(f.expires_on) || parseDate(doc.expires_on);
      var risky = linked.filter(function (a) { return exp && a.deadline && exp < new Date(a.deadline.getTime() + 365 * 864e5); });
      if (exp && risky.length) v.push({ level: "warn", title: "Паспорт истекает слишком рано",
        text: "Действует до " + fmt(exp) + ". Для студенческой визы обычно нужен запас минимум на год после начала учёбы — лучше поменять заранее (21 день).", action: { label: "Добавить в план", kind: "plan", doc: "passport" } });
      else if (exp) v.push({ level: "ok", title: "Паспорт действует достаточно долго", text: "До " + fmt(exp) + " — покрывает подачи и первый год учёбы." });
      else v.push({ level: "warn", title: "Не указан срок действия", text: "Впиши дату окончания — проверим против дедлайнов и визы.", action: { label: "Указать дату", kind: "fields" } });
    }

    if (t === "medical" || t === "apostille" || t === "translation" || t === "income" || t === "photo" || t === "cv" || t === "finance" || t === "research" || t === "recommendation") {
      var lead = TYPES[t] ? TYPES[t].lead : 7;
      var soon = linked.filter(function (a) { return a.deadline && daysBetween(a.deadline, new Date()) < lead + 7; });
      if (doc.status !== "ready" && soon.length) {
        var dleft = daysBetween(soon[0].deadline, new Date());
        v.push({ level: "blocker", title: "Времени в обрез: " + soon[0].title,
          text: TYPES[t].title + " делается ориентировочно " + lead + " " + plural(lead, "день", "дня", "дней") + ", а до дедлайна " + dleft + " " + plural(dleft, "день", "дня", "дней") + ". Начни сегодня." });
      } else if (doc.status === "ready") {
        v.push({ level: "ok", title: "Готово", text: "Документ отмечен готовым и учтён в готовности " + linked.length + " " + plural(linked.length, "подачи", "подач", "подач") + "." });
      } else {
        v.push({ level: "warn", title: "Ещё не готов", text: TYPES[t].title + " · закладывай ≈" + lead + " " + plural(lead, "день", "дня", "дней") + " на изготовление." });
      }
    }

    if (t === "motivation") {
      var r = letterReview(doc.content || "", linked[0] && linked[0].prog, ans);
      v = r.verdicts;
    }

    if (!v.length) v.push({ level: "ok", title: "Замечаний нет", text: "По нашим правилам с этим документом всё в порядке." });
    return v;
  }

  function plural(n, a, b, c) { var x = n % 100; if (x > 4 && x < 20) return c; x = n % 10; return x === 1 ? a : x > 1 && x < 5 ? b : c; }

  /* ---------- разбор мотивационного письма (правила) ---------- */
  var CLICHE = [
    { re: /beautiful country|rich culture|amazing country/i, s: "«beautiful country» / «rich culture»" },
    { re: /always dreamed|since childhood|мечтал[аи]? с детства/i, s: "«always dreamed» / «мечтал с детства»" },
    { re: /hardworking person|responsible person|fast learner/i, s: "«hardworking / responsible person»" },
    { re: /world[- ]class|prestigious university|best university in/i, s: "«world-class» / «prestigious university»" },
    { re: /i believe that i will|i am sure that i/i, s: "«I believe that I will…»" }
  ];
  function letterReview(text, prog, ans) {
    text = String(text || "");
    var words = text.trim() ? text.trim().split(/\s+/).length : 0;
    var paras = text.split(/\n\s*\n/).filter(function (p) { return p.trim().length > 40; }).length;
    var digits = (text.match(/\d+([.,]\d+)?/g) || []).length;
    var found = CLICHE.filter(function (c) { return c.re.test(text); });
    var progName = prog ? String(prog.name || "").split(/[(,]/)[0].trim() : "";
    var mentionsProg = progName ? new RegExp(progName.slice(0, Math.min(14, progName.length)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text) : false;
    var mentionsCountry = prog && prog.country ? new RegExp(prog.country.slice(0, 5), "i").test(text) : false;
    var returnsHome = /kazakhstan|казахстан|after graduation|вернусь|return home/i.test(text);

    var c = [];
    c.push({ k: "Конкретика", v: clamp(digits >= 3 ? 8.5 : digits === 2 ? 7 : digits === 1 ? 5 : 3) });
    c.push({ k: "Связь с программой", v: clamp(mentionsProg ? 8.5 : mentionsCountry ? 5.5 : 2.5) });
    c.push({ k: "Структура", v: clamp(paras >= 4 ? 8 : paras === 3 ? 6.5 : paras === 2 ? 5 : 3) });
    c.push({ k: "Язык и клише", v: clamp(8.5 - found.length * 2) });
    c.push({ k: "Что после выпуска", v: clamp(returnsHome ? 8 : 3) });
    var score = Math.round(c.reduce(function (s, x) { return s + x.v; }, 0) / c.length * 10) / 10;

    var v = [];
    if (!words) {
      v.push({ level: "warn", title: "Письма ещё нет", text: "Начни с четырёх вопросов — соберём каркас, дальше поправишь своими словами.", action: { label: "Собрать черновик", kind: "letter-wizard" } });
      return { score: 0, criteria: c, verdicts: v, words: 0 };
    }
    if (words < 220) v.push({ level: "warn", title: "Письмо короткое: " + words + " слов", text: "Типичный объём — 300–600 слов. Слишком короткое читается как «не старался»." });
    if (words > 750) v.push({ level: "warn", title: "Письмо длинное: " + words + " слов", text: "После 600 слов комиссия скользит по диагонали. Сократи вводную часть." });
    found.forEach(function (x) {
      v.push({ level: "blocker", title: "Клише: " + x.s, text: "Такую фразу комиссия читает сотни раз за сезон. Замени на конкретный факт о себе или о программе." });
    });
    if (!mentionsProg) v.push({ level: "blocker", title: "Не названа сама программа", text: (progName ? "Назови «" + progName + "» и конкретный трек или лабораторию. " : "") + "Письмо без привязки читается как рассылка." });
    if (digits < 2) v.push({ level: "warn", title: "Мало конкретных цифр", text: "Цифры — самый дешёвый способ доказать результат: сколько человек, сколько процентов, за какой срок." });
    if (!returnsHome) v.push({ level: "warn", title: "Нет ответа «что дальше»", text: "Стипендиальные программы оценивают пользу от выпускника. Одна честная фраза о планах после выпуска добавляет заметно." });
    if (digits >= 3) v.push({ level: "ok", title: "Конкретика на месте", text: "Цифры и факты — сильная часть письма, оставь их." });
    if (mentionsProg) v.push({ level: "ok", title: "Связь с программой названа", text: "Это то, что отличает письмо «под программу» от универсального." });
    return { score: score, criteria: c, verdicts: v, words: words };
  }
  function clamp(x) { return Math.max(0, Math.min(10, Math.round(x * 10) / 10)); }

  /* ---------- как сделать документ хорошо (коуч) ---------- */
  var HOWTO = {
    apostille: { title: "Апостиль на диплом · Казахстан", steps: [
      { t: "Нотариальная копия документа", d: "любой нотариус · 1 день · ориентировочно 3 000 ₸" },
      { t: "Апостиль в Министерстве просвещения / науки", d: "через egov.kz или ЦОН · до 20 рабочих дней · госпошлина" },
      { t: "Перевод апостилированного документа", d: "важно: переводим ПОСЛЕ апостиля — иначе апостиль не попадёт в перевод" },
      { t: "Нотариальное заверение перевода", d: "1–2 дня" }], note: "Сроки и цены ориентировочные — уточняй на egov.kz." },
    translation: { title: "Нотариальный перевод", steps: [
      { t: "Собери все страницы, включая приложение с оценками", d: "переводится документ целиком" },
      { t: "Проверь написание имени по загранпаспорту", d: "имя в переводе обязано совпадать с паспортом — это частая причина возврата" },
      { t: "Бюро переводов с нотариусом", d: "3–5 рабочих дней · ориентировочно 10–15 000 ₸ за комплект" }], note: "Некоторые вузы принимают только переводы, заверенные в стране обучения — проверь требования." },
    medical: { title: "Медицинская справка", steps: [
      { t: "Уточни форму", d: "у части программ своя форма — скачай с сайта программы, а не бери типовую" },
      { t: "Поликлиника или частная клиника", d: "2–7 дней в зависимости от анализов" },
      { t: "Перевод и, если требуется, апостиль", d: "+7–28 дней — закладывай заранее" }], note: "" },
    ielts: { title: "Пересдача IELTS", steps: [
      { t: "Выбери дату с запасом", d: "результат приходит через 3–13 дней в зависимости от формата" },
      { t: "Проверь, какой формат принимает программа", d: "Academic vs General — принимают обычно Academic" },
      { t: "Заложи буфер до дедлайна", d: "минимум 3 недели от даты экзамена" }], note: "" },
    recommendation: { title: "Рекомендательные письма", steps: [
      { t: "Выбери двух: научрук и преподаватель профильного предмета", d: "не начальник по работе, если программа академическая" },
      { t: "Отправь просьбу с деталями", d: "программа, дедлайн, формат, твоё CV и краткое описание проекта" },
      { t: "Напомни за неделю до дедлайна", d: "вежливое напоминание — норма" }], note: "В сессию преподаватели пишут дольше: закладывай 3 недели." }
  };

  return {
    TYPES: TYPES, HOWTO: HOWTO, APOSTILLE: APOSTILLE, AFTER: AFTER, NICE_TO_HAVE: NICE_TO_HAVE,
    requiredFor: requiredFor, readiness: readiness, checkDocument: checkDocument,
    docPlan: docPlan, planSummary: planSummary,
    letterReview: letterReview, ieltsFromAxis: ieltsFromAxis, plural: plural
  };
});
