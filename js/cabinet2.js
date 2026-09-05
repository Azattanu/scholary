/* ============================================================
   Scholary · Кабинет 2.0
   Разделы: Сегодня · Подачи · Вузы · Документы · Профиль
   + экраны глубины: паспорт подачи, карточка программы,
     документ с вердиктом, редактор письма, «Мой шанс».

   Данные: profiles / portfolio_items / user_documents /
   probability_history (RLS auth.uid), каталог programs,
   RPC claim_lead и my_reports. Вероятности — report-engine.js,
   проверки документов — doc-rules.js (детерминированные правила;
   слой модели подключается через SCHOLARY_CONFIG.AI_CHECK_URL).
   ============================================================ */
function __scholaryMain() {
  "use strict";
  var C = window.SCHOLARY_CONFIG || {};
  var sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
  var E = window.ScholaryEngine;
  var D = window.ScholaryDocs;

  var S = { session: null, profile: null, ans: null, evalR: null, apps: [], docs: [], programs: [],
            reports: null, hist: [], tab: "today", stack: [],
            /* web-74: состояние задач недели, активность по дням, вехи, материалы */
            cab: { state: {}, activity: [], ach: {}, content: [] }, plan: null, calMonth: null, calSel: null, deep: null };

  /* ================= утилиты ================= */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[<>&"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]; }); }
  function show(id) { ["loading", "v-auth", "v-recovery", "v-claim", "v-setup", "v-empty", "v-app"].forEach(function (v) { var e = $(v); if (e) e.hidden = v !== id; }); }
  function toast(msg, kind) {
    var t = document.createElement("div"); t.className = "toast" + (kind ? " " + kind : ""); t.textContent = msg;
    $("toast-root").appendChild(t); setTimeout(function () { t.remove(); }, 3400);
  }
  function firstName(n) { return (n || "").trim().split(/\s+/)[0] || ""; }
  function pct(x) { return Math.round(x * 100); }
  function plural(n, a, b, c) { return D.plural(n, a, b, c); }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function esc2(s) { return esc(s); }

  var L = {
    level: { bachelor: "Бакалавриат", master: "Магистратура", phd: "PhD / докторантура" },
    gpa_band: { "5.0-4.5": "5.0–4.5", "4.4-4.0": "4.4–4.0", "3.9-3.5": "3.9–3.5", "<3.5": "ниже 3.5" },
    gpa4: { "3.67+": "3.67+", "3.33-3.66": "3.33–3.66", "3.0-3.32": "3.0–3.32", "<3.0": "ниже 3.0", unknown: "не знаю" },
    lang_status: { have: "сертификат есть", soon: "сдаю в ближайшие полгода", none: "пока нет" },
    ielts: { "7+": "7.0+", "6.5": "6.5", "6.0": "6.0", "5.5": "5.5", "<5.5": "ниже 5.5", unknown: "не знаю" },
    budget: { "0": "0 ₸ — только стипендия", "<1m": "до 1 млн ₸", "1-3m": "1–3 млн ₸", "3m+": "3+ млн ₸" },
    priority: { scholarship: "стипендия", country: "страна", university: "университет", major: "специальность" },
    field: { it: "IT", eng: "Инженерия", med: "Медицина", bus: "Бизнес", sci: "Науки", hum: "Гуманитарные", art: "Искусство", law: "Право" },
    ach: { intl_olymp: "Межд. олимпиады", rep_olymp: "Респ. олимпиады", city_olymp: "Обл. олимпиады", publications: "Публикации", work_exp: "Опыт работы", project: "Проекты", volunteer: "Волонтёрство", sport_art: "Спорт/творчество", none: "пока нет" },
    status: { study: "Изучаю", prep: "Готовлю", applied: "Подала", done: "Ответ" },
    outcome: { admit: "Принята 🎉", reject: "Отказ", waitlist: "Лист ожидания" },
    cflag: { hu: "🇭🇺", de: "🇩🇪", it: "🇮🇹", cz: "🇨🇿", tr: "🇹🇷", cn: "🇨🇳", kr: "🇰🇷", jp: "🇯🇵", pl: "🇵🇱", us: "🇺🇸", fr: "🇫🇷", nl: "🇳🇱", ae: "🇦🇪", eu: "🇪🇺", se: "🇸🇪", sa: "🇸🇦", hk: "🇭🇰", sg: "🇸🇬", uk: "🇬🇧", gb: "🇬🇧", ca: "🇨🇦", kz: "🇰🇿", ch: "🇨🇭", at: "🇦🇹", be: "🇧🇪", fi: "🇫🇮", no: "🇳🇴", dk: "🇩🇰", ro: "🇷🇴", sk: "🇸🇰", si: "🇸🇮", hr: "🇭🇷", ee: "🇪🇪", lv: "🇱🇻", lt: "🇱🇹", pt: "🇵🇹", es: "🇪🇸", gr: "🇬🇷", ie: "🇮🇪", qa: "🇶🇦", my: "🇲🇾", in: "🇮🇳", kg: "🇰🇬", uz: "🇺🇿", am: "🇦🇲", az: "🇦🇿", bg: "🇧🇬", au: "🇦🇺", nz: "🇳🇿", eg: "🇪🇬", il: "🇮🇱", mx: "🇲🇽", tw: "🇹🇼", mo: "🇲🇴", ge: "🇬🇪", rs: "🇷🇸", th: "🇹🇭", bn: "🇧🇳", id: "🇮🇩", ru: "🇷🇺" }
  };
  function flag(cc) { return L.cflag[(cc || "").toLowerCase()] || "🎓"; }

  function normAnswers(a) {
    a = a || {};
    ["field", "achievements", "target_countries"].forEach(function (k) {
      if (typeof a[k] === "string") a[k] = a[k] ? a[k].split(",") : [];
      if (!a[k]) a[k] = [];
    });
    return a;
  }

  /* ---------- вероятности ---------- */
  function probFor(profile, prog) {
    if (!prog || !prog.req || !profile) return null;
    var ax = profile.axes, r = prog.req;
    var d = 0.45 * (ax.academics - (r.academics || 0)) + 0.4 * (ax.language - (r.language || 0))
          + 0.12 * (ax.achievements - 5) + 0.08 * (ax.motivation - 5);
    if (r.sat != null && profile.sat != null) d += 0.25 * (profile.sat - r.sat);
    function cl(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
    var adm = cl((prog.base_adm || 0.4) * (1 + 0.16 * d), 0.03, 0.95);
    var sch = prog.base_sch == null ? null : cl((prog.base_sch || 0.3) * (1 + 0.16 * d), 0.02, adm);
    return { adm: adm, sch: sch };
  }
  var MON = { янв: 0, фев: 1, мар: 2, апр: 3, май: 4, мая: 4, июн: 5, июл: 6, авг: 7, сен: 8, окт: 9, ноя: 10, дек: 11 };
  function parseDeadline(str) {
    if (!str) return null;
    var s = String(str).toLowerCase();
    var m = s.match(/(\d{1,2})\s*([а-я]{3})/);
    if (!m) { for (var k in MON) if (s.indexOf(k) >= 0) { m = [null, "15", k]; break; } }
    if (!m) return null;
    var mo = MON[m[2].slice(0, 3)]; if (mo == null) return null;
    var now = new Date(), y = now.getFullYear();
    var d = new Date(y, mo, parseInt(m[1], 10) || 15);
    if (d < now) d = new Date(y + 1, mo, parseInt(m[1], 10) || 15);
    return d;
  }
  function daysTo(d) { return d ? Math.ceil((d - new Date()) / 864e5) : null; }
  function fmtD(d) { return d ? d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) : "—"; }
  function fmtDL(d) { return d ? d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) : "—"; }
  function dlClass(days) { return days == null ? "pill-mut" : days < 30 ? "pill-bad" : days < 75 ? "pill-warn" : "pill-mut"; }

  /* ---------- представление подачи ---------- */
  function progById(id) { return byId(S.programs, id); }
  function appView(a) {
    var prog = progById(a.program_id) || (a.custom ? Object.assign({ id: a.program_id }, a.custom) : null);
    if (!prog) return null;
    var p = S.evalR ? probFor(S.evalR.profile, prog) : null;
    /* В каталоге типовой день цикла лежит как 'MM-DD' — он точнее русского текста */
    var date = (window.ScholaryPath && window.ScholaryPath.nextFromMD(prog.deadline_md, todayDate())) || parseDeadline(prog.deadline);
    var rd = D.readiness(a, S.docs, S.ans, prog);
    return { a: a, prog: prog, p: p, date: date, days: daysTo(date), rd: rd,
             title: prog.name, cc: prog.cc, country: prog.country };
  }
  function appViews() {
    return S.apps.map(appView).filter(Boolean).sort(function (x, y) {
      var xs = x.a.submitted_at ? 1 : 0, ys = y.a.submitted_at ? 1 : 0;
      if (xs !== ys) return xs - ys;
      var xr = risk(x), yr = risk(y);
      return yr - xr;
    });
  }
  function risk(v) { // чем меньше дней и меньше готовности — тем выше риск
    if (v.days == null) return 0;
    return (200 - Math.min(200, v.days)) * (1 + (100 - v.rd.pct) / 100);
  }
  function appsForDoc() {
    return appViews().map(function (v) { return { program_id: v.a.program_id, prog: v.prog, deadline: v.date, title: v.title }; });
  }

  /* ---------- сохранение ---------- */
  function saveApp(a, patch, cb) {
    Object.assign(a, patch, { updated_at: new Date().toISOString() });
    sb.from("portfolio_items").update(patch).eq("id", a.id).then(function (r) {
      if (r.error) toast("Не удалось сохранить — повторим при связи", "bad");
      if (cb) cb();
    });
  }
  function saveDoc(d, patch, cb) {
    Object.assign(d, patch, { updated_at: new Date().toISOString() });
    sb.from("user_documents").update(patch).eq("id", d.id).then(function (r) {
      if (r.error) toast("Не удалось сохранить", "bad");
      if (cb) cb();
    });
  }
  function createDoc(fields, cb) {
    var row = Object.assign({ user_id: S.session.user.id, status: "none" }, fields);
    sb.from("user_documents").insert(row).select().single().then(function (r) {
      if (r.error) { toast("Не удалось создать документ", "bad"); return; }
      S.docs.push(r.data); if (cb) cb(r.data);
    });
  }
  /* ================= ИИ-слой ==================================
     Правила doc-rules.js работают всегда и бесплатно.
     Этот слой добавляет разбор модели поверх правил: пользователь
     жмёт кнопку сам, ответ кэшируется в БД, при любой ошибке
     остаёмся на правилах. Лимиты приходят с сервера. */
  var AI = { url: C.AI_URL || "/api/ai.php", busy: {}, err: {}, quota: null };
  function aiOn() { return !!AI.url; }
  function aiToken() { return S.session && S.session.access_token; }
  function aiCall(payload, cb) {
    var tk = aiToken();
    if (!tk) { cb({ error: "noauth" }); return; }
    var done = false;
    var to = setTimeout(function () { if (!done) { done = true; cb({ error: "timeout" }); } }, 60000);
    fetch(AI.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ token: tk }, payload))
    }).then(function (r) {
      return r.json().catch(function () { return { error: "bad_response" }; })
        .then(function (j) { return { s: r.status, j: j || {} }; });
    }).then(function (o) {
      if (done) return; done = true; clearTimeout(to);
      if (o.j && o.j.limit != null) AI.quota = { used: o.j.used, limit: o.j.limit, pro: !!o.j.pro };
      if (o.s === 200 && o.j.ok) cb(null, o.j); else cb(o.j || { error: "http_" + o.s });
    }).catch(function () {
      if (done) return; done = true; clearTimeout(to); cb({ error: "network" });
    });
  }
  /* Полезные для модели данные — только человекочитаемые названия полей:
     иначе модель цитирует в ответе технические ключи вроде has_file. */
  function aiAppsPayload() {
    return appsForDoc().slice(0, 12).map(function (a) {
      var p = a.prog || {};
      return { "программа": a.title, "страна": p.country,
               "уровень": L.level[p.level] || p.level,
               "дедлайн": a.deadline ? a.deadline.toISOString().slice(0, 10) : "не указан",
               "нужен балл IELTS": p.req_ielts || "не указан",
               "нужен средний балл": p.req_gpa || "не указан",
               "какие документы просит": (p.docs && p.docs.length) ? p.docs : "не указаны" };
    });
  }
  function aiProfilePayload() {
    var a = S.ans || {};
    return { "уровень поступления": L.level[a.level] || a.level,
             "направления": (a.field || []).map(function (f) { return L.field[f] || f; }),
             "средний балл": L.gpa_band[a.gpa_band] || L.gpa4[a.gpa4] || "не указан",
             "английский": L.ielts[a.ielts_band] || L.lang_status[a.lang_status] || "не указан",
             "бюджет семьи в год": L.budget[a.budget] || "не указан",
             "достижения": (a.achievements || []).map(function (x) { return L.ach[x] || x; }),
             "год окончания": a.grad_year || "не указан" };
  }
  function aiErrText(e) {
    if (!e) return "";
    if (e.error === "limit") return "limit";
    if (e.error === "noauth") return "Нужно войти заново.";
    if (e.error === "timeout") return "ИИ не ответил за минуту. Проверка по правилам ниже — она полная.";
    return "ИИ сейчас недоступен. Проверка по правилам ниже работает как обычно.";
  }
  function aiCheckDoc(d) {
    if (AI.busy["d" + d.id]) return;
    AI.busy["d" + d.id] = true; AI.err["d" + d.id] = null; drawSub();
    aiCall({
      kind: "doc",
      doc: { "тип документа": (D.TYPES[d.doc_type] || {}).title || d.doc_type,
             "как назвал абитуриент": d.title,
             "статус": { none: "ещё не начат", progress: "в работе", ready: "отмечен готовым" }[d.status] || "ещё не начат",
             "скан загружен": d.file_path ? "да" : "нет",
             "указанные данные": d.fields || {},
             "текст документа": (d.content || "").slice(0, 4000) || "не заполнен" },
      apps: aiAppsPayload(), profile: aiProfilePayload()
    }, function (e, j) {
      AI.busy["d" + d.id] = false;
      if (e) { AI.err["d" + d.id] = aiErrText(e); drawSub(); return; }
      saveDoc(d, { verdicts: j.verdicts || [], checked_at: new Date().toISOString() }, function () { drawSub(); });
      if (window.track) track("ai_doc_check", { type: d.doc_type });
    });
  }
  function aiCheckLetter(d, prog) {
    if (AI.busy["l" + d.id]) return;
    var txt = (d.content || "").trim();
    if (txt.length < 40) { toast("Сначала напиши хотя бы несколько предложений", "bad"); return; }
    AI.busy["l" + d.id] = true; AI.err["l" + d.id] = null; drawSub();
    aiCall({
      kind: "letter", text: txt.slice(0, 9000),
      program: prog ? { "программа": prog.name, "страна": prog.country,
                        "уровень": L.level[prog.level] || prog.level,
                        "язык обучения": prog.lang || "не указан",
                        "финансирование": prog.funding || "не указано" } : null
    }, function (e, j) {
      AI.busy["l" + d.id] = false;
      if (e) { AI.err["l" + d.id] = aiErrText(e); drawSub(); return; }
      saveDoc(d, { score: j.score, verdicts: { score: j.score, criteria: j.criteria || [], verdicts: j.verdicts || [] },
                   checked_at: new Date().toISOString() }, function () { drawSub(); awardCheck(); });
      touch(true);
      if (window.track) track("ai_letter_check", {});
    });
  }
  function aiQuotaHTML() {
    var q = AI.quota;
    if (!q) return "";
    var left = Math.max(0, q.limit - q.used);
    return '<span class="xs mut">осталось ' + left + " " + plural(left, "разбор", "разбора", "разборов") + " сегодня" +
      (q.pro ? " · Pro" : ' · <a href="#" data-act="subscribe">в Pro — 120 и модель посильнее</a>') + "</span>";
  }
  function aiLimitCardHTML() {
    return '<div class="aicard"><div class="who"><i></i>Лимит на сегодня исчерпан</div>' +
      '<p class="sm" style="margin:4px 0 10px">На бесплатном тарифе — 8 разборов ИИ в день, чтобы всем хватало. Проверка по правилам ниже работает без ограничений и не тратит лимит.</p>' +
      '<button class="btn btn-primary btn-sm" data-act="subscribe">Scholary Pro · 120 разборов в день</button></div>';
  }
  function aiRunHTML(key, label, labelAgain, hasResult, dataAttrs) {
    if (AI.busy[key]) {
      return '<div class="aicard"><div class="who"><i></i>ИИ читает документ</div>' +
        '<div class="ai-run"><span class="spinner spin-sm"></span><span class="sm">Обычно 10–20 секунд. Сверяем текст с требованиями твоих подач.</span></div>' +
        '<div class="sk" style="width:90%"></div><div class="sk" style="width:70%"></div></div>';
    }
    var err = AI.err[key];
    var errHTML = "";
    if (err === "limit") errHTML = aiLimitCardHTML();
    else if (err) errHTML = '<div class="verd warn"><span>⚠️</span><span><b>Разбор ИИ не получился</b>' + esc(err) + "</span></div>";
    return errHTML +
      '<div class="ai-run">' +
      '<button class="btn ' + (hasResult ? "btn-ghost" : "btn-primary") + ' btn-sm" data-act="' + dataAttrs.act + '" data-id="' + dataAttrs.id + '">' +
      (hasResult ? labelAgain : label) + "</button>" + aiQuotaHTML() + "</div>";
  }

  function docsOfType(t) { return S.docs.filter(function (d) { return d.doc_type === t; }); }
  function docFor(t, programId) {
    var list = docsOfType(t);
    var exact = list.filter(function (d) { return (d.program_ids || []).indexOf(programId) >= 0; });
    if (exact.length) return exact[0];
    var common = list.filter(function (d) { return !(d.program_ids || []).length; });
    return common[0] || null;
  }
  function recompute() {
    try { S.evalR = E.evaluate(S.ans || {}); } catch (e) { S.evalR = null; }
    S.apps.forEach(function (a) {
      var v = appView(a);
      if (v && v.rd.pct !== a.readiness) saveApp(a, { readiness: v.rd.pct });
    });
  }
  function overall() {
    var vs = appViews().filter(function (v) { return v.p; });
    if (!vs.length) return { adm: 0, sch: 0 };
    var indep = 1, best = 0, bestS = 0;
    vs.slice(0, 6).forEach(function (v) { indep *= (1 - v.p.adm); });
    vs.forEach(function (v) { best = Math.max(best, v.p.adm); bestS = Math.max(bestS, v.p.sch || 0); });
    var any = Math.min(0.9, 1 - indep);
    return { adm: best + (any - best) * 0.35, sch: bestS };
  }

  /* ================= навигация ================= */
  var TABS = ["today", "apps", "unis", "docs", "profile"];
  function renderWidget() {
    var el = $("side-widget"); if (!el) return;
    var vs = appViews(), o = overall();
    var plan = S.plan || weekPlan();
    var burning = vs.filter(function (v) { return !v.a.submitted_at && v.days != null; }).slice(0, 3);
    /* Правая колонка на широком экране: раньше здесь были четыре карточки-заглушки.
       Теперь — то, что не влезло в основную колонку: кольца, календарь,
       стипендия недели, совет недели, материалы, шанс, помощь. */
    el.innerHTML =
      '<div class="card w-card"><div class="h-row"><b class="sm">Готовность</b><span class="xs mut">неделя ' + plan.week.n + "</span></div>" + ringsHTML() + "</div>" +
      calendarBlockHTML().replace('style="margin-top:14px"', 'style="margin-bottom:12px"') +
      programOfWeekHTML().replace('style="margin-top:14px;', 'style="margin-bottom:12px;') +
      '<div class="card w-card"><div class="h-row"><b class="sm">Мой шанс</b><span class="pill pill-mut">→</span></div>' +
        duoHTML(o, ["хотя бы один оффер", "хотя бы одна стипендия"]) +
        '<button class="btn btn-ghost btn-sm btn-block" style="margin-top:10px" data-act="chance">Динамика и «что если»</button></div>' +
      (burning.length ? '<div class="card w-card"><b class="sm">Ближайшие дедлайны</b>' + burning.map(function (v) {
          return '<div class="lst tappable" data-act="app" data-app="' + v.a.id + '" style="padding:9px 0"><div style="flex:1;min-width:0"><b class="xs">' + esc(v.title) + '</b>' +
            '<div class="xs mut">' + fmtDL(v.date) + " · " + v.rd.pct + "%</div></div>" +
            '<span class="pill ' + dlClass(v.days) + '">' + v.days + " дн</span></div>";
        }).join("") + "</div>" : "") +
      tipOfWeekHTML(plan).replace('style="margin-top:14px"', 'style="margin-bottom:12px"') +
      contentHTML(plan) +
      '<div class="card w-card" style="margin-top:12px"><b class="sm">Нужна помощь?</b><div class="xs mut" style="margin:4px 0 8px">Ответим в WhatsApp в рабочее время</div>' +
        '<button class="btn btn-ghost btn-sm btn-block" data-act="help">Написать нам</button></div>';
  }

  function setTab(t) {
    S.tab = t; S.stack = [];
    TABS.forEach(function (x) { var el = $("tab-" + x); if (el) el.hidden = x !== t; });
    $("sub-view").hidden = true;
    Array.prototype.forEach.call(document.querySelectorAll("#tabbar button"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-tab") === t);
    });
    window.scrollTo(0, 0);
    if (t === "today") renderToday();
    if (t === "apps") renderApps();
    if (t === "unis") renderUnis();
    if (t === "docs") renderDocs();
    if (t === "profile") renderProfile();
    renderWidget();
    if (window.track) track("cab_tab", { tab: t });
  }
  function openSub(render) {
    S.stack.push(render);
    TABS.forEach(function (x) { var el = $("tab-" + x); if (el) el.hidden = true; });
    $("sub-view").hidden = false;
    drawSub();
    window.scrollTo(0, 0);
  }
  function drawSub() {
    var f = S.stack[S.stack.length - 1];
    if (!f) { setTab(S.tab); return; }
    $("sub-view").innerHTML = f();
    renderWidget();
    wireSub();
  }
  function backSub() {
    S.stack.pop();
    if (!S.stack.length) setTab(S.tab); else { drawSub(); window.scrollTo(0, 0); }
  }
  function subHead(title, sub) {
    return '<div class="subhead"><button class="iconbtn" data-act="back" aria-label="Назад">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg></button>' +
      '<div><div class="subttl">' + esc(title) + "</div>" + (sub ? '<div class="xs mut">' + esc(sub) + "</div>" : "") + "</div></div>";
  }

  /* ---------- общие кусочки разметки ---------- */
  function ringHTML(p, size) {
    size = size || 54;
    var r = size / 2 - 4, c = 2 * Math.PI * r, col = p >= 80 ? "#0B7A3E" : p >= 50 ? "#A05F00" : "#C0392B";
    return '<div class="ready" style="width:' + size + "px;height:" + size + 'px">' +
      '<svg width="' + size + '" height="' + size + '"><circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="#ECECF1" stroke-width="5"/>' +
      (p > 0 ? '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="5" stroke-linecap="round" stroke-dasharray="' + (c * p / 100).toFixed(1) + " " + c.toFixed(1) + '"/>' : "") + "</svg>" +
      "<b>" + p + "%</b></div>";
  }
  function verdHTML(v) {
    var cls = v.level === "blocker" ? "bad" : v.level === "warn" ? "warn" : "ok";
    var ic = v.level === "blocker" ? "⛔" : v.level === "warn" ? "⚠️" : "✅";
    return '<div class="verd ' + cls + '"><span>' + ic + '</span><span><b>' + esc(v.title) + (v.ai ? '<span class="ai-badge">ИИ</span>' : "") + "</b>" + esc(v.text || "") +
      (v.action ? '<button class="btn btn-primary btn-sm" style="margin-top:8px" data-act="' + esc(v.action.kind) + '" data-doc="' + esc(v.action.doc || "") + '">' + esc(v.action.label) + "</button>" : "") +
      (v.source ? '<a class="srcline" href="' + esc(v.source) + '" target="_blank" rel="noopener">официальный источник</a>' : "") +
      "</span></div>";
  }
  function duoHTML(o, labels) {
    labels = labels || ["поступление", "стипендия"];
    var right = o.sch == null
      ? '<span><b style="color:var(--ok);font-size:15px">0 \u20b8</b>обучение бесплатное</span>'
      : '<span><b style="color:var(--ok)">' + pct(o.sch) + '%</b>' + labels[1] + "</span>";
    return '<div class="duo"><span><b style="color:var(--accent)">' + pct(o.adm) + "%</b>" + labels[0] + "</span>" + right + "</div>";
  }

  /* ================= 1 · СЕГОДНЯ ================= */
  function nextStep() {
    var vs = appViews().filter(function (v) { return !v.a.submitted_at; });
    if (!vs.length) return null;
    // 1) блокирующий документ с длинным сроком изготовления у ближайшего дедлайна
    for (var i = 0; i < vs.length; i++) {
      var v = vs[i];
      for (var j = 0; j < v.rd.missing.length; j++) {
        var m = v.rd.missing[j], T = D.TYPES[m.t];
        if (!T) continue;
        var urgent = v.days != null && v.days <= (T.lead + 14);
        if (urgent) return { title: T.title + " для «" + v.title + "»", why: T.title + " делается ≈" + T.lead + " " + plural(T.lead, "день", "дня", "дней") + ", а до дедлайна " + v.days + ". Начни сегодня.", t: m.t, v: v };
      }
    }
    // 2) первый недостающий документ ближайшей подачи
    var v0 = vs[0];
    if (v0 && v0.rd.missing.length) {
      var m0 = v0.rd.missing[0], T0 = D.TYPES[m0.t] || { title: m0.t };
      return { title: T0.title + " для «" + v0.title + "»", why: "Это ближайший дедлайн: " + fmtDL(v0.date) + (v0.days != null ? " · через " + v0.days + " " + plural(v0.days, "день", "дня", "дней") : "") + ".", t: m0.t, v: v0 };
    }
    // 3) всё собрано — проверить перед отправкой
    if (v0) return { title: "Проверь пакет «" + v0.title + "» перед отправкой", why: "Все документы на месте. Прогоним финальную проверку — это последняя точка, где ошибку ещё можно поймать.", t: null, v: v0, check: true };
    return null;
  }
  /* ================= 1 · СЕГОДНЯ (web-74: неделя сезона) =================
     Экран отвечает на один вопрос: «что делать на этой неделе и успеваю ли я».
     Порядок блоков = приоритет решения: неделя → продолжить → следующий шаг →
     задачи недели → путь и кольца → горит → шанс → календарь → стипендия недели →
     совет недели → материалы → Pro → консультант. */
  var Path = window.ScholaryPath;
  function todayDate() { return window.__SCHOLARY_NOW ? new Date(window.__SCHOLARY_NOW) : new Date(); }
  function cabPrefs() { return (S.profile && S.profile.cab) || {}; }
  function weekGoal() { var g = +(cabPrefs().goal || 3); return g >= 2 && g <= 5 ? g : 3; }
  function pathCtx() {
    var vs = appViews();
    return { today: todayDate(), level: (S.ans && S.ans.level) || "bachelor", ans: S.ans || {}, apps: vs, plan: docPlanNow(),
             docs: S.docs, programs: S.programs, state: S.cab.state, TYPES: D.TYPES, tgLinked: !!(S.tg && S.tg.chat_id),
             matchOf: function (p) { var pr = probFor(S.evalR && S.evalR.profile, p); return pr ? Math.round((pr.adm * 0.6 + (pr.sch || pr.adm) * 0.4) * 100) : 0; } };
  }
  function weekPlan() { return Path.buildTasks(pathCtx()); }
  function weeksNow() { return Path.weeksProgress(S.cab.activity, cabPrefs().quiet || [], todayDate()); }

  /* ---- задачи недели: состояние ---- */
  function taskSave(key, patch, cb) {
    var wk = Path.weekInfo(todayDate());
    var row = Object.assign({ user_id: S.session.user.id, task_key: key, week_start: wk.key, updated_at: new Date().toISOString() }, S.cab.state[key] || {}, patch);
    if (row.title) row.title = String(row.title).slice(0, 200); else delete row.title;
    S.cab.state[key] = Object.assign({}, S.cab.state[key] || {}, patch);
    try { localStorage.setItem("scholary_cab_state", JSON.stringify(S.cab.state)); } catch (e) {}
    sb.from("cab_task_state").upsert(row, { onConflict: "user_id,task_key" }).then(function (r) {
      /* базы может не быть (старый кабинет) — состояние живёт в localStorage до следующего захода */
      if (r && r.error && window.console) console.warn("cab_task_state", r.error.message);
      if (cb) cb();
    });
  }
  function touch(progress) {
    sb.rpc("cab_touch", { p_progress: !!progress }).then(function (r) {
      if (r && r.data && r.data.day) {
        var d = String(r.data.day), row = S.cab.activity.filter(function (a) { return a.day === d; })[0];
        if (row) { row.progress = row.progress || !!progress; } else S.cab.activity.push({ day: d, progress: !!progress });
      }
    });
  }
  /* ---- вехи: только за реальные события ---- */
  function awardCheck(silent) {
    var ctx = pathCtx(); ctx.weeks = weeksNow();
    var fresh = Path.checkAchievements(ctx, S.cab.ach);
    if (!fresh.length) return;
    fresh.forEach(function (k) {
      S.cab.ach[k] = new Date().toISOString();
      sb.from("cab_achievements").insert({ user_id: S.session.user.id, key: k }).then(function () {});
      if (window.track) track("cab_badge", { key: k });
    });
    if (!silent) { var A = Path.ACH[fresh[0]]; if (A) toast(A.ic + " Веха: " + A.title, "ok"); }
  }

  /* ---- разметка блоков ---- */
  function taskHTML(t, i) {
    var done = t.status === "done", skipped = t.status === "skipped", moved = t.status === "moved";
    var when = t.when ? '<span class="when on" data-act="task-when" data-key="' + esc(t.key) + '">' + Path.WD_SHORT[t.when - 1] + "</span>"
                      : '<span class="when" data-act="task-when" data-key="' + esc(t.key) + '">когда?</span>';
    return '<div class="task' + (done ? " done" : "") + (skipped ? " skipped" : "") + (moved ? " skipped moved" : "") + '" data-key="' + esc(t.key) + '">' +
      '<button class="cbox ' + (done ? "on" : "") + '" data-act="task-done" data-key="' + esc(t.key) + '" aria-label="' + (done ? "Снять отметку" : "Отметить сделанной") + '">' + (done ? "✓" : "") + "</button>" +
      '<div class="task-b"><div class="task-t"><span class="xs mut task-k">' + (t.carried ? "с прошлой недели" : esc(Path.TASK_KIND[t.kind] || "")) + (t.minutes ? " · ~" + t.minutes + " мин" : "") + "</span>" +
        '<b>' + esc(t.title) + "</b>" + (t.why ? '<div class="xs mut">' + esc(t.why) + "</div>" : "") + "</div>" +
        (skipped || moved ? '<div class="xs mut" style="margin-top:4px">' + (moved ? "перенесено на следующую неделю" : "не актуально") + ' · <a href="#" data-act="task-undo" data-key="' + esc(t.key) + '">вернуть</a></div>'
          : '<div class="task-a">' + when +
            (done ? "" : '<button class="btn btn-soft btn-sm" data-act="task-go" data-key="' + esc(t.key) + '" data-v="' + esc(t.act || "") + '">Открыть</button>') +
            (done ? "" : '<button class="lnk xs" data-act="task-menu" data-key="' + esc(t.key) + '">…</button>') + "</div>") +
      "</div></div>";
  }
  function weekTasksHTML(plan) {
    var goal = weekGoal(), done = plan.tasks.filter(function (t) { return t.status === "done"; }).length;
    var wp = weeksNow();
    var head = '<div class="h-row" style="margin:16px 0 6px"><div class="sub-h" style="margin:0">Задачи недели</div>' +
      '<span class="pill ' + (done >= goal ? "pill-ok" : "pill-mut") + '">' + done + " из " + goal + "</span></div>";
    var status = wp.thisWeek || done >= 1
      ? '<p class="xs mut" style="margin:0 0 8px">Неделя засчитана' + (done >= goal ? " · цель закрыта" : " · до цели ещё " + (goal - done) + " " + plural(goal - done, "задача", "задачи", "задач")) + "</p>"
      : '<p class="xs mut" style="margin:0 0 8px">Одна закрытая задача — и неделя засчитана</p>';
    return head + status + '<div class="card task-list">' + plan.tasks.map(taskHTML).join("") +
      (plan.tasks.length ? "" : '<p class="sm mut" style="margin:0">План пуст: добавь программы — и задачи появятся.</p>') + "</div>";
  }
  function pathHTML(plan) {
    var pr = Path.progress(pathCtx()), wp = weeksNow(), goal = weekGoal();
    var left = Math.max(0, Math.round((new Date((S.ans && S.ans.year) === "2028" ? "2028-09-01" : "2027-09-01") - todayDate()) / 864e5));
    var target = (S.ans && S.ans.year) === "2028" ? "сентябрь 2028" : "сентябрь 2027";
    var series = wp.streak
      ? '<b>' + wp.streak + "</b> " + plural(wp.streak, "неделя", "недели", "недель") + " с прогрессом подряд"
      : (wp.total ? "недель с прогрессом: <b>" + wp.total + "</b>" : "первая неделя с прогрессом — впереди");
    return '<div class="pointb" style="margin:14px 0"><div class="h-row"><div class="lbl">Путь к Точке Б · ' + target.toUpperCase() + '</div><span class="xs mut">осталось ' + left + " " + plural(left, "день", "дня", "дней") + "</span></div>" +
      '<div class="big" style="margin:4px 0 8px">Пройдено <span style="color:var(--accent)">' + pr.pct + "%</span> пути</div>" +
      '<div class="pbar"><i style="width:' + Math.max(3, pr.pct) + '%"></i></div>' +
      '<div class="path-parts">' + pr.parts.map(function (p) { return '<span' + (p.v >= 1 ? ' class="ok"' : "") + '>' + esc(p.label) + " " + Math.round(p.v * 100) + "%</span>"; }).join("") + "</div>" +
      '<div class="h-row" style="margin-top:10px;flex-wrap:wrap;gap:6px"><span class="sm">🔥 ' + series + "</span>" +
        (wp.freezeUsedThisMonth ? '<span class="xs mut">заморозка месяца использована</span>' : '<span class="xs mut">пропуск раз в месяц не рвёт серию</span>') + "</div>" +
      '<div class="xs mut" style="margin-top:6px">' + (wp.quietThisWeek ? "Тихая неделя: план на паузе · " : "") +
        '<a href="#" data-act="quiet-week">' + (wp.quietThisWeek ? "снять паузу" : "поставить неделю на паузу") + "</a> · цель недели: " + goal + ' <a href="#" data-act="week-goal">изменить</a></div></div>';
  }
  function ringsHTML() {
    var pr = Path.progress(pathCtx()), r = pr.rings;
    function ring(k, label, o, act) {
      return '<button class="ring3 tappable" data-act="' + act + '">' + ringHTML(o.total ? o.pct : 0, 58) + '<b class="sm">' + label + '</b><span class="xs mut">' + (o.total ? o.done + " из " + o.total : "—") + "</span></button>";
    }
    return '<div class="rings">' + ring("docs", "Документы", r.docs, "tab-docs") + ring("letters", "Письма", r.letters, "tab-apps") + ring("apps", "Подачи", r.apps, "tab-apps") + "</div>";
  }
  function continueHTML() {
    var recent = S.docs.filter(function (d) { return d.status !== "ready" && d.updated_at && Path.daysBetween(todayDate(), new Date(d.updated_at)) <= 7 && (d.content || d.file_path); })
      .sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); })[0];
    if (!recent) return "";
    var T = D.TYPES[recent.doc_type] || { title: recent.doc_type, ic: "📄" };
    var prog = recent.program_ids && recent.program_ids.length ? progById(recent.program_ids[0]) : null;
    return '<div class="card tappable cont" data-act="doc" data-id="' + recent.id + '"><div class="h-row"><div style="min-width:0;padding-right:10px"><span class="xs mut">Продолжить с места остановки</span>' +
      '<b class="sm" style="display:block">' + T.ic + " " + esc(T.title) + (prog ? " · " + esc(prog.name) : "") + "</b>" +
      '<span class="xs mut">' + (recent.doc_type === "motivation" ? "версия " + (recent.version || 1) + (recent.score != null ? " · " + Number(recent.score).toFixed(1) + "/10" : "") : "в работе") + '</span></div><span class="pill pill-acc">→</span></div></div>';
  }
  function cooldownHTML(vs) {
    var just = vs.filter(function (v) { return v.a.submitted_at && Path.daysBetween(todayDate(), new Date(v.a.submitted_at)) <= 3; })[0];
    if (!just) return "";
    var next = vs.filter(function (v) { return !v.a.submitted_at && v.days != null && v.days >= 0; }).sort(function (a, b) { return a.days - b.days; })[0];
    return '<div class="card" style="margin-bottom:12px;background:var(--ok-soft);border-color:#BFE8CF"><b class="sm">🎉 «' + esc(just.title) + "» отправлена</b>" +
      '<p class="sm" style="margin:4px 0 0">' + (next ? "Следующий дедлайн — «" + esc(next.title) + "» через " + next.days + " " + plural(next.days, "день", "дня", "дней") + ". План на неё уже в задачах." : "Больше открытых подач нет. Отметь ответ вуза, когда придёт.") + "</p></div>";
  }
  function achievementsHTML() {
    var keys = Object.keys(S.cab.ach);
    if (!keys.length) return "";
    keys.sort(function (a, b) { return new Date(S.cab.ach[b]) - new Date(S.cab.ach[a]); });
    return '<div class="sub-h">Вехи</div><div class="ach-row">' + keys.slice(0, 8).map(function (k) {
      var A = Path.ACH[k]; if (!A) return "";
      return '<span class="ach" title="' + esc(A.desc) + '">' + A.ic + " " + esc(A.title) + "</span>";
    }).join("") + "</div>";
  }
  function calendarBlockHTML() {
    var m = S.calMonth || (function () { var t = todayDate(); return new Date(t.getFullYear(), t.getMonth(), 1); })();
    var marks = Path.deadlineMarks(S.programs, appViews(), (S.ans && S.ans.level) || "bachelor", todayDate(), m);
    var sel = S.calSel && marks[S.calSel] ? marks[S.calSel] : null;
    return '<div class="card" style="margin-top:14px"><div class="h-row"><b class="sm">Календарь</b><span class="xs mut" style="white-space:nowrap"><i class="cal-lg mine"></i> мои · <i class="cal-lg cat"></i> каталог</span></div>' +
      Path.calendarHTML(m, marks, todayDate()) +
      (sel ? '<div class="cal-sel">' + sel.slice(0, 6).map(function (x) {
        return '<div class="lst tappable" data-act="' + (x.mine ? "app" : "prog") + '" ' + (x.mine ? 'data-app="' + x.id + '"' : 'data-id="' + esc(x.id) + '"') + ' style="padding:8px 0"><span>' + (x.mine ? "🎯" : flag(x.cc)) + '</span><div style="flex:1;min-width:0"><b class="xs">' + esc(x.title) + "</b></div><span class=\"xs mut\">→</span></div>";
      }).join("") + "</div>" : '<p class="xs mut" style="margin:8px 0 0">Тап по дню — список программ с дедлайном в этот день.</p>') + "</div>";
  }
  function programOfWeekHTML() {
    var mine = {}; S.apps.forEach(function (a) { mine[a.program_id] = 1; });
    var pw = Path.programOfWeek(S.programs, pathCtx(), mine);
    if (!pw) return "";
    var p = pw.prog, pr = probFor(S.evalR && S.evalR.profile, p);
    var b = Path.badges(p, pathCtx());
    return '<div class="card tappable" data-act="prog" data-id="' + esc(p.id) + '" style="margin-top:14px;border-color:var(--accent-border);background:linear-gradient(135deg,#FFFFFF,#F5F3FF)">' +
      '<div class="xs" style="font-weight:800;letter-spacing:.08em;color:var(--accent-dark);text-transform:uppercase">Стипендия недели · ' + esc(pw.reason) + "</div>" +
      '<b style="display:block;margin-top:4px">' + flag(p.cc) + " " + esc(p.name) + "</b>" +
      '<div class="xs mut">' + esc(p.country || "") + (p.funding ? " · " + esc(String(p.funding).slice(0, 90)) : "") + "</div>" +
      '<div class="badges">' + b.slice(0, 4).map(function (x) { return '<span class="badge ' + (x.cls || "") + '">' + x.ic + " " + esc(x.t) + "</span>"; }).join("") + "</div>" +
      (pr ? '<div class="duo mini" style="margin-top:8px"><span><b style="color:var(--accent)">' + pct(pr.adm) + "%</b>поступл.</span>" + (pr.sch != null ? '<span><b style="color:var(--ok)">' + pct(pr.sch) + "%</b>стип.</span>" : "") + "</div>" : "") +
      "</div>";
  }
  var THEME_HOWTO = { "9-2": "ielts", "11-1": "apostille", "11-2": "translation", "12-2": "recommendation", "10-2": "medical" };
  function tipOfWeekHTML(plan) {
    var key = THEME_HOWTO[plan.theme.key] || (plan.theme.act === "doc:recommendation" ? "recommendation" : null);
    var how = key && D.HOWTO[key];
    if (!how) return aiTipHTML(appViews());
    return '<div class="aicard" style="margin-top:14px"><div class="who"><i></i>Совет недели · ' + esc(how.title) + "</div>" +
      how.steps.slice(0, 3).map(function (s, i) { return '<div class="feat"><span class="pill pill-acc">' + (i + 1) + '</span><span><b class="sm">' + esc(s.t) + "</b> <span class=\"xs mut\">" + esc(s.d) + "</span></span></div>"; }).join("") +
      '<button class="btn btn-ghost btn-sm" style="margin-top:8px" data-act="task-go" data-v="doc:' + key + '">Открыть документ</button></div>';
  }
  function contentHTML(plan) {
    var rows = Path.contentFor(S.cab.content, (S.ans && S.ans.level) || "bachelor", plan.week.n);
    if (!rows.length) return "";
    var KIND = { tip: "совет", article: "статья", video: "видео", story: "история", guide: "гайд" };
    return '<div class="sub-h">Материалы недели</div>' + rows.map(function (r) {
      var inner = '<div style="flex:1;min-width:0"><span class="xs mut">' + (KIND[r.kind] || r.kind) + (r.author ? " · " + esc(r.author) : "") + '</span><b class="sm" style="display:block">' + esc(r.title) + "</b>" + (r.body ? '<div class="xs mut">' + esc(String(r.body).slice(0, 140)) + "</div>" : "") + "</div><span class=\"xs mut\">→</span>";
      return r.url ? '<a class="lst" href="' + esc(r.url) + '" target="_blank" rel="noopener" data-act="content-open" data-id="' + r.id + '">' + inner + "</a>" : '<div class="lst">' + inner + "</div>";
    }).join("");
  }

  function renderToday() {
    var name = firstName(S.profile && S.profile.name) || "друг";
    var vs = appViews(), o = overall(), ns = nextStep();
    var plan = weekPlan(); S.plan = plan;
    var burning = vs.filter(function (v) { return !v.a.submitted_at && v.days != null; }).slice(0, 3);
    var last = S.hist.length > 1 ? S.hist[S.hist.length - 2] : null;
    var delta = last && last.p_adm != null ? Math.round((o.adm - last.p_adm) * 100) : null;
    var wide = window.matchMedia && window.matchMedia("(min-width:1240px)").matches;   // на широком экране часть блоков живёт справа

    $("tab-today").innerHTML =
      '<div class="wk-head"><div><div class="h2" style="margin:10px 0 0">Салем, ' + esc(name) + "!</div>" +
        '<div class="sm mut">Неделя <b>' + plan.week.n + "</b> из " + plan.week.total + " · " + esc(plan.week.label) + " · " + esc(plan.theme.title) + "</div></div></div>" +
      cooldownHTML(vs) +
      continueHTML() +
      (ns ? '<div class="nextstep"><div class="tag">СЛЕДУЮЩИЙ ШАГ</div><h3>' + esc(ns.title) + "</h3>" +
        '<p class="sm mut" style="margin:2px 0 10px">' + esc(ns.why) + "</p>" +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button class="btn btn-primary btn-sm" data-act="step-go" data-app="' + ns.v.a.id + '" data-doc="' + (ns.t || "") + '">' + (ns.check ? "Проверить пакет" : "Заняться сейчас") + "</button>" +
          (ns.t ? '<button class="btn btn-ghost btn-sm" data-act="step-done" data-app="' + ns.v.a.id + '" data-doc="' + ns.t + '">Уже готово</button>' : "") +
        "</div></div>" : "") +
      weekTasksHTML(plan) +
      pathHTML(plan) +
      (wide ? "" : ringsHTML()) +
      achievementsHTML() +
      (burning.length ? '<div class="sub-h">Горит первым</div>' + burning.map(function (v) {
        var light = v.days < 14 && v.rd.pct < 70 ? "bad" : v.days < 30 && v.rd.pct < 90 ? "warn" : "ok";
        return '<div class="dl tappable" data-act="app" data-app="' + v.a.id + '"><span class="dot" style="background:' + (light === "bad" ? "#C0392B" : light === "warn" ? "#A05F00" : "#0B7A3E") + '"></span>' +
          '<div style="flex:1"><b>' + esc(v.title) + '</b><span class="xs mut">' + fmtDL(v.date) + " · готовность " + v.rd.pct + "% · " + (light === "bad" ? "не успеваешь без рывка" : light === "warn" ? "риск" : "успеваешь") + "</span></div>" +
          '<span class="pill ' + dlClass(v.days) + '">' + (v.days != null ? v.days + " дн" : "—") + "</span></div>";
      }).join("") : "") +
      (vs.length ? '<div class="card tappable" data-act="chance" style="margin:14px 0">' : '<div class="card tappable" data-act="tab-unis" style="margin:14px 0"><b class="sm">Мой шанс</b><p class="xs mut" style="margin:4px 0 0">Считается по подачам: добавь первые программы во «Вузах» — и здесь появятся два процента: «хотя бы один оффер» и «хотя бы одна стипендия».</p></div><div hidden>') +
        '<div class="h-row"><b class="sm">Мой шанс</b>' + (delta != null && delta !== 0 ? '<span class="pill ' + (delta > 0 ? "pill-ok" : "pill-warn") + '">' + (delta > 0 ? "▲ +" : "▼ ") + delta + " за неделю</span>" : '<span class="pill pill-mut">динамика →</span>') + "</div>" +
        duoHTML(o, ["хотя бы один оффер", "хотя бы одна стипендия"]) + '<div class="xs mut">по ' + vs.length + " " + plural(vs.length, "подаче", "подачам", "подачам") + " · тап — динамика и «что если»</div></div>" +
      (wide ? "" : calendarBlockHTML() + programOfWeekHTML() + tipOfWeekHTML(plan) + contentHTML(plan)) +
      proCardHTML() +
      '<div class="card" style="margin-top:14px;background:var(--bg);border-style:dashed">' +
        '<div class="h-row"><div style="padding-right:10px"><b class="sm">Нужен живой человек?</b><div class="xs mut">Консультант проверит пакет и доведёт до подачи — 35 000 ₸</div></div>' +
        '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/' + (C.WHATSAPP_NUMBER || "") + '?text=' + encodeURIComponent("Здравствуйте! Хочу пакет «Документы и подача» за 35 000 ₸") + '">Написать</a></div></div>';
    if (window.track) track("cab_week_view", { week: plan.week.n, tasks: plan.tasks.length, done: plan.tasks.filter(function (t) { return t.status === "done"; }).length });
  }

  /* ---------- Scholary Pro на виду ----------
     Раньше подписка жила одной строкой в «Профиле», визуально неотличимой
     от «Помощи»: человек проходил весь кабинет и ни разу не узнавал, что
     платный тариф вообще существует. Продаём не «подписку», а конкретный
     результат — и показываем его там, где ценность ощущается. */
  function isPro() { return !!(S.profile && S.profile.pro_until && new Date(S.profile.pro_until) > new Date()); }
  function proCardHTML() {
    if (isPro()) {
      return '<div class="card" style="margin-top:14px;border-color:var(--ok);background:var(--ok-soft)">' +
        '<div class="h-row"><div style="padding-right:10px"><b class="sm">Scholary Pro активна</b>' +
        '<div class="xs mut">До ' + fmtDL(new Date(S.profile.pro_until)) + " · 60 разборов ИИ в день</div></div>" +
        '<span class="pill pill-ok">Pro</span></div></div>';
    }
    var plan = docPlanNow();
    var toCheck = plan.filter(function (p) { return p.required && p.status !== "ready"; }).length;
    var letters = plan.filter(function (p) { return p.t === "motivation" && p.status !== "ready"; }).length;
    /* Аргумент подбираем под ситуацию человека, а не один текст на всех. */
    var line = letters
      ? "Мотивационное письмо переписывают по 3–4 круга. На Pro каждый круг разбирает модель посильнее — и не 8 раз в день, а 60."
      : toCheck >= 4
        ? "У тебя " + toCheck + " " + plural(toCheck, "документ", "документа", "документов") + " ещё в работе. На Pro их можно прогонять через ИИ, не оглядываясь на лимит."
        : "Симулятор «что если» показывает, какое действие поднимет твой шанс сильнее всего — и стоит ли оно того.";
    return '<div class="card tappable" data-act="subscribe" style="margin-top:14px;border:1.5px solid var(--accent);box-shadow:0 0 0 4px var(--accent-soft)">' +
      '<div class="h-row"><b class="sm">Scholary Pro</b><span class="pill pill-acc">14 900 ₸ за сезон</span></div>' +
      '<p class="sm" style="margin:6px 0 10px">' + esc(line) + "</p>" +
      '<div class="xs mut" style="margin-bottom:10px">⚡ 60 разборов ИИ в день вместо 8 · модель посильнее · симулятор «что если» · приоритетные напоминания о дедлайнах</div>' +
      '<button class="btn btn-primary btn-sm btn-block" data-act="subscribe">Что входит в Pro</button></div>';
  }
  function aiTipHTML(vs) {
    var tip = null;
    var apostille = vs.filter(function (v) { return !v.a.submitted_at && v.rd.missing.some(function (m) { return m.t === "apostille"; }); });
    var letters = vs.filter(function (v) { return !v.a.submitted_at && v.rd.missing.some(function (m) { return m.t === "motivation"; }); });
    var mon = new Date().getMonth();
    if (apostille.length >= 2) tip = "Апостиль нужен сразу для " + apostille.length + " " + plural(apostille.length, "подачи", "подач", "подач") + ", а делается он до 20 рабочих дней. Закажи один раз на все — сэкономишь три недели.";
    else if (letters.length >= 2) tip = "У тебя " + letters.length + " " + plural(letters.length, "письмо", "письма", "писем") + " без черновика. Начни с самого раннего дедлайна: письма правятся по 3–4 версии.";
    else if (mon >= 9 && mon <= 11) tip = "Ноябрь–декабрь — месяцы документов. Всё, что делается дольше двух недель (апостиль, справки, рекомендации), запускай сейчас.";
    else tip = "Раз в неделю проверяй сроки действия документов: сертификат, истекающий до дедлайна, — самая обидная причина отказа.";
    return '<div class="aicard" style="margin-top:14px"><div class="who"><i></i>Совет · по твоим данным</div><span class="sm">' + esc(tip) + "</span></div>";
  }

  /* ================= 2 · ПОДАЧИ ================= */
  var appsFilter = "all";   // по умолчанию показываем ВСЕ подачи: фильтр «Горит» прятал портфель
  function renderApps() {
    var vs = appViews();
    var hot = vs.filter(function (v) { return !v.a.submitted_at && v.days != null && v.days < 90; });
    var sent = vs.filter(function (v) { return v.a.submitted_at; });
    var list = appsFilter === "hot" ? (hot.length ? hot : vs.filter(function (v) { return !v.a.submitted_at; }))
             : appsFilter === "sent" ? sent : vs;
    $("tab-apps").innerHTML =
      '<div class="h-row" style="margin:10px 0 8px"><div class="h2" style="margin:0">Подачи</div><span class="pill pill-mut">' + vs.length + " " + plural(vs.length, "программа", "программы", "программ") + "</span></div>" +
      '<div class="seg2">' +
        '<button data-act="af" data-v="hot" class="' + (appsFilter === "hot" ? "on" : "") + '">Горит · ' + hot.length + "</button>" +
        '<button data-act="af" data-v="all" class="' + (appsFilter === "all" ? "on" : "") + '">Все · ' + vs.length + "</button>" +
        '<button data-act="af" data-v="sent" class="' + (appsFilter === "sent" ? "on" : "") + '">Отпр. · ' + sent.length + "</button>" +
      "</div>" +
      (list.length ? list.map(appCard).join("") : emptyApps()) +
      '<button class="btn btn-soft btn-block" style="margin-top:6px" data-act="tab-unis">+ Добавить программу из каталога</button>' +
      '<button class="btn btn-ghost btn-block" style="margin-top:8px" data-act="custom-add">Своя программа по ссылке</button>';
  }
  function emptyApps() {
    return '<div class="empty"><div class="art">🎯</div><h3>Здесь пока пусто</h3>' +
      "<p>Добавь программы — к каждой сразу придёт чек-лист документов и дедлайны.</p></div>";
  }
  function appCard(v) {
    var blockers = v.rd.missing.filter(function (m) { var T = D.TYPES[m.t]; return T && v.days != null && v.days <= T.lead + 14; });
    return '<div class="prog tappable" data-act="app" data-app="' + v.a.id + '">' +
      '<div class="h-row" style="align-items:flex-start">' +
        '<div style="flex:1;min-width:0"><b>' + flag(v.cc) + " " + esc(v.title) + "</b>" +
        '<div class="xs mut">' + esc(v.country || "") + (v.date ? " · " + fmtDL(v.date) : "") + (v.a.submitted_at ? " · отправлена" : "") + "</div>" +
        (v.p ? '<div class="duo mini"><span><b style="color:var(--accent)">' + pct(v.p.adm) + '%</b>поступл.</span>' +
          (v.p.sch != null ? '<span><b style="color:var(--ok)">' + pct(v.p.sch) + '%</b>стип.</span>' : '<span class="xs mut">обучение 0 ₸</span>') + "</div>" : "") +
        "</div>" + ringHTML(v.rd.pct) + "</div>" +
      (v.prog && v.prog.available_kz === false
        ? '<div class="verd bad" style="margin-top:10px"><span>⛔</span><span><b>Подать нельзя</b>' +
          esc(v.prog.unavailable_note || "Программа сейчас недоступна для граждан Казахстана.") +
          " Убери её из подач, чтобы она не тянула вниз общий процент.</span></div>"
        : "") +
      (v.a.outcome ? '<div class="verd ' + (v.a.outcome === "admit" ? "ok" : v.a.outcome === "reject" ? "bad" : "warn") + '" style="margin-top:10px"><span>' + (v.a.outcome === "admit" ? "🎉" : v.a.outcome === "reject" ? "⛔" : "⏳") + '</span><span><b>' + L.outcome[v.a.outcome] + "</b></span></div>"
        : v.a.submitted_at ? '<div class="verd ok" style="margin-top:10px"><span>✅</span><span><b>Отправлена ' + fmtDL(new Date(v.a.submitted_at)) + "</b>Ждём ответ — отметь его, когда придёт.</span></div>"
        : blockers.length ? '<div class="verd warn" style="margin-top:10px"><span>⏰</span><span><b>' + (v.days != null ? "Осталось " + v.days + " " + plural(v.days, "день", "дня", "дней") + " · " : "") + blockers.length + " " + plural(blockers.length, "блокер", "блокера", "блокеров") + "</b>" +
            esc(blockers.map(function (m) { return (D.TYPES[m.t] || {}).title || m.t; }).join(", ")) + "</span></div>"
        : "") +
      '<div class="pb" style="margin-top:10px"><i style="width:' + v.rd.pct + '%;background:' + (v.rd.pct >= 80 ? "#0B7A3E" : v.rd.pct >= 50 ? "#A05F00" : "#C0392B") + '"></i></div>' +
      "</div>";
  }

  /* ---------- паспорт подачи ---------- */
  var appTab = "check";
  function openApp(id) {
    var a = S.apps.filter(function (x) { return x.id === +id; })[0];
    if (!a) return;
    appTab = "check";
    openSub(function () { return appDetailHTML(a); });
  }
  function appDetailHTML(a) {
    var v = appView(a); if (!v) return subHead("Подача") + '<div class="card">Программа не найдена</div>';
    var body = "";
    if (appTab === "check") body = appChecklistHTML(v);
    if (appTab === "req") body = appReqHTML(v);
    if (appTab === "letter") body = appLetterHTML(v);
    if (appTab === "note") body = appNoteHTML(v);
    return subHead(v.title, (v.country || "") + (v.date ? " · дедлайн " + fmtDL(v.date) : "")) +
      '<div class="card" style="margin-bottom:12px">' +
        '<div class="h-row"><div>' + (v.p ? duoHTML({ adm: v.p.adm, sch: v.p.sch }) : "") + "</div>" + ringHTML(v.rd.pct, 58) + "</div>" +
        '<div class="h-row" style="margin-top:6px"><span class="xs mut">' + v.rd.done + " из " + v.rd.total + " документов</span>" +
        (v.days != null ? '<span class="pill ' + dlClass(v.days) + '">' + v.days + " " + plural(v.days, "день", "дня", "дней") + "</span>" : "") + "</div></div>" +
      '<div class="seg2">' +
        ["check|Чек-лист", "req|Требования", "letter|Письмо", "note|Заметки"].map(function (s) {
          var p = s.split("|");
          return '<button data-act="apptab" data-v="' + p[0] + '" data-app="' + a.id + '" class="' + (appTab === p[0] ? "on" : "") + '">' + p[1] + "</button>";
        }).join("") + "</div>" + body;
  }
  function appChecklistHTML(v) {
    var rows = v.rd.required.map(function (r) {
      var T = D.TYPES[r.t] || { title: r.t, ic: "📄" };
      var d = docFor(r.t, v.a.program_id);
      var done = v.a.checklist[r.t] === true || (d && d.status === "ready");
      return '<div class="lst"><button class="cbox ' + (done ? "on" : "") + '" data-act="ck" data-app="' + v.a.id + '" data-doc="' + r.t + '">' + (done ? "✓" : "") + "</button>" +
        '<div style="flex:1;min-width:0"><b class="sm">' + T.ic + " " + esc(T.title) + "</b>" +
        '<div class="xs mut">' + esc(r.why || T.hint || "") + (d && d.expires_on ? " · до " + fmtDL(new Date(d.expires_on)) : "") + "</div></div>" +
        (d ? '<button class="btn btn-ghost btn-sm" data-act="doc" data-id="' + d.id + '">Открыть</button>'
           : '<button class="btn btn-soft btn-sm" data-act="doc-new" data-doc="' + r.t + '" data-app="' + v.a.id + '">Добавить</button>') + "</div>";
    }).join("");
    var cta = v.a.submitted_at
      ? '<div class="card" style="margin-top:12px"><b class="sm">Подача отправлена ' + fmtDL(new Date(v.a.submitted_at)) + "</b>" +
        '<p class="xs mut" style="margin:4px 0 10px">Когда придёт ответ — отметь его: это уточняет расчёт для тех, кто идёт следом.</p>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        ["admit|Принята|btn-primary", "reject|Отказ|btn-ghost", "waitlist|Лист ожидания|btn-ghost"].map(function (s) {
          var p = s.split("|"); return '<button class="btn ' + p[2] + ' btn-sm" data-act="outcome" data-v="' + p[0] + '" data-app="' + v.a.id + '">' + p[1] + "</button>";
        }).join("") + "</div></div>"
      : '<button class="btn btn-primary btn-block" style="margin-top:12px" data-act="presubmit" data-app="' + v.a.id + '">Проверить перед отправкой</button>';
    return rows + cta +
      '<div class="segstatus"><span class="xs mut">Статус подачи</span><div class="seg" style="margin-top:6px">' +
      ["study|Изучаю", "prep|Готовлю", "applied|Подала"].map(function (s) {
        var p = s.split("|");
        return '<button data-act="status" data-v="' + p[0] + '" data-app="' + v.a.id + '" class="' + (v.a.status === p[0] ? "on" : "") + '">' + p[1] + "</button>";
      }).join("") + "</div></div>";
  }
  function appReqHTML(v) {
    var r = v.prog.req || {}, ax = S.evalR ? S.evalR.profile.axes : null;
    var need = D.ieltsFromAxis(r.language);
    function row(label, ok, txt) {
      return '<div class="lst"><span class="' + (ok ? "okmark" : "warnmark") + '">' + (ok ? "✓" : "!") + "</span>" +
        '<div style="flex:1"><b class="sm">' + esc(label) + '</b><div class="xs mut">' + esc(txt) + "</div></div></div>";
    }
    return '<div class="card" style="margin-bottom:12px">' +
      (r.academics != null && ax ? row("Успеваемость", ax.academics >= r.academics, ax.academics >= r.academics ? "твой уровень выше типичного порога" : "ниже типичного порога — компенсируй письмом и достижениями") : "") +
      (need ? row("Язык · IELTS ≈ " + need.toFixed(1), ax && ax.language >= r.language, (S.ans.ielts_band ? "у тебя " + (L.ielts[S.ans.ielts_band] || S.ans.ielts_band) : "балл не указан")) : row("Язык", true, "формального порога нет")) +
      (r.budget != null ? row("Бюджет", ax && ax.budget >= r.budget, r.budget === 0 ? "программа с полным покрытием" : "нужен собственный бюджет") : "") +
      "</div>" +
      '<div class="card" style="margin-bottom:12px"><b class="sm">Финансирование</b><p class="sm" style="margin:6px 0 0">' + esc(v.prog.funding || "уточняется") + "</p>" +
      (v.prog.note ? '<p class="xs mut" style="margin:8px 0 0">' + esc(v.prog.note) + "</p>" : "") + "</div>" +
      (v.prog.source_url ? '<a class="btn btn-ghost btn-block" href="' + esc(v.prog.source_url) + '" target="_blank" rel="noopener">Официальная страница программы</a>' : "") +
      '<p class="xs mut" style="margin-top:10px">Требования и дедлайны — ориентировочные, программы их меняют. Перед подачей всегда сверяйся с официальным сайтом. <a href="#" data-act="report-err" data-app="' + v.a.id + '">Сообщить об ошибке</a></p>';
  }
  function appLetterHTML(v) {
    var d = docFor("motivation", v.a.program_id);
    if (!d || !d.content) {
      return '<div class="empty"><div class="art">✍️</div><h3>Письма ещё нет</h3>' +
        "<p>Ответишь на 4 вопроса — соберём каркас под эту программу. Дальше правишь своими словами.</p>" +
        '<button class="btn btn-primary" data-act="letter-wizard" data-app="' + v.a.id + '">Собрать черновик</button></div>';
    }
    var rev = D.letterReview(d.content, v.prog, S.ans);
    return '<div class="card" style="margin-bottom:12px"><div class="h-row"><div><b>Оценка ' + rev.score.toFixed(1) + "</b><div class='xs mut'>" + rev.words + " слов · версия " + (d.version || 1) + "</div></div>" +
      '<button class="btn btn-primary btn-sm" data-act="letter" data-id="' + d.id + '">Редактировать</button></div>' +
      rev.criteria.map(function (c) {
        return '<div class="pb-line"><span class="nm">' + esc(c.k) + '</span><div class="pb"><i style="width:' + c.v * 10 + "%;background:" + (c.v >= 7 ? "#5B4BFF" : "#E5C558") + '"></i></div><span class="v">' + c.v.toFixed(1) + "</span></div>";
      }).join("") + "</div>" +
      rev.verdicts.slice(0, 4).map(verdHTML).join("");
  }
  function appNoteHTML(v) {
    return '<div class="card"><b class="sm">Заметки по подаче</b>' +
      '<textarea class="f ta" id="app-note" placeholder="Логин на портале, номер заявки, с кем говорила…">' + esc(v.a.note || "") + "</textarea>" +
      '<button class="btn btn-ghost btn-sm" style="margin-top:8px" data-act="note-save" data-app="' + v.a.id + '">Сохранить</button></div>';
  }

  /* ---------- финальная проверка перед отправкой ---------- */
  function openPresubmit(id) {
    var a = S.apps.filter(function (x) { return x.id === +id; })[0]; if (!a) return;
    var v = appView(a);
    var apps = appsForDoc();
    var vers = [];
    v.rd.required.forEach(function (r) {
      var d = docFor(r.t, a.program_id), T = D.TYPES[r.t] || { title: r.t };
      if (!d || d.status !== "ready") {
        if (v.a.checklist[r.t] === true) vers.push({ level: "ok", title: T.title, text: "Отмечено готовым вручную." });
        else vers.push({ level: "blocker", title: T.title + " — не готов", text: (r.why || T.hint || "") + (T.lead ? " · ориентировочно " + T.lead + " " + plural(T.lead, "день", "дня", "дней") + " на изготовление" : "") });
      } else {
        var dv = D.checkDocument(d, apps.filter(function (x) { return x.program_id === a.program_id; }), S.ans, S.evalR && S.evalR.profile);
        var bad = dv.filter(function (x) { return x.level !== "ok"; });
        if (bad.length) vers = vers.concat(bad.map(function (b) { return { level: b.level, title: T.title + ": " + b.title, text: b.text, source: b.source }; }));
        else vers.push({ level: "ok", title: T.title, text: "Проверен, замечаний нет." });
      }
    });
    var blockers = vers.filter(function (x) { return x.level === "blocker"; }).length;
    openSub(function () {
      return subHead("Проверка перед отправкой", v.title) +
        '<div class="card" style="margin-bottom:12px"><div class="h-row"><b>' + (blockers ? blockers + " " + plural(blockers, "блокер", "блокера", "блокеров") : "Блокеров нет") + "</b>" +
        '<span class="pill ' + (blockers ? "pill-bad" : "pill-ok") + '">' + v.rd.pct + "% готово</span></div></div>" +
        vers.sort(function (x, y) { var o = { blocker: 0, warn: 1, ok: 2 }; return o[x.level] - o[y.level]; }).map(verdHTML).join("") +
        '<div class="card" style="margin-top:12px' + (blockers ? ";border-color:#F3C7CF" : "") + '"><b class="sm">Отметить как отправленную?</b>' +
        '<p class="xs mut" style="margin:4px 0 10px">' + (blockers ? "Есть незакрытые блокеры. Если пакет уже ушёл как есть — отметим, но зафиксируем риск." : "Всё на месте. После отметки подача уйдёт в режим ожидания ответа.") + "</p>" +
        '<div style="display:flex;gap:8px"><button class="btn btn-ghost btn-sm" data-act="back">Сначала исправлю</button>' +
        '<button class="btn ' + (blockers ? "btn-ghost" : "btn-primary") + ' btn-sm" data-act="submit" data-app="' + a.id + '">Отправила</button></div></div>' +
        '<p class="xs mut" style="margin-top:10px">Проверка идёт по требованиям программ и правилам Scholary. Это не заменяет чтение официального сайта программы.</p>';
    });
  }

  /* ================= 4 · ДОКУМЕНТЫ =================
     Не список файлов, а план сбора. Человек должен за две секунды
     понять три вещи: сколько собрано, что горит и что делать сегодня.
     Порядок задаёт критический путь из doc-rules (docPlan): срок
     изготовления + зависимости против ближайшего дедлайна. */
  function docPlanNow() { return D.docPlan(appsForDoc(), S.docs, S.ans); }
  /* Типы документов, актуальные для этого человека — из того же плана,
     чтобы счётчик на вкладке «Сегодня» и модалка загрузки не расходились
     со списком на вкладке «Документы». */
  function docTypesForUser() {
    var out = docPlanNow().filter(function (p) { return p.required; }).map(function (p) { return p.t; });
    return out.length ? out : ["diploma", "passport", "ielts", "motivation"];
  }

  function docWarned(d) {
    if (!d || !d.verdicts) return false;
    var v = Array.isArray(d.verdicts) ? d.verdicts : (d.verdicts.verdicts || []);
    return v.some(function (x) { return x.level === "blocker"; });
  }
  function docStatusPill(p) {
    var warn = docWarned(p.doc);
    if (p.status === "ready") return warn ? '<span class="pill pill-warn">есть замечания</span>' : '<span class="pill pill-ok">готов</span>';
    if (p.status === "progress") return '<span class="pill pill-acc">в работе</span>';
    return '<span class="pill pill-mut">нет</span>';
  }
  /* Строка сроков — главная новая информация экрана. */
  function docTimingHTML(p) {
    if (!p.required) return '<div class="xs mut">' + esc(p.why) + "</div>";
    if (p.status === "ready") {
      return '<div class="xs mut">Нужен для ' + p.usesCount + " " + plural(p.usesCount, "подачи", "подач", "подач") + " · закрыт</div>";
    }
    var made = "≈" + p.chainLead + " " + plural(p.chainLead, "день", "дня", "дней") + " на изготовление";
    var line;
    if (p.daysToStart == null) line = made;
    else if (p.daysToStart < 0) {
      var late = -p.daysToStart;
      line = '<b style="color:var(--bad)">Начать нужно было ' + late + " " + plural(late, "день", "дня", "дней") + " назад</b> · " + made;
    } else if (p.daysToStart === 0) line = '<b style="color:var(--bad)">Начать сегодня</b> · ' + made;
    else line = "Начать до " + fmtDL(p.startBy) + " · " + made;
    return '<div class="xs mut">Нужен для ' + p.usesCount + " " + plural(p.usesCount, "подачи", "подач", "подач") +
      (p.nearestTitle ? " · ближайшая «" + esc(p.nearestTitle) + "»" : "") + "</div>" +
      '<div class="xs" style="margin-top:3px">' + line + "</div>" +
      (p.blockedBy ? '<div class="xs" style="margin-top:3px;color:var(--accent-dark)">⛓ Только после: ' + esc((D.TYPES[p.blockedBy] || {}).title || p.blockedBy) + "</div>" : "");
  }
  /* Та же информация о сроках, но простым текстом — для карточки документа. */
  function docTimingText(p) {
    var parts = [];
    parts.push("Нужен для " + p.usesCount + " " + plural(p.usesCount, "подачи", "подач", "подач"));
    if (p.nearestTitle) parts.push("ближайшая «" + p.nearestTitle + "»" + (p.nearest ? " до " + fmtDL(p.nearest) : ""));
    if (p.status !== "ready") {
      parts.push("делается ≈" + p.chainLead + " " + plural(p.chainLead, "день", "дня", "дней"));
      if (p.daysToStart != null && p.daysToStart < 0) parts.push("начать нужно было " + (-p.daysToStart) + " " + plural(-p.daysToStart, "день", "дня", "дней") + " назад");
      else if (p.startBy) parts.push("начать до " + fmtDL(p.startBy));
    }
    if (p.blockedBy) parts.push("только после: " + ((D.TYPES[p.blockedBy] || {}).title || p.blockedBy));
    return parts.join(" · ");
  }
  function docCardHTML(p) {
    var d = p.doc;
    var bg = p.status === "ready" ? "var(--ok-soft)" : p.status === "progress" ? "var(--accent-soft)" : "var(--bg)";
    return '<div class="doc tappable" data-act="' + (d ? "doc" : "doc-new") + '" data-id="' + (d ? d.id : "") + '" data-doc="' + p.t + '">' +
      '<div class="ic" style="background:' + bg + '">' + p.T.ic + "</div>" +
      '<div style="flex:1;min-width:0"><b class="sm">' + esc(p.T.title) + "</b>" + docTimingHTML(p) + "</div>" +
      docStatusPill(p) + "</div>";
  }
  function docGroupHTML(title, note, list) {
    if (!list.length) return "";
    return '<div class="sub-h">' + title + "</div>" +
      (note ? '<p class="xs mut" style="margin:-2px 0 8px">' + note + "</p>" : "") +
      list.map(docCardHTML).join("");
  }

  /* ---- сетка документов (web-74) ----
     Раньше — длинный список длинных блоков. Теперь: общая картина сверху и
     компактные квадратные карточки, в которых видно всё нужное сразу:
     статус, для скольких подач, срок изготовления, «начать до», цепочка,
     замечания. Группы прежние — по критическому пути. */
  function docGridCard(p) {
    var d = p.doc, warn = docWarned(d);
    var requested = d && (d.fields || {}).requested_at;
    var st = p.status === "ready" ? (warn ? '<span class="pill pill-warn">замечания</span>' : '<span class="pill pill-ok">готов</span>')
           : p.status === "progress" ? (requested && p.t === "recommendation" ? '<span class="pill pill-acc">запрошено</span>' : '<span class="pill pill-acc">в работе</span>')
           : '<span class="pill pill-mut">нет</span>';
    var line = "";
    if (p.status !== "ready") {
      if (p.daysToStart != null && p.daysToStart < 0) line = '<span class="bad">старт просрочен на ' + (-p.daysToStart) + " " + plural(-p.daysToStart, "день", "дня", "дней") + "</span>";
      else if (p.daysToStart === 0) line = '<span class="bad">начать сегодня</span>';
      else if (p.startBy) line = "начать до " + fmtD(p.startBy);
      else line = "срок не горит";
    } else line = "закрыт";
    var exp = d && d.expires_on ? new Date(d.expires_on) : null;
    var expBad = exp && p.nearest && exp < p.nearest;
    return '<button class="dcard tappable" data-act="' + (d ? "doc" : "doc-new") + '" data-id="' + (d ? d.id : "") + '" data-doc="' + p.t + '">' +
      '<div class="dcard-top"><span class="dic" style="background:' + (p.status === "ready" ? "var(--ok-soft)" : p.status === "progress" ? "var(--accent-soft)" : "var(--bg)") + '">' + p.T.ic + "</span>" + st + "</div>" +
      '<b class="dcard-t">' + esc(p.T.title) + "</b>" +
      '<div class="xs mut dcard-m">' + (p.required ? "для " + p.usesCount + " " + plural(p.usesCount, "подачи", "подач", "подач") : "дополнительно") + " · ≈" + p.chainLead + " " + plural(p.chainLead, "день", "дня", "дней") + "</div>" +
      '<div class="xs dcard-l">' + line + "</div>" +
      (p.blockedBy ? '<div class="xs" style="color:var(--accent-dark)">⛓ после: ' + esc((D.TYPES[p.blockedBy] || {}).title || p.blockedBy).split(" ")[0].toLowerCase() + "</div>" : "") +
      (expBad ? '<div class="xs" style="color:var(--bad)">истекает до дедлайна</div>' : "") +
      (d && d.file_path ? '<div class="xs mut">📎 файл</div>' : "") +
      "</button>";
  }
  function docGridGroup(title, note, list) {
    if (!list.length) return "";
    return '<div class="sub-h">' + title + (note ? ' <span class="xs mut" style="text-transform:none;letter-spacing:0;font-weight:600">· ' + note + "</span>" : "") + "</div>" +
      '<div class="dgrid">' + list.map(docGridCard).join("") + "</div>";
  }
  /* Критический путь: самая длинная цепочка и ближайший старт. */
  function docOverviewHTML(plan, s, vs) {
    var req = plan.filter(function (p) { return p.required; });
    var longest = req.slice().sort(function (a, b) { return b.chainLead - a.chainLead; })[0];
    var nextStart = req.filter(function (p) { return p.status !== "ready" && p.startBy; }).sort(function (a, b) { return a.startBy - b.startBy; })[0];
    var nearest = vs.filter(function (v) { return !v.a.submitted_at && v.date; }).sort(function (a, b) { return a.date - b.date; })[0];
    return '<div class="card" style="margin-bottom:14px">' +
      '<div class="h-row"><div style="padding-right:12px"><b class="sm">Собрано ' + s.ready + " из " + s.required + "</b>" +
        '<div class="xs mut" style="margin-top:2px">обязательных по твоим ' + vs.length + " " + plural(vs.length, "подаче", "подачам", "подачам") + "</div></div>" + ringHTML(s.pct, 52) + "</div>" +
      '<div class="dstats"><span><b>' + s.ready + "</b>готово</span><span><b>" + s.progress + "</b>в работе</span><span><b>" + s.none + "</b>не начато</span>" + (s.optional ? "<span><b>" + s.optional + "</b>дополнительно</span>" : "") + "</div>" +
      (longest ? '<div class="xs mut" style="margin-top:10px">Самая длинная цепочка: <b>' + esc(longest.T.title) + "</b> — ≈" + longest.chainLead + " " + plural(longest.chainLead, "день", "дня", "дней") +
        (nearest ? " · ближайший дедлайн «" + esc(nearest.title) + "» " + fmtDL(nearest.date) : "") + "</div>" : "") +
      (nextStart ? '<div class="xs" style="margin-top:4px">' + (nextStart.startBy < todayDate()
          ? 'Начать первым: <b>' + esc(nextStart.T.title) + "</b> — старт был нужен " + fmtDL(nextStart.startBy) + ", дальше только срочный тариф"
          : 'Следующий старт: <b>' + esc(nextStart.T.title) + "</b> — до " + fmtDL(nextStart.startBy)) + "</div>" : "") +
      (s.overdue
        ? '<div class="verd bad" style="margin:12px 0 0"><span>🔴</span><div><b>Старт просрочен: ' + s.overdue + " " + plural(s.overdue, "документ", "документа", "документов") + "</b>Это ещё не провал: сроки обычно можно ужать срочным тарифом. Но начинать надо сегодня.</div></div>"
        : s.now
          ? '<div class="verd warn" style="margin:12px 0 0"><span>⏳</span><div><b>Пора начинать: ' + s.now + " " + plural(s.now, "документ", "документа", "документов") + "</b>У них длинный срок изготовления, а дедлайн уже близко.</div></div>"
          : s.ready === s.required && s.required
            ? '<div class="verd ok" style="margin:12px 0 0"><span>✅</span><div><b>Обязательные документы собраны</b>Проверь пакет перед отправкой — это последняя точка, где ошибку ещё можно поймать.</div></div>'
            : '<div class="verd ok" style="margin:12px 0 0"><span>👌</span><div><b>Сроки пока не горят</b>Начни с того, что делается дольше всего — это всегда апостиль и перевод.</div></div>') +
      "</div>";
  }
  /* Типовой набор, когда подач ещё нет: честно помечен как типовой. */
  function docTypicalHTML() {
    var lvl = (S.ans && S.ans.level) || "bachelor";
    var types = lvl === "bachelor" ? ["diploma", "passport", "ielts", "motivation", "apostille", "translation", "photo"]
              : lvl === "phd" ? ["diploma", "passport", "ielts", "motivation", "recommendation", "cv", "research", "apostille", "translation"]
              : ["diploma", "passport", "ielts", "motivation", "recommendation", "cv", "apostille", "translation"];
    return '<div class="card" style="margin-bottom:14px;background:var(--accent-soft);border-color:var(--accent-border)"><b class="sm">Типовой набор для ' + esc((L.level[lvl] || "").toLowerCase()) + "</b>" +
      '<p class="xs mut" style="margin:4px 0 0">Точный список со сроками появится, когда добавишь программы: у Венгрии и Кореи он разный. Пока — что обычно просят.</p></div>' +
      '<div class="dgrid">' + types.map(function (t) {
        var T = D.TYPES[t], d = docsOfType(t)[0];
        return '<button class="dcard tappable" data-act="' + (d ? "doc" : "doc-new") + '" data-id="' + (d ? d.id : "") + '" data-doc="' + t + '">' +
          '<div class="dcard-top"><span class="dic" style="background:' + (d && d.status === "ready" ? "var(--ok-soft)" : "var(--bg)") + '">' + T.ic + "</span>" +
          (d ? (d.status === "ready" ? '<span class="pill pill-ok">готов</span>' : '<span class="pill pill-acc">в работе</span>') : '<span class="pill pill-mut">типовой</span>') + "</div>" +
          '<b class="dcard-t">' + esc(T.title) + '</b><div class="xs mut dcard-m">≈' + T.lead + " " + plural(T.lead, "день", "дня", "дней") + "</div>" +
          '<div class="xs dcard-l">' + esc(T.hint || "") + "</div></button>";
      }).join("") + "</div>" +
      '<button class="btn btn-primary btn-block" style="margin-top:14px" data-act="tab-unis">Выбрать программы</button>';
  }

  function renderDocs() {
    var vs = appViews();
    if (!vs.length) {
      $("tab-docs").innerHTML = '<div class="h2" style="margin:10px 0 10px">Документы</div>' + docTypicalHTML() +
        '<div class="upload tappable" data-act="doc-pick" style="margin-top:14px">＋ Загрузить документ<div class="xs">PDF, JPG или PNG · до 10 МБ</div></div>';
      return;
    }
    var plan = docPlanNow(), s = D.planSummary(plan);
    var g = function (u) { return plan.filter(function (p) { return p.urgency === u; }); };
    var nowList = g("overdue").concat(g("now"));
    var rec = plan.filter(function (p) { return p.t === "recommendation" && p.status !== "ready"; })[0];

    $("tab-docs").innerHTML =
      '<div class="h2" style="margin:10px 0 10px">Документы</div>' +
      docOverviewHTML(plan, s, vs) +
      (rec ? '<div class="card tappable" data-act="rec-request" style="margin-bottom:14px;border-color:var(--accent-border)"><div class="h-row"><div style="padding-right:10px"><b class="sm">📮 Попросить рекомендацию</b>' +
        '<div class="xs mut">' + (rec.doc && (rec.doc.fields || {}).requested_at ? "Запрошено " + fmtDL(new Date(rec.doc.fields.requested_at)) + " · напомни через неделю" : "Готовый текст письма учителю: программа, дедлайн, что приложить") + "</div></div><span class=\"pill pill-acc\">→</span></div></div>" : "") +
      docGridGroup("Начать сейчас", "дольше всего делаются, дедлайн ближе всего", nowList) +
      docGridGroup("Скоро", "начинать в ближайший месяц", g("soon")) +
      docGridGroup("Можно позже", "срок позволяет", g("later")) +
      docGridGroup("Готово", "", g("done")) +
      docGridGroup("Дополнительные", "не требует ни одна программа, но усиливают", g("optional")) +
      '<div class="upload tappable" data-act="doc-pick" style="margin-top:14px">＋ Загрузить документ<div class="xs">PDF, JPG или PNG · до 10 МБ · сразу проверим по требованиям твоих программ</div></div>' +
      proCardHTML() +
      '<div class="lst tappable" data-act="doc-help" style="margin-top:12px"><div style="flex:1"><b class="sm">Что делать, если…</b>' +
        '<div class="xs mut">не тот формат · нет документа на руках · файл не открывается</div></div><span class="xs mut">→</span></div>' +
      '<p class="xs mut" style="margin-top:12px">Файлы видишь только ты: доступ закрыт по твоему аккаунту. <a href="/privacy/" target="_blank" rel="noopener">Как мы храним данные</a></p>';
  }

  /* ---- письмо учителю с просьбой о рекомендации ---- */
  function recLetterText(lang) {
    var vs = appViews().filter(function (v) { return !v.a.submitted_at; }).slice(0, 3);
    var name = (S.profile && S.profile.name) || "";
    var progs = vs.map(function (v) { return v.title + (v.date ? " (до " + fmtDL(v.date) + ")" : ""); }).join(", ");
    var first = vs[0], deadline = first && first.date ? fmtDL(new Date(first.date.getTime() - 14 * 864e5)) : "за две недели до дедлайна";
    if (lang === "en") {
      return "Dear [Name],\n\nI am applying to " + (progs || "several international programmes") + " and would be honoured if you could write a letter of recommendation for me. " +
        "You taught me [subject] and know my work on [project / achievement].\n\nWhat they ask for: 1–2 pages, on official letterhead if possible, signed, in English. " +
        "I would need it by " + deadline + ". I will attach my CV, a short summary of the programme and my motivation letter so it takes as little of your time as possible.\n\nThank you very much,\n" + name;
    }
    return "Здравствуйте, [Имя Отчество]!\n\nЯ подаю документы на " + (progs || "несколько зарубежных программ") + " и буду очень благодарен(-на), если вы напишете мне рекомендательное письмо. " +
      "Вы вели у меня [предмет] и знаете мою работу над [проект / достижение].\n\nЧто просит программа: 1–2 страницы, по возможности на бланке школы/вуза, с подписью, на английском (перевод могу взять на себя). " +
      "Письмо нужно к " + deadline + ". Я приложу CV, краткое описание программы и своё мотивационное письмо, чтобы это заняло у вас минимум времени.\n\nСпасибо большое!\n" + name;
  }
  function openRecRequest() {
    S.recLang = S.recLang || "ru";
    openSub(function () {
      var txt = recLetterText(S.recLang);
      var rec = docsOfType("recommendation")[0];
      return subHead("Попросить рекомендацию", "письмо учителю или преподавателю") +
        '<div class="card" style="margin-bottom:12px"><b class="sm">Кого просить</b><div class="feat">1️⃣ Преподаватель профильного предмета — знает твою работу</div><div class="feat">2️⃣ Научрук / классный руководитель — знает тебя как человека</div>' +
        '<p class="xs mut" style="margin:6px 0 0">Просить за 3 недели до дедлайна: преподаватели пишут медленно, в сессию — ещё медленнее.</p></div>' +
        '<div class="seg2"><button data-act="rec-lang" data-v="ru" class="' + (S.recLang === "ru" ? "on" : "") + '">По-русски</button><button data-act="rec-lang" data-v="en" class="' + (S.recLang === "en" ? "on" : "") + '">In English</button></div>' +
        '<textarea class="f ta big" id="rec-text" style="min-height:260px">' + esc(txt) + "</textarea>" +
        '<p class="xs mut" style="margin:6px 0 10px">Замени слова в квадратных скобках — и можно отправлять.</p>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" data-act="rec-copy">Скопировать</button>' +
        '<button class="btn btn-soft btn-sm" data-act="rec-wa">Отправить в WhatsApp</button>' +
        '<button class="btn btn-ghost btn-sm" data-act="rec-mark">Отметить «запрошено»</button></div>' +
        (rec && (rec.fields || {}).requested_at ? '<p class="xs mut" style="margin-top:10px">Запрошено ' + fmtDL(new Date(rec.fields.requested_at)) + ". Если ответа нет неделю — вежливо напомни: это норма.</p>" : "");
    });
    if (window.track) track("cab_rec_request", { open: 1 });
  }
  function recMarkRequested(cb) {
    var rec = docsOfType("recommendation")[0];
    var patch = function (d) { var f = Object.assign({}, d.fields || {}, { requested_at: new Date().toISOString().slice(0, 10) }); saveDoc(d, { fields: f, status: d.status === "none" ? "progress" : d.status }, function () { recompute(); touch(true); if (cb) cb(); }); };
    if (rec) patch(rec);
    else createDoc({ doc_type: "recommendation", title: D.TYPES.recommendation.title, status: "progress", program_ids: [] }, function (d) { patch(d); });
    toast("Отметили: рекомендация запрошена");
    if (window.track) track("cab_rec_request", { marked: 1 });
  }

  /* ---------- «что делать, если…» ---------- */
  var DOC_FAQ = [
    { q: "Загрузил не тот файл или не тот формат",
      a: "Открой документ в списке и нажми «Заменить файл» — старый файл заменится новым, статус и проверки пересчитаются. Отдельно удалять ничего не нужно. Принимаем PDF, JPG и PNG до 10 МБ." },
    { q: "Документа ещё нет на руках",
      a: "Это нормально — большинство документов и не должно быть готово заранее. Смотри строку «Начать до …»: до этой даты его можно спокойно не иметь. Если дата уже прошла, документ поднимется в блок «Начать сейчас»." },
    { q: "Файл не открывается или не загружается",
      a: "Чаще всего дело в размере: фото с современного телефона бывает больше 10 МБ. Пересними с меньшим разрешением или сохрани в PDF. Если не помогло — напиши нам в WhatsApp, отправим инструкцию и заберём файл вручную." },
    { q: "Не знаю, где получить документ",
      a: "Открой карточку документа: внизу есть пошаговая инструкция по Казахстану — куда идти, сколько дней и сколько примерно стоит. Она есть для апостиля, перевода, медсправки, IELTS и рекомендаций." },
    { q: "Документ на казахском или русском, а нужен английский",
      a: "Нужен нотариальный перевод — и делать его надо строго ПОСЛЕ апостиля, иначе апостиль в перевод не попадёт и перевод придётся заказывать заново. В плане мы это уже учли: перевод помечен «Только после: Апостиль»." },
    { q: "Сертификат истекает до дедлайна",
      a: "Впиши дату сдачи в карточке сертификата — мы сверим её с дедлайнами всех твоих подач и предупредим, если срок не покрывает подачу. IELTS действует 2 года." },
    { q: "Хочу удалить документ и свои файлы",
      a: "Профиль → «Данные и приватность». Там можно удалить и файлы, и аккаунт целиком." }
  ];
  function docHelpHTML() {
    return subHead("Что делать, если…", "частые ситуации со сбором документов") +
      DOC_FAQ.map(function (f) {
        return '<div class="card" style="margin-bottom:10px"><b class="sm">' + esc(f.q) + "</b>" +
          '<p class="sm mut" style="margin:6px 0 0">' + esc(f.a) + "</p></div>";
      }).join("") +
      '<a class="btn btn-ghost btn-block" style="margin-top:6px" target="_blank" rel="noopener" href="https://wa.me/' + (C.WHATSAPP_NUMBER || "") +
      '?text=' + encodeURIComponent("Здравствуйте! Вопрос по документам в кабинете Scholary") + '">Не нашёл ответ — написать в WhatsApp</a>';
  }

  /* ---------- карточка документа ---------- */
  function openDoc(id) {
    var d = S.docs.filter(function (x) { return x.id === +id; })[0]; if (!d) return;
    openSub(function () { return docDetailHTML(d); });
  }
  function openNewDoc(t, appId) {
    var T = D.TYPES[t] || { title: t };
    var app = appId ? S.apps.filter(function (x) { return x.id === +appId; })[0] : null;
    var perProgram = T.perProgram && app;   // письмо пишется под конкретную программу
    createDoc({ doc_type: t, title: T.title, status: "none", program_ids: perProgram ? [app.program_id] : [] }, function (d) {
      openDoc(d.id);
    });
  }
  function docDetailHTML(d) {
    var T = D.TYPES[d.doc_type] || { title: d.doc_type, ic: "📄" };
    if (d.doc_type === "motivation") return letterHTML(d);
    var apps = appsForDoc();
    var vers = D.checkDocument(d, apps, S.ans, S.evalR && S.evalR.profile);
    var how = D.HOWTO[d.doc_type];
    /* Зачем этот документ и когда его начинать — берём из того же плана,
       что и на вкладке, чтобы карточка и список не расходились. */
    var pl = docPlanNow().filter(function (x) { return x.t === d.doc_type; })[0];
    var blockers = vers.filter(function (x) { return x.level === "blocker"; }).length;

    return subHead(T.title, T.hint || "") +

      (pl && pl.required ? '<div class="card" style="margin-bottom:12px;background:var(--accent-soft);border-color:var(--accent-border)">' +
        '<b class="sm">Зачем он нужен</b><p class="sm" style="margin:6px 0 0">' + esc(pl.why) + "</p>" +
        '<div class="xs mut" style="margin-top:8px">' + esc(docTimingText(pl)) + "</div></div>" : "") +

      '<div class="card" style="margin-bottom:12px">' +
        '<div class="h-row"><span class="sm mut">Статус</span><div class="seg" style="width:190px;margin:0">' +
        ["none|Нет", "progress|В работе", "ready|Готов"].map(function (s) {
          var p = s.split("|");
          return '<button data-act="docst" data-v="' + p[0] + '" data-id="' + d.id + '" class="' + (d.status === p[0] ? "on" : "") + '">' + p[1] + "</button>";
        }).join("") + "</div></div>" +

        /* Что именно загружено — имя файла и когда. Раньше здесь было
           безымянное «Файл · Открыть», и человек не помнил, что внутри. */
        (d.file_path
          ? '<div style="margin-top:12px;padding:11px 12px;background:var(--bg);border-radius:14px">' +
              '<div class="h-row"><div style="min-width:0;padding-right:10px">' +
                '<b class="sm" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📎 ' + esc(d.file_name || "Загруженный файл") + "</b>" +
                '<div class="xs mut">' + (d.checked_at ? "загружен " + fmtDL(new Date(d.checked_at)) : "загружен") + "</div>" +
              "</div>" +
              '<button class="btn btn-ghost btn-sm" data-act="dl" data-id="' + d.id + '">Открыть</button></div>' +
              '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">' +
                '<button class="btn btn-soft btn-sm" data-act="upload" data-id="' + d.id + '">Заменить файл</button>' +
                '<button class="btn btn-ghost btn-sm" data-act="recheck" data-id="' + d.id + '">Проверить заново</button>' +
              "</div></div>"
          : '<div style="margin-top:12px;padding:14px 12px;background:var(--bg);border-radius:14px;text-align:center">' +
              '<div class="sm mut" style="margin-bottom:10px">Файл ещё не загружен. Можно вести документ и без файла — но с файлом мы проверим его содержимое.</div>' +
              '<button class="btn btn-primary btn-sm" data-act="upload" data-id="' + d.id + '">Загрузить файл</button>' +
              '<div class="xs mut" style="margin-top:8px">PDF, JPG или PNG · до 10 МБ</div></div>') +
      "</div>" +

      (blockers ? '<div class="verd bad"><span>🔴</span><div><b>' + blockers + " " + plural(blockers, "замечание", "замечания", "замечаний") + ", которые стоит закрыть</b>Ниже — что именно и что с этим делать.</div></div>" : "") +
      docFieldsHTML(d) +
      '<div class="aicard" style="margin-bottom:10px"><div class="who"><i></i>Проверка по требованиям твоих подач</div>' +
      '<span class="xs mut">Сверено с ' + apps.length + " " + plural(apps.length, "подачей", "подачами", "подачами") + (d.checked_at ? " · " + fmtDL(new Date(d.checked_at)) : "") + "</span></div>" +
      vers.map(verdHTML).join("") +
      aiDocSectionHTML(d) +
      (how ? '<div class="card" style="margin-top:12px"><b class="sm">' + esc(how.title) + "</b>" +
        how.steps.map(function (s, i) {
          return '<div class="lst"><span class="pill pill-acc">' + (i + 1) + '</span><div style="flex:1"><b class="sm">' + esc(s.t) + '</b><div class="xs mut">' + esc(s.d) + "</div></div></div>";
        }).join("") + (how.note ? '<p class="xs mut" style="margin:8px 0 0">' + esc(how.note) + "</p>" : "") + "</div>" : "") +
      '<p class="xs mut" style="margin-top:12px">Проверка по правилам Scholary: сроки и требования ориентировочные. <a href="#" data-act="ai-wrong" data-id="' + d.id + '">Что-то не так?</a></p>';
  }
  function aiDocSectionHTML(d) {
    if (!aiOn()) return "";
    var av = Array.isArray(d.verdicts) ? d.verdicts : [];
    var head = '<div class="aicard" style="margin-top:14px"><div class="who"><i></i>Разбор ИИ' +
      (av.length ? '<span class="ai-badge">Claude</span>' : "") + "</div>" +
      '<p class="sm" style="margin:2px 0 0">' +
      (av.length
        ? "Модель прочитала документ и сверила его с твоими подачами. Правила выше — обязательная база, разбор ниже — детали."
        : "Правила выше проверили формальности. ИИ прочитает содержание и подскажет, что исправить под конкретные программы.") +
      "</p>" +
      aiRunHTML("d" + d.id, "Разобрать с ИИ", "Проверить заново", av.length > 0, { act: "ai-doc", id: d.id }) +
      '<p class="ai-note">Текст уходит на наш сервер и в модель Claude только для этой проверки. Модель не обучается на твоих документах.</p>' +
      "</div>";
    return head + av.map(verdHTML).join("");
  }
  function docFieldsHTML(d) {
    var f = d.fields || {};
    var rows = [];
    if (d.doc_type === "ielts") {
      rows.push(fieldRow(d, "band", "Балл", f.band || "", "например 6.5"));
      rows.push(fieldRow(d, "issued_on", "Дата сдачи", f.issued_on || "", "ГГГГ-ММ-ДД"));
    } else if (d.doc_type === "diploma") {
      rows.push(fieldRow(d, "gpa", "GPA / средний балл", f.gpa || "", "например 3.42"));
      rows.push(fieldRow(d, "lang", "Язык документа", f.lang || "", "ru / kk / en"));
    } else if (d.doc_type === "passport") {
      rows.push(fieldRow(d, "expires_on", "Действует до", f.expires_on || "", "ГГГГ-ММ-ДД"));
    } else return "";
    return '<div class="card" style="margin-bottom:12px"><b class="sm">Данные документа</b>' +
      '<p class="xs mut" style="margin:2px 0 8px">От них зависят вероятности и проверки — заполни, если знаешь.</p>' + rows.join("") + "</div>";
  }
  function fieldRow(d, key, label, val, ph) {
    return '<div class="fldrow"><label>' + esc(label) + '</label><input class="f" data-act="field" data-id="' + d.id + '" data-key="' + key + '" value="' + esc(val) + '" placeholder="' + esc(ph) + '"></div>';
  }

  /* ---------- редактор мотивационного ---------- */
  function letterHTML(d) {
    var prog = d.program_ids && d.program_ids.length ? progById(d.program_ids[0]) : null;
    var rev = D.letterReview(d.content || "", prog, S.ans);
    var ai = (d.verdicts && !Array.isArray(d.verdicts) && d.verdicts.criteria) ? d.verdicts : null;
    var useAi = !!ai;
    var score = useAi ? Number(ai.score) : rev.score;
    var crit = useAi ? ai.criteria : rev.criteria;
    return subHead("Мотивационное письмо", prog ? prog.name : "общее") +
      '<div class="card" style="margin-bottom:10px"><div class="h-row">' +
        '<div><b style="font-size:24px;color:' + (score >= 7 ? "var(--ok)" : score >= 5 ? "#A05F00" : "#C0392B") + '">' + score.toFixed(1) + '</b><span class="sm mut"> / 10 · ' + rev.words + " слов" + (useAi ? " · оценка ИИ" : " · по правилам") + "</span></div>" +
        '<button class="btn btn-ghost btn-sm" data-act="letter-wizard" data-id="' + d.id + '">Помощь с текстом</button></div>' +
        crit.map(function (c) {
          var cv = Number(c.v) || 0;
          return '<div class="pb-line"><span class="nm">' + esc(c.k) + '</span><div class="pb"><i style="width:' + cv * 10 + "%;background:" + (cv >= 7 ? "#5B4BFF" : "#E5C558") + '"></i></div><span class="v">' + cv.toFixed(1) + "</span></div>";
        }).join("") + "</div>" +
      '<textarea class="f ta big" id="letter-text" placeholder="Пиши здесь. Разбор обновится, когда нажмёшь «Проверить».">' + esc(d.content || "") + "</textarea>" +
      '<div style="display:flex;gap:8px;margin:8px 0 12px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" data-act="letter-save" data-id="' + d.id + '">Сохранить и проверить</button>' +
      '<button class="btn btn-ghost btn-sm" data-act="docst" data-v="ready" data-id="' + d.id + '">Отметить готовым</button></div>' +
      (aiOn() ? '<div class="aicard"><div class="who"><i></i>Глубокий разбор ИИ' + (useAi ? '<span class="ai-badge">Claude</span>' : "") + "</div>" +
        '<p class="sm" style="margin:2px 0 0">' +
        (useAi ? "Модель разобрала письмо под эту программу и предложила конкретные правки. Сохрани новый текст и проверь заново — оценка пересчитается."
               : "Правила ниже ловят клише и структуру. ИИ прочитает письмо целиком и скажет, что заменить и на что — с цитатами из твоего текста.") +
        "</p>" +
        aiRunHTML("l" + d.id, "Разобрать письмо с ИИ", "Разобрать заново", useAi, { act: "ai-letter", id: d.id }) +
        '<p class="ai-note">Текст письма уходит на наш сервер и в модель Claude только для разбора. Модель на нём не обучается.</p></div>' : "") +
      (useAi ? (ai.verdicts || []).map(verdHTML).join("") : "") +
      (useAi ? '<div class="h-row" style="margin:14px 0 6px"><b class="sm">Проверка по правилам</b><span class="xs mut">без лимита</span></div>' : "") +
      rev.verdicts.map(verdHTML).join("") +
      '<p class="xs mut" style="margin-top:10px">Разбор идёт по критериям, которые смотрят приёмные комиссии: конкретика, связь с программой, структура, отсутствие клише, планы после выпуска.</p>';
  }
  var WIZ_Q = [
    { k: "project", q: "Какой проект или работа лучше всего показывает тебя?", ph: "Что делал, для кого, что получилось — можно цифрами" },
    { k: "why", q: "Почему именно эта программа?", ph: "Какой трек, лаборатория, предмет — что там есть, чего нет дома" },
    { k: "after", q: "Что сделаешь после выпуска?", ph: "Куда вернёшься и что изменишь — честно, без пафоса" },
    { k: "hard", q: "Что было самым трудным в учёбе и как справился?", ph: "Комиссии важна не гладкая история, а способность решать" }
  ];
  var wizState = { i: 0, ans: {}, docId: null, appId: null };
  function openWizard(docId, appId) {
    wizState = { i: 0, ans: {}, docId: docId || null, appId: appId || null };
    openSub(wizHTML);
  }
  function wizHTML() {
    var q = WIZ_Q[wizState.i];
    if (!q) {
      return subHead("Черновик готов", "проверь и правь своими словами") +
        '<div class="card"><p class="sm" style="white-space:pre-wrap;margin:0">' + esc(wizDraft()) + "</p></div>" +
        '<button class="btn btn-primary btn-block" style="margin-top:12px" data-act="wiz-save">Сохранить как черновик</button>' +
        '<p class="xs mut" style="margin-top:10px">Это каркас, а не готовое письмо: комиссия узнаёт текст, написанный не тобой. Перепиши своими словами — разбор поможет.</p>';
    }
    return subHead("Черновик письма", "вопрос " + (wizState.i + 1) + " из " + WIZ_Q.length) +
      '<div class="card"><span class="pill pill-acc">' + (wizState.i + 1) + " из " + WIZ_Q.length + "</span>" +
      '<div class="h3" style="margin:8px 0 8px">' + esc(q.q) + "</div>" +
      '<textarea class="f ta" id="wiz-a" placeholder="' + esc(q.ph) + '">' + esc(wizState.ans[q.k] || "") + "</textarea>" +
      '<p class="xs mut" style="margin:8px 0 0">Пиши как рассказал бы другу — формулировки причешем.</p></div>' +
      '<button class="btn btn-primary btn-block" style="margin-top:12px" data-act="wiz-next">' + (wizState.i === WIZ_Q.length - 1 ? "Собрать черновик" : "Дальше") + "</button>";
  }
  function wizDraft() {
    var a = wizState.ans, prog = wizState.appId ? (appView(S.apps.filter(function (x) { return x.id === +wizState.appId; })[0]) || {}).prog : null;
    var pname = prog ? prog.name : "этой программы";
    return "Уважаемая приёмная комиссия,\n\n" +
      (a.project ? a.project.trim() + "\n\n" : "") +
      (a.why ? "Именно поэтому я подаю на " + pname + ": " + a.why.trim() + "\n\n" : "") +
      (a.hard ? a.hard.trim() + "\n\n" : "") +
      (a.after ? "После выпуска: " + a.after.trim() + "\n\n" : "") +
      "С уважением,\n" + ((S.profile && S.profile.name) || "");
  }

  /* ================= 3 · ВУЗЫ (web-74: Discover + фильтры + плашки) ================= */
  var uniFilter = { q: "", cc: null, budget: null, noIelts: false, deadline: null, sort: "match", mode: "discover", col: null };
  function progDeadline(p) { return Path.nextFromMD(p.deadline_md, todayDate()) || parseDeadline(p.deadline); }
  function catalogViews() {
    var prof = S.evalR && S.evalR.profile;
    var lvl = (S.ans && S.ans.level) || "bachelor";
    var mine = {}; S.apps.forEach(function (a) { mine[a.program_id] = 1; });
    var today = todayDate();
    return S.programs.filter(function (p) {
      // куда казахстанец подать не может — в каталоге не показываем совсем
      if (p.available_kz === false || p.duplicate_of) return false;
      if (p.levels && p.levels.indexOf(lvl) === -1) return false;
      if (uniFilter.cc && (p.cc || "").toLowerCase() !== uniFilter.cc) return false;
      if (uniFilter.noIelts && !((p.req && p.req.language != null && p.req.language <= 4.5) || p.lang_year)) return false;
      if (uniFilter.budget === 0 && !(p.req && p.req.budget === 0)) return false;
      if (uniFilter.deadline) {
        var d = progDeadline(p); if (!d) return false;
        var dd = Path.daysBetween(d, today);
        if (uniFilter.deadline === "month" && dd > 31) return false;
        if (uniFilter.deadline === "3m" && dd > 92) return false;
      }
      if (uniFilter.q) {
        var s = (p.name + " " + p.country + " " + (p.funding || "")).toLowerCase();
        if (s.indexOf(uniFilter.q.toLowerCase()) === -1) return false;
      }
      return true;
    }).map(function (p) {
      var pr = probFor(prof, p);
      return { prog: p, p: pr, mine: !!mine[p.id], match: pr ? Math.round((pr.adm * 0.6 + (pr.sch || pr.adm) * 0.4) * 100) : 0, date: progDeadline(p) };
    }).sort(function (a, b) {
      if (uniFilter.sort === "deadline") return ((a.date || Infinity) - (b.date || Infinity)) || (b.match - a.match);
      if (uniFilter.sort === "name") return String(a.prog.name).localeCompare(String(b.prog.name), "ru");
      return b.match - a.match;
    });
  }
  function uniCountries() {
    var lvl = (S.ans && S.ans.level) || "bachelor", cnt = {};
    S.programs.forEach(function (p) { if (p.available_kz === false || p.duplicate_of) return; if (p.levels && p.levels.indexOf(lvl) === -1) return; var c = (p.cc || "").toLowerCase(); if (!c) return; cnt[c] = cnt[c] || { cc: c, n: 0, name: p.country }; cnt[c].n++; });
    return Object.keys(cnt).map(function (k) { return cnt[k]; }).sort(function (a, b) { return b.n - a.n; });
  }
  function uniFiltersHTML(total) {
    var cs = uniCountries().slice(0, 14);
    return '<div class="fld"><svg class="ic16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>' +
      '<input id="uni-q" placeholder="Страна, программа, «без IELTS»" value="' + esc(uniFilter.q) + '"></div>' +
      '<div class="chips scrollx" style="margin:10px 0 6px"><button class="chip ' + (!uniFilter.cc ? "on" : "") + '" data-act="unicc" data-v="">Все страны</button>' + cs.map(function (c) {
        return '<button class="chip ' + ((uniFilter.cc || "") === c.cc ? "on" : "") + '" data-act="unicc" data-v="' + c.cc + '">' + flag(c.cc) + " " + esc(c.name || c.cc.toUpperCase()) + ' <span class="mut">' + c.n + "</span></button>";
      }).join("") + "</div>" +
      '<div class="chips scrollx" style="margin:0 0 6px">' +
        '<button class="chip ' + (uniFilter.budget === 0 ? "on" : "") + '" data-act="unibudget">🎓 Полное покрытие</button>' +
        '<button class="chip ' + (uniFilter.noIelts ? "on" : "") + '" data-act="uniielts">🗣 Без IELTS</button>' +
        '<button class="chip ' + (uniFilter.deadline === "month" ? "on" : "") + '" data-act="unidl" data-v="month">⏰ Дедлайн в этом месяце</button>' +
        '<button class="chip ' + (uniFilter.deadline === "3m" ? "on" : "") + '" data-act="unidl" data-v="3m">⏰ В ближайшие 3 месяца</button>' +
      "</div>" +
      '<div class="h-row" style="margin:4px 0 12px"><span class="xs mut">' + total + " " + plural(total, "программа", "программы", "программ") + "</span>" +
        '<span class="xs mut">сортировка: ' + ["match|совпадение", "deadline|дедлайн", "name|название"].map(function (s) { var p = s.split("|"); return '<a href="#" data-act="unisort" data-v="' + p[0] + '"' + (uniFilter.sort === p[0] ? ' style="font-weight:800;color:var(--accent-dark)"' : "") + ">" + p[1] + "</a>"; }).join(" · ") + "</span></div>";
  }
  function renderUnis() {
    var total = S.programs.filter(function (p) { return p.available_kz !== false && !p.duplicate_of; }).length;
    var head = '<div class="h2" style="margin:10px 0 2px">Вузы и программы</div>' +
      '<p class="sm mut" style="margin:0 0 10px">' + total + " программ в базе · проценты посчитаны по твоему профилю</p>" +
      '<div class="seg2"><button data-act="unimode" data-v="discover" class="' + (uniFilter.mode === "discover" ? "on" : "") + '">Discover</button><button data-act="unimode" data-v="all" class="' + (uniFilter.mode === "all" ? "on" : "") + '">Все программы</button></div>';
    if (uniFilter.mode === "discover") { $("tab-unis").innerHTML = head + discoverHTML(); return; }
    var vs = catalogViews();
    $("tab-unis").innerHTML = head + uniFiltersHTML(vs.length) + uniListHTML(vs);
  }
  /* ---- Discover: подборки из каталога ---- */
  function discoverHTML() {
    var ctx = pathCtx(), cols = Path.collections(S.programs, ctx);
    var mine = {}; S.apps.forEach(function (a) { mine[a.program_id] = 1; });
    if (uniFilter.col) {
      var col = cols.filter(function (c) { return c.key === uniFilter.col; })[0];
      if (!col) { uniFilter.col = null; return discoverHTML(); }
      var vs = col.items.map(function (p) { var pr = probFor(S.evalR && S.evalR.profile, p); return { prog: p, p: pr, mine: !!mine[p.id], match: pr ? Math.round((pr.adm * 0.6 + (pr.sch || pr.adm) * 0.4) * 100) : 0, date: progDeadline(p) }; });
      return '<div class="subhead" style="margin-top:4px"><button class="iconbtn" data-act="disc-back" aria-label="Назад"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg></button>' +
        '<div><div class="subttl">' + col.ic + " " + esc(col.title) + '</div><div class="xs mut">' + esc(col.why) + " · " + vs.length + " " + plural(vs.length, "программа", "программы", "программ") + "</div></div></div>" +
        '<div class="grid2">' + vs.slice(0, 60).map(uniCard).join("") + "</div>";
    }
    return '<div class="chips scrollx" style="margin:0 0 12px">' + cols.map(function (c) {
        return '<button class="chip" data-act="disc-col" data-v="' + c.key + '">' + c.ic + " " + esc(c.title) + ' <span class="mut">' + c.items.length + "</span></button>";
      }).join("") + "</div>" +
      cols.map(function (c) {
        return '<div class="disc-row"><div class="h-row" style="margin:12px 0 6px"><div><b class="sm">' + c.ic + " " + esc(c.title) + '</b><div class="xs mut">' + esc(c.why) + "</div></div>" +
          '<button class="lnk xs" data-act="disc-col" data-v="' + c.key + '">все ' + c.items.length + "</button></div>" +
          '<div class="disc-scroll">' + c.items.slice(0, 8).map(function (p) { return discCard(p, mine[p.id]); }).join("") + "</div></div>";
      }).join("") +
      '<p class="xs mut" style="margin-top:14px">Подборки собираются из каталога по твоему уровню. ✅ — данные проверены командой; остальные проверяются — сверься с официальным сайтом.</p>';
  }
  function discCard(p, isMine) {
    var pr = probFor(S.evalR && S.evalR.profile, p), b = Path.badges(p, pathCtx()).slice(0, 3);
    return '<div class="disc-card tappable" data-act="prog" data-id="' + esc(p.id) + '">' +
      '<div class="h-row" style="align-items:flex-start"><b class="sm" style="flex:1;min-width:0">' + flag(p.cc) + " " + esc(p.name) + "</b>" +
      (pr ? '<span class="pill ' + (pr.adm >= 0.5 ? "pill-ok" : pr.adm >= 0.3 ? "pill-warn" : "pill-mut") + '">' + pct(pr.adm) + "%</span>" : "") + "</div>" +
      '<div class="xs mut" style="margin-top:2px">' + esc(p.country || "") + (p.funding ? " · " + esc(String(p.funding).slice(0, 60)) : "") + "</div>" +
      '<div class="badges">' + b.map(function (x) { return '<span class="badge ' + (x.cls || "") + '">' + x.ic + " " + esc(x.t) + "</span>"; }).join("") + "</div>" +
      (isMine ? '<span class="xs" style="color:var(--accent-dark)">уже в подачах</span>' : "") + "</div>";
  }
  /* Программы с очень низким совпадением прячем под кнопку: стена нулей
     демотивирует и выглядит как ошибка, но скрывать их совсем нечестно. */
  var uniShowWeak = false;
  function uniListHTML(vs) {
    if (!vs.length) return uniEmpty();
    var strong = vs.filter(function (v) { return v.match >= 20; });
    var weak = vs.filter(function (v) { return v.match < 20; });
    if (!strong.length) { strong = vs.slice(0, 12); weak = vs.slice(12); }
    var html = '<div class="grid2">' + strong.slice(0, 40).map(uniCard).join("") + "</div>";
    if (weak.length) {
      html += '<div class="moreline"><i></i><span>слабое совпадение · ' + weak.length + "</span><i></i></div>";
      if (uniShowWeak) {
        html += '<div class="grid2">' + weak.slice(0, 40).map(uniCard).join("") + "</div>" +
          '<button class="btn btn-ghost btn-sm btn-block" style="margin-top:12px" data-act="uniweak">Свернуть</button>';
      } else {
        html += '<p class="sm mut" style="margin:0 0 10px">Тут пороги выше твоего профиля прямо сейчас. Это не «никогда»: подтяни язык или достижения — и они поднимутся.</p>' +
          '<button class="btn btn-soft btn-sm btn-block" data-act="uniweak">Показать ' + weak.length + " " + plural(weak.length, "программу", "программы", "программ") + "</button>";
      }
    }
    return html;
  }
  function uniEmpty() {
    return '<div class="empty"><div class="art">🔎</div><h3>Под эти фильтры ничего нет</h3>' +
      "<p>Попробуй убрать один фильтр — например, «полное покрытие»: программы с частичным покрытием часто выгоднее по деньгам.</p>" +
      '<button class="btn btn-soft btn-sm" data-act="unireset">Сбросить фильтры</button></div>';
  }
  function uniCard(v) {
    var b = Path.badges(v.prog, pathCtx()).slice(0, 4);
    return '<div class="prog tappable" data-act="prog" data-id="' + esc(v.prog.id) + '">' +
      '<div class="h-row" style="align-items:flex-start"><div style="flex:1;min-width:0"><b>' + flag(v.prog.cc) + " " + esc(v.prog.name) + "</b>" +
      '<div class="xs mut fund">' + [esc(v.prog.country), esc(v.prog.funding || "")].filter(Boolean).join(" · ") + "</div></div>" +
      '<span class="pill ' + (v.match >= 70 ? "pill-ok" : v.match >= 45 ? "pill-warn" : "pill-mut") + '">' + v.match + "%</span></div>" +
      (b.length ? '<div class="badges">' + b.map(function (x) { return '<span class="badge ' + (x.cls || "") + '">' + x.ic + " " + esc(x.t) + "</span>"; }).join("") + "</div>" : "") +
      (v.p ? '<div class="pb-line"><span class="nm">Поступление</span><div class="pb"><i style="width:' + pct(v.p.adm) + '%"></i></div><span class="v">' + pct(v.p.adm) + "%</span></div>" +
        (v.p.sch != null ? '<div class="pb-line"><span class="nm">Стипендия</span><div class="pb"><i class="sch" style="width:' + pct(v.p.sch) + '%"></i></div><span class="v">' + pct(v.p.sch) + "%</span></div>" : "") : "") +
      '<div class="h-row" style="margin-top:10px">' +
      (v.mine ? '<span class="pill pill-acc">уже в подачах</span>' : '<button class="btn btn-soft btn-sm" data-act="add" data-id="' + esc(v.prog.id) + '">+ В подачи</button>') +
      '<span class="xs mut">' + (v.date ? "дедлайн " + fmtD(v.date) : esc(v.prog.deadline || "уточняется")) + "</span></div></div>";
  }

  function openProg(id) {
    var p = progById(id); if (!p) return;
    var pr = probFor(S.evalR && S.evalR.profile, p);
    var mine = S.apps.some(function (a) { return a.program_id === id; });
    var reqs = D.requiredFor(p, S.ans);
    var need = D.ieltsFromAxis(p.req && p.req.language);
    var ax = S.evalR ? S.evalR.profile.axes : null;
    openSub(function () {
      return subHead(p.name, (p.country || "") + " · " + ((S.ans && L.level[S.ans.level]) || "")) +
        '<div class="card" style="margin-bottom:12px">' + (pr ? duoHTML({ adm: pr.adm, sch: pr.sch }) : "") +
        '<div class="aicard" style="margin:10px 0 0;background:none;border:none;padding:0"><div class="who"><i></i>Почему столько</div>' +
        '<span class="sm">' + esc(whyText(p, pr, ax, need)) + "</span></div></div>" +
        '<div class="card" style="margin-bottom:12px"><b class="sm">Что нужно подать</b>' +
        reqs.map(function (r) {
          var T = D.TYPES[r.t] || { title: r.t, ic: "📄" };
          return '<div class="lst"><span>' + T.ic + '</span><div style="flex:1"><b class="sm">' + esc(T.title) + '</b><div class="xs mut">' + esc(r.why || "") + "</div></div></div>";
        }).join("") + "</div>" +
        '<div class="card" style="margin-bottom:12px">' +
          '<div class="h-row sm"><span class="mut">Финансирование</span><b style="text-align:right">' + esc(p.funding || "—") + "</b></div>" +
          '<div class="h-row sm" style="margin-top:6px"><span class="mut">Дедлайн</span><b>' + esc(p.deadline || "уточняется") + "</b></div>" +
          (p.note ? '<p class="xs mut" style="margin:8px 0 0">' + esc(p.note) + "</p>" : "") + "</div>" +
        (mine ? '<div class="card" style="text-align:center"><b class="sm">Уже в твоих подачах</b></div>'
              : '<button class="btn btn-primary btn-block" data-act="add" data-id="' + esc(p.id) + '">Добавить в подачи</button>') +
        (p.source_url ? '<a class="btn btn-ghost btn-block" style="margin-top:8px" href="' + esc(p.source_url) + '" target="_blank" rel="noopener">Официальная страница</a>' : "") +
        '<p class="xs mut" style="margin-top:10px">' + (p.verified ? "Данные проверены командой" : "Данные проверяются — сверься с официальным сайтом") + " · <a href=\"#\" data-act=\"report-err\" data-id=\"" + esc(p.id) + "\">сообщить об ошибке</a></p>";
    });
  }
  function whyText(p, pr, ax, need) {
    if (!pr || !ax) return "Расчёт появится, когда заполнишь анкету.";
    var parts = [];
    var r = p.req || {};
    if (r.academics != null) parts.push(ax.academics >= r.academics ? "успеваемость выше порога (+)" : "успеваемость ниже типичного порога (−)");
    if (need) parts.push(ax.language >= (r.language || 0) ? "язык проходит (+)" : "не хватает языка примерно до IELTS " + need.toFixed(1) + " (−)");
    if (ax.achievements >= 6) parts.push("достижения усиливают (+)");
    if (r.budget != null && ax.budget < r.budget) parts.push("бюджет ниже требуемого (−)");
    return "Модель смотрит: " + parts.join(", ") + ". Базовая ставка программы — экспертная оценка v1, она уточнится, когда наберём исходы подач.";
  }

  /* ================= МОЙ ШАНС ================= */
  function openChance() {
    var o = overall(), vs = appViews();
    var pts = S.hist.slice(-8);
    openSub(function () {
      var w = 300, h = 96;
      var line = "";
      if (pts.length > 1) {
        var xs = pts.map(function (p, i) { return i / (pts.length - 1) * w; });
        line = '<polyline points="' + pts.map(function (p, i) { return xs[i].toFixed(0) + "," + (h - (p.p_adm || 0) * h * 0.9).toFixed(0); }).join(" ") + '" fill="none" stroke="#5B4BFF" stroke-width="3" stroke-linecap="round"/>';
      }
      // симулируем только то, чего у человека ещё нет — иначе строка «без изменений» выглядит багом
      var have = S.ans.achievements || [];
      var simList = [];
      if ((S.ans.ielts_band || "") !== "7+")
        simList.push({ label: "Сдать IELTS на 7.0", patch: { lang_status: "have", ielts_band: "7+" } });
      if (have.indexOf("project") === -1)
        simList.push({ label: "Довести проект до результата", patch: { achievements: have.concat(["project"]) } });
      if (have.indexOf("rep_olymp") === -1)
        simList.push({ label: "Призовое место на респ. олимпиаде", patch: { achievements: have.concat(["rep_olymp"]) } });
      if ((S.ans.budget || "") === "0" || (S.ans.budget || "") === "<1m")
        simList.push({ label: "Бюджет семьи 1–3 млн ₸ в год", patch: { budget: "1-3m" } });
      var sims = simList.slice(0, 4).map(function (s) {
        var alt = Object.assign({}, S.ans, s.patch);
        var r = null; try { r = E.evaluate(alt); } catch (e) {}
        var d = r ? Math.round((bestOf(r) - o.adm) * 100) : 0;
        return '<div class="lst"><div style="flex:1"><b class="sm">' + esc(s.label) + "</b></div>" +
          '<span class="pill ' + (d > 0 ? "pill-ok" : "pill-mut") + '">' + (d > 0 ? "+" + d + " пп" : "почти не влияет") + "</span></div>";
      }).join("");
      if (!sims) sims = '<p class="sm mut" style="margin:6px 0 0">По анкете ты уже на потолке этих осей. Дальше растёт не профиль, а качество подачи: письмо, рекомендации, сроки.</p>';
      return subHead("Мой шанс", "динамика и «что если»") +
        '<div class="card" style="margin-bottom:12px">' + duoHTML(o, ["хотя бы один оффер", "хотя бы одна стипендия"]) +
        (pts.length > 1 ? '<svg width="100%" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" style="margin-top:8px">' + line + "</svg>"
          : '<p class="xs mut" style="margin:8px 0 0">График оживёт через неделю: каждое действие добавляет точку. Пока сохранена ' + pts.length + " точка.</p>") + "</div>" +
        '<div class="card" style="margin-bottom:12px"><b class="sm">Что если…</b>' +
        '<p class="xs mut" style="margin:2px 0 6px">Симуляция не меняет анкету — просто показывает эффект.</p>' + sims + "</div>" +
        '<div class="card"><b class="sm">Из чего складывается</b>' +
        (S.evalR ? [["Академика", S.evalR.profile.axes.academics], ["Язык", S.evalR.profile.axes.language], ["Достижения", S.evalR.profile.axes.achievements], ["Мотивационное", S.evalR.profile.axes.motivation], ["Бюджет", S.evalR.profile.axes.budget], ["Соответствие", S.evalR.profile.axes.fit]].map(function (a) {
          return '<div class="pb-line"><span class="nm">' + a[0] + '</span><div class="pb"><i style="width:' + Math.round(a[1] * 10) + '%"></i></div><span class="v">' + a[1].toFixed(1) + "</span></div>";
        }).join("") : "") + "</div>";
    });
  }
  function bestOf(r) {
    var best = 0; (r.portfolio || []).forEach(function (p) { best = Math.max(best, p.p.adm); }); return best;
  }

  /* ================= 5 · ПРОФИЛЬ ================= */
  function renderProfile() {
    var a = S.ans || {}, name = (S.profile && S.profile.name) || "";
    function row(label, val, key) {
      return '<div class="lst"><div style="flex:1"><b class="sm">' + esc(label) + '</b><div class="xs mut">' + esc(val || "не указано") + "</div></div>" +
        (key ? '<button class="btn btn-ghost btn-sm" data-act="edit" data-key="' + key + '">Изменить</button>' : "") + "</div>";
    }
    var lvl = a.level === "master" ? L.gpa4[a.gpa_uni] : a.level === "phd" ? L.gpa4[a.gpa_phd] : L.gpa_band[a.gpa_band];
    $("tab-profile").innerHTML =
      '<div style="display:flex;gap:14px;align-items:center;margin:12px 0 14px">' +
        '<div class="ava big">' + esc((name[0] || "S").toUpperCase()) + "</div>" +
        '<div><b style="font-size:18px">' + esc(name || "Без имени") + '</b><div class="sm mut">' + esc((S.session && S.session.user.email) || "") + "</div></div></div>" +
      '<div class="card" style="margin-bottom:12px"><b class="sm">Данные для расчёта</b>' +
        '<p class="xs mut" style="margin:2px 0 6px">Изменишь — вероятности по всем подачам пересчитаются.</p>' +
        row("Уровень", (L.level[a.level] || "") + (a.year ? " · " + a.year : ""), "level") +
        row("Успеваемость", lvl, "gpa") +
        row("Язык", (L.lang_status[a.lang_status] || "") + (a.ielts_band ? " · " + (L.ielts[a.ielts_band] || "") : ""), "lang") +
        row("Направления", (a.field || []).map(function (k) { return L.field ? (L.field[k] || k) : k; }).join(", "), "field") +
        row("Бюджет семьи", L.budget[a.budget], "budget") +
        row("Достижения", (a.achievements || []).map(function (k) { return L.ach[k] || k; }).join(", "), "ach") +
      "</div>" +
      '<div class="card" style="margin-bottom:12px;background:var(--accent-soft);border-color:var(--accent-border)">' +
        '<b class="sm">Планы изменились?</b>' +
        '<p class="sm" style="margin:6px 0 0">Проходить квиз заново не нужно и лимита на изменения нет. Поменяй направление, уровень или балл прямо здесь — вероятности по всем подачам пересчитаются сразу, а мы подскажем, какие программы теперь подходят лучше.</p>' +
        '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">' +
          '<button class="btn btn-soft btn-sm" data-act="edit" data-key="field">Сменить направление</button>' +
          '<button class="btn btn-ghost btn-sm" data-act="edit" data-key="level">Сменить уровень</button>' +
        "</div></div>" +
      schoolCardHTML() +
      weekSettingsHTML() +
      '<div class="card" style="margin-bottom:12px"><div class="h-row"><div style="padding-right:10px"><b class="sm">Telegram</b><div class="xs mut">' +
        (S.tg && S.tg.chat_id ? "подключён · шаг дня и дедлайны" : "не подключён — уведомления о дедлайнах не придут") + "</div></div>" +
        '<button class="btn ' + (S.tg && S.tg.chat_id ? "btn-ghost" : "btn-primary") + ' btn-sm" data-act="tg">' + (S.tg && S.tg.chat_id ? "Настроить" : "Подключить") + "</button></div></div>" +
      (isPro()
        ? '<div class="lst tappable" data-act="subscribe" style="border-radius:14px;background:var(--ok-soft);padding-inline:12px"><div style="flex:1"><b class="sm">Scholary Pro</b><div class="xs mut">активна до ' + fmtDL(new Date(S.profile.pro_until)) + '</div></div><span class="pill pill-ok">Pro</span></div>'
        : '<div class="lst tappable" data-act="subscribe" style="border-radius:14px;background:var(--accent-soft);padding-inline:12px"><div style="flex:1"><b class="sm">Scholary Pro</b><div class="xs mut">60 разборов ИИ в день, симулятор «что если» · от 4 990 ₸</div></div><span class="pill pill-acc">Смотреть</span></div>') +
      '<div class="lst tappable" data-act="reports"><div style="flex:1"><b class="sm">Мои отчёты</b><div class="xs mut">' + ((S.reports || []).length) + " " + plural((S.reports || []).length, "отчёт", "отчёта", "отчётов") + "</div></div><span class=\"xs mut\">→</span></div>" +
      '<div class="lst tappable" data-act="privacy"><div style="flex:1"><b class="sm">Данные и приватность</b><div class="xs mut">что хранится и как удалить</div></div><span class="xs mut">→</span></div>' +
      '<div class="lst tappable" data-act="help"><div style="flex:1"><b class="sm">Помощь</b><div class="xs mut">WhatsApp · Telegram · вопросы</div></div><span class="xs mut">→</span></div>' +
      '<button class="btn btn-ghost btn-block" style="margin-top:14px" data-act="logout">Выйти</button>' +
      '<p class="xs mut" style="text-align:center;margin-top:10px">Scholary · вероятности — оценка модели, не гарантия</p>';
  }

  /* Школа ученика: контакт профориентолога и срок школьного доступа.
     Грузится один раз при входе; если школы нет — карточки нет. */
  function schoolCardHTML() {
    var sc = S.school;
    if (!sc) return "";
    var who = (sc.contact_name || "").trim();
    var cls = sc.class_label ? " · " + sc.class_label : (sc.grade && sc.grade !== "other" ? " · " + sc.grade + " класс" : "");
    var contact = "";
    if (sc.contact_phone) {
      var d = String(sc.contact_phone).replace(/\D/g, "");
      contact += '<a class="btn btn-soft btn-sm" href="https://wa.me/' + d + '?text=' + encodeURIComponent("Здравствуйте! Это " + ((S.profile && S.profile.name) || "ученик") + " из Scholary, есть вопрос по поступлению") + '" target="_blank" rel="noopener">Написать в WhatsApp</a>';
    }
    if (sc.contact_email) contact += '<a class="btn btn-ghost btn-sm" href="mailto:' + esc(sc.contact_email) + '">Почта</a>';
    var isC = sc.kind === "counselor";
    return '<div class="card" style="margin-bottom:12px;background:linear-gradient(135deg,#FFFFFF 0%,#F4F2FF 58%,#EDF9F3 100%);border-color:#E3DFFF">' +
      '<div class="xs" style="font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--accent-dark)">' + (isC ? "Твой профориентолог" : "Твоя школа") + '</div>' +
      '<b style="display:block;margin-top:4px">' + esc(isC && who ? who : sc.name) + esc(isC ? "" : cls) + '</b>' +
      (isC ? (sc.name && sc.name !== who ? '<div class="sm" style="margin-top:6px">' + esc(sc.name) + '</div>' : '') : (who ? '<div class="sm" style="margin-top:6px">Профориентолог: <b>' + esc(who) + '</b>' + (sc.contact_role ? ' <span class="mut">· ' + esc(sc.contact_role) + '</span>' : '') + '</div>' : '')) +
      '<div class="xs mut" style="margin-top:4px">' + (sc.active ? (isC ? "Scholary Pro от профориентолога" : "Scholary Pro от школы") + (sc.ends_on ? " · доступ до " + fmtDL(new Date(sc.ends_on)) : "") : (isC ? "Доступ от профориентолога закончился — Pro можно продлить самому" : "Школьный доступ закончился — Pro можно продлить самому")) + '</div>' +
      (contact ? '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">' + contact + '</div>' : '') +
      "</div>";
  }
  function loadSchool() {
    sb.rpc("school_for_student").then(function (r) {
      S.school = r.data || null;
      var joined = null;
      try { joined = localStorage.getItem("scholary_school_joined"); if (joined) localStorage.removeItem("scholary_school_joined"); } catch (e) {}
      if (joined && S.school) toast("Ты в списке школы " + S.school.name + " · Scholary Pro активна", "ok");
      if (S.tab === "profile") setTab("profile");
    });
  }

  /* Один список вариантов на всё: и анкета при первом входе, и правка
     в профиле. Раньше эти списки жили в двух местах и могли разъехаться. */
  var OPT = {
    level:    [["bachelor", "Бакалавриат"], ["master", "Магистратура"], ["phd", "PhD / докторантура"]],
    year:     [["2027", "2027"], ["2028", "2028"], ["later", "Позже / ещё не решил"]],
    gpa_band: [["5.0-4.5", "5.0–4.5"], ["4.4-4.0", "4.4–4.0"], ["3.9-3.5", "3.9–3.5"], ["<3.5", "ниже 3.5"]],
    gpa4:     [["3.67+", "3.67 и выше"], ["3.33-3.66", "3.33–3.66"], ["3.0-3.32", "3.0–3.32"], ["<3.0", "ниже 3.0"], ["unknown", "не знаю"]],
    ielts:    [["7+", "IELTS 7.0 и выше"], ["6.5", "IELTS 6.5"], ["6.0", "IELTS 6.0"], ["5.5", "IELTS 5.5"], ["<5.5", "ниже 5.5"], ["unknown", "сертификата пока нет"]],
    lang:     [["have", "Сертификат есть"], ["soon", "Сдаю скоро"], ["none", "Нет"]],
    field:    [["it", "IT и Computer Science"], ["eng", "Инженерия и технологии"], ["med", "Медицина и здоровье"], ["bus", "Бизнес и экономика"], ["sci", "Естественные науки"], ["hum", "Гуманитарные и социальные"], ["art", "Искусство и дизайн"], ["law", "Право"]],
    budget:   [["0", "0 ₸ — только стипендия"], ["<1m", "до 1 млн ₸"], ["1-3m", "1–3 млн ₸"], ["3m+", "больше 3 млн ₸"]],
    ach:      [["intl_olymp", "Международные олимпиады"], ["rep_olymp", "Республиканские олимпиады"], ["city_olymp", "Областные / городские олимпиады"], ["publications", "Публикации и конференции"], ["work_exp", "Опыт работы по специальности"], ["project", "Проекты, стартапы, исследования"], ["volunteer", "Волонтёрство"], ["sport_art", "Спорт / творчество на уровне наград"]]
  };

  var EDIT = {
    level:  { title: "Куда поступаешь", key: "level", opts: OPT.level },
    gpa:    { title: "Успеваемость", key: null },
    lang:   { title: "Английский", key: "lang_status", opts: OPT.lang },
    field:  { title: "Направления", key: "field", multi: true, max: 3, opts: OPT.field },
    budget: { title: "Бюджет семьи в год", key: "budget", opts: OPT.budget },
    ach:    { title: "Достижения", key: "achievements", multi: true, opts: OPT.ach }
  };
  function openEdit(k) {
    var lvl = (S.ans && S.ans.level) || "bachelor";
    var cfg = EDIT[k];
    if (k === "gpa") cfg = lvl === "bachelor"
      ? { title: "Средний балл аттестата", key: "gpa_band", opts: OPT.gpa_band }
      : { title: "GPA (шкала 4.0)", key: lvl === "phd" ? "gpa_phd" : "gpa_uni", opts: OPT.gpa4 };
    if (k === "lang") cfg = { title: "Английский", key: "ielts_band", opts: OPT.ielts };
    if (!cfg) return;
    var sel = S.ans[cfg.key];
    var bg = document.createElement("div"); bg.className = "modal-bg";
    bg.innerHTML = '<div class="modal"><b>' + esc(cfg.title) + "</b>" +
      '<div class="chips" style="margin:12px 0 14px">' + cfg.opts.map(function (o) {
        var on = cfg.multi ? (sel || []).indexOf(o[0]) >= 0 : sel === o[0];
        return '<button class="chip ' + (on ? "on" : "") + '" data-v="' + o[0] + '">' + esc(o[1]) + "</button>";
      }).join("") + "</div>" +
      '<div style="display:flex;gap:8px"><button class="btn btn-ghost btn-sm" data-x="1" style="flex:1">Отмена</button><button class="btn btn-primary btn-sm" data-s="1" style="flex:1">Сохранить</button></div></div>';
    document.getElementById("modal-root").appendChild(bg);
    var picked = cfg.multi ? (sel || []).slice() : sel;
    bg.addEventListener("click", function (e) {
      var c = e.target.closest("[data-v]");
      if (c) {
        if (cfg.multi) {
          var v = c.getAttribute("data-v"), i = picked.indexOf(v);
          if (i >= 0) picked.splice(i, 1);
          else {
            if (cfg.max && picked.length >= cfg.max) { toast("Можно выбрать не больше " + cfg.max); return; }
            picked.push(v);
          }
          c.classList.toggle("on");
        } else {
          picked = c.getAttribute("data-v");
          Array.prototype.forEach.call(bg.querySelectorAll(".chip"), function (x) { x.classList.remove("on"); });
          c.classList.add("on");
        }
        return;
      }
      if (e.target.closest("[data-x]") || e.target === bg) { bg.remove(); return; }
      if (e.target.closest("[data-s]")) {
        var changedDirection = (cfg.key === "field" || cfg.key === "level") &&
          JSON.stringify(picked) !== JSON.stringify(sel);
        S.ans[cfg.key] = picked;
        if (cfg.key === "ielts_band") S.ans.lang_status = picked === "unknown" ? "none" : "have";
        sb.from("profiles").update({ answers: S.ans, updated_at: new Date().toISOString() }).eq("user_id", S.session.user.id).then(function () {});
        recompute(); pushHistory("правка анкеты"); bg.remove(); renderProfile();
        /* Сменил направление — вероятности пересчитались, но подачи и список
           документов остались от прежнего трека. Молча оставлять это нельзя:
           человек будет собирать бумаги под программы, которые ему больше
           не подходят. */
        if (changedDirection) { toast("Пересчитали. Портфель собран под прежнее направление — посмотри новые программы"); setTimeout(function () { setTab("unis"); }, 900); }
        else toast("Пересчитали вероятности");
      }
    });
  }

  function openPrivacy() {
    openSub(function () {
      return subHead("Данные и приватность") +
        '<div class="card" style="margin-bottom:12px"><b class="sm">Что у нас хранится</b>' +
        '<div class="feat">✅ Ответы анкеты и расчёты вероятности</div>' +
        '<div class="feat">✅ Загруженные документы — ' + S.docs.filter(function (d) { return d.file_path; }).length + " " + plural(S.docs.filter(function (d) { return d.file_path; }).length, "файл", "файла", "файлов") + "</div>" +
        '<div class="feat">✅ Контакты: почта' + (S.profile && S.profile.whatsapp ? ", WhatsApp" : "") + "</div>" +
        '<p class="xs mut" style="margin:8px 0 0">Файлы лежат в защищённом хранилище с доступом только по твоему аккаунту. Мы не передаём документы третьим лицам.</p></div>' +
        '<a class="btn btn-ghost btn-block" href="/privacy/" target="_blank" rel="noopener">Политика конфиденциальности</a>' +
        '<button class="btn btn-ghost btn-block" style="margin-top:8px" data-act="export">Скачать мои данные</button>' +
        '<button class="btn btn-ghost btn-block" style="margin-top:8px;color:#C0392B" data-act="delacc">Удалить аккаунт</button>' +
        '<p class="xs mut" style="margin-top:10px">Удаление аккаунта необратимо: подачи, документы и файлы стираются. Оплаченный отчёт лучше скачать заранее.</p>';
    });
  }
  function openHelp() {
    var wa = "https://wa.me/" + (C.WHATSAPP_NUMBER || "") + "?text=" + encodeURIComponent("Здравствуйте! Пишу из личного кабинета Scholary. Вопрос: ");
    openSub(function () {
      return subHead("Помощь", "отвечаем 10:00–20:00, обычно за 20 минут") +
        '<a class="chanl" href="' + wa + '" target="_blank" rel="noopener"><div class="ic-c" style="background:#25D366">💬</div>' +
        '<div style="flex:1"><b class="sm">WhatsApp</b><div class="xs mut">Быстрее всего · ответим в рабочее время</div></div><span class="xs mut">→</span></a>' +
        (C.TELEGRAM_URL ? '<a class="chanl" href="' + esc(C.TELEGRAM_URL) + '" target="_blank" rel="noopener"><div class="ic-c" style="background:#2AABEE">✈️</div>' +
          '<div style="flex:1"><b class="sm">Telegram</b><div class="xs mut">Там же придут дедлайны, когда подключим бота</div></div><span class="xs mut">→</span></a>' : "") +
        '<div class="card" style="margin-top:12px"><b class="sm">Частые вопросы</b>' +
        [["Отчёт не пришёл в WhatsApp", "Проверь номер в профиле и папку «Архив». Напиши нам — вышлем ссылку заново."],
         ["Можно подать без IELTS", "Да, часть программ принимает внутренний экзамен или язык страны. В каталоге есть фильтр «Можно без IELTS»."],
         ["Как заказать апостиль", "Открой любой документ об образовании — там пошаговый порядок со сроками."],
         ["Точны ли проценты", "Это оценка модели по твоему профилю и требованиям программ, а не гарантия. Мы честно показываем, из чего она складывается."]].map(function (q) {
          return '<details class="faq"><summary>' + esc(q[0]) + "</summary><p>" + esc(q[1]) + "</p></details>";
        }).join("") + "</div>";
    });
  }
  function openReports() {
    openSub(function () {
      var rs = S.reports || [];
      return subHead("Мои отчёты", rs.length ? "" : "пока пусто") +
        (rs.length ? rs.map(function (r) {
          return '<a class="lst" href="/report/?t=' + esc(r.token) + '" target="_blank" rel="noopener"><div style="flex:1"><b class="sm">Отчёт от ' + new Date(r.created_at).toLocaleDateString("ru-RU") + "</b>" +
            '<div class="xs mut">открыть в новой вкладке</div></div><span class="xs mut">→</span></a>';
        }).join("")
        : '<div class="empty"><div class="art">📄</div><h3>Отчётов пока нет</h3><p>Отчёт появляется после оплаты и живёт здесь навсегда.</p>' +
          '<a class="btn btn-primary" href="/quiz/" target="_blank" rel="noopener">Пройти квиз</a></div>');
    });
  }
  function openSubscribe() {
    var pro = S.profile && S.profile.pro_until && new Date(S.profile.pro_until) > new Date();
    var wa = function (txt) { return "https://wa.me/" + (C.WHATSAPP_NUMBER || "") + "?text=" + encodeURIComponent(txt); };
    openSub(function () {
      return subHead("Scholary Pro", pro ? "активна до " + fmtDL(new Date(S.profile.pro_until)) : "ИИ без ограничений на весь сезон") +
        (pro ? '<div class="card" style="border-color:var(--ok);background:var(--ok-soft);margin-bottom:12px"><b class="sm">Подписка активна</b>' +
              '<div class="xs mut" style="margin-top:4px">До ' + fmtDL(new Date(S.profile.pro_until)) + " · 60 разборов ИИ в день и модель посильнее</div></div>" : "") +
        '<div class="card" style="margin-bottom:12px"><div class="h-row"><b>Бесплатно</b><span class="pill pill-mut">сейчас у тебя</span></div>' +
          '<div class="feat">✅ Все подачи, чек-листы и дедлайны</div>' +
          '<div class="feat">✅ Каталог 236 программ с твоими вероятностями</div>' +
          '<div class="feat">✅ Проверка документов по правилам — без лимита</div>' +
          '<div class="feat">✅ 8 разборов с ИИ в день: документы и письмо</div></div>' +
        '<div class="card" style="border:1.5px solid var(--accent);box-shadow:0 0 0 4px var(--accent-soft);margin-bottom:12px">' +
          '<div class="h-row"><b>Scholary Pro</b><span class="pill pill-acc">выгодно в сезон</span></div>' +
          '<div style="font-size:27px;font-weight:800;letter-spacing:-0.03em;margin:6px 0 2px">14 900 ₸<span class="sm mut" style="font-weight:600"> за весь сезон</span></div>' +
          '<p class="xs mut" style="margin:0 0 8px">сентябрь — февраль, все дедлайны сезона. Помесячно — 4 990 ₸, на сезон выходит выгоднее на 5 060 ₸</p>' +
          '<div class="feat">⚡ 60 разборов с ИИ в день вместо 8</div>' +
          '<div class="feat">⚡ Разбор делает более сильная модель — глубже и конкретнее</div>' +
          '<div class="feat">⚡ Симулятор «что если»: видно, что поднимет шансы сильнее всего</div>' +
          '<div class="feat">⚡ Приоритетные напоминания о дедлайнах</div>' +
          '<button class="btn btn-primary btn-block" style="margin-top:12px" data-act="pay-pro" data-v="season">Взять на весь сезон · 14 900 ₸</button>' +
          '<button class="btn btn-ghost btn-block" style="margin-top:8px" data-act="pay-pro" data-v="month">Сначала на месяц · 4 990 ₸</button>' +
        "</div>" +
        '<div class="card"><div class="h-row"><b>Документы и подача</b><span class="pill pill-mut">с живым человеком</span></div>' +
          '<div style="font-size:22px;font-weight:800;margin:6px 0 2px">35 000 ₸</div>' +
          '<p class="xs mut" style="margin:0 0 8px">Когда список программ уже понятен, а страшно ошибиться в бумагах. Ведём до отправки заявок — сами заявки подаёшь ты, доступы к твоим аккаунтам мы не просим.</p>' +
          '<div class="feat">1️⃣ Созвон 30 минут: разбираем твои 5 программ и что по ним нужно</div>' +
          '<div class="feat">2️⃣ Персональный чек-лист: какой документ, к какому числу, где заказывать</div>' +
          '<div class="feat">3️⃣ Проверяем каждый документ глазами: перевод, апостиль, сроки, формат</div>' +
          '<div class="feat">4️⃣ Мотивационное письмо и резюме — правки вручную, до двух кругов</div>' +
          '<div class="feat">5️⃣ Финальная сверка пакета перед отправкой по каждой программе</div>' +
          '<div class="feat">6️⃣ Ведём по дедлайнам до конца сезона и пишем, когда пора</div>' +
          '<a class="btn btn-ghost btn-block" style="margin-top:10px" target="_blank" rel="noopener" href="' + wa("Здравствуйте! Хочу пакет «Документы и подача» за 35 000 ₸") + '">Написать в WhatsApp</a></div>' +
        '<p class="xs mut" style="margin-top:12px">Оплата через Kaspi — счёт приходит в приложение, доступ включается автоматически в течение минуты. <a href="/oferta/" target="_blank" rel="noopener">Оферта</a></p>';
    });
  }

  function openTg() {
    // код одноразовый и стирается на сервере после привязки, поэтому берём длинный
    var code = (S.tg && S.tg.code) || "";
    if (S.tg && S.tg.chat_id) {
      openSub(function () {
        return subHead("Уведомления в Telegram", "шаг дня, дедлайны, дайджест") +
          '<div class="card"><b class="sm">Telegram привязан ✓</b><p class="xs mut" style="margin:6px 0 0">Дедлайны за 30 / 14 / 7 / 3 / 1 день, шаг дня и дайджест недели приходят в бот. Не больше одного сообщения в день, тихие часы 22:00–08:00.</p></div>';
      });
      return;
    }
    if (!code) {
      /* код генерирует сервер (64 бита, живёт 30 минут) — раньше Math.random() на клиенте */
      sb.rpc("tg_new_code").then(function (r) { if (r.data) { S.tg = S.tg || {}; S.tg.code = r.data; openTg(); } else toast("Не удалось получить код — попробуй ещё раз", "bad"); });
      code = "……";
    }
    var bot = (C.TELEGRAM_BOT || "").replace(/^@/, "");
    openSub(function () {
      return subHead("Уведомления в Telegram", "шаг дня, дедлайны, дайджест") +
        '<div class="card" style="margin-bottom:12px"><b class="sm">Что будет приходить</b>' +
        '<div class="feat">⏰ Дедлайны за 30 / 14 / 7 / 3 / 1 день</div>' +
        '<div class="feat">🎯 Шаг дня — одно действие утром</div>' +
        '<div class="feat">📊 Дайджест недели по воскресеньям</div>' +
        '<p class="xs mut" style="margin:8px 0 0">Не больше одного сообщения в день. Тихие часы 22:00–08:00.</p></div>' +
        '<div class="card" style="margin-bottom:12px"><b class="sm">Твой код привязки</b><div style="font-size:26px;font-weight:800;letter-spacing:.12em;margin:6px 0">' + esc(code) + "</div>" +
        (bot
          ? '<p class="xs mut" style="margin:0 0 10px">Код одноразовый: после привязки он перестаёт работать.</p>' +
            '<a class="btn btn-primary btn-block" href="https://t.me/' + esc(bot) + "?start=" + esc(code) + '" target="_blank" rel="noopener">Открыть бота и привязать</a>'
          : '<p class="xs mut" style="margin:0">Бот на подключении: код уже сохранён, привяжем автоматически, как только он заработает. Пока дедлайны присылаем в WhatsApp.</p>') +
        "</div>" +
        '<a class="btn btn-ghost btn-block" href="https://wa.me/' + (C.WHATSAPP_NUMBER || "") + '?text=' + encodeURIComponent("Хочу напоминания о дедлайнах в WhatsApp. Код: " + code) + '" target="_blank" rel="noopener">' + (bot ? "Или присылайте в WhatsApp" : "Пока присылайте в WhatsApp") + "</a>";
    });
  }

  /* Кнопка помощи прячется, когда человек листает вниз: иначе она
     перекрывает цифры в списках. Возвращается, как только скролл замер. */
  (function () {
    var fab = document.querySelector(".fab-help");
    if (!fab) return;
    var last = window.scrollY, t = null;
    window.addEventListener("scroll", function () {
      var y = window.scrollY;
      if (y > last + 6 && y > 120) fab.classList.add("hide");
      else if (y < last - 6) fab.classList.remove("hide");
      last = y;
      clearTimeout(t); t = setTimeout(function () { fab.classList.remove("hide"); }, 700);
    }, { passive: true });
  })();

  /* ================= действия ================= */
  function pushHistory(reason) {
    var o = overall();
    var lastTs = S.hist.length ? new Date(S.hist[S.hist.length - 1].ts) : null;
    if (lastTs && (new Date() - lastTs) < 6 * 3600e3) return;
    var row = { user_id: S.session.user.id, p_adm: o.adm, p_sch: o.sch, reason: reason || null };
    S.hist.push(Object.assign({ ts: new Date().toISOString() }, row));
    sb.from("probability_history").insert(row).then(function () {});
  }
  function addProgram(id, cb) {
    if (S.apps.some(function (a) { return a.program_id === id; })) { toast("Уже в подачах"); return; }
    sb.from("portfolio_items").insert({ user_id: S.session.user.id, program_id: id, status: "study" }).select().single().then(function (r) {
      if (r.error) { toast("Не удалось добавить", "bad"); return; }
      S.apps.push(r.data); recompute(); toast("Добавлено в подачи"); if (cb) cb();
      touch(true); awardCheck();
      if (window.track) track("cab_add_prog", { id: id });
    });
  }
  /* Форматы, которые реально принимают приёмные комиссии и умеет читать
     наша проверка. Всё остальное отсекаем ДО загрузки: раньше человек
     ждал заливки, а отказ получал уже после неё. */
  var OK_EXT = { pdf: "PDF", jpg: "JPG", jpeg: "JPG", png: "PNG", heic: "HEIC", webp: "WEBP" };
  var MAX_MB = 10;
  function fileProblem(file) {
    var ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!OK_EXT[ext]) {
      return "Формат «." + ext + "» не подходит. Нужен PDF, JPG или PNG — сохрани документ в PDF или сфотографируй." +
        (ext === "doc" || ext === "docx" ? " Word открой и сохрани как PDF: «Файл → Сохранить как → PDF»." : "");
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      return "Файл " + (file.size / 1048576).toFixed(1) + " МБ, а можно до " + MAX_MB + " МБ. Сфотографируй с меньшим разрешением или сохрани в PDF.";
    }
    if (!file.size) return "Файл пустой — похоже, он не докачался. Попробуй выбрать заново.";
    return null;
  }
  function pickFile(cb) {
    var i = document.createElement("input"); i.type = "file";
    i.accept = ".pdf,.jpg,.jpeg,.png,.heic,.webp,image/*,application/pdf";
    i.onchange = function () { if (i.files && i.files[0]) cb(i.files[0]); };
    i.click();
  }
  function uploadFor(d, cb) {
    pickFile(function (file) {
      var bad = fileProblem(file);
      if (bad) { toast(bad, "bad"); return; }
      toast("Загружаем " + file.name.slice(0, 24) + "…");
      var path = S.session.user.id + "/" + d.id + "-" + Date.now() + "-" + file.name.replace(/[^\w.\-]+/g, "_");
      sb.storage.from("docs").upload(path, file, { upsert: true }).then(function (r) {
        if (r.error) {
          toast("Не удалось загрузить: " + (r.error.message || "нет связи") + ". Попробуй ещё раз — файл не потерялся.", "bad");
          return;
        }
        /* После загрузки СРАЗУ прогоняем проверку по правилам и показываем
           результат — раньше человек видел только «файл загружен» и не
           понимал, всё ли с документом в порядке. */
        saveDoc(d, {
          file_path: path,
          file_name: file.name.slice(0, 120),
          status: d.status === "none" ? "progress" : d.status,
          checked_at: new Date().toISOString()
        }, function () {
          recompute(); drawSub();
          var vs = D.checkDocument(d, appsForDoc(), S.ans, S.evalR && S.evalR.profile);
          var blockers = vs.filter(function (x) { return x.level === "blocker"; }).length;
          toast(blockers ? "Загружено · нашли " + blockers + " " + plural(blockers, "замечание", "замечания", "замечаний") + " ниже" : "Загружено · замечаний нет", blockers ? "bad" : "");
          if (window.track) track("cab_doc_upload", { type: d.doc_type, blockers: blockers });
          touch(true); awardCheck();
          if (cb) cb();
        });
      });
    });
  }
  function openFile(d) {
    if (!d.file_path) return;
    /* Safari на iPhone блокирует window.open после асинхронного вызова —
       окно открываем сразу по тапу, адрес подставляем, когда придёт. */
    var w = null; try { w = window.open("", "_blank"); } catch (e) {}
    sb.storage.from("docs").createSignedUrl(d.file_path, 300).then(function (r) {
      if (r.data && r.data.signedUrl) { if (w) w.location = r.data.signedUrl; else window.open(r.data.signedUrl, "_blank", "noopener"); }
      else { if (w) w.close(); toast("Не удалось открыть файл", "bad"); }
    });
  }

  /* Оплата подписки. Доступ продлевает СЕРВЕР по уведомлению шлюза
     (api/tiptop.php → tiptop_grant_pro), поэтому в AccountId кладём почту
     аккаунта — иначе непонятно, кому продлевать. */
  function payPro(plan, method) {
    var season = plan === "season";
    var amount = season ? (C.PRICE_PRO_SEASON || 14900) : (C.PRICE_PRO_MONTH || 4990);
    var email = (S.session && S.session.user && S.session.user.email) || "";
    var cardOk = !!(window.scholaryTerminalReady && window.scholaryTerminalReady());
    var kaspiOk = !!(window.scholaryKaspiReady && window.scholaryKaspiReady());
    if (!method) {
      if (window.track) track("pro_click", { plan: plan });
      if (!email) { proByHand(plan, email); return; }
      if (kaspiOk && cardOk) { openPayMethod(plan); return; }
      if (kaspiOk) { openKaspiPro(plan); return; }
      if (!cardOk) { proByHand(plan, email); return; }
    }
    if (method === "kaspi") { openKaspiPro(plan); return; }
    if (!cardOk || !email) { proByHand(plan, email); return; }

    var extId = "pro_" + (email ? email.replace(/[^a-z0-9]/gi, "").slice(0, 10) : "x") + "_" + Date.now().toString(36);
    toast("Открываем оплату…");
    window.scholaryPay({
      kind: season ? "pro_season" : "pro_month",
      amount: amount,
      description: "Scholary Pro — " + (season ? "весь сезон" : "месяц"),
      externalId: extId,
      accountId: email,
      email: email,
      onSuccess: function () {
        toast("Оплата прошла. Обновляем доступ…", "ok");
        // Продление приходит вебхуком, а не с этой страницы: перечитываем профиль.
        // Продление ставит вебхук, а не эта страница: перечитываем профиль.
        // Уведомление идёт своим маршрутом, поэтому даём ему фору и пробуем дважды.
        refreshPro(1);
      },
      onPending: function () {
        // Шлюз ответил wait: деньги могли уйти. Не пугаем «не прошла», а ждём вебхук.
        toast("Платёж обрабатывается банком. Повторно платить не нужно", "ok");
        refreshPro(1);
      },
      onFail: function () { toast("Оплата не прошла. Попробуй другую карту", "bad"); },
      onError: function () { proByHand(plan, email); }
    });
  }
  /* Перечитать pro_until после оплаты: вебхук доходит за секунду-две,
     но если сеть тормозит — пробуем ещё раз, а потом честно просим обновить. */
  function refreshPro(attempt) {
    setTimeout(function () {
      sb.from("profiles").select("*").maybeSingle().then(function (r) {
        var pro = r.data && r.data.pro_until && new Date(r.data.pro_until) > new Date();
        if (pro) { S.profile = r.data; toast("Scholary Pro активен", "ok"); drawSub(); return; }
        if (attempt < 3) { refreshPro(attempt + 1); return; }
        toast("Оплата прошла. Доступ появится в течение минуты — обнови страницу", "ok");
      });
    }, attempt * 2500);
  }
  /* Выбор способа оплаты подписки: Kaspi (счёт в приложение) или карта. */
  function openPayMethod(plan) {
    var season = plan === "season";
    openSub(function () {
      return subHead("Оплата Scholary Pro", (season ? "сезон · 14 900 ₸" : "месяц · 4 990 ₸")) +
        '<div class="card" style="margin-bottom:12px"><b>Как удобнее оплатить?</b>' +
          '<button class="btn btn-block" style="margin-top:12px;background:#E5442F;color:#fff" data-act="pay-pro-kaspi" data-v="' + plan + '">Через Kaspi — счёт в приложение</button>' +
          '<button class="btn btn-ghost btn-block" style="margin-top:8px" data-act="pay-pro-card" data-v="' + plan + '">Картой / Apple Pay / Google Pay</button>' +
          '<p class="xs mut" style="margin:10px 0 0">Доступ включится автоматически в течение минуты после оплаты. <a href="/oferta/" target="_blank" rel="noopener">Оферта</a></p></div>';
    });
  }

  /* Kaspi: спрашиваем номер (по умолчанию — WhatsApp из профиля), выставляем
     счёт, ждём подтверждения сервера и перечитываем pro_until. */
  var kaspiProCtl = null;
  function fmtKz(d) { d = String(d || "").replace(/\D/g, ""); return d.length === 11 ? "+7 " + d.slice(1, 4) + " " + d.slice(4, 7) + " " + d.slice(7, 9) + " " + d.slice(9) : d; }
  function stopKaspiPro() { if (kaspiProCtl) { try { kaspiProCtl.stop(); } catch (e) {} kaspiProCtl = null; } }
  function openKaspiPro(plan) {
    var season = plan === "season";
    var amount = season ? (C.PRICE_PRO_SEASON || 14900) : (C.PRICE_PRO_MONTH || 4990);
    var email = (S.session && S.session.user && S.session.user.email) || "";
    var phone0 = (S.profile && S.profile.whatsapp) || "";
    var st = { phase: "ask", status: "", code: "", msg: "", phone: phone0 };
    stopKaspiPro();
    var render = function () {
      var body;
      if (st.phase === "ask") {
        body = '<div class="card"><b>Номер, на который установлен Kaspi</b>' +
          '<p class="xs mut" style="margin:4px 0 10px">Счёт на ' + (season ? "14 900" : "4 990") + ' ₸ придёт в приложение Kaspi.kz — подтвердить можно в два тапа.</p>' +
          '<input id="kaspiPhone" class="f" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 7__ ___ __ __" value="' + esc(fmtKz(st.phone) || st.phone) + '" style="width:100%;box-sizing:border-box">' +
          (st.msg ? '<p class="xs" style="color:var(--bad);margin:8px 0 0">' + esc(st.msg) + '</p>' : '') +
          '<button class="btn btn-block" style="margin-top:12px;background:#E5442F;color:#fff" data-act="kaspi-pro-go" data-v="' + plan + '">Выставить счёт в Kaspi</button>' +
          '<p class="xs mut" style="margin:10px 0 0">Аккаунт: ' + esc(email) + ' — доступ Pro включится на нём. <a href="/oferta/" target="_blank" rel="noopener">Оферта</a></p></div>';
      } else if (st.phase === "wait") {
        body = '<div class="card" style="text-align:center"><div style="font-size:19px;font-weight:800;margin:6px 0">Счёт отправлен в Kaspi</div>' +
          '<p class="xs mut" style="margin:0 0 10px">Открой приложение <b>Kaspi.kz</b> → уведомление или <b>Платежи → Счета на оплату</b> и подтверди ' + (season ? "14 900" : "4 990") + ' ₸ на номере <b>' + esc(fmtKz(st.phone)) + '</b>.<br>Страница сама увидит оплату и включит Pro.</p>' +
          '<div class="xs mut" style="display:flex;justify-content:center;align-items:center;gap:8px;font-weight:700"><span class="spin"></span><span id="kaspiProStatus">' + (st.status === "pending" ? "Счёт выставлен — ждём оплату" : "Отправляем счёт в Kaspi…") + '</span></div>' +
          '<button class="btn btn-ghost btn-block" style="margin-top:12px" data-act="kaspi-pro-change">Другой номер</button></div>';
      } else if (st.phase === "done") {
        body = '<div class="card" style="border-color:var(--ok);background:var(--ok-soft);text-align:center"><div style="font-size:19px;font-weight:800;margin:6px 0">Оплата прошла</div>' +
          '<p class="xs mut" style="margin:0">Включаем Scholary Pro на аккаунте ' + esc(email) + '…</p></div>';
      } else {
        var t = "Оплата не прошла", d = st.msg || "Деньги не списаны. Можно попробовать ещё раз.";
        if (st.code === "client_not_found") { t = "Номер не зарегистрирован в Kaspi"; d = "Укажи номер, на который установлен Kaspi.kz."; }
        else if (st.status === "expired") { t = "Срок счёта истёк"; d = "Счёт действовал 24 часа. Выставим новый."; }
        else if (st.status === "cancelled") { t = "Счёт отменён"; d = "Оплата не подтверждена в Kaspi. Деньги не списаны."; }
        else if (st.code === "rate") { t = "Слишком много попыток"; d = "Открой Kaspi → Платежи → Счета: оплатить можно любой из них."; }
        else if (st.code === "poll_lost") { t = "Связь с сервером прервалась"; d = "Счёт уже выставлен. Если ты его оплатил — Pro включится сам в течение минуты: обнови страницу. Повторное нажатие новый счёт не выставит."; }
        else if (!st.msg) { t = "Kaspi временно недоступен"; d = "Попробуй через минуту или напиши нам в WhatsApp."; }
        body = '<div class="card"><b>' + esc(t) + '</b><p class="xs mut" style="margin:4px 0 10px">' + esc(d) + '</p>' +
          '<button class="btn btn-block" style="background:#E5442F;color:#fff" data-act="kaspi-pro-change">' + (st.code === "client_not_found" ? "Указать другой номер" : "Попробовать ещё раз") + '</button>' +
          '<a class="btn btn-ghost btn-block" style="margin-top:8px" target="_blank" rel="noopener" href="https://wa.me/' + (C.WHATSAPP_NUMBER || "") + '?text=' + encodeURIComponent("Здравствуйте! Не проходит оплата Kaspi за Scholary Pro. Аккаунт: " + email) + '">Написать в WhatsApp</a></div>';
      }
      return subHead("Оплата через Kaspi", (season ? "сезон · 14 900 ₸" : "месяц · 4 990 ₸")) + body;
    };
    openSub(render);
    kaspiProState = { st: st, plan: plan, amount: amount, email: email, render: render };
  }
  var kaspiProState = null;
  function kaspiProGo() {
    var k = kaspiProState; if (!k) return;
    var inp = $("kaspiPhone");
    var digits = (inp ? inp.value : k.st.phone).replace(/\D/g, "");
    if (digits.length === 11 && digits[0] === "8") digits = "7" + digits.slice(1);
    if (digits.length === 10) digits = "7" + digits;
    if (!/^7\d{10}$/.test(digits)) { k.st.msg = "Проверь номер: нужно 10 цифр после +7"; drawSub(); return; }
    k.st.phone = digits; k.st.msg = ""; k.st.phase = "wait"; k.st.status = "";
    drawSub();
    stopKaspiPro();
    kaspiProCtl = window.scholaryKaspi({
      kind: k.plan === "season" ? "pro_season" : "pro_month", amount: k.amount, phone: digits, email: k.email, account: k.email,
      onCreated: function (j) { k.st.status = j.status; var el = $("kaspiProStatus"); if (el) el.textContent = j.status === "pending" ? "Счёт выставлен — ждём оплату" : "Отправляем счёт в Kaspi…"; },
      onStatus: function (s2, j) {
        if (s2 === "paid") { stopKaspiPro(); k.st.phase = "done"; drawSub(); toast("Оплата прошла. Обновляем доступ…", "ok"); refreshPro(1); setTimeout(function () { if (S.stack.length) backSub(); }, 3500); return; }
        if (s2 === "error" || s2 === "expired" || s2 === "cancelled") { stopKaspiPro(); k.st.phase = "fail"; k.st.status = s2; k.st.code = j.error_code || ""; k.st.msg = j.error_message || ""; drawSub(); return; }
        k.st.status = s2; var el = $("kaspiProStatus"); if (el) el.textContent = s2 === "pending" ? "Счёт выставлен — ждём оплату" : "Отправляем счёт в Kaspi…";
      },
      onError: function (why, msg) { stopKaspiPro(); k.st.phase = "fail"; k.st.status = "create_failed"; k.st.code = why; k.st.msg = msg || ""; drawSub(); }
    });
  }
  function proByHand(plan, email) {
    var label = plan === "season" ? "сезон · 14 900 ₸" : "месяц · 4 990 ₸";
    toast("Онлайн-оплата недоступна — пишем в WhatsApp");
    window.open("https://wa.me/" + (C.WHATSAPP_NUMBER || "") + "?text=" +
      encodeURIComponent("Здравствуйте! Хочу Scholary Pro (" + label + "). Аккаунт: " + (email || "")), "_blank", "noopener");
  }

  /* ---- маршрутизация действий задач/темы недели ---- */
  function goAct(a) {
    var p = a.split(":"), k = p[0], arg = p.slice(1).join(":");
    if (k === "tab-unis") { setTab("unis"); return; }
    if (k === "tab-docs") { setTab("docs"); return; }
    if (k === "tab-apps") { setTab("apps"); return; }
    if (k === "tab-today") { setTab("today"); return; }
    if (k === "chance") { openChance(); return; }
    if (k === "subscribe") { openSubscribe(); return; }
    if (k === "discover") { uniFilter.mode = "discover"; uniFilter.col = arg === "week" ? null : arg; if (window.track) track("cab_discover_open", { col: arg }); setTab("unis"); return; }
    if (k === "doc-id") { openDoc(arg); return; }
    if (k === "doc") { var ex = docsOfType(arg)[0]; if (ex) openDoc(ex.id); else openNewDoc(arg, null); return; }
    if (k === "presubmit") { openPresubmit(arg); return; }
    if (k === "app") { openApp(arg); return; }
    if (k === "letter") {
      var app0 = arg ? S.apps.filter(function (x) { return x.id === +arg; })[0] : appViews().filter(function (v) { return !v.a.submitted_at; }).map(function (v) { return v.a; })[0];
      if (!app0) { setTab("unis"); return; }
      var dl = docFor("motivation", app0.program_id);
      if (dl && dl.content) openDoc(dl.id); else openWizard(null, app0.id);
      return;
    }
    if (k === "rec-request") { openRecRequest(); return; }
    setTab("today");
  }
  function saveCabPrefs(cab, cb) {
    S.profile = Object.assign({}, S.profile || {}, { cab: cab });
    sb.from("profiles").update({ cab: cab, updated_at: new Date().toISOString() }).eq("user_id", S.session.user.id).then(function (r) {
      if (r && r.error && window.console) console.warn("profiles.cab", r.error.message);
      if (cb) cb();
    });
  }
  /* Настройки недели в профиле. */
  function weekSettingsHTML() {
    var cab = cabPrefs(), wp = weeksNow(), tg = S.tg && S.tg.chat_id, prefs = (S.tg && S.tg.prefs) || {};
    return '<div class="card" style="margin-bottom:12px"><b class="sm">Моя неделя</b>' +
      '<div class="lst"><div style="flex:1"><b class="sm">Цель недели</b><div class="xs mut">задач в неделю · сейчас ' + weekGoal() + "</div></div><button class=\"btn btn-ghost btn-sm\" data-act=\"week-goal\">Изменить</button></div>" +
      '<div class="lst"><div style="flex:1"><b class="sm">Недели с прогрессом</b><div class="xs mut">' + (wp.streak ? wp.streak + " подряд · всего " + wp.total : "всего " + wp.total) + " · пропуск раз в месяц не рвёт серию</div></div></div>" +
      '<div class="lst"><div style="flex:1"><b class="sm">Эта неделя</b><div class="xs mut">' + (wp.quietThisWeek ? "на паузе (экзамены, каникулы)" : "в плане") + "</div></div><button class=\"btn btn-ghost btn-sm\" data-act=\"quiet-week\">" + (wp.quietThisWeek ? "Снять паузу" : "Пауза") + "</button></div>" +
      (tg ? '<div class="lst"><div style="flex:1"><b class="sm">Дайджест недели в Telegram</b><div class="xs mut">понедельник утром · план и ближайший дедлайн</div></div><button class="btn ' + (prefs.digest === false ? "btn-ghost" : "btn-soft") + ' btn-sm" data-act="tg-pref" data-v="digest">' + (prefs.digest === false ? "Выкл" : "Вкл") + "</button></div>" +
             '<div class="lst"><div style="flex:1"><b class="sm">«Неделя ещё не засчитана»</b><div class="xs mut">четверг вечером, только если задач за неделю нет</div></div><button class="btn ' + (prefs.week === false ? "btn-ghost" : "btn-soft") + ' btn-sm" data-act="tg-pref" data-v="week">' + (prefs.week === false ? "Выкл" : "Вкл") + "</button></div>"
          : '<p class="xs mut" style="margin:8px 0 0">Подключи Telegram ниже — план недели и дедлайны будут приходить сами, не чаще раза в день.</p>') +
      "</div>";
  }
  function toggleTgPref(key) {
    if (!S.tg) return;
    var prefs = Object.assign({}, S.tg.prefs || {}); prefs[key] = prefs[key] === false;
    S.tg.prefs = prefs;
    sb.from("tg_links").update({ prefs: prefs }).eq("user_id", S.session.user.id).then(function () { renderProfile(); });
  }

  /* ================= делегирование событий ================= */
  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]"); if (!el) return;
    var act = el.getAttribute("data-act");
    var id = el.getAttribute("data-id"), appId = el.getAttribute("data-app"), v = el.getAttribute("data-v"), dt = el.getAttribute("data-doc");
    var app = appId ? S.apps.filter(function (x) { return x.id === +appId; })[0] : null;
    var doc = id ? S.docs.filter(function (x) { return x.id === +id; })[0] : null;

    if (act === "back") { e.preventDefault(); backSub(); return; }
    if (act === "chance") { openChance(); return; }
    if (act === "app") { openApp(appId); return; }
    if (act === "af") { appsFilter = v; renderApps(); return; }
    if (act === "tab-unis") { setTab("unis"); return; }
    if (act === "tab-docs") { setTab("docs"); return; }
    if (act === "subscribe") { openSubscribe(); return; }
    if (act === "pay-pro") { payPro(v); return; }
    if (act === "pay-pro-kaspi") { S.stack.pop(); payPro(v, "kaspi"); return; }
    if (act === "pay-pro-card") { S.stack.pop(); drawSub(); payPro(v, "card"); return; }
    if (act === "kaspi-pro-go") { kaspiProGo(); return; }
    if (act === "kaspi-pro-change") { stopKaspiPro(); if (kaspiProState) { kaspiProState.st.phase = "ask"; kaspiProState.st.msg = ""; drawSub(); } return; }
    if (act === "apptab") { appTab = v; drawSub(); return; }
    if (act === "status" && app) { saveApp(app, { status: v }, function () { drawSub(); }); return; }
    if (act === "outcome" && app) {
      saveApp(app, { outcome: v, outcome_at: new Date().toISOString() }, function () { drawSub(); awardCheck(); });
      touch(true);
      toast(v === "admit" ? "Поздравляем! Записали исход" : "Записали — это уточняет модель"); return;
    }
    if (act === "submit" && app) {
      saveApp(app, { submitted_at: new Date().toISOString(), status: "applied" }, function () { S.stack.pop(); drawSub(); awardCheck(); });
      touch(true);
      toast("Подача отмечена отправленной"); if (window.track) track("cab_submit", {}); return;
    }
    if (act === "presubmit") { openPresubmit(appId); return; }
    if (act === "note-save" && app) {
      var ta = document.getElementById("app-note");
      saveApp(app, { note: ta ? ta.value : "" }, function () { toast("Заметка сохранена"); }); return;
    }
    if (act === "ck" && app) {
      var ck = Object.assign({}, app.checklist || {});
      ck[dt] = !ck[dt];
      saveApp(app, { checklist: ck }, function () { recompute(); drawSub(); pushHistory("отметка документа"); });
      return;
    }
    if (act === "step-go") {
      if (el.getAttribute("data-doc")) {
        var ex = docFor(dt, app ? app.program_id : null);
        if (ex) openDoc(ex.id); else openNewDoc(dt, appId);
      } else openPresubmit(appId);
      return;
    }
    if (act === "step-done" && app) {
      var ck2 = Object.assign({}, app.checklist || {}); ck2[dt] = true;
      saveApp(app, { checklist: ck2 }, function () { recompute(); renderToday(); pushHistory("отметка документа"); });
      toast("Отметили как готовое"); return;
    }
    if (act === "doc" && doc) { openDoc(doc.id); return; }
    if (act === "doc-new") { openNewDoc(dt, appId); return; }
    if (act === "doc-pick") {
      var plan0 = docPlanNow();
      var types = plan0.length ? plan0.map(function (x) { return x.t; }) : docTypesForUser();
      var bg = document.createElement("div"); bg.className = "modal-bg";
      bg.innerHTML = '<div class="modal"><b>Что загружаешь?</b><div style="margin-top:10px">' +
        types.map(function (t) { var T = D.TYPES[t] || { title: t, ic: "📄" };
          return '<button class="lst wide" data-t="' + t + '"><span>' + T.ic + '</span><div style="flex:1;text-align:left"><b class="sm">' + esc(T.title) + "</b></div><span class=\"xs mut\">→</span></button>"; }).join("") +
        '</div><button class="btn btn-ghost btn-sm btn-block" style="margin-top:10px" data-x="1">Отмена</button></div>';
      document.getElementById("modal-root").appendChild(bg);
      bg.addEventListener("click", function (ev) {
        var b = ev.target.closest("[data-t]");
        if (b) { bg.remove(); openNewDoc(b.getAttribute("data-t")); return; }
        if (ev.target.closest("[data-x]") || ev.target === bg) bg.remove();
      });
      return;
    }
    if (act === "docst" && doc) {
      saveDoc(doc, { status: v, checked_at: new Date().toISOString() }, function () { recompute(); drawSub(); pushHistory("документ " + v); awardCheck(); });
      touch(v !== "none");
      if (v === "ready") toast("Отмечено готовым");
      return;
    }
    if (act === "upload" && doc) { uploadFor(doc); return; }
    if (act === "doc-help") { openSub(docHelpHTML); return; }
    if (act === "recheck" && doc) {
      /* Явная перепроверка по правилам: человек поправил данные или заменил
         файл и хочет увидеть свежий вердикт, не гадая, обновилось ли оно. */
      saveDoc(doc, { checked_at: new Date().toISOString() }, function () {
        recompute(); drawSub();
        var vs = D.checkDocument(doc, appsForDoc(), S.ans, S.evalR && S.evalR.profile);
        var b = vs.filter(function (x) { return x.level === "blocker"; }).length;
        toast(b ? "Проверили · " + b + " " + plural(b, "замечание", "замечания", "замечаний") : "Проверили · замечаний нет", b ? "bad" : "");
      });
      return;
    }
    if (act === "dl" && doc) { openFile(doc); return; }
    if (act === "letter" && doc) { openDoc(doc.id); return; }
    if (act === "letter-save" && doc) {
      var t = document.getElementById("letter-text");
      saveDoc(doc, { content: t ? t.value : "", version: (doc.version || 1) + 1, checked_at: new Date().toISOString() }, function () { drawSub(); awardCheck(); });
      touch(true);
      toast("Сохранено · разбор обновлён"); return;
    }
    if (act === "ai-doc" && doc) { aiCheckDoc(doc); return; }
    if (act === "ai-letter" && doc) {
      var tl = document.getElementById("letter-text");
      var body = tl ? tl.value : (doc.content || "");
      var progL = doc.program_ids && doc.program_ids.length ? progById(doc.program_ids[0]) : null;
      if (tl && tl.value !== doc.content) {
        saveDoc(doc, { content: body, version: (doc.version || 1) + 1 }, function () { aiCheckLetter(doc, progL); });
      } else aiCheckLetter(doc, progL);
      return;
    }
    if (act === "letter-wizard") { openWizard(id, appId); return; }
    if (act === "wiz-next") {
      var ta2 = document.getElementById("wiz-a");
      wizState.ans[WIZ_Q[wizState.i].k] = ta2 ? ta2.value : "";
      wizState.i++; drawSub(); return;
    }
    if (act === "wiz-save") {
      var draft = wizDraft();
      if (wizState.docId) {
        var d0 = S.docs.filter(function (x) { return x.id === +wizState.docId; })[0];
        if (d0) saveDoc(d0, { content: draft, version: (d0.version || 1) + 1 }, function () { backSub(); drawSub(); });
      } else {
        var pid = wizState.appId ? (S.apps.filter(function (x) { return x.id === +wizState.appId; })[0] || {}).program_id : null;
        createDoc({ doc_type: "motivation", title: "Мотивационное письмо", status: "progress", content: draft, program_ids: pid ? [pid] : [] }, function (nd) {
          S.stack.pop(); openDoc(nd.id);
        });
      }
      toast("Черновик сохранён"); return;
    }
    if (act === "field") return;
    if (act === "plan") { toast("Добавили в план — увидишь в «Сегодня»"); return; }
    if (act === "fields") { toast("Заполни поля документа выше"); return; }
    if (act === "howto") { toast("Порядок действий — ниже на этом экране"); return; }
    if (act === "ai-wrong" || act === "report-err") {
      e.preventDefault();
      var wa2 = "https://wa.me/" + (C.WHATSAPP_NUMBER || "") + "?text=" + encodeURIComponent("Кажется, в кабинете Scholary неточность. Экран: " + (act === "ai-wrong" ? "проверка документа" : "программа " + (id || appId || "")) + ". Опишу: ");
      window.open(wa2, "_blank", "noopener"); return;
    }
    /* ---- web-74: задачи недели, путь, календарь, discover, рекомендации ---- */
    var tkey = el.getAttribute("data-key");
    if (act === "task-done" && tkey) {
      var cur = S.cab.state[tkey] || {};
      var toDone = cur.status !== "done";
      var planT = (S.plan && S.plan.tasks || []).filter(function (t) { return t.key === tkey; })[0];
      taskSave(tkey, { status: toDone ? "done" : "open" }, null);
      if (toDone) { touch(true); if (window.track) track("cab_task_done", { kind: tkey.split(":")[1], week: S.plan ? S.plan.week.n : 0 }); }
      var goal = weekGoal(), doneN = (S.plan && S.plan.tasks || []).filter(function (t) { return (S.cab.state[t.key] || {}).status === "done"; }).length;
      renderToday(); renderWidget();
      if (toDone) { toast(doneN >= goal ? "Цель недели закрыта · " + doneN + " из " + goal : "Готово · неделя засчитана · " + doneN + " из " + goal, "ok"); awardCheck(); }
      return;
    }
    if (act === "task-undo" && tkey) { taskSave(tkey, { status: "open" }); renderToday(); return; }
    if (act === "task-menu" && tkey) {
      var bgm = document.createElement("div"); bgm.className = "modal-bg";
      bgm.innerHTML = '<div class="modal"><b>Задача</b><div style="margin-top:10px">' +
        '<button class="lst wide" data-m="move"><span>↪</span><div style="flex:1;text-align:left"><b class="sm">Перенести на следующую неделю</b><div class="xs mut">появится в плане в понедельник</div></div></button>' +
        '<button class="lst wide" data-m="skip"><span>✕</span><div style="flex:1;text-align:left"><b class="sm">Не актуально</b><div class="xs mut">уберём из плана без последствий</div></div></button>' +
        '</div><button class="btn btn-ghost btn-sm btn-block" style="margin-top:10px" data-x="1">Отмена</button></div>';
      document.getElementById("modal-root").appendChild(bgm);
      bgm.addEventListener("click", function (ev) {
        var b = ev.target.closest("[data-m]");
        if (b) {
          var m = b.getAttribute("data-m"), pt = (S.plan && S.plan.tasks || []).filter(function (t) { return t.key === tkey; })[0];
          taskSave(tkey, { status: m === "move" ? "moved" : "skipped", title: pt ? pt.title : "" });
          if (window.track) track(m === "move" ? "cab_task_move" : "cab_task_skip", { kind: tkey.split(":")[1] });
          bgm.remove(); renderToday(); toast(m === "move" ? "Перенесли на следующую неделю" : "Убрали из плана"); return;
        }
        if (ev.target.closest("[data-x]") || ev.target === bgm) bgm.remove();
      });
      return;
    }
    if (act === "task-when" && tkey) {
      var bgw = document.createElement("div"); bgw.className = "modal-bg";
      var curW = (S.cab.state[tkey] || {}).when_day || 0;
      bgw.innerHTML = '<div class="modal"><b>Когда займёшься?</b><p class="xs mut" style="margin:4px 0 10px">Задача с назначенным днём выполняется в разы чаще — это самый проверенный приём планирования.</p>' +
        '<div class="chips">' + Path.WD_FULL.map(function (w, i) { return '<button class="chip ' + (curW === i + 1 ? "on" : "") + '" data-w="' + (i + 1) + '">' + w + "</button>"; }).join("") + "</div>" +
        '<button class="btn btn-ghost btn-sm btn-block" style="margin-top:12px" data-x="1">' + (curW ? "Убрать день" : "Отмена") + "</button></div>";
      document.getElementById("modal-root").appendChild(bgw);
      bgw.addEventListener("click", function (ev) {
        var b = ev.target.closest("[data-w]");
        if (b) { taskSave(tkey, { when_day: +b.getAttribute("data-w") }); if (window.track) track("cab_task_when", { day: +b.getAttribute("data-w") }); bgw.remove(); renderToday(); return; }
        if (ev.target.closest("[data-x]")) { if (curW) taskSave(tkey, { when_day: null }); bgw.remove(); renderToday(); return; }
        if (ev.target === bgw) bgw.remove();
      });
      return;
    }
    if (act === "task-go") { goAct(v || ""); return; }
    if (act === "quiet-week") {
      e.preventDefault();
      var wkq = Path.weekInfo(todayDate()), cabp = Object.assign({}, cabPrefs()), q = (cabp.quiet || []).slice();
      var idx = q.indexOf(wkq.key);
      if (idx >= 0) q.splice(idx, 1); else q.push(wkq.key);
      cabp.quiet = q.slice(-20);
      saveCabPrefs(cabp, function () { renderToday(); toast(idx >= 0 ? "Пауза снята" : "Неделя на паузе: серия не прервётся", "ok"); });
      if (window.track) track("cab_quiet_week", { on: idx < 0 });
      return;
    }
    if (act === "week-goal") {
      e.preventDefault();
      var bgg = document.createElement("div"); bgg.className = "modal-bg";
      bgg.innerHTML = '<div class="modal"><b>Цель недели</b><p class="xs mut" style="margin:4px 0 10px">Сколько задач закрывать в неделю. Три — реалистично в учебный год, пять — на каникулах.</p>' +
        '<div class="chips">' + [2, 3, 4, 5].map(function (n) { return '<button class="chip ' + (weekGoal() === n ? "on" : "") + '" data-g="' + n + '">' + n + "</button>"; }).join("") + "</div>" +
        '<button class="btn btn-ghost btn-sm btn-block" style="margin-top:12px" data-x="1">Отмена</button></div>';
      document.getElementById("modal-root").appendChild(bgg);
      bgg.addEventListener("click", function (ev) {
        var b = ev.target.closest("[data-g]");
        if (b) { var cp = Object.assign({}, cabPrefs(), { goal: +b.getAttribute("data-g") }); saveCabPrefs(cp, function () { renderToday(); if (S.tab === "profile") renderProfile(); }); bgg.remove(); return; }
        if (ev.target.closest("[data-x]") || ev.target === bgg) bgg.remove();
      });
      return;
    }
    if (act === "cal-prev" || act === "cal-next") {
      var m0 = S.calMonth || (function () { var t = todayDate(); return new Date(t.getFullYear(), t.getMonth(), 1); })();
      S.calMonth = new Date(m0.getFullYear(), m0.getMonth() + (act === "cal-next" ? 1 : -1), 1); S.calSel = null;
      if (window.track) track("cab_calendar_open", { m: S.calMonth.getMonth() + 1 });
      if (S.tab === "today") { renderToday(); renderWidget(); } return;
    }
    if (act === "cal-day") { S.calSel = S.calSel === v ? null : v; if (S.tab === "today") { renderToday(); renderWidget(); } return; }
    if (act === "disc-col") { uniFilter.mode = "discover"; uniFilter.col = v; if (window.track) track("cab_discover_open", { col: v }); if (S.tab !== "unis") setTab("unis"); else renderUnis(); window.scrollTo(0, 0); return; }
    if (act === "disc-back") { uniFilter.col = null; renderUnis(); return; }
    if (act === "unimode") { uniFilter.mode = v; uniFilter.col = null; renderUnis(); return; }
    if (act === "unidl") { e.preventDefault(); uniFilter.deadline = uniFilter.deadline === v ? null : v; renderUnis(); return; }
    if (act === "unisort") { e.preventDefault(); uniFilter.sort = v; renderUnis(); return; }
    if (act === "tab-apps") { setTab("apps"); return; }
    if (act === "tab-today") { setTab("today"); return; }
    if (act === "rec-request") { openRecRequest(); return; }
    if (act === "rec-lang") { S.recLang = v; drawSub(); return; }
    if (act === "rec-copy") {
      var ta3 = document.getElementById("rec-text"); var txt3 = ta3 ? ta3.value : "";
      var done3 = false;
      try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt3); done3 = true; } } catch (err) {}
      if (!done3 && ta3) { ta3.select(); try { document.execCommand("copy"); done3 = true; } catch (err) {} }
      toast(done3 ? "Скопировано — вставь в письмо или мессенджер" : "Выдели текст и скопируй вручную");
      return;
    }
    if (act === "rec-wa") { var ta4 = document.getElementById("rec-text"); window.open("https://wa.me/?text=" + encodeURIComponent(ta4 ? ta4.value : recLetterText(S.recLang)), "_blank", "noopener"); return; }
    if (act === "rec-mark") { recMarkRequested(function () { drawSub(); }); return; }
    if (act === "content-open") { if (window.track) track("cab_content_open", { id: id }); return; }
    if (act === "unicc") { uniFilter.cc = v || null; renderUnis(); return; }
    if (act === "unibudget") { uniFilter.budget = uniFilter.budget === 0 ? null : 0; renderUnis(); return; }
    if (act === "uniielts") { uniFilter.noIelts = !uniFilter.noIelts; renderUnis(); return; }
    if (act === "unireset") { uniFilter = { q: "", cc: null, budget: null, noIelts: false, deadline: null, sort: "match", mode: "all", col: null }; uniShowWeak = false; renderUnis(); return; }
    if (act === "uniweak") { uniShowWeak = !uniShowWeak; renderUnis(); return; }
    if (act === "prog") { openProg(id); return; }
    if (act === "add") { addProgram(id, function () { if (S.stack.length) drawSub(); else renderUnis(); }); return; }
    if (act === "custom-add") {
      toast("Скоро: добавление своей программы по ссылке. Пока напиши нам — добавим в базу за день");
      return;
    }
    if (act === "edit") { openEdit(el.getAttribute("data-key")); return; }
    if (act === "tg") { openTg(); return; }
    if (act === "tg-pref") { toggleTgPref(v); return; }
    if (act === "reports") { openReports(); return; }
    if (act === "privacy") { openPrivacy(); return; }
    if (act === "help") { openHelp(); return; }
    if (act === "export") {
      var blob = new Blob([JSON.stringify({ profile: S.profile, answers: S.ans, applications: S.apps, documents: S.docs.map(function (d) { return Object.assign({}, d, { file_path: d.file_path ? "(файл в хранилище)" : null }); }) }, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob); var a2 = document.createElement("a"); a2.href = url; a2.download = "scholary-my-data.json"; a2.click();
      toast("Файл с твоими данными скачан"); return;
    }
    if (act === "delacc") {
      toast("Напиши нам в WhatsApp — удалим аккаунт и файлы в течение 24 часов");
      window.open("https://wa.me/" + (C.WHATSAPP_NUMBER || "") + "?text=" + encodeURIComponent("Прошу удалить мой аккаунт Scholary и все файлы"), "_blank", "noopener");
      return;
    }
    if (act === "logout") { forgetLocal(); sb.auth.signOut(); return; }
  });

  document.addEventListener("change", function (e) {
    var el = e.target.closest("[data-act='field']"); if (!el) return;
    var d = S.docs.filter(function (x) { return x.id === +el.getAttribute("data-id"); })[0]; if (!d) return;
    var f = Object.assign({}, d.fields || {});
    f[el.getAttribute("data-key")] = el.value.trim();
    var patch = { fields: f, checked_at: new Date().toISOString() };
    if (d.status === "none" && el.value.trim()) patch.status = "progress";   // данные внесены — документ уже в работе
    if (d.doc_type === "ielts" && f.issued_on) {
      var dd = new Date(f.issued_on);
      if (!isNaN(dd)) patch.expires_on = new Date(dd.getTime() + 730 * 864e5).toISOString().slice(0, 10);
    }
    if (d.doc_type === "passport" && f.expires_on) patch.expires_on = f.expires_on;
    saveDoc(d, patch, function () { recompute(); drawSub(); toast("Сохранили · проверка обновлена"); });
  });
  document.addEventListener("input", function (e) {
    if (e.target.id === "uni-q") { uniFilter.q = e.target.value; clearTimeout(window.__uq); window.__uq = setTimeout(renderUnis, 250); }
  });

  function wireSub() { /* обработка через делегирование выше */ }

  /* ================= вход и загрузка ================= */
  function authView(which) {
    $("f-login").hidden = which !== "login";
    $("f-signup").hidden = which !== "signup";
    $("f-forgot").hidden = which !== "forgot";
    $("auth-title").textContent = which === "signup" ? "Создай аккаунт" : which === "forgot" ? "Восстановление" : "Твой путь к Точке Б";
    $("auth-sub").textContent = which === "signup" ? "1 минута — и весь план поступления под рукой" : which === "forgot" ? "Пришлём ссылку для нового пароля" : "Подачи, документы и дедлайны — в одном месте";
  }
  $("lnk-signup").onclick = function (e) { e.preventDefault(); authView("signup"); };
  $("lnk-login").onclick = function (e) { e.preventDefault(); authView("login"); };
  $("lnk-login2").onclick = function (e) { e.preventDefault(); authView("login"); };
  $("lnk-forgot").onclick = function (e) { e.preventDefault(); authView("forgot"); };
  function authErr(id, err) {
    var el = $(id), m = (err && err.message) || "Что-то пошло не так";
    if (/Invalid login credentials/i.test(m)) m = "Неверная почта или пароль";
    if (/already registered/i.test(m)) m = "Такой аккаунт уже есть — попробуй войти";
    if (/rate limit/i.test(m)) m = "Слишком много попыток — подожди минуту";
    el.textContent = m; el.hidden = false;
  }
  $("f-login").onsubmit = function (e) {
    e.preventDefault(); $("li-err").hidden = true;
    sb.auth.signInWithPassword({ email: $("li-email").value.trim(), password: $("li-pass").value })
      .then(function (r) { if (r.error) authErr("li-err", r.error); });
  };
  $("f-signup").onsubmit = function (e) {
    e.preventDefault(); $("su-err").hidden = true;
    sb.auth.signUp({ email: $("su-email").value.trim(), password: $("su-pass").value, options: { data: { name: $("su-name").value.trim() } } })
      .then(function (r) {
        if (r.error) { authErr("su-err", r.error); return; }
        if (window.track) track("cab_signup", {});
        if (window.scholaryTtIdentify) window.scholaryTtIdentify({ email: $("su-email").value.trim() });
        if (!r.data || !r.data.session) {
          /* подтверждение почты включено (или адрес уже занят — Supabase отвечает одинаково) */
          var el = $("su-err"); el.textContent = "Письмо с подтверждением отправлено на " + $("su-email").value.trim() + " — открой ссылку из него, и кабинет откроется. Если письма нет 2 минуты — проверь «Спам» или попробуй «Забыл пароль».";
          el.style.color = "#187E54"; el.hidden = false;
        }
      });
  };
  $("f-forgot").onsubmit = function (e) {
    e.preventDefault(); $("fg-err").hidden = true;
    sb.auth.resetPasswordForEmail($("fg-email").value.trim(), { redirectTo: location.origin + "/cabinet/" })
      .then(function (r) { if (r.error) { authErr("fg-err", r.error); return; } $("fg-ok").hidden = false; });
  };
  $("f-recovery").onsubmit = function (e) {
    e.preventDefault(); $("rc-err").hidden = true;
    sb.auth.updateUser({ password: $("rc-pass").value }).then(function (r) {
      if (r.error) { authErr("rc-err", r.error); return; } toast("Пароль сохранён"); enter();
    });
  };
  $("btn-google").onclick = function () {
    sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + "/cabinet/" } })
      .then(function (r) { if (r.error) toast("Google-вход недоступен — войди по почте", "bad"); });
  };
  $("btn-empty-out").onclick = function () { forgetLocal(); sb.auth.signOut(); };
  /* На общем компьютере следующий пользователь не должен получить чужой расчёт
     и токен отчёта из localStorage. */
  function forgetLocal() {
    try { ["scholary_lead_id", "scholary_report_token", "scholary_quiz_v1"].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
  }
  $("btn-empty-setup").onclick = function () { startSetup(); };
  $("setup-next").onclick = function () { setupNext(); };
  $("setup-back").onclick = function () { if (SU.i > 0) { SU.i--; drawSetup(); } };
  $("setup-body").addEventListener("click", function (e) {
    var b = e.target.closest("[data-v]"); if (b) setupPick(b.getAttribute("data-v"));
  });
  $("topbar-ava").onclick = function () { setTab("profile"); };
  Array.prototype.forEach.call(document.querySelectorAll("#tabbar button"), function (b) {
    b.onclick = function () { setTab(b.getAttribute("data-tab")); };
  });

  function localLead() {
    try {
      var q = new URLSearchParams(location.search);
      return { lead: q.get("lead") || localStorage.getItem("scholary_lead_id"), token: q.get("t") || localStorage.getItem("scholary_report_token") };
    } catch (e) { return { lead: null, token: null }; }
  }
  function offerClaim(ll) {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem("scholary_quiz_v1") || "null"); } catch (e) {}
    var a = (saved && saved.answers) || {};
    var lvl = a.level;
    /* Светлая карточка с тем, что реально нашли: уровень, оценки, язык,
       направления, вероятность (если пейволл уже считал). Раньше это была
       маленькая тёмная плашка без содержания — непонятно, что забираем. */
    var rows = [];
    var gpa = a.gpa_band ? L.gpa_band[a.gpa_band] : (a.gpa_uni ? L.gpa4[a.gpa_uni] : (a.gpa_phd ? L.gpa4[a.gpa_phd] : null));
    if (gpa) rows.push(["Оценки", gpa]);
    if (a.lang_status) rows.push(["Английский", (a.ielts_band && a.lang_status !== "none" ? "IELTS " + (L.ielts[a.ielts_band] || a.ielts_band) + " · " : "") + (L.lang_status[a.lang_status] || "")]);
    var fl = typeof a.field === "string" ? a.field.split(",") : (a.field || []);
    if (fl.length) rows.push(["Направления", fl.map(function (f) { return L.field[f] || f; }).filter(Boolean).join(", ")]);
    if (a.budget) rows.push(["Бюджет", L.budget[a.budget] || a.budget]);
    var pct = null;
    try {
      var snap = a.result || (saved && saved.result);
      if (snap && typeof snap.pAtLeastOne === "number") pct = Math.round(snap.pAtLeastOne * 100);
    } catch (e) {}
    var name = a.name ? esc(String(a.name).split(" ")[0]) : "";
    $("claim-card").innerHTML =
      '<div class="xs" style="letter-spacing:.14em;color:var(--accent-dark);font-weight:800">ТВОЙ РАСЧЁТ НА ЭТОМ УСТРОЙСТВЕ</div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:8px">' +
        '<div><div style="font-size:18px;font-weight:800;letter-spacing:-0.01em">' + (name ? name + " · " : "") + (lvl ? (L.level[lvl] || "") : "ответы квиза") + "</div>" +
        '<div class="xs mut" style="margin-top:2px">' + (rows.length ? rows.length + " " + plural(rows.length, "ответ", "ответа", "ответов") + " из квиза" : "ответы квиза и результат") + "</div></div>" +
        (pct !== null ? '<div style="text-align:right;flex-shrink:0"><div style="font-size:30px;font-weight:800;line-height:1;color:var(--accent)">' + pct + '%</div><div class="xs mut">хотя бы один оффер</div></div>' : "") +
      "</div>" +
      (rows.length ? '<div style="margin-top:12px;display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:13.5px">' +
        rows.map(function (r) { return '<span class="mut">' + r[0] + "</span><b style=\"font-weight:700\">" + esc(r[1]) + "</b>"; }).join("") + "</div>" : "") +
      '<div class="xs mut" style="margin-top:12px;padding-top:10px;border-top:1px solid #E3DFFF">Из этого соберём подачи, календарь дедлайнов и план документов. Ничего заново вводить не нужно.</div>';
    show("v-claim");
    $("btn-claim").onclick = function () {
      $("btn-claim").disabled = true; $("claim-err").hidden = true;
      sb.rpc("claim_lead", { p_lead_id: ll.lead, p_token: ll.token || null }).then(function (r) {
        $("btn-claim").disabled = false;
        var d = r.data;
        if (r.error || !d || d.ok === false) {
          $("claim-err").textContent = (d && d.reason) === "token_required"
            ? "Этот расчёт привязан к оплаченному отчёту. Открой кабинет по ссылке из отчёта — и он подтянется."
            : "Не получилось забрать расчёт. Можно пройти квиз заново — 2 минуты.";
          $("claim-err").hidden = false; return;
        }
        if (window.track) track("cab_claim", {}); enter();
      });
    };
    $("btn-claim-skip").onclick = function () { startSetup(); };
  }

  /* ================= анкета при первом входе =================
     Раньше человек без расчёта видел только «иди в квиз», а квиз
     заканчивался пейволлом — круг замыкался и в кабинет было не попасть.
     Шесть вопросов здесь же открывают кабинет бесплатно. */
  var SU = { i: 0, ans: {} };
  function setupSteps() {
    var lvl = SU.ans.level || "bachelor";
    return [
      { key: "level", q: "Куда поступаешь?", why: "От уровня зависят и программы, и веса модели", opts: OPT.level },
      { key: "year", q: "В каком году?", why: "Считаем дедлайны от твоего сезона подачи", opts: OPT.year },
      lvl === "bachelor"
        ? { key: "gpa_band", q: "Средний балл аттестата?", why: "Главный вход почти во все программы", opts: OPT.gpa_band }
        : { key: lvl === "phd" ? "gpa_phd" : "gpa_uni", q: "GPA диплома по шкале 4.0?", why: "Главный вход почти во все программы", opts: OPT.gpa4 },
      { key: "ielts_band", q: "Как с английским?", why: "Языковой порог отсекает больше заявок, чем оценки", opts: OPT.ielts },
      { key: "field", q: "Какие направления тянут?", why: "Можно выбрать до трёх — портфель соберём по всем", opts: OPT.field, multi: true, max: 3 },
      { key: "budget", q: "Сколько семья готова вкладывать в год?", why: "Считаем только реальные варианты: есть программы за 0 ₸", opts: OPT.budget },
      { key: "achievements", q: "Что уже есть в копилке?", why: "Достижения добавляют баллов стипендиям. Можно ничего не выбирать", opts: OPT.ach, multi: true, optional: true }
    ];
  }
  function startSetup() {
    SU = { i: 0, ans: normAnswers(JSON.parse(JSON.stringify((S.profile && S.profile.answers) || {}))) };
    if (window.track) track("cab_setup_start", {});
    show("v-setup"); drawSetup();
  }
  function drawSetup() {
    var steps = setupSteps(), st = steps[SU.i];
    if (!st) return finishSetup();
    var val = SU.ans[st.key];
    $("setup-bar-i").style.width = Math.round((SU.i / steps.length) * 100) + "%";
    $("setup-count").textContent = (SU.i + 1) + " из " + steps.length;
    $("setup-body").innerHTML =
      '<div class="setup-q">' + esc(st.q) + "</div>" +
      '<div class="setup-why">' + esc(st.why) + "</div>" +
      '<div class="setup-opts">' + st.opts.map(function (o) {
        var on = st.multi ? (val || []).indexOf(o[0]) >= 0 : val === o[0];
        return '<button type="button" class="setup-opt' + (on ? " on" : "") + '" data-v="' + esc(o[0]) + '"><span>' + esc(o[1]) + '</span><span class="tick"></span></button>';
      }).join("") + "</div>";
    $("setup-back").hidden = SU.i === 0;
    /* Одиночный выбор уходит дальше сам — кнопка «Далее» там только
       путала бы. Она нужна на шагах, где можно выбрать несколько. */
    $("setup-next").hidden = !st.multi;
    $("setup-next").style.flex = st.multi ? "1" : "";
    $("setup-next").textContent = SU.i === steps.length - 1 ? "Открыть кабинет" : "Далее";
    syncSetupNext();
  }
  function syncSetupNext() {
    var st = setupSteps()[SU.i]; if (!st) return;
    var val = SU.ans[st.key];
    var ok = st.optional || (st.multi ? (val || []).length > 0 : !!val);
    $("setup-next").disabled = !ok;
    $("setup-next").style.opacity = ok ? "1" : ".5";
  }
  function setupPick(v) {
    var st = setupSteps()[SU.i]; if (!st) return;
    if (st.multi) {
      var cur = (SU.ans[st.key] || []).slice(), i = cur.indexOf(v);
      if (i >= 0) cur.splice(i, 1);
      else { if (st.max && cur.length >= st.max) { toast("Можно выбрать не больше " + st.max); return; } cur.push(v); }
      SU.ans[st.key] = cur;
    } else {
      SU.ans[st.key] = v;
      if (st.key === "ielts_band") SU.ans.lang_status = (v === "unknown" || v === "<5.5") ? "none" : "have";
    }
    drawSetup();
    if (!st.multi) setTimeout(setupNext, 180);   // одиночный выбор — сразу дальше
  }
  function setupNext() {
    var steps = setupSteps(), st = steps[SU.i];
    var val = SU.ans[st.key];
    if (!st.optional && (st.multi ? !(val || []).length : !val)) return;
    if (SU.i >= steps.length - 1) return finishSetup();
    SU.i++; drawSetup();
  }
  function finishSetup() {
    $("setup-next").disabled = true;
    $("setup-next").textContent = "Собираем кабинет…";
    var name = (S.profile && S.profile.name) ||
      (S.session && S.session.user.user_metadata && S.session.user.user_metadata.name) || "";
    var patch = { answers: SU.ans, updated_at: new Date().toISOString() };
    if (name) patch.name = name;
    sb.from("profiles").update(patch).eq("user_id", S.session.user.id).then(function (r) {
      if (r.error) {
        $("setup-next").disabled = false; $("setup-next").textContent = "Открыть кабинет";
        toast("Не удалось сохранить. Попробуй ещё раз", "bad"); return;
      }
      if (window.track) track("cab_setup_done", { level: SU.ans.level });
      S.profile = Object.assign({}, S.profile || {}, patch);
      entering = false; enter();
    });
  }

  var entering = false;
  function enter() {
    /* Google-вход разрешён только с возвратом на /cabinet/. Страницы школ
       (/schools/join/, /schools/cabinet/) кладут сюда адрес, куда вернуть
       человека с уже открытой сессией — иначе ученик терял ссылку школы. */
    try {
      var nxt = localStorage.getItem("scholary_next");
      if (nxt && /^\/schools\//.test(nxt)) { localStorage.removeItem("scholary_next"); location.replace(nxt); return; }
    } catch (e) {}
    if (entering) return; entering = true; show("loading");
    sb.from("profiles").select("*").maybeSingle().then(function (r) {
      S.profile = r.data || null;
      var metaName = S.session && S.session.user.user_metadata && S.session.user.user_metadata.name;
      if (S.profile && !S.profile.name && metaName) {
        S.profile.name = metaName;
        sb.from("profiles").update({ name: metaName }).eq("user_id", S.session.user.id).then(function () {});
      }
      var haveAnswers = S.profile && S.profile.answers && S.profile.answers.level;
      /* Пришёл по ссылке из отчёта (?t=…) в уже заведённый кабинет — привязываем
         отчёт молча, без экрана «забрать расчёт»: раньше «Мои отчёты» оставались пустыми. */
      var llq = localLead();
      if (haveAnswers && llq.lead && llq.token && !(S.profile.lead_ids || []).some(function (x) { return x === llq.lead; })) {
        sb.rpc("claim_lead", { p_lead_id: llq.lead, p_token: llq.token }).then(function (r) {
          if (r.data && r.data.ok) { try { localStorage.removeItem("scholary_report_token"); } catch (e) {} }
        });
      }
      if (!haveAnswers) {
        var ll = localLead(); entering = false;
        if (ll.lead) offerClaim(ll); else show("v-empty");
        if (window.track) track("cab_no_profile", { had_lead: !!ll.lead });
        return;
      }
      S.ans = normAnswers(JSON.parse(JSON.stringify(S.profile.answers)));
      Promise.all([
        sb.from("portfolio_items").select("*"),
        sb.from("user_documents").select("*"),
        sb.from("programs_public").select("*"),
        sb.rpc("my_reports"),
        sb.from("probability_history").select("*").order("ts", { ascending: true }).limit(30),
        sb.from("tg_links").select("*").maybeSingle(),
        /* web-74: задачи недели, активность, вехи, материалы — одним запросом */
        sb.rpc("cab_state").then(function (r) { return r; }, function () { return { data: null }; })
      ]).then(function (rs) {
        S.apps = rs[0].data || [];
        S.docs = rs[1].data || [];
        S.programs = (rs[2].data || []).map(function (p) { return p; });
        S.reports = rs[3].data || [];
        S.hist = rs[4].data || [];
        S.tg = rs[5] && rs[5].data ? rs[5].data : null;
        var cs = rs[6] && rs[6].data && typeof rs[6].data === "object" ? rs[6].data : null;
        S.cab = { state: {}, activity: [], ach: {}, content: [] };
        if (cs) {
          (cs.tasks || []).forEach(function (t) { S.cab.state[t.task_key] = { status: t.status, when_day: t.when_day, week_start: t.week_start, title: t.title || undefined }; });
          S.cab.activity = (cs.activity || []).map(function (a) { return { day: String(a.day), progress: !!a.progress }; });
          (cs.ach || []).forEach(function (a) { S.cab.ach[a.key] = a.earned_at; });
          S.cab.content = cs.content || [];
        } else {
          /* базы ещё нет (или сбой) — берём состояние задач с этого устройства */
          try { S.cab.state = JSON.parse(localStorage.getItem("scholary_cab_state") || "{}") || {}; } catch (e) {}
        }
        recompute();
        var proceed = function () {
          entering = false;
          $("topbar-ava").textContent = ((S.profile && S.profile.name) || "S")[0].toUpperCase();
          /* deep-link из Telegram/письма: ?tab=…&d=<подборка>&task=<ключ> */
          var dl = Path.parseDeepLink(location.search);
          if (dl.d) { uniFilter.mode = "discover"; uniFilter.col = dl.d === "week" ? null : dl.d; }
          if (dl.tab) S.tab = dl.tab;
          show("v-app"); setTab(S.tab); pushHistory("вход");
          if (dl.task) { var tEl = document.querySelector('.task[data-key="' + dl.task + '"]'); if (tEl) { tEl.classList.add("hl"); tEl.scrollIntoView({ block: "center" }); } }
          if (dl.from && window.track) track("cab_deeplink", { from: dl.from, tab: dl.tab || "today" });
          if (dl.tab || dl.d || dl.task || dl.from) { try { history.replaceState(null, "", location.pathname); } catch (e) {} }
          loadSchool();
          touch(false); awardCheck();
          if (window.track) track("cab_open", { v: 3 });
        };
        if (!S.apps.length && S.evalR && S.evalR.portfolio.length) {
          var uid = S.session.user.id;
          var rows = S.evalR.portfolio.map(function (p) { return { user_id: uid, program_id: p.id, status: "study" }; });
          sb.from("portfolio_items").insert(rows).select().then(function (ri) { S.apps = ri.data || []; recompute(); proceed(); });
        } else proceed();
      });
    });
  }

  var recoveryMode = /type=recovery/.test(location.hash);
  sb.auth.onAuthStateChange(function (event, session) {
    /* Supabase шлёт SIGNED_IN при каждом возврате во вкладку и TOKEN_REFRESHED
       раз в час. Раньше каждое такое событие перерисовывало кабинет с нуля —
       и человек терял недописанное мотивационное. Тот же пользователь → только
       обновляем сессию. */
    if (session && S.session && S.session.user && S.session.user.id === session.user.id && S.profile && event !== "PASSWORD_RECOVERY") { S.session = session; return; }
    S.session = session;
    if (event === "PASSWORD_RECOVERY") { show("v-recovery"); return; }
    if (session) { if (recoveryMode) { recoveryMode = false; show("v-recovery"); return; } enter(); }
    else { entering = false; show("v-auth"); authView("login"); }
  });
  sb.auth.getSession().then(function (r) { if (!r.data.session) { show("v-auth"); authView("login"); } });
}

