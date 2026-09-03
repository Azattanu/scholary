/* Scholary · workspace профориентолога, /counselors/cabinet/.
   Вход тем же Supabase Auth, что и у учеников. Привязка workspace к аккаунту —
   по токену из письма (?claim=…). Данные: school_mine / ws_roster / ws_today /
   ws_student_cabinet — RPC; карточки, подачи, документы, заметки — таблицы
   ws_students / ws_apps / ws_docs / ws_notes под RLS владельца (ws_owner).
   Файлы — бакет docs, папка {uid}/ws/{student_id}/… (RLS ученика не трогаем). */
function __counselorMain() {
  "use strict";
  var C = window.SCHOLARY_CONFIG || {};
  var sb = (window.supabase && window.supabase.createClient) ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY) : null;
  var $ = function (id) { return document.getElementById(id); };
  var track = window.track || function () {};
  var S = { session: null, ws: null, roster: [], today: null, programs: null, q: "", stage: "", entering: false,
            demo: /[?&]demo=1/.test(location.search), cur: null, tab: "apps", cache: {} };

  /* ---------- словари ---------- */
  var STAGES = [["intake", "Знакомство"], ["docs", "Документы"], ["applying", "Подача"], ["submitted", "Отправлено"], ["admitted", "Поступил"], ["paused", "Пауза"]];
  var STAGE_L = {}; STAGES.forEach(function (s) { STAGE_L[s[0]] = s[1]; });
  var APP_ST = [["study", "Изучаем"], ["prep", "Готовим"], ["applied", "Подано"], ["waitlist", "Лист ожидания"], ["admit", "Оффер"], ["reject", "Отказ"]];
  var APP_L = {}; APP_ST.forEach(function (s) { APP_L[s[0]] = s[1]; });
  var DOC_ST = [["none", "Нет"], ["progress", "В работе"], ["ready", "Готов"]];
  var DOC_L = {}; DOC_ST.forEach(function (s) { DOC_L[s[0]] = s[1]; });
  var NOTE_K = [["note", "Заметка"], ["call", "Звонок"], ["parent", "Родители"], ["meeting", "Встреча"], ["task", "Задача"]];
  var NOTE_L = {}; NOTE_K.forEach(function (s) { NOTE_L[s[0]] = s[1]; });
  var GRADES = [["9", "9 класс"], ["10", "10 класс"], ["11", "11 класс"], ["grad", "Выпускник / студент"], ["other", "Другое"]];
  var GRADE_L = {}; GRADES.forEach(function (s) { GRADE_L[s[0]] = s[1]; });
  var LEVELS = [["bachelor", "Бакалавриат"], ["master", "Магистратура"], ["phd", "PhD"]];
  var LEVEL_L = {}; LEVELS.forEach(function (s) { LEVEL_L[s[0]] = s[1]; });
  /* Ключи совпадают с doc-rules.js кабинета ученика — так связанный ученик и профориентолог говорят об одном. */
  var DOC_TYPES = {
    passport: "Загранпаспорт", diploma: "Диплом / аттестат + транскрипт", translation: "Нотариальный перевод (англ.)", apostille: "Апостиль на документ об образовании",
    ielts: "Сертификат языка (IELTS / TOEFL)", motivation: "Мотивационное письмо", recommendation: "Рекомендательные письма ×2", cv: "CV / резюме",
    medical: "Медицинская справка", income: "Справка о доходах семьи", research: "Исследовательское предложение", photo: "Фото по требованиям", finance: "Подтверждение финансов / блок-счёт", other: "Другой документ"
  };
  var DOC_STD = ["passport", "diploma", "translation", "apostille", "ielts", "motivation", "recommendation", "cv"];
  var CC = { hu: "Венгрия", de: "Германия", it: "Италия", cz: "Чехия", tr: "Турция", cn: "Китай", kr: "Корея", jp: "Япония", pl: "Польша", us: "США", fr: "Франция", nl: "Нидерланды", ae: "ОАЭ", eu: "Европа", se: "Швеция", sa: "Сауд. Аравия", hk: "Гонконг", sg: "Сингапур", uk: "Британия", gb: "Британия", ca: "Канада", kz: "Казахстан", ch: "Швейцария", at: "Австрия", my: "Малайзия", in: "Индия" };

  /* ---------- утилиты ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[<>&"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]; }); }
  function show(id) { ["loading", "v-auth", "v-none", "v-app"].forEach(function (v) { $(v).hidden = v !== id; }); }
  function toast(msg, kind) {
    var t = document.createElement("div"); t.className = "toast" + (kind ? " " + kind : ""); t.textContent = msg;
    $("toast-root").appendChild(t); setTimeout(function () { t.remove(); }, 3400);
  }
  function qs(name) { var m = location.search.match(new RegExp("[?&]" + name + "=([^&]+)")); return m ? decodeURIComponent(m[1]) : ""; }
  function fmtD(s) { if (!s) return "—"; return new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }); }
  function fmtDL(s) { if (!s) return "—"; return new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }); }
  function fmtDT(s) { if (!s) return ""; return new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) + ", " + new Date(s).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }); }
  function daysTo(s) { if (!s) return null; var d = new Date(s); d.setHours(0, 0, 0, 0); var n = new Date(); n.setHours(0, 0, 0, 0); return Math.round((d - n) / 864e5); }
  function daysAgo(s) { if (!s) return null; return Math.floor((new Date() - new Date(s)) / 864e5); }
  function plural(n, a, b, c) { n = Math.abs(n) % 100; var m = n % 10; if (n > 10 && n < 20) return c; if (m > 1 && m < 5) return b; if (m === 1) return a; return c; }
  function isoToday(off) { var d = new Date(); d.setDate(d.getDate() + (off || 0)); return d.toISOString().slice(0, 10); }
  function nextMD(md) { if (!md || !/^\d{2}-\d{2}$/.test(md)) return null; var y = new Date().getFullYear(); var d = new Date(y + "-" + md + "T00:00:00"); if (isNaN(d)) return null; if (daysTo(d) < 0) d = new Date((y + 1) + "-" + md + "T00:00:00"); return d.toISOString().slice(0, 10); }
  function dlPill(s, doneLike) {
    var d = daysTo(s); if (d == null) return '<span class="pill pill-mut">без дедлайна</span>';
    if (doneLike) return '<span class="pill pill-mut">' + fmtD(s) + "</span>";
    return '<span class="pill ' + (d < 0 ? "pill-mut" : d <= 14 ? "pill-bad" : d <= 45 ? "pill-warn" : "pill-mut") + '">' + fmtD(s) + " · " + (d < 0 ? "прошёл" : d === 0 ? "сегодня" : d + " " + plural(d, "день", "дня", "дней")) + "</span>";
  }
  function stagePill(st) { return '<span class="stage stage-' + esc(st) + '">' + esc(STAGE_L[st] || st) + "</span>"; }
  function sel(name, opts, val, cls) { return '<select class="' + (cls || "f") + '" name="' + name + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === val ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select>"; }
  function fail(r, what) { var m = (r && r.error && r.error.message) || ""; if (/seats_full/.test(m)) m = "Места по тарифу закончились — расширьте тариф в разделе «Ссылка и тариф»"; toast((what || "Не получилось") + (m ? ": " + m : ""), "bad"); }
  function safeUrl(u) { u = String(u || "").trim(); if (!u) return ""; if (!/^https?:\/\//i.test(u)) u = "https://" + u; return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : ""; }
  function inviteLink() { return location.origin + "/schools/join/?code=" + (S.ws && S.ws.invite_code || ""); }
  function waText(name) {
    var who = S.ws && S.ws.contact_name ? S.ws.contact_name : "ваш профориентолог";
    return (name ? name + ", привет! " : "Привет! ") + "Это " + who + ". Я веду твоё поступление в Scholary — там будут все твои программы, дедлайны и документы, и мы будем видеть их вместе.\n\n" +
      "Зарегистрируйся по моей ссылке — Scholary Pro для тебя бесплатно" + (S.ws && S.ws.ends_on ? " до " + fmtDL(S.ws.ends_on) : "") + ":\n" + inviteLink() +
      "\n\nЗаймёт 2 минуты: создать аккаунт, ответить на 7 вопросов — и ты увидишь свои шансы по 97 программам. Регистрируйся на ту же почту, что дал(а) мне.";
  }

  /* ---------- модалка ---------- */
  function openModal(html, onReady) {
    closeModal();
    var bg = document.createElement("div"); bg.className = "modal-bg"; bg.innerHTML = '<div class="modal">' + html + "</div>";
    bg.addEventListener("click", function (e) { if (e.target === bg) closeModal(); });
    $("modal-root").appendChild(bg); document.body.style.overflow = "hidden";
    var m = bg.querySelector(".modal");
    m.querySelectorAll("[data-close]").forEach(function (b) { b.onclick = function (e) { e.preventDefault(); closeModal(); }; });
    if (onReady) onReady(m);
    var f = m.querySelector("input:not([type=hidden]),select,textarea"); if (f && window.innerWidth > 640) setTimeout(function () { f.focus(); }, 50);
    return m;
  }
  function closeModal() { $("modal-root").innerHTML = ""; document.body.style.overflow = ""; }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });
  function formData(form) { var o = {}; new FormData(form).forEach(function (v, k) { o[k] = typeof v === "string" ? v.trim() : v; }); return o; }

  /* ---------- демо-данные ---------- */
  function demoData() {
    var d = isoToday, ago = function (n) { return new Date(Date.now() - n * 864e5).toISOString(); };
    var ws = { id: "demo", name: "Workspace Айгуль Сериковны", city: "Алматы", kind: "counselor", plan: "c50", plan_label: "Практика · до 50", period: "year",
      seats: 50, used: 14, students: 14, status: "active", open: true, invite_code: "DEMO2026", starts_on: d(-40), ends_on: d(325), contact_name: "Айгуль Сериковна", contact_email: "aigul@example.kz" };
    var students = [], apps = [], docs = [], notes = [], nid = 1;
    var rows = [
      ["Айгерим Сериккызы", "11", "bachelor", "applying", "Германия · IT", 1, 0.74, [["Stipendium Hungaricum — BSc Computer Science", "Венгрия", 60, "prep", "https://stipendiumhungaricum.hu/"], ["DAAD — TU Munich Informatics", "Германия", 130, "study", "https://www.daad.de/"], ["Türkiye Bursları", "Турция", 12, "applied", "https://www.turkiyeburslari.gov.tr/"]], ["passport:ready", "diploma:ready", "translation:progress", "apostille:progress", "ielts:ready", "motivation:progress", "recommendation:none", "cv:ready"], [["parent", "Мама просит дублировать все дедлайны ей в WhatsApp", 3], ["task", "Получить 2-ю рекомендацию от учителя физики", 1, 5], ["call", "Созвон: решили подавать в 3 страны, Германия — основная", 9]]],
      ["Данияр Касымов", "11", "bachelor", "docs", "Турция · инженерия", 1, 0.61, [["Türkiye Bursları — Engineering", "Турция", 12, "prep", "https://www.turkiyeburslari.gov.tr/"], ["Politecnico di Milano — Engineering", "Италия", 95, "study", "https://www.polimi.it/"]], ["passport:ready", "diploma:progress", "translation:none", "apostille:none", "ielts:progress", "motivation:none", "recommendation:none", "cv:none"], [["task", "Напомнить про апостиль — ЦОН до 20 рабочих дней", 2, 2], ["note", "IELTS сдаёт 20 числа, цель 6.5", 6]]],
      ["Томирис Жаксыбек", "10", "bachelor", "intake", "Медицина · пока выбирает", 0, null, [], [], [["meeting", "Первая встреча: интерес к медицине, Венгрия/Чехия. Родители за.", 1], ["task", "Отправить ссылку на регистрацию и квиз", 0, 1]]],
      ["Алихан Бекжан", "11", "bachelor", "submitted", "Китай · бизнес", 1, 0.56, [["CSC Scholarship — Fudan University", "Китай", -10, "applied", "https://www.campuschina.org/"], ["Shanghai Government Scholarship", "Китай", 40, "applied", "https://study.edu.sh.gov.cn/"]], ["passport:ready", "diploma:ready", "translation:ready", "apostille:ready", "ielts:ready", "motivation:ready", "recommendation:ready", "cv:ready", "medical:ready"], [["note", "Все подачи ушли, ждём ответ до мая", 4]]],
      ["Аружан Нурланова", "11", "bachelor", "applying", "Германия/Чехия · науки", 1, 0.68, [["Charles University — Chemistry", "Чехия", 44, "prep", "https://cuni.cz/"], ["DAAD — Heidelberg Chemistry", "Германия", 120, "study", "https://www.daad.de/"]], ["passport:ready", "diploma:ready", "translation:ready", "apostille:progress", "ielts:ready", "motivation:progress", "recommendation:progress", "cv:ready"], [["parent", "Папа спрашивал про стоимость жизни в Праге — отправила расчёт", 2]]],
      ["Ерасыл Мухамедиев", "11", "bachelor", "docs", "Корея · IT", 1, 0.47, [["GKS — Korean Government Scholarship", "Корея", 21, "prep", "https://www.studyinkorea.go.kr/"]], ["passport:progress", "diploma:ready", "translation:none", "apostille:none", "ielts:none", "motivation:none", "recommendation:none", "cv:progress"], [["task", "Паспорт: узнать срок готовности", 0, 3], ["call", "Не отвечал 2 недели — дозвонилась, продолжаем", 12]]],
      ["Диана Ахметова", "10", "bachelor", "intake", "Польша · гуманитарные", 0, null, [["Polish NAWA — Banach", "Польша", 160, "study", "https://nawa.gov.pl/"]], [], [["note", "Хочет Варшаву, смотрит психологию", 3]]],
      ["Санжар Оразбек", "11", "bachelor", "admitted", "Турция · инженерия", 1, 0.71, [["Türkiye Bursları — Civil Engineering", "Турция", -60, "admit", "https://www.turkiyeburslari.gov.tr/"], ["Stipendium Hungaricum — BME", "Венгрия", -30, "admit", "https://stipendiumhungaricum.hu/"]], ["passport:ready", "diploma:ready", "translation:ready", "apostille:ready", "ielts:ready", "motivation:ready", "recommendation:ready", "cv:ready"], [["parent", "Семья выбрала Венгрию. Помочь с визой и общежитием", 1], ["task", "Виза: записать в консульство", 0, 7]]],
      ["Мадина Сулейменова", "9", "bachelor", "intake", "Италия · искусство", 0, null, [], ["ielts:none"], [["meeting", "Знакомство с родителями: план на 2 года, начать с языка", 5]]],
      ["Нурсултан Абай", "11", "bachelor", "docs", "Нидерланды · право", 1, 0.39, [["University of Amsterdam — Law", "Нидерланды", 18, "prep", "https://www.uva.nl/"]], ["passport:ready", "diploma:progress", "translation:none", "apostille:none", "ielts:progress", "motivation:progress", "recommendation:none", "cv:none"], [["task", "Мотивационное: прислать правки до пятницы", 0, 2], ["note", "Шансы низкие — обсудили запасной вариант: Польша", 8]]],
      ["Камила Ержан", "11", "bachelor", "applying", "Китай/Венгрия · медицина", 1, 0.63, [["Stipendium Hungaricum — Semmelweis Medicine", "Венгрия", 58, "prep", "https://stipendiumhungaricum.hu/"], ["CSC — Peking Union Medical", "Китай", 90, "study", "https://www.campuschina.org/"]], ["passport:ready", "diploma:ready", "translation:ready", "apostille:ready", "ielts:progress", "motivation:progress", "recommendation:ready", "cv:ready", "medical:progress"], [["call", "Созвон с мамой: волнуется за IELTS, договорились о репетиторе", 2]]],
      ["Бекзат Тулеген", "10", "bachelor", "intake", "Германия · IT", 1, 0.58, [["DAAD — Studienkolleg", "Германия", 131, "study", "https://www.daad.de/"]], ["ielts:progress"], [["note", "Учит немецкий, B1 к лету", 10]]],
      ["Асель Кайрат", "grad", "master", "paused", "Британия · маркетинг", 0, null, [["Chevening", "Британия", 70, "study", "https://www.chevening.org/"]], ["cv:ready", "ielts:ready"], [["note", "Пауза до осени — устроилась на работу для опыта", 20]]],
      ["Арман Досов", "11", "bachelor", "docs", "Чехия · IT", 1, 0.52, [["Czech Technical University — Informatics", "Чехия", 33, "prep", "https://www.cvut.cz/"]], ["passport:ready", "diploma:progress", "translation:none", "apostille:none", "ielts:ready", "motivation:none", "recommendation:none", "cv:none"], [["task", "Оплатить нотариальный перевод", 0, 4]]]
    ];
    rows.forEach(function (r, i) {
      var id = "demo-s" + (i + 1);
      students.push({ id: id, user_id: r[5] ? "demo-u" + i : null, linked: !!r[5], name: r[0], grade: r[1], level: r[2], stage: r[3], target: r[4], phone: "+7 777 000 00 " + (10 + i), email: "student" + (i + 1) + "@example.kz",
        parent_name: i % 2 ? "Мама, Гульнара" : "Папа, Ерлан", parent_phone: "+7 701 000 00 " + (20 + i), note: i === 0 ? "Мама — главный контакт. Целится в Германию, Венгрия — запасной." : "", created_at: ago(40 - i), updated_at: ago(i), p_adm: r[6],
        cab_apps: r[5] ? r[7].length : 0, cab_apps_sent: r[5] ? r[7].filter(function (a) { return a[3] !== "study" && a[3] !== "prep"; }).length : 0, cab_docs: r[5] ? r[8].length : 0, cab_docs_ready: r[5] ? r[8].filter(function (x) { return /ready/.test(x); }).length : 0, cab_last_active: r[5] ? ago(i % 5) : null });
      r[7].forEach(function (a) { apps.push({ id: nid++, student_id: id, program_id: null, name: a[0], country: a[1], deadline: d(a[2]), status: a[3], apply_url: a[4], note: "", created_at: ago(20), updated_at: ago(2) }); });
      r[8].forEach(function (x) { var p = x.split(":"); docs.push({ id: nid++, student_id: id, doc_type: p[0], title: DOC_TYPES[p[0]], status: p[1], file_path: p[1] === "ready" ? "demo" : null, file_name: p[1] === "ready" ? p[0] + ".pdf" : null, note: "", updated_at: ago(3) }); });
      r[9].forEach(function (n) { notes.push({ id: nid++, student_id: id, kind: n[0], text: n[1], done: n[0] === "task" ? false : null, due_on: n[0] === "task" ? d(n[3]) : null, created_at: ago(n[2]) }); });
    });
    var programs = [["sh-cs", "Stipendium Hungaricum — BSc Computer Science", "Венгрия", "hu", "01-15", "https://stipendiumhungaricum.hu/"], ["daad-tum", "DAAD — TU Munich Informatics", "Германия", "de", "07-15", "https://www.daad.de/"], ["tb-eng", "Türkiye Bursları — Engineering", "Турция", "tr", "02-20", "https://www.turkiyeburslari.gov.tr/"],
      ["csc-fudan", "CSC Scholarship — Fudan University", "Китай", "cn", "03-31", "https://www.campuschina.org/"], ["gks", "GKS — Korean Government Scholarship", "Корея", "kr", "03-15", "https://www.studyinkorea.go.kr/"], ["cuni-chem", "Charles University — Chemistry", "Чехия", "cz", "02-28", "https://cuni.cz/"], ["nawa", "Polish NAWA — Banach", "Польша", "pl", "04-30", "https://nawa.gov.pl/"], ["uva-law", "University of Amsterdam — Law", "Нидерланды", "nl", "01-15", "https://www.uva.nl/"], ["chevening", "Chevening", "Британия", "gb", "11-05", "https://www.chevening.org/"], ["polimi", "Politecnico di Milano — Engineering", "Италия", "it", "12-01", "https://www.polimi.it/"]]
      .map(function (p) { return { id: p[0], name: p[1], country: p[2], cc: p[3], deadline_md: p[4], source_url: p[5], levels: ["bachelor"], funding: "full" }; });
    return { ws: ws, students: students, apps: apps, docs: docs, notes: notes, programs: programs, nid: nid };
  }

  /* ---------- слой данных ---------- */
  var DB;
  if (S.demo) {
    var D = demoData();
    var ok = function (v) { return Promise.resolve({ data: v, error: null }); };
    var agg = function (st) {
      var a = D.apps.filter(function (x) { return x.student_id === st.id; }), dc = D.docs.filter(function (x) { return x.student_id === st.id; }), n = D.notes.filter(function (x) { return x.student_id === st.id; });
      var open = n.filter(function (x) { return x.kind === "task" && !x.done; });
      var dl = a.filter(function (x) { return (x.status === "study" || x.status === "prep") && x.deadline && daysTo(x.deadline) >= 0; }).map(function (x) { return x.deadline; }).sort()[0] || null;
      return Object.assign({}, st, { ws_apps: a.length, ws_apps_sent: a.filter(function (x) { return x.status !== "study" && x.status !== "prep"; }).length, ws_offers: a.filter(function (x) { return x.status === "admit"; }).length, ws_next_deadline: dl,
        ws_docs: dc.length, ws_docs_ready: dc.filter(function (x) { return x.status === "ready"; }).length, tasks_open: open.length, task_due: open.map(function (x) { return x.due_on; }).filter(Boolean).sort()[0] || null,
        last_note: n.map(function (x) { return x.created_at; }).sort().reverse()[0] || null });
    };
    var table = function (arr) {
      return {
        list: function (sid) { return ok(arr.filter(function (x) { return x.student_id === sid; }).slice()); },
        add: function (o) { var row = Object.assign({ id: D.nid++, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, o); arr.push(row); return ok(row); },
        update: function (id, patch) { var row = arr.filter(function (x) { return String(x.id) === String(id); })[0]; if (row) Object.assign(row, patch, { updated_at: new Date().toISOString() }); return ok(row); },
        remove: function (id) { var i = arr.findIndex(function (x) { return String(x.id) === String(id); }); if (i >= 0) arr.splice(i, 1); return ok(true); }
      };
    };
    DB = {
      claim: function () { return ok({ ok: true, name: D.ws.name }); },
      mine: function () { D.ws.used = D.ws.students = D.students.length; return ok(D.ws); },
      roster: function () { return ok(D.students.map(agg)); },
      today: function () {
        var out = { deadlines: [], tasks: [], missing_docs: [] };
        D.students.forEach(function (st) {
          D.apps.forEach(function (a) { var dd = daysTo(a.deadline); if (a.student_id === st.id && (a.status === "study" || a.status === "prep") && dd != null && dd >= 0 && dd <= 45) out.deadlines.push({ student_id: st.id, student: st.name, name: a.name, country: a.country, deadline: a.deadline, days: dd, status: a.status, url: a.apply_url }); });
          D.notes.forEach(function (n) { if (n.student_id === st.id && n.kind === "task" && !n.done) out.tasks.push({ id: n.id, student_id: st.id, student: st.name, text: n.text, due_on: n.due_on }); });
          var miss = D.docs.filter(function (x) { return x.student_id === st.id && x.status !== "ready"; }).length;
          if ((st.stage === "docs" || st.stage === "applying") && miss > 0) out.missing_docs.push({ student_id: st.id, student: st.name, missing: miss });
        });
        out.deadlines.sort(function (a, b) { return a.days - b.days; }); out.tasks.sort(function (a, b) { return String(a.due_on || "9") < String(b.due_on || "9") ? -1 : 1; }); out.missing_docs.sort(function (a, b) { return b.missing - a.missing; });
        return ok(out);
      },
      cabinet: function (sid) {
        var st = D.students.filter(function (x) { return x.id === sid; })[0];
        if (!st || !st.linked) return ok({ linked: false });
        return ok({ linked: true, p_adm: st.p_adm, p_sch: st.p_adm == null ? null : Math.max(0.05, st.p_adm - 0.2), profile: { name: st.name, level: st.level, field: ["it"], countries: ["de", "hu"], pro_until: D.ws.ends_on, updated_at: st.cab_last_active },
          apps: D.apps.filter(function (a) { return a.student_id === sid; }).map(function (a) { return { name: a.name, country: a.country, status: a.status === "applied" ? "sent" : "plan", submitted_at: a.status === "applied" || a.status === "admit" ? a.updated_at : null, outcome: a.status === "admit" ? "admit" : null, deadline: a.deadline, url: a.apply_url, readiness: 0.6 }; }),
          docs: D.docs.filter(function (x) { return x.student_id === sid; }).map(function (x) { return { doc_type: x.doc_type, title: x.title, status: x.status, file_name: x.file_name, updated_at: x.updated_at }; }) });
      },
      programs: function () { return ok(D.programs); },
      students: {
        add: function (o) { if (D.students.length >= D.ws.seats) return Promise.resolve({ data: null, error: { message: "seats_full" } }); var row = Object.assign({ id: "demo-n" + (D.nid++), linked: false, user_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, o); D.students.push(row); return ok(row); },
        update: function (id, patch) { var st = D.students.filter(function (x) { return x.id === id; })[0]; if (st) Object.assign(st, patch, { updated_at: new Date().toISOString() }); return ok(st); },
        remove: function (id) { D.students = D.students.filter(function (x) { return x.id !== id; }); ["apps", "docs", "notes"].forEach(function (k) { D[k] = D[k].filter(function (x) { return x.student_id !== id; }); }); return ok(true); }
      },
      apps: table(D.apps), docs: table(D.docs), notes: table(D.notes),
      upload: function (sid, file) { return ok({ path: "demo", name: file.name }); },
      fileUrl: function () { return ok(null); },
      regen: function () { D.ws.invite_code = "DEMO" + Math.random().toString(36).slice(2, 6).toUpperCase(); return ok({ ok: true, invite_code: D.ws.invite_code }); }
    };
    sb = { auth: {
      getSession: function () { return Promise.resolve({ data: { session: { user: { id: "demo", email: "demo@scholary.kz" } } } }); },
      onAuthStateChange: function (cb) { setTimeout(function () { cb("SIGNED_IN", { user: { id: "demo", email: "demo@scholary.kz" } }); }, 10); return { data: { subscription: { unsubscribe: function () {} } } }; },
      signOut: function () { return Promise.resolve({}); }, signInWithOAuth: function () { return Promise.resolve({}); }, signInWithPassword: function () { return Promise.resolve({}); }, signUp: function () { return Promise.resolve({}); }, resetPasswordForEmail: function () { return Promise.resolve({}); }
    } };
    $("demoBar").hidden = false;
    document.title = "Демо workspace профориентолога — Scholary";
  } else {
    var tbl = function (name) {
      return {
        list: function (sid) { return sb.from(name).select("*").eq("student_id", sid).order("created_at", { ascending: name === "ws_notes" ? false : true }).order("id", { ascending: true }); },
        add: function (o) { return sb.from(name).insert(o).select().single(); },
        update: function (id, patch) { patch = Object.assign({}, patch, { updated_at: new Date().toISOString() }); if (name === "ws_notes") delete patch.updated_at; return sb.from(name).update(patch).eq("id", id).select().single(); },
        remove: function (id) { return sb.from(name).delete().eq("id", id); }
      };
    };
    DB = {
      claim: function (t) { return sb.rpc("school_claim", { p_token: t }); },
      mine: function () { return sb.rpc("school_mine"); },
      roster: function () { return sb.rpc("ws_roster"); },
      today: function () { return sb.rpc("ws_today"); },
      cabinet: function (sid) { return sb.rpc("ws_student_cabinet", { p_student: sid }); },
      programs: function () { return sb.from("programs_public").select("id,name,country,cc,levels,funding,deadline_md,source_url").order("name"); },
      students: {
        add: function (o) { return sb.from("ws_students").insert(Object.assign({ school_id: S.ws.id }, o)).select().single(); },
        update: function (id, patch) { return sb.from("ws_students").update(Object.assign({}, patch, { updated_at: new Date().toISOString() })).eq("id", id).select().single(); },
        remove: function (id) { return sb.from("ws_students").delete().eq("id", id); }
      },
      apps: tbl("ws_apps"), docs: tbl("ws_docs"), notes: tbl("ws_notes"),
      upload: function (sid, file) {
        var safe = String(file.name || "file").replace(/[^\w.\-а-яА-ЯёЁ]+/g, "_").slice(-80);
        var path = S.session.user.id + "/ws/" + sid + "/" + Date.now() + "-" + safe;
        return sb.storage.from("docs").upload(path, file, { upsert: true, contentType: file.type || "application/octet-stream" }).then(function (r) { return r.error ? r : { data: { path: path, name: file.name }, error: null }; });
      },
      fileUrl: function (path) { return sb.storage.from("docs").createSignedUrl(path, 600).then(function (r) { return { data: r.data && r.data.signedUrl, error: r.error }; }); },
      regen: function () { return sb.rpc("school_regen_code"); }
    };
  }

  /* ---------- вход ---------- */
  function authView(w) { $("f-login").hidden = w !== "login"; $("f-signup").hidden = w !== "signup"; $("f-forgot").hidden = w !== "forgot"; }
  function authErr(id, err) {
    var el = $(id), m = (err && err.message) || "Что-то пошло не так";
    if (/Invalid login credentials/i.test(m)) m = "Неверная почта или пароль";
    if (/already registered/i.test(m)) m = "Такой аккаунт уже есть — войдите";
    if (/rate limit/i.test(m)) m = "Слишком много попыток — подождите минуту";
    el.textContent = m; el.hidden = false;
  }
  $("lnk-signup").onclick = function (e) { e.preventDefault(); authView("signup"); };
  $("lnk-login").onclick = function (e) { e.preventDefault(); authView("login"); };
  $("lnk-login2").onclick = function (e) { e.preventDefault(); authView("login"); };
  $("lnk-forgot").onclick = function (e) { e.preventDefault(); authView("forgot"); };
  $("btn-google").onclick = function () {
    var claim = qs("claim");
    try { localStorage.setItem("scholary_next", "/counselors/cabinet/" + (claim ? "?claim=" + encodeURIComponent(claim) : "")); } catch (e) {}
    sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + "/cabinet/" } })
      .then(function (r) { if (r.error) authErr("li-err", { message: "Google-вход недоступен — войдите по почте" }); });
  };
  $("f-login").onsubmit = function (e) {
    e.preventDefault(); $("li-err").hidden = true;
    sb.auth.signInWithPassword({ email: $("li-email").value.trim(), password: $("li-pass").value }).then(function (r) { if (r.error) authErr("li-err", r.error); });
  };
  $("f-signup").onsubmit = function (e) {
    e.preventDefault(); $("su-err").hidden = true;
    sb.auth.signUp({ email: $("su-email").value.trim(), password: $("su-pass").value, options: { data: { name: $("su-name").value.trim() } } }).then(function (r) {
      if (r.error) { authErr("su-err", r.error); return; }
      if (!r.data || !r.data.session) { var el = $("su-err"); el.textContent = "Письмо с подтверждением отправлено на " + $("su-email").value.trim() + " — откройте ссылку из него и вернитесь сюда по ссылке из письма «доступ открыт»."; el.style.color = "#187E54"; el.hidden = false; }
    });
  };
  $("f-forgot").onsubmit = function (e) {
    e.preventDefault(); $("fg-err").hidden = true;
    sb.auth.resetPasswordForEmail($("fg-email").value.trim(), { redirectTo: location.origin + "/cabinet/" }).then(function (r) { if (r.error) { authErr("fg-err", r.error); return; } $("fg-ok").hidden = false; });
  };
  function out() { if (S.demo) { location.href = "/counselors/"; return; } sb.auth.signOut().then(function () { location.href = "/counselors/cabinet/"; }); }
  $("btn-out").onclick = out; $("btn-out2").onclick = out;

  /* ---------- вход в workspace ---------- */
  function enter() {
    if (S.entering) return; S.entering = true; show("loading");
    var claim = qs("claim");
    var p = claim ? DB.claim(claim).then(function (r) {
      var j = r.data;
      if (j && j.ok) { track("ws_claim_ok"); history.replaceState(null, "", "/counselors/cabinet/" + location.hash); toast("Workspace «" + j.name + "» привязан к вашему аккаунту", "ok"); }
      else if (j && j.why === "taken") toast("Этот workspace уже привязан к другому аккаунту — войдите им или напишите нам", "bad");
      else if (j && j.why === "not_found") toast("Ссылка привязки не найдена — откройте актуальное письмо", "bad");
    }) : Promise.resolve();
    p.then(function () { return DB.mine(); }).then(function (r) {
      S.entering = false;
      S.ws = r.data || null;
      if (!S.ws || S.ws.kind !== "counselor") {
        if (S.ws && S.ws.kind !== "counselor") { location.replace("/schools/cabinet/"); return; }
        $("noneEmail").textContent = (S.session && S.session.user.email) || "";
        show("v-none"); track("ws_none"); return;
      }
      show("v-app"); track("ws_open");
      if (!location.hash || location.hash === "#/") location.replace("#/today");
      render();
    });
  }

  /* ---------- роутер ---------- */
  function route() { var h = location.hash.replace(/^#\/?/, ""); var m = h.match(/^s\/([\w-]+)(?:\/(\w+))?/); if (m) return { t: "student", id: m[1], tab: m[2] || "apps" }; return { t: ["today", "students", "settings"].indexOf(h) >= 0 ? h : "today" }; }
  window.addEventListener("hashchange", function () { if (S.ws) render(); });
  function render() {
    var r = route();
    document.querySelectorAll("#tabs a").forEach(function (a) { a.classList.toggle("on", a.getAttribute("data-t") === (r.t === "student" ? "students" : r.t)); });
    closeModal(); window.scrollTo(0, 0);
    if (r.t === "today") viewToday();
    else if (r.t === "students") viewStudents();
    else if (r.t === "student") viewStudent(r.id, r.tab);
    else viewSettings();
  }
  function loadRoster() { return DB.roster().then(function (r) { if (r.error) { fail(r, "Не удалось загрузить учеников"); return []; } S.roster = r.data || []; return S.roster; }); }

  /* ---------- Сегодня ---------- */
  function viewToday() {
    var v = $("view");
    v.innerHTML = '<div class="head"><div><div class="h1">Сегодня</div><div class="sm mut" id="todaySub">Собираю, что горит…</div></div><div class="tools" style="margin:0"><button class="btn btn-primary btn-sm" id="btn-add">+ Ученик</button></div></div><div id="todayBody"><div class="spin"></div></div>';
    $("btn-add").onclick = addStudentModal;
    Promise.all([DB.today(), loadRoster()]).then(function (rs) {
      var t = rs[0].data || { deadlines: [], tasks: [], missing_docs: [] }; S.today = t;
      var n = S.roster.length, dl = t.deadlines.length, tk = t.tasks.length, md = t.missing_docs.length;
      var idle = S.roster.filter(function (s) { return s.stage !== "admitted" && s.stage !== "paused" && (daysAgo(s.last_note) == null || daysAgo(s.last_note) >= 14); }).length;
      $("todaySub").textContent = fmtDL(new Date()) + " · " + n + " " + plural(n, "ученик", "ученика", "учеников") + (S.ws.ends_on ? " · доступ до " + fmtDL(S.ws.ends_on) : "");
      var h = '<div class="kpis">' +
        '<a class="card kpi' + (dl ? " bad" : "") + '" href="#/students"><div class="n">' + dl + '</div><div class="l">' + plural(dl, "дедлайн", "дедлайна", "дедлайнов") + " в 45 дней</div></a>" +
        '<a class="card kpi' + (tk ? " warn" : "") + '" href="#/today"><div class="n">' + tk + '</div><div class="l">' + plural(tk, "открытая задача", "открытые задачи", "открытых задач") + "</div></a>" +
        '<a class="card kpi' + (md ? " warn" : "") + '" href="#/students"><div class="n">' + md + '</div><div class="l">' + plural(md, "ученик", "ученика", "учеников") + " без документов</div></a>" +
        '<a class="card kpi" href="#/students"><div class="n">' + idle + '</div><div class="l">без заметок 14+ дней</div></a></div>';
      if (!n) {
        h += '<div class="card glow"><div class="h2">С чего начать</div><p class="sm mut" style="margin:4px 0 12px">Workspace пустой — три шага, и он начнёт работать на вас.</p>' +
          '<div class="lst"><span class="pill pill-acc">1</span><div class="t"><b>Добавьте первого ученика</b><span class="xs mut">Имя и класс — остальное заполните по ходу</span></div><button class="btn btn-primary btn-sm" id="ob-add">Добавить</button></div>' +
          '<div class="lst"><span class="pill pill-acc">2</span><div class="t"><b>Отправьте ему ссылку на регистрацию</b><span class="xs mut">Ученик получит Scholary Pro, а вы — его шансы и кабинет</span></div><a class="btn btn-ghost btn-sm" href="#/settings">Ссылка</a></div>' +
          '<div class="lst"><span class="pill pill-acc">3</span><div class="t"><b>Добавьте программы и дедлайны</b><span class="xs mut">Из каталога 97 программ или свою — дальше «Сегодня» само покажет, что горит</span></div></div></div>';
        $("todayBody").innerHTML = h; $("ob-add").onclick = addStudentModal; return;
      }
      h += '<div class="cols"><div>';
      h += '<div class="card"><div class="h2">Дедлайны — 45 дней</div>' + (dl ? t.deadlines.map(function (x) {
        return '<div class="lst"><div class="t"><b><a href="#/s/' + x.student_id + '/apps" style="color:inherit">' + esc(x.student) + '</a></b><span class="xs mut">' + esc(x.name) + (x.country ? " · " + esc(x.country) : "") + " · " + esc(APP_L[x.status] || x.status) + "</span></div>" + dlPill(x.deadline) + (safeUrl(x.url) ? '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="' + esc(safeUrl(x.url)) + '">Подать</a>' : "") + "</div>";
      }).join("") : '<div class="empty">Ближайших дедлайнов нет. Добавляйте программы ученикам — здесь появится всё, что ближе 45 дней.</div>') + "</div>";
      h += '<div class="card" style="margin-top:14px"><div class="h2">Нет документов</div><div class="xs mut" style="margin-bottom:6px">Ученики на этапах «Документы» и «Подача», у кого чек-лист не закрыт</div>' + (md ? t.missing_docs.map(function (x) {
        return '<div class="lst"><div class="t"><b><a href="#/s/' + x.student_id + '/docs" style="color:inherit">' + esc(x.student) + "</a></b></div><span class=\"pill pill-warn\">" + x.missing + " " + plural(x.missing, "документ", "документа", "документов") + "</span></div>";
      }).join("") : '<div class="empty">У всех, кто на этапе документов, чек-лист закрыт.</div>') + "</div></div>";
      h += '<div><div class="card"><div class="h2">Задачи</div>' + (tk ? t.tasks.map(function (x) {
        var d = daysTo(x.due_on);
        return '<label class="lst" style="cursor:pointer"><input type="checkbox" data-task="' + x.id + '" style="width:20px;height:20px"><div class="t"><b>' + esc(x.text) + '</b><span class="xs mut"><a href="#/s/' + x.student_id + '/notes">' + esc(x.student) + "</a>" + (x.due_on ? " · " + (d < 0 ? '<span style="color:var(--bad);font-weight:700">просрочено ' + fmtD(x.due_on) + "</span>" : d === 0 ? "сегодня" : "до " + fmtD(x.due_on)) : "") + "</span></div></label>";
      }).join("") : '<div class="empty">Открытых задач нет. Задачи создаются на странице ученика во вкладке «Заметки».</div>') + "</div>";
      var risky = S.roster.filter(function (s) { return s.stage !== "admitted" && s.stage !== "paused" && (daysAgo(s.last_note) == null || daysAgo(s.last_note) >= 14); }).slice(0, 8);
      h += '<div class="card" style="margin-top:14px"><div class="h2">Давно не касались</div><div class="xs mut" style="margin-bottom:6px">Без заметок 14+ дней — самое время позвонить</div>' + (risky.length ? risky.map(function (s) {
        var a = daysAgo(s.last_note);
        return '<div class="lst"><div class="t"><b><a href="#/s/' + s.id + '/notes" style="color:inherit">' + esc(s.name) + "</a></b><span class=\"xs mut\">" + esc(STAGE_L[s.stage]) + (s.target ? " · " + esc(s.target) : "") + "</span></div><span class=\"pill pill-mut\">" + (a == null ? "заметок нет" : a + " " + plural(a, "день", "дня", "дней")) + "</span></div>";
      }).join("") : '<div class="empty">Все ученики с касанием за две недели.</div>') + "</div></div></div>";
      $("todayBody").innerHTML = h;
      $("todayBody").addEventListener("change", function (e) {
        var cb = e.target.closest("[data-task]"); if (!cb) return;
        DB.notes.update(cb.getAttribute("data-task"), { done: true }).then(function (r) { if (r.error) { fail(r); cb.checked = false; return; } toast("Задача закрыта", "ok"); var row = cb.closest(".lst"); row.style.opacity = ".4"; track("ws_task_done"); });
      });
    });
  }

  /* ---------- Ученики ---------- */
  function viewStudents() {
    var v = $("view");
    v.innerHTML = '<div class="head"><div><div class="h1">Ученики</div><div class="sm mut" id="stSub">Загружаю…</div></div><div class="tools" style="margin:0"><button class="btn btn-ghost btn-sm" id="btn-csv">CSV</button><button class="btn btn-primary btn-sm" id="btn-add">+ Ученик</button></div></div>' +
      '<div class="chips" id="chips"></div><div class="tools" style="margin:0 0 10px"><input class="f" id="q" placeholder="Поиск по имени, цели, почте" value="' + esc(S.q) + '"></div><div class="card" id="list"><div class="spin"></div></div>';
    $("btn-add").onclick = addStudentModal;
    $("q").addEventListener("input", function () { S.q = $("q").value.trim(); drawList(); });
    $("chips").addEventListener("click", function (e) { var b = e.target.closest(".chip"); if (!b) return; S.stage = b.getAttribute("data-st") || ""; drawChips(); drawList(); });
    $("btn-csv").onclick = exportCsv;
    $("list").addEventListener("click", function (e) {
      if (e.target.closest("select,a,button")) return;
      var tr = e.target.closest("tr.row"); if (tr) location.hash = "#/s/" + tr.getAttribute("data-id");
    });
    $("list").addEventListener("change", function (e) {
      var s = e.target.closest("select[data-stage]"); if (!s) return;
      var id = s.getAttribute("data-stage"), st = S.roster.filter(function (x) { return x.id === id; })[0];
      DB.students.update(id, { stage: s.value }).then(function (r) { if (r.error) { fail(r); return; } if (st) st.stage = s.value; s.className = "stage-sel stage-" + s.value; drawChips(); toast("Этап обновлён", "ok"); track("ws_stage", { stage: s.value }); });
    });
    loadRoster().then(function () { drawChips(); drawList(); });
  }
  function drawChips() {
    var cnt = {}; S.roster.forEach(function (s) { cnt[s.stage] = (cnt[s.stage] || 0) + 1; });
    var h = '<button class="chip' + (!S.stage ? " on" : "") + '" data-st="">Все · ' + S.roster.length + "</button>";
    STAGES.forEach(function (s) { if (cnt[s[0]]) h += '<button class="chip' + (S.stage === s[0] ? " on" : "") + '" data-st="' + s[0] + '">' + s[1] + " · " + cnt[s[0]] + "</button>"; });
    $("chips").innerHTML = h;
  }
  function filtered() {
    var q = S.q.toLowerCase();
    return S.roster.filter(function (s) {
      if (S.stage && s.stage !== S.stage) return false;
      if (q && [s.name, s.target, s.email, s.phone, s.parent_name].join(" ").toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) {
      var da = daysTo(a.ws_next_deadline), db = daysTo(b.ws_next_deadline);
      if (da != null && db != null && da !== db) return da - db;
      if ((da == null) !== (db == null)) return da == null ? 1 : -1;
      return String(a.name).localeCompare(String(b.name), "ru");
    });
  }
  function drawList() {
    var rows = filtered(), n = S.roster.length;
    $("stSub").textContent = n ? n + " " + plural(n, "ученик", "ученика", "учеников") + " · показано " + rows.length + " · мест " + S.ws.seats : "Пока пусто — добавьте первого ученика";
    if (!n) { $("list").innerHTML = '<div class="empty">Ученики появятся здесь: добавьте карточку вручную или отправьте ссылку на регистрацию — зарегистрировавшиеся привяжутся по почте сами.</div>'; return; }
    if (!rows.length) { $("list").innerHTML = '<div class="empty">Никого не нашли по этому фильтру.</div>'; return; }
    var h = '<table class="r"><tr><th>Ученик</th><th>Этап</th><th>Подачи · документы · дедлайн</th><th>Задачи</th><th>Последняя заметка</th></tr>';
    rows.forEach(function (s) {
      var p = s.p_adm == null ? null : Math.round(Number(s.p_adm) * 100), lastN = daysAgo(s.last_note);
      h += '<tr class="row" data-id="' + esc(s.id) + '"><td><div class="name">' + esc(s.name) + (s.linked ? ' <span class="pill pill-ok" title="Зарегистрирован в Scholary">●</span>' : "") + '</div><div class="sub">' + esc(GRADE_L[s.grade] || "") + (s.target ? " · " + esc(s.target) : "") + (p != null ? " · " + p + "% шанс" : "") + "</div></td>" +
        "<td>" + sel("stage", STAGES, s.stage, "stage-sel stage-" + s.stage).replace('name="stage"', 'name="stage" data-stage="' + esc(s.id) + '"') + "</td>" +
        "<td><span class=\"sub\">" + (s.ws_apps_sent || 0) + "/" + (s.ws_apps || 0) + " подач · " + (s.ws_docs_ready || 0) + "/" + (s.ws_docs || 0) + " док.</span> " + (s.ws_next_deadline ? dlPill(s.ws_next_deadline) : "") + (Number(s.ws_offers) ? ' <span class="pill pill-ok">' + s.ws_offers + " " + plural(s.ws_offers, "оффер", "оффера", "офферов") + "</span>" : "") + "</td>" +
        "<td>" + (s.tasks_open ? '<span class="pill ' + (daysTo(s.task_due) != null && daysTo(s.task_due) < 0 ? "pill-bad" : "pill-warn") + '">' + s.tasks_open + (s.task_due ? " · до " + fmtD(s.task_due) : "") + "</span>" : '<span class="sub">—</span>') + "</td>" +
        '<td class="sub">' + (lastN == null ? "—" : lastN === 0 ? "сегодня" : lastN === 1 ? "вчера" : (lastN >= 14 ? '<span style="color:var(--warn);font-weight:650">' : "") + lastN + " " + plural(lastN, "день", "дня", "дней") + " назад" + (lastN >= 14 ? "</span>" : "")) + "</td></tr>";
    });
    $("list").innerHTML = h + "</table>";
  }
  function exportCsv() {
    var rows = filtered();
    var head = ["Ученик", "Класс", "Этап", "Цель", "Телефон", "Email", "Родитель", "Телефон родителя", "Зарегистрирован в Scholary", "Шанс %", "Подач отправлено", "Подач всего", "Документов готово", "Документов всего", "Офферов", "Ближайший дедлайн", "Открытых задач", "Последняя заметка"];
    var lines = [head.join(";")].concat(rows.map(function (s) {
      return [s.name, GRADE_L[s.grade] || "", STAGE_L[s.stage] || "", s.target, s.phone, s.email, s.parent_name, s.parent_phone, s.linked ? "да" : "нет", s.p_adm == null ? "" : Math.round(Number(s.p_adm) * 100), s.ws_apps_sent || 0, s.ws_apps || 0, s.ws_docs_ready || 0, s.ws_docs || 0, s.ws_offers || 0, s.ws_next_deadline || "", s.tasks_open || 0, s.last_note ? String(s.last_note).slice(0, 10) : ""]
        .map(function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; }).join(";");
    }));
    var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "scholary-workspace.csv";
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    track("ws_csv");
  }

  /* ---------- карточка ученика: форма ---------- */
  function studentForm(s) {
    s = s || {};
    return '<div class="grid2"><div><label class="fl">Имя и фамилия *</label><input class="f" name="name" required maxlength="80" value="' + esc(s.name) + '" placeholder="Айгерим Сериккызы"></div>' +
      '<div><label class="fl">Класс</label>' + sel("grade", GRADES, s.grade || "11") + "</div>" +
      '<div><label class="fl">Уровень</label>' + sel("level", LEVELS, s.level || "bachelor") + "</div>" +
      '<div><label class="fl">Этап</label>' + sel("stage", STAGES, s.stage || "intake") + "</div>" +
      '<div><label class="fl">Телефон ученика</label><input class="f" name="phone" inputmode="tel" maxlength="24" value="' + esc(s.phone) + '" placeholder="+7 7__ ___ __ __"></div>' +
      '<div><label class="fl">Email ученика</label><input class="f" name="email" type="email" maxlength="120" value="' + esc(s.email) + '" placeholder="student@gmail.com"><div class="xs mut" style="margin-top:4px">По этой почте карточка свяжется с его аккаунтом Scholary</div></div>' +
      '<div><label class="fl">Родитель</label><input class="f" name="parent_name" maxlength="80" value="' + esc(s.parent_name) + '" placeholder="Мама, Гульнара"></div>' +
      '<div><label class="fl">Телефон родителя</label><input class="f" name="parent_phone" inputmode="tel" maxlength="24" value="' + esc(s.parent_phone) + '"></div></div>' +
      '<label class="fl">Цель</label><input class="f" name="target" maxlength="120" value="' + esc(s.target) + '" placeholder="Германия/Венгрия · IT">' +
      '<label class="fl">Что важно помнить</label><textarea class="f" name="note" maxlength="1000" placeholder="Кто главный контакт в семье, ограничения, договорённости">' + esc(s.note) + "</textarea>";
  }
  function cleanStudent(o) { var out = {}; ["name", "grade", "level", "stage", "phone", "email", "parent_name", "parent_phone", "target", "note"].forEach(function (k) { out[k] = o[k] === "" ? null : o[k]; }); if (out.email) out.email = out.email.toLowerCase(); return out; }
  function addStudentModal() {
    if (S.ws.used >= S.ws.seats) { toast("Места по тарифу закончились (" + S.ws.seats + ") — расширьте тариф в «Ссылка и тариф»", "bad"); return; }
    openModal('<div class="h2">Новый ученик</div><div class="xs mut">Занято ' + S.ws.used + " из " + S.ws.seats + ' мест</div><form id="f-st">' + studentForm() + '<div class="tools"><button class="btn btn-primary" type="submit">Добавить</button><button class="btn btn-ghost" type="button" data-close>Отмена</button></div></form>', function (m) {
      m.querySelector("#f-st").onsubmit = function (e) {
        e.preventDefault(); var b = m.querySelector("[type=submit]"); b.disabled = true;
        DB.students.add(cleanStudent(formData(e.target))).then(function (r) {
          b.disabled = false; if (r.error || !r.data) { fail(r, "Не удалось добавить"); return; }
          S.ws.used = (S.ws.used || 0) + 1; closeModal(); toast("Ученик добавлен", "ok"); track("ws_student_add"); location.hash = "#/s/" + r.data.id;
        });
      };
    });
  }
  function editStudentModal(s) {
    openModal('<div class="h2">Карточка ученика</div><form id="f-st">' + studentForm(s) + '<div class="tools"><button class="btn btn-primary" type="submit">Сохранить</button><button class="btn btn-ghost" type="button" data-close>Отмена</button><button class="btn btn-danger btn-sm" type="button" id="st-del" style="margin-left:auto">Удалить</button></div><div class="xs mut" id="del-hint" hidden style="margin-top:8px">Удалятся подачи, документы и заметки этого ученика. Нажмите «Удалить» ещё раз, чтобы подтвердить.</div></form>', function (m) {
      m.querySelector("#f-st").onsubmit = function (e) {
        e.preventDefault(); var b = m.querySelector("[type=submit]"); b.disabled = true;
        DB.students.update(s.id, cleanStudent(formData(e.target))).then(function (r) { b.disabled = false; if (r.error) { fail(r, "Не сохранилось"); return; } if (r.data) Object.assign(s, r.data); closeModal(); toast("Сохранено", "ok"); render(); });
      };
      var del = m.querySelector("#st-del");
      del.onclick = function () {
        if (!del.getAttribute("data-armed")) { del.setAttribute("data-armed", "1"); m.querySelector("#del-hint").hidden = false; del.textContent = "Точно удалить"; return; }
        DB.students.remove(s.id).then(function (r) { if (r.error) { fail(r, "Не удалилось"); return; } S.ws.used = Math.max(0, (S.ws.used || 1) - 1); closeModal(); toast("Ученик удалён — место освободилось", "ok"); track("ws_student_del"); location.hash = "#/students"; });
      };
    });
  }

  /* ---------- страница ученика ---------- */
  function viewStudent(id, tab) {
    var v = $("view"); S.tab = tab;
    var go = function (s) {
      S.cur = s;
      var p = s.p_adm == null ? null : Math.round(Number(s.p_adm) * 100);
      v.innerHTML = '<a class="back" href="#/students">← Ученики</a>' +
        '<div class="head"><div><div class="h1">' + esc(s.name) + (s.linked ? ' <span class="pill pill-ok">в Scholary</span>' : ' <span class="pill pill-mut">не зарегистрирован</span>') + '</div><div class="sm mut">' + esc(GRADE_L[s.grade] || "") + " · " + esc(LEVEL_L[s.level] || "") + (s.target ? " · " + esc(s.target) : "") + (p != null ? " · шанс " + p + "%" : "") + "</div></div>" +
        '<div class="tools" style="margin:0"><select class="stage-sel stage-' + esc(s.stage) + '" id="st-stage">' + STAGES.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === s.stage ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") + '</select><button class="btn btn-ghost btn-sm" id="st-edit">Карточка</button>' + (s.phone ? '<a class="btn btn-ghost btn-sm" href="https://wa.me/' + esc(String(s.phone).replace(/\D/g, "").replace(/^8/, "7")) + '" target="_blank" rel="noopener">WhatsApp</a>' : "") + "</div></div>" +
        (s.note ? '<div class="note" style="margin-top:10px"><span class="k">Важно</span><div>' + esc(s.note) + "</div></div>" : "") +
        '<div class="stabs" id="stabs">' + [["apps", "Подачи"], ["docs", "Документы"], ["notes", "Заметки"], ["cab", "Кабинет ученика"], ["info", "Контакты"]].map(function (t) { return '<button data-tab="' + t[0] + '"' + (t[0] === tab ? ' class="on"' : "") + ">" + t[1] + "</button>"; }).join("") + "</div>" +
        '<div id="stBody"><div class="spin"></div></div>';
      $("st-edit").onclick = function () { editStudentModal(s); };
      $("st-stage").onchange = function () { var val = this.value, el = this; DB.students.update(s.id, { stage: val }).then(function (r) { if (r.error) { fail(r); return; } s.stage = val; el.className = "stage-sel stage-" + val; toast("Этап: " + STAGE_L[val], "ok"); track("ws_stage", { stage: val }); }); };
      $("stabs").onclick = function (e) { var b = e.target.closest("[data-tab]"); if (!b) return; location.hash = "#/s/" + s.id + "/" + b.getAttribute("data-tab"); };
      if (tab === "apps") tabApps(s); else if (tab === "docs") tabDocs(s); else if (tab === "notes") tabNotes(s); else if (tab === "cab") tabCab(s); else tabInfo(s);
    };
    var s = S.roster.filter(function (x) { return x.id === id; })[0];
    if (s) go(s); else loadRoster().then(function () { var s2 = S.roster.filter(function (x) { return x.id === id; })[0]; if (s2) go(s2); else v.innerHTML = '<a class="back" href="#/students">← Ученики</a><div class="card"><div class="h2">Ученик не найден</div><div class="sm mut">Возможно, карточка удалена.</div></div>'; });
  }

  /* --- вкладка Подачи --- */
  function tabApps(s) {
    var body = $("stBody");
    DB.apps.list(s.id).then(function (r) {
      if (r.error) { body.innerHTML = '<div class="card empty">' + esc(r.error.message) + "</div>"; return; }
      var apps = (r.data || []).slice().sort(function (a, b) { var da = a.deadline || "9999", db = b.deadline || "9999"; return da < db ? -1 : da > db ? 1 : 0; });
      var h = '<div class="card"><div class="head" style="margin:0 0 6px"><div><div class="h2">Программы и подачи</div><div class="xs mut">Точная ссылка на подачу и дедлайн — у каждой программы</div></div><button class="btn btn-primary btn-sm" id="app-add">+ Программа</button></div>';
      if (!apps.length) h += '<div class="empty">Пока нет ни одной программы. Добавьте из каталога Scholary (97 программ с проверенными ссылками) или свою.</div>';
      apps.forEach(function (a) {
        var done = a.status === "admit" || a.status === "reject" || a.status === "applied" || a.status === "waitlist", url = safeUrl(a.apply_url);
        h += '<div class="lst" data-app="' + a.id + '"><div class="t"><b>' + esc(a.name) + '</b><span class="xs mut">' + esc(a.country || "") + (a.note ? " · " + esc(a.note) : "") + "</span>" + (url ? '<a class="xs" target="_blank" rel="noopener" href="' + esc(url) + '">' + esc(url.replace(/^https?:\/\//, "").slice(0, 60)) + "</a>" : "") + "</div>" + dlPill(a.deadline, done) +
          '<select class="stage-sel" data-appst="' + a.id + '">' + APP_ST.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === a.status ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") + "</select>" +
          '<button class="btn btn-ghost btn-sm" data-appedit="' + a.id + '" aria-label="Изменить">✎</button></div>';
      });
      body.innerHTML = h + "</div>";
      $("app-add").onclick = function () { appModal(s, null); };
      body.onclick = function (e) { var b = e.target.closest("[data-appedit]"); if (!b) return; appModal(s, apps.filter(function (x) { return String(x.id) === b.getAttribute("data-appedit"); })[0]); };
      body.onchange = function (e) {
        var sl = e.target.closest("[data-appst]"); if (!sl) return;
        DB.apps.update(sl.getAttribute("data-appst"), { status: sl.value }).then(function (r2) { if (r2.error) { fail(r2); return; } toast("Статус: " + APP_L[sl.value], "ok"); track("ws_app_status", { status: sl.value }); if (sl.value === "admit") tabApps(s); });
      };
    });
  }
  function loadPrograms() { if (S.programs) return Promise.resolve(S.programs); return DB.programs().then(function (r) { S.programs = r.data || []; return S.programs; }); }
  function appModal(s, a) {
    a = a || {};
    openModal('<div class="h2">' + (a.id ? "Программа" : "Добавить программу") + '</div>' +
      (a.id ? "" : '<label class="fl">Из каталога Scholary</label><input class="f" id="pk-q" placeholder="Начните вводить: страна, университет, стипендия"><div class="pick" id="pk" hidden></div><div class="xs mut" style="margin-top:6px">Или заполните свою программу ниже</div>') +
      '<form id="f-app"><input type="hidden" name="program_id" value="' + esc(a.program_id) + '"><label class="fl">Название *</label><input class="f" name="name" required maxlength="160" value="' + esc(a.name) + '" placeholder="Stipendium Hungaricum — BSc Computer Science">' +
      '<div class="grid2"><div><label class="fl">Страна</label><input class="f" name="country" maxlength="60" value="' + esc(a.country) + '"></div><div><label class="fl">Дедлайн</label><input class="f" name="deadline" type="date" value="' + esc(a.deadline || "") + '"></div></div>' +
      '<label class="fl">Ссылка на подачу</label><input class="f" name="apply_url" type="url" maxlength="500" value="' + esc(a.apply_url) + '" placeholder="https://…"><label class="fl">Статус</label>' + sel("status", APP_ST, a.status || "study") +
      '<label class="fl">Заметка</label><input class="f" name="note" maxlength="300" value="' + esc(a.note) + '" placeholder="Нужен IELTS 6.5, подача через портал">' +
      '<div class="tools"><button class="btn btn-primary" type="submit">' + (a.id ? "Сохранить" : "Добавить") + '</button><button class="btn btn-ghost" type="button" data-close>Отмена</button>' + (a.id ? '<button class="btn btn-danger btn-sm" type="button" id="app-del" style="margin-left:auto">Удалить</button>' : "") + "</div></form>", function (m) {
      var f = m.querySelector("#f-app");
      if (!a.id) {
        var q = m.querySelector("#pk-q"), pk = m.querySelector("#pk");
        q.addEventListener("input", function () {
          var t = q.value.trim().toLowerCase(); if (t.length < 2) { pk.hidden = true; return; }
          loadPrograms().then(function (ps) {
            var hits = ps.filter(function (p) { return (p.name + " " + p.country + " " + (CC[p.cc] || "")).toLowerCase().indexOf(t) >= 0; }).slice(0, 12);
            pk.innerHTML = hits.length ? hits.map(function (p) { return '<div data-pid="' + esc(p.id) + '">' + esc(p.name) + "<small>" + esc(CC[p.cc] || p.country || "") + (p.deadline_md ? " · дедлайн " + fmtD(nextMD(p.deadline_md)) : "") + (p.funding === "full" ? " · полная стипендия" : "") + "</small></div>"; }).join("") : '<div><small>Ничего не нашли — заполните свою программу ниже</small></div>';
            pk.hidden = false;
          });
        });
        pk.onclick = function (e) {
          var d = e.target.closest("[data-pid]"); if (!d) return;
          var p = S.programs.filter(function (x) { return x.id === d.getAttribute("data-pid"); })[0]; if (!p) return;
          f.program_id.value = p.id; f.name.value = p.name; f.country.value = CC[p.cc] || p.country || ""; f.deadline.value = nextMD(p.deadline_md) || ""; f.apply_url.value = p.source_url || "";
          pk.hidden = true; q.value = p.name; track("ws_program_pick", { id: p.id });
        };
      }
      f.onsubmit = function (e) {
        e.preventDefault(); var o = formData(f), b = f.querySelector("[type=submit]"); b.disabled = true;
        var row = { name: o.name, country: o.country || null, deadline: o.deadline || null, apply_url: safeUrl(o.apply_url) || null, status: o.status, note: o.note || null, program_id: o.program_id || null };
        (a.id ? DB.apps.update(a.id, row) : DB.apps.add(Object.assign({ student_id: s.id }, row))).then(function (r) { b.disabled = false; if (r.error) { fail(r, "Не сохранилось"); return; } closeModal(); toast(a.id ? "Сохранено" : "Программа добавлена", "ok"); track(a.id ? "ws_app_edit" : "ws_app_add"); tabApps(s); });
      };
      var del = m.querySelector("#app-del");
      if (del) del.onclick = function () { if (!del.getAttribute("data-armed")) { del.setAttribute("data-armed", "1"); del.textContent = "Точно удалить"; return; } DB.apps.remove(a.id).then(function (r) { if (r.error) { fail(r); return; } closeModal(); toast("Удалено", "ok"); tabApps(s); }); };
    });
  }

  /* --- вкладка Документы --- */
  function tabDocs(s) {
    var body = $("stBody");
    DB.docs.list(s.id).then(function (r) {
      if (r.error) { body.innerHTML = '<div class="card empty">' + esc(r.error.message) + "</div>"; return; }
      var docs = r.data || [], ready = docs.filter(function (d) { return d.status === "ready"; }).length;
      var h = '<div class="card"><div class="head" style="margin:0 0 6px"><div><div class="h2">Документы</div><div class="xs mut">' + (docs.length ? "Готово " + ready + " из " + docs.length : "Чек-лист пуст") + '</div></div><div class="tools" style="margin:0">' + (docs.length ? "" : '<button class="btn btn-ghost btn-sm" id="doc-std">Стандартный набор</button>') + '<button class="btn btn-primary btn-sm" id="doc-add">+ Документ</button></div></div>';
      if (docs.length) h += '<div class="bar"><i style="width:' + Math.round(100 * ready / docs.length) + '%"></i></div>';
      if (!docs.length) h += '<div class="empty">Добавьте стандартный набор для поступления за рубеж (паспорт, аттестат, перевод, апостиль, язык, мотивационное, рекомендации, CV) — и отмечайте по мере готовности. Файлы можно прикладывать прямо сюда.</div>';
      docs.forEach(function (d) {
        h += '<div class="doc" data-doc="' + d.id + '"><div><div class="dn">' + esc(d.title || DOC_TYPES[d.doc_type] || d.doc_type) + '</div><div class="df">' + (d.file_name ? '<a href="#" data-file="' + d.id + '">📎 ' + esc(d.file_name) + "</a>" : "файл не приложен") + (d.note ? " · " + esc(d.note) : "") + "</div></div>" +
          '<select class="stage-sel" data-docst="' + d.id + '" style="' + (d.status === "ready" ? "color:var(--ok)" : d.status === "progress" ? "color:var(--warn)" : "") + '">' + DOC_ST.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === d.status ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") + "</select>" +
          '<div class="tools" style="margin:0;gap:6px"><label class="btn btn-ghost btn-sm" style="cursor:pointer">' + (d.file_name ? "Заменить" : "Приложить") + '<input type="file" hidden data-up="' + d.id + '" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"></label><button class="btn btn-ghost btn-sm" data-docedit="' + d.id + '" aria-label="Изменить">✎</button></div></div>';
      });
      body.innerHTML = h + "</div>";
      $("doc-add").onclick = function () { docModal(s, null); };
      var std = $("doc-std");
      if (std) std.onclick = function () {
        std.disabled = true;
        Promise.all(DOC_STD.map(function (t) { return DB.docs.add({ student_id: s.id, doc_type: t, title: DOC_TYPES[t], status: "none" }); })).then(function (rs) { var bad = rs.filter(function (x) { return x.error; })[0]; if (bad) fail(bad, "Не все документы добавились"); else toast("Стандартный набор добавлен — 8 документов", "ok"); track("ws_docs_std"); tabDocs(s); });
      };
      body.onclick = function (e) {
        var b = e.target.closest("[data-docedit]"); if (b) { docModal(s, docs.filter(function (x) { return String(x.id) === b.getAttribute("data-docedit"); })[0]); return; }
        var fl = e.target.closest("[data-file]"); if (fl) {
          e.preventDefault(); var d = docs.filter(function (x) { return String(x.id) === fl.getAttribute("data-file"); })[0];
          if (S.demo) { toast("В демо файлы не открываются", "bad"); return; }
          DB.fileUrl(d.file_path).then(function (r2) { if (r2.error || !r2.data) { fail(r2, "Не удалось открыть файл"); return; } window.open(r2.data, "_blank", "noopener"); });
        }
      };
      body.onchange = function (e) {
        var sl = e.target.closest("[data-docst]");
        if (sl) { DB.docs.update(sl.getAttribute("data-docst"), { status: sl.value }).then(function (r2) { if (r2.error) { fail(r2); return; } toast(DOC_L[sl.value], "ok"); track("ws_doc_status", { status: sl.value }); tabDocs(s); }); return; }
        var up = e.target.closest("[data-up]");
        if (up && up.files && up.files[0]) {
          var file = up.files[0], id = up.getAttribute("data-up");
          if (file.size > 15 * 1024 * 1024) { toast("Файл больше 15 МБ", "bad"); return; }
          toast("Загружаю…");
          DB.upload(s.id, file).then(function (r2) {
            if (r2.error) { fail(r2, "Файл не загрузился"); return; }
            return DB.docs.update(id, { file_path: r2.data.path, file_name: r2.data.name, status: "ready" }).then(function (r3) { if (r3.error) { fail(r3); return; } toast("Файл приложен — статус «Готов»", "ok"); track("ws_doc_upload"); tabDocs(s); });
          });
        }
      };
    });
  }
  function docModal(s, d) {
    d = d || {};
    var types = Object.keys(DOC_TYPES).map(function (k) { return [k, DOC_TYPES[k]]; });
    openModal('<div class="h2">' + (d.id ? "Документ" : "Добавить документ") + '</div><form id="f-doc"><label class="fl">Тип</label>' + sel("doc_type", types, d.doc_type || "passport") +
      '<label class="fl">Название (если нужно уточнить)</label><input class="f" name="title" maxlength="120" value="' + esc(d.title) + '" placeholder="Например: рекомендация от учителя физики">' +
      '<label class="fl">Статус</label>' + sel("status", DOC_ST, d.status || "none") + '<label class="fl">Заметка</label><input class="f" name="note" maxlength="300" value="' + esc(d.note) + '" placeholder="Апостиль подали 3 марта, готов через 20 рабочих дней">' +
      '<div class="tools"><button class="btn btn-primary" type="submit">' + (d.id ? "Сохранить" : "Добавить") + '</button><button class="btn btn-ghost" type="button" data-close>Отмена</button>' + (d.id ? '<button class="btn btn-danger btn-sm" type="button" id="doc-del" style="margin-left:auto">Удалить</button>' : "") + "</div></form>", function (m) {
      var f = m.querySelector("#f-doc");
      f.onsubmit = function (e) {
        e.preventDefault(); var o = formData(f), b = f.querySelector("[type=submit]"); b.disabled = true;
        var row = { doc_type: o.doc_type, title: o.title || DOC_TYPES[o.doc_type], status: o.status, note: o.note || null };
        (d.id ? DB.docs.update(d.id, row) : DB.docs.add(Object.assign({ student_id: s.id }, row))).then(function (r) { b.disabled = false; if (r.error) { fail(r, "Не сохранилось"); return; } closeModal(); toast(d.id ? "Сохранено" : "Документ добавлен", "ok"); track(d.id ? "ws_doc_edit" : "ws_doc_add"); tabDocs(s); });
      };
      var del = m.querySelector("#doc-del");
      if (del) del.onclick = function () { if (!del.getAttribute("data-armed")) { del.setAttribute("data-armed", "1"); del.textContent = "Точно удалить"; return; } DB.docs.remove(d.id).then(function (r) { if (r.error) { fail(r); return; } closeModal(); toast("Удалено", "ok"); tabDocs(s); }); };
    });
  }

  /* --- вкладка Заметки --- */
  function tabNotes(s) {
    var body = $("stBody");
    DB.notes.list(s.id).then(function (r) {
      if (r.error) { body.innerHTML = '<div class="card empty">' + esc(r.error.message) + "</div>"; return; }
      var notes = (r.data || []).slice().sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
      var tasks = notes.filter(function (n) { return n.kind === "task" && !n.done; }), rest = notes.filter(function (n) { return !(n.kind === "task" && !n.done); });
      var h = '<div class="cols"><div><div class="card"><div class="h2">Новая запись</div><form id="f-note"><div class="grid2"><div><label class="fl">Тип</label>' + sel("kind", NOTE_K, "note") + '</div><div id="due-wrap" hidden><label class="fl">Срок</label><input class="f" name="due_on" type="date"></div></div>' +
        '<label class="fl">Текст</label><textarea class="f" name="text" required maxlength="2000" placeholder="Созвон с мамой: договорились о репетиторе по IELTS, следующий контакт через неделю"></textarea>' +
        '<div class="tools"><button class="btn btn-primary" type="submit">Записать</button></div></form></div>' +
        '<div class="card" style="margin-top:14px"><div class="h2">Открытые задачи</div>' + (tasks.length ? tasks.map(function (n) { var d = daysTo(n.due_on); return '<label class="lst" style="cursor:pointer"><input type="checkbox" data-done="' + n.id + '" style="width:20px;height:20px"><div class="t"><b>' + esc(n.text) + "</b>" + (n.due_on ? '<span class="xs ' + (d < 0 ? "" : "mut") + '"' + (d < 0 ? ' style="color:var(--bad);font-weight:700"' : "") + ">" + (d < 0 ? "просрочено · " : "до ") + fmtD(n.due_on) + "</span>" : "") + '</div><button class="btn btn-ghost btn-sm" data-ndel="' + n.id + '" aria-label="Удалить">×</button></label>'; }).join("") : '<div class="empty">Открытых задач нет.</div>') + "</div></div>" +
        '<div><div class="card"><div class="h2">История</div>' + (rest.length ? rest.map(function (n) { return '<div class="note' + (n.kind === "task" ? " task done" : "") + '"><span class="k">' + esc(NOTE_L[n.kind] || n.kind) + ' · <span style="font-weight:600;letter-spacing:0;text-transform:none;color:var(--muted)">' + fmtDT(n.created_at) + '</span></span><div style="display:flex;gap:8px;align-items:flex-start"><div style="flex:1;white-space:pre-wrap">' + esc(n.text) + '</div><button class="btn btn-ghost btn-sm" data-ndel="' + n.id + '" aria-label="Удалить" style="min-height:28px;padding:2px 8px">×</button></div></div>'; }).join("") : '<div class="empty">Пока пусто. Записывайте звонки, договорённости с родителями и встречи — через месяц это сэкономит час.</div>') + "</div></div></div>";
      body.innerHTML = h;
      var f = $("f-note"); f.kind.onchange = function () { $("due-wrap").hidden = f.kind.value !== "task"; };
      f.onsubmit = function (e) {
        e.preventDefault(); var o = formData(f), b = f.querySelector("[type=submit]"); b.disabled = true;
        DB.notes.add({ student_id: s.id, kind: o.kind, text: o.text, done: o.kind === "task" ? false : null, due_on: o.kind === "task" && o.due_on ? o.due_on : null }).then(function (r2) { b.disabled = false; if (r2.error) { fail(r2, "Не записалось"); return; } toast(o.kind === "task" ? "Задача создана" : "Записано", "ok"); track("ws_note_add", { kind: o.kind }); tabNotes(s); });
      };
      body.onchange = function (e) { var cb = e.target.closest("[data-done]"); if (!cb) return; DB.notes.update(cb.getAttribute("data-done"), { done: true }).then(function (r2) { if (r2.error) { fail(r2); cb.checked = false; return; } toast("Задача закрыта", "ok"); track("ws_task_done"); tabNotes(s); }); };
      body.onclick = function (e) {
        var b = e.target.closest("[data-ndel]"); if (!b) return; e.preventDefault();
        if (!b.getAttribute("data-armed")) { b.setAttribute("data-armed", "1"); b.textContent = "Удалить?"; setTimeout(function () { if (b.isConnected) { b.removeAttribute("data-armed"); b.textContent = "×"; } }, 4000); return; }
        DB.notes.remove(b.getAttribute("data-ndel")).then(function (r2) { if (r2.error) { fail(r2); return; } toast("Удалено", "ok"); tabNotes(s); });
      };
    });
  }

  /* --- вкладка Кабинет ученика --- */
  function tabCab(s) {
    var body = $("stBody");
    if (!s.linked) {
      var text = waText(s.name.split(" ")[0]);
      body.innerHTML = '<div class="card glow"><div class="h2">Ученик ещё не зарегистрирован в Scholary</div><p class="sm mut" style="margin:4px 0 12px">Отправьте ему ссылку — после регистрации' + (s.email ? " на почту <b>" + esc(s.email) + "</b>" : " (попросите указать ту же почту, что в карточке)") + ' карточка свяжется с его аккаунтом сама: вы увидите его шансы, программы из его кабинета и статусы документов. Ученик получает Scholary Pro' + (S.ws.ends_on ? " до " + fmtDL(S.ws.ends_on) : "") + ' — за счёт вашего тарифа.</p>' +
        '<div class="link-row"><input class="f" readonly value="' + esc(inviteLink()) + '" id="inv"><button class="btn btn-ghost" id="inv-copy">Копировать</button></div>' +
        '<div class="tools"><a class="btn btn-primary" target="_blank" rel="noopener" href="https://wa.me/' + (s.phone ? esc(String(s.phone).replace(/\D/g, "").replace(/^8/, "7")) : "") + '?text=' + encodeURIComponent(text) + '">Отправить в WhatsApp</a><button class="btn btn-ghost" id="inv-txt">Скопировать текст</button></div></div>';
      $("inv-copy").onclick = function () { copyText(inviteLink(), "Ссылка скопирована"); };
      $("inv-txt").onclick = function () { copyText(text, "Текст скопирован"); };
      return;
    }
    DB.cabinet(s.id).then(function (r) {
      var c = r.data; if (r.error || !c) { body.innerHTML = '<div class="card empty">' + esc(r.error ? r.error.message : "Нет данных") + "</div>"; return; }
      if (!c.linked) { s.linked = false; tabCab(s); return; }
      var pr = c.profile || {}, pa = c.p_adm == null ? null : Math.round(c.p_adm * 100), ps = c.p_sch == null ? null : Math.round(c.p_sch * 100);
      var h = '<div class="cols"><div><div class="card"><div class="h2">Что видит ученик в своём кабинете</div><div class="xs mut" style="margin-bottom:8px">Живые данные: ученик ведёт их сам, вы — видите. Обновлено ' + fmtDT(pr.updated_at) + "</div>" +
        '<div class="kpis" style="grid-template-columns:1fr 1fr"><div class="card kpi"><div class="n">' + (pa == null ? "—" : pa + "%") + '</div><div class="l">шанс поступить</div></div><div class="card kpi"><div class="n">' + (ps == null ? "—" : ps + "%") + '</div><div class="l">шанс на стипендию</div></div></div>' +
        (pa == null ? '<div class="note"><span class="k">Квиз не пройден</span><div>Попросите ученика пройти 7 вопросов в кабинете — тогда появится расчёт и подбор программ.</div></div>' : "") +
        '<div class="kv" style="margin-top:10px"><b>Уровень</b><span>' + esc(LEVEL_L[pr.level] || "—") + "</span><b>Направления</b><span>" + esc((Array.isArray(pr.field) ? pr.field : []).join(", ") || "—") + "</span><b>Страны</b><span>" + esc((Array.isArray(pr.countries) ? pr.countries : []).map(function (x) { return CC[String(x).toLowerCase()] || x; }).join(", ") || "—") + "</span><b>Pro до</b><span>" + fmtDL(pr.pro_until) + "</span></div></div></div>" +
        '<div><div class="card"><div class="h2">Его программы</div>' + ((c.apps || []).length ? c.apps.map(function (a) { var url = safeUrl(a.url); return '<div class="lst"><div class="t"><b>' + esc(a.name) + "</b><span class=\"xs mut\">" + esc(a.country || "") + " · " + (a.outcome === "admit" ? "оффер" : a.outcome === "reject" ? "отказ" : a.submitted_at ? "подано " + fmtD(a.submitted_at) : "готовность " + Math.round((a.readiness || 0) * 100) + "%") + "</span></div>" + dlPill(a.deadline, !!a.submitted_at) + (url ? '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="' + esc(url) + '">↗</a>' : "") + "</div>"; }).join("") : '<div class="empty">В кабинете ученика пока нет программ.</div>') + "</div>" +
        '<div class="card" style="margin-top:14px"><div class="h2">Его документы</div><div class="xs mut" style="margin-bottom:6px">Только статусы — сами файлы ученика видит только он</div>' + ((c.docs || []).length ? c.docs.map(function (d) { return '<div class="lst"><div class="t"><b>' + esc(d.title || DOC_TYPES[d.doc_type] || d.doc_type) + "</b>" + (d.expires_on ? '<span class="xs mut">действует до ' + fmtD(d.expires_on) + "</span>" : "") + '</div><span class="pill ' + (d.status === "ready" ? "pill-ok" : d.status === "progress" ? "pill-warn" : "pill-mut") + '">' + esc(DOC_L[d.status] || d.status) + "</span></div>"; }).join("") : '<div class="empty">Документов в кабинете ученика нет.</div>') + "</div></div></div>";
      body.innerHTML = h;
    });
  }

  /* --- вкладка Контакты --- */
  function tabInfo(s) {
    $("stBody").innerHTML = '<div class="card"><div class="head" style="margin:0 0 10px"><div class="h2">Контакты и карточка</div><button class="btn btn-ghost btn-sm" id="info-edit">Изменить</button></div><div class="kv">' +
      "<b>Класс</b><span>" + esc(GRADE_L[s.grade] || "—") + "</span><b>Уровень</b><span>" + esc(LEVEL_L[s.level] || "—") + "</span><b>Цель</b><span>" + esc(s.target || "—") + "</span>" +
      "<b>Телефон</b><span>" + (s.phone ? '<a href="tel:' + esc(s.phone) + '">' + esc(s.phone) + "</a>" : "—") + "</span><b>Email</b><span>" + (s.email ? '<a href="mailto:' + esc(s.email) + '">' + esc(s.email) + "</a>" : "—") + "</span>" +
      "<b>Родитель</b><span>" + esc(s.parent_name || "—") + "</span><b>Тел. родителя</b><span>" + (s.parent_phone ? '<a href="tel:' + esc(s.parent_phone) + '">' + esc(s.parent_phone) + "</a>" : "—") + "</span>" +
      "<b>В Scholary</b><span>" + (s.linked ? "да — аккаунт привязан" : "нет — отправьте ссылку во вкладке «Кабинет ученика»") + "</span><b>Добавлен</b><span>" + fmtDL(s.created_at) + "</span></div>" +
      (s.note ? '<div class="note" style="margin-top:12px"><span class="k">Важно</span><div style="white-space:pre-wrap">' + esc(s.note) + "</div></div>" : "") + "</div>";
    $("info-edit").onclick = function () { editStudentModal(s); };
  }

  /* ---------- Ссылка и тариф ---------- */
  function copyText(text, okMsg) {
    var done = function () { toast(okMsg || "Скопировано", "ok"); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { toast("Скопируйте вручную", "bad"); });
    else toast("Скопируйте вручную", "bad");
  }
  function viewSettings() {
    var w = S.ws, free = Math.max(0, w.seats - w.used), text = waText("");
    $("view").innerHTML = '<div class="head"><div><div class="h1">Ссылка и тариф</div><div class="sm mut">' + esc(w.name) + (w.city ? " · " + esc(w.city) : "") + "</div></div></div><div class=\"cols\">" +
      '<div><div class="card glow"><div class="h2">Ссылка для учеников</div><p class="sm mut" style="margin:4px 0 10px">Ученик регистрируется по ней, получает Scholary Pro за счёт вашего тарифа и привязывается к своей карточке по почте. Ссылка одна на всех учеников.</p>' +
      '<div class="link-row"><input class="f" readonly id="inv" value="' + esc(inviteLink()) + '"><button class="btn btn-ghost" id="inv-copy">Копировать</button></div><div class="xs mut" style="margin-top:6px">Код: <span class="code" style="font-size:16px">' + esc(w.invite_code || "—") + "</span></div>" +
      '<div class="tools"><a class="btn btn-primary" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(text) + '">Отправить в WhatsApp</a><button class="btn btn-ghost" id="inv-txt">Скопировать текст</button><button class="btn btn-ghost btn-sm" id="regen">Новая ссылка</button></div>' +
      '<div id="regenBox" class="note" hidden style="margin-top:10px"><b>Старая ссылка перестанет работать.</b> Уже зарегистрированные ученики останутся.<div class="tools"><button class="btn btn-danger btn-sm" id="regen-yes">Выпустить новую</button><button class="btn btn-ghost btn-sm" id="regen-no">Отмена</button></div></div></div>' +
      '<div class="card" style="margin-top:14px"><div class="h2">Как это работает</div><div class="lst"><span class="pill pill-acc">1</span><div class="t"><b>Карточка</b><span class="xs mut">Вы заводите ученика с почтой — или он сам регистрируется по ссылке</span></div></div><div class="lst"><span class="pill pill-acc">2</span><div class="t"><b>Связка по почте</b><span class="xs mut">Совпала почта — карточка и его кабинет становятся одним целым</span></div></div><div class="lst"><span class="pill pill-acc">3</span><div class="t"><b>Вы видите всё</b><span class="xs mut">Его шансы, программы и статусы документов — во вкладке «Кабинет ученика»</span></div></div></div></div>' +
      '<div><div class="card"><div class="h2">Тариф</div><div class="kv" style="margin-top:8px"><b>План</b><span>' + esc(w.plan_label || w.plan) + '</span><b>Статус</b><span>' + (w.open ? '<span class="pill pill-ok">доступ открыт</span>' : w.status === "active" ? '<span class="pill pill-warn">срок истёк</span>' : '<span class="pill pill-mut">' + esc(w.status) + "</span>") + '</span><b>Период</b><span>' + (w.starts_on ? fmtD(w.starts_on) + " — " : "") + fmtDL(w.ends_on) + '</span><b>Контакт</b><span>' + esc(w.contact_name || "—") + (w.contact_email ? "<br>" + esc(w.contact_email) : "") + "</span></div>" +
      '<div style="margin-top:12px"><b>' + w.used + " из " + w.seats + '</b> <span class="sm mut">мест занято · ' + (free ? "свободно " + free : "мест нет") + '</span><div class="bar"><i style="width:' + Math.min(100, Math.round(100 * w.used / Math.max(1, w.seats))) + '%"></i></div></div>' +
      '<p class="sm mut" style="margin:12px 0 8px">Место = карточка ученика. Удалили карточку — место освободилось. Нужно больше — переходите на следующий тариф, доплата считается пропорционально остатку срока.</p>' +
      '<div class="tools"><a class="btn btn-primary btn-sm" href="/counselors/#tariffs">Тарифы</a><a class="btn btn-ghost btn-sm" href="https://wa.me/77024666852?text=' + encodeURIComponent("Здравствуйте! Хочу расширить тариф workspace профориентолога (" + w.name + ", код " + w.invite_code + ").") + '" target="_blank" rel="noopener">Написать нам</a></div></div>' +
      '<div class="card" style="margin-top:14px"><div class="h2">Аккаунт</div><div class="sm mut">' + esc(S.session && S.session.user.email || "") + '</div><div class="tools"><button class="btn btn-ghost btn-sm" id="refresh">Обновить данные</button><button class="btn btn-ghost btn-sm" id="out3">Выйти</button></div></div></div></div>';
    $("inv-copy").onclick = function () { copyText(inviteLink(), "Ссылка скопирована"); track("ws_link_copy"); };
    $("inv-txt").onclick = function () { copyText(text, "Текст скопирован"); };
    $("regen").onclick = function () { $("regenBox").hidden = false; };
    $("regen-no").onclick = function () { $("regenBox").hidden = true; };
    $("regen-yes").onclick = function () { DB.regen().then(function (r) { if (r.data && r.data.ok) { S.ws.invite_code = r.data.invite_code; toast("Новая ссылка выпущена", "ok"); track("ws_link_regen"); viewSettings(); } else fail(r, "Не получилось выпустить ссылку"); }); };
    $("refresh").onclick = function () { DB.mine().then(function (r) { if (r.data) S.ws = r.data; viewSettings(); toast("Обновлено", "ok"); }); };
    $("out3").onclick = out;
  }

  /* ---------- сессия ---------- */
  sb.auth.onAuthStateChange(function (event, session) {
    if (session && S.session && S.session.user.id === session.user.id && S.ws) { S.session = session; return; }
    S.session = session;
    if (session) enter(); else { S.entering = false; show("v-auth"); authView("login"); }
  });
  sb.auth.getSession().then(function (r) { if (!r.data.session) { show("v-auth"); authView("login"); } });
}
(function boot() {
  if (/[?&]demo=1/.test(location.search) || (window.supabase && window.supabase.createClient)) { __counselorMain(); return; }
  boot.t = boot.t || Date.now();
  if (Date.now() - boot.t < 8000) { setTimeout(boot, 100); return; }
  document.getElementById("loading").innerHTML = '<div style="text-align:center;padding:20px;color:#6E6E73">Не получилось загрузить страницу — отключите блокировщик рекламы или откройте в другом браузере.</div>';
})();
