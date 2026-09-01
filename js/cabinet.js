/* Scholary — личный кабинет. Auth (Supabase), портфель, документы, отчёт, профиль.
   Данные: profiles / portfolio_items / user_documents (RLS auth.uid), RPC claim_lead / my_reports.
   Вероятности считает js/report-engine.js на клиенте. */
(function () {
  "use strict";
  var C = window.SCHOLARY_CONFIG || {};
  var sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
  var E = window.ScholaryEngine;

  /* ---------- состояние ---------- */
  var S = { session: null, profile: null, ans: null, evalR: null, items: [], docs: [], reports: null, tab: "today" };

  /* ---------- утилиты ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[<>&"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]; }); }
  function show(id) {
    ["loading", "v-auth", "v-recovery", "v-claim", "v-empty", "v-app"].forEach(function (v) { $(v).hidden = v !== id; });
  }
  function toast(msg) {
    var t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
    $("toast-root").appendChild(t); setTimeout(function () { t.remove(); }, 3200);
  }
  function modal(html) {
    var bg = document.createElement("div"); bg.className = "modal-bg";
    bg.innerHTML = '<div class="modal">' + html + "</div>";
    bg.addEventListener("click", function (e) { if (e.target === bg) bg.remove(); });
    $("modal-root").appendChild(bg); return bg;
  }
  function firstName(n) { return (n || "").trim().split(/\s+/)[0] || ""; }
  function pct(x) { return Math.round(x * 100) + "%"; }

  /* ---------- словари подписей (значения = квиз) ---------- */
  var L = {
    level: { bachelor: "Бакалавриат", master: "Магистратура", phd: "PhD / докторантура" },
    year: { "2027": "2027", "2028": "2028", later: "позже" },
    gpa_band: { "5.0-4.5": "5.0–4.5", "4.4-4.0": "4.4–4.0", "3.9-3.5": "3.9–3.5", "<3.5": "ниже 3.5" },
    gpa4: { "3.67+": "3.67+", "3.33-3.66": "3.33–3.66", "3.0-3.32": "3.0–3.32", "<3.0": "ниже 3.0", unknown: "не знаю" },
    lang_status: { have: "сертификат есть", soon: "сдаю в ближайшие полгода", none: "пока нет" },
    ielts: { "7+": "7.0+", "6.5": "6.5", "6.0": "6.0", "5.5": "5.5", "<5.5": "ниже 5.5", unknown: "не знаю" },
    budget: { "0": "0 ₸ — только стипендия", "<1m": "до 1 млн ₸", "1-3m": "1–3 млн ₸", "3m+": "3+ млн ₸" },
    field: { it: "IT", eng: "Инженерия", med: "Медицина", bus: "Бизнес", sci: "Науки", hum: "Гуманитарные", art: "Искусство", law: "Право" },
    ach: { intl_olymp: "Межд. олимпиады", rep_olymp: "Респ. олимпиады", city_olymp: "Обл. олимпиады", publications: "Публикации", work_exp: "Опыт работы", project: "Проекты", volunteer: "Волонтёрство", sport_art: "Спорт/творчество", none: "пока нет" },
    status: { study: "Изучаю", prep: "Готовлю", applied: "Подал", admit: "Принят 🎉", reject: "Отказ" },
    cflag: { hu: "🇭🇺", de: "🇩🇪", it: "🇮🇹", cz: "🇨🇿", tr: "🇹🇷", cn: "🇨🇳", kr: "🇰🇷", jp: "🇯🇵", pl: "🇵🇱", us: "🇺🇸", fr: "🇫🇷", nl: "🇳🇱", ae: "🇦🇪", eu: "🇪🇺", se: "🇸🇪", sa: "🇸🇦", hk: "🇭🇰", sg: "🇸🇬" }
  };

  /* ---------- нормализация ответов из leads (строки → массивы) ---------- */
  function normAnswers(a) {
    a = a || {};
    ["field", "achievements", "target_countries"].forEach(function (k) {
      if (typeof a[k] === "string") a[k] = a[k] ? a[k].split(",") : [];
    });
    return a;
  }

  /* ---------- вероятности для любой программы (формула = report-engine, держать в синхроне) ---------- */
  function probFor(profile, prog) {
    var ax = profile.axes;
    var d = 0.45 * (ax.academics - prog.req.academics) + 0.4 * (ax.language - prog.req.language)
          + 0.12 * (ax.achievements - 5) + 0.08 * (ax.motivation - 5);
    if (prog.req.sat != null) d += 0.25 * (profile.sat - prog.req.sat);
    function cl(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
    return { adm: cl(prog.baseAdm * (1 + 0.16 * d), 0.03, 0.92),
             sch: prog.baseSch == null ? null : cl(prog.baseSch * (1 + 0.16 * d), 0.02, 0.9) };
  }
  function progById(id) {
    for (var i = 0; i < E.PROGRAMS.length; i++) if (E.PROGRAMS[i].id === id) return E.PROGRAMS[i];
    return null;
  }

  /* ---------- дедлайны: «15 января», «~апрель», «окт–янв», «1 ноя / 1 янв» ---------- */
  var MONTHS = { янв: 0, фев: 1, мар: 2, апр: 3, май: 4, мая: 4, июн: 5, июл: 6, авг: 7, сен: 8, окт: 9, ноя: 10, дек: 11 };
  function parseDeadline(str) {
    if (!str) return null;
    var m = String(str).toLowerCase().match(/(\d{1,2})?\s*~?\s*(янв|фев|мар|апр|мая|май|июн|июл|авг|сен|окт|ноя|дек)/);
    if (!m) return null;
    var day = m[1] ? parseInt(m[1], 10) : 1;
    var mon = MONTHS[m[2]];
    var now = new Date(); var d = new Date(now.getFullYear(), mon, day);
    if (d < now) d = new Date(now.getFullYear() + 1, mon, day);
    return d;
  }
  function daysTo(d) { return Math.ceil((d - new Date()) / 864e5); }
  function dlPill(days) {
    if (days == null) return { cls: "pill-mut", dot: "var(--muted)" };
    if (days <= 75) return { cls: "pill-bad", dot: "var(--bad)" };
    if (days <= 150) return { cls: "pill-warn", dot: "var(--warn)" };
    return { cls: "pill-mut", dot: "var(--ok)" };
  }
  function fmtD(d) { return d ? d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) : "—"; }

  /* ---------- документы: шаблон v1 ---------- */
  function docTemplate() {
    var lvl = (S.ans && S.ans.level) || "bachelor";
    return [
      { t: "diploma", title: lvl === "bachelor" ? "Аттестат + приложение" : "Диплом + транскрипт", ic: "🎓", sub: "нужен всем программам" },
      { t: "translations", title: "Нотариальные переводы (англ.)", ic: "📑", sub: "~1 неделя" },
      { t: "apostille", title: "Апостиль", ic: "📜", sub: "~20 раб. дней · ЦОН / egov" },
      { t: "ielts", title: "Сертификат IELTS / TOEFL", ic: "🗣", sub: "следи за сроком действия (2 года)" },
      { t: "motivation", title: "Мотивационное письмо", ic: "✍️", sub: "у многих программ своя структура" },
      { t: "recommendation", title: "Рекомендательные письма ×2", ic: "📮", sub: "проси заранее — у преподавателей сессии" },
      { t: "passport", title: "Загранпаспорт (2+ года)", ic: "🛂", sub: "проверь срок действия" }
    ];
  }
  function docRow(t) {
    for (var i = 0; i < S.docs.length; i++) if (S.docs[i].doc_type === t) return S.docs[i];
    return null;
  }
  function docStatus(t) { var r = docRow(t); return r ? r.status : "none"; }
  function docsReadyCount() {
    var tpl = docTemplate(); var n = 0;
    tpl.forEach(function (d) { if (docStatus(d.t) === "ready") n++; });
    return { ready: n, total: tpl.length };
  }

  /* ---------- расчёт ---------- */
  function recompute() {
    try { S.evalR = E.evaluate(S.ans || {}); } catch (e) { S.evalR = null; console.error(e); }
  }
  function itemView(it) {
    var prog = progById(it.program_id);
    var p = prog && S.evalR ? probFor(S.evalR.profile, prog) : null;
    var d = prog ? parseDeadline(prog.deadline) : null;
    return { it: it, prog: prog, p: p, date: d, days: d ? daysTo(d) : null };
  }
  function views() {
    return S.items.map(itemView).filter(function (v) { return v.prog; })
      .sort(function (a, b) { return (a.days == null) - (b.days == null) || (a.days || 9e9) - (b.days || 9e9); });
  }

  /* ================= ЭКРАНЫ ================= */

  function renderToday() {
    var name = firstName(S.profile && S.profile.name) || "друг";
    var vs = views();
    var dr = docsReadyCount();
    var yr = (S.ans && S.ans.year === "2028") ? 2028 : 2027;
    var target = new Date(yr, 8, 1);
    var left = Math.max(0, daysTo(target));
    var prog = Math.max(4, Math.min(96, Math.round(100 - left / 5.4)));

    /* следующий шаг v1 — первое блокирующее действие */
    var step;
    if (S.ans && S.ans.lang_status === "none") {
      step = { h: "Запишись на IELTS / TOEFL", s: "Без сертификата закрыто большинство программ портфеля. Слоты разбирают за 1–2 месяца.", act: "Записался ✓", key: "lang" };
    } else if (S.ans && S.ans.lang_status === "soon") {
      step = { h: "Подготовься и сдай IELTS", s: "Ты указал, что сдаёшь в ближайшие полгода. После результата обнови профиль — шансы пересчитаются.", act: "Уже сдал — обновить", key: "lang2" };
    } else if (docStatus("apostille") === "none" && vs.length) {
      step = { h: "Запусти апостиль диплома", s: "Изготовление ~20 рабочих дней через ЦОН/egov. Это самый длинный документ — начни первым.", act: "В работе ✓", key: "apostille", doc: "apostille" };
    } else if (docStatus("motivation") !== "ready" && vs.length && vs[0].days != null && vs[0].days < 140) {
      step = { h: "Начни мотивационное письмо", s: "До дедлайна " + esc(vs[0].prog.name) + " — " + vs[0].days + " дн. Черновик за неделю, доводка за две.", act: "Готово ✓", key: "motivation", doc: "motivation" };
    } else if (vs.length && vs[0].it.status === "study") {
      step = { h: "Переведи «" + esc(vs[0].prog.name) + "» в подготовку", s: "Ближайший дедлайн портфеля — " + fmtD(vs[0].date) + ". Пора собирать документы под неё.", act: "Готовлю ✓", key: "toprep", pid: vs[0].it.program_id };
    } else {
      step = { h: "Пройди по чек-листу документов", s: "Собрано " + dr.ready + " из " + dr.total + ". Каждый закрытый пункт поднимает готовность ко всем программам сразу.", act: "Открыть документы", key: "docs" };
    }

    var dls = vs.slice(0, 3).map(function (v) {
      var pi = dlPill(v.days);
      return '<div class="dl"><span class="dot" style="background:' + pi.dot + '"></span>' +
        '<div style="flex:1;min-width:0"><b>' + esc(v.prog.name) + '</b><span class="sm mut">' + (L.cflag[v.prog.cc] || "") + " " + esc(v.prog.country) + '</span></div>' +
        '<span class="pill ' + pi.cls + '">' + fmtD(v.date) + (v.days != null ? " · " + v.days + " дн" : "") + "</span></div>";
    }).join("") || '<div class="sm mut" style="padding:10px 4px">Портфель пуст — добавь программы во вкладке «Портфель».</div>';

    var ringOff = 169.6 * (1 - (dr.total ? dr.ready / dr.total : 0));
    var tip = "";
    var noted = vs.filter(function (v) { return v.prog.note; });
    if (noted.length) {
      var v0 = noted[new Date().getDate() % noted.length];
      tip = '<div class="aicard"><div class="sm" style="font-weight:750;color:var(--accent-dark)">✨ Подсказка по твоему портфелю</div>' +
        '<div class="sm" style="margin-top:4px"><b>' + esc(v0.prog.name) + ':</b> ' + esc(v0.prog.note) + "</div></div>";
    }

    $("tab-today").innerHTML =
      '<div class="h2">Салем, ' + esc(name) + '! 👋</div>' +
      '<div class="pointb"><div class="lbl">Точка Б · Сентябрь ' + yr + '</div><div class="big">Осталось ' + left + ' дней</div>' +
      '<div class="pbar"><i style="width:' + prog + '%"></i></div>' +
      '<div class="xs" style="color:rgba(255,255,255,.55);margin-top:6px">Пройдено ' + prog + '% пути</div></div>' +
      '<div class="nextstep"><div class="tag">⚡ Следующий шаг</div><h3>' + step.h + '</h3><div class="sm mut">' + step.s + "</div>" +
      '<div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn-primary btn-sm" id="btn-step">' + step.act + "</button></div></div>" +
      '<div class="card" style="padding:8px 16px;margin-bottom:14px"><div class="h-row" style="padding:8px 0 2px"><b style="font-size:16px">Горящие дедлайны</b>' +
      '<a href="#" class="sm" id="lnk-alldl">Все →</a></div>' + dls + "</div>" +
      '<div class="card" style="margin-bottom:14px"><div class="ringwrap">' +
      '<svg class="ring" viewBox="0 0 64 64"><circle cx="32" cy="32" r="27" fill="none" stroke="#EDEDF2" stroke-width="7"/>' +
      '<circle cx="32" cy="32" r="27" fill="none" stroke="#5B4BFF" stroke-width="7" stroke-linecap="round" stroke-dasharray="169.6" stroke-dashoffset="' + ringOff + '" transform="rotate(-90 32 32)"/>' +
      '<text x="32" y="37" text-anchor="middle" font-size="14" font-weight="800" fill="#1D1D1F">' + dr.ready + "/" + dr.total + '</text></svg>' +
      '<div style="flex:1"><b style="font-size:16px">Документы</b><div class="sm mut">Апостиль ~20 раб. дней, переводы ~неделя — начинай с длинных.</div></div></div>' +
      '<button class="btn btn-soft btn-sm btn-block" style="margin-top:12px" id="btn-todocs">Открыть чек-лист</button></div>' +
      tip +
      '<div class="sm mut" style="text-align:center;padding:2px 10px 8px">Хочешь, документы соберёт консультант? ' +
      '<a href="https://wa.me/' + C.WHATSAPP_NUMBER + '?text=' + encodeURIComponent("Здравствуйте! Хочу пакет «Документы и подача» за 25 000 ₸ (из кабинета)") + '" style="font-weight:650">Пакет 25 000 ₸</a></div>';

    $("btn-todocs").onclick = function () { setTab("docs"); };
    $("lnk-alldl").onclick = function (e) { e.preventDefault(); setTab("portfolio"); };
    $("btn-step").onclick = function () {
      if (step.doc) { setDocStatus(step.doc, step.doc === "apostille" ? "progress" : "ready"); }
      else if (step.key === "toprep") { setItemStatus(step.pid, "prep"); }
      else if (step.key === "docs") { setTab("docs"); }
      else if (step.key === "lang2") { setTab("profile"); toast("Обнови балл IELTS в профиле — шансы пересчитаются"); }
      else { toast("Отлично! Двигаемся дальше 🚀"); }
      if (window.track) track("cab_step_done", { key: step.key });
    };
  }

  function renderPortfolio() {
    var vs = views();
    var pAny = S.evalR ? pct(S.evalR.pAtLeastOne) : "—";
    var cards = vs.map(function (v) {
      var pi = dlPill(v.days);
      var segs = ["study", "prep", "applied"].map(function (st) {
        return '<button data-pid="' + v.it.program_id + '" data-st="' + st + '" class="' + (v.it.status === st ? "on" : "") + '">' + L.status[st] + "</button>";
      }).join("");
      var extra = v.it.status === "admit" || v.it.status === "reject" ? '<span class="pill ' + (v.it.status === "admit" ? "pill-ok" : "pill-mut") + '">' + L.status[v.it.status] + "</span>" : "";
      return '<div class="prog">' +
        '<div class="h-row"><div style="min-width:0"><b style="font-size:16.5px">' + esc(v.prog.name) + "</b>" +
        '<div class="sm mut">' + (L.cflag[v.prog.cc] || "") + " " + esc(v.prog.country) + (v.prog.note ? " · " + esc(v.prog.note) : "") + "</div></div>" +
        '<span class="pill ' + pi.cls + '">' + fmtD(v.date) + "</span></div>" +
        (v.p ? '<div class="pb-line"><span class="nm">Поступление</span><div class="pb"><i style="width:' + pct(v.p.adm) + '"></i></div><span class="v">' + pct(v.p.adm) + "</span></div>" +
          (v.p.sch != null ? '<div class="pb-line"><span class="nm">Стипендия</span><div class="pb"><i class="sch" style="width:' + pct(v.p.sch) + '"></i></div><span class="v">' + pct(v.p.sch) + "</span></div>"
            : '<div class="sm mut" style="margin-top:6px">обучение бесплатное — отдельной стипендии нет</div>') : "") +
        '<div class="seg">' + segs + "</div>" + extra +
        '<div class="sm" style="text-align:right;margin-top:10px"><a href="#" data-del="' + v.it.program_id + '" class="mut">убрать</a></div>' +
        "</div>";
    }).join("");

    $("tab-portfolio").innerHTML =
      '<div class="h-row"><div class="h2">Портфель</div><button class="btn btn-soft btn-sm" id="btn-addprog">+ Добавить</button></div>' +
      '<div class="sm mut" style="margin-bottom:12px">' + vs.length + ' программ · шанс хотя бы одной стипендии — <b style="color:var(--ink)">' + pAny + "</b></div>" +
      (cards || '<div class="card mut">Портфель пуст. Нажми «+ Добавить».</div>');

    $("btn-addprog").onclick = openCatalog;
    $("tab-portfolio").querySelectorAll(".seg button").forEach(function (b) {
      b.onclick = function () { setItemStatus(b.dataset.pid, b.dataset.st); };
    });
    $("tab-portfolio").querySelectorAll("[data-del]").forEach(function (a) {
      a.onclick = function (e) {
        e.preventDefault();
        var pid = a.dataset.del; var prog = progById(pid);
        if (!confirm("Убрать «" + (prog ? prog.name : pid) + "» из портфеля?")) return;
        sb.from("portfolio_items").delete().eq("program_id", pid).eq("user_id", S.session.user.id)
          .then(function () { S.items = S.items.filter(function (i) { return i.program_id !== pid; }); renderAll(); });
      };
    });
  }

  function openCatalog() {
    var have = {}; S.items.forEach(function (i) { have[i.program_id] = 1; });
    var lvl = S.evalR ? S.evalR.profile.level : (S.ans.level || "bachelor");
    var rows = E.PROGRAMS
      .filter(function (p) { return p.levels.indexOf(lvl) !== -1 && !have[p.id]; })
      .map(function (p) { return { p: p, pr: S.evalR ? probFor(S.evalR.profile, p) : null }; })
      .sort(function (a, b) { return (b.pr ? b.pr.adm : 0) - (a.pr ? a.pr.adm : 0); })
      .map(function (r) {
        return '<div class="doc" style="align-items:center"><div style="flex:1;min-width:0">' +
          '<b style="font-size:15.5px">' + esc(r.p.name) + "</b>" +
          '<div class="sm mut">' + (L.cflag[r.p.cc] || "") + " " + esc(r.p.country) + " · " + esc(r.p.deadline || "") + "</div>" +
          (r.pr ? '<div class="pb-line" style="margin-top:6px"><div class="pb"><i style="width:' + pct(r.pr.adm) + '"></i></div><span class="v">' + pct(r.pr.adm) + "</span></div>" : "") +
          '</div><button class="btn btn-soft btn-sm" data-add="' + r.p.id + '">+</button></div>';
      }).join("");
    var bg = modal('<div class="h-row"><b style="font-size:19px">Каталог программ</b><button class="btn btn-ghost btn-sm" id="cat-close">Закрыть</button></div>' +
      '<div class="sm mut" style="margin:6px 0 14px">Твой уровень: ' + (L.level[lvl] || lvl) + '. Шанс поступления — под твой профиль. Каталог пополняется: 111 программ в базе, проверенные подключаются.</div>' +
      (rows || '<div class="mut sm">Все подходящие программы уже в портфеле.</div>'));
    bg.querySelector("#cat-close").onclick = function () { bg.remove(); };
    bg.querySelectorAll("[data-add]").forEach(function (b) {
      b.onclick = function () {
        b.disabled = true;
        sb.from("portfolio_items").insert({ user_id: S.session.user.id, program_id: b.dataset.add })
          .then(function (r) {
            if (r.error) { toast("Не удалось добавить"); b.disabled = false; return; }
            S.items.push({ user_id: S.session.user.id, program_id: b.dataset.add, status: "study" });
            bg.remove(); renderAll(); toast("Добавлено в портфель");
            if (window.track) track("cab_prog_add", { id: b.dataset.add });
          });
      };
    });
  }

  function setItemStatus(pid, st) {
    sb.from("portfolio_items").update({ status: st }).eq("program_id", pid).eq("user_id", S.session.user.id)
      .then(function (r) {
        if (r.error) { toast("Не сохранилось, попробуй ещё раз"); return; }
        S.items.forEach(function (i) { if (i.program_id === pid) i.status = st; });
        renderAll();
        if (st === "applied") toast("Подача отмечена! 🎉");
        if (window.track) track("cab_status", { id: pid, st: st });
      });
  }

  /* ---------- документы ---------- */
  function renderDocs() {
    var dr = docsReadyCount();
    var stPill = { none: '<span class="pill pill-mut">нет</span>', progress: '<span class="pill pill-warn">в работе</span>', ready: '<span class="pill pill-ok">готов ✓</span>' };
    var rows = docTemplate().map(function (d) {
      var row = docRow(d.t); var st = row ? row.status : "none";
      var icBg = st === "ready" ? "var(--ok-soft)" : st === "progress" ? "var(--warn-soft)" : "var(--bg)";
      var fileLine = row && row.file_path ? '<div class="sm"><a href="#" data-dl="' + esc(row.file_path) + '">📎 открыть файл</a></div>' : "";
      return '<div class="doc"><div class="ic" style="background:' + icBg + '">' + d.ic + '</div>' +
        '<div style="flex:1;min-width:0"><b style="font-size:15.5px">' + d.title + '</b>' +
        '<div class="sm mut">' + d.sub + "</div>" + fileLine +
        '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">' +
        (st !== "ready" ? '<button class="btn btn-soft btn-sm" data-st="ready" data-doc="' + d.t + '">Готов ✓</button>' : "") +
        (st === "none" ? '<button class="btn btn-ghost btn-sm" data-st="progress" data-doc="' + d.t + '">В работе</button>' : "") +
        (st === "ready" ? '<button class="btn btn-ghost btn-sm" data-st="none" data-doc="' + d.t + '">Сбросить</button>' : "") +
        '<button class="btn btn-ghost btn-sm" data-up="' + d.t + '">📎 Файл</button>' +
        "</div></div>" + stPill[st] + "</div>";
    }).join("");

    $("tab-docs").innerHTML =
      '<div class="h2">Документы</div>' +
      '<div class="sm mut" style="margin-bottom:12px">Собрано <b style="color:var(--ink)">' + dr.ready + " из " + dr.total + "</b> · один чек-лист закрывает все программы портфеля</div>" +
      rows +
      '<div class="aicard" style="margin-top:4px"><div class="sm" style="font-weight:750;color:var(--accent-dark)">✨ Проверка документов ИИ — скоро</div>' +
      '<div class="sm" style="margin-top:4px">Загружай файлы уже сейчас: когда включим проверку, ИИ сверит их с требованиями каждой программы (сроки действия, апостиль, формат). ' +
      'Нужна проверка человеком сегодня? <a href="https://wa.me/' + C.WHATSAPP_NUMBER + '?text=' + encodeURIComponent("Здравствуйте! Нужна проверка документов (из кабинета)") + '">Консультант · 15 000 ₸</a></div></div>' +
      '<input type="file" id="doc-file" accept=".pdf,.jpg,.jpeg,.png" hidden>';

    $("tab-docs").querySelectorAll("[data-st]").forEach(function (b) {
      b.onclick = function () { setDocStatus(b.dataset.doc, b.dataset.st); };
    });
    $("tab-docs").querySelectorAll("[data-up]").forEach(function (b) {
      b.onclick = function () {
        var inp = $("doc-file");
        inp.onchange = function () { if (inp.files[0]) uploadDoc(b.dataset.up, inp.files[0]); inp.value = ""; };
        inp.click();
      };
    });
    $("tab-docs").querySelectorAll("[data-dl]").forEach(function (a) {
      a.onclick = function (e) {
        e.preventDefault();
        sb.storage.from("docs").createSignedUrl(a.dataset.dl, 300).then(function (r) {
          if (r.data && r.data.signedUrl) window.open(r.data.signedUrl, "_blank"); else toast("Не удалось открыть файл");
        });
      };
    });
  }

  function setDocStatus(t, st, filePath) {
    var row = docRow(t);
    var patch = { status: st, updated_at: new Date().toISOString() };
    if (filePath) patch.file_path = filePath;
    var q = row
      ? sb.from("user_documents").update(patch).eq("id", row.id)
      : sb.from("user_documents").insert(Object.assign({ user_id: S.session.user.id, doc_type: t }, patch)).select();
    q.then(function (r) {
      if (r.error) { toast("Не сохранилось"); return; }
      if (row) { Object.assign(row, patch); }
      else if (r.data && r.data[0]) { S.docs.push(r.data[0]); }
      renderAll();
      if (window.track) track("cab_doc", { t: t, st: st });
    });
  }

  function uploadDoc(t, file) {
    if (file.size > 10 * 1024 * 1024) { toast("Файл больше 10 МБ"); return; }
    toast("Загружаю…");
    var path = S.session.user.id + "/" + t + "-" + Date.now() + "-" + file.name.replace(/[^\w.\-]+/g, "_");
    sb.storage.from("docs").upload(path, file).then(function (r) {
      if (r.error) { toast("Не удалось загрузить: " + r.error.message); return; }
      var st = docStatus(t) === "none" ? "progress" : docStatus(t);
      setDocStatus(t, st, path);
      toast("Файл загружен 📎");
    });
  }

  /* ---------- отчёт ---------- */
  function renderReport() {
    var host = $("tab-report");
    var er = S.evalR;
    var mini = er
      ? '<div class="minirep"><div class="xs" style="letter-spacing:.14em;color:#A78BFA;font-weight:700">АКТУАЛЬНЫЙ РАСЧЁТ</div>' +
        '<div style="display:flex;align-items:baseline;gap:10px;margin-top:6px"><span class="pct">' + pct(er.pAtLeastOne) + "</span>" +
        '<span style="font-size:14px;color:rgba(255,255,255,.75)">хотя бы одна<br>стипендия из ' + er.programsCount + "</span></div>" +
        '<div class="pbar" style="margin-top:12px"><i style="width:' + pct(er.pAtLeastOne) + '"></i></div>' +
        '<div class="xs" style="color:rgba(255,255,255,.55);margin-top:8px">Сильная сторона: ' + esc(er.strongest) + " · усилить: " + esc(er.weakest) + "</div></div>"
      : "";

    var repHtml;
    if (S.reports === null) repHtml = '<div class="sm mut">Загружаю отчёты…</div>';
    else if (S.reports.length) {
      repHtml = '<a class="btn btn-primary btn-block" href="r.html?t=' + encodeURIComponent(S.reports[0].token) + '">Открыть полный отчёт</a>' +
        '<a class="btn btn-ghost btn-block" style="margin-top:10px" href="https://wa.me/?text=' +
        encodeURIComponent("Мой план поступления от Scholary: " + location.origin + "/r.html?t=" + S.reports[0].token) + '">Поделиться с родителями</a>' +
        (S.reports.length > 1 ? '<div class="card" style="margin-top:14px;padding:8px 16px"><b style="font-size:16px">Прошлые версии</b>' +
          S.reports.slice(1).map(function (r) {
            return '<div class="dl"><div style="flex:1"><b>' + new Date(r.created_at).toLocaleDateString("ru-RU") + '</b></div><a class="sm" href="r.html?t=' + encodeURIComponent(r.token) + '">открыть</a></div>';
          }).join("") + "</div>" : "");
    } else {
      repHtml = '<div class="note" style="margin-bottom:12px">Полного отчёта пока нет. Выше — живой расчёт по твоему профилю; полный отчёт добавит разбор всех программ, Точку Б и план по месяцам.</div>' +
        '<a class="btn btn-primary btn-block" href="quiz.html">Получить полный отчёт · 4 000 ₸</a>';
    }

    host.innerHTML = '<div class="h2">Мой отчёт</div>' + mini + repHtml +
      (er && er.boosters && er.boosters.length ?
        '<div class="card" style="margin-top:14px;padding:8px 16px"><b style="font-size:16px">Что даст наибольший прирост</b>' +
        er.boosters.map(function (b) {
          return '<div class="dl"><div style="flex:1"><b style="font-weight:600">' + esc(b.what) + '</b></div><span class="pill pill-ok">+' + b.pp + " пп</span></div>";
        }).join("") + "</div>" : "");
  }

  /* ---------- профиль ---------- */
  function renderProfile() {
    var a = S.ans || {};
    var name = (S.profile && S.profile.name) || "";
    var email = (S.session.user.email || "");
    var gpaLabel, gpaKey;
    if (a.level === "master") { gpaKey = "gpa_uni"; gpaLabel = "GPA бакалавриата"; }
    else if (a.level === "phd") { gpaKey = "gpa_phd"; gpaLabel = "GPA магистратуры"; }
    else { gpaKey = "gpa_band"; gpaLabel = "Средний балл аттестата"; }
    var gpaVal = a[gpaKey] ? (gpaKey === "gpa_band" ? L.gpa_band[a[gpaKey]] : L.gpa4[a[gpaKey]]) : "—";

    function row(label, value, key) {
      return '<div class="dl"><div style="flex:1;min-width:0"><span class="sm mut">' + label + "</span><b>" + esc(value || "—") + "</b></div>" +
        '<a href="#" class="sm" data-edit="' + key + '">Изменить</a></div>';
    }
    $("tab-profile").innerHTML =
      '<div style="display:flex;align-items:center;gap:14px;margin:12px 0 16px">' +
      '<div class="ava" style="width:54px;height:54px;font-size:22px">' + esc((firstName(name)[0] || "S").toUpperCase()) + "</div>" +
      '<div style="min-width:0"><b style="font-size:18px">' + esc(name || "Без имени") + '</b><div class="sm mut" style="overflow-wrap:anywhere">' + esc(email) + ((S.profile && S.profile.whatsapp) ? " · " + esc(S.profile.whatsapp) : "") + "</div></div></div>" +
      '<div class="note" style="margin-bottom:14px">Меняешь данные — вероятности пересчитываются сразу во всём кабинете.</div>' +
      '<div class="card" style="padding:6px 16px;margin-bottom:14px">' +
      row("Имя", name, "name") +
      row("WhatsApp", S.profile && S.profile.whatsapp, "whatsapp") +
      row("Уровень", (L.level[a.level] || "—") + (a.year ? " · " + (L.year[a.year] || a.year) : ""), "level") +
      row(gpaLabel, gpaVal, gpaKey) +
      row("Язык", (L.lang_status[a.lang_status] || "—") + (a.ielts_band ? " · " + (L.ielts[a.ielts_band] || a.ielts_band) : ""), "lang") +
      row("Направления", (a.field || []).map(function (f) { return L.field[f] || f; }).join(", "), "field") +
      row("Достижения", (a.achievements || []).map(function (f) { return L.ach[f] || f; }).join(", "), "achievements") +
      row("Бюджет семьи в год", L.budget[a.budget], "budget") +
      "</div>" +
      '<div class="card" style="padding:6px 16px;margin-bottom:14px">' +
      '<div class="dl"><div style="flex:1"><span class="sm mut">Тариф</span><b>' + (S.reports && S.reports.length ? "Отчёт · оплачен" : "Бесплатный расчёт") + "</b></div>" +
      (S.reports && S.reports.length ? '<span class="pill pill-ok">активен</span>' : '<a class="sm" href="quiz.html" style="font-weight:700">Купить отчёт</a>') + "</div>" +
      '<div class="dl"><div style="flex:1"><span class="sm mut">Апгрейд</span><b>Документы + подача</b></div>' +
      '<a class="sm" style="font-weight:700" href="https://wa.me/' + C.WHATSAPP_NUMBER + '?text=' + encodeURIComponent("Здравствуйте! Интересует пакет за 25 000 ₸ (из кабинета)") + '">25 000 ₸</a></div></div>' +
      '<button class="btn btn-ghost btn-block" id="btn-passwd">Сменить пароль</button>' +
      '<button class="btn btn-ghost btn-block" style="margin-top:10px;color:var(--bad)" id="btn-out">Выйти</button>';

    $("tab-profile").querySelectorAll("[data-edit]").forEach(function (el) {
      el.onclick = function (e) { e.preventDefault(); openEdit(el.dataset.edit); };
    });
    $("btn-out").onclick = function () { sb.auth.signOut(); };
    $("btn-passwd").onclick = function () {
      var bg = modal('<b style="font-size:19px">Новый пароль</b>' +
        '<label class="fl">Минимум 6 символов</label><input class="f" id="np" type="password" minlength="6">' +
        '<button class="btn btn-primary btn-block" style="margin-top:16px" id="np-save">Сохранить</button><div class="err" id="np-err" hidden></div>');
      bg.querySelector("#np-save").onclick = function () {
        var v = bg.querySelector("#np").value;
        if (v.length < 6) { var e1 = bg.querySelector("#np-err"); e1.textContent = "Минимум 6 символов"; e1.hidden = false; return; }
        sb.auth.updateUser({ password: v }).then(function (r) {
          if (r.error) { var e2 = bg.querySelector("#np-err"); e2.textContent = r.error.message; e2.hidden = false; }
          else { bg.remove(); toast("Пароль обновлён"); }
        });
      };
    };
  }

  /* редактирование поля профиля */
  function chipset(opts, sel, multi) {
    return '<div class="chips" style="margin-top:8px">' + Object.keys(opts).map(function (v) {
      var on = multi ? (sel || []).indexOf(v) !== -1 : sel === v;
      return '<button type="button" class="chip' + (on ? " on" : "") + '" data-v="' + v + '">' + opts[v] + "</button>";
    }).join("") + "</div>";
  }
  function openEdit(key) {
    var a = S.ans || {};
    var bg, html, save;

    if (key === "name" || key === "whatsapp") {
      var cur = key === "name" ? (S.profile.name || "") : (S.profile.whatsapp || "");
      html = '<b style="font-size:19px">' + (key === "name" ? "Имя" : "WhatsApp") + "</b>" +
        '<input class="f" id="ed-inp" style="margin-top:12px" value="' + esc(cur) + '" placeholder="' + (key === "whatsapp" ? "+7 777 000 00 00" : "") + '">';
      save = function (bg2) {
        var patch = {}; patch[key] = bg2.querySelector("#ed-inp").value.trim();
        return sb.from("profiles").update(patch).eq("user_id", S.session.user.id).then(function (r) {
          if (!r.error) Object.assign(S.profile, patch);
          return r;
        });
      };
      bg = modal(html + footer()); wire(bg, save); return;
    }

    var multi = key === "field" || key === "achievements";
    var opts, cur2, title;
    if (key === "level") { opts = L.level; cur2 = a.level; title = "Уровень"; }
    else if (key === "gpa_band") { opts = L.gpa_band; cur2 = a.gpa_band; title = "Средний балл аттестата"; }
    else if (key === "gpa_uni" || key === "gpa_phd") { opts = L.gpa4; cur2 = a[key]; title = "GPA (шкала 4.0)"; }
    else if (key === "lang") { opts = L.ielts; cur2 = a.ielts_band; title = "Балл IELTS"; }
    else if (key === "budget") { opts = L.budget; cur2 = a.budget; title = "Бюджет семьи в год"; }
    else if (key === "field") { opts = L.field; cur2 = a.field || []; title = "Направления (до 3)"; }
    else if (key === "achievements") { opts = L.ach; cur2 = a.achievements || []; title = "Достижения"; }
    else return;

    html = '<b style="font-size:19px">' + title + "</b>" +
      (key === "lang" ? '<div class="sm mut" style="margin-top:4px">Статус: сертификат есть / сдаю скоро — выбери актуальный балл</div>' : "") +
      (key === "level" ? '<div class="note" style="margin-top:10px">Смена уровня перестроит портфель программ.</div>' : "") +
      chipset(opts, cur2, multi);
    bg = modal(html + footer());

    var sel = multi ? (cur2 || []).slice() : cur2;
    bg.querySelectorAll(".chip").forEach(function (ch) {
      ch.onclick = function () {
        var v = ch.dataset.v;
        if (multi) {
          var i = sel.indexOf(v);
          if (i !== -1) sel.splice(i, 1);
          else { if (key === "field" && sel.length >= 3) { toast("Максимум 3"); return; } sel.push(v); }
          ch.classList.toggle("on");
        } else {
          sel = v;
          bg.querySelectorAll(".chip").forEach(function (c) { c.classList.remove("on"); });
          ch.classList.add("on");
        }
      };
    });

    save = function () {
      var patch = {};
      if (key === "lang") { patch.ielts_band = sel; if (a.lang_status === "none" && sel) patch.lang_status = "have"; }
      else if (key === "level") { patch.level = sel; }
      else patch[key] = sel;
      var newAns = Object.assign({}, a, patch);
      return sb.from("profiles").update({ answers: newAns, updated_at: new Date().toISOString() }).eq("user_id", S.session.user.id)
        .then(function (r) {
          if (!r.error) {
            S.ans = normAnswers(newAns); S.profile.answers = newAns; recompute();
            if (key === "level") reseedPortfolio();
          }
          return r;
        });
    };
    wire(bg, save);

    function footer() {
      return '<div style="display:flex;gap:10px;margin-top:20px"><button class="btn btn-ghost" id="ed-cancel" style="flex:1">Отмена</button>' +
        '<button class="btn btn-primary" id="ed-save" style="flex:1">Сохранить</button></div><div class="err" id="ed-err" hidden></div>';
    }
    function wire(bg2, saveFn) {
      bg2.querySelector("#ed-cancel").onclick = function () { bg2.remove(); };
      bg2.querySelector("#ed-save").onclick = function () {
        saveFn(bg2).then(function (r) {
          if (r && r.error) { var e3 = bg2.querySelector("#ed-err"); e3.textContent = "Не сохранилось: " + r.error.message; e3.hidden = false; return; }
          bg2.remove(); renderAll(); toast("Сохранено — пересчитал");
          if (window.track) track("cab_profile_edit", { key: key });
        });
      };
    }
  }
  // footer/wire для name|whatsapp (вынесены наружу через замыкание openEdit — дублируем маленькие хелперы)
  function footer() {
    return '<div style="display:flex;gap:10px;margin-top:20px"><button class="btn btn-ghost" id="ed-cancel" style="flex:1">Отмена</button>' +
      '<button class="btn btn-primary" id="ed-save" style="flex:1">Сохранить</button></div><div class="err" id="ed-err" hidden></div>';
  }
  function wire(bg2, saveFn) {
    bg2.querySelector("#ed-cancel").onclick = function () { bg2.remove(); };
    bg2.querySelector("#ed-save").onclick = function () {
      saveFn(bg2).then(function (r) {
        if (r && r.error) { var e3 = bg2.querySelector("#ed-err"); e3.textContent = "Не сохранилось: " + r.error.message; e3.hidden = false; return; }
        bg2.remove(); renderAll(); toast("Сохранено");
      });
    };
  }

  function reseedPortfolio() {
    if (!S.evalR) return;
    var uid = S.session.user.id;
    sb.from("portfolio_items").delete().eq("user_id", uid).then(function () {
      var rows = S.evalR.portfolio.map(function (p) { return { user_id: uid, program_id: p.id, status: "study" }; });
      return sb.from("portfolio_items").insert(rows).select();
    }).then(function (r) {
      S.items = (r && r.data) || [];
      renderAll();
    });
  }

  /* ---------- вкладки ---------- */
  function setTab(t) {
    S.tab = t;
    ["today", "portfolio", "docs", "report", "profile"].forEach(function (k) { $("tab-" + k).hidden = k !== t; });
    document.querySelectorAll("#tabbar button").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === t); });
    window.scrollTo(0, 0);
    if (window.track) track("cab_tab", { t: t });
  }
  document.querySelectorAll("#tabbar button").forEach(function (b) { b.onclick = function () { setTab(b.dataset.tab); }; });
  $("topbar-ava").onclick = function () { setTab("profile"); };

  function renderAll() {
    recompute();
    var name = firstName(S.profile && S.profile.name);
    $("topbar-ava").textContent = (name[0] || "S").toUpperCase();
    renderToday(); renderPortfolio(); renderDocs(); renderReport(); renderProfile();
  }

  /* ================= ВХОД И ЗАГРУЗКА ================= */

  function authView(which) {
    $("f-login").hidden = which !== "login";
    $("f-signup").hidden = which !== "signup";
    $("f-forgot").hidden = which !== "forgot";
    $("auth-title").textContent = which === "signup" ? "Создай аккаунт" : which === "forgot" ? "Восстановление" : "Твой путь к Точке Б";
    $("auth-sub").textContent = which === "signup" ? "1 минута — и твой план поступления всегда под рукой" : which === "forgot" ? "Пришлём ссылку для нового пароля" : "Отчёт, программы, документы и дедлайны — в одном месте";
  }
  $("lnk-signup").onclick = function (e) { e.preventDefault(); authView("signup"); };
  $("lnk-login").onclick = function (e) { e.preventDefault(); authView("login"); };
  $("lnk-login2").onclick = function (e) { e.preventDefault(); authView("login"); };
  $("lnk-forgot").onclick = function (e) { e.preventDefault(); authView("forgot"); };

  function authErr(id, err) {
    var el = $(id);
    var m = (err && err.message) || "Что-то пошло не так";
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
    var name = $("su-name").value.trim();
    sb.auth.signUp({ email: $("su-email").value.trim(), password: $("su-pass").value, options: { data: { name: name } } })
      .then(function (r) {
        if (r.error) { authErr("su-err", r.error); return; }
        if (window.track) track("cab_signup", {});
      });
  };
  $("f-forgot").onsubmit = function (e) {
    e.preventDefault(); $("fg-err").hidden = true;
    sb.auth.resetPasswordForEmail($("fg-email").value.trim(), { redirectTo: location.origin + "/cabinet.html" })
      .then(function (r) {
        if (r.error) { authErr("fg-err", r.error); return; }
        $("fg-ok").hidden = false;
      });
  };
  $("f-recovery").onsubmit = function (e) {
    e.preventDefault(); $("rc-err").hidden = true;
    sb.auth.updateUser({ password: $("rc-pass").value }).then(function (r) {
      if (r.error) { authErr("rc-err", r.error); return; }
      toast("Пароль сохранён"); enter();
    });
  };
  $("btn-google").onclick = function () {
    sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + "/cabinet.html" } })
      .then(function (r) {
        if (r.error) toast("Google-вход ещё подключается — войди по почте, это минута");
      });
  };
  $("btn-empty-out").onclick = function () { sb.auth.signOut(); };

  /* ---------- клейм квиза ---------- */
  function localLead() {
    try {
      var q = new URLSearchParams(location.search);
      return {
        lead: q.get("lead") || localStorage.getItem("scholary_lead_id"),
        token: q.get("t") || localStorage.getItem("scholary_report_token")
      };
    } catch (e) { return { lead: null, token: null }; }
  }

  function offerClaim(ll) {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem("scholary_quiz_v1") || "null"); } catch (e) {}
    var lvl = saved && saved.answers && saved.answers.level;
    $("claim-card").innerHTML =
      '<div class="xs" style="letter-spacing:.14em;color:#A78BFA;font-weight:700">ТВОЙ РАСЧЁТ НА ЭТОМ УСТРОЙСТВЕ</div>' +
      '<div style="font-size:16px;margin-top:6px">' + (lvl ? (L.level[lvl] || "") + " · " : "") + "ответы квиза и результат</div>" +
      '<div class="xs" style="color:rgba(255,255,255,.55);margin-top:6px">Портфель и план документов построим из них</div>';
    show("v-claim");
    $("btn-claim").onclick = function () {
      $("btn-claim").disabled = true; $("claim-err").hidden = true;
      sb.rpc("claim_lead", { p_lead_id: ll.lead, p_token: ll.token || null }).then(function (r) {
        $("btn-claim").disabled = false;
        var d = r.data;
        if (r.error || !d || d.ok === false) {
          var reason = d && d.reason;
          $("claim-err").textContent = reason === "token_required"
            ? "Этот расчёт привязан к оплаченному отчёту. Открой кабинет по ссылке из отчёта (WhatsApp/почта) — и он подтянется."
            : "Не получилось забрать расчёт. Можно пройти квиз заново — 2 минуты.";
          $("claim-err").hidden = false;
          return;
        }
        if (window.track) track("cab_claim", {});
        enter();
      });
    };
    $("btn-claim-skip").onclick = function () { show("v-empty"); };
  }

  /* ---------- вход в приложение ---------- */
  var entering = false;
  function enter() {
    if (entering) return; entering = true;
    show("loading");
    sb.from("profiles").select("*").maybeSingle().then(function (r) {
      S.profile = r.data || null;
      // имя из формы регистрации, если в профиле пусто
      var metaName = S.session && S.session.user.user_metadata && S.session.user.user_metadata.name;
      if (S.profile && !S.profile.name && metaName) {
        S.profile.name = metaName;
        sb.from("profiles").update({ name: metaName }).eq("user_id", S.session.user.id).then(function () {});
      }
      var haveAnswers = S.profile && S.profile.answers && S.profile.answers.level;
      if (!haveAnswers) {
        var ll = localLead();
        entering = false;
        if (ll.lead) { offerClaim(ll); } else { show("v-empty"); }
        return;
      }
      S.ans = normAnswers(JSON.parse(JSON.stringify(S.profile.answers)));
      recompute();
      Promise.all([
        sb.from("portfolio_items").select("*"),
        sb.from("user_documents").select("*"),
        sb.rpc("my_reports")
      ]).then(function (rs) {
        S.items = rs[0].data || [];
        S.docs = rs[1].data || [];
        S.reports = rs[2].data || [];
        var proceed = function () {
          entering = false;
          renderAll(); show("v-app"); setTab(S.tab);
          if (window.track) track("cab_open", {});
        };
        if (!S.items.length && S.evalR && S.evalR.portfolio.length) {
          var uid = S.session.user.id;
          var rows = S.evalR.portfolio.map(function (p) { return { user_id: uid, program_id: p.id, status: "study" }; });
          sb.from("portfolio_items").insert(rows).select().then(function (ri) {
            S.items = ri.data || []; proceed();
          });
        } else proceed();
      });
    });
  }

  /* ---------- boot ---------- */
  var recoveryMode = /type=recovery/.test(location.hash);
  sb.auth.onAuthStateChange(function (event, session) {
    S.session = session;
    if (event === "PASSWORD_RECOVERY") { show("v-recovery"); return; }
    if (session) {
      if (recoveryMode) { recoveryMode = false; show("v-recovery"); return; }
      enter();
    } else {
      entering = false;
      show("v-auth"); authView("login");
    }
  });
  sb.auth.getSession().then(function (r) {
    if (!r.data.session) { show("v-auth"); authView("login"); }
    // при наличии сессии onAuthStateChange(INITIAL_SESSION) вызовет enter()
  });
})();