/* Библиотека Supabase грузится с CDN; если основной адрес заблокирован,
   cabinet.html подставляет запасной — но он async и может приехать ПОЗЖЕ
   этого файла. Раньше в этом случае страница падала с TypeError и человек
   видел вечный спиннер. Ждём библиотеку до 8 секунд, потом честно говорим. */
(function boot() {
  if (window.supabase && window.supabase.createClient) { __scholaryMain(); return; }
  boot.t = boot.t || Date.now();
  if (Date.now() - boot.t < 8000) { setTimeout(boot, 100); return; }
  var el = document.getElementById("loading") || document.body;
  el.innerHTML = '<div style="max-width:520px;margin:14vh auto;padding:28px;text-align:center;font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#1D1D1F">' +
    '<h1 style="font-size:22px;margin:0 0 10px">Не получилось загрузить страницу</h1>' +
    '<p style="color:#6E6E73">Часть кода заблокирована (блокировщик рекламы, VPN или сеть оператора). Отключи блокировщик и обнови страницу или зайди из другого браузера.</p>' +
    '<p><a href="https://wa.me/' + ((window.SCHOLARY_CONFIG && window.SCHOLARY_CONFIG.WHATSAPP_NUMBER) || "77024666852") + '" style="display:inline-flex;min-height:44px;align-items:center;padding:0 22px;background:#0B7A3E;color:#fff;border-radius:999px;text-decoration:none;font-weight:700">Написать нам в WhatsApp</a></p></div>';
})();
