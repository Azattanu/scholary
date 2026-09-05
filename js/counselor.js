/* Scholary · workspace профориентолога 2.0, /prof/cabinet/ (web-75).
   Вход тем же Supabase Auth, что и у учеников. Данные: school_mine / ws_roster /
   ws_dashboard / ws_student_cabinet — RPC; карточки, подачи, документы, заметки —
   таблицы ws_students / ws_apps / ws_docs / ws_notes под RLS владельца (ws_owner).
   Очередь «Сейчас», «здоровье» ученика, неделя и календарь считаются здесь,
   из сырья ws_dashboard: так один запрос на вход, а правила — в одном месте
   (см. 63-b § 3). Файлы — бакет docs, папка {uid}/ws/{student_id}/… */
function __counselorMain() {
  "use strict";
  var C = window.SCHOLARY_CONFIG || {};
  var Path = window.ScholaryPath;
  var sb = (window.supabase && window.supabase.createClient) ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY) : null;
  var $ = function (id) { return document.getElementById(id); };
  var track = window.track || function () {};
  var S = { session: null, ws: null, roster: [], dash: null, programs: null, q: "", stage: "", filter: "", mode: "table", entering: false,
            demo: /[?&]demo=1/.test(location.search), cur: null, tab: "overview", tg: null, calMonth: null, calSel: null, weekOff: 0, showArchived: false };

  /* ---------- словари ---------- */
  var STAGES = [["intake", "Знакомство"], ["docs", "Документы"], ["applying", "Подача"], ["submitted", "Отправлено"], ["admitted", "Поступил"], ["paused", "Пауза"]];
  var STAGE_L = {}; STAGES.forEach(function (s) { STAGE_L[s[0]] = s[1]; });
  var ACTIVE = { intake: 1, docs: 1, applying: 1, submitted: 1 };
  var APP_ST = [["study", "Изучаем"], ["prep", "Готовим"], ["applied", "Подано"], ["waitlist", "Лист ожидания"], ["admit", "Оффер"], ["reject", "Отказ"]];
  var APP_L = {}; APP_ST.forEach(function (s) { APP_L[s[0]] = s[1]; });
  var DOC_ST = [["none", "Нет"], ["progress", "В работе"], ["ready", "Готов"]];
  var DOC_L = {}; DOC_ST.forEach(function (s) { DOC_L[s[0]] = s[1]; });
  var NOTE_K = [["call", "Звонок"], ["parent", "Родители"], ["meeting", "Встреча"], ["task", "Задача"], ["note", "Заметка"]];
  var NOTE_L = { note: "Заметка", call: "Звонок", parent: "Родители", meeting: "Встреча", task: "Задача", status: "Статус семье", stage: "Этап", doc: "Документ" };
  var NOTE_IC = { note: "📝", call: "📞", parent: "👨‍👩‍👧", meeting: "🗓", task: "☑️", status: "💬", stage: "🚩", doc: "📎" };
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
  /* Сроки изготовления — как у ученика (doc-rules): чтобы «начать до» совпадало в обоих кабинетах. */
  var DOC_LEAD = { passport: 21, diploma: 3, translation: 7, apostille: 28, ielts: 21, motivation: 10, recommendation: 21, cv: 3, medical: 10, income: 10, research: 21, photo: 1, finance: 21, other: 7 };
  var DOC_STD = ["passport", "diploma", "translation", "apostille", "ielts", "motivation", "recommendation", "cv"];
  var CC = { hu: "Венгрия", de: "Германия", it: "Италия", cz: "Чехия", tr: "Турция", cn: "Китай", kr: "Корея", jp: "Япония", pl: "Польша", us: "США", fr: "Франция", nl: "Нидерланды", ae: "ОАЭ", eu: "Европа", se: "Швеция", sa: "Сауд. Аравия", hk: "Гонконг", sg: "Сингапур", uk: "Британия", gb: "Британия", ca: "Канада", kz: "Казахстан", ch: "Швейцария", at: "Австрия", my: "Малайзия", in: "Индия" };
  /* Шаблоны «следующего шага» по этапу — подсказки, не норматив. */
  var STEP_TPL = {
    intake: ["Отправить ссылку на регистрацию и квиз", "Встреча с родителями: план и бюджет", "Выбрать 3 страны под профиль"],
    docs: ["Заказать апостиль (до 20 рабочих дней)", "Назначить дату IELTS", "Запросить рекомендации у учителей", "Нотариальный перевод"],
    applying: ["Финал мотивационного письма", "Проверить пакет по чек-листу", "Подать заявку на портале"],
    submitted: ["Проверить почту и портал вуза", "Подготовить ответы для интервью", "Отметить исход подачи"],
    admitted: ["Виза: собрать пакет", "Общежитие и перелёт", "Итог сезона для семьи"],
    paused: ["Созвон: возвращаемся к плану?"]
  };
  /* Окна сезона Казахстана — константы для календаря (63-b2 § 6). MM-DD. */
  var SEASON = [
    ["10-15", "DAAD — дедлайн (Германия)"], ["10-17", "GKS — дедлайн (Корея)"], ["11-05", "Chevening — дедлайн"], ["11-30", "Швейцария / Канада — окна 30.11"],
    ["12-01", "Open Doors, HK PhD — окна 1.12"], ["12-15", "EPFL / ENS / MBZUAI — 15.12"], ["01-15", "Stipendium Hungaricum — дедлайн"], ["01-20", "ЕНТ: январская сессия"],
    ["02-15", "CSC — дедлайн (Китай)"], ["02-20", "Türkiye Bursları — дедлайн"], ["03-16", "Болашак — открытие приёма"], ["03-20", "ЕНТ: мартовская сессия"],
    ["03-31", "Италия MAECI / DSU — окна"], ["05-20", "ЕНТ: основная сессия"], ["06-15", "Выпуск, аттестаты"], ["07-15", "Германия — летние окна"], ["10-16", "Болашак — закрытие приёма"]
  ];
  /* Подсказка недели для профориентолога — проверка по каслоаду (63-b § 4). Числа только реальные. */
  var HINTS = {
    "9-1": { t: "Честная точка А", f: function (x) { return x.noApps + " без единой программы · " + x.noStep + " без следующего шага"; }, act: "students:noapps" },
    "9-2": { t: "Решение по IELTS", f: function (x) { return x.docsZero + " на этапе документов без единого готового документа"; }, act: "students:docs" },
    "10-1": { t: "Бюджет с родителями", f: function (x) { return x.noStatus + " семей без статуса 21+ дней"; }, act: "students:family" },
    "10-2": { t: "Первые жёсткие окна: DAAD 15.10, GKS 17.10", f: function (x) { return x.dl30 + " дедлайнов в 30 дней · " + x.dl30bad + " из них без документов"; }, act: "calendar" },
    "11-1": { t: "Апостиль и перевод стартуют", f: function (x) { return x.docsZero + " учеников на документах ещё ничего не собрали"; }, act: "students:docs" },
    "11-2": { t: "Пакет за две недели до срока", f: function (x) { return x.dl30 + " дедлайнов в 30 дней"; }, act: "calendar" },
    "12-1": { t: "Мотивационные письма", f: function (x) { return x.noStep + " учеников без следующего шага"; }, act: "students:nostep" },
    "12-2": { t: "Каникулы — две свободные недели", f: function (x) { return x.idle + " без касания 14+ дней"; }, act: "students:idle" },
    "1-1": { t: "Пик подач № 1: SH 15.01", f: function (x) { return x.dl30 + " дедлайнов в 30 дней · " + x.dl30bad + " без документов"; }, act: "calendar" },
    "1-2": { t: "Проверка пакетов", f: function (x) { return x.dl30bad + " подач с дедлайном в 30 дней и неготовыми документами"; }, act: "students:dl14" },
    "2-1": { t: "Пик подач № 2: CSC, Türkiye", f: function (x) { return x.dl30 + " дедлайнов в 30 дней"; }, act: "calendar" },
    "2-2": { t: "Интервью", f: function (x) { return x.sent + " подач ждут ответа"; }, act: "students:submitted" },
    "3-1": { t: "Италия и Болашак", f: function (x) { return x.dl30 + " дедлайнов в 30 дней"; }, act: "calendar" },
    "3-2": { t: "Ответы вузов", f: function (x) { return x.sent + " подач без исхода"; }, act: "students:submitted" },
    "4-1": { t: "Запасные окна", f: function (x) { return x.noStep + " без следующего шага"; }, act: "students:nostep" },
    "4-2": { t: "Сроки документов к лету", f: function (x) { return x.idle + " без касания 14+ дней"; }, act: "students:idle" },
    "5-1": { t: "ЕНТ и исходы", f: function (x) { return x.sent + " подач без исхода"; }, act: "students:submitted" },
    "5-2": { t: "Офферы", f: function (x) { return x.offers + " офферов · семьям пора выбирать"; }, act: "students:admitted" },
    "6-1": { t: "Виза", f: function (x) { return x.offers + " учеников с оффером — визовые шаги"; }, act: "students:admitted" },
    "6-2": { t: "Финиш сезона", f: function (x) { return x.noStatus + " семей без итогового статуса"; }, act: "students:family" }
  };
  var DEFAULT_HINT = { t: "Межсезонье", f: function (x) { return x.noStep + " без следующего шага · " + x.idle + " без касания 14+ дней"; }, act: "students:nostep" };

  /* ---------- утилиты ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[<>&"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]; }); }
  function show(id) { ["loading", "v-auth", "v-none", "v-app"].forEach(function (v) { $(v).hidden = v !== id; }); }
  function toast(msg, kind) {
    var t = document.createElement("div"); t.className = "toast" + (kind ? " " + kind : ""); t.textContent = msg;
    $("toast-root").appendChild(t); setTimeout(function () { t.remove(); }, 3400);
  }
  function qs(name) { var m = location.search.match(new RegExp("[?&]" + name + "=([^&]+)")); return m ? decodeURIComponent(m[1]) : ""; }
  function todayD() { var t = window.__SCHOLARY_NOW ? new Date(window.__SCHOLARY_NOW) : new Date(); t.setHours(0, 0, 0, 0); return t; }
  function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function fmtD(s) { if (!s) return "—"; return new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }); }
  function fmtDn(s) { return fmtD(s).replace(/\.$/, ""); }
  function fmtDL(s) { if (!s) return "—"; return new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }); }
  function fmtDT(s) { if (!s) return ""; return new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) + ", " + new Date(s).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }); }
  function fmtT(t) { return t ? String(t).slice(0, 5) : ""; }
  function daysTo(s) { if (!s) return null; var d = new Date(String(s).slice(0, 10) + "T00:00:00"); if (isNaN(d)) return null; return Math.round((d - todayD()) / 864e5); }
  function daysAgo(s) { if (!s) return null; return Math.floor((todayD().getTime() + 864e5 - 1 - new Date(s).getTime()) / 864e5); }
  function plural(n, a, b, c) { n = Math.abs(n) % 100; var m = n % 10; if (n > 10 && n < 20) return c; if (m > 1 && m < 5) return b; if (m === 1) return a; return c; }
  function isoToday(off) { return iso(addDays(todayD(), off || 0)); }
  function nextMD(md) { if (!md || !/^\d{2}-\d{2}$/.test(md)) return null; var y = todayD().getFullYear(); var d = new Date(y + "-" + md + "T00:00:00"); if (isNaN(d)) return null; if (daysTo(d) < 0) y++; return y + "-" + md; }
  function dlPill(s, doneLike) {
    var d = daysTo(s); if (d == null) return '<span class="pill pill-mut">без дедлайна</span>';
    if (doneLike) return '<span class="pill pill-mut">' + fmtD(s) + "</span>";
    return '<span class="pill ' + (d < 0 ? "pill-mut" : d <= 7 ? "pill-bad" : d <= 45 ? "pill-warn" : "pill-mut") + '">' + fmtD(s) + " · " + (d < 0 ? "прошёл" : d === 0 ? "сегодня" : d + " " + plural(d, "день", "дня", "дней")) + "</span>";
  }
  function stagePill(st) { return '<span class="stage stage-' + esc(st) + '">' + esc(STAGE_L[st] || st) + "</span>"; }
  function sel(name, opts, val, cls) { return '<select class="' + (cls || "f") + '" name="' + name + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === val ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select>"; }
  function fail(r, what) { var m = (r && r.error && r.error.message) || ""; if (/seats_full/.test(m)) m = "Места по тарифу закончились — архивируйте закрытые карточки или расширьте тариф"; toast((what || "Не получилось") + (m ? ": " + m : ""), "bad"); }
  function safeUrl(u) { u = String(u || "").trim(); if (!u) return ""; if (!/^https?:\/\//i.test(u)) u = "https://" + u; return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : ""; }
  function waNum(p) { return String(p || "").replace(/\D/g, "").replace(/^8/, "7"); }
  function inviteLink() { return location.origin + "/schools/join/?code=" + (S.ws && S.ws.invite_code || ""); }
  function firstName(n) { return String(n || "").trim().split(/\s+/)[0] || ""; }
  function waText(name) {
    var who = S.ws && S.ws.contact_name ? S.ws.contact_name : "ваш профориентолог";
    return (name ? name + ", привет! " : "Привет! ") + "Это " + who + ". Я веду твоё поступление в Scholary — там будут все твои программы, дедлайны и документы, и мы будем видеть их вместе.\n\n" +
      "Зарегистрируйся по моей ссылке — Scholary Pro для тебя бесплатно" + (S.ws && S.ws.ends_on ? " до " + fmtDL(S.ws.ends_on) : "") + ":\n" + inviteLink() +
      "\n\nЗаймёт 2 минуты: создать аккаунт, ответить на 7 вопросов — и ты увидишь свои шансы по 236 программам. Регистрируйся на ту же почту, что дал(а) мне.";
  }
  function copyText(text, okMsg) {
    var done = function () { toast(okMsg || "Скопировано", "ok"); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { toast("Скопируйте вручную", "bad"); });
    else toast("Скопируйте вручную", "bad");
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

  /* ---------- демо-данные: живая практика на 14 учеников ---------- */
  function demoData() {
    var d = isoToday, ago = function (n, h) { var x = new Date(todayD().getTime() - n * 864e5); x.setHours(h == null ? 11 : h, 20, 0, 0); return x.toISOString(); };
    var ws = { id: "demo", name: "Workspace Айгуль Сериковны", city: "Алматы", kind: "counselor", plan: "c50", plan_label: "Практика · до 50", period: "year",
      seats: 50, used: 14, students: 14, status: "active", open: true, invite_code: "DEMO2026", starts_on: d(-40), ends_on: d(325), contact_name: "Айгуль Сериковна", contact_email: "aigul@example.kz" };
    var students = [], apps = [], docs = [], notes = [], nid = 1;
    /* [имя, класс, уровень, этап, цель, linked, p_adm, подачи[[name,country,dl+,status,url]], документы, записи[[kind,text,daysAgo,dueIn?,time?]], шаг, шагДата+, статусСемьеДнейНазад] */
    var rows = [
      ["Айгерим Сериккызы", "11", "bachelor", "applying", "Германия · IT", 1, 0.74, [["Stipendium Hungaricum — BSc Computer Science", "Венгрия", 60, "prep", "https://stipendiumhungaricum.hu/"], ["DAAD — TU Munich Informatics", "Германия", 130, "study", "https://www.daad.de/"], ["Türkiye Bursları", "Турция", 12, "applied", "https://www.turkiyeburslari.gov.tr/"]], ["passport:ready", "diploma:ready", "translation:progress", "apostille:progress", "ielts:ready", "motivation:progress", "recommendation:none", "cv:ready"], [["parent", "Мама просит дублировать все дедлайны ей в WhatsApp", 3], ["task", "Получить 2-ю рекомендацию от учителя физики", 1, 5], ["call", "Созвон: решили подавать в 3 страны, Германия — основная", 9], ["status", "Статус семье: этап «Подача», Türkiye подано, письмо в работе", 6], ["stage", "Этап: Документы → Подача", 9]], "Финал мотивационного письма для SH", 4, 6],
      ["Данияр Касымов", "11", "bachelor", "docs", "Турция · инженерия", 1, 0.61, [["Türkiye Bursları — Engineering", "Турция", 12, "prep", "https://www.turkiyeburslari.gov.tr/"], ["Politecnico di Milano — Engineering", "Италия", 95, "study", "https://www.polimi.it/"]], ["passport:ready", "diploma:progress", "translation:none", "apostille:none", "ielts:progress", "motivation:none", "recommendation:none", "cv:none"], [["task", "Напомнить про апостиль — ЦОН до 20 рабочих дней", 2, -1], ["note", "IELTS сдаёт 20 числа, цель 6.5", 6], ["meeting", "Созвон с мамой: план по документам", 0, 1, "18:30"], ["status", "Статус семье: этап «Документы», паспорт готов, апостиль — следующий", 25]], "Заказать апостиль", -2, 25],
      ["Томирис Жаксыбек", "10", "bachelor", "intake", "Медицина · пока выбирает", 0, null, [], [], [["meeting", "Первая встреча: интерес к медицине, Венгрия/Чехия. Родители за.", 1], ["task", "Отправить ссылку на регистрацию и квиз", 0, 1]], "", null, null],
      ["Алихан Бекжан", "11", "bachelor", "submitted", "Китай · бизнес", 1, 0.56, [["CSC Scholarship — Fudan University", "Китай", -10, "applied", "https://www.campuschina.org/"], ["Shanghai Government Scholarship", "Китай", 40, "applied", "https://study.edu.sh.gov.cn/"]], ["passport:ready", "diploma:ready", "translation:ready", "apostille:ready", "ielts:ready", "motivation:ready", "recommendation:ready", "cv:ready", "medical:ready"], [["note", "Все подачи ушли, ждём ответ до мая", 8], ["status", "Статус семье: обе подачи отправлены, ждём ответ", 8]], "Проверить почту и портал вуза", 14, 8],
      ["Аружан Нурланова", "11", "bachelor", "applying", "Германия/Чехия · науки", 1, 0.68, [["Charles University — Chemistry", "Чехия", 44, "prep", "https://cuni.cz/"], ["DAAD — Heidelberg Chemistry", "Германия", 120, "study", "https://www.daad.de/"]], ["passport:ready", "diploma:ready", "translation:ready", "apostille:progress", "ielts:ready", "motivation:progress", "recommendation:progress", "cv:ready"], [["parent", "Папа спрашивал про стоимость жизни в Праге — отправила расчёт", 2], ["meeting", "Встреча с семьёй: бюджет и запасной вариант", 0, 3, "16:00"]], "Проверить пакет по чек-листу", 10, 2],
      ["Ерасыл Мухамедиев", "11", "bachelor", "docs", "Корея · IT", 1, 0.47, [["GKS — Korean Government Scholarship", "Корея", 21, "prep", "https://www.studyinkorea.go.kr/"]], ["passport:progress", "diploma:ready", "translation:none", "apostille:none", "ielts:none", "motivation:none", "recommendation:none", "cv:progress"], [["task", "Паспорт: узнать срок готовности", 0, 3], ["call", "Не отвечал 2 недели — дозвонилась, продолжаем", 12]], "Назначить дату IELTS", 7, null],
      ["Диана Ахметова", "10", "bachelor", "intake", "Польша · гуманитарные", 0, null, [["Polish NAWA — Banach", "Польша", 160, "study", "https://nawa.gov.pl/"]], [], [["note", "Хочет Варшаву, смотрит психологию", 9]], "Встреча с родителями: план и бюджет", 9, null],
      ["Санжар Оразбек", "11", "bachelor", "admitted", "Турция · инженерия", 1, 0.71, [["Türkiye Bursları — Civil Engineering", "Турция", -60, "admit", "https://www.turkiyeburslari.gov.tr/"], ["Stipendium Hungaricum — BME", "Венгрия", -30, "admit", "https://stipendiumhungaricum.hu/"]], ["passport:ready", "diploma:ready", "translation:ready", "apostille:ready", "ielts:ready", "motivation:ready", "recommendation:ready", "cv:ready"], [["parent", "Семья выбрала Венгрию. Помочь с визой и общежитием", 1], ["task", "Виза: записать в консульство", 0, 7], ["status", "Статус семье: два оффера, выбираем Венгрию", 1]], "Виза: собрать пакет", 7, 1],
      ["Мадина Сулейменова", "9", "bachelor", "intake", "Италия · искусство", 0, null, [], ["ielts:none"], [["meeting", "Знакомство с родителями: план на 2 года, начать с языка", 7]], "", null, null],
      ["Нурсултан Абай", "11", "bachelor", "docs", "Нидерланды · право", 1, 0.39, [["University of Amsterdam — Law", "Нидерланды", 18, "prep", "https://www.uva.nl/"]], ["passport:ready", "diploma:progress", "translation:none", "apostille:none", "ielts:progress", "motivation:progress", "recommendation:none", "cv:none"], [["task", "Мотивационное: прислать правки до пятницы", 0, 2], ["note", "Шансы низкие — обсудили запасной вариант: Польша", 8]], "Нотариальный перевод", 3, null],
      ["Камила Ержан", "11", "bachelor", "applying", "Китай/Венгрия · медицина", 1, 0.63, [["Stipendium Hungaricum — Semmelweis Medicine", "Венгрия", 58, "prep", "https://stipendiumhungaricum.hu/"], ["CSC — Peking Union Medical", "Китай", 90, "study", "https://www.campuschina.org/"]], ["passport:ready", "diploma:ready", "translation:ready", "apostille:ready", "ielts:progress", "motivation:progress", "recommendation:ready", "cv:ready", "medical:progress"], [["call", "Созвон с мамой: волнуется за IELTS, договорились о репетиторе", 2], ["status", "Статус семье: этап «Подача», документы 6 из 9", 2]], "Финал мотивационного письма", 6, 2],
      ["Бекзат Тулеген", "10", "bachelor", "intake", "Германия · IT", 1, 0.58, [["DAAD — Studienkolleg", "Германия", 131, "study", "https://www.daad.de/"]], ["ielts:progress"], [["note", "Учит немецкий, B1 к лету", 10]], "Выбрать 3 страны под профиль", -5, null],
      ["Асель Кайрат", "grad", "master", "paused", "Британия · маркетинг", 0, null, [["Chevening", "Британия", 70, "study", "https://www.chevening.org/"]], ["cv:ready", "ielts:ready"], [["note", "Пауза до осени — устроилась на работу для опыта", 20]], "Созвон: возвращаемся к плану?", 20, null],
      ["Арман Досов", "11", "bachelor", "docs", "Чехия · IT", 1, 0.52, [["Czech Technical University — Informatics", "Чехия", 33, "prep", "https://www.cvut.cz/"]], ["passport:ready", "diploma:progress", "translation:none", "apostille:none", "ielts:ready", "motivation:none", "recommendation:none", "cv:none"], [["task", "Оплатить нотариальный перевод", 0, 4], ["status", "Статус семье: этап «Документы», IELTS готов", 16]], "Заказать апостиль", 5, 16]
    ];
    rows.forEach(function (r, i) {
      var id = "demo-s" + (i + 1);
      students.push({ id: id, user_id: r[5] ? "demo-u" + i : null, linked: !!r[5], name: r[0], grade: r[1], level: r[2], stage: r[3], target: r[4], phone: "+7 777 000 00 " + (10 + i), email: "student" + (i + 1) + "@example.kz",
        parent_name: i % 2 ? "Мама, Гульнара" : "Папа, Ерлан", parent_phone: "+7 701 000 00 " + (20 + i), parent_email: i % 3 === 0 ? "parent" + (i + 1) + "@example.kz" : null,
        note: i === 0 ? "Мама — главный контакт. Целится в Германию, Венгрия — запасной." : "", created_at: ago(40 - i), updated_at: ago(i), p_adm: r[6], archived: false,
        next_step: r[10] || null, next_step_on: r[11] == null ? null : d(r[11]), last_status_at: r[12] == null ? null : ago(r[12]),
        cab_apps: r[5] ? r[7].length : 0, cab_apps_sent: r[5] ? r[7].filter(function (a) { return a[3] !== "study" && a[3] !== "prep"; }).length : 0, cab_docs: r[5] ? r[8].length : 0, cab_docs_ready: r[5] ? r[8].filter(function (x) { return /ready/.test(x); }).length : 0, cab_last_active: r[5] ? ago(i % 5) : null, cab_last_day: r[5] ? d(-(i % 5)) : null });
      r[7].forEach(function (a) { apps.push({ id: nid++, student_id: id, program_id: null, name: a[0], country: a[1], deadline: d(a[2]), status: a[3], apply_url: a[4], note: "", created_at: ago(20), updated_at: ago(a[3] === "applied" ? 2 : 20) }); });
      r[8].forEach(function (x) { var p = x.split(":"); docs.push({ id: nid++, student_id: id, doc_type: p[0], title: DOC_TYPES[p[0]], status: p[1], file_path: p[1] === "ready" ? "demo" : null, file_name: p[1] === "ready" ? p[0] + ".pdf" : null, note: "", updated_at: ago(p[1] === "ready" ? ((i + p[0].length) % 5 === 0 ? 2 : 12 + (i % 9)) : 9) }); });
      r[9].forEach(function (n) { notes.push({ id: nid++, student_id: id, kind: n[0], text: n[1], done: n[0] === "task" ? false : null, done_at: null, due_on: (n[0] === "task" || n[0] === "meeting") && n[3] != null ? d(n[3]) : null, at_time: n[4] || null, minutes: n[0] === "meeting" ? 30 : null, created_at: ago(n[2]) }); });
    });
    /* закрытые задачи этой и прошлой недели — для «прогресса недели» */
    [["demo-s1", "Отправить черновик письма на разбор", 1], ["demo-s5", "Собрать рекомендации", 2], ["demo-s11", "Записать на IELTS", 0], ["demo-s2", "Запросить транскрипт в школе", 8], ["demo-s14", "Скан аттестата", 9]].forEach(function (t) {
      notes.push({ id: nid++, student_id: t[0], kind: "task", text: t[1], done: true, done_at: ago(t[2]), due_on: d(-t[2]), created_at: ago(t[2] + 3) });
    });
    var programs = [["sh-cs", "Stipendium Hungaricum — BSc Computer Science", "Венгрия", "hu", "01-15", "https://stipendiumhungaricum.hu/"], ["daad-tum", "DAAD — TU Munich Informatics", "Германия", "de", "07-15", "https://www.daad.de/"], ["tb-eng", "Türkiye Bursları — Engineering", "Турция", "tr", "02-20", "https://www.turkiyeburslari.gov.tr/"],
      ["csc-fudan", "CSC Scholarship — Fudan University", "Китай", "cn", "03-31", "https://www.campuschina.org/"], ["gks", "GKS — Korean Government Scholarship", "Корея", "kr", "03-15", "https://www.studyinkorea.go.kr/"], ["cuni-chem", "Charles University — Chemistry", "Чехия", "cz", "02-28", "https://cuni.cz/"], ["nawa", "Polish NAWA — Banach", "Польша", "pl", "04-30", "https://nawa.gov.pl/"], ["uva-law", "University of Amsterdam — Law", "Нидерланды", "nl", "01-15", "https://www.uva.nl/"], ["chevening", "Chevening", "Британия", "gb", "11-05", "https://www.chevening.org/"], ["polimi", "Politecnico di Milano — Engineering", "Италия", "it", "12-01", "https://www.polimi.it/"]]
      .map(function (p) { return { id: p[0], name: p[1], country: p[2], cc: p[3], deadline_md: p[4], source_url: p[5], levels: ["bachelor"], funding: "full" }; });
    /* активность: 5 недель практики, одна пропущена (заморозка) */
    var activity = [];
    [1, 2, 3, 5].forEach(function (w) { [0, 2, 4].forEach(function (k) { activity.push({ day: d(-(7 * w) - k), progress: k === 0, actions: 3 }); }); });
    activity.push({ day: d(0), progress: false, actions: 1 });
    return { ws: ws, students: students, apps: apps, docs: docs, notes: notes, programs: programs, nid: nid, activity: activity, prefs: { touch_goal: 10, digest: true }, tg: { chat_id: "1", prefs: { ws_digest: true } } };
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
      var touch = n.filter(function (x) { return ["note", "call", "parent", "meeting", "status"].indexOf(x.kind) >= 0; }).map(function (x) { return x.created_at; }).sort().reverse()[0] || null;
      var meet = n.filter(function (x) { return x.kind === "meeting" && x.due_on && daysTo(x.due_on) >= 0; }).map(function (x) { return x.due_on; }).sort()[0] || null;
      return Object.assign({}, st, { ws_apps: a.length, ws_apps_sent: a.filter(function (x) { return x.status !== "study" && x.status !== "prep"; }).length, ws_offers: a.filter(function (x) { return x.status === "admit"; }).length, ws_next_deadline: dl,
        ws_docs: dc.length, ws_docs_ready: dc.filter(function (x) { return x.status === "ready"; }).length, tasks_open: open.length, task_due: open.map(function (x) { return x.due_on; }).filter(Boolean).sort()[0] || null,
        last_note: n.map(function (x) { return x.created_at; }).sort().reverse()[0] || null, last_touch: touch, next_meeting: meet });
    };
    var table = function (arr, name) {
      return {
        list: function (sid) { return ok(arr.filter(function (x) { return x.student_id === sid; }).slice()); },
        add: function (o) { var row = Object.assign({ id: D.nid++, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), done_at: null }, o); if (name === "notes" && row.kind === "task" && row.done) row.done_at = row.created_at; arr.push(row); return ok(row); },
        update: function (id, patch) { var row = arr.filter(function (x) { return String(x.id) === String(id); })[0]; if (row) { Object.assign(row, patch, { updated_at: new Date().toISOString() }); if (name === "notes" && row.kind === "task") row.done_at = row.done ? new Date().toISOString() : null; } return ok(row); },
        remove: function (id) { var i = arr.findIndex(function (x) { return String(x.id) === String(id); }); if (i >= 0) arr.splice(i, 1); return ok(true); }
      };
    };
    var monISO = function () { var t = todayD(); return iso(addDays(t, -((t.getDay() + 6) % 7))); };
    DB = {
      claim: function () { return ok({ ok: true, name: D.ws.name }); },
      mine: function () { D.ws.used = D.students.filter(function (s) { return !s.archived; }).length; D.ws.students = D.students.length; return ok(D.ws); },
      roster: function () { return ok(D.students.map(agg)); },
      dash: function () {
        var mon = monISO(), t = isoToday(), since = function (s) { return s && String(s).slice(0, 10) >= mon; }, prevW = function (s) { var x = s && String(s).slice(0, 10); return x && x >= iso(addDays(new Date(mon + "T00:00:00"), -7)) && x < mon; };
        var act = D.students.filter(function (s) { return !s.archived; }).map(function (s) { return s.id; });
        var isAct = function (sid) { return act.indexOf(sid) >= 0; };
        var touches = D.notes.filter(function (n) { return isAct(n.student_id) && since(n.created_at) && ["note", "call", "parent", "meeting", "status"].indexOf(n.kind) >= 0; }).length;
        var moved = {}; D.notes.forEach(function (n) { if (since(n.created_at) || since(n.done_at)) moved[n.student_id] = 1; }); D.docs.forEach(function (x) { if (x.status === "ready" && since(x.updated_at)) moved[x.student_id] = 1; }); D.apps.forEach(function (a) { if (since(a.updated_at)) moved[a.student_id] = 1; });
        return ok({ today: t, week_start: mon, prefs: D.prefs,
          apps: D.apps.filter(function (a) { return isAct(a.student_id) && a.deadline; }).map(function (a) { return { id: a.id, student_id: a.student_id, name: a.name, country: a.country, deadline: a.deadline, status: a.status, url: a.apply_url }; }),
          tasks: D.notes.filter(function (n) { return isAct(n.student_id) && n.kind === "task" && !n.done; }).map(function (n) { return { id: n.id, student_id: n.student_id, text: n.text, due_on: n.due_on, created_at: n.created_at }; }),
          meetings: D.notes.filter(function (n) { return n.kind === "meeting" && n.due_on && daysTo(n.due_on) >= -7 && daysTo(n.due_on) <= 60; }).map(function (n) { return { id: n.id, student_id: n.student_id, text: n.text, due_on: n.due_on, at_time: n.at_time, minutes: n.minutes }; }),
          week: { touches: touches, tasks_done: D.notes.filter(function (n) { return n.kind === "task" && n.done && since(n.done_at); }).length, docs_ready: D.docs.filter(function (x) { return x.status === "ready" && since(x.updated_at); }).length,
                  apps_sent: D.apps.filter(function (a) { return ["applied", "admit", "waitlist"].indexOf(a.status) >= 0 && since(a.updated_at); }).length, statuses: D.notes.filter(function (n) { return n.kind === "status" && since(n.created_at); }).length,
                  moved: Object.keys(moved).filter(isAct), prev: { touches: D.notes.filter(function (n) { return prevW(n.created_at) && ["note", "call", "parent", "meeting", "status"].indexOf(n.kind) >= 0; }).length, tasks_done: D.notes.filter(function (n) { return n.kind === "task" && n.done && prevW(n.done_at); }).length } },
          activity: D.activity.slice() });
      },
      touch: function (progress) { var t = isoToday(), row = D.activity.filter(function (a) { return a.day === t; })[0]; if (row) { row.actions++; row.progress = row.progress || !!progress; } else D.activity.push({ day: t, actions: 1, progress: !!progress }); return ok({ ok: true, day: t }); },
      setPrefs: function (p) { D.prefs = p; return ok({ ok: true }); },
      tg: function () { return ok(D.tg); },
      tgPref: function (prefs) { D.tg.prefs = prefs; return ok(D.tg); },
      importRows: function (rows) { var ins = 0, skip = 0; rows.forEach(function (r) { if (!r.name) return; if (D.students.some(function (s) { return s.name.toLowerCase() === r.name.toLowerCase(); })) { skip++; return; } D.students.push({ id: "demo-n" + (D.nid++), linked: false, user_id: null, name: r.name, grade: r.grade || "11", level: r.level || "bachelor", stage: r.stage || "intake", phone: r.phone || null, email: r.email || null, parent_name: r.parent_name || null, parent_phone: r.parent_phone || null, target: r.target || null, archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }); ins++; }); return ok({ ok: true, inserted: ins, skipped: skip, seats_full: false }); },
      cabinet: function (sid) {
        var st = D.students.filter(function (x) { return x.id === sid; })[0];
        if (!st || !st.linked) return ok({ linked: false });
        return ok({ linked: true, p_adm: st.p_adm, p_sch: st.p_adm == null ? null : Math.max(0.05, st.p_adm - 0.2), profile: { name: st.name, level: st.level, field: ["it"], countries: ["de", "hu"], pro_until: D.ws.ends_on, updated_at: st.cab_last_active },
          apps: D.apps.filter(function (a) { return a.student_id === sid; }).map(function (a) { return { name: a.name, country: a.country, status: a.status === "applied" ? "sent" : "plan", submitted_at: a.status === "applied" || a.status === "admit" ? a.updated_at : null, outcome: a.status === "admit" ? "admit" : null, deadline: a.deadline, url: a.apply_url, readiness: 0.6 }; }),
          docs: D.docs.filter(function (x) { return x.student_id === sid; }).map(function (x) { return { doc_type: x.doc_type, title: x.title, status: x.status, file_name: x.file_name, updated_at: x.updated_at }; }) });
      },
      programs: function () { return ok(D.programs); },
      students: {
        add: function (o) { if (D.students.filter(function (s) { return !s.archived; }).length >= D.ws.seats) return Promise.resolve({ data: null, error: { message: "seats_full" } }); var row = Object.assign({ id: "demo-n" + (D.nid++), linked: false, user_id: null, archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, o); D.students.push(row); return ok(row); },
        update: function (id, patch) { var st = D.students.filter(function (x) { return x.id === id; })[0]; if (st) Object.assign(st, patch, { updated_at: new Date().toISOString() }); return ok(st); },
        remove: function (id) { D.students = D.students.filter(function (x) { return x.id !== id; }); ["apps", "docs", "notes"].forEach(function (k) { D[k] = D[k].filter(function (x) { return x.student_id !== id; }); }); return ok(true); }
      },
      apps: table(D.apps, "apps"), docs: table(D.docs, "docs"), notes: table(D.notes, "notes"),
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
        list: function (sid) { var q = sb.from(name).select("*").eq("student_id", sid); if (name !== "ws_docs") q = q.order("created_at", { ascending: name !== "ws_notes" }); return q.order("id", { ascending: true }); },
        add: function (o) { return sb.from(name).insert(o).select().single(); },
        update: function (id, patch) { patch = Object.assign({}, patch, { updated_at: new Date().toISOString() }); if (name === "ws_notes") delete patch.updated_at; return sb.from(name).update(patch).eq("id", id).select().single(); },
        remove: function (id) { return sb.from(name).delete().eq("id", id); }
      };
    };
    DB = {
      claim: function (t) { return sb.rpc("school_claim", { p_token: t }); },
      mine: function () { return sb.rpc("school_mine", { p_kind: "counselor" }); },
      roster: function () { return sb.rpc("ws_roster"); },
      dash: function () { return sb.rpc("ws_dashboard"); },
      touch: function (progress) { return sb.rpc("ws_touch", { p_progress: !!progress }); },
      setPrefs: function (p) { return sb.rpc("school_set_prefs", { p: p }); },
      tg: function () { return sb.from("tg_links").select("chat_id,prefs").eq("user_id", S.session.user.id).maybeSingle(); },
      tgPref: function (prefs) { return sb.from("tg_links").update({ prefs: prefs }).eq("user_id", S.session.user.id).select("chat_id,prefs").maybeSingle(); },
      importRows: function (rows) { return sb.rpc("ws_import", { p_rows: rows }); },
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
      regen: function () { return sb.rpc("school_regen_code", { p_kind: "counselor" }); }
    };
  }
  /* касание = активность дня; ошибки не показываем (база может быть старой) */
  function touch(progress) { try { DB.touch(progress).then(function (r) { if (r && r.data && S.dash) { var t = isoToday(), row = (S.dash.activity || []).filter(function (a) { return a.day === t; })[0]; if (row) { row.actions++; row.progress = row.progress || !!progress; } else S.dash.activity.push({ day: t, actions: 1, progress: !!progress }); } }); } catch (e) {} }

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
    try { localStorage.setItem("scholary_next", "/prof/cabinet/" + (claim ? "?claim=" + encodeURIComponent(claim) : "")); } catch (e) {}
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
  function out() { if (S.demo) { location.href = "/prof/"; return; } sb.auth.signOut().then(function () { location.href = "/prof/cabinet/"; }); }
  $("btn-out").onclick = out; $("btn-out2").onclick = out;

  /* ---------- вход в workspace ---------- */
  function enter() {
    if (S.entering) return; S.entering = true; show("loading");
    var claim = qs("claim");
    var p = claim ? DB.claim(claim).then(function (r) {
      var j = r.data;
      if (j && j.ok) { track("ws_claim_ok"); history.replaceState(null, "", "/prof/cabinet/" + location.hash); toast("Workspace «" + j.name + "» привязан к вашему аккаунту", "ok"); }
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
      show("v-app"); track("ws_open", { v: 2 });
      var from = qs("from"); if (from && location.search) { track("ws_deeplink", { from: from }); try { history.replaceState(null, "", location.pathname + location.hash); } catch (e) {} }
      if (!location.hash || location.hash === "#/") location.replace("#/today");
      touch(false);
      render();
    });
  }

  /* ---------- загрузка данных ---------- */
  function loadRoster() { return DB.roster().then(function (r) { if (r.error) { fail(r, "Не удалось загрузить учеников"); return []; } S.roster = r.data || []; return S.roster; }); }
  /* ws_dashboard может отсутствовать (база до 044) — тогда работаем на ростере */
  function loadDash() { return DB.dash().then(function (r) { S.dash = r.data && typeof r.data === "object" ? r.data : { apps: [], tasks: [], meetings: [], week: {}, activity: [], prefs: {} }; return S.dash; }).catch(function () { S.dash = { apps: [], tasks: [], meetings: [], week: {}, activity: [], prefs: {} }; return S.dash; }); }
  function loadAll() { return Promise.all([loadRoster(), loadDash()]); }
  function prefs() { return (S.dash && S.dash.prefs) || {}; }
  function active() { return S.roster.filter(function (s) { return !s.archived; }); }
  function byId(id) { return S.roster.filter(function (s) { return s.id === id; })[0]; }

  /* ---------- правила: здоровье, очередь, внимание (63-b § 3) ---------- */
  function docsPct(s) { return s.ws_docs ? Math.round(100 * (s.ws_docs_ready || 0) / s.ws_docs) : null; }
  function health(s) {
    if (!ACTIVE[s.stage]) return { k: "mut", why: [] };
    var why = [], dl = daysTo(s.ws_next_deadline), td = daysTo(s.task_due), ns = daysTo(s.next_step_on), pct = docsPct(s), touchAgo = daysAgo(s.last_touch || s.last_note || s.created_at), st = daysAgo(s.last_status_at);
    if (td != null && td < 0) why.push({ k: "bad", t: "просроченная задача" });
    if (ns != null && ns < 0) why.push({ k: "bad", t: "просрочен следующий шаг" });
    if (dl != null && dl <= 3) why.push({ k: "bad", t: "дедлайн через " + dl + " " + plural(dl, "день", "дня", "дней") });
    else if (dl != null && dl <= 7 && (pct == null || pct < 100)) why.push({ k: "bad", t: "дедлайн ≤ 7 дней, документы " + (pct == null ? "не заведены" : pct + "%") });
    if (!s.next_step) why.push({ k: "warn", t: "нет следующего шага" });
    if (touchAgo == null || touchAgo >= 14) why.push({ k: "warn", t: "без касания " + (touchAgo == null ? "" : touchAgo + " дн.") });
    if (dl != null && dl > 7 && dl <= 14 && (pct == null || pct < 70)) why.push({ k: "warn", t: "дедлайн ≤ 14 дней, документы " + (pct == null ? "не заведены" : pct + "%") });
    if ((st == null || st >= 21) && s.stage !== "intake") why.push({ k: "warn", t: "семья без статуса " + (st == null ? "" : st + " дн.") });
    var k = why.some(function (w) { return w.k === "bad"; }) ? "bad" : why.length ? "warn" : "ok";
    return { k: k, why: why };
  }
  function hdot(s) { var h = health(s); return '<i class="hdot ' + h.k + '" title="' + esc(h.why.map(function (w) { return w.t; }).join(" · ") || "в порядке") + '"></i>'; }
  function queue() {
    var d = S.dash || {}, out = [], t = todayD();
    var st = {}; active().forEach(function (s) { st[s.id] = s; });
    (d.tasks || []).forEach(function (x) { var dd = daysTo(x.due_on); if (st[x.student_id] && dd != null && dd < 0) out.push({ p: 1, kind: "task", id: x.id, s: st[x.student_id], text: x.text, sub: "просрочено · " + fmtD(x.due_on), d: dd }); });
    (d.apps || []).forEach(function (a) { var dd = daysTo(a.deadline); if (st[a.student_id] && (a.status === "study" || a.status === "prep") && dd != null && dd >= 0 && dd <= 7) out.push({ p: 2, kind: "deadline", id: a.id, s: st[a.student_id], text: a.name, sub: (a.country ? a.country + " · " : "") + APP_L[a.status], d: dd, url: a.url, deadline: a.deadline }); });
    (d.tasks || []).forEach(function (x) { var dd = daysTo(x.due_on); if (st[x.student_id] && dd === 0) out.push({ p: 3, kind: "task", id: x.id, s: st[x.student_id], text: x.text, sub: "сегодня", d: 0 }); });
    (d.meetings || []).forEach(function (m) { var dd = daysTo(m.due_on); if (st[m.student_id] && dd != null && dd >= 0 && dd <= 1) out.push({ p: 4, kind: "meeting", id: m.id, s: st[m.student_id], text: m.text, sub: (dd === 0 ? "сегодня" : "завтра") + (m.at_time ? " в " + fmtT(m.at_time) : ""), d: dd }); });
    active().forEach(function (s) { var ns = daysTo(s.next_step_on); if (ACTIVE[s.stage] && s.next_step && ns != null && ns < 0) out.push({ p: 5, kind: "step", id: s.id, s: s, text: s.next_step, sub: "следующий шаг · просрочен " + fmtD(s.next_step_on), d: ns }); });
    (d.apps || []).forEach(function (a) { var dd = daysTo(a.deadline); if (st[a.student_id] && (a.status === "study" || a.status === "prep") && dd != null && dd > 7 && dd <= 45) out.push({ p: 6, kind: "deadline", id: a.id, s: st[a.student_id], text: a.name, sub: (a.country ? a.country + " · " : "") + APP_L[a.status], d: dd, url: a.url, deadline: a.deadline }); });
    (d.tasks || []).forEach(function (x) { var dd = daysTo(x.due_on); if (st[x.student_id] && dd != null && dd > 0 && dd <= 7) out.push({ p: 7, kind: "task", id: x.id, s: st[x.student_id], text: x.text, sub: "до " + fmtD(x.due_on), d: dd }); });
    out.sort(function (a, b) { return a.p - b.p || a.d - b.d; });
    return out;
  }
  function urgentCount(q) { return (q || queue()).filter(function (x) { return x.p <= 2 || x.p === 5; }).length; }
  function attention() {
    return active().map(function (s) { return { s: s, h: health(s) }; }).filter(function (x) { return x.h.k === "bad" || x.h.k === "warn"; })
      .sort(function (a, b) { return (a.h.k === "bad" ? 0 : 1) - (b.h.k === "bad" ? 0 : 1) || b.h.why.length - a.h.why.length; });
  }
  function weekProgress() { var w = (S.dash && S.dash.week) || {}; return { moved: (w.moved || []).length, tasks: w.tasks_done || 0, docs: w.docs_ready || 0, sent: w.apps_sent || 0, statuses: w.statuses || 0, touches: w.touches || 0, prev: w.prev || {} }; }
  function rhythm() {
    var p = prefs(), goal = Math.max(5, Math.min(40, +p.touch_goal || 10));
    var wp = Path ? Path.weeksProgress((S.dash && S.dash.activity) || [], p.quiet || [], todayD()) : { streak: 0, total: 0, thisWeek: false, quietThisWeek: false };
    return { goal: goal, touches: weekProgress().touches, streak: wp.streak, total: wp.total, thisWeek: wp.thisWeek, quiet: wp.quietThisWeek, off: p.rhythm === false };
  }
  function seasonHint() {
    var wk = Path ? Path.weekInfo(todayD()) : null, t = todayD(), key = (t.getMonth() + 1) + "-" + (t.getDate() <= 15 ? 1 : 2), h = HINTS[key] || DEFAULT_HINT;
    var act = active().filter(function (s) { return ACTIVE[s.stage]; }), d = S.dash || {};
    var x = { noApps: act.filter(function (s) { return !s.ws_apps; }).length, noStep: act.filter(function (s) { return !s.next_step; }).length,
      docsZero: act.filter(function (s) { return (s.stage === "docs" || s.stage === "applying") && !(s.ws_docs_ready > 0); }).length,
      noStatus: act.filter(function (s) { return s.stage !== "intake" && (daysAgo(s.last_status_at) == null || daysAgo(s.last_status_at) >= 21); }).length,
      idle: act.filter(function (s) { var a = daysAgo(s.last_touch || s.last_note || s.created_at); return a == null || a >= 14; }).length,
      dl30: (d.apps || []).filter(function (a) { var dd = daysTo(a.deadline); return (a.status === "study" || a.status === "prep") && dd != null && dd >= 0 && dd <= 30; }).length,
      dl30bad: (d.apps || []).filter(function (a) { var dd = daysTo(a.deadline), s = byId(a.student_id); return s && (a.status === "study" || a.status === "prep") && dd != null && dd >= 0 && dd <= 30 && (docsPct(s) == null || docsPct(s) < 100); }).length,
      sent: (d.apps || []).filter(function (a) { return a.status === "applied" || a.status === "waitlist"; }).length,
      offers: act.concat(S.roster.filter(function (s) { return s.stage === "admitted"; })).filter(function (s) { return s.ws_offers > 0; }).length };
    return { week: wk, title: h.t, text: h.f(x), act: h.act };
  }
  function weekLabel(wk) { return wk ? "Неделя " + wk.n + " сезона · " + wk.label : ""; }

  /* ---------- роутер ---------- */
  function route() {
    var h = location.hash.replace(/^#\/?/, ""), q = "", i = h.indexOf("?"); if (i >= 0) { q = h.slice(i + 1); h = h.slice(0, i); }
    var m = h.match(/^s\/([\w-]+)(?:\/(\w+))?/); if (m) return { t: "student", id: m[1], tab: m[2] || "overview" };
    var f = (q.match(/(?:^|&)f=([\w-]+)/) || [])[1] || "";
    return { t: ["today", "week", "calendar", "students", "settings"].indexOf(h) >= 0 ? h : "today", f: f };
  }
  window.addEventListener("hashchange", function () { if (S.ws) render(); });
  function render() {
    var r = route();
    document.querySelectorAll("#tabs a").forEach(function (a) { a.classList.toggle("on", a.getAttribute("data-t") === (r.t === "student" ? "students" : r.t)); });
    closeModal(); window.scrollTo(0, 0);
    if (r.t === "today") viewToday();
    else if (r.t === "week") viewWeek();
    else if (r.t === "calendar") viewCalendar();
    else if (r.t === "students") { if (r.f) { S.filter = r.f === "all" ? "" : r.f; S.stage = ""; } viewStudents(); }
    else if (r.t === "student") viewStudent(r.id, r.tab);
    else viewSettings();
  }
  function go(act) {
    var p = String(act || "").split(":");
    if (p[0] === "students") { S.filter = p[1] === "docs" ? "docs" : p[1] || ""; S.stage = p[1] === "submitted" || p[1] === "admitted" ? p[1] : ""; if (S.stage) S.filter = ""; location.hash = "#/students"; return; }
    if (p[0] === "calendar") { location.hash = "#/calendar"; return; }
    if (p[0] === "week") { location.hash = "#/week"; return; }
    location.hash = "#/today";
  }

  /* ---------- Сегодня ---------- */
  function studentLink(s, tab) { return '<a href="#/s/' + esc(s.id) + '/' + (tab || "overview") + '" style="color:inherit">' + esc(s.name) + "</a>"; }
  function queueItemHTML(x) {
    var s = x.s, act = "";
    if (x.kind === "task") act = '<label class="qdone"><input type="checkbox" data-qtask="' + x.id + '" aria-label="Закрыть задачу"></label>';
    else if (x.kind === "deadline") act = (safeUrl(x.url) ? '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="' + esc(safeUrl(x.url)) + '">Подать</a>' : "") + '<a class="btn btn-soft btn-sm" href="#/s/' + esc(s.id) + '/apps">Открыть</a>';
    else if (x.kind === "meeting") act = (s.parent_phone || s.phone ? '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/' + waNum(s.parent_phone || s.phone) + '">WhatsApp</a>' : "") + '<a class="btn btn-soft btn-sm" href="#/s/' + esc(s.id) + '/overview">Открыть</a>';
    else act = '<button class="btn btn-soft btn-sm" data-step="' + esc(s.id) + '">Шаг</button>';
    return '<div class="q' + (x.p <= 2 || x.p === 5 ? " urgent" : "") + '"><span class="qk ' + x.kind + '">' + ({ task: "☑", deadline: "⏰", meeting: "🗓", step: "→" })[x.kind] + '</span><div class="t"><b>' + esc(x.text) + '</b><span class="xs mut">' + studentLink(s) + " · " + esc(x.sub) + "</span></div><div class=\"qa\">" + act + "</div></div>";
  }
  function progressLine(w) {
    var parts = [];
    if (w.moved) parts.push("<b>" + w.moved + "</b> " + plural(w.moved, "ученик продвинулся", "ученика продвинулись", "учеников продвинулись"));
    if (w.tasks) parts.push("<b>" + w.tasks + "</b> " + plural(w.tasks, "задача закрыта", "задачи закрыты", "задач закрыто"));
    if (w.docs) parts.push("<b>" + w.docs + "</b> " + plural(w.docs, "документ готов", "документа готовы", "документов готово"));
    if (w.sent) parts.push("<b>" + w.sent + "</b> " + plural(w.sent, "подача отправлена", "подачи отправлены", "подач отправлено"));
    if (w.statuses) parts.push("<b>" + w.statuses + "</b> " + plural(w.statuses, "статус семье", "статуса семьям", "статусов семьям"));
    return parts.length ? "На этой неделе: " + parts.join(" · ") : "На этой неделе движения пока нет — первая закрытая задача его начнёт";
  }
  function rhythmHTML(compact) {
    var r = rhythm(); if (r.off) return "";
    var pct = Math.min(100, Math.round(100 * r.touches / r.goal));
    return '<div class="card" style="margin-top:14px"><div class="h-row"><b class="sm">Мой ритм</b><a class="xs" href="#/settings">настроить</a></div>' +
      '<div class="sm" style="margin-top:6px">Касаний на неделе: <b>' + r.touches + "</b> из " + r.goal + '</div><div class="bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="xs mut" style="margin-top:8px">' + (r.quiet ? "Неделя на паузе" : r.streak ? "🔥 " + r.streak + " " + plural(r.streak, "неделя", "недели", "недель") + " без просрочек подряд" : "Первая неделя без просрочек — впереди") + (r.total ? " · всего " + r.total : "") + "</div>" +
      (compact ? "" : '<div class="xs mut" style="margin-top:2px">Касание — звонок, заметка, встреча или статус семье. Пропуск раз в месяц серию не рвёт.</div>') + "</div>";
  }
  function funnelHTML() {
    var cnt = {}; active().forEach(function (s) { cnt[s.stage] = (cnt[s.stage] || 0) + 1; });
    var max = Math.max(1, Math.max.apply(null, STAGES.map(function (s) { return cnt[s[0]] || 0; })));
    return '<div class="card" style="margin-top:14px"><b class="sm">Воронка</b>' + STAGES.map(function (st) { var n = cnt[st[0]] || 0; return '<a class="fun" href="#/students?f=stage-' + st[0] + '"><span>' + st[1] + '</span><i style="width:' + Math.round(100 * n / max) + '%"></i><b>' + n + "</b></a>"; }).join("") + "</div>";
  }
  function weekStripHTML() {
    var t = todayD(), mon = addDays(t, -((t.getDay() + 6) % 7)), d = S.dash || {}, st = {}; active().forEach(function (s) { st[s.id] = 1; });
    var days = []; for (var i = 0; i < 7; i++) { var day = addDays(mon, i), k = iso(day); days.push({ k: k, day: day, n: (d.tasks || []).filter(function (x) { return st[x.student_id] && x.due_on === k; }).length + (d.meetings || []).filter(function (x) { return st[x.student_id] && x.due_on === k; }).length + (d.apps || []).filter(function (x) { return st[x.student_id] && (x.status === "study" || x.status === "prep") && x.deadline === k; }).length }); }
    return '<div class="card"><div class="h-row"><b class="sm">Эта неделя</b><a class="xs" href="#/week">план недели →</a></div><div class="wstrip">' + days.map(function (x) { return '<a href="#/week" class="wd' + (x.k === iso(t) ? " today" : "") + '"><span>' + Path.WD_SHORT[(x.day.getDay() + 6) % 7] + "</span><b>" + x.day.getDate() + "</b><i>" + (x.n ? x.n : "") + "</i></a>"; }).join("") + "</div></div>";
  }
  function viewToday() {
    var v = $("view");
    v.innerHTML = '<div class="head"><div><div class="h1">Сегодня</div><div class="sm mut" id="todaySub">Собираю, что горит…</div></div><div class="tools" style="margin:0"><button class="btn btn-ghost btn-sm" id="btn-quick">Записать</button><button class="btn btn-primary btn-sm" id="btn-add">+ Ученик</button></div></div><div id="todayBody"><div class="spin"></div></div>';
    $("btn-add").onclick = addStudentModal; $("btn-quick").onclick = function () { quickNoteModal(); };
    loadAll().then(function () {
      var n = active().length, q = queue(), urg = urgentCount(q), att = attention(), w = weekProgress(), hint = seasonHint(), wide = window.innerWidth >= 1100;
      $("todaySub").textContent = fmtDL(todayD()) + " · " + n + " " + plural(n, "ученик", "ученика", "учеников") + (hint.week ? " · " + weekLabel(hint.week) : "");
      track("ws_today_view", { urgent: urg, n: n });
      var h = "";
      if (!n) {
        h += '<div class="card glow"><div class="h2">С чего начать</div><p class="sm mut" style="margin:4px 0 12px">Workspace пустой — три шага, и он начнёт работать на вас.</p>' +
          '<div class="lst"><span class="pill pill-acc">1</span><div class="t"><b>Добавьте учеников</b><span class="xs mut">По одному — или сразу списком из Excel</span></div><div class="tools" style="margin:0"><button class="btn btn-primary btn-sm" id="ob-add">Добавить</button><a class="btn btn-ghost btn-sm" href="#/settings">Импорт</a></div></div>' +
          '<div class="lst"><span class="pill pill-acc">2</span><div class="t"><b>Отправьте им ссылку на регистрацию</b><span class="xs mut">Ученик получит Scholary Pro, а вы — его шансы и кабинет</span></div><a class="btn btn-ghost btn-sm" href="#/settings">Ссылка</a></div>' +
          '<div class="lst"><span class="pill pill-acc">3</span><div class="t"><b>Программы, дедлайны и следующий шаг</b><span class="xs mut">Из каталога 236 программ или свои — «Сегодня» само покажет очередь и что требует внимания</span></div></div></div>';
        $("todayBody").innerHTML = h; $("ob-add").onclick = addStudentModal; return;
      }
      var prio = urg ? '<div class="prio bad"><b>' + urg + " " + plural(urg, "срочное", "срочных", "срочных") + "</b> · " + (q.length - urg) + " на этой неделе</div>" : '<div class="prio ok"><b>Всё под контролем</b> — срочного нет · ' + q.length + " " + plural(q.length, "пункт", "пункта", "пунктов") + " на неделе</div>";
      h += prio + '<div class="sm mut" style="margin:8px 0 12px">' + progressLine(w) + "</div>";
      h += '<div class="cols"><div>';
      var qn = q.slice(0, 8), rest = q.length - qn.length;
      h += '<div class="card"><div class="h-row"><div class="h2">Сейчас</div><span class="xs mut">просроченное → дедлайн ≤ 7 дней → сегодня → встречи → шаги → 45 дней</span></div>' + (q.length ? qn.map(queueItemHTML).join("") + (rest ? '<button class="lnk xs" id="q-more">ещё ' + rest + "</button>" : "") : '<div class="empty">Очередь пуста. Добавляйте программы с дедлайнами и задачи со сроком — они появятся здесь в порядке срочности.</div>') + "</div>";
      h += '<div class="card" style="margin-top:14px"><div class="h-row"><div class="h2">Требует внимания</div><a class="xs" href="#/students?f=attention">все ' + att.length + "</a></div>" + (att.length ? att.slice(0, 5).map(function (x) {
        return '<div class="lst"><span class="hdot ' + x.h.k + '"></span><div class="t"><b>' + studentLink(x.s) + '</b><span class="xs mut">' + esc(STAGE_L[x.s.stage]) + " · " + esc(x.h.why.map(function (y) { return y.t; }).join(" · ")) + "</span></div>" + (x.h.why.some(function (y) { return /шага/.test(y.t); }) ? '<button class="btn btn-soft btn-sm" data-step="' + esc(x.s.id) + '">Шаг</button>' : '<a class="btn btn-ghost btn-sm" href="#/s/' + esc(x.s.id) + '/overview">Открыть</a>') + "</div>";
      }).join("") : '<div class="empty">У всех активных учеников есть следующий шаг, касание за две недели и документы к дедлайнам.</div>') + "</div>";
      var mt = (S.dash.meetings || []).filter(function (m) { var dd = daysTo(m.due_on); return dd != null && dd >= 0 && dd <= 6 && byId(m.student_id); });
      h += '<div class="card" style="margin-top:14px"><div class="h-row"><div class="h2">Встречи на неделе</div><button class="lnk xs" id="m-add">+ встреча</button></div>' + (mt.length ? mt.map(function (m) { var s = byId(m.student_id), dd = daysTo(m.due_on); return '<div class="lst"><span class="pill ' + (dd === 0 ? "pill-acc" : "pill-mut") + '">' + (dd === 0 ? "сегодня" : dd === 1 ? "завтра" : fmtD(m.due_on)) + (m.at_time ? " " + fmtT(m.at_time) : "") + '</span><div class="t"><b>' + studentLink(s) + '</b><span class="xs mut">' + esc(m.text) + "</span></div>" + (s.parent_phone ? '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/' + waNum(s.parent_phone) + "?text=" + encodeURIComponent(meetReminder(s, m)) + '">Напомнить</a>' : "") + "</div>"; }).join("") : '<div class="empty">Встреч на этой неделе нет. Созвон с семьёй, записанный сюда, попадёт в календарь и в очередь дня.</div>') + "</div>";
      h += "</div><div>";
      if (wide) h += weekStripHTML();
      h += '<div class="card' + (wide ? '" style="margin-top:14px' : "") + '"><div class="xs" style="color:var(--accent-dark);font-weight:800;letter-spacing:.04em;text-transform:uppercase">' + (hint.week ? "Неделя " + hint.week.n + " сезона · " : "") + esc(hint.title) + '</div><div class="sm" style="margin-top:6px"><b>' + esc(hint.text) + '</b></div><button class="btn btn-soft btn-sm" style="margin-top:10px" data-go="' + esc(hint.act) + '">Посмотреть</button></div>';
      if (wide) h += funnelHTML() + rhythmHTML(true);
      else h += rhythmHTML(true);
      h += "</div></div>";
      $("todayBody").innerHTML = h;
      var more = $("q-more"); if (more) more.onclick = function () { more.parentNode.insertAdjacentHTML("beforeend", q.slice(8).map(queueItemHTML).join("")); more.remove(); };
      $("m-add").onclick = function () { meetingModal(null); };
      $("todayBody").addEventListener("change", function (e) {
        var cb = e.target.closest("[data-qtask]"); if (!cb) return;
        DB.notes.update(cb.getAttribute("data-qtask"), { done: true }).then(function (r) { if (r.error) { fail(r); cb.checked = false; return; } toast("Задача закрыта", "ok"); cb.closest(".q").style.opacity = ".4"; track("ws_queue_done", { kind: "task" }); touch(false); var sid = (cb.closest(".q").querySelector("a[href^='#/s/']") || {}).getAttribute ? cb.closest(".q").querySelector("a[href^='#/s/']").getAttribute("href").split("/")[2] : null; var s = sid && byId(sid); if (s && !s.next_step) setTimeout(function () { nextStepModal(s, "Задача закрыта — какой следующий шаг?"); }, 400); });
      });
      $("todayBody").addEventListener("click", function (e) {
        var b = e.target.closest("[data-step]"); if (b) { var s = byId(b.getAttribute("data-step")); if (s) nextStepModal(s); return; }
        var g = e.target.closest("[data-go]"); if (g) { go(g.getAttribute("data-go")); }
      });
    });
  }
  function meetReminder(s, m) {
    var who = S.ws && S.ws.contact_name ? S.ws.contact_name : "ваш профориентолог";
    return "Здравствуйте! Напоминаю о нашей встрече по " + firstName(s.name) + ": " + fmtDL(m.due_on) + (m.at_time ? " в " + fmtT(m.at_time) : "") + ". Тема: " + m.text + ". Если время не подходит — напишите, перенесём. " + who;
  }

  /* ---------- Неделя ---------- */
  function viewWeek() {
    var v = $("view");
    v.innerHTML = '<div class="head"><div><div class="h1">Неделя</div><div class="sm mut" id="wkSub">Загружаю…</div></div><div class="tools" style="margin:0"><button class="btn btn-ghost btn-sm" id="wk-prev">‹</button><button class="btn btn-ghost btn-sm" id="wk-today">Эта неделя</button><button class="btn btn-ghost btn-sm" id="wk-next">›</button></div></div><div id="wkBody"><div class="spin"></div></div>';
    $("wk-prev").onclick = function () { S.weekOff--; drawWeek(); }; $("wk-next").onclick = function () { S.weekOff++; drawWeek(); }; $("wk-today").onclick = function () { S.weekOff = 0; drawWeek(); };
    loadAll().then(drawWeek);
  }
  function drawWeek() {
    var t = todayD(), mon = addDays(addDays(t, -((t.getDay() + 6) % 7)), 7 * S.weekOff), sun = addDays(mon, 6), d = S.dash || {}, st = {}; active().forEach(function (s) { st[s.id] = s; });
    var wk = Path ? Path.weekInfo(addDays(mon, 3)) : null;   /* середина недели: неделя 31.08–06.09 — первая недели сезона, а не 44-я прошлого */
    $("wkSub").textContent = fmtD(mon) + " — " + fmtDL(sun) + (wk ? " · неделя " + wk.n + " сезона" : "");
    var days = []; for (var i = 0; i < 7; i++) { var day = addDays(mon, i), k = iso(day); days.push({ k: k, day: day, items: [] }); }
    var put = function (k, item) { var dd = days.filter(function (x) { return x.k === k; })[0]; if (dd) dd.items.push(item); };
    (d.tasks || []).forEach(function (x) { if (st[x.student_id] && x.due_on) put(x.due_on, { kind: "task", id: x.id, s: st[x.student_id], text: x.text }); });
    (d.meetings || []).forEach(function (m) { if (st[m.student_id] && m.due_on) put(m.due_on, { kind: "meeting", id: m.id, s: st[m.student_id], text: m.text, time: m.at_time }); });
    (d.apps || []).forEach(function (a) { if (st[a.student_id] && (a.status === "study" || a.status === "prep") && a.deadline) put(a.deadline, { kind: "deadline", id: a.id, s: st[a.student_id], text: a.name, url: a.url }); });
    active().forEach(function (s) { if (s.next_step && s.next_step_on) put(s.next_step_on, { kind: "step", id: s.id, s: s, text: s.next_step }); });
    var overdue = (d.tasks || []).filter(function (x) { return st[x.student_id] && x.due_on && x.due_on < iso(mon) && S.weekOff === 0; });
    var h = '<div class="wgrid">' + days.map(function (x) {
      var isT = x.k === iso(t);
      return '<div class="wday' + (isT ? " today" : "") + '"><div class="wdh"><span>' + Path.WD_FULL[(x.day.getDay() + 6) % 7] + "</span><b>" + x.day.getDate() + "</b></div>" +
        (x.items.length ? x.items.map(function (it) {
          if (it.kind === "task") return '<label class="wi task"><input type="checkbox" data-wtask="' + it.id + '"><span><b>' + esc(it.text) + '</b><i>' + esc(firstName(it.s.name)) + " " + esc((it.s.name.split(" ")[1] || "")[0] || "") + ".</i></span></label>";
          if (it.kind === "meeting") return '<a class="wi meeting" href="#/s/' + esc(it.s.id) + '/overview"><span><b>' + (it.time ? fmtT(it.time) + " · " : "") + esc(it.text) + "</b><i>" + esc(it.s.name) + "</i></span></a>";
          if (it.kind === "deadline") return '<a class="wi deadline" href="#/s/' + esc(it.s.id) + '/apps"><span><b>⏰ ' + esc(it.text) + "</b><i>" + esc(it.s.name) + "</i></span></a>";
          return '<a class="wi step" href="#/s/' + esc(it.s.id) + '/overview"><span><b>→ ' + esc(it.text) + "</b><i>" + esc(it.s.name) + "</i></span></a>";
        }).join("") : '<div class="xs mut" style="padding:6px 2px">—</div>') + "</div>";
    }).join("") + "</div>";
    if (overdue.length) h = '<div class="card" style="margin-bottom:12px;border-color:#F3C9C4"><div class="h2" style="color:var(--bad)">Просрочено с прошлых недель · ' + overdue.length + "</div>" + overdue.slice(0, 6).map(function (x) { var s = st[x.student_id]; return '<label class="lst" style="cursor:pointer"><input type="checkbox" data-wtask="' + x.id + '" style="width:20px;height:20px"><div class="t"><b>' + esc(x.text) + '</b><span class="xs mut">' + studentLink(s) + " · " + fmtD(x.due_on) + "</span></div></label>"; }).join("") + "</div>" + h;
    /* обзор недели */
    var w = weekProgress(), att = attention(), noStep = active().filter(function (s) { return ACTIVE[s.stage] && !s.next_step; }), r = rhythm();
    h += '<div class="cols" style="margin-top:14px"><div><div class="card glow"><div class="h2">Обзор недели</div>' +
      '<div class="sm" style="margin:6px 0 4px">' + progressLine(w) + "</div>" +
      '<div class="xs mut">Прошлая неделя: ' + (w.prev.touches || 0) + " " + plural(w.prev.touches || 0, "касание", "касания", "касаний") + " · " + (w.prev.tasks_done || 0) + " " + plural(w.prev.tasks_done || 0, "задача закрыта", "задачи закрыты", "задач закрыто") + "</div>" +
      (r.off ? "" : '<div class="xs mut" style="margin-top:4px">' + (r.streak ? "🔥 " + r.streak + " " + plural(r.streak, "неделя", "недели", "недель") + " без просрочек подряд" : "серия без просрочек начнётся с этой недели") + "</div>") +
      '<div class="h3" style="margin-top:14px">Что застряло · ' + att.length + "</div>" + (att.length ? att.slice(0, 6).map(function (x) { return '<div class="lst"><span class="hdot ' + x.h.k + '"></span><div class="t"><b>' + studentLink(x.s) + '</b><span class="xs mut">' + esc(x.h.why.map(function (y) { return y.t; }).join(" · ")) + "</span></div></div>"; }).join("") + (att.length > 6 ? '<a class="xs" href="#/students?f=attention">все ' + att.length + "</a>" : "") : '<div class="empty">Ничего не застряло.</div>') +
      '<div class="tools"><button class="btn btn-primary" id="wk-planned"' + (r.thisWeek ? " disabled" : "") + ">" + (r.thisWeek ? "Неделя спланирована ✓" : "Неделя спланирована") + '</button><button class="btn btn-ghost btn-sm" id="wk-quiet">' + (r.quiet ? "Снять паузу" : "Пауза недели") + "</button></div></div></div>" +
      '<div><div class="card"><div class="h2">Без следующего шага · ' + noStep.length + '</div><div class="xs mut" style="margin-bottom:6px">Шаг с датой делается в разы чаще, чем «надо бы» — назначьте по одному каждому</div>' +
      (noStep.length ? noStep.slice(0, 12).map(function (s) { return '<div class="stepline" data-sid="' + esc(s.id) + '"><b class="sm">' + esc(s.name) + '</b><div class="steprow"><input class="f" placeholder="' + esc((STEP_TPL[s.stage] || [])[0] || "Следующий шаг") + '" list="tpl-' + esc(s.stage) + '"><input class="f" type="date" value="' + isoToday(3) + '"><button class="btn btn-soft btn-sm" data-savestep="' + esc(s.id) + '">Сохранить</button></div></div>'; }).join("") : '<div class="empty">У всех активных учеников шаг назначен.</div>') + "</div></div></div>" +
      Object.keys(STEP_TPL).map(function (k) { return '<datalist id="tpl-' + k + '">' + STEP_TPL[k].map(function (x) { return '<option value="' + esc(x) + '">'; }).join("") + "</datalist>"; }).join("");
    $("wkBody").innerHTML = h;
    $("wkBody").onchange = function (e) {
      var cb = e.target.closest("[data-wtask]"); if (!cb) return;
      DB.notes.update(cb.getAttribute("data-wtask"), { done: true }).then(function (r2) { if (r2.error) { fail(r2); cb.checked = false; return; } toast("Задача закрыта", "ok"); cb.closest(".wi,.lst").style.opacity = ".4"; track("ws_queue_done", { kind: "task", from: "week" }); touch(false); });
    };
    $("wkBody").onclick = function (e) {
      var b = e.target.closest("[data-savestep]"); if (b) { var line = b.closest(".stepline"), inp = line.querySelectorAll("input"), text = inp[0].value.trim() || inp[0].placeholder, on = inp[1].value || null; var s = byId(b.getAttribute("data-savestep")); saveStep(s, text, on, function () { line.style.opacity = ".4"; b.disabled = true; b.textContent = "✓"; }); return; }
      if (e.target.id === "wk-planned") { touch(true); track("ws_week_planned"); toast("Неделя спланирована · серия продолжается", "ok"); e.target.disabled = true; e.target.textContent = "Неделя спланирована ✓"; return; }
      if (e.target.id === "wk-quiet") { var p = Object.assign({}, prefs()), q = (p.quiet || []).slice(), wkq = Path.weekInfo(todayD()).key, i = q.indexOf(wkq); if (i >= 0) q.splice(i, 1); else q.push(wkq); p.quiet = q.slice(-20); savePrefs(p, function () { toast(i >= 0 ? "Пауза снята" : "Неделя на паузе — серия не прервётся", "ok"); drawWeek(); }); }
    };
    track("ws_week_view", { off: S.weekOff });
  }
  function saveStep(s, text, on, cb) {
    if (!s) return;
    DB.students.update(s.id, { next_step: text ? text.slice(0, 140) : null, next_step_on: on || null }).then(function (r) {
      if (r.error) { fail(r, "Шаг не сохранился"); return; }
      s.next_step = text ? text.slice(0, 140) : null; s.next_step_on = on || null; track("ws_next_step_set", { stage: s.stage }); touch(false);
      if (cb) cb();
    });
  }
  function savePrefs(p, cb) { DB.setPrefs(p).then(function (r) { if (r.error) { fail(r, "Настройки не сохранились"); return; } if (S.dash) S.dash.prefs = p; if (cb) cb(); }); }
  function nextStepModal(s, title) {
    var tpl = STEP_TPL[s.stage] || [];
    openModal('<div class="h2">' + esc(title || "Следующий шаг") + '</div><div class="xs mut">' + esc(s.name) + " · " + esc(STAGE_L[s.stage]) + '</div><form id="f-step"><label class="fl">Что дальше</label><input class="f" name="text" maxlength="140" value="' + esc(s.next_step || "") + '" placeholder="' + esc(tpl[0] || "Например: заказать апостиль") + '" list="tpl-modal"><datalist id="tpl-modal">' + tpl.map(function (x) { return '<option value="' + esc(x) + '">'; }).join("") + '</datalist><div class="chips" style="margin:8px 0 0">' + tpl.map(function (x) { return '<button type="button" class="chip" data-tpl="' + esc(x) + '">' + esc(x) + "</button>"; }).join("") + '</div><label class="fl">К какому дню</label><input class="f" name="on" type="date" value="' + esc(s.next_step_on || isoToday(3)) + '"><div class="tools"><button class="btn btn-primary" type="submit">Сохранить</button><button class="btn btn-ghost" type="button" data-close>Позже</button>' + (s.next_step ? '<button class="btn btn-ghost btn-sm" type="button" id="step-clear" style="margin-left:auto">Убрать шаг</button>' : "") + "</div></form>", function (m) {
      var f = m.querySelector("#f-step");
      m.querySelectorAll("[data-tpl]").forEach(function (b) { b.onclick = function () { f.text.value = b.getAttribute("data-tpl"); }; });
      f.onsubmit = function (e) { e.preventDefault(); var text = f.text.value.trim(); if (!text) { f.text.focus(); return; } saveStep(s, text, f.on.value || null, function () { closeModal(); toast("Шаг назначен", "ok"); render(); }); };
      var c = m.querySelector("#step-clear"); if (c) c.onclick = function () { saveStep(s, null, null, function () { closeModal(); render(); }); };
    });
  }
  function quickNoteModal(s, kind) {
    var opts = active().slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name), "ru"); });
    openModal('<div class="h2">Записать</div><div class="xs mut">Звонок, договорённость или задача — за 10 секунд</div><form id="f-quick">' +
      (s ? '<input type="hidden" name="sid" value="' + esc(s.id) + '"><div class="sm" style="margin-top:8px"><b>' + esc(s.name) + "</b></div>" : '<label class="fl">Ученик</label><select class="f" name="sid" required><option value="">Выберите…</option>' + opts.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + "</option>"; }).join("") + "</select>") +
      '<label class="fl">Тип</label><div class="chips" style="margin:0" id="qk">' + NOTE_K.map(function (k) { return '<button type="button" class="chip' + (k[0] === (kind || "call") ? " on" : "") + '" data-k="' + k[0] + '">' + k[1] + "</button>"; }).join("") + '</div><input type="hidden" name="kind" value="' + esc(kind || "call") + '">' +
      '<div id="q-due" ' + ((kind || "call") === "task" || kind === "meeting" ? "" : "hidden") + '><div class="grid2"><div><label class="fl">Дата</label><input class="f" name="due_on" type="date" value="' + isoToday(1) + '"></div><div id="q-time"' + (kind === "meeting" ? "" : " hidden") + '><label class="fl">Время</label><input class="f" name="at_time" type="time" value="18:00"></div></div></div>' +
      '<label class="fl">Текст</label><textarea class="f" name="text" required maxlength="2000" placeholder="Созвон с мамой: договорились о репетиторе по IELTS, следующий контакт через неделю"></textarea>' +
      '<div class="tools"><button class="btn btn-primary" type="submit">Записать</button><button class="btn btn-ghost" type="button" data-close>Отмена</button></div></form>', function (m) {
      var f = m.querySelector("#f-quick");
      m.querySelector("#qk").onclick = function (e) { var b = e.target.closest("[data-k]"); if (!b) return; m.querySelectorAll("#qk .chip").forEach(function (c) { c.classList.toggle("on", c === b); }); f.kind.value = b.getAttribute("data-k"); m.querySelector("#q-due").hidden = !(f.kind.value === "task" || f.kind.value === "meeting"); m.querySelector("#q-time").hidden = f.kind.value !== "meeting"; };
      f.onsubmit = function (e) {
        e.preventDefault(); var o = formData(f), b = f.querySelector("[type=submit]"); b.disabled = true;
        var row = { student_id: o.sid, kind: o.kind, text: o.text, done: o.kind === "task" ? false : null, due_on: (o.kind === "task" || o.kind === "meeting") && o.due_on ? o.due_on : null, at_time: o.kind === "meeting" && o.at_time ? o.at_time : null };
        DB.notes.add(row).then(function (r) { b.disabled = false; if (r.error) { fail(r, "Не записалось"); return; } closeModal(); toast(o.kind === "task" ? "Задача создана" : o.kind === "meeting" ? "Встреча записана" : "Записано", "ok"); track("ws_note_add", { kind: o.kind, quick: 1 }); if (o.kind === "meeting") track("ws_meeting_add"); touch(false); var st = byId(o.sid); if (st && !st.next_step && o.kind !== "task") setTimeout(function () { nextStepModal(st, "Записано — какой следующий шаг?"); }, 300); else render(); });
      };
    });
  }
  function meetingModal(s) { quickNoteModal(s, "meeting"); }

  /* ---------- Календарь ---------- */
  function viewCalendar() {
    var v = $("view");
    v.innerHTML = '<div class="head"><div><div class="h1">Календарь</div><div class="sm mut">Дедлайны всех учеников, задачи, встречи и окна сезона</div></div><div class="tools" style="margin:0"><button class="btn btn-ghost btn-sm" id="cal-meet">+ встреча</button></div></div><div id="calBody"><div class="spin"></div></div>';
    $("cal-meet").onclick = function () { meetingModal(null); };
    loadAll().then(drawCalendar);
  }
  function calMarks(month) {
    var marks = {}, d = S.dash || {}, st = {}; active().forEach(function (s) { st[s.id] = s; });
    var add = function (k, item) { if (!k) return; (marks[k] = marks[k] || []).push(item); };
    (d.apps || []).forEach(function (a) { if (st[a.student_id] && (a.status === "study" || a.status === "prep") && a.deadline) add(a.deadline, { kind: "deadline", title: a.name, s: st[a.student_id], mine: true, url: a.url }); });
    (d.tasks || []).forEach(function (x) { if (st[x.student_id] && x.due_on) add(x.due_on, { kind: "task", title: x.text, s: st[x.student_id], mine: true, id: x.id }); });
    (d.meetings || []).forEach(function (m) { if (st[m.student_id] && m.due_on) add(m.due_on, { kind: "meeting", title: (m.at_time ? fmtT(m.at_time) + " · " : "") + m.text, s: st[m.student_id], mine: true }); });
    active().forEach(function (s) { if (s.next_step && s.next_step_on) add(s.next_step_on, { kind: "step", title: s.next_step, s: s, mine: true }); });
    var y = month.getFullYear();
    SEASON.forEach(function (w) { [y - 1, y, y + 1].forEach(function (yy) { var k = yy + "-" + w[0]; if (k.slice(0, 7) === iso(month).slice(0, 7)) add(k, { kind: "season", title: w[1], mine: false }); }); });
    return marks;
  }
  function drawCalendar() {
    var m = S.calMonth || (function () { var t = todayD(); return new Date(t.getFullYear(), t.getMonth(), 1); })();
    var marks = calMarks(m), sel = S.calSel && marks[S.calSel] ? marks[S.calSel] : null;
    var keys = Object.keys(marks).filter(function (k) { return k.slice(0, 7) === iso(m).slice(0, 7); }).sort();
    var h = '<div class="cols cal-cols"><div><div class="card"><div class="h-row"><b class="sm">' + "</b><span class=\"xs mut\"><i class=\"cal-lg mine\"></i> ученики · <i class=\"cal-lg\"></i> сезон</span></div>" + Path.calendarHTML(m, marks, todayD()) +
      (sel ? '<div class="cal-sel"><b class="sm">' + fmtDL(S.calSel) + "</b>" + sel.map(calItemHTML).join("") + "</div>" : '<div class="xs mut" style="margin-top:8px">Тап по дню — список на этот день.</div>') + "</div></div>" +
      '<div><div class="card"><div class="h2">В этом месяце · ' + keys.reduce(function (a, k) { return a + marks[k].filter(function (x) { return x.mine; }).length; }, 0) + "</div>" + (keys.length ? keys.map(function (k) { return '<div class="xs mut" style="margin-top:8px;font-weight:700">' + fmtDL(k) + (k === isoToday() ? " · сегодня" : "") + "</div>" + marks[k].map(calItemHTML).join(""); }).join("") : '<div class="empty">В этом месяце ничего не назначено.</div>') + "</div></div></div>";
    $("calBody").innerHTML = h;
    $("calBody").onclick = function (e) {
      var b = e.target.closest("[data-act]"); if (!b) return;
      var act = b.getAttribute("data-act");
      if (act === "cal-prev" || act === "cal-next") { S.calMonth = new Date(m.getFullYear(), m.getMonth() + (act === "cal-next" ? 1 : -1), 1); S.calSel = null; track("ws_calendar_open", { m: S.calMonth.getMonth() + 1 }); drawCalendar(); }
      if (act === "cal-day") { var k = b.getAttribute("data-v"); S.calSel = S.calSel === k ? null : k; drawCalendar(); }
    };
  }
  function calItemHTML(x) {
    var ic = { deadline: "⏰", task: "☑", meeting: "🗓", step: "→", season: "📅" }[x.kind];
    if (x.kind === "season") return '<div class="lst"><span>' + ic + '</span><div class="t"><b class="sm mut">' + esc(x.title) + '</b><span class="xs mut">окно сезона</span></div></div>';
    return '<div class="lst"><span>' + ic + '</span><div class="t"><b class="sm">' + esc(x.title) + "</b><span class=\"xs mut\">" + studentLink(x.s, x.kind === "deadline" ? "apps" : "overview") + "</span></div>" + (x.url && safeUrl(x.url) ? '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="' + esc(safeUrl(x.url)) + '">Подать</a>' : "") + "</div>";
  }

  /* ---------- Ученики ---------- */
  var FILTERS = [["", "Все"], ["attention", "Требует внимания"], ["nostep", "Без шага"], ["dl14", "Дедлайн ≤ 14"], ["idle", "Без касания 14+"], ["docs", "Документы не готовы"], ["family", "Семья без статуса"], ["unlinked", "Не в Scholary"], ["noapps", "Без программ"]];
  function viewStudents() {
    var v = $("view");
    v.innerHTML = '<div class="head"><div><div class="h1">Ученики</div><div class="sm mut" id="stSub">Загружаю…</div></div><div class="tools" style="margin:0"><div class="seg" id="mode"><button data-m="table"' + (S.mode === "table" ? ' class="on"' : "") + '>Список</button><button data-m="kanban"' + (S.mode === "kanban" ? ' class="on"' : "") + '>Этапы</button></div><button class="btn btn-ghost btn-sm" id="btn-csv">CSV</button><button class="btn btn-primary btn-sm" id="btn-add">+ Ученик</button></div></div>' +
      '<div class="chips" id="chips"></div><div class="tools" style="margin:0 0 10px"><input class="f" id="q" placeholder="Поиск по имени, цели, почте" value="' + esc(S.q) + '"><label class="xs mut" style="display:inline-flex;align-items:center;gap:6px;min-height:40px"><input type="checkbox" id="arch"' + (S.showArchived ? " checked" : "") + "> архив</label></div><div id=\"list\"><div class=\"spin\"></div></div>";
    $("btn-add").onclick = addStudentModal;
    $("q").addEventListener("input", function () { S.q = $("q").value.trim(); drawList(); });
    $("arch").onchange = function () { S.showArchived = $("arch").checked; drawList(); };
    $("mode").onclick = function (e) { var b = e.target.closest("[data-m]"); if (!b) return; S.mode = b.getAttribute("data-m"); $("mode").querySelectorAll("button").forEach(function (x) { x.classList.toggle("on", x === b); }); track("ws_kanban", { on: S.mode === "kanban" }); drawList(); };
    $("chips").addEventListener("click", function (e) { var b = e.target.closest(".chip"); if (!b) return; if (b.hasAttribute("data-st")) { S.stage = b.getAttribute("data-st"); S.filter = ""; } else { S.filter = b.getAttribute("data-f"); S.stage = ""; } track("ws_filter", { key: S.filter || S.stage || "all" }); drawChips(); drawList(); });
    $("btn-csv").onclick = exportCsv;
    $("list").addEventListener("click", function (e) {
      var b = e.target.closest("[data-step]"); if (b) { var s = byId(b.getAttribute("data-step")); if (s) nextStepModal(s); return; }
      if (e.target.closest("select,a,button,input,label")) return;
      var tr = e.target.closest("[data-id]"); if (tr) location.hash = "#/s/" + tr.getAttribute("data-id");
    });
    $("list").addEventListener("change", function (e) {
      var s0 = e.target.closest("select[data-stage]"); if (!s0) return;
      var id = s0.getAttribute("data-stage"), st = byId(id); changeStage(st, s0.value, function () { s0.className = "stage-sel stage-" + s0.value; drawChips(); if (S.mode === "kanban") drawList(); });
    });
    loadAll().then(function () { if (/^stage-/.test(S.filter)) { S.stage = S.filter.slice(6); S.filter = ""; } drawChips(); drawList(); });
  }
  function changeStage(st, val, cb) {
    if (!st) return;
    var old = st.stage;
    DB.students.update(st.id, { stage: val }).then(function (r) {
      if (r.error) { fail(r); return; }
      st.stage = val; toast("Этап: " + STAGE_L[val], "ok"); track("ws_stage", { stage: val }); touch(false);
      DB.notes.add({ student_id: st.id, kind: "stage", text: "Этап: " + STAGE_L[old] + " → " + STAGE_L[val] }).then(function () {});
      if (cb) cb();
      if (!st.next_step || old !== val) setTimeout(function () { nextStepModal(st, "Новый этап — какой следующий шаг?"); }, 300);
    });
  }
  function drawChips() {
    var cnt = {}; active().forEach(function (s) { cnt[s.stage] = (cnt[s.stage] || 0) + 1; });
    var fc = {}; FILTERS.forEach(function (f) { if (f[0]) fc[f[0]] = active().filter(function (s) { return matchFilter(s, f[0]); }).length; });
    var h = FILTERS.map(function (f) { if (f[0] && !fc[f[0]]) return ""; return '<button class="chip' + (!f[0] && !S.filter && !S.stage ? " on" : S.filter === f[0] && f[0] ? " on" : "") + '" data-f="' + f[0] + '">' + f[1] + (f[0] ? " · " + fc[f[0]] : " · " + active().length) + "</button>"; }).join("");
    h += '<span class="chip-sep"></span>' + STAGES.map(function (s) { if (!cnt[s[0]]) return ""; return '<button class="chip' + (S.stage === s[0] ? " on" : "") + '" data-st="' + s[0] + '">' + s[1] + " · " + cnt[s[0]] + "</button>"; }).join("");
    $("chips").innerHTML = h;
  }
  function matchFilter(s, f) {
    if (!f) return true;
    var h = health(s), dl = daysTo(s.ws_next_deadline), touchAgo = daysAgo(s.last_touch || s.last_note || s.created_at), st = daysAgo(s.last_status_at);
    if (f === "attention") return h.k === "bad" || h.k === "warn";
    if (f === "nostep") return ACTIVE[s.stage] && !s.next_step;
    if (f === "dl14") return dl != null && dl >= 0 && dl <= 14;
    if (f === "idle") return ACTIVE[s.stage] && (touchAgo == null || touchAgo >= 14);
    if (f === "docs") return (s.stage === "docs" || s.stage === "applying") && (docsPct(s) == null || docsPct(s) < 100);
    if (f === "family") return s.stage !== "intake" && ACTIVE[s.stage] && (st == null || st >= 21);
    if (f === "unlinked") return !s.linked;
    if (f === "noapps") return ACTIVE[s.stage] && !s.ws_apps;
    return true;
  }
  function filtered() {
    var q = S.q.toLowerCase(), rank = { bad: 0, warn: 1, ok: 2, mut: 3 };
    return S.roster.filter(function (s) {
      if (!!s.archived !== S.showArchived) return false;
      if (S.stage && s.stage !== S.stage) return false;
      if (!matchFilter(s, S.filter)) return false;
      if (q && [s.name, s.target, s.email, s.phone, s.parent_name].join(" ").toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) {
      var ra = rank[health(a).k], rb = rank[health(b).k]; if (ra !== rb) return ra - rb;
      var da = daysTo(a.ws_next_deadline), db = daysTo(b.ws_next_deadline);
      if (da != null && db != null && da !== db) return da - db;
      if ((da == null) !== (db == null)) return da == null ? 1 : -1;
      return String(a.name).localeCompare(String(b.name), "ru");
    });
  }
  function stepCell(s) {
    if (!s.next_step) return '<button class="lnk xs" data-step="' + esc(s.id) + '">+ шаг</button>';
    var d = daysTo(s.next_step_on);
    return '<span class="sub"' + (d != null && d < 0 ? ' style="color:var(--bad);font-weight:700"' : "") + '>' + esc(s.next_step) + (s.next_step_on ? " · " + (d < 0 ? "просрочен " : "до ") + fmtD(s.next_step_on) : "") + "</span>";
  }
  function drawList() {
    var rows = filtered(), n = active().length;
    $("stSub").textContent = n ? n + " " + plural(n, "ученик", "ученика", "учеников") + " · показано " + rows.length + " · мест " + S.ws.seats : "Пока пусто — добавьте первого ученика";
    if (!S.roster.length) { $("list").innerHTML = '<div class="card empty">Ученики появятся здесь: добавьте карточку вручную, импортируйте список из Excel в настройках или отправьте ссылку на регистрацию — зарегистрировавшиеся привяжутся по почте сами.</div>'; return; }
    if (!rows.length) { $("list").innerHTML = '<div class="card empty">Никого не нашли по этому фильтру.</div>'; return; }
    if (S.mode === "kanban") { drawKanban(rows); return; }
    var h = '<div class="card"><table class="r"><tr><th></th><th>Ученик</th><th>Этап</th><th>Следующий шаг</th><th>Дедлайн · документы</th><th>Касание · семья</th></tr>';
    rows.forEach(function (s) {
      var p = s.p_adm == null ? null : Math.round(Number(s.p_adm) * 100), lastT = daysAgo(s.last_touch || s.last_note), st = daysAgo(s.last_status_at), pct = docsPct(s);
      h += '<tr class="row" data-id="' + esc(s.id) + '"><td>' + hdot(s) + '</td><td><div class="name">' + esc(s.name) + (s.linked ? ' <span class="pill pill-ok" title="Зарегистрирован в Scholary">●</span>' : "") + '</div><div class="sub">' + esc(GRADE_L[s.grade] || "") + (s.target ? " · " + esc(s.target) : "") + (p != null ? " · " + p + "% шанс" : "") + "</div></td>" +
        "<td>" + sel("stage", STAGES, s.stage, "stage-sel stage-" + s.stage).replace('name="stage"', 'name="stage" data-stage="' + esc(s.id) + '"') + "</td>" +
        "<td>" + stepCell(s) + "</td>" +
        "<td>" + (s.ws_next_deadline ? dlPill(s.ws_next_deadline) : '<span class="sub">без дедлайна</span>') + ' <span class="sub">' + (pct == null ? "документы не заведены" : "документы " + pct + "%") + "</span>" + (Number(s.ws_offers) ? ' <span class="pill pill-ok">' + s.ws_offers + " " + plural(s.ws_offers, "оффер", "оффера", "офферов") + "</span>" : "") + "</td>" +
        '<td class="sub">' + (lastT == null ? "касаний нет" : lastT === 0 ? "сегодня" : lastT === 1 ? "вчера" : (lastT >= 14 ? '<span style="color:var(--warn);font-weight:650">' : "") + lastT + " " + plural(lastT, "день", "дня", "дней") + " назад" + (lastT >= 14 ? "</span>" : "")) + "<br>" + (st == null ? "семье статус не отправляли" : "семье: " + st + " " + plural(st, "день", "дня", "дней") + " назад") + "</td></tr>";
    });
    $("list").innerHTML = h + "</table></div>";
  }
  function drawKanban(rows) {
    var h = '<div class="kanban">' + STAGES.map(function (st) {
      var col = rows.filter(function (s) { return s.stage === st[0]; });
      return '<div class="kcol"><div class="kh">' + stagePill(st[0]) + '<span class="xs mut">' + col.length + "</span></div>" + col.map(function (s) {
        var dl = s.ws_next_deadline;
        return '<div class="kcard" data-id="' + esc(s.id) + '">' + hdot(s) + '<b>' + esc(s.name) + '</b><div class="xs mut">' + esc(s.target || GRADE_L[s.grade] || "") + "</div>" +
          '<div class="xs" style="margin-top:6px">' + stepCell(s) + "</div>" + (dl ? '<div style="margin-top:6px">' + dlPill(dl) + "</div>" : "") +
          '<select class="stage-sel stage-' + esc(s.stage) + '" data-stage="' + esc(s.id) + '" style="margin-top:8px;width:100%">' + STAGES.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === s.stage ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") + "</select></div>";
      }).join("") + (col.length ? "" : '<div class="xs mut" style="padding:8px 4px">—</div>') + "</div>";
    }).join("") + "</div>";
    $("list").innerHTML = h;
  }
  function exportCsv() {
    var rows = filtered();
    var head = ["Ученик", "Класс", "Этап", "Здоровье", "Следующий шаг", "Дата шага", "Цель", "Телефон", "Email", "Родитель", "Телефон родителя", "Зарегистрирован в Scholary", "Шанс %", "Подач отправлено", "Подач всего", "Документов готово", "Документов всего", "Офферов", "Ближайший дедлайн", "Открытых задач", "Последнее касание", "Статус семье"];
    var lines = [head.join(";")].concat(rows.map(function (s) {
      return [s.name, GRADE_L[s.grade] || "", STAGE_L[s.stage] || "", { bad: "красный", warn: "жёлтый", ok: "зелёный", mut: "—" }[health(s).k], s.next_step || "", s.next_step_on || "", s.target, s.phone, s.email, s.parent_name, s.parent_phone, s.linked ? "да" : "нет", s.p_adm == null ? "" : Math.round(Number(s.p_adm) * 100), s.ws_apps_sent || 0, s.ws_apps || 0, s.ws_docs_ready || 0, s.ws_docs || 0, s.ws_offers || 0, s.ws_next_deadline || "", s.tasks_open || 0, s.last_touch ? String(s.last_touch).slice(0, 10) : "", s.last_status_at ? String(s.last_status_at).slice(0, 10) : ""]
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
      '<div><label class="fl">Телефон родителя</label><input class="f" name="parent_phone" inputmode="tel" maxlength="24" value="' + esc(s.parent_phone) + '"></div>' +
      '<div><label class="fl">Email родителя</label><input class="f" name="parent_email" type="email" maxlength="120" value="' + esc(s.parent_email) + '"></div></div>' +
      '<label class="fl">Цель</label><input class="f" name="target" maxlength="120" value="' + esc(s.target) + '" placeholder="Германия/Венгрия · IT">' +
      '<label class="fl">Что важно помнить</label><textarea class="f" name="note" maxlength="1000" placeholder="Кто главный контакт в семье, ограничения, договорённости">' + esc(s.note) + "</textarea>";
  }
  function cleanStudent(o) { var out = {}; ["name", "grade", "level", "stage", "phone", "email", "parent_name", "parent_phone", "parent_email", "target", "note"].forEach(function (k) { out[k] = o[k] === "" ? null : o[k]; }); if (out.email) out.email = out.email.toLowerCase(); if (out.parent_email) out.parent_email = out.parent_email.toLowerCase(); return out; }
  function addStudentModal() {
    if (S.ws.used >= S.ws.seats) { toast("Места по тарифу закончились (" + S.ws.seats + ") — архивируйте закрытые карточки или расширьте тариф", "bad"); return; }
    openModal('<div class="h2">Новый ученик</div><div class="xs mut">Занято ' + S.ws.used + " из " + S.ws.seats + ' мест · списком из Excel — в настройках</div><form id="f-st">' + studentForm() + '<div class="tools"><button class="btn btn-primary" type="submit">Добавить</button><button class="btn btn-ghost" type="button" data-close>Отмена</button></div></form>', function (m) {
      m.querySelector("#f-st").onsubmit = function (e) {
        e.preventDefault(); var b = m.querySelector("[type=submit]"); b.disabled = true;
        DB.students.add(cleanStudent(formData(e.target))).then(function (r) {
          b.disabled = false; if (r.error || !r.data) { fail(r, "Не удалось добавить"); return; }
          S.ws.used = (S.ws.used || 0) + 1; closeModal(); toast("Ученик добавлен", "ok"); track("ws_student_add"); touch(false); location.hash = "#/s/" + r.data.id;
        });
      };
    });
  }
  function editStudentModal(s) {
    openModal('<div class="h2">Карточка ученика</div><form id="f-st">' + studentForm(s) + '<div class="tools"><button class="btn btn-primary" type="submit">Сохранить</button><button class="btn btn-ghost" type="button" data-close>Отмена</button><button class="btn btn-ghost btn-sm" type="button" id="st-arch" style="margin-left:auto">' + (s.archived ? "Вернуть из архива" : "В архив") + '</button></div><div class="xs mut" style="margin-top:8px">Архив освобождает место по тарифу, карточка и история остаются. <a href="#" id="st-del-lnk">Удалить навсегда</a></div><div class="xs mut" id="del-hint" hidden style="margin-top:6px;color:var(--bad)">Удалятся подачи, документы и заметки этого ученика. Нажмите ещё раз, чтобы подтвердить.</div></form>', function (m) {
      m.querySelector("#f-st").onsubmit = function (e) {
        e.preventDefault(); var b = m.querySelector("[type=submit]"); b.disabled = true;
        DB.students.update(s.id, cleanStudent(formData(e.target))).then(function (r) { b.disabled = false; if (r.error) { fail(r, "Не сохранилось"); return; } if (r.data) Object.assign(s, r.data); closeModal(); toast("Сохранено", "ok"); render(); });
      };
      m.querySelector("#st-arch").onclick = function () {
        DB.students.update(s.id, { archived: !s.archived }).then(function (r) { if (r.error) { fail(r, "Не получилось"); return; } s.archived = !s.archived; S.ws.used = Math.max(0, (S.ws.used || 0) + (s.archived ? -1 : 1)); closeModal(); toast(s.archived ? "В архиве — место освободилось" : "Возвращён из архива", "ok"); track("ws_student_archive", { on: s.archived }); location.hash = "#/students"; });
      };
      var del = m.querySelector("#st-del-lnk");
      del.onclick = function (e) {
        e.preventDefault();
        if (!del.getAttribute("data-armed")) { del.setAttribute("data-armed", "1"); m.querySelector("#del-hint").hidden = false; del.textContent = "Точно удалить навсегда"; return; }
        DB.students.remove(s.id).then(function (r) { if (r.error) { fail(r, "Не удалилось"); return; } if (!s.archived) S.ws.used = Math.max(0, (S.ws.used || 1) - 1); closeModal(); toast("Ученик удалён", "ok"); track("ws_student_del"); location.hash = "#/students"; });
      };
    });
  }

  /* ---------- страница ученика ---------- */
  var TABS = [["overview", "Обзор"], ["apps", "Подачи"], ["docs", "Документы"], ["family", "Семья"], ["cab", "Кабинет ученика"], ["info", "Контакты"]];
  function viewStudent(id, tab) {
    var v = $("view"); if (tab === "notes") tab = "overview"; S.tab = tab;
    var go = function (s) {
      S.cur = s;
      var p = s.p_adm == null ? null : Math.round(Number(s.p_adm) * 100), h = health(s), ns = daysTo(s.next_step_on);
      v.innerHTML = '<a class="back" href="#/students">← Ученики</a>' +
        '<div class="head"><div><div class="h1">' + hdot(s) + " " + esc(s.name) + (s.archived ? ' <span class="pill pill-mut">архив</span>' : s.linked ? ' <span class="pill pill-ok">в Scholary</span>' : ' <span class="pill pill-mut">не зарегистрирован</span>') + '</div><div class="sm mut">' + esc(GRADE_L[s.grade] || "") + " · " + esc(LEVEL_L[s.level] || "") + (s.target ? " · " + esc(s.target) : "") + (p != null ? " · шанс " + p + "%" : "") + (h.why.length ? ' · <span style="color:var(--' + (h.k === "bad" ? "bad" : "warn") + ')">' + esc(h.why.map(function (w) { return w.t; }).join(" · ")) + "</span>" : "") + "</div></div>" +
        '<div class="tools" style="margin:0"><select class="stage-sel stage-' + esc(s.stage) + '" id="st-stage">' + STAGES.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === s.stage ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") + '</select><button class="btn btn-ghost btn-sm" id="st-edit">Карточка</button>' + (s.phone ? '<a class="btn btn-ghost btn-sm" href="https://wa.me/' + waNum(s.phone) + '" target="_blank" rel="noopener">WhatsApp</a>' : "") + "</div></div>" +
        '<div class="stepbox' + (ns != null && ns < 0 ? " late" : "") + '"><div><span class="k">Следующий шаг</span>' + (s.next_step ? "<b>" + esc(s.next_step) + "</b>" + (s.next_step_on ? '<span class="xs' + (ns < 0 ? '" style="color:var(--bad);font-weight:700' : " mut") + '"> · ' + (ns < 0 ? "просрочен " : ns === 0 ? "сегодня, " : "до ") + fmtD(s.next_step_on) + "</span>" : "") : '<b class="mut">не назначен</b>') + "</div>" +
        '<div class="tools" style="margin:0">' + (s.next_step ? '<button class="btn btn-primary btn-sm" id="step-done">Сделано</button>' : "") + '<button class="btn btn-ghost btn-sm" id="step-edit">' + (s.next_step ? "Изменить" : "Назначить") + "</button></div></div>" +
        (s.note ? '<div class="note" style="margin-top:10px"><span class="k">Важно</span><div>' + esc(s.note) + "</div></div>" : "") +
        '<div class="stabs" id="stabs">' + TABS.map(function (t) { return '<button data-tab="' + t[0] + '"' + (t[0] === tab ? ' class="on"' : "") + ">" + t[1] + "</button>"; }).join("") + "</div>" +
        '<div id="stBody"><div class="spin"></div></div>';
      $("st-edit").onclick = function () { editStudentModal(s); };
      $("step-edit").onclick = function () { nextStepModal(s); };
      var sd = $("step-done"); if (sd) sd.onclick = function () {
        DB.notes.add({ student_id: s.id, kind: "task", text: s.next_step, done: true, due_on: s.next_step_on || isoToday() }).then(function () {
          saveStep(s, null, null, function () { toast("Шаг сделан — записал в историю", "ok"); track("ws_step_done"); nextStepModal(s, "Сделано! Какой следующий шаг?"); });
        });
      };
      $("st-stage").onchange = function () { var val = this.value, el = this; changeStage(s, val, function () { el.className = "stage-sel stage-" + val; }); };
      $("stabs").onclick = function (e) { var b = e.target.closest("[data-tab]"); if (!b) return; location.hash = "#/s/" + s.id + "/" + b.getAttribute("data-tab"); };
      if (tab === "apps") tabApps(s); else if (tab === "docs") tabDocs(s); else if (tab === "family") tabFamily(s); else if (tab === "cab") tabCab(s); else if (tab === "info") tabInfo(s); else tabOverview(s);
    };
    var s = byId(id);
    if (s && S.dash) go(s); else loadAll().then(function () { var s2 = byId(id); if (s2) go(s2); else v.innerHTML = '<a class="back" href="#/students">← Ученики</a><div class="card"><div class="h2">Ученик не найден</div><div class="sm mut">Возможно, карточка удалена.</div></div>'; });
  }

  /* --- Обзор: таймлайн + быстрые действия --- */
  function tabOverview(s) {
    var body = $("stBody");
    Promise.all([DB.notes.list(s.id), DB.apps.list(s.id)]).then(function (rs) {
      var notes = (rs[0].data || []).slice().sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }), apps = rs[1].data || [];
      var open = notes.filter(function (n) { return n.kind === "task" && !n.done; }).sort(function (a, b) { return String(a.due_on || "9") < String(b.due_on || "9") ? -1 : 1; });
      var meets = notes.filter(function (n) { return n.kind === "meeting" && n.due_on && daysTo(n.due_on) >= 0; }).sort(function (a, b) { return a.due_on < b.due_on ? -1 : 1; });
      var next = apps.filter(function (a) { return (a.status === "study" || a.status === "prep") && a.deadline && daysTo(a.deadline) >= 0; }).sort(function (a, b) { return a.deadline < b.deadline ? -1 : 1; })[0];
      var pct = docsPct(s), st = daysAgo(s.last_status_at);
      var h = '<div class="cols"><div>' +
        '<div class="card"><div class="h2">Сейчас</div><div class="kv" style="margin-top:8px"><b>Ближайший дедлайн</b><span>' + (next ? esc(next.name) + " · " + dlPill(next.deadline) : "нет — <a href=\"#/s/" + esc(s.id) + "/apps\">добавить программу</a>") + '</span><b>Документы</b><span>' + (pct == null ? '<a href="#/s/' + esc(s.id) + '/docs">чек-лист не заведён</a>' : "готово " + s.ws_docs_ready + " из " + s.ws_docs + " (" + pct + "%)") + '</span><b>Открытых задач</b><span>' + open.length + '</span><b>Семья</b><span>' + (st == null ? "статус ещё не отправляли" : "последний статус " + st + " " + plural(st, "день", "дня", "дней") + " назад") + ' · <a href="#/s/' + esc(s.id) + '/family">отправить</a></span></div></div>' +
        '<div class="card" style="margin-top:14px"><div class="h2">Записать</div><div class="chips" style="margin:8px 0 0"><button class="chip" data-q="call">📞 Звонок</button><button class="chip" data-q="parent">👨‍👩‍👧 Родители</button><button class="chip" data-q="task">☑️ Задача</button><button class="chip" data-q="meeting">🗓 Встреча</button><button class="chip" data-q="note">📝 Заметка</button></div></div>' +
        (open.length ? '<div class="card" style="margin-top:14px"><div class="h2">Открытые задачи · ' + open.length + "</div>" + open.map(function (n) { var d = daysTo(n.due_on); return '<label class="lst" style="cursor:pointer"><input type="checkbox" data-done="' + n.id + '" style="width:20px;height:20px"><div class="t"><b>' + esc(n.text) + "</b>" + (n.due_on ? '<span class="xs ' + (d < 0 ? "" : "mut") + '"' + (d < 0 ? ' style="color:var(--bad);font-weight:700"' : "") + ">" + (d < 0 ? "просрочено · " : "до ") + fmtD(n.due_on) + "</span>" : "") + '</div><button class="btn btn-ghost btn-sm" data-ndel="' + n.id + '" aria-label="Удалить">×</button></label>'; }).join("") + "</div>" : "") +
        (meets.length ? '<div class="card" style="margin-top:14px"><div class="h2">Встречи</div>' + meets.map(function (n) { return '<div class="lst"><span class="pill pill-acc">' + fmtD(n.due_on) + (n.at_time ? " " + fmtT(n.at_time) : "") + '</span><div class="t"><b>' + esc(n.text) + '</b></div><button class="btn btn-ghost btn-sm" data-ndel="' + n.id + '" aria-label="Удалить">×</button></div>'; }).join("") + "</div>" : "") +
        "</div><div>" +
        '<div class="card"><div class="h2">История</div>' + (notes.length ? '<div class="tl">' + notes.filter(function (n) { return !(n.kind === "task" && !n.done) && !(n.kind === "meeting" && n.due_on && daysTo(n.due_on) >= 0); }).slice(0, 40).map(function (n) {
          return '<div class="tli ' + esc(n.kind) + '"><span class="ic">' + (NOTE_IC[n.kind] || "•") + '</span><div class="tb"><span class="xs mut">' + esc(NOTE_L[n.kind] || n.kind) + " · " + fmtDT(n.kind === "task" && n.done_at ? n.done_at : n.created_at) + '</span><div style="white-space:pre-wrap">' + esc(n.text) + "</div></div>" + (n.kind !== "stage" ? '<button class="btn btn-ghost btn-sm" data-ndel="' + n.id + '" aria-label="Удалить" style="min-height:28px;padding:2px 8px">×</button>' : "") + "</div>";
        }).join("") + "</div>" : '<div class="empty">Пока пусто. Записывайте звонки, договорённости с родителями и встречи — через месяц это сэкономит час.</div>') + "</div></div></div>";
      body.innerHTML = h;
      body.onclick = function (e) {
        var q = e.target.closest("[data-q]"); if (q) { quickNoteModal(s, q.getAttribute("data-q")); return; }
        var b = e.target.closest("[data-ndel]"); if (!b) return; e.preventDefault();
        if (!b.getAttribute("data-armed")) { b.setAttribute("data-armed", "1"); b.textContent = "Удалить?"; setTimeout(function () { if (b.isConnected) { b.removeAttribute("data-armed"); b.textContent = "×"; } }, 4000); return; }
        DB.notes.remove(b.getAttribute("data-ndel")).then(function (r2) { if (r2.error) { fail(r2); return; } toast("Удалено", "ok"); loadAll().then(function () { tabOverview(s); }); });
      };
      body.onchange = function (e) { var cb = e.target.closest("[data-done]"); if (!cb) return; DB.notes.update(cb.getAttribute("data-done"), { done: true }).then(function (r2) { if (r2.error) { fail(r2); cb.checked = false; return; } toast("Задача закрыта", "ok"); track("ws_task_done"); touch(false); loadAll().then(function () { var s2 = byId(s.id); if (s2 && !s2.next_step) nextStepModal(s2, "Задача закрыта — какой следующий шаг?"); else tabOverview(s2 || s); }); }); };
    });
  }

  /* --- Семья: статус одной кнопкой --- */
  function statusText(s, notes, apps, docs) {
    var who = S.ws && S.ws.contact_name ? S.ws.contact_name : "ваш профориентолог", fn = firstName(s.name), par = s.parent_name ? String(s.parent_name).replace(/^(мама|папа|мать|отец)[,\s]*/i, "").trim() : "";
    var since = addDays(todayD(), -14).toISOString();
    var done = (notes || []).filter(function (n) { return n.kind === "task" && n.done && (n.done_at || n.created_at) >= since; }).map(function (n) { return n.text; });
    var ready = (docs || []).filter(function (d) { return d.status === "ready" && d.updated_at >= since; }).map(function (d) { return (d.title || DOC_TYPES[d.doc_type] || d.doc_type) + " — готов"; });
    var sent = (apps || []).filter(function (a) { return ["applied", "admit", "waitlist"].indexOf(a.status) >= 0 && a.updated_at >= since; }).map(function (a) { return a.name + " — " + APP_L[a.status].toLowerCase(); });
    var items = done.concat(ready, sent).slice(0, 4);
    var next = (apps || []).filter(function (a) { return (a.status === "study" || a.status === "prep") && a.deadline && daysTo(a.deadline) >= 0; }).sort(function (a, b) { return a.deadline < b.deadline ? -1 : 1; })[0];
    var lines = ["Здравствуйте" + (par ? ", " + par : "") + "! Коротко, где мы с " + fn + " на " + fmtDn(todayD()) + ".", "", "Этап: " + STAGE_L[s.stage] + "."];
    lines.push("За последние две недели: " + (items.length ? items.join("; ") + "." : "работаем по плану."));
    if (s.next_step) lines.push("Следующий шаг: " + s.next_step + (s.next_step_on ? " — до " + fmtDn(s.next_step_on) : "") + ".");
    if (next) lines.push("Ближайший дедлайн: " + next.name + " — " + fmtD(next.deadline) + " (через " + daysTo(next.deadline) + " " + plural(daysTo(next.deadline), "день", "дня", "дней") + ").");
    if (s.ws_docs) lines.push("Документы: готово " + (s.ws_docs_ready || 0) + " из " + s.ws_docs + ".");
    lines.push("", "Если есть вопросы — пишите, отвечу в течение дня.", who);
    return lines.join("\n");
  }
  function tabFamily(s) {
    var body = $("stBody");
    Promise.all([DB.notes.list(s.id), DB.apps.list(s.id), DB.docs.list(s.id)]).then(function (rs) {
      var notes = rs[0].data || [], apps = rs[1].data || [], docs = rs[2].data || [];
      var hist = notes.filter(function (n) { return n.kind === "status"; }).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
      var st = daysAgo(s.last_status_at), text = statusText(s, notes, apps, docs);
      body.innerHTML = '<div class="cols"><div><div class="card glow"><div class="h2">Статус для семьи</div><p class="sm mut" style="margin:4px 0 10px">Собран из карточки: этап, что сделано за две недели, следующий шаг, дедлайн, документы. Поправьте и отправьте — семья видит, что вы работаете, а вопрос «а что у нас?» отпадает.</p>' +
        '<textarea class="f" id="st-text" rows="11">' + esc(text) + '</textarea>' +
        '<div class="tools">' + (s.parent_phone ? '<a class="btn btn-primary" id="st-wa" target="_blank" rel="noopener" href="https://wa.me/' + waNum(s.parent_phone) + "?text=" + encodeURIComponent(text) + '">В WhatsApp родителю</a>' : '<button class="btn btn-primary" id="st-wa-none">В WhatsApp родителю</button>') + '<button class="btn btn-ghost" id="st-copy">Копировать</button><button class="btn btn-soft" id="st-mark">Отметить отправленным</button></div>' +
        '<div class="xs mut" style="margin-top:8px">' + (st == null ? "Семья ещё не получала статус." : "Последний статус — " + fmtDL(s.last_status_at) + " (" + st + " " + plural(st, "день", "дня", "дней") + " назад).") + " Хорошая частота — раз в 2–3 недели и после каждого важного события.</div></div></div>" +
        '<div><div class="card"><div class="h-row"><div class="h2">Контакты семьи</div><button class="btn btn-ghost btn-sm" id="fam-edit">Изменить</button></div><div class="kv" style="margin-top:8px"><b>Родитель</b><span>' + esc(s.parent_name || "—") + "</span><b>Телефон</b><span>" + (s.parent_phone ? '<a href="tel:' + esc(s.parent_phone) + '">' + esc(s.parent_phone) + "</a>" : "—") + "</span><b>Email</b><span>" + (s.parent_email ? '<a href="mailto:' + esc(s.parent_email) + '">' + esc(s.parent_email) + "</a>" : "—") + "</span></div></div>" +
        '<div class="card" style="margin-top:14px"><div class="h2">Отправленные статусы · ' + hist.length + "</div>" + (hist.length ? hist.slice(0, 10).map(function (n) { return '<div class="note"><span class="k">' + fmtDT(n.created_at) + '</span><div style="white-space:pre-wrap;font-size:13px">' + esc(n.text.length > 220 ? n.text.slice(0, 220) + "…" : n.text) + "</div></div>"; }).join("") : '<div class="empty">Пока ни одного.</div>') + "</div></div></div>";
      var ta = $("st-text"), wa = $("st-wa");
      ta.oninput = function () { if (wa) wa.href = "https://wa.me/" + waNum(s.parent_phone) + "?text=" + encodeURIComponent(ta.value); };
      $("st-copy").onclick = function () { copyText(ta.value, "Статус скопирован"); };
      var none = $("st-wa-none"); if (none) none.onclick = function () { toast("Добавьте телефон родителя в карточке", "bad"); editStudentModal(s); };
      $("fam-edit").onclick = function () { editStudentModal(s); };
      var mark = function () {
        DB.notes.add({ student_id: s.id, kind: "status", text: ta.value }).then(function (r) {
          if (r.error) { fail(r, "Не записалось"); return; }
          var now = new Date().toISOString();
          DB.students.update(s.id, { last_status_at: now }).then(function () { s.last_status_at = now; toast("Статус записан в историю", "ok"); track("ws_status_sent"); touch(false); tabFamily(s); });
        });
      };
      $("st-mark").onclick = mark;
      if (wa) wa.addEventListener("click", function () { setTimeout(mark, 800); });
    });
  }

  /* --- вкладка Подачи --- */
  /* --- вкладка Подачи --- */
  function tabApps(s) {
    var body = $("stBody");
    DB.apps.list(s.id).then(function (r) {
      if (r.error) { body.innerHTML = '<div class="card empty">' + esc(r.error.message) + "</div>"; return; }
      var apps = (r.data || []).slice().sort(function (a, b) { var da = a.deadline || "9999", db = b.deadline || "9999"; return da < db ? -1 : da > db ? 1 : 0; });
      var h = '<div class="card"><div class="head" style="margin:0 0 6px"><div><div class="h2">Программы и подачи</div><div class="xs mut">Точная ссылка на подачу и дедлайн — у каждой программы</div></div><button class="btn btn-primary btn-sm" id="app-add">+ Программа</button></div>';
      if (!apps.length) h += '<div class="empty">Пока нет ни одной программы. Добавьте из каталога Scholary (236 программ с проверенными ссылками) или свою.</div>';
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
        DB.apps.update(sl.getAttribute("data-appst"), { status: sl.value }).then(function (r2) { if (r2.error) { fail(r2); return; } toast("Статус: " + APP_L[sl.value], "ok"); track("ws_app_status", { status: sl.value }); touch(false); if (sl.value === "applied" || sl.value === "admit") DB.notes.add({ student_id: s.id, kind: "stage", text: "Подача «" + (apps.filter(function (x) { return String(x.id) === sl.getAttribute("data-appst"); })[0] || {}).name + "»: " + APP_L[sl.value] }).then(function () {}); if (sl.value === "admit") tabApps(s); });
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
        (a.id ? DB.apps.update(a.id, row) : DB.apps.add(Object.assign({ student_id: s.id }, row))).then(function (r) { b.disabled = false; if (r.error) { fail(r, "Не сохранилось"); return; } closeModal(); toast(a.id ? "Сохранено" : "Программа добавлена", "ok"); track(a.id ? "ws_app_edit" : "ws_app_add"); touch(false); loadDash().then(function () { tabApps(s); }); });
      };
      var del = m.querySelector("#app-del");
      if (del) del.onclick = function () { if (!del.getAttribute("data-armed")) { del.setAttribute("data-armed", "1"); del.textContent = "Точно удалить"; return; } DB.apps.remove(a.id).then(function (r) { if (r.error) { fail(r); return; } closeModal(); toast("Удалено", "ok"); tabApps(s); }); };
    });
  }


  /* --- вкладка Документы --- */
  /* --- вкладка Документы --- */
  function tabDocs(s) {
    var body = $("stBody");
    DB.docs.list(s.id).then(function (r) {
      if (r.error) { body.innerHTML = '<div class="card empty">' + esc(r.error.message) + "</div>"; return; }
      var docs = r.data || [], ready = docs.filter(function (d) { return d.status === "ready"; }).length;
      var nearest = s.ws_next_deadline ? new Date(s.ws_next_deadline + "T00:00:00") : null;
      var startBy = function (d) { if (!nearest || d.status === "ready") return null; var lead = DOC_LEAD[d.doc_type] || 7; var by = addDays(nearest, -lead - 3); return { by: by, days: daysTo(by), lead: lead }; };
      var h = '<div class="card"><div class="head" style="margin:0 0 6px"><div><div class="h2">Документы</div><div class="xs mut">' + (docs.length ? "Готово " + ready + " из " + docs.length : "Чек-лист пуст") + '</div></div><div class="tools" style="margin:0">' + (docs.length ? "" : '<button class="btn btn-ghost btn-sm" id="doc-std">Стандартный набор</button>') + '<button class="btn btn-primary btn-sm" id="doc-add">+ Документ</button></div></div>';
      if (docs.length) h += '<div class="bar"><i style="width:' + Math.round(100 * ready / docs.length) + '%"></i></div>' + (nearest ? '<div class="xs mut" style="margin-top:6px">«Начать до» считается от ближайшего дедлайна ' + fmtD(nearest) + ' и срока изготовления — как в кабинете ученика.</div>' : "");
      if (!docs.length) h += '<div class="empty">Добавьте стандартный набор для поступления за рубеж (паспорт, аттестат, перевод, апостиль, язык, мотивационное, рекомендации, CV) — и отмечайте по мере готовности. Файлы можно прикладывать прямо сюда.</div>';
      docs.forEach(function (d) {
        var sb0 = startBy(d), sbTxt = sb0 ? (sb0.days < 0 ? '<span style="color:var(--bad);font-weight:700">старт просрочен на ' + (-sb0.days) + " " + plural(-sb0.days, "день", "дня", "дней") + "</span>" : sb0.days === 0 ? '<span style="color:var(--bad);font-weight:700">начать сегодня</span>' : "начать до " + fmtD(sb0.by)) + " · ≈" + sb0.lead + " " + plural(sb0.lead, "день", "дня", "дней") : "";
        h += '<div class="doc" data-doc="' + d.id + '"><div><div class="dn">' + esc(d.title || DOC_TYPES[d.doc_type] || d.doc_type) + '</div><div class="df">' + (d.file_name ? '<a href="#" data-file="' + d.id + '">📎 ' + esc(d.file_name) + "</a>" : "файл не приложен") + (d.note ? " · " + esc(d.note) : "") + (sbTxt ? " · " + sbTxt : "") + "</div></div>" +
          '<select class="stage-sel" data-docst="' + d.id + '" style="' + (d.status === "ready" ? "color:var(--ok)" : d.status === "progress" ? "color:var(--warn)" : "") + '">' + DOC_ST.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === d.status ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") + "</select>" +
          '<div class="tools" style="margin:0;gap:6px"><label class="btn btn-ghost btn-sm" style="cursor:pointer">' + (d.file_name ? "Заменить" : "Приложить") + '<input type="file" hidden data-up="' + d.id + '" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"></label><button class="btn btn-ghost btn-sm" data-docedit="' + d.id + '" aria-label="Изменить">✎</button></div></div>';
      });
      body.innerHTML = h + "</div>";
      $("doc-add").onclick = function () { docModal(s, null); };
      var std = $("doc-std");
      if (std) std.onclick = function () {
        std.disabled = true;
        Promise.all(DOC_STD.map(function (t) { return DB.docs.add({ student_id: s.id, doc_type: t, title: DOC_TYPES[t], status: "none" }); })).then(function (rs) { var bad = rs.filter(function (x) { return x.error; })[0]; if (bad) fail(bad, "Не все документы добавились"); else toast("Стандартный набор добавлен — 8 документов", "ok"); track("ws_docs_std"); loadAll().then(function () { tabDocs(byId(s.id) || s); }); });
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
        if (sl) { DB.docs.update(sl.getAttribute("data-docst"), { status: sl.value }).then(function (r2) { if (r2.error) { fail(r2); return; } toast(DOC_L[sl.value], "ok"); track("ws_doc_status", { status: sl.value }); touch(false); loadAll().then(function () { tabDocs(byId(s.id) || s); }); }); return; }
        var up = e.target.closest("[data-up]");
        if (up && up.files && up.files[0]) {
          var file = up.files[0], id = up.getAttribute("data-up");
          if (file.size > 15 * 1024 * 1024) { toast("Файл больше 15 МБ", "bad"); return; }
          toast("Загружаю…");
          DB.upload(s.id, file).then(function (r2) {
            if (r2.error) { fail(r2, "Файл не загрузился"); return; }
            return DB.docs.update(id, { file_path: r2.data.path, file_name: r2.data.name, status: "ready" }).then(function (r3) { if (r3.error) { fail(r3); return; } toast("Файл приложен — статус «Готов»", "ok"); track("ws_doc_upload"); touch(false); loadAll().then(function () { tabDocs(byId(s.id) || s); }); });
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

  /* --- вкладка Кабинет ученика --- */
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
        '<div class="kv" style="margin-top:10px"><b>Уровень</b><span>' + esc(LEVEL_L[pr.level] || "—") + "</span><b>Направления</b><span>" + esc((Array.isArray(pr.field) ? pr.field : []).join(", ") || "—") + "</span><b>Страны</b><span>" + esc((Array.isArray(pr.countries) ? pr.countries : []).map(function (x) { return CC[String(x).toLowerCase()] || x; }).join(", ") || "—") + "</span><b>Pro до</b><span>" + fmtDL(pr.pro_until) + "</span><b>Последний вход</b><span>" + (s.cab_last_day ? fmtDL(s.cab_last_day) + (daysAgo(s.cab_last_day) >= 7 ? ' <span class="pill pill-warn">' + daysAgo(s.cab_last_day) + " дн. назад</span>" : "") : fmtDT(pr.updated_at) || "—") + "</span></div></div></div>" +
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

  /* --- вкладка Контакты --- */
  function tabInfo(s) {
    $("stBody").innerHTML = '<div class="card"><div class="head" style="margin:0 0 10px"><div class="h2">Контакты и карточка</div><button class="btn btn-ghost btn-sm" id="info-edit">Изменить</button></div><div class="kv">' +
      "<b>Класс</b><span>" + esc(GRADE_L[s.grade] || "—") + "</span><b>Уровень</b><span>" + esc(LEVEL_L[s.level] || "—") + "</span><b>Цель</b><span>" + esc(s.target || "—") + "</span>" +
      "<b>Телефон</b><span>" + (s.phone ? '<a href="tel:' + esc(s.phone) + '">' + esc(s.phone) + "</a>" : "—") + "</span><b>Email</b><span>" + (s.email ? '<a href="mailto:' + esc(s.email) + '">' + esc(s.email) + "</a>" : "—") + "</span>" +
      "<b>Родитель</b><span>" + esc(s.parent_name || "—") + "</span><b>Тел. родителя</b><span>" + (s.parent_phone ? '<a href="tel:' + esc(s.parent_phone) + '">' + esc(s.parent_phone) + "</a>" : "—") + "</span><b>Email родителя</b><span>" + esc(s.parent_email || "—") + "</span>" +
      "<b>В Scholary</b><span>" + (s.linked ? "да — аккаунт привязан" : "нет — отправьте ссылку во вкладке «Кабинет ученика»") + "</span><b>Добавлен</b><span>" + fmtDL(s.created_at) + "</span></div>" +
      (s.note ? '<div class="note" style="margin-top:12px"><span class="k">Важно</span><div style="white-space:pre-wrap">' + esc(s.note) + "</div></div>" : "") + "</div>";
    $("info-edit").onclick = function () { editStudentModal(s); };
  }

  /* ---------- Настройки: ссылка, тариф, ритм, импорт, архив ---------- */
  function parseCsv(text) {
    var lines = String(text || "").split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) return [];
    var sepOf = function (l) { return (l.match(/;/g) || []).length >= (l.match(/,/g) || []).length ? (l.indexOf("\t") >= 0 ? "\t" : ";") : ","; };
    var sep = lines[0].indexOf("\t") >= 0 ? "\t" : sepOf(lines[0]);
    var cells = function (l) { return l.split(sep).map(function (c) { return c.replace(/^"|"$/g, "").trim(); }); };
    var head = cells(lines[0]).map(function (h) { return h.toLowerCase(); });
    var col = function (names) { for (var i = 0; i < head.length; i++) { for (var j = 0; j < names.length; j++) if (head[i].indexOf(names[j]) >= 0) return i; } return -1; };
    var hasHead = col(["имя", "ученик", "name", "фио"]) >= 0;
    var idx = hasHead ? { name: col(["имя", "ученик", "name", "фио"]), grade: col(["класс", "grade"]), phone: col(["телефон ученика", "тел. ученика", "phone"]), email: col(["почта", "email", "e-mail"]), parent_name: col(["родител", "parent"]), parent_phone: col(["телефон родителя", "тел. родителя", "parent_phone"]), target: col(["цель", "страна", "target"]), stage: col(["этап", "stage"]) } : { name: 0, grade: 1, phone: 2, email: 3, parent_name: 4, parent_phone: 5, target: 6, stage: -1 };
    if (hasHead && idx.phone < 0) idx.phone = col(["телефон"]);
    var stageOf = function (v) { v = String(v || "").toLowerCase(); var m = STAGES.filter(function (s) { return v && (s[1].toLowerCase().indexOf(v) === 0 || v === s[0]); })[0]; return m ? m[0] : "intake"; };
    var gradeOf = function (v) { v = String(v || "").replace(/\D/g, ""); return ["9", "10", "11"].indexOf(v) >= 0 ? v : (/студ|вып/i.test(String(v)) ? "grad" : "11"); };
    return lines.slice(hasHead ? 1 : 0).map(function (l) { var c = cells(l); var g = function (k) { return idx[k] >= 0 ? (c[idx[k]] || "") : ""; }; return { name: g("name"), grade: gradeOf(g("grade")), phone: g("phone"), email: g("email").toLowerCase(), parent_name: g("parent_name"), parent_phone: g("parent_phone"), target: g("target"), stage: stageOf(g("stage")) }; }).filter(function (r) { return r.name.length >= 2; }).slice(0, 200);
  }
  function viewSettings() {
    var w = S.ws, free = Math.max(0, w.seats - w.used), text = waText("");
    var draw = function () {
      var p = prefs(), r = rhythm(), arch = S.roster.filter(function (s) { return s.archived; });
      $("view").innerHTML = '<div class="head"><div><div class="h1">Настройки</div><div class="sm mut">' + esc(w.name) + (w.city ? " · " + esc(w.city) : "") + "</div></div></div><div class=\"cols\">" +
        '<div><div class="card glow"><div class="h2">Ссылка для учеников</div><p class="sm mut" style="margin:4px 0 10px">Ученик регистрируется по ней, получает Scholary Pro за счёт вашего тарифа и привязывается к своей карточке по почте. Ссылка одна на всех учеников.</p>' +
        '<div class="link-row"><input class="f" readonly id="inv" value="' + esc(inviteLink()) + '"><button class="btn btn-ghost" id="inv-copy">Копировать</button></div><div class="xs mut" style="margin-top:6px">Код: <span class="code" style="font-size:16px">' + esc(w.invite_code || "—") + "</span></div>" +
        '<div class="tools"><a class="btn btn-primary" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(text) + '">Отправить в WhatsApp</a><button class="btn btn-ghost" id="inv-txt">Скопировать текст</button><button class="btn btn-ghost btn-sm" id="regen">Новая ссылка</button></div>' +
        '<div id="regenBox" class="note" hidden style="margin-top:10px"><b>Старая ссылка перестанет работать.</b> Уже зарегистрированные ученики останутся.<div class="tools"><button class="btn btn-danger btn-sm" id="regen-yes">Выпустить новую</button><button class="btn btn-ghost btn-sm" id="regen-no">Отмена</button></div></div></div>' +
        '<div class="card" style="margin-top:14px"><div class="h2">Мой ритм</div><p class="sm mut" style="margin:4px 0 10px">Только для вас: никто не видит эти цифры. Касание — звонок, заметка, встреча или статус семье.</p>' +
        '<div class="lst"><div class="t"><b>Цель касаний в неделю</b><span class="xs mut">сейчас ' + r.goal + " · на этой неделе " + r.touches + '</span></div><select class="stage-sel" id="goal">' + [5, 8, 10, 15, 20, 30, 40].map(function (n) { return '<option value="' + n + '"' + (n === r.goal ? " selected" : "") + ">" + n + "</option>"; }).join("") + "</select></div>" +
        '<div class="lst"><div class="t"><b>Недели без просрочек</b><span class="xs mut">' + (r.streak ? r.streak + " подряд · всего " + r.total : "всего " + r.total) + " · пропуск раз в месяц серию не рвёт</span></div></div>" +
        '<div class="lst"><div class="t"><b>Эта неделя</b><span class="xs mut">' + (r.quiet ? "на паузе (каникулы, отпуск)" : "в работе") + '</span></div><button class="btn btn-ghost btn-sm" id="quiet">' + (r.quiet ? "Снять паузу" : "Пауза") + "</button></div>" +
        '<div class="lst"><div class="t"><b>Ритм и серии</b><span class="xs mut">выключите, если не хотите видеть счётчики</span></div><button class="btn ' + (p.rhythm === false ? "btn-ghost" : "btn-soft") + ' btn-sm" id="rhythm">' + (p.rhythm === false ? "Выкл" : "Вкл") + "</button></div>" +
        '<div class="lst"><div class="t"><b>Дайджест понедельника в Telegram</b><span class="xs mut" id="tg-sub">' + (S.tg && S.tg.chat_id ? "дедлайны недели, встречи, кто без шага — утром в понедельник" : "бот не привязан: привяжите в кабинете ученика или напишите боту @askScholary_bot") + '</span></div>' + (S.tg && S.tg.chat_id ? '<button class="btn ' + ((S.tg.prefs || {}).ws_digest === false ? "btn-ghost" : "btn-soft") + ' btn-sm" id="tg-digest">' + ((S.tg.prefs || {}).ws_digest === false ? "Выкл" : "Вкл") + "</button>" : '<a class="btn btn-ghost btn-sm" href="https://t.me/askScholary_bot" target="_blank" rel="noopener">Открыть бота</a>') + "</div></div>" +
        '<div class="card" style="margin-top:14px"><div class="h2">Импорт из Excel</div><p class="sm mut" style="margin:4px 0 10px">Скопируйте таблицу из Excel/Google Sheets и вставьте сюда. Колонки: Имя · Класс · Телефон · Email · Родитель · Телефон родителя · Цель (заголовки можно оставить). Дубли по имени и почте пропустим.</p>' +
        '<textarea class="f" id="imp" rows="5" placeholder="Айгерим Сериккызы;11;+7 777 000 00 10;aigerim@gmail.com;Мама, Гульнара;+7 701 000 00 20;Германия · IT"></textarea><div class="tools"><button class="btn btn-primary btn-sm" id="imp-go">Импортировать</button><label class="btn btn-ghost btn-sm" style="cursor:pointer">Файл CSV<input type="file" id="imp-file" accept=".csv,.txt,.tsv" hidden></label><span class="xs mut" id="imp-hint">свободно мест: ' + free + "</span></div></div></div>" +
        '<div><div class="card"><div class="h2">Тариф</div><div class="kv" style="margin-top:8px"><b>План</b><span>' + esc(w.plan_label || w.plan) + '</span><b>Статус</b><span>' + (w.open ? '<span class="pill pill-ok">доступ открыт</span>' : w.status === "active" ? '<span class="pill pill-warn">срок истёк</span>' : '<span class="pill pill-mut">' + esc(w.status) + "</span>") + '</span><b>Период</b><span>' + (w.starts_on ? fmtD(w.starts_on) + " — " : "") + fmtDL(w.ends_on) + '</span><b>Контакт</b><span>' + esc(w.contact_name || "—") + (w.contact_email ? "<br>" + esc(w.contact_email) : "") + "</span></div>" +
        '<div style="margin-top:12px"><b>' + w.used + " из " + w.seats + '</b> <span class="sm mut">мест занято · ' + (free ? "свободно " + free : "мест нет") + '</span><div class="bar"><i style="width:' + Math.min(100, Math.round(100 * w.used / Math.max(1, w.seats))) + '%"></i></div></div>' +
        '<p class="sm mut" style="margin:12px 0 8px">Место = активная карточка. Закрыли сезон — отправьте карточку в архив: место освободится, история останется. Нужно больше — следующий тариф, доплата пропорционально остатку срока.</p>' +
        '<div class="tools"><a class="btn btn-primary btn-sm" href="/prof/#tariffs">Тарифы</a><a class="btn btn-ghost btn-sm" href="https://wa.me/77024666852?text=' + encodeURIComponent("Здравствуйте! Хочу расширить тариф workspace профориентолога (" + w.name + ", код " + w.invite_code + ").") + '" target="_blank" rel="noopener">Написать нам</a></div></div>' +
        '<div class="card" style="margin-top:14px"><div class="h2">Архив · ' + arch.length + '</div><div class="xs mut" style="margin-bottom:6px">Закрытые сезоны. Вернуть можно, если есть свободное место.</div>' + (arch.length ? arch.map(function (s) { return '<div class="lst"><div class="t"><b><a href="#/s/' + esc(s.id) + '/overview" style="color:inherit">' + esc(s.name) + '</a></b><span class="xs mut">' + esc(STAGE_L[s.stage]) + (s.target ? " · " + esc(s.target) : "") + '</span></div><button class="btn btn-ghost btn-sm" data-unarch="' + esc(s.id) + '">Вернуть</button></div>'; }).join("") : '<div class="empty">Архив пуст.</div>') + "</div>" +
        '<div class="card" style="margin-top:14px"><div class="h2">Аккаунт</div><div class="sm mut">' + esc(S.session && S.session.user.email || "") + '</div><div class="tools"><button class="btn btn-ghost btn-sm" id="refresh">Обновить данные</button><button class="btn btn-ghost btn-sm" id="out3">Выйти</button></div></div></div></div>';
      $("inv-copy").onclick = function () { copyText(inviteLink(), "Ссылка скопирована"); track("ws_link_copy"); };
      $("inv-txt").onclick = function () { copyText(text, "Текст скопирован"); };
      $("regen").onclick = function () { $("regenBox").hidden = false; };
      $("regen-no").onclick = function () { $("regenBox").hidden = true; };
      $("regen-yes").onclick = function () { DB.regen().then(function (r2) { if (r2.data && r2.data.ok) { S.ws.invite_code = r2.data.invite_code; toast("Новая ссылка выпущена", "ok"); track("ws_link_regen"); viewSettings(); } else fail(r2, "Не получилось выпустить ссылку"); }); };
      $("refresh").onclick = function () { DB.mine().then(function (r2) { if (r2.data) S.ws = r2.data; viewSettings(); toast("Обновлено", "ok"); }); };
      $("out3").onclick = out;
      $("goal").onchange = function () { var np = Object.assign({}, prefs(), { touch_goal: +$("goal").value }); savePrefs(np, function () { toast("Цель: " + np.touch_goal + " касаний в неделю", "ok"); draw(); }); };
      $("quiet").onclick = function () { var np = Object.assign({}, prefs()), q = (np.quiet || []).slice(), k = Path.weekInfo(todayD()).key, i = q.indexOf(k); if (i >= 0) q.splice(i, 1); else q.push(k); np.quiet = q.slice(-20); savePrefs(np, function () { toast(i >= 0 ? "Пауза снята" : "Неделя на паузе", "ok"); draw(); }); };
      $("rhythm").onclick = function () { var np = Object.assign({}, prefs(), { rhythm: prefs().rhythm === false }); savePrefs(np, draw); };
      var tgd = $("tg-digest"); if (tgd) tgd.onclick = function () { var np = Object.assign({}, S.tg.prefs || {}); np.ws_digest = np.ws_digest === false; DB.tgPref(np).then(function (r2) { if (r2.error) { fail(r2); return; } S.tg.prefs = np; toast(np.ws_digest === false ? "Дайджест выключен" : "Дайджест включён", "ok"); draw(); }); };
      var runImport = function (rows) {
        if (!rows.length) { toast("Не нашли ни одной строки с именем", "bad"); return; }
        $("imp-go").disabled = true;
        DB.importRows(rows).then(function (r2) {
          $("imp-go").disabled = false; var j = r2.data; if (r2.error || !j || !j.ok) { fail(r2, "Импорт не прошёл"); return; }
          toast("Импорт: добавлено " + j.inserted + (j.skipped ? ", пропущено дублей " + j.skipped : "") + (j.seats_full ? " · места закончились" : ""), j.seats_full ? "bad" : "ok"); track("ws_import", { n: j.inserted });
          if (j.inserted) { DB.mine().then(function (r3) { if (r3.data) S.ws = r3.data; location.hash = "#/students"; }); }
        });
      };
      $("imp-go").onclick = function () { runImport(parseCsv($("imp").value)); };
      $("imp-file").onchange = function () { var f = this.files && this.files[0]; if (!f) return; var rd = new FileReader(); rd.onload = function () { $("imp").value = String(rd.result || ""); runImport(parseCsv(rd.result)); }; rd.readAsText(f, "utf-8"); };
      $("view").addEventListener("click", function (e) { var b = e.target.closest("[data-unarch]"); if (!b) return; var s = byId(b.getAttribute("data-unarch")); DB.students.update(s.id, { archived: false }).then(function (r2) { if (r2.error) { fail(r2, "Не получилось вернуть"); return; } s.archived = false; S.ws.used = (S.ws.used || 0) + 1; toast("Возвращён из архива", "ok"); draw(); }); });
    };
    $("view").innerHTML = '<div class="spin"></div>';
    Promise.all([loadAll(), DB.tg ? DB.tg().then(function (r) { S.tg = r && r.data ? r.data : null; }).catch(function () { S.tg = null; }) : Promise.resolve()]).then(draw);
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
