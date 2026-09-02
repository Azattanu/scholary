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
(function () {
  "use strict";
  var C = window.SCHOLARY_CONFIG || {};
  var sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
  var E = window.ScholaryEngine;
  var D = window.ScholaryDocs;

  var S = { session: null, profile: null, ans: null, evalR: null, apps: [], docs: [], programs: [],
            reports: null, hist: [], tab: "today", stack: [] };

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
    cflag: { hu: "🇭🇺", de: "🇩🇪", it: "🇮🇹", cz: "🇨🇿", tr: "🇹🇷", cn: "🇨🇳", kr: "🇰🇷", jp: "🇯🇵", pl: "🇵🇱", us: "🇺🇸", fr: "🇫🇷", nl: "🇳🇱", ae: "🇦🇪", eu: "🇪🇺", se: "🇸🇪", sa: "🇸🇦", hk: "🇭🇰", sg: "🇸🇬", uk: "🇬🇧", gb: "🇬🇧", ca: "🇨🇦", kz: "🇰🇿", ch: "🇨🇭", at: "🇦🇹", be: "🇧🇪", fi: "🇫🇮", no: "🇳🇴", dk: "🇩🇰", ro: "🇷🇴", sk: "🇸🇰", si: "🇸🇮", hr: "🇭🇷", ee: "🇪🇪", lv: "🇱🇻", lt: "🇱🇹", pt: "🇵🇹", es: "🇪🇸", gr: "🇬🇷", ie: "🇮🇪", qa: "🇶🇦", my: "🇲🇾", in: "🇮🇳" }
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
    var date = parseDeadline(prog.deadline);
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
                   checked_at: new Date().toISOString() }, function () { drawSub(); });
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
    var vs = appViews(), o = overall(), ns = nextStep();
    var burning = vs.filter(function (v) { return !v.a.submitted_at && v.days != null; }).slice(0, 3);
    var docsLeft = docTypesForUser().filter(function (t) { var d = docsOfType(t)[0]; return !d || d.status !== "ready"; }).length;
    el.innerHTML =
      '<div class="card w-card"><div class="h-row"><b class="sm">Мой шанс</b><span class="pill pill-mut">→</span></div>' +
        duoHTML(o, ["хотя бы один оффер", "хотя бы одна стипендия"]) +
        '<button class="btn btn-ghost btn-sm btn-block" style="margin-top:10px" data-act="chance">Динамика и «что если»</button></div>' +
      (ns ? '<div class="card w-card" style="background:var(--accent-soft);border-color:var(--accent-border)">' +
        '<div class="xs b" style="letter-spacing:.1em;color:var(--accent-dark)">СЛЕДУЮЩИЙ ШАГ</div>' +
        '<div class="sm b" style="margin:6px 0 8px;line-height:1.35">' + esc(ns.title) + "</div>" +
        '<button class="btn btn-primary btn-sm btn-block" data-act="step-go" data-app="' + ns.v.a.id + '" data-doc="' + (ns.t || "") + '">' + (ns.check ? "Проверить пакет" : "Заняться") + "</button></div>" : "") +
      '<div class="card w-card"><b class="sm">Ближайшие дедлайны</b>' +
        (burning.length ? burning.map(function (v) {
          return '<div class="lst tappable" data-act="app" data-app="' + v.a.id + '" style="padding:9px 0"><div style="flex:1;min-width:0"><b class="xs">' + esc(v.title) + '</b>' +
            '<div class="xs mut">' + fmtDL(v.date) + " · " + v.rd.pct + "%</div></div>" +
            '<span class="pill ' + dlClass(v.days) + '">' + v.days + " дн</span></div>";
        }).join("") : '<p class="xs mut" style="margin:6px 0 0">Дедлайнов пока нет — добавь программы.</p>') + "</div>" +
      '<div class="card w-card"><b class="sm">Документы</b><div class="xs mut" style="margin:4px 0 8px">' +
        (docsLeft ? "осталось собрать " + docsLeft : "всё собрано") + "</div>" +
        '<button class="btn btn-ghost btn-sm btn-block" data-act="tab-docs">Открыть документы</button></div>' +
      '<div class="card w-card"><b class="sm">Нужна помощь?</b><div class="xs mut" style="margin:4px 0 8px">Ответим в WhatsApp в рабочее время</div>' +
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
  function renderToday() {
    var name = firstName(S.profile && S.profile.name) || "друг";
    var vs = appViews(), o = overall(), ns = nextStep();
    var pb = S.evalR && S.evalR.verdict ? "" : "";
    var target = (S.ans && S.ans.year) === "2028" ? "сентябрь 2028" : "сентябрь 2027";
    var left = Math.max(0, Math.round((new Date((S.ans && S.ans.year) === "2028" ? "2028-09-01" : "2027-09-01") - new Date()) / 864e5));
    var burning = vs.filter(function (v) { return !v.a.submitted_at && v.days != null; }).slice(0, 3);
    var last = S.hist.length > 1 ? S.hist[S.hist.length - 2] : null;
    var delta = last && last.p_adm != null ? Math.round((o.adm - last.p_adm) * 100) : null;

    $("tab-today").innerHTML =
      '<div class="h2" style="margin-top:10px">Салем, ' + esc(name) + "!</div>" +
      '<div class="pointb"><div class="lbl">ТОЧКА Б · ' + target.toUpperCase() + '</div><div class="big">Осталось ' + left + " " + plural(left, "день", "дня", "дней") + "</div>" +
        '<div class="pbar"><i style="width:' + Math.max(3, Math.min(100, Math.round((1 - left / 400) * 100))) + '%"></i></div></div>' +
      (ns ? '<div class="nextstep"><div class="tag">СЛЕДУЮЩИЙ ШАГ</div><h3>' + esc(ns.title) + "</h3>" +
        '<p class="sm mut" style="margin:2px 0 10px">' + esc(ns.why) + "</p>" +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button class="btn btn-primary btn-sm" data-act="step-go" data-app="' + ns.v.a.id + '" data-doc="' + (ns.t || "") + '">' + (ns.check ? "Проверить пакет" : "Заняться сейчас") + "</button>" +
          (ns.t ? '<button class="btn btn-ghost btn-sm" data-act="step-done" data-app="' + ns.v.a.id + '" data-doc="' + ns.t + '">Уже готово</button>' : "") +
        "</div></div>"
        : '<div class="card" style="margin-bottom:14px"><b>Всё под контролем</b><p class="sm mut" style="margin:4px 0 0">Активных подач нет. Добавь программу — и здесь появится следующий шаг.</p></div>') +
      '<div class="card tappable" data-act="chance" style="margin-bottom:14px">' +
        '<div class="h-row"><b class="sm">Мой шанс</b>' + (delta != null && delta !== 0 ? '<span class="pill ' + (delta > 0 ? "pill-ok" : "pill-warn") + '">' + (delta > 0 ? "▲ +" : "▼ ") + delta + " за неделю</span>" : '<span class="pill pill-mut">динамика →</span>') + "</div>" +
        duoHTML(o, ["хотя бы один оффер", "хотя бы одна стипендия"]) + '<div class="xs mut">по ' + vs.length + " " + plural(vs.length, "подаче", "подачам", "подачам") + " · тап — динамика и «что если»</div></div>" +
      (burning.length ? '<div class="sub-h">Горит первым</div>' + burning.map(function (v) {
        return '<div class="dl tappable" data-act="app" data-app="' + v.a.id + '"><span class="dot" style="background:' + (v.days < 30 ? "#C0392B" : v.days < 75 ? "#A05F00" : "#0B7A3E") + '"></span>' +
          '<div style="flex:1"><b>' + esc(v.title) + '</b><span class="xs mut">' + fmtDL(v.date) + " · готовность " + v.rd.pct + "%</span></div>" +
          '<span class="pill ' + dlClass(v.days) + '">' + (v.days != null ? v.days + " дн" : "—") + "</span></div>";
      }).join("") : "") +
      aiTipHTML(vs) +
      '<div class="card" style="margin-top:14px;background:var(--bg);border-style:dashed">' +
        '<div class="h-row"><div style="padding-right:10px"><b class="sm">Нужен живой человек?</b><div class="xs mut">Консультант проверит пакет и доведёт до подачи — 35 000 ₸</div></div>' +
        '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/' + (C.WHATSAPP_NUMBER || "") + '?text=' + encodeURIComponent("Здравствуйте! Хочу пакет «Документы и подача» за 35 000 ₸") + '">Написать</a></div></div>';
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

  /* ================= 4 · ДОКУМЕНТЫ ================= */
  function docTypesForUser() {
    var set = {}, out = [];
    appViews().forEach(function (v) { v.rd.required.forEach(function (r) { if (!set[r.t]) { set[r.t] = 1; out.push(r.t); } }); });
    if (!out.length) out = ["diploma", "passport", "ielts", "motivation"];
    return out;
  }
  function renderDocs() {
    var types = docTypesForUser();
    var ready = 0;
    var rows = types.map(function (t) {
      var T = D.TYPES[t] || { title: t, ic: "📄" };
      var list = docsOfType(t);
      var d = list[0];
      var st = d ? d.status : "none";
      if (st === "ready") ready++;
      var warn = d && d.verdicts && d.verdicts.some ? d.verdicts.some(function (v) { return v.level !== "ok"; }) : false;
      var uses = appViews().filter(function (v) { return v.rd.required.some(function (r) { return r.t === t; }); }).length;
      return '<div class="doc tappable" data-act="' + (d ? "doc" : "doc-new") + '" data-id="' + (d ? d.id : "") + '" data-doc="' + t + '">' +
        '<div class="ic" style="background:' + (st === "ready" ? "var(--ok-soft)" : st === "progress" ? "var(--accent-soft)" : "var(--bg)") + '">' + T.ic + "</div>" +
        '<div style="flex:1;min-width:0"><b class="sm">' + esc(T.title) + "</b>" +
        '<div class="xs mut">' + uses + " " + plural(uses, "подача", "подачи", "подач") + (d && d.expires_on ? " · до " + fmtDL(new Date(d.expires_on)) : d ? "" : " · " + (T.hint || "")) + "</div></div>" +
        '<span class="pill ' + (st === "ready" && !warn ? "pill-ok" : warn ? "pill-warn" : st === "progress" ? "pill-acc" : "pill-mut") + '">' +
        (st === "ready" && !warn ? "готов" : warn ? "смотри" : st === "progress" ? "в работе" : "нет") + "</span></div>";
    }).join("");
    $("tab-docs").innerHTML =
      '<div class="h-row" style="margin:10px 0 4px"><div class="h2" style="margin:0">Документы</div>' + ringHTML(Math.round(ready / Math.max(1, types.length) * 100), 44) + "</div>" +
      '<p class="sm mut" style="margin:0 0 12px">' + ready + " из " + types.length + " готово · список собран из требований твоих подач</p>" +
      rows +
      '<div class="upload tappable" data-act="doc-pick">＋ Загрузить документ<div class="xs">PDF или фото · до 10 МБ · проверим по требованиям программ</div></div>' +
      '<p class="xs mut" style="margin-top:12px">Файлы видишь только ты: доступ закрыт по твоему аккаунту. <a href="/privacy/" target="_blank" rel="noopener">Как мы храним данные</a></p>';
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
    return subHead(T.title, T.hint || "") +
      '<div class="card" style="margin-bottom:12px">' +
        '<div class="h-row"><span class="sm mut">Статус</span><div class="seg" style="width:190px;margin:0">' +
        ["none|Нет", "progress|В работе", "ready|Готов"].map(function (s) {
          var p = s.split("|");
          return '<button data-act="docst" data-v="' + p[0] + '" data-id="' + d.id + '" class="' + (d.status === p[0] ? "on" : "") + '">' + p[1] + "</button>";
        }).join("") + "</div></div>" +
        (d.file_path ? '<div class="h-row" style="margin-top:10px"><span class="sm mut">Файл</span><button class="btn btn-ghost btn-sm" data-act="dl" data-id="' + d.id + '">Открыть</button></div>' : "") +
        '<div class="h-row" style="margin-top:10px"><span class="sm mut">' + (d.file_path ? "Заменить файл" : "Загрузить файл") + '</span><button class="btn btn-soft btn-sm" data-act="upload" data-id="' + d.id + '">Выбрать</button></div>' +
      "</div>" +
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

  /* ================= 3 · ВУЗЫ ================= */
  var uniFilter = { q: "", cc: null, budget: null, noIelts: false };
  function catalogViews() {
    var prof = S.evalR && S.evalR.profile;
    var lvl = (S.ans && S.ans.level) || "bachelor";
    var mine = {}; S.apps.forEach(function (a) { mine[a.program_id] = 1; });
    return S.programs.filter(function (p) {
      // куда казахстанец подать не может — в каталоге не показываем совсем
      if (p.available_kz === false) return false;
      if (p.levels && p.levels.indexOf(lvl) === -1) return false;
      if (uniFilter.cc && (p.cc || "").toLowerCase() !== uniFilter.cc) return false;
      if (uniFilter.noIelts && p.req && p.req.language > 4.5) return false;
      if (uniFilter.budget === 0 && p.req && p.req.budget > 0) return false;
      if (uniFilter.q) {
        var s = (p.name + " " + p.country + " " + (p.funding || "")).toLowerCase();
        if (s.indexOf(uniFilter.q.toLowerCase()) === -1) return false;
      }
      return true;
    }).map(function (p) {
      var pr = probFor(prof, p);
      return { prog: p, p: pr, mine: !!mine[p.id], match: pr ? Math.round((pr.adm * 0.6 + (pr.sch || pr.adm) * 0.4) * 100) : 0, date: parseDeadline(p.deadline) };
    }).sort(function (a, b) { return b.match - a.match; });
  }
  function renderUnis() {
    var vs = catalogViews();
    var chips = [["", "Все"], ["hu", "🇭🇺 Венгрия"], ["de", "🇩🇪 Германия"], ["it", "🇮🇹 Италия"], ["tr", "🇹🇷 Турция"], ["kr", "🇰🇷 Корея"], ["cz", "🇨🇿 Чехия"], ["nl", "🇳🇱 Нидерланды"], ["cn", "🇨🇳 Китай"]];
    $("tab-unis").innerHTML =
      '<div class="h2" style="margin:10px 0 2px">Вузы и программы</div>' +
      '<p class="sm mut" style="margin:0 0 10px">' + S.programs.length + " программ в базе · проценты посчитаны по твоему профилю</p>" +
      '<div class="fld"><svg class="ic16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>' +
      '<input id="uni-q" placeholder="Страна, программа, «без IELTS»" value="' + esc(uniFilter.q) + '"></div>' +
      '<div class="chips" style="margin:10px 0 6px">' + chips.map(function (c) {
        return '<button class="chip ' + ((uniFilter.cc || "") === c[0] ? "on" : "") + '" data-act="unicc" data-v="' + c[0] + '">' + c[1] + "</button>";
      }).join("") + "</div>" +
      '<div class="chips" style="margin:0 0 12px">' +
        '<button class="chip ' + (uniFilter.budget === 0 ? "on" : "") + '" data-act="unibudget">Только 0 ₸</button>' +
        '<button class="chip ' + (uniFilter.noIelts ? "on" : "") + '" data-act="uniielts">Можно без IELTS</button>' +
      "</div>" +
      uniListHTML(vs);
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
        html += '<p class="sm mut" style="margin:0 0 10px">Тут пороги выше твоего профиля прямо сейчас. Это не «никогда»: подтяни язык или достижения — и проценты вырастут.</p>' +
          '<button class="btn btn-soft btn-sm btn-block" data-act="uniweak">Показать ' + weak.length + " " + plural(weak.length, "программу", "программы", "программ") + "</button>";
      }
    }
    return html;
  }
  function uniEmpty() {
    return '<div class="empty"><div class="art">🔎</div><h3>Под эти фильтры ничего нет</h3>' +
      "<p>Попробуй убрать один фильтр — например, «только 0 ₸»: программы с частичным покрытием часто выгоднее по деньгам.</p>" +
      '<button class="btn btn-soft btn-sm" data-act="unireset">Сбросить фильтры</button></div>';
  }
  function uniCard(v) {
    return '<div class="prog tappable" data-act="prog" data-id="' + esc(v.prog.id) + '">' +
      '<div class="h-row" style="align-items:flex-start"><div style="flex:1;min-width:0"><b>' + flag(v.prog.cc) + " " + esc(v.prog.name) + "</b>" +
      '<div class="xs mut">' + [esc(v.prog.country), esc(v.prog.funding || "")].filter(Boolean).join(" · ") + "</div></div>" +
      '<span class="pill ' + (v.match >= 70 ? "pill-ok" : v.match >= 45 ? "pill-warn" : "pill-mut") + '">' + v.match + "%</span></div>" +
      (v.p ? '<div class="pb-line"><span class="nm">Поступление</span><div class="pb"><i style="width:' + pct(v.p.adm) + '%"></i></div><span class="v">' + pct(v.p.adm) + "%</span></div>" +
        (v.p.sch != null ? '<div class="pb-line"><span class="nm">Стипендия</span><div class="pb"><i class="sch" style="width:' + pct(v.p.sch) + '%"></i></div><span class="v">' + pct(v.p.sch) + "%</span></div>" : "") : "") +
      '<div class="h-row" style="margin-top:10px">' +
      (v.mine ? '<span class="pill pill-acc">уже в подачах</span>' : '<button class="btn btn-soft btn-sm" data-act="add" data-id="' + esc(v.prog.id) + '">+ В подачи</button>') +
      '<span class="xs mut">' + (v.date ? "дедлайн " + fmtD(v.date) : esc(v.prog.deadline || "")) + "</span></div></div>";
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
      '<div class="card" style="margin-bottom:12px"><div class="h-row"><div style="padding-right:10px"><b class="sm">Telegram</b><div class="xs mut">' +
        (S.tg && S.tg.chat_id ? "подключён · шаг дня и дедлайны" : "не подключён — уведомления о дедлайнах не придут") + "</div></div>" +
        '<button class="btn ' + (S.tg && S.tg.chat_id ? "btn-ghost" : "btn-primary") + ' btn-sm" data-act="tg">' + (S.tg && S.tg.chat_id ? "Настроить" : "Подключить") + "</button></div></div>" +
      '<div class="lst tappable" data-act="subscribe"><div style="flex:1"><b class="sm">Scholary Pro</b><div class="xs mut">' +
        (S.profile && S.profile.pro_until && new Date(S.profile.pro_until) > new Date() ? "активна до " + fmtDL(new Date(S.profile.pro_until)) : "ИИ-разборы без очереди · 4 990 ₸/мес") + '</div></div><span class="xs mut">→</span></div>' +
      '<div class="lst tappable" data-act="reports"><div style="flex:1"><b class="sm">Мои отчёты</b><div class="xs mut">' + ((S.reports || []).length) + " " + plural((S.reports || []).length, "отчёт", "отчёта", "отчётов") + "</div></div><span class=\"xs mut\">→</span></div>" +
      '<div class="lst tappable" data-act="privacy"><div style="flex:1"><b class="sm">Данные и приватность</b><div class="xs mut">что хранится и как удалить</div></div><span class="xs mut">→</span></div>' +
      '<div class="lst tappable" data-act="help"><div style="flex:1"><b class="sm">Помощь</b><div class="xs mut">WhatsApp · Telegram · вопросы</div></div><span class="xs mut">→</span></div>' +
      '<button class="btn btn-ghost btn-block" style="margin-top:14px" data-act="logout">Выйти</button>' +
      '<p class="xs mut" style="text-align:center;margin-top:10px">Scholary · вероятности — оценка модели, не гарантия</p>';
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
        S.ans[cfg.key] = picked;
        if (cfg.key === "ielts_band") S.ans.lang_status = picked === "unknown" ? "none" : "have";
        sb.from("profiles").update({ answers: S.ans, updated_at: new Date().toISOString() }).eq("user_id", S.session.user.id).then(function () {});
        recompute(); pushHistory("правка анкеты"); bg.remove(); renderProfile(); toast("Пересчитали вероятности");
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
              '<div class="xs mut" style="margin-top:4px">До ' + fmtDL(new Date(S.profile.pro_until)) + " · 120 разборов ИИ в день и модель посильнее</div></div>" : "") +
        '<div class="card" style="margin-bottom:12px"><div class="h-row"><b>Бесплатно</b><span class="pill pill-mut">сейчас у тебя</span></div>' +
          '<div class="feat">✅ Все подачи, чек-листы и дедлайны</div>' +
          '<div class="feat">✅ Каталог 97 программ с твоими вероятностями</div>' +
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
        '<p class="xs mut" style="margin-top:12px">Оплата картой подключается на этой неделе. Пока оформляем через WhatsApp — доступ включим вручную в тот же день. <a href="/oferta/" target="_blank" rel="noopener">Оферта</a></p>';
    });
  }

  function openTg() {
    // код одноразовый и стирается на сервере после привязки, поэтому берём длинный
    var code = (S.tg && S.tg.code) || (Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6)).toUpperCase();
    if (!S.tg) { S.tg = { code: code }; sb.from("tg_links").upsert({ user_id: S.session.user.id, code: code }).then(function () {}); }
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
      if (window.track) track("cab_add_prog", { id: id });
    });
  }
  function pickFile(cb) {
    var i = document.createElement("input"); i.type = "file";
    i.accept = "image/*,application/pdf";
    i.onchange = function () { if (i.files && i.files[0]) cb(i.files[0]); };
    i.click();
  }
  function uploadFor(d) {
    pickFile(function (file) {
      if (file.size > 10 * 1024 * 1024) { toast("Файл больше 10 МБ — сожми или сфотографируй заново", "bad"); return; }
      toast("Загружаем…");
      var path = S.session.user.id + "/" + d.id + "-" + Date.now() + "-" + file.name.replace(/[^\w.\-]+/g, "_");
      sb.storage.from("docs").upload(path, file, { upsert: true }).then(function (r) {
        if (r.error) { toast("Не удалось загрузить: " + r.error.message, "bad"); return; }
        saveDoc(d, { file_path: path, status: d.status === "none" ? "progress" : d.status, checked_at: new Date().toISOString() }, function () {
          recompute(); drawSub(); toast("Файл загружен · проверяем по требованиям");
        });
      });
    });
  }
  function openFile(d) {
    if (!d.file_path) return;
    sb.storage.from("docs").createSignedUrl(d.file_path, 300).then(function (r) {
      if (r.data && r.data.signedUrl) window.open(r.data.signedUrl, "_blank", "noopener");
      else toast("Не удалось открыть файл", "bad");
    });
  }

  /* Оплата подписки. Доступ продлевает СЕРВЕР по уведомлению шлюза
     (api/tiptop.php → tiptop_grant_pro), поэтому в AccountId кладём почту
     аккаунта — иначе непонятно, кому продлевать. */
  function payPro(plan) {
    var season = plan === "season";
    var amount = season ? 14900 : 4990;
    var email = (S.session && S.session.user && S.session.user.email) || "";
    if (window.track) track("pro_click", { plan: plan });

    if (!window.scholaryTerminalReady || !window.scholaryTerminalReady() || !email) { proByHand(plan, email); return; }

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
  function proByHand(plan, email) {
    var label = plan === "season" ? "сезон · 14 900 ₸" : "месяц · 4 990 ₸";
    toast("Онлайн-оплата недоступна — пишем в WhatsApp");
    window.open("https://wa.me/" + (C.WHATSAPP_NUMBER || "") + "?text=" +
      encodeURIComponent("Здравствуйте! Хочу Scholary Pro (" + label + "). Аккаунт: " + (email || "")), "_blank", "noopener");
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
    if (act === "apptab") { appTab = v; drawSub(); return; }
    if (act === "status" && app) { saveApp(app, { status: v }, function () { drawSub(); }); return; }
    if (act === "outcome" && app) {
      saveApp(app, { outcome: v, outcome_at: new Date().toISOString() }, function () { drawSub(); });
      toast(v === "admit" ? "Поздравляем! Записали исход" : "Записали — это уточняет модель"); return;
    }
    if (act === "submit" && app) {
      saveApp(app, { submitted_at: new Date().toISOString(), status: "applied" }, function () { S.stack.pop(); drawSub(); });
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
      var types = docTypesForUser();
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
      saveDoc(doc, { status: v, checked_at: new Date().toISOString() }, function () { recompute(); drawSub(); pushHistory("документ " + v); });
      if (v === "ready") toast("Отмечено готовым");
      return;
    }
    if (act === "upload" && doc) { uploadFor(doc); return; }
    if (act === "dl" && doc) { openFile(doc); return; }
    if (act === "letter" && doc) { openDoc(doc.id); return; }
    if (act === "letter-save" && doc) {
      var t = document.getElementById("letter-text");
      saveDoc(doc, { content: t ? t.value : "", version: (doc.version || 1) + 1, checked_at: new Date().toISOString() }, function () { drawSub(); });
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
    if (act === "unicc") { uniFilter.cc = v || null; renderUnis(); return; }
    if (act === "unibudget") { uniFilter.budget = uniFilter.budget === 0 ? null : 0; renderUnis(); return; }
    if (act === "uniielts") { uniFilter.noIelts = !uniFilter.noIelts; renderUnis(); return; }
    if (act === "unireset") { uniFilter = { q: "", cc: null, budget: null, noIelts: false }; uniShowWeak = false; renderUnis(); return; }
    if (act === "uniweak") { uniShowWeak = !uniShowWeak; renderUnis(); return; }
    if (act === "prog") { openProg(id); return; }
    if (act === "add") { addProgram(id, function () { if (S.stack.length) drawSub(); else renderUnis(); }); return; }
    if (act === "custom-add") {
      toast("Скоро: добавление своей программы по ссылке. Пока напиши нам — добавим в базу за день");
      return;
    }
    if (act === "edit") { openEdit(el.getAttribute("data-key")); return; }
    if (act === "tg") { openTg(); return; }
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
    if (act === "logout") { sb.auth.signOut(); return; }
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
      .then(function (r) { if (r.error) { authErr("su-err", r.error); return; } if (window.track) track("cab_signup", {}); });
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
  $("btn-empty-out").onclick = function () { sb.auth.signOut(); };
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
    var lvl = saved && saved.answers && saved.answers.level;
    $("claim-card").innerHTML =
      '<div class="xs" style="letter-spacing:.14em;color:#A78BFA;font-weight:700">ТВОЙ РАСЧЁТ НА ЭТОМ УСТРОЙСТВЕ</div>' +
      '<div style="font-size:16px;margin-top:6px">' + (lvl ? (L.level[lvl] || "") + " · " : "") + "ответы квиза и результат</div>" +
      '<div class="xs" style="color:rgba(255,255,255,.55);margin-top:6px">Из них соберём подачи и план документов</div>';
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
    if (entering) return; entering = true; show("loading");
    sb.from("profiles").select("*").maybeSingle().then(function (r) {
      S.profile = r.data || null;
      var metaName = S.session && S.session.user.user_metadata && S.session.user.user_metadata.name;
      if (S.profile && !S.profile.name && metaName) {
        S.profile.name = metaName;
        sb.from("profiles").update({ name: metaName }).eq("user_id", S.session.user.id).then(function () {});
      }
      var haveAnswers = S.profile && S.profile.answers && S.profile.answers.level;
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
        sb.from("tg_links").select("*").maybeSingle()
      ]).then(function (rs) {
        S.apps = rs[0].data || [];
        S.docs = rs[1].data || [];
        S.programs = (rs[2].data || []).map(function (p) { return p; });
        S.reports = rs[3].data || [];
        S.hist = rs[4].data || [];
        S.tg = rs[5] && rs[5].data ? rs[5].data : null;
        recompute();
        var proceed = function () {
          entering = false;
          $("topbar-ava").textContent = ((S.profile && S.profile.name) || "S")[0].toUpperCase();
          show("v-app"); setTab(S.tab); pushHistory("вход");
          if (window.track) track("cab_open", { v: 2 });
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
    S.session = session;
    if (event === "PASSWORD_RECOVERY") { show("v-recovery"); return; }
    if (session) { if (recoveryMode) { recoveryMode = false; show("v-recovery"); return; } enter(); }
    else { entering = false; show("v-auth"); authView("login"); }
  });
  sb.auth.getSession().then(function (r) { if (!r.data.session) { show("v-auth"); authView("login"); } });
})();
