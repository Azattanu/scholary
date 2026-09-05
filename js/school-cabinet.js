/* Scholary · кабинет школы 2.0, /schools/cabinet/ (web-76).
   Роли: владелец (директор/завуч), приглашённые директор и профориентолог (school_staff).
   Данные учеников — только через RPC school_mine / school_roster / school_dashboard (таблицы школ
   закрыты RLS целиком); записи школы — таблицы school_notes / school_student_meta с RLS по school_role().
   Демо (/schools/cabinet/?demo=1): школа и 48 учеников вымышленные, всё живёт в памяти. */
function __schoolCabinetMain() {
  "use strict";
  var C = window.SCHOLARY_CONFIG || {};
  var sb = (window.supabase && window.supabase.createClient) ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY) : null;
  var $ = function (id) { return document.getElementById(id); };
  var track = window.track || function () {};
  var Path = window.ScholaryPath || null;
  var S = { session: null, school: null, roster: [], dash: null, q: "", cls: "", filter: "", entering: false, calMonth: null, calSel: null, weekOff: 0,
            demo: /[?&]demo=1/.test(location.search), mode: null, cur: null, tab: "overview" };

  /* ---------- словари ---------- */
  var L = {
    level: { bachelor: "Бакалавриат", master: "Магистратура", phd: "PhD" },
    field: { it: "IT", eng: "Инженерия", med: "Медицина", bus: "Бизнес", sci: "Науки", hum: "Гуманитарные", art: "Искусство", law: "Право", edu: "Педагогика" },
    cc: { hu: "Венгрия", de: "Германия", it: "Италия", cz: "Чехия", tr: "Турция", cn: "Китай", kr: "Корея", jp: "Япония", pl: "Польша", us: "США", fr: "Франция", nl: "Нидерланды", ae: "ОАЭ", gb: "Великобритания", ca: "Канада", au: "Австралия", es: "Испания", at: "Австрия", ch: "Швейцария", se: "Швеция", fi: "Финляндия", my: "Малайзия", sg: "Сингапур", kz: "Казахстан", ru: "Россия" }
  };
  var NOTE_K = [["call", "Звонок"], ["parent", "Родители"], ["meeting", "Встреча"], ["task", "Задача"], ["note", "Заметка"]];
  var NOTE_L = { note: "Заметка", call: "Звонок", parent: "Родители", meeting: "Встреча", task: "Задача", status: "Статус семье", doc: "Документ" };
  var NOTE_IC = { note: "📝", call: "📞", parent: "👨‍👩‍👧", meeting: "🗓", task: "☑️", status: "💬", doc: "📎" };
  var STEP_TPL = {
    "9": ["Пройти квиз на классном часе", "Выбрать 2–3 направления", "Записаться на пробный IELTS"],
    "10": ["Выбрать 3 страны под профиль", "Назначить дату IELTS", "Портфель: 3 программы", "Встреча с родителями: план и бюджет"],
    "11": ["Собрать пакет по чек-листу", "Заказать апостиль (до 20 рабочих дней)", "Финал мотивационного письма", "Подать заявку на портале", "Проверить почту и портал вуза"]
  };
  /* Окна сезона РК (64-b2 § сезон): для календаря школы. MM-DD */
  var SEASON = [
    ["09-15", "Классные часы: регистрация 9–11"], ["10-15", "DAAD — окна большинства программ"], ["10-31", "GKS (Корея) — окно посольства"], ["11-05", "Chevening — дедлайн"],
    ["11-20", "Регистрация на январское ЕНТ"], ["12-15", "EPFL / ENS / MBZUAI — 15.12"], ["01-10", "Январское ЕНТ — начало"], ["01-15", "Stipendium Hungaricum — дедлайн"],
    ["02-14", "CSC (Китай) — дедлайн"], ["02-20", "Türkiye Bursları — дедлайн"], ["03-16", "Болашак — открытие приёма"], ["03-20", "Мартовское ЕНТ"], ["03-31", "Италия MAECI / DSU — окна"],
    ["05-10", "Основное ЕНТ — начало"], ["06-15", "Выпуск · отчёт года"], ["07-10", "Основное ЕНТ — конец"], ["10-16", "Болашак — закрытие приёма"]
  ];
  /* Подсказка недели для школы по половинам месяца — числа только из ростера */
  var HINTS = {
    "9-1": { t: "Старт сезона: подключить параллель", f: function (x) { return x.noQuiz + " без расчёта · " + x.total + " подключено из " + x.seats; }, act: "students:noquiz" },
    "9-2": { t: "11 класс: первые списки вузов", f: function (x) { return x.noPlan11 + " одиннадцатиклассников без единой программы"; }, act: "students:noplan" },
    "10-1": { t: "Родительские собрания: бюджет и план", f: function (x) { return x.noStatus + " семей без статуса 21+ дней"; }, act: "students:family" },
    "10-2": { t: "Первые окна: DAAD, GKS", f: function (x) { return x.dl30 + " дедлайнов в 30 дней · " + x.dl30bad + " без документов"; }, act: "calendar" },
    "11-1": { t: "Апостиль и переводы — стартовать сейчас", f: function (x) { return x.docsZero + " учеников с планом, но без единого документа"; }, act: "students:docs" },
    "11-2": { t: "Регистрация на январское ЕНТ", f: function (x) { return x.idle + " учеников не заходили 14+ дней"; }, act: "students:idle" },
    "12-1": { t: "Мотивационные письма", f: function (x) { return x.noStep + " без следующего шага"; }, act: "students:nostep" },
    "12-2": { t: "Каникулы: две свободные недели", f: function (x) { return x.idle + " без активности 14+ дней"; }, act: "students:idle" },
    "1-1": { t: "Пик № 1: ЕНТ + Stipendium Hungaricum 15.01", f: function (x) { return x.dl30 + " дедлайнов в 30 дней · " + x.dl30bad + " без документов"; }, act: "calendar" },
    "1-2": { t: "Проверка пакетов перед февралём", f: function (x) { return x.dl30bad + " подач с дедлайном ≤ 30 дней и неготовыми документами"; }, act: "students:dl" },
    "2-1": { t: "Пик № 2: CSC 14.02, Türkiye 20.02", f: function (x) { return x.dl30 + " дедлайнов в 30 дней"; }, act: "calendar" },
    "2-2": { t: "Регистрация на мартовское ЕНТ", f: function (x) { return x.sent + " подач ждут ответа"; }, act: "students:sent" },
    "3-1": { t: "Болашак открылся 16.03", f: function (x) { return x.dl30 + " дедлайнов в 30 дней"; }, act: "calendar" },
    "3-2": { t: "Ответы вузов", f: function (x) { return x.sent + " подач без исхода"; }, act: "students:sent" },
    "4-1": { t: "Запасные окна и 10 класс", f: function (x) { return x.noPlan10 + " десятиклассников без плана"; }, act: "students:noplan" },
    "4-2": { t: "Подготовка отчёта года", f: function (x) { return x.offers + " офферов · " + x.sentAll + " подач"; }, act: "report" },
    "5-1": { t: "Основное ЕНТ", f: function (x) { return x.idle + " не заходили 14+ дней"; }, act: "students:idle" },
    "5-2": { t: "Итоги для семей", f: function (x) { return x.noStatus + " семей без статуса"; }, act: "students:family" },
    "6-1": { t: "Выпуск: отчёт года и архив сезона", f: function (x) { return x.offers + " офферов у выпуска"; }, act: "report" },
    "6-2": { t: "Планирование следующего сезона", f: function (x) { return x.noPlan10 + " десятиклассников без плана на осень"; }, act: "students:noplan" }
  };
  var DEFAULT_HINT = { t: "Летние недели", f: function (x) { return x.noPlan10 + " десятиклассников без плана"; }, act: "students:noplan" };

  /* ---------- утилиты ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[<>&"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]; }); }
  function show(id) { ["loading", "v-auth", "v-none", "v-app"].forEach(function (v) { $(v).hidden = v !== id; }); }
  function toast(msg, kind) { var t = document.createElement("div"); t.className = "toast" + (kind ? " " + kind : ""); t.textContent = msg; $("toast-root").appendChild(t); setTimeout(function () { t.remove(); }, 3400); }
  function qs(name) { var m = location.search.match(new RegExp("[?&]" + name + "=([^&]+)")); return m ? decodeURIComponent(m[1]) : ""; }
  function todayD() { var t = window.__SCHOLARY_NOW ? new Date(window.__SCHOLARY_NOW) : new Date(); t.setHours(0, 0, 0, 0); return t; }
  function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function isoToday(off) { return iso(addDays(todayD(), off || 0)); }
  function fmtD(s) { if (!s) return "—"; return new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }); }
  function fmtDn(s) { return fmtD(s).replace(/\.$/, ""); }
  function fmtDL(s) { if (!s) return "—"; return new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }); }
  function fmtDT(s) { if (!s) return ""; return fmtD(s) + ", " + new Date(s).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }); }
  function fmtT(t) { return t ? String(t).slice(0, 5) : ""; }
  function daysTo(s) { if (!s) return null; var d = new Date(s); d.setHours(0, 0, 0, 0); return Math.round((d - todayD()) / 864e5); }
  function daysAgo(s) { if (!s) return null; return Math.floor((todayD() - new Date(s)) / 864e5) + (new Date(s).getHours() ? 0 : 0); }
  function plural(n, a, b, c) { n = Math.abs(n) % 100; var m = n % 10; if (n > 10 && n < 20) return c; if (m > 1 && m < 5) return b; if (m === 1) return a; return c; }
  function pct(a, b) { return b ? Math.round(100 * a / b) : 0; }
  function listOf(v) { if (!v) return []; if (Array.isArray(v)) return v; try { var j = JSON.parse(v); if (Array.isArray(j)) return j; } catch (e) {} return String(v).replace(/[\[\]"]/g, "").split(",").map(function (x) { return x.trim(); }).filter(Boolean); }
  function countries(r) { return listOf(r.countries).map(function (x) { return L.cc[String(x).toLowerCase()] || x; }); }
  function fields(r) { return listOf(r.field).map(function (x) { return L.field[x] || x; }); }
  function direction(r) { var c = countries(r).slice(0, 2).join(", "), f = fields(r).slice(0, 2).join(", "); return [c, f].filter(Boolean).join(" · ") || (r.quiz_done ? "" : "квиз не пройден"); }
  function firstName(n) { return String(n || "").split(" ")[0]; }
  function waNum(p) { var d = String(p || "").replace(/\D/g, ""); if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1); if (d.length === 10) d = "7" + d; return d; }
  function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : ""; }
  function docsPct(r) { return r.docs ? Math.round(100 * (r.docs_ready || 0) / r.docs) : (r.apps ? 0 : null); }
  function lastSeen(r) { var a = r.cab_last_day || r.last_active; return a; }
  function byId(uid) { for (var i = 0; i < S.roster.length; i++) if (S.roster[i].user_id === uid) return S.roster[i]; return null; }
  function link(r) { return '<a href="#/s/' + esc(r.user_id) + '">' + esc(r.name) + "</a>"; }
  function classOrder(a, b) { var ga = parseInt(a, 10) || 99, gb = parseInt(b, 10) || 99; return gb - ga || String(a).localeCompare(String(b), "ru"); }
  function classes() { var m = {}; S.roster.forEach(function (r) { var k = r.class_label || (r.grade ? r.grade + " кл." : "без класса"); (m[k] = m[k] || []).push(r); }); return Object.keys(m).sort(classOrder).map(function (k) { return { label: k, grade: (m[k][0].grade || "").replace(/\D/g, ""), rows: m[k] }; }); }
  function seasonLabel() { var t = todayD(), y = t.getMonth() >= 8 ? t.getFullYear() : t.getFullYear() - 1; return y + "/" + String(y + 1).slice(2); }
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
  function formData(f) { var o = {}; new FormData(f).forEach(function (v, k) { o[k] = typeof v === "string" ? v.trim() : v; }); return o; }
  function fail(r, msg) { console.warn(r && r.error); toast(msg || ((r && r.error && r.error.message) || "Не получилось"), "bad"); }
  function copy(text, okMsg) { var done = function () { toast(okMsg || "Скопировано", "ok"); }; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); }); else { fallbackCopy(text); done(); } }
  function fallbackCopy(text) { var ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {} ta.remove(); }

  /* ---------- демо-данные: школа на 500 мест, 48 подключённых учеников ---------- */
  function demoData() {
    var d = isoToday, ago = function (n, h) { var x = new Date(todayD().getTime() - n * 864e5); x.setHours(h == null ? 11 : h, 20, 0, 0); return x.toISOString(); };
    var school = { id: "demo", name: "Школа-лицей №39", city: "Алматы", kind: "state", plan: "s500", plan_label: "Школа · до 500", period: "year",
      seats: 500, used: 48, status: "active", open: true, invite_code: "DEMO2026", starts_on: d(-60), ends_on: d(305), role: "owner",
      contact_name: "Гульнара Сапаровна", contact_email: "director@school39.kz", prefs: { touch_goal: 10 }, students: 0,
      staff: [{ id: 1, role: "director", name: "Гульнара Сапаровна", email: "director@school39.kz", token: "demo-d", claimed: true }, { id: 2, role: "counselor", name: "Айгуль Сериковна", email: "aigul@school39.kz", token: "demo-c", claimed: true }] };
    /* [имя, класс, уровень, поле, страны, квиз, p_adm, apps, apps_sent, offers, docs, docs_ready, dl+, lastActive-, cabLast-, joined-, parent_phone, next_step, step+, status-, note] */
    var rows = [
      ["Айгерим Сериккызы", "11А", "bachelor", "it", "hu,de", 1, 0.74, 4, 1, 1, 6, 5, 70, 0, 0, 40, "+7 701 000 00 20", "Финал мотивационного письма для SH", 4, 6, "Мама — главный контакт. Целится в Германию, Венгрия — запасная."],
      ["Данияр Касымов", "11Б", "bachelor", "eng", "it,tr", 1, 0.61, 3, 0, 0, 5, 1, 12, 9, 9, 38, "+7 701 000 00 10", "Заказать апостиль", -3, 25, "Папа против Турции, мама за."],
      ["Нурсултан Абай", "11В", "bachelor", "law", "nl", 1, 0.39, 2, 0, 0, 4, 1, 18, 14, 14, 36, "+7 701 000 00 30", null, null, null, ""],
      ["Ерасыл Мухамедиев", "11Б", "bachelor", "it", "kr", 1, 0.47, 2, 0, 0, 3, 1, 21, 12, 12, 35, "+7 701 000 00 40", "Назначить дату IELTS", 2, 30, ""],
      ["Санжар Оразбек", "11В", "bachelor", "eng", "tr,hu", 1, 0.71, 3, 3, 2, 5, 5, 33, 0, 0, 44, "+7 701 000 00 50", "Виза: собрать пакет", 5, 4, "Два оффера, выбирает BME."],
      ["Аружан Нурланова", "11А", "bachelor", "sci", "de,cz", 1, 0.68, 5, 2, 0, 7, 6, 44, 1, 1, 42, "+7 701 000 00 60", "Проверить пакет по чек-листу", 3, 10, ""],
      ["Камила Ержан", "11А", "bachelor", "med", "cn,hu", 1, 0.63, 4, 1, 0, 6, 4, 58, 1, 1, 41, "+7 701 000 00 70", "Рекомендация от учителя биологии", 6, 12, ""],
      ["Алихан Бекжан", "11А", "bachelor", "bus", "cn", 1, 0.56, 2, 2, 0, 4, 4, 120, 2, 2, 39, "+7 701 000 00 80", "Проверить почту и портал вуза", 8, 18, ""],
      ["Мадина Сулейменова", "11Б", "bachelor", "art", "it", 1, 0.52, 1, 0, 0, 2, 0, 160, 6, 6, 30, "+7 701 000 00 90", null, null, null, ""],
      ["Асель Кайрат", "11Б", "bachelor", "it", "kr,jp", 1, 0.58, 3, 0, 0, 4, 2, 47, 3, 3, 33, "", "Созвон: возвращаемся к плану?", 1, 40, "Хотела в Японию, родители сомневаются."],
      ["Ислам Токтаров", "11В", "bachelor", "eng", "de", 1, 0.44, 2, 0, 0, 3, 0, 40, 15, 16, 28, "+7 701 000 01 00", null, null, null, ""],
      ["Дана Абдрахманова", "11В", "bachelor", "hum", "pl,cz", 1, 0.5, 2, 0, 0, 3, 2, 95, 4, 4, 31, "+7 701 000 01 10", "Финал мотивационного письма", 5, 15, ""],
      ["Тимур Жумабеков", "11А", "bachelor", "bus", "ae,my", 1, 0.49, 2, 0, 0, 2, 1, 130, 22, 23, 29, "+7 701 000 01 20", null, null, null, ""],
      ["Аяулым Бектур", "11Б", "bachelor", "med", "hu", 1, 0.66, 3, 1, 0, 6, 5, 60, 0, 0, 37, "+7 701 000 01 30", "Собрать пакет по чек-листу", 7, 9, ""],
      ["Ержан Сагындык", "11В", "bachelor", "it", "de,at", 1, 0.62, 3, 0, 0, 5, 3, 40, 2, 2, 34, "+7 701 000 01 40", "Заказать нотариальный перевод", 4, 20, ""],
      ["Жанель Оспанова", "11А", "bachelor", "sci", "fr,de", 1, 0.59, 2, 0, 0, 4, 1, 100, 5, 5, 32, "", null, null, null, ""],
      ["Бекзат Тулеген", "10А", "bachelor", "it", "de", 1, 0.58, 2, 0, 0, 3, 3, 131, 4, 4, 30, "+7 701 000 01 50", "Выбрать 3 страны под профиль", -6, null, ""],
      ["Диана Ахметова", "10Б", "bachelor", "hum", "pl", 1, 0.52, 1, 0, 0, 2, 2, 160, 3, 3, 27, "+7 701 000 01 60", "Встреча с родителями: план и бюджет", 9, null, "Хочет Варшаву, смотрит психологию."],
      ["Томирис Жаксыбек", "10А", "bachelor", "med", "tr", 0, null, 0, 0, 0, 0, 0, null, 0, null, 6, "+7 701 000 01 70", "Пройти квиз на классном часе", 2, null, ""],
      ["Арман Досов", "10А", "bachelor", "it", "cz", 1, 0.55, 1, 0, 0, 2, 0, 200, 7, 7, 25, "+7 701 000 01 80", null, null, null, ""],
      ["Сабина Нургалиева", "10А", "bachelor", "bus", "hu,cn", 1, 0.5, 2, 0, 0, 1, 0, 180, 10, 10, 24, "", "Портфель: 3 программы", 5, null, ""],
      ["Дамир Ахметжанов", "10Б", "bachelor", "eng", "kr", 1, 0.47, 1, 0, 0, 0, 0, 220, 20, 21, 23, "+7 701 000 01 90", null, null, null, ""],
      ["Аружан Кенес", "10Б", "bachelor", "sci", "de", 1, 0.6, 2, 0, 0, 2, 1, 210, 2, 2, 22, "+7 701 000 02 00", "Назначить дату IELTS", 10, null, ""],
      ["Нурай Бекболат", "10А", "bachelor", "art", "it,fr", 0, null, 0, 0, 0, 0, 0, null, 12, null, 20, "", null, null, null, ""],
      ["Ринат Мусин", "10Б", "bachelor", "it", "pl", 1, 0.53, 1, 0, 0, 1, 0, 240, 30, 31, 21, "+7 701 000 02 10", null, null, null, ""],
      ["Зере Абылай", "10А", "bachelor", "med", "hu,cz", 1, 0.57, 2, 0, 0, 3, 1, 150, 1, 1, 19, "+7 701 000 02 20", "Выбрать 3 страны под профиль", 3, null, ""],
      ["Али Сейтказы", "10Б", "bachelor", "eng", "tr", 0, null, 0, 0, 0, 0, 0, null, null, null, 4, "", null, null, null, ""],
      ["Аида Жанболат", "10А", "bachelor", "hum", "de", 1, 0.48, 1, 0, 0, 1, 0, 300, 45, 46, 18, "+7 701 000 02 30", null, null, null, ""],
      ["Мирас Ерлан", "10Б", "bachelor", "bus", "ae", 1, 0.45, 0, 0, 0, 0, 0, null, 8, 8, 17, "", null, null, null, ""],
      ["Инкар Мухтар", "10А", "bachelor", "sci", "fi,se", 1, 0.61, 2, 0, 0, 2, 2, 170, 0, 0, 16, "+7 701 000 02 40", "Портфель: 3 программы", 6, null, ""],
      ["Ерке Сулейман", "9А", "bachelor", "it", "de", 1, 0.5, 0, 0, 0, 0, 0, null, 3, 3, 15, "+7 701 000 02 50", null, null, null, ""],
      ["Алдияр Нуркен", "9А", "bachelor", "eng", "kr", 0, null, 0, 0, 0, 0, 0, null, 5, null, 14, "", null, null, null, ""],
      ["Айша Талгат", "9Б", "bachelor", "med", "hu", 1, 0.46, 0, 0, 0, 0, 0, null, 1, 1, 13, "", null, null, null, ""],
      ["Нурислам Бахыт", "9Б", "bachelor", "bus", "cn", 0, null, 0, 0, 0, 0, 0, null, null, null, 3, "", null, null, null, ""],
      ["Аружан Сапар", "9А", "bachelor", "art", "it", 1, 0.44, 1, 0, 0, 0, 0, 320, 2, 2, 12, "", null, null, null, ""],
      ["Данияр Оспан", "9Б", "bachelor", "it", "de,nl", 1, 0.52, 0, 0, 0, 0, 0, null, 9, 9, 11, "", null, null, null, ""],
      ["Ботагоз Ерболат", "9А", "bachelor", "hum", "pl", 0, null, 0, 0, 0, 0, 0, null, 18, null, 10, "", null, null, null, ""],
      ["Санжар Мейрам", "9Б", "bachelor", "sci", "cz", 1, 0.49, 0, 0, 0, 0, 0, null, 4, 4, 9, "", null, null, null, ""],
      ["Аяжан Куат", "9А", "bachelor", "med", "tr", 0, null, 0, 0, 0, 0, 0, null, null, null, 2, "", null, null, null, ""],
      ["Ильяс Сарсен", "9Б", "bachelor", "eng", "de", 1, 0.47, 0, 0, 0, 0, 0, null, 6, 6, 8, "", null, null, null, ""],
      ["Малика Абдулла", "9А", "bachelor", "bus", "ae,gb", 0, null, 0, 0, 0, 0, 0, null, 25, null, 7, "", null, null, null, ""],
      ["Темирлан Жол", "9Б", "bachelor", "it", "kr", 1, 0.5, 0, 0, 0, 0, 0, null, 0, 0, 6, "", null, null, null, ""],
      ["Гаухар Асан", "9А", "bachelor", "sci", "de", 1, 0.53, 0, 0, 0, 0, 0, null, 7, 7, 5, "", null, null, null, ""],
      ["Рамазан Кайыр", "9Б", "bachelor", "eng", "tr", 0, null, 0, 0, 0, 0, 0, null, null, null, 2, "", null, null, null, ""],
      ["Асем Даулет", "11Б", "bachelor", "hum", "cz,pl", 1, 0.54, 2, 0, 0, 3, 1, 60, 16, 16, 26, "+7 701 000 02 60", null, null, null, ""],
      ["Мансур Али", "11В", "bachelor", "it", "de", 1, 0.6, 3, 1, 0, 5, 4, 45, 0, 0, 27, "+7 701 000 02 70", "Подать заявку на портале", 2, 8, ""],
      ["Лаура Серик", "11А", "bachelor", "bus", "hu,it", 1, 0.57, 2, 0, 0, 4, 2, 38, 3, 3, 28, "+7 701 000 02 80", "Заказать апостиль", 3, 22, ""],
      ["Куаныш Батыр", "11В", "bachelor", "eng", "cn,kr", 1, 0.51, 2, 0, 0, 3, 0, 26, 11, 11, 24, "+7 701 000 02 90", null, null, null, ""]
    ];
    var progs = { hu: ["Stipendium Hungaricum", "full"], de: ["DAAD / TU9", "partial"], it: ["Politecnico di Milano — DSU", "partial"], tr: ["Türkiye Bursları", "full"], kr: ["GKS", "full"], cn: ["CSC Scholarship", "full"], nl: ["University of Amsterdam", "none"], cz: ["Charles University", "partial"], pl: ["NAWA", "full"], ae: ["Khalifa University", "full"], my: ["UM Malaysia", "partial"], jp: ["MEXT", "full"], fr: ["Eiffel", "full"], at: ["TU Wien", "none"], fi: ["Aalto", "none"], se: ["KTH", "none"], gb: ["UCL", "none"] };
    var roster = rows.map(function (r, i) {
      var uid = "u" + (i + 1), cc = r[4].split(",");
      return { user_id: uid, name: r[0], class_label: r[1], grade: r[1].replace(/\D/g, ""), level: r[2], field: r[3], countries: r[4], quiz_done: !!r[5], p_adm: r[6], apps: r[7], apps_sent: r[8], offers: r[9], docs: r[10], docs_ready: r[11],
        next_deadline: r[12] == null ? null : d(r[12]), last_active: r[13] == null ? null : ago(r[13]), cab_last_day: r[14] == null ? null : d(-r[14]), joined_at: ago(r[15]), pro: true,
        parent_phone: r[16] || null, parent_name: r[16] ? (i % 2 ? "Мама" : "Папа") : null, next_step: r[17], next_step_on: r[18] == null ? null : d(r[18]), last_status_at: r[19] == null ? null : ago(r[19]), note: r[20] || null,
        last_touch: r[19] == null ? (r[13] != null && r[13] < 5 ? ago(r[13] + 2) : null) : ago(r[19]), tasks_open: 0, _cc: cc, _prog: progs[cc[0]] };
    });
    var notes = [], nid = 1, add = function (uid, kind, text, daysAgoN, due, time, done) { notes.push({ id: nid++, school_id: "demo", user_id: uid, kind: kind, text: text, due_on: due == null ? null : d(due), at_time: time || null, done: kind === "task" ? !!done : null, done_at: done ? ago(1) : null, created_at: ago(daysAgoN, 10 + (nid % 8)) }); };
    add("u2", "task", "Напомнить про апостиль — ЦОН до 20 рабочих дней", 4, -1); add("u3", "task", "Мотивационное: прислать правки до пятницы", 3, 2); add("u4", "task", "Паспорт: узнать срок готовности", 2, 3);
    add("u19", "task", "Отправить ссылку на регистрацию и квиз", 1, 1); add("u11", "task", "Позвонить родителям: не заходит 2 недели", 1, 0); add("u6", "task", "Проверить пакет по чек-листу", 5, 6);
    add(null, "task", "Классный час 9Б: регистрация в Scholary", 2, 4); add("u12", "task", "Финал письма", 9, -3, null, true); add("u1", "task", "Правки письма", 8, -4, null, true); add("u5", "task", "Отметить исход подачи", 6, -2, null, true);
    add("u2", "meeting", "Созвон с мамой: план по документам", 3, 1, "18:30"); add("u6", "meeting", "Встреча с семьёй: бюджет и запасной вариант", 2, 3, "16:00"); add("u18", "meeting", "Встреча с родителями: план и бюджет", 1, 9, "17:00");
    add(null, "meeting", "Родительское собрание 11-х: поступление за рубеж", 4, 12, "18:00");
    add("u1", "status", "Статус семье: этап подача, SH готовим, письмо в работе", 6); add("u5", "status", "Статус семье: два оффера, выбор до 1 октября", 4); add("u2", "parent", "Мама: договорились о репетиторе по IELTS", 2);
    add("u1", "call", "Созвон: остались 2 документа, план до 20 сент.", 1); add("u10", "call", "Созвон: возвращаемся к плану, родители согласны на Корею", 2); add("u17", "note", "Сильный профиль по математике, смотрит TUM", 12);
    add("u7", "parent", "Папа: готовы оплатить IELTS в октябре", 5); add("u8", "call", "Проверили портал Fudan — ждём ответа", 3); add("u14", "note", "Хочет медицину в Дебрецене", 7);
    var deadlines = [], offers = [];
    roster.forEach(function (r) { if (r.next_deadline && r.apps > r.apps_sent) deadlines.push({ user_id: r.user_id, program: r._prog[0], cc: r._cc[0], deadline: r.next_deadline }); if (r.offers) { offers.push({ user_id: r.user_id, name: r.name, class_label: r.class_label, program: r._prog[0], cc: r._cc[0], funding: r._prog[1] }); if (r.offers > 1) offers.push({ user_id: r.user_id, name: r.name, class_label: r.class_label, program: "Stipendium Hungaricum — BME", cc: "hu", funding: "full" }); } });
    var activity = []; for (var k = 60; k >= 0; k--) { var day = addDays(todayD(), -k), wd = day.getDay(); if (wd === 0 || wd === 6) continue; if (k % 3 === 0 || k < 6) activity.push({ day: iso(day), actions: 1 + (k % 4), progress: wd === 1 && k > 7 }); }
    var seasons = [{ season: "2025/26", archived_at: d(-80), snapshot: { students: 41, quiz: 33, plan: 19, docs: 12, sent: 9, offers: 5, funded: 4, countries: ["Венгрия", "Турция", "Германия", "Китай"] } }];
    var mon = addDays(todayD(), -((todayD().getDay() + 6) % 7));
    var dash = { today: isoToday(), week_start: iso(mon), role: "owner", prefs: school.prefs, tasks: [], meetings: [], deadlines: deadlines, offers: offers, activity: activity, seasons: seasons,
      week: { touches: 9, tasks_done: 3, statuses: 2, joined: 4, quiz: 5, docs_ready: 6, apps_sent: 2, prev: { touches: 7, joined: 6 } } };
    return { school: school, roster: roster, notes: notes, dash: dash, nid: nid };
  }

  /* ---------- слой данных ---------- */
  var DB;
  if (S.demo) {
    var D = demoData();
    var relDash = function () { var t = todayD(); D.dash.tasks = D.notes.filter(function (n) { return n.kind === "task" && !n.done; }).map(function (n) { return { id: n.id, user_id: n.user_id, text: n.text, due_on: n.due_on, created_at: n.created_at }; }); D.dash.meetings = D.notes.filter(function (n) { return n.kind === "meeting" && n.due_on && Math.abs(daysTo(n.due_on)) <= 60; }).map(function (n) { return { id: n.id, user_id: n.user_id, text: n.text, due_on: n.due_on, at_time: n.at_time }; }); return JSON.parse(JSON.stringify(D.dash)); };
    var meta = function (uid, patch) { var r = D.roster.filter(function (x) { return x.user_id === uid; })[0]; if (r && patch) Object.keys(patch).forEach(function (k) { r[k] = patch[k]; }); return r; };
    DB = {
      mine: function () { D.school.used = D.roster.length; return Promise.resolve({ data: JSON.parse(JSON.stringify(D.school)) }); },
      roster: function () { return Promise.resolve({ data: JSON.parse(JSON.stringify(D.roster)) }); },
      dash: function () { return Promise.resolve({ data: relDash() }); },
      notes: {
        list: function (uid) { return Promise.resolve({ data: D.notes.filter(function (n) { return n.user_id === uid; }).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }) }); },
        add: function (row) { var n = Object.assign({ id: D.nid++, school_id: "demo", created_at: new Date().toISOString(), done: row.kind === "task" ? false : null, done_at: null }, row); D.notes.push(n); if (n.kind === "status" && n.user_id) meta(n.user_id, { last_status_at: n.created_at }); return Promise.resolve({ data: n }); },
        update: function (id, patch) { var n = D.notes.filter(function (x) { return x.id === +id; })[0]; if (n) { Object.assign(n, patch); if (n.kind === "task") n.done_at = n.done ? new Date().toISOString() : null; } return Promise.resolve({ data: n }); },
        remove: function (id) { D.notes = D.notes.filter(function (x) { return x.id !== +id; }); return Promise.resolve({ data: true }); }
      },
      meta: function (uid, patch) { meta(uid, patch); return Promise.resolve({ data: true }); },
      touch: function () { return Promise.resolve({ data: { ok: true } }); },
      setPrefs: function (p) { D.school.prefs = p; D.dash.prefs = p; return Promise.resolve({ data: { ok: true } }); },
      regen: function () { D.school.invite_code = "DEMO" + Math.random().toString(36).slice(2, 6).toUpperCase(); return Promise.resolve({ data: { ok: true, invite_code: D.school.invite_code } }); },
      remove: function (uid) { D.roster = D.roster.filter(function (r) { return r.user_id !== uid; }); return Promise.resolve({ data: { ok: true } }); },
      invite: function (role, name, email) { var id = D.school.staff.length + 1; D.school.staff.push({ id: id, role: role, name: name, email: email, token: "demo-" + id, claimed: false }); return Promise.resolve({ data: { ok: true, id: id, token: "demo-" + id } }); },
      staffRemove: function (id) { D.school.staff = D.school.staff.filter(function (s) { return s.id !== id; }); return Promise.resolve({ data: { ok: true } }); },
      archive: function (season, snap) { D.dash.seasons = D.dash.seasons.filter(function (s) { return s.season !== season; }).concat([{ season: season, snapshot: snap, archived_at: new Date().toISOString() }]); return Promise.resolve({ data: { ok: true } }); }
    };
    sb = { auth: {
      getSession: function () { return Promise.resolve({ data: { session: { user: { id: "demo", email: "demo@scholary.kz" } } } }); },
      onAuthStateChange: function (cb) { setTimeout(function () { cb("SIGNED_IN", { user: { id: "demo", email: "demo@scholary.kz" } }); }, 10); return { data: { subscription: { unsubscribe: function () {} } } }; },
      signOut: function () { return Promise.resolve({}); }, signInWithOAuth: function () { return Promise.resolve({}); }, signInWithPassword: function () { return Promise.resolve({}); }, signUp: function () { return Promise.resolve({}); }, resetPasswordForEmail: function () { return Promise.resolve({}); }
    }, rpc: function () { return Promise.resolve({ data: null }); } };
    $("demoBar").hidden = false; document.title = "Демо кабинета школы — Scholary";
  } else {
    DB = {
      mine: function () { return sb.rpc("school_mine", { p_kind: "school" }); },
      roster: function () { return sb.rpc("school_roster"); },
      dash: function () { return sb.rpc("school_dashboard"); },
      notes: {
        list: function (uid) { return sb.from("school_notes").select("*").eq("school_id", S.school.id).eq("user_id", uid).order("created_at", { ascending: false }); },
        add: function (row) { return sb.from("school_notes").insert(Object.assign({ school_id: S.school.id }, row)).select().single(); },
        update: function (id, patch) { return sb.from("school_notes").update(patch).eq("id", id).select().single(); },
        remove: function (id) { return sb.from("school_notes").delete().eq("id", id); }
      },
      meta: function (uid, patch) { return sb.from("school_student_meta").upsert(Object.assign({ school_id: S.school.id, user_id: uid, updated_at: new Date().toISOString() }, patch), { onConflict: "school_id,user_id" }); },
      touch: function (progress) { return sb.rpc("school_touch", { p_progress: !!progress }); },
      setPrefs: function (p) { return sb.rpc("school_prefs_set", { p: p }); },
      regen: function () { return sb.rpc("school_regen_code", { p_kind: "school" }); },
      remove: function (uid) { return sb.rpc("school_remove_member", { p_user: uid }); },
      invite: function (role, name, email) { return sb.rpc("school_staff_invite", { p_role: role, p_name: name || null, p_email: email || null }); },
      staffRemove: function (id) { return sb.rpc("school_staff_remove", { p_id: id }); },
      archive: function (season, snap) { return sb.rpc("school_archive_season", { p_season: season, p_snapshot: snap }); }
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
  function nextPath() { var claim = qs("claim"), staff = qs("staff"); return "/schools/cabinet/" + (claim ? "?claim=" + encodeURIComponent(claim) : staff ? "?staff=" + encodeURIComponent(staff) : ""); }
  $("lnk-signup").onclick = function (e) { e.preventDefault(); authView("signup"); };
  $("lnk-login").onclick = function (e) { e.preventDefault(); authView("login"); };
  $("lnk-login2").onclick = function (e) { e.preventDefault(); authView("login"); };
  $("lnk-forgot").onclick = function (e) { e.preventDefault(); authView("forgot"); };
  $("btn-google").onclick = function () {
    try { localStorage.setItem("scholary_next", nextPath()); } catch (e) {}
    sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + "/cabinet/" } })
      .then(function (r) { if (r.error) authErr("li-err", { message: "Google-вход недоступен — войдите по почте" }); });
  };
  $("f-login").onsubmit = function (e) { e.preventDefault(); $("li-err").hidden = true; sb.auth.signInWithPassword({ email: $("li-email").value.trim(), password: $("li-pass").value }).then(function (r) { if (r.error) authErr("li-err", r.error); }); };
  $("f-signup").onsubmit = function (e) {
    e.preventDefault(); $("su-err").hidden = true;
    sb.auth.signUp({ email: $("su-email").value.trim(), password: $("su-pass").value, options: { data: { name: $("su-name").value.trim() }, emailRedirectTo: location.origin + nextPath() } }).then(function (r) {
      if (r.error) { authErr("su-err", r.error); return; }
      if (!r.data || !r.data.session) { var el = $("su-err"); el.textContent = "Письмо с подтверждением отправлено на " + $("su-email").value.trim() + " — откройте ссылку из него и вернитесь сюда"; el.hidden = false; }
    });
  };
  $("f-forgot").onsubmit = function (e) { e.preventDefault(); $("fg-err").hidden = true; sb.auth.resetPasswordForEmail($("fg-email").value.trim(), { redirectTo: location.origin + "/cabinet/" }).then(function (r) { if (r.error) { authErr("fg-err", r.error); return; } $("fg-ok").hidden = false; }); };
  function out() { if (S.demo) { location.href = "/schools/"; return; } sb.auth.signOut().then(function () { location.href = "/schools/cabinet/"; }); }
  $("btn-out").onclick = out; $("btn-out2").onclick = out;

  function enter() {
    if (S.entering) return; S.entering = true; show("loading");
    var claim = qs("claim"), staff = qs("staff");
    var p = claim ? sb.rpc("school_claim", { p_token: claim }).then(function (r) {
      var j = r.data;
      if (j && j.ok) { track("school_claim_ok"); history.replaceState(null, "", "/schools/cabinet/"); toast("Кабинет школы " + j.name + " привязан к вашему аккаунту", "ok"); }
      else if (j && j.why === "taken") toast("Эта школа уже привязана к другому аккаунту — войдите им или напишите нам", "bad");
      else if (j && j.why === "not_found") toast("Ссылка привязки не найдена — откройте актуальное письмо", "bad");
    }) : staff ? sb.rpc("school_staff_claim", { p_token: staff }).then(function (r) {
      var j = r.data;
      if (j && j.ok) { track("school_staff_claim_ok", { role: j.role }); history.replaceState(null, "", "/schools/cabinet/"); toast("Вы добавлены в кабинет школы как " + (j.role === "director" ? "директор" : "профориентолог"), "ok"); }
      else if (j && j.why === "taken") toast("Эта ссылка уже использована другим аккаунтом", "bad");
      else toast("Ссылка приглашения не найдена — попросите новую", "bad");
    }) : Promise.resolve();
    p.then(function () { return DB.mine(); }).then(function (r) {
      S.entering = false; S.school = r.data || null;
      if (!S.school) { $("noneEmail") && ($("noneEmail").textContent = (S.session && S.session.user.email) || ""); show("v-none"); track("school_cab_none"); return; }
      try { S.mode = localStorage.getItem("sc_mode") || null; } catch (e) {}
      if (!S.mode) S.mode = S.school.role === "counselor" ? "counselor" : "director";
      if (qs("from") === "tg") track("school_deeplink", { from: "tg" });
      show("v-app"); track("school_cab_open", { role: S.school.role, n: S.school.used });
      if (!location.hash || location.hash === "#/") location.hash = S.mode === "counselor" ? "#/week" : "#/summary";
      route();
    });
  }
  function loadAll() { return Promise.all([DB.roster(), DB.dash()]).then(function (rs) { S.roster = rs[0].data || []; S.dash = rs[1].data || { week: {}, tasks: [], meetings: [], deadlines: [], activity: [], seasons: [], offers: [] }; return true; }); }
  function touch(progress) { DB.touch(progress).then(function () {}, function () {}); }
  function prefs() { return (S.school && S.school.prefs) || (S.dash && S.dash.prefs) || {}; }
  function savePrefs(p, cb) { DB.setPrefs(p).then(function (r) { if (r.error) { fail(r, "Настройки не сохранились"); return; } S.school.prefs = p; if (S.dash) S.dash.prefs = p; if (cb) cb(); }); }

  /* ---------- правила (64-b § 3) ---------- */
  function active(r) { return !!r; }
  function health(r) {
    var why = [], dl = daysTo(r.next_deadline), pc = docsPct(r), seen = daysAgo(lastSeen(r)), st = daysAgo(r.last_status_at), ns = daysTo(r.next_step_on), g = +r.grade || 0;
    var sleeping = (seen == null || seen >= 60) && !r.apps && g < 11;
    if (sleeping) return { k: "mut", why: [{ k: "mut", t: "давно не заходил, плана нет" }], sleeping: true };
    if (dl != null && dl >= 0 && dl <= 7 && (pc == null || pc < 100)) why.push({ k: "bad", t: "дедлайн через " + dl + " " + plural(dl, "день", "дня", "дней") + ", документы " + (pc == null ? "не заведены" : pc + "%") });
    else if (dl != null && dl > 7 && dl <= 14 && (pc == null || pc < 70)) why.push({ k: "bad", t: "дедлайн ≤ 14 дней, документы " + (pc == null ? "не заведены" : pc + "%") });
    if (ns != null && ns < 0) why.push({ k: "bad", t: "просрочен следующий шаг" });
    if (!r.quiz_done) why.push({ k: "warn", t: "квиз не пройден — шансов нет" });
    else if (!r.apps && g >= 10) why.push({ k: "warn", t: "нет ни одной программы" });
    if (seen == null || seen >= 14) why.push({ k: "warn", t: "не заходил " + (seen == null ? "ни разу" : seen + " дн.") });
    if (dl != null && dl > 14 && dl <= 30 && (pc == null || pc < 50)) why.push({ k: "warn", t: "дедлайн ≤ 30 дней, документы " + (pc == null ? "не заведены" : pc + "%") });
    if (r.parent_phone && (st == null || st >= 21) && g >= 10 && r.apps) why.push({ k: "warn", t: "семья без статуса " + (st == null ? "" : st + " дн.") });
    if (g === 11 && r.apps && !r.next_step) why.push({ k: "warn", t: "нет следующего шага" });
    var k = why.some(function (w) { return w.k === "bad"; }) ? "bad" : why.length ? "warn" : "ok";
    return { k: k, why: why };
  }
  function hdot(r) { var h = health(r); return '<i class="hdot ' + h.k + '" title="' + esc(h.why.map(function (w) { return w.t; }).join(" · ") || "в порядке") + '"></i>'; }
  /* Списки-действия профориентолога (64-b2 § синтез 4) — порядок фиксирован */
  var LISTS = [
    ["noquiz", "Без расчёта", "квиз не пройден — у ученика нет шансов и плана", function (r) { return !r.quiz_done; }],
    ["dl", "Дедлайн ≤ 14 дней, документы не готовы", "самое срочное: подача может сорваться", function (r) { var d = daysTo(r.next_deadline), p = docsPct(r); return d != null && d >= 0 && d <= 14 && (p == null || p < 70); }],
    ["noplan", "Без плана (10–11 класс)", "расчёт есть, программ нет — план не начат", function (r) { return r.quiz_done && !r.apps && (+r.grade || 0) >= 10; }],
    ["nostep", "Без следующего шага (11 класс)", "есть программы, но нет шага с датой", function (r) { return (+r.grade || 0) === 11 && r.apps && !r.next_step; }],
    ["idle", "Не заходили 14+ дней", "ученик выпал — нужен звонок или классный час", function (r) { var s = daysAgo(lastSeen(r)); return r.quiz_done && (s == null || s >= 14) && !health(r).sleeping; }],
    ["family", "Семья без статуса 21+ дней", "родители спросят первыми — опередите", function (r) { var st = daysAgo(r.last_status_at); return r.parent_phone && r.apps && (st == null || st >= 21); }],
    ["docs", "План есть, документов нет", "старт апостиля и переводов — 3–4 недели", function (r) { return r.apps && !r.docs_ready && (+r.grade || 0) >= 11; }],
    ["dl45", "Дедлайн ≤ 45 дней", "проверить пакеты заранее", function (r) { var d = daysTo(r.next_deadline); return d != null && d > 14 && d <= 45; }],
    ["sent", "Подали — ждут ответа", "отметить исход, когда придёт", function (r) { return r.apps_sent > 0 && !r.offers; }],
    ["sleep", "Спящие (9–10 класс)", "60+ дней без активности и без плана — разбудить классным часом", function (r) { return health(r).sleeping; }]
  ];
  var LIST_BY = {}; LISTS.forEach(function (l) { LIST_BY[l[0]] = l; });
  function listRows(key) { var l = LIST_BY[key]; return l ? S.roster.filter(l[3]) : []; }
  function queue() {
    var d = S.dash || {}, out = [];
    (d.tasks || []).forEach(function (x) { var dd = daysTo(x.due_on); if (dd != null && dd < 0) out.push({ p: 1, kind: "task", id: x.id, r: byId(x.user_id), text: x.text, sub: "просрочено · " + fmtD(x.due_on), d: dd }); });
    (d.deadlines || []).forEach(function (a) { var dd = daysTo(a.deadline), r = byId(a.user_id); if (r && dd != null && dd >= 0 && dd <= 7) out.push({ p: 2, kind: "deadline", id: a.user_id + a.program, r: r, text: a.program, sub: (L.cc[a.cc] || a.cc || "") + " · документы " + (docsPct(r) == null ? "—" : docsPct(r) + "%"), d: dd }); });
    (d.tasks || []).forEach(function (x) { var dd = daysTo(x.due_on); if (dd === 0) out.push({ p: 3, kind: "task", id: x.id, r: byId(x.user_id), text: x.text, sub: "сегодня", d: 0 }); });
    (d.meetings || []).forEach(function (m) { var dd = daysTo(m.due_on); if (dd != null && dd >= 0 && dd <= 1) out.push({ p: 4, kind: "meeting", id: m.id, r: byId(m.user_id), text: m.text, sub: (dd === 0 ? "сегодня" : "завтра") + (m.at_time ? " в " + fmtT(m.at_time) : ""), d: dd }); });
    S.roster.forEach(function (r) { var ns = daysTo(r.next_step_on); if (r.next_step && ns != null && ns < 0) out.push({ p: 5, kind: "step", id: r.user_id, r: r, text: r.next_step, sub: "следующий шаг · просрочен " + fmtD(r.next_step_on), d: ns }); });
    (d.tasks || []).forEach(function (x) { var dd = daysTo(x.due_on); if (dd != null && dd > 0 && dd <= 7) out.push({ p: 7, kind: "task", id: x.id, r: byId(x.user_id), text: x.text, sub: "до " + fmtD(x.due_on), d: dd }); });
    out.sort(function (a, b) { return a.p - b.p || a.d - b.d; });
    return out;
  }
  function urgentCount(q) { return (q || queue()).filter(function (x) { return x.p <= 2 || x.p === 5; }).length; }
  function attention() { return S.roster.map(function (r) { return { r: r, h: health(r) }; }).filter(function (x) { return x.h.k === "bad" || x.h.k === "warn"; }).sort(function (a, b) { return (a.h.k === "bad" ? 0 : 1) - (b.h.k === "bad" ? 0 : 1) || b.h.why.length - a.h.why.length; }); }
  function weekProgress() { var w = (S.dash && S.dash.week) || {}; return { touches: w.touches || 0, tasks: w.tasks_done || 0, statuses: w.statuses || 0, joined: w.joined || 0, quiz: w.quiz || 0, docs: w.docs_ready || 0, sent: w.apps_sent || 0, prev: w.prev || {} }; }
  function rhythm() {
    var p = prefs(), goal = Math.max(5, Math.min(40, +p.touch_goal || 10));
    var wp = Path ? Path.weeksProgress((S.dash && S.dash.activity) || [], p.quiet || [], todayD()) : { streak: 0, total: 0, thisWeek: false, quietThisWeek: false };
    return { goal: goal, touches: weekProgress().touches, streak: wp.streak, total: wp.total, thisWeek: wp.thisWeek, quiet: wp.quietThisWeek, off: p.rhythm === false };
  }
  function stats() {
    var R = S.roster, s = { total: R.length, seats: S.school.seats, quiz: 0, plan: 0, docs50: 0, sent: 0, offers: 0, offersN: 0, funded: 0, noQuiz: 0, noPlan11: 0, noPlan10: 0, noStatus: 0, dl30: 0, dl30bad: 0, docsZero: 0, idle: 0, noStep: 0, sentAll: 0, bad: 0, warn: 0, ok: 0, sleeping: 0 };
    R.forEach(function (r) {
      var g = +r.grade || 0, d = daysTo(r.next_deadline), pc = docsPct(r), h = health(r);
      if (r.quiz_done) s.quiz++; else s.noQuiz++;
      if (r.apps) s.plan++; if (pc != null && pc >= 50) s.docs50++; if (r.apps_sent) s.sent++; if (r.offers) { s.offers++; s.offersN += r.offers; }
      s.sentAll += r.apps_sent || 0;
      if (r.quiz_done && !r.apps && g === 11) s.noPlan11++; if (r.quiz_done && !r.apps && g === 10) s.noPlan10++;
      if (d != null && d >= 0 && d <= 30) { s.dl30++; if (pc == null || pc < 70) s.dl30bad++; }
      if (r.apps && !r.docs_ready && g >= 11) s.docsZero++;
      if (h.sleeping) s.sleeping++; else if (h.k === "bad") s.bad++; else if (h.k === "warn") s.warn++; else s.ok++;
    });
    s.noStatus = listRows("family").length; s.idle = listRows("idle").length; s.noStep = listRows("nostep").length;
    (S.dash && S.dash.offers || []).forEach(function (o) { if (o.funding === "full" || o.funding === "partial") s.funded++; });
    return s;
  }
  function seasonHint() {
    var t = todayD(), key = (t.getMonth() + 1) + "-" + (t.getDate() <= 15 ? 1 : 2), h = HINTS[key] || DEFAULT_HINT, wk = Path ? Path.weekInfo(t) : null;
    return { title: h.t, text: h.f(stats()), act: h.act, week: wk };
  }
  function go(act) { var p = String(act || "").split(":"); if (p[0] === "students") location.hash = "#/students" + (p[1] ? "?f=" + p[1] : ""); else if (p[0] === "calendar") location.hash = "#/calendar"; else if (p[0] === "report") location.hash = "#/report"; else location.hash = "#/" + p[0]; }
  function targets() {
    var cc = {}, ff = {};
    S.roster.forEach(function (r) { countries(r).forEach(function (c) { cc[c] = (cc[c] || 0) + 1; }); fields(r).forEach(function (f) { ff[f] = (ff[f] || 0) + 1; }); });
    var top = function (m) { return Object.keys(m).map(function (k) { return [k, m[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8); };
    return { cc: top(cc), ff: top(ff) };
  }
  function classStats(rows) {
    var s = { n: rows.length, quiz: 0, plan: 0, docs50: 0, sent: 0, offers: 0, bad: 0, warn: 0, ok: 0, mut: 0 };
    rows.forEach(function (r) { if (r.quiz_done) s.quiz++; if (r.apps) s.plan++; var p = docsPct(r); if (p != null && p >= 50) s.docs50++; if (r.apps_sent) s.sent++; if (r.offers) s.offers++; s[health(r).k]++; });
    return s;
  }

  /* ---------- маршруты ---------- */
  function route() {
    var h = location.hash.replace(/^#\/?/, ""), parts = h.split("?"), path = parts[0], q = {}; (parts[1] || "").split("&").forEach(function (kv) { if (!kv) return; var p = kv.split("="); q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ""); });
    var seg = path.split("/");
    closeModal(); window.scrollTo(0, 0);
    document.querySelectorAll("#tabs a").forEach(function (a) { a.classList.toggle("on", a.getAttribute("data-t") === (seg[0] === "s" || seg[0] === "classes" && false ? "students" : seg[0] === "report" ? "summary" : seg[0])); });
    if (seg[0] === "s" && seg[1]) { S.cur = seg[1]; S.tab = seg[2] || "overview"; viewStudent(); return; }
    if (seg[0] === "week") return viewWeek();
    if (seg[0] === "calendar") return viewCalendar();
    if (seg[0] === "classes") return viewClasses();
    if (seg[0] === "students") { if (q.f !== undefined) { S.filter = q.f; S.cls = ""; } if (q.c !== undefined) { S.cls = q.c; S.filter = ""; } return viewStudents(); }
    if (seg[0] === "settings") return viewSettings();
    if (seg[0] === "report") return viewReport();
    return viewSummary();
  }
  window.addEventListener("hashchange", function () { if (S.school) route(); });
  function head(title, sub, tools) { return '<div class="head"><div><div class="h1">' + title + '</div><div class="sm mut" id="hsub">' + (sub || "") + "</div></div>" + (tools ? '<div class="tools" style="margin:0">' + tools + "</div>" : "") + "</div>"; }
  function roleSeg() {
    return '<div class="role-seg" id="roleSeg"><button data-m="director"' + (S.mode === "director" ? ' class="on"' : "") + '>Директор</button><button data-m="counselor"' + (S.mode === "counselor" ? ' class="on"' : "") + ">Профориентолог</button></div>";
  }
  function bindRoleSeg() { var el = $("roleSeg"); if (!el) return; el.onclick = function (e) { var b = e.target.closest("[data-m]"); if (!b) return; S.mode = b.getAttribute("data-m"); try { localStorage.setItem("sc_mode", S.mode); } catch (x) {} track("school_mode", { m: S.mode }); location.hash = S.mode === "counselor" ? "#/week" : "#/summary"; }; }

  /* ---------- Сводка (директор) ---------- */
  function viewSummary() {
    var v = $("view");
    v.innerHTML = head("Сводка", "Загружаю…", roleSeg() + '<a class="btn btn-primary btn-sm" href="#/report">Отчёт года</a>') + '<div id="sumBody"><div class="spin"></div></div>';
    bindRoleSeg();
    loadAll().then(function () {
      var s = stats(), st = S.school, t = targets(), cl = classes(), hint = seasonHint(), w = weekProgress();
      $("hsub").textContent = st.name + " · сезон " + seasonLabel() + " · " + fmtDL(todayD());
      track("school_summary_view", { n: s.total });
      var h = "";
      if (!s.total) { h += '<div class="card glow"><div class="h2">Учеников пока нет</div><p class="sm mut" style="margin:4px 0 12px">Сводка появится после первых регистраций. Разошлите ссылку школы в чаты классов — кнопка в «Настройках».</p><a class="btn btn-primary" href="#/settings">Ссылка для учеников</a></div>'; $("sumBody").innerHTML = h; return; }
      var few = s.total < 5, P = function (n) { return few ? n : pct(n, s.total) + "%"; };
      h += '<div class="kpi4"><div class="card"><div class="n">' + s.total + '<span class="mut" style="font-size:14px;font-weight:600"> / ' + st.seats + '</span></div><div class="c">подключено учеников · мест по тарифу</div></div>' +
        '<div class="card"><div class="n">' + P(s.quiz) + '</div><div class="c">с расчётом шансов' + (few ? "" : " · " + s.quiz + " " + plural(s.quiz, "ученик", "ученика", "учеников")) + '</div></div>' +
        '<div class="card"><div class="n">' + P(s.plan) + '</div><div class="c">с планом (есть программы)' + (few ? "" : " · " + s.plan) + '</div></div>' +
        '<div class="card"><div class="n">' + s.sent + '<span class="mut" style="font-size:14px;font-weight:600"> подали</span></div><div class="c">' + s.offersN + " " + plural(s.offersN, "оффер", "оффера", "офферов") + " у " + s.offers + " " + plural(s.offers, "ученика", "учеников", "учеников") + '</div></div></div>';
      h += '<div class="sm mut" style="margin:10px 0 14px">На этой неделе: <b>' + w.joined + "</b> новых учеников · <b>" + w.quiz + "</b> расчётов · <b>" + w.docs + "</b> документов готово · <b>" + w.sent + "</b> подач · <b>" + w.touches + "</b> касаний профориентолога" + (w.prev.joined != null ? ' <span class="xs">(прошлая: ' + w.prev.joined + " новых · " + (w.prev.touches || 0) + " касаний)</span>" : "") + "</div>";
      h += '<div class="cols"><div>';
      h += '<div class="card"><div class="h-row"><div class="h2">Воронка сезона</div><span class="xs mut">кликните по строке — список</span></div><div class="funnel" style="margin-top:10px">' + funnelRows(s) + "</div></div>";
      h += '<div class="card" style="margin-top:14px"><div class="h-row"><div class="h2">Классы</div><a class="xs" href="#/classes">подробнее</a></div><div class="cls" style="margin-top:10px">' + cl.map(classCard).join("") + "</div></div>";
      h += "</div><div>";
      h += '<div class="card glow"><div class="xs" style="color:var(--accent-dark);font-weight:800;letter-spacing:.04em;text-transform:uppercase">' + (hint.week ? "Неделя " + hint.week.n + " сезона · " : "") + esc(hint.title) + '</div><div class="sm" style="margin-top:6px"><b>' + esc(hint.text) + '</b></div><button class="btn btn-soft btn-sm" style="margin-top:10px" data-go="' + esc(hint.act) + '">Посмотреть</button></div>';
      h += '<div class="card" style="margin-top:14px"><div class="h2">Требует внимания школы</div><div class="act-list" style="margin-top:10px">' +
        actRow(s.bad, "bad", "🔴 срочно", "дедлайн близко и документы не готовы, просроченный шаг", "attention") +
        actRow(s.warn, "", "🟡 отстают", "без расчёта, без плана, не заходят, семья без статуса", "warn") +
        actRow(s.noQuiz, "", "без расчёта", "квиз не пройден — с них начинается классный час", "noquiz") + "</div></div>";
      h += '<div class="card" style="margin-top:14px"><div class="h2">Куда целятся</div><div class="xs mut" style="margin:2px 0 8px">Страны</div><div class="tg">' + (t.cc.length ? t.cc.map(function (x) { return "<span>" + esc(x[0]) + "<b>" + x[1] + "</b></span>"; }).join("") : '<span class="mut">пока нет данных</span>') + '</div><div class="xs mut" style="margin:10px 0 8px">Направления</div><div class="tg">' + (t.ff.length ? t.ff.map(function (x) { return "<span>" + esc(x[0]) + "<b>" + x[1] + "</b></span>"; }).join("") : '<span class="mut">пока нет данных</span>') + "</div></div>";
      h += '<div class="card" style="margin-top:14px"><div class="h-row"><div class="h2">Год к году</div><a class="xs" href="#/settings">архив сезона</a></div>' + yoyTable(s) + "</div>";
      h += rhythmHTML();
      h += "</div></div>";
      $("sumBody").innerHTML = h;
      $("sumBody").addEventListener("click", function (e) { var g = e.target.closest("[data-go]"); if (g) go(g.getAttribute("data-go")); var c = e.target.closest("[data-cls]"); if (c) location.hash = "#/students?c=" + encodeURIComponent(c.getAttribute("data-cls")); });
    });
  }
  function funnelRows(s) {
    var steps = [["Зарегистрировались", s.total, ""], ["Прошли расчёт шансов", s.quiz, "noquiz"], ["Есть план (программы)", s.plan, "plan"], ["Документы ≥ 50 %", s.docs50, "docs50"], ["Подали заявку", s.sent, "sent"], ["Получили оффер", s.offers, "offers"]];
    var max = Math.max(1, s.total);
    return steps.map(function (x) { return '<div class="frow"><a href="#/students' + (x[2] ? "?f=" + x[2] : "") + '">' + x[0] + '</a><div><div class="fb" style="width:' + Math.max(2, Math.round(100 * x[1] / max)) + '%"></div></div><div class="fn">' + x[1] + '<span class="xs mut"> · ' + pct(x[1], max) + "%</span></div></div>"; }).join("");
  }
  function classCard(c) {
    var s = classStats(c.rows), bar = function (label, n) { return '<div class="mbar"><span>' + label + "</span><i><b style=\"width:" + pct(n, s.n) + '%"></b></i><em>' + n + "</em></div>"; };
    return '<div class="card" data-cls="' + esc(c.label) + '"><div class="ch"><b>' + esc(c.label) + '</b><span class="xs mut">' + s.n + " " + plural(s.n, "ученик", "ученика", "учеников") + "</span></div>" + bar("расчёт", s.quiz) + bar("план", s.plan) + bar("документы", s.docs50) + bar("подали", s.sent) +
      '<div class="dots">' + c.rows.map(function (r) { return '<i class="hdot ' + health(r).k + '" style="width:9px;height:9px;margin:0" title="' + esc(r.name) + '"></i>'; }).join("") + "</div></div>";
  }
  function actRow(n, cls, title, sub, f) { return '<div class="act"><div class="an ' + cls + '">' + n + '</div><div class="at"><b>' + title + "</b><span>" + sub + '</span></div><a class="btn btn-ghost btn-sm" href="#/students?f=' + f + '">Список</a></div>'; }
  function yoyTable(s) {
    var rows = ((S.dash && S.dash.seasons) || []).map(function (x) { var p = x.snapshot || {}; return [x.season, p.students, p.quiz, p.plan, p.sent, p.offers, p.funded]; });
    rows.push([seasonLabel() + " (идёт)", s.total, s.quiz, s.plan, s.sent, s.offers, s.funded]);
    var h = '<table class="yoy" style="margin-top:8px"><tr><th>Сезон</th><th>Ученики</th><th>Расчёт</th><th>План</th><th>Подали</th><th>С оффером</th><th>Со стипендией</th></tr>' + rows.map(function (r) { return "<tr>" + r.map(function (c, i) { return "<td>" + (c == null ? "—" : esc(c)) + "</td>"; }).join("") + "</tr>"; }).join("") + "</table>";
    if (rows.length === 1) h += '<div class="xs mut" style="margin-top:8px">Первый сезон: сравнение появится после архивации в июне («Настройки → архив сезона»). Ничего выдумывать не будем.</div>';
    return h;
  }
  function rhythmHTML() {
    var r = rhythm(); if (r.off) return "";
    var pc = Math.min(100, Math.round(100 * r.touches / r.goal));
    return '<div class="card" style="margin-top:14px"><div class="h-row"><b class="sm">Ритм профориентолога</b><a class="xs" href="#/settings">настроить</a></div><div class="xs mut" style="margin-top:4px">Касаний на неделе: <b>' + r.touches + "</b> из " + r.goal + '</div><div class="bar" style="margin-top:6px"><i style="width:' + pc + '%"></i></div><div class="xs mut" style="margin-top:6px">' + (r.quiet ? "Неделя на паузе" : r.streak ? "🔥 " + r.streak + " " + plural(r.streak, "неделя", "недели", "недель") + " без просрочек подряд · всего " + r.total : "Первая неделя без просрочек ещё впереди") + "</div></div>";
  }

  /* ---------- Отчёт года (печать) ---------- */
  function viewReport() {
    var v = $("view");
    v.innerHTML = '<div class="tools noprint" style="margin:0 0 14px;justify-content:space-between"><a class="btn btn-ghost btn-sm" href="#/summary">← Сводка</a><div style="display:flex;gap:8px"><button class="btn btn-primary btn-sm" id="rp-print">Печать / PDF</button><button class="btn btn-ghost btn-sm" id="rp-copy">Скопировать текст</button></div></div><div id="rpBody" class="report"><div class="spin"></div></div>';
    loadAll().then(function () {
      var s = stats(), st = S.school, t = targets(), cl = classes(), offers = (S.dash && S.dash.offers) || [], r = rhythm(), wp = weekProgress();
      track("school_report_view");
      var few = s.total < 5, P = function (n) { return few ? String(n) : pct(n, s.total) + "%"; };
      var h = '<div class="xs mut" style="text-transform:uppercase;letter-spacing:.06em;font-weight:800;color:var(--accent-dark)">Scholary · отчёт школы</div><h1>' + esc(st.name) + '</h1><div class="sm mut">' + [st.city, "сезон " + seasonLabel(), "9–11 классы", "на " + fmtDL(todayD())].filter(Boolean).join(" · ") + "</div>";
      h += '<h2>Итоги в цифрах</h2><div class="kpi4"><div class="card"><div class="n">' + s.total + '</div><div class="c">учеников подключено (мест: ' + st.seats + ')</div></div><div class="card"><div class="n">' + P(s.quiz) + '</div><div class="c">прошли расчёт шансов</div></div><div class="card"><div class="n">' + P(s.plan) + '</div><div class="c">имеют план поступления</div></div><div class="card"><div class="n">' + s.sent + '</div><div class="c">подали заявки · офферов ' + s.offersN + "</div></div></div>";
      h += '<h2>Воронка сезона</h2><div class="funnel">' + funnelRows(s).replace(/<a href="[^"]*">/g, "<span>").replace(/<\/a>/g, "</span>") + "</div>";
      h += '<h2>По классам</h2><table><tr><th>Класс</th><th>Учеников</th><th>Расчёт</th><th>План</th><th>Документы ≥ 50 %</th><th>Подали</th><th>Офферы</th></tr>' + cl.map(function (c) { var x = classStats(c.rows); return "<tr><td>" + esc(c.label) + "</td><td>" + x.n + "</td><td>" + x.quiz + "</td><td>" + x.plan + "</td><td>" + x.docs50 + "</td><td>" + x.sent + "</td><td>" + x.offers + "</td></tr>"; }).join("") + "</table>";
      h += '<h2>Куда целятся ученики</h2><p class="pl">' + (t.cc.length ? "Страны: " + t.cc.map(function (x) { return x[0] + " (" + x[1] + ")"; }).join(", ") + ". " : "") + (t.ff.length ? "Направления: " + t.ff.map(function (x) { return x[0] + " (" + x[1] + ")"; }).join(", ") + "." : "") + (!t.cc.length && !t.ff.length ? "Данные появятся после расчётов." : "") + "</p>";
      h += '<h2>Офферы и стипендии</h2>' + (offers.length ? "<table><tr><th>Ученик</th><th>Класс</th><th>Программа</th><th>Страна</th><th>Финансирование</th></tr>" + offers.map(function (o) { return "<tr><td>" + esc(o.name) + "</td><td>" + esc(o.class_label || "") + "</td><td>" + esc(o.program) + "</td><td>" + esc(L.cc[o.cc] || o.cc || "") + "</td><td>" + ({ full: "полное покрытие", partial: "частичное", none: "без стипендии" }[o.funding] || "—") + "</td></tr>"; }).join("") + "</table>" : '<p class="pl mut">Офферов пока нет — ответы вузов приходят с февраля по май.</p>');
      h += '<h2>Работа профориентолога</h2><p class="pl">За сезон: касаний с учениками и семьями на этой неделе — ' + wp.touches + ", статусов семьям — " + wp.statuses + (r.total ? ", недель с планированием — " + r.total : "") + ". Требуют внимания сейчас: " + s.bad + " срочно, " + s.warn + " отстают, без расчёта — " + s.noQuiz + ".</p>";
      h += '<h2>Год к году</h2>' + yoyTable(s);
      h += '<h2>Что дальше</h2><p class="pl">' + nextText(s) + "</p>";
      h += '<div class="xs mut" style="margin-top:22px">Отчёт собран автоматически из кабинета школы Scholary по действиям учеников и записям профориентолога. Цифры не оценивают учеников и не обещают поступление — это состояние работы на дату.</div>';
      $("rpBody").innerHTML = h;
      $("rp-print").onclick = function () { track("school_report_print"); window.print(); };
      $("rp-copy").onclick = function () { copy($("rpBody").innerText, "Текст отчёта скопирован"); };
    });
  }
  function nextText(s) {
    var m = todayD().getMonth() + 1, out = [];
    if (s.noQuiz) out.push(s.noQuiz + " " + plural(s.noQuiz, "ученику", "ученикам", "ученикам") + " пройти расчёт на классном часе");
    if (s.noPlan11) out.push(s.noPlan11 + " одиннадцатиклассникам выбрать первые программы");
    if (s.dl30bad) out.push("проверить пакеты у " + s.dl30bad + " " + plural(s.dl30bad, "ученика", "учеников", "учеников") + " с дедлайном в 30 дней");
    if (m >= 9 && m <= 11) out.push("родительские собрания 11-х классов: бюджет, IELTS, окна января–февраля");
    if (m >= 1 && m <= 3) out.push("пик подач января–февраля: SH, CSC, Türkiye; регистрация на мартовское ЕНТ");
    if (m >= 4 && m <= 6) out.push("собрать исходы подач и архивировать сезон для сравнения год к году");
    return out.length ? out.join("; ") + "." : "План на следующие недели формируется в «Неделе».";
  }

  /* ---------- Неделя (профориентолог) ---------- */
  function queueItemHTML(x) {
    var r = x.r, act = "";
    if (x.kind === "task") act = '<label class="qdone"><input type="checkbox" data-qtask="' + x.id + '" aria-label="Закрыть задачу"></label>';
    else if (x.kind === "deadline") act = '<a class="btn btn-soft btn-sm" href="#/s/' + esc(r.user_id) + '">Открыть</a>';
    else if (x.kind === "meeting") act = (r && r.parent_phone ? '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/' + waNum(r.parent_phone) + '">WhatsApp</a>' : "") + (r ? '<a class="btn btn-soft btn-sm" href="#/s/' + esc(r.user_id) + '">Открыть</a>' : "");
    else act = '<button class="btn btn-soft btn-sm" data-step="' + esc(r.user_id) + '">Шаг</button>';
    return '<div class="q' + (x.p <= 2 || x.p === 5 ? " urgent" : "") + '"><span class="qk ' + x.kind + '">' + ({ task: "☑", deadline: "⏰", meeting: "🗓", step: "→" })[x.kind] + '</span><div class="t"><b>' + esc(x.text) + '</b><span class="xs mut">' + (r ? link(r) + " · " + esc(r.class_label || "") + " · " : "школа · ") + esc(x.sub) + '</span></div><div class="qa">' + act + "</div></div>";
  }
  function viewWeek() {
    var v = $("view");
    v.innerHTML = head("Неделя", "Загружаю…", roleSeg() + '<button class="btn btn-ghost btn-sm" id="btn-quick">Записать</button>') + '<div id="wkBody"><div class="spin"></div></div>';
    bindRoleSeg(); $("btn-quick").onclick = function () { quickNoteModal(); };
    loadAll().then(function () {
      var s = stats(), q = queue(), urg = urgentCount(q), hint = seasonHint(), w = weekProgress(), r = rhythm(), wide = window.innerWidth >= 1100;
      $("hsub").textContent = fmtDL(todayD()) + " · " + s.total + " " + plural(s.total, "ученик", "ученика", "учеников") + (hint.week ? " · неделя " + hint.week.n + " сезона" : "");
      track("school_week_view", { urgent: urg, n: s.total });
      var h = "";
      if (!s.total) { h += '<div class="card glow"><div class="h2">С чего начать</div><p class="sm mut" style="margin:4px 0 12px">Три шага — и неделя начнёт работать на вас.</p><div class="lst"><span class="pill pill-acc">1</span><div class="t"><b>Разошлите ссылку школы</b><span class="xs mut">в чаты классов 9–11 — текст уже готов</span></div><a class="btn btn-primary btn-sm" href="#/settings">Ссылка</a></div><div class="lst"><span class="pill pill-acc">2</span><div class="t"><b>Классный час 10 минут</b><span class="xs mut">ученики регистрируются с телефона и проходят квиз — сразу видят шансы</span></div></div><div class="lst"><span class="pill pill-acc">3</span><div class="t"><b>Раз в неделю — этот экран</b><span class="xs mut">списки «кто отстал» и очередь дел соберутся сами</span></div></div></div>'; $("wkBody").innerHTML = h; return; }
      var lists = LISTS.map(function (l) { return { key: l[0], title: l[1], sub: l[2], rows: listRows(l[0]) }; }).filter(function (l) { return l.rows.length; });
      h += (urg ? '<div class="prio bad"><b>' + urg + " " + plural(urg, "срочное", "срочных", "срочных") + "</b> · " + lists.length + " " + plural(lists.length, "список", "списка", "списков") + " на неделю</div>" : '<div class="prio ok"><b>Срочного нет</b> · ' + lists.length + " " + plural(lists.length, "список", "списка", "списков") + " на неделю</div>");
      h += '<div class="sm mut" style="margin:8px 0 12px">На этой неделе: <b>' + w.joined + "</b> новых · <b>" + w.quiz + "</b> расчётов · <b>" + w.docs + "</b> документов · <b>" + w.sent + "</b> подач · <b>" + w.statuses + "</b> статусов семьям · <b>" + w.touches + "</b> касаний" + (w.prev.touches != null ? ' <span class="xs">(прошлая неделя: ' + w.prev.touches + " касаний)</span>" : "") + "</div>";
      h += '<div class="cols"><div>';
      var qn = q.slice(0, 8), rest = q.length - qn.length;
      h += '<div class="card"><div class="h-row"><div class="h2">Сейчас</div><span class="xs mut">просроченное → дедлайн ≤ 7 → сегодня → встречи → шаги → 7 дней</span></div>' + (q.length ? qn.map(queueItemHTML).join("") + (rest ? '<button class="lnk xs" id="q-more">ещё ' + rest + "</button>" : "") : '<div class="empty">Очередь пуста: нет просроченных задач, близких дедлайнов и встреч. Записывайте задачи со сроком — они появятся здесь.</div>') + "</div>";
      h += '<div class="card" style="margin-top:14px"><div class="h-row"><div class="h2">Кто отстал — списки на неделю</div><a class="xs" href="#/students">все ученики</a></div><div class="act-list" style="margin-top:10px">' + (lists.length ? lists.map(function (l) {
        return '<div class="act"><div class="an' + (l.key === "dl" ? " bad" : "") + '">' + l.rows.length + '</div><div class="at"><b>' + esc(l.title) + "</b><span>" + esc(l.sub) + '</span><div class="names">' + l.rows.slice(0, 5).map(function (r) { return '<a href="#/s/' + esc(r.user_id) + '">' + esc(firstName(r.name) + " " + (r.name.split(" ")[1] || "").slice(0, 1)) + ". · " + esc(r.class_label || "") + "</a>"; }).join("") + (l.rows.length > 5 ? '<a href="#/students?f=' + l.key + '">все ' + l.rows.length + "</a>" : "") + "</div></div></div>";
      }).join("") : '<div class="empty">Все ученики с расчётом, планом и активностью. Так бывает редко — проверьте фильтры в «Учениках».</div>') + "</div></div>";
      var mt = (S.dash.meetings || []).filter(function (m) { var dd = daysTo(m.due_on); return dd != null && dd >= 0 && dd <= 6; });
      h += '<div class="card" style="margin-top:14px"><div class="h-row"><div class="h2">Встречи на неделе</div><button class="lnk xs" id="m-add">+ встреча</button></div>' + (mt.length ? mt.map(function (m) { var r = byId(m.user_id), dd = daysTo(m.due_on); return '<div class="lst"><span class="pill ' + (dd === 0 ? "pill-acc" : "pill-mut") + '">' + (dd === 0 ? "сегодня" : dd === 1 ? "завтра" : fmtD(m.due_on)) + (m.at_time ? " " + fmtT(m.at_time) : "") + '</span><div class="t"><b>' + (r ? link(r) : "Школа") + '</b><span class="xs mut">' + esc(m.text) + "</span></div>" + (r && r.parent_phone ? '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/' + waNum(r.parent_phone) + "?text=" + encodeURIComponent(meetReminder(r, m)) + '">Напомнить</a>' : "") + "</div>"; }).join("") : '<div class="empty">Встреч нет. Родительское собрание или созвон с семьёй, записанные сюда, попадут в календарь и очередь.</div>') + "</div>";
      h += "</div><div>";
      h += '<div class="card glow"><div class="xs" style="color:var(--accent-dark);font-weight:800;letter-spacing:.04em;text-transform:uppercase">' + (hint.week ? "Неделя " + hint.week.n + " сезона · " : "") + esc(hint.title) + '</div><div class="sm" style="margin-top:6px"><b>' + esc(hint.text) + '</b></div><button class="btn btn-soft btn-sm" style="margin-top:10px" data-go="' + esc(hint.act) + '">Посмотреть</button></div>';
      h += '<div class="card" style="margin-top:14px"><div class="h2">Неделя</div><div class="xs mut" style="margin-top:4px">Планирование в понедельник засчитывает неделю в серию «без просрочек».</div><div class="tools"><button class="btn btn-primary btn-sm" id="wk-planned"' + (r.thisWeek ? " disabled" : "") + ">" + (r.thisWeek ? "Неделя спланирована ✓" : "Неделя спланирована") + '</button><button class="btn btn-ghost btn-sm" id="wk-quiet">' + (r.quiet ? "Снять паузу" : "Пауза недели") + "</button></div></div>";
      h += rhythmHTML();
      h += '<div class="card" style="margin-top:14px"><div class="h2">Здоровье параллели</div><div class="tg" style="margin-top:8px"><span>🔴 срочно<b>' + s.bad + "</b></span><span>🟡 отстают<b>" + s.warn + "</b></span><span>🟢 в порядке<b>" + s.ok + "</b></span><span>💤 спят<b>" + s.sleeping + "</b></span></div></div>";
      h += "</div></div>";
      $("wkBody").innerHTML = h;
      var more = $("q-more"); if (more) more.onclick = function () { more.parentNode.insertAdjacentHTML("beforeend", q.slice(8).map(queueItemHTML).join("")); more.remove(); };
      $("m-add").onclick = function () { quickNoteModal(null, "meeting"); };
      $("wk-planned").onclick = function () { $("wk-planned").disabled = true; $("wk-planned").textContent = "Неделя спланирована ✓"; DB.touch(true).then(function () { track("school_week_planned"); toast("Неделя засчитана", "ok"); if (S.dash) { var k = isoToday(), a = S.dash.activity || []; var f = a.filter(function (x) { return x.day === k; })[0]; if (f) f.progress = true; else a.push({ day: k, actions: 1, progress: true }); S.dash.activity = a; } }); };
      $("wk-quiet").onclick = function () { var p = Object.assign({}, prefs()), mon = iso(addDays(todayD(), -((todayD().getDay() + 6) % 7))), qset = (p.quiet || []).slice(); var i = qset.indexOf(mon); if (i >= 0) qset.splice(i, 1); else qset.push(mon); p.quiet = qset; savePrefs(p, function () { toast(i >= 0 ? "Пауза снята" : "Неделя на паузе", "ok"); viewWeek(); }); };
      $("wkBody").addEventListener("change", function (e) {
        var cb = e.target.closest("[data-qtask]"); if (!cb) return;
        DB.notes.update(cb.getAttribute("data-qtask"), { done: true }).then(function (r2) { if (r2.error) { fail(r2); cb.checked = false; return; } toast("Задача закрыта", "ok"); cb.closest(".q").style.opacity = ".4"; track("school_task_done"); touch(false); });
      });
      $("wkBody").addEventListener("click", function (e) {
        var b = e.target.closest("[data-step]"); if (b) { var r2 = byId(b.getAttribute("data-step")); if (r2) nextStepModal(r2); return; }
        var g = e.target.closest("[data-go]"); if (g) go(g.getAttribute("data-go"));
      });
    });
  }
  function meetReminder(r, m) { var who = S.school && S.school.contact_name ? S.school.contact_name : "профориентолог школы"; return "Здравствуйте! Напоминаю о встрече по " + firstName(r.name) + ": " + fmtDL(m.due_on) + (m.at_time ? " в " + fmtT(m.at_time) : "") + ". Тема: " + m.text + ". Если время не подходит — напишите, перенесём. " + who + ", " + (S.school ? S.school.name : ""); }
  function nextStepModal(r, title) {
    var tpl = STEP_TPL[String(r.grade)] || STEP_TPL["11"];
    openModal('<div class="h2">' + esc(title || "Следующий шаг") + '</div><div class="xs mut">' + esc(r.name) + " · " + esc(r.class_label || "") + '</div><form id="f-step"><label class="fl">Что дальше</label><input class="f" name="text" maxlength="140" value="' + esc(r.next_step || "") + '" placeholder="' + esc(tpl[0]) + '"><div class="chips" style="margin:8px 0 0">' + tpl.map(function (x) { return '<button type="button" class="chip" data-tpl="' + esc(x) + '">' + esc(x) + "</button>"; }).join("") + '</div><label class="fl">К какому дню</label><input class="f" name="on" type="date" value="' + esc(r.next_step_on || isoToday(7)) + '"><div class="tools"><button class="btn btn-primary" type="submit">Сохранить</button><button class="btn btn-ghost" type="button" data-close>Позже</button>' + (r.next_step ? '<button class="btn btn-ghost btn-sm" type="button" id="step-clear" style="margin-left:auto">Убрать шаг</button>' : "") + "</div></form>", function (m) {
      var f = m.querySelector("#f-step");
      m.querySelectorAll("[data-tpl]").forEach(function (b) { b.onclick = function () { f.text.value = b.getAttribute("data-tpl"); }; });
      var save = function (text, on) { DB.meta(r.user_id, { next_step: text, next_step_on: on }).then(function (r2) { if (r2.error) { fail(r2, "Шаг не сохранился"); return; } r.next_step = text; r.next_step_on = on; track("school_next_step_set", { grade: r.grade }); touch(false); closeModal(); toast(text ? "Шаг назначен" : "Шаг убран", "ok"); route(); }); };
      f.onsubmit = function (e) { e.preventDefault(); var text = f.text.value.trim(); if (!text) { f.text.focus(); return; } save(text.slice(0, 140), f.on.value || null); };
      var c = m.querySelector("#step-clear"); if (c) c.onclick = function () { save(null, null); };
    });
  }
  function quickNoteModal(r, kind) {
    var opts = S.roster.slice().sort(function (a, b) { return classOrder(a.class_label, b.class_label) || String(a.name).localeCompare(String(b.name), "ru"); });
    openModal('<div class="h2">Записать</div><div class="xs mut">Звонок, договорённость, встреча или задача — за 10 секунд</div><form id="f-quick">' +
      (r ? '<input type="hidden" name="sid" value="' + esc(r.user_id) + '"><div class="sm" style="margin-top:8px"><b>' + esc(r.name) + "</b> · " + esc(r.class_label || "") + "</div>" : '<label class="fl">Ученик</label><select class="f" name="sid"><option value="">Вся школа / класс</option>' + opts.map(function (x) { return '<option value="' + esc(x.user_id) + '">' + esc(x.class_label || "") + " · " + esc(x.name) + "</option>"; }).join("") + "</select>") +
      '<label class="fl">Тип</label><div class="chips" style="margin:0" id="qk">' + NOTE_K.map(function (k) { return '<button type="button" class="chip' + (k[0] === (kind || "call") ? " on" : "") + '" data-k="' + k[0] + '">' + k[1] + "</button>"; }).join("") + '</div><input type="hidden" name="kind" value="' + esc(kind || "call") + '">' +
      '<div id="q-due" ' + ((kind || "call") === "task" || kind === "meeting" ? "" : "hidden") + '><div class="grid2"><div><label class="fl">Дата</label><input class="f" name="due_on" type="date" value="' + isoToday(1) + '"></div><div id="q-time"' + (kind === "meeting" ? "" : " hidden") + '><label class="fl">Время</label><input class="f" name="at_time" type="time" value="18:00"></div></div></div>' +
      '<label class="fl">Текст</label><textarea class="f" name="text" required maxlength="2000" placeholder="Созвон с мамой: договорились об IELTS в октябре, следующий контакт через неделю"></textarea>' +
      '<div class="tools"><button class="btn btn-primary" type="submit">Записать</button><button class="btn btn-ghost" type="button" data-close>Отмена</button></div></form>', function (m) {
      var f = m.querySelector("#f-quick");
      m.querySelector("#qk").onclick = function (e) { var b = e.target.closest("[data-k]"); if (!b) return; m.querySelectorAll("#qk .chip").forEach(function (c) { c.classList.toggle("on", c === b); }); f.kind.value = b.getAttribute("data-k"); m.querySelector("#q-due").hidden = !(f.kind.value === "task" || f.kind.value === "meeting"); m.querySelector("#q-time").hidden = f.kind.value !== "meeting"; };
      f.onsubmit = function (e) {
        e.preventDefault(); var o = formData(f), b = f.querySelector("[type=submit]"); b.disabled = true;
        var row = { user_id: o.sid || null, kind: o.kind, text: o.text, done: o.kind === "task" ? false : null, due_on: (o.kind === "task" || o.kind === "meeting") && o.due_on ? o.due_on : null, at_time: o.kind === "meeting" && o.at_time ? o.at_time : null };
        DB.notes.add(row).then(function (r2) { b.disabled = false; if (r2.error) { fail(r2, "Не записалось"); return; } closeModal(); toast(o.kind === "task" ? "Задача создана" : o.kind === "meeting" ? "Встреча записана" : "Записано", "ok"); track("school_note_add", { kind: o.kind }); touch(false); var st = o.sid && byId(o.sid); if (st && o.kind !== "task") { st.last_touch = new Date().toISOString(); if (!st.next_step && (+st.grade || 0) >= 10) { setTimeout(function () { nextStepModal(st, "Записано — какой следующий шаг?"); }, 300); return; } } route(); });
      };
    });
  }

  /* ---------- Календарь ---------- */
  function viewCalendar() {
    var v = $("view");
    v.innerHTML = head("Календарь", "Дедлайны всех учеников, задачи и встречи школы, окна сезона Казахстана", '<button class="btn btn-ghost btn-sm" id="cal-meet">+ встреча</button>') + '<div id="calBody"><div class="spin"></div></div>';
    $("cal-meet").onclick = function () { quickNoteModal(null, "meeting"); };
    loadAll().then(function () { if (!S.calMonth) S.calMonth = new Date(todayD().getFullYear(), todayD().getMonth(), 1); drawCalendar(); });
  }
  function calMarks() {
    var marks = {}, d = S.dash || {}, put = function (k, item) { if (!k) return; (marks[k] = marks[k] || []).push(item); };
    (d.deadlines || []).forEach(function (a) { var r = byId(a.user_id); if (r) put(a.deadline, { title: a.program, mine: true, kind: "deadline", r: r, sub: L.cc[a.cc] || a.cc || "" }); });
    (d.tasks || []).forEach(function (x) { put(x.due_on, { title: x.text, mine: true, kind: "task", r: byId(x.user_id), id: x.id }); });
    (d.meetings || []).forEach(function (m) { put(m.due_on, { title: (m.at_time ? fmtT(m.at_time) + " · " : "") + m.text, mine: true, kind: "meeting", r: byId(m.user_id) }); });
    S.roster.forEach(function (r) { if (r.next_step && r.next_step_on) put(r.next_step_on, { title: r.next_step, mine: true, kind: "step", r: r }); });
    var y = todayD().getFullYear();
    SEASON.forEach(function (s) { [y - 1, y, y + 1].forEach(function (yy) { put(yy + "-" + s[0], { title: s[1], mine: false, kind: "season" }); }); });
    return marks;
  }
  function drawCalendar() {
    var marks = calMarks(), m = S.calMonth, mk = String(m.getMonth() + 1).padStart(2, "0"), keys = Object.keys(marks).filter(function (k) { return k.slice(0, 7) === m.getFullYear() + "-" + mk; }).sort();
    var cal = Path ? Path.calendarHTML(m, marks, todayD()) : "";
    var list = function (ks) { return ks.map(function (k) { var items = marks[k].filter(function (x) { return x.mine; }), sea = marks[k].filter(function (x) { return !x.mine; }); if (!items.length && !sea.length) return ""; return '<div class="cal-day' + (k === S.calSel ? " cal-sel" : "") + '"><div class="xs mut" style="font-weight:700;margin:10px 0 4px">' + fmtDL(k) + "</div>" + items.map(function (x) { return '<div class="lst"><span class="qk ' + x.kind + '">' + ({ task: "☑", deadline: "⏰", meeting: "🗓", step: "→" })[x.kind] + '</span><div class="t"><b>' + esc(x.title) + '</b><span class="xs mut">' + (x.r ? link(x.r) + " · " + esc(x.r.class_label || "") : "школа") + (x.sub ? " · " + esc(x.sub) : "") + "</span></div></div>"; }).join("") + sea.map(function (x) { return '<div class="lst"><span class="qk season">○</span><div class="t"><b>' + esc(x.title) + '</b><span class="xs mut">окно сезона</span></div></div>'; }).join("") + "</div>"; }).join(""); };
    var affected = keys.reduce(function (n, k) { return n + marks[k].filter(function (x) { return x.mine; }).length; }, 0);
    $("calBody").innerHTML = '<div class="cols cal-cols"><div class="card"><div class="xs mut" style="text-align:right;margin-bottom:6px">● ученики и школа · ○ сезон</div>' + cal + '<div class="xs mut" style="margin-top:8px">Тап по дню — список на этот день.</div></div><div class="card"><div class="h2">' + (S.calSel ? fmtDL(S.calSel) : "В этом месяце · " + affected) + "</div>" + (S.calSel ? (list([S.calSel]) || '<div class="empty">В этот день ничего нет.</div>') + '<button class="lnk xs" data-act="cal-all">весь месяц</button>' : (list(keys) || '<div class="empty">В этом месяце событий нет.</div>')) + "</div></div>";
    $("calBody").onclick = function (e) {
      var b = e.target.closest("[data-act]"); if (!b) return; var act = b.getAttribute("data-act");
      if (act === "cal-prev" || act === "cal-next") { S.calMonth = new Date(m.getFullYear(), m.getMonth() + (act === "cal-next" ? 1 : -1), 1); S.calSel = null; track("school_calendar_open", { m: S.calMonth.getMonth() + 1 }); drawCalendar(); }
      if (act === "cal-day") { var k = b.getAttribute("data-v"); S.calSel = S.calSel === k ? null : k; drawCalendar(); }
      if (act === "cal-all") { S.calSel = null; drawCalendar(); }
    };
  }

  /* ---------- Классы ---------- */
  function viewClasses() {
    var v = $("view");
    v.innerHTML = head("Классы", "Загружаю…") + '<div id="clBody"><div class="spin"></div></div>';
    loadAll().then(function () {
      var cl = classes(); $("hsub").textContent = cl.length + " " + plural(cl.length, "класс", "класса", "классов") + " · " + S.roster.length + " " + plural(S.roster.length, "ученик", "ученика", "учеников");
      var h = '<div class="cls">' + cl.map(classCard).join("") + "</div>";
      h += '<div class="card" style="margin-top:14px"><div class="h2">Лист для родительского чата</div><p class="sm mut" style="margin:4px 0 10px">Короткий статус по классу для чата родителей: сколько подключилось, что происходит, что нужно от семьи. Без имён и без оценок.</p><div class="tools" style="margin:0 0 10px"><select class="f" id="pc-cls" style="max-width:220px">' + cl.map(function (c) { return '<option value="' + esc(c.label) + '">' + esc(c.label) + "</option>"; }).join("") + '</select></div><textarea class="f" id="pc-text" rows="9"></textarea><div class="tools"><a class="btn btn-primary" id="pc-wa" target="_blank" rel="noopener" href="#">В WhatsApp</a><button class="btn btn-ghost" id="pc-copy">Копировать</button></div></div>';
      $("clBody").innerHTML = h;
      $("clBody").addEventListener("click", function (e) { var c = e.target.closest("[data-cls]"); if (c) location.hash = "#/students?c=" + encodeURIComponent(c.getAttribute("data-cls")); });
      var draw = function () { var c = cl.filter(function (x) { return x.label === $("pc-cls").value; })[0] || cl[0]; var t = c ? parentChatText(c) : ""; $("pc-text").value = t; $("pc-wa").href = "https://wa.me/?text=" + encodeURIComponent(t); };
      $("pc-cls").onchange = draw; $("pc-text").oninput = function () { $("pc-wa").href = "https://wa.me/?text=" + encodeURIComponent($("pc-text").value); };
      $("pc-copy").onclick = function () { copy($("pc-text").value, "Скопировано — вставьте в чат класса"); track("school_parent_chat_copy"); };
      $("pc-wa").onclick = function () { track("school_parent_chat_wa"); };
      draw();
    });
  }
  function parentChatText(c) {
    var s = classStats(c.rows), hint = seasonHint(), who = S.school.contact_name || "профориентолог школы", d = (S.dash && S.dash.deadlines || []).filter(function (a) { var dd = daysTo(a.deadline); return dd != null && dd >= 0 && dd <= 45 && c.rows.some(function (r) { return r.user_id === a.user_id; }); });
    var lines = ["Уважаемые родители " + c.label + "!", "Коротко о поступлении за рубеж на " + fmtDn(todayD()) + ":", "",
      "• Подключены к Scholary: " + s.n + " " + plural(s.n, "ученик", "ученика", "учеников") + ", у " + s.quiz + " есть расчёт шансов, у " + s.plan + " — план с программами."];
    if (s.sent) lines.push("• Подали заявки: " + s.sent + (s.offers ? ", офферы уже у " + s.offers : "") + ".");
    if (d.length) lines.push("• Ближайшие дедлайны в классе: " + d.length + " в течение 45 дней — у кого есть подачи, документы нужно закрыть за 2 недели до срока.");
    lines.push("• Сейчас в сезоне: " + hint.title.toLowerCase() + ".");
    lines.push("", "Что нужно от семьи: чтобы ребёнок зашёл в кабинет Scholary (ссылка в чате класса) и прошёл расчёт — это 7 вопросов. Дальше план и документы собираются шаг за шагом.", "", "Вопросы — мне лично. " + who + ".");
    return lines.join("\n");
  }

  /* ---------- Ученики ---------- */
  var FILTERS = [["", "Все"], ["attention", "🔴 Срочно"], ["warn", "🟡 Отстают"], ["noquiz", "Без расчёта"], ["noplan", "Без плана"], ["dl", "Дедлайн ≤ 14"], ["dl45", "Дедлайн ≤ 45"], ["idle", "Не заходили 14+"], ["family", "Семья без статуса"], ["nostep", "Без шага"], ["docs", "Без документов"], ["docs50", "Документы ≥ 50 %"], ["plan", "С планом"], ["sent", "Подали"], ["offers", "Офферы"], ["sleep", "Спящие"]];
  function filtered() {
    var q = S.q.toLowerCase(), rows = S.roster.slice();
    if (S.cls) rows = rows.filter(function (r) { return (r.class_label || "") === S.cls; });
    if (S.filter === "attention") rows = rows.filter(function (r) { return health(r).k === "bad"; });
    else if (S.filter === "warn") rows = rows.filter(function (r) { return health(r).k === "warn"; });
    else if (S.filter === "plan") rows = rows.filter(function (r) { return r.apps > 0; });
    else if (S.filter === "docs50") rows = rows.filter(function (r) { var p = docsPct(r); return p != null && p >= 50; });
    else if (S.filter === "offers") rows = rows.filter(function (r) { return r.offers > 0; });
    else if (S.filter && LIST_BY[S.filter]) rows = rows.filter(LIST_BY[S.filter][3]);
    if (q) rows = rows.filter(function (r) { return (r.name + " " + (r.class_label || "") + " " + direction(r)).toLowerCase().indexOf(q) >= 0; });
    rows.sort(function (a, b) { var ha = health(a).k, hb = health(b).k, o = { bad: 0, warn: 1, ok: 2, mut: 3 }; return classOrder(a.class_label, b.class_label) || o[ha] - o[hb] || String(a.name).localeCompare(String(b.name), "ru"); });
    return rows;
  }
  function viewStudents() {
    var v = $("view");
    v.innerHTML = head("Ученики", '<span id="stSub">Загружаю…</span>', '<button class="btn btn-ghost btn-sm" id="btn-csv">CSV</button><button class="btn btn-ghost btn-sm" id="btn-quick">Записать</button>') +
      '<div class="chips" id="chips"></div><div class="tools" style="margin:0 0 10px"><input class="f" id="q" placeholder="Поиск по имени, классу, направлению" value="' + esc(S.q) + '"></div><div id="list"><div class="spin"></div></div>';
    $("btn-quick").onclick = function () { quickNoteModal(); };
    $("q").addEventListener("input", function () { S.q = $("q").value.trim(); drawList(); });
    $("btn-csv").onclick = exportCsv;
    $("chips").addEventListener("click", function (e) { var b = e.target.closest(".chip"); if (!b) return; if (b.hasAttribute("data-c")) { S.cls = b.getAttribute("data-c"); } else { S.filter = b.getAttribute("data-f"); } track("school_filter", { key: S.filter || S.cls || "all" }); drawChips(); drawList(); });
    $("list").addEventListener("click", function (e) {
      var b = e.target.closest("[data-step]"); if (b) { var r = byId(b.getAttribute("data-step")); if (r) nextStepModal(r); return; }
      if (e.target.closest("a,button,input,label")) return;
      var tr = e.target.closest("[data-id]"); if (tr) location.hash = "#/s/" + tr.getAttribute("data-id");
    });
    loadAll().then(function () { drawChips(); drawList(); });
  }
  function drawChips() {
    var cl = classes();
    var h = FILTERS.map(function (f) { var n = f[0] ? (function () { var save = [S.filter, S.cls, S.q]; S.filter = f[0]; S.q = ""; var n = filtered().length; S.filter = save[0]; S.q = save[2]; return n; })() : S.roster.length; return '<button class="chip' + (S.filter === f[0] ? " on" : "") + '" data-f="' + f[0] + '">' + f[1] + (f[0] ? " · " + n : " · " + n) + "</button>"; }).join("");
    h += '<span class="chip-sep"></span><button class="chip' + (!S.cls ? " on" : "") + '" data-c="">Все классы</button>' + cl.map(function (c) { return '<button class="chip' + (S.cls === c.label ? " on" : "") + '" data-c="' + esc(c.label) + '">' + esc(c.label) + " · " + c.rows.length + "</button>"; }).join("");
    $("chips").innerHTML = h;
  }
  function drawList() {
    var rows = filtered(), n = S.roster.length;
    $("stSub").textContent = n ? n + " " + plural(n, "ученик", "ученика", "учеников") + " · показано " + rows.length + " · мест " + S.school.seats : "Пока пусто — разошлите ссылку школы";
    if (!n) { $("list").innerHTML = '<div class="card empty">Ученики появятся после регистрации по ссылке школы — она в «Настройках».</div>'; return; }
    if (!rows.length) { $("list").innerHTML = '<div class="card empty">Никого не нашли по этому фильтру.</div>'; return; }
    var h = '<div class="card"><table class="r"><tr><th></th><th>Ученик</th><th>Направление</th><th>Шанс</th><th>План · подано</th><th>Документы</th><th>Дедлайн</th><th>Был · семья</th><th>Следующий шаг</th></tr>';
    rows.forEach(function (r) {
      var p = r.p_adm == null ? null : Math.round(Number(r.p_adm) * 100), dl = daysTo(r.next_deadline), pc = docsPct(r), seen = daysAgo(lastSeen(r)), st = daysAgo(r.last_status_at), ns = daysTo(r.next_step_on);
      h += '<tr class="row" data-id="' + esc(r.user_id) + '"><td>' + hdot(r) + '</td><td><div class="name">' + esc(r.name) + '</div><div class="sub">' + esc(r.class_label || "") + (r.pro ? " · Pro" : "") + "</div></td>" +
        "<td>" + esc(direction(r)) + '<div class="sub">' + esc(L.level[r.level] || "") + "</div></td>" +
        "<td>" + (p == null ? '<span class="xs mut">квиз не пройден</span>' : '<div class="pbar"><i><b style="width:' + p + '%"></b></i><span>' + p + "%</span></div>") + "</td>" +
        "<td>" + (r.apps ? r.apps + " " + plural(r.apps, "программа", "программы", "программ") + '<div class="sub">' + (r.apps_sent ? "подано " + r.apps_sent : "не подано") + (r.offers ? ' · <span style="color:var(--ok);font-weight:700">' + r.offers + " " + plural(r.offers, "оффер", "оффера", "офферов") + "</span>" : "") + "</div>" : '<span class="xs mut">нет плана</span>') + "</td>" +
        "<td>" + (r.docs ? (r.docs_ready || 0) + " / " + r.docs + '<div class="sub">' + pc + "%</div>" : '<span class="xs mut">—</span>') + "</td>" +
        "<td>" + (dl == null ? '<span class="xs mut">нет</span>' : '<span class="pill ' + (dl <= 14 ? "pill-warn" : "pill-mut") + '">' + fmtD(r.next_deadline) + " · " + dl + " " + plural(dl, "день", "дня", "дней") + "</span>") + "</td>" +
        "<td>" + (seen == null ? '<span class="xs mut">не заходил</span>' : seen === 0 ? "сегодня" : seen === 1 ? "вчера" : seen + " дн. назад") + '<div class="sub">' + (r.parent_phone ? (st == null ? "семья: без статуса" : "статус " + st + " дн.") : "нет тел. родителя") + "</div></td>" +
        "<td>" + (r.next_step ? '<div class="sm">' + esc(r.next_step) + '</div><div class="sub' + (ns != null && ns < 0 ? '" style="color:var(--bad)' : "") + '">до ' + fmtD(r.next_step_on) + "</div>" : '<button class="btn btn-soft btn-sm" data-step="' + esc(r.user_id) + '">Шаг</button>') + "</td></tr>";
    });
    $("list").innerHTML = h + "</table></div>";
  }
  function exportCsv() {
    var rows = filtered(), cols = ["Ученик", "Класс", "Направление", "Шанс, %", "Программ", "Подано", "Офферы", "Документы готово", "Документов", "Ближайший дедлайн", "Последняя активность", "Следующий шаг", "К дате", "Статус семье"];
    var lines = [cols.join(";")].concat(rows.map(function (r) { return [r.name, r.class_label || "", direction(r), r.p_adm == null ? "" : Math.round(r.p_adm * 100), r.apps || 0, r.apps_sent || 0, r.offers || 0, r.docs_ready || 0, r.docs || 0, r.next_deadline || "", lastSeen(r) ? String(lastSeen(r)).slice(0, 10) : "", r.next_step || "", r.next_step_on || "", r.last_status_at ? String(r.last_status_at).slice(0, 10) : ""].map(function (x) { return '"' + String(x).replace(/"/g, '""') + '"'; }).join(";"); }));
    var blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }), a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "scholary-school-" + isoToday() + ".csv"; a.click(); track("school_csv", { n: rows.length });
  }

  /* ---------- Карточка ученика ---------- */
  function viewStudent() {
    var v = $("view");
    v.innerHTML = '<div class="back"><a href="#/students">← Ученики</a></div><div id="stHead"></div><div class="stabs" id="stabs"></div><div id="stBody"><div class="spin"></div></div>';
    var p = S.roster.length ? Promise.resolve() : loadAll();
    p.then(function () {
      var r = byId(S.cur); if (!r) { $("stBody").innerHTML = '<div class="card empty">Ученик не найден — возможно, вышел из школы.</div>'; return; }
      var pr = r.p_adm == null ? null : Math.round(r.p_adm * 100), h = health(r), ns = daysTo(r.next_step_on);
      $("stHead").innerHTML = '<div class="h-row"><div><div class="h1" style="display:flex;align-items:center;gap:8px">' + hdot(r) + esc(r.name) + (r.pro ? ' <span class="pill pill-ok">Pro</span>' : "") + '</div><div class="sm mut">' + [r.class_label, L.level[r.level], direction(r), pr != null ? "шанс " + pr + "%" : "квиз не пройден"].filter(Boolean).join(" · ") + "</div></div>" +
        '<div class="tools" style="margin:0"><button class="btn btn-ghost btn-sm" id="st-quick">Записать</button>' + (r.parent_phone ? '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/' + waNum(r.parent_phone) + '">WhatsApp семье</a>' : "") + "</div></div>" +
        (h.why.length ? '<div class="xs" style="margin-top:6px;color:var(--' + (h.k === "bad" ? "bad" : h.k === "warn" ? "warn" : "muted") + ')">' + esc(h.why.map(function (w) { return w.t; }).join(" · ")) + "</div>" : "") +
        '<div class="stepbox"><div class="xs" style="font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--accent-dark)">Следующий шаг школы</div>' + (r.next_step ? '<div class="sm" style="margin-top:4px"><b>' + esc(r.next_step) + '</b>' + (r.next_step_on ? ' <span class="' + (ns < 0 ? "bad" : "mut") + '">· до ' + fmtDn(r.next_step_on) + (ns < 0 ? ", просрочен" : "") + "</span>" : "") + '</div><div class="tools" style="margin-top:8px"><button class="btn btn-primary btn-sm" id="step-done">Сделано</button><button class="btn btn-ghost btn-sm" id="step-edit">Изменить</button></div>' : '<div class="sm mut" style="margin-top:4px">Шага нет. Один шаг с датой — и ученик не потеряется до следующей встречи.</div><div class="tools" style="margin-top:8px"><button class="btn btn-primary btn-sm" id="step-edit">Назначить шаг</button></div>') + "</div>" +
        (r.note ? '<div class="note" style="margin-top:10px"><span class="k">Важно</span>' + esc(r.note) + "</div>" : "");
      $("st-quick").onclick = function () { quickNoteModal(r); };
      $("step-edit").onclick = function () { nextStepModal(r); };
      var sd = $("step-done"); if (sd) sd.onclick = function () { DB.notes.add({ user_id: r.user_id, kind: "note", text: "Шаг сделан: " + r.next_step }).then(function () { DB.meta(r.user_id, { next_step: null, next_step_on: null }).then(function () { r.next_step = null; r.next_step_on = null; track("school_step_done"); touch(true); toast("Шаг закрыт", "ok"); nextStepModal(r, "Шаг сделан — какой следующий?"); }); }); };
      var tabs = [["overview", "Обзор"], ["cab", "Кабинет ученика"], ["family", "Семья"], ["info", "Инфо"]];
      $("stabs").innerHTML = tabs.map(function (t) { return '<a href="#/s/' + esc(r.user_id) + "/" + t[0] + '"' + (S.tab === t[0] ? ' class="on"' : "") + ">" + t[1] + "</a>"; }).join("");
      ({ overview: tabOverview, cab: tabCab, family: tabFamily, info: tabInfo }[S.tab] || tabOverview)(r);
    });
  }
  function tabOverview(r) {
    var body = $("stBody");
    DB.notes.list(r.user_id).then(function (res) {
      var notes = res.data || [], open = notes.filter(function (n) { return n.kind === "task" && !n.done; });
      var h = '<div class="cols"><div><div class="card"><div class="h-row"><div class="h2">Записи школы</div><span class="xs mut">' + notes.length + "</span></div>" +
        '<div class="tools" style="margin:8px 0 12px">' + NOTE_K.map(function (k) { return '<button class="btn btn-ghost btn-sm" data-q="' + k[0] + '">' + NOTE_IC[k[0]] + " " + k[1] + "</button>"; }).join("") + "</div>" +
        (notes.length ? '<div class="tl">' + notes.map(function (n) { return '<div class="tli"><span class="ic">' + NOTE_IC[n.kind] + '</span><div class="t"><div class="xs mut">' + fmtDT(n.created_at) + " · " + NOTE_L[n.kind] + (n.due_on ? " · до " + fmtD(n.due_on) + (n.at_time ? " " + fmtT(n.at_time) : "") : "") + '</div><div class="sm' + (n.done ? '" style="text-decoration:line-through;color:var(--muted)' : "") + '">' + esc(n.text) + "</div></div>" + (n.kind === "task" ? '<label class="qdone"><input type="checkbox" data-done="' + n.id + '"' + (n.done ? " checked" : "") + "></label>" : "") + '<button class="lnk xs" data-del="' + n.id + '" title="Удалить">×</button></div>'; }).join("") + "</div>" : '<div class="empty">Записей ещё нет. Звонок, договорённость с родителями или задача — кнопки выше.</div>') + "</div></div>" +
        '<div><div class="card"><div class="h2">Что делает ученик</div><div class="kv" style="margin-top:8px"><b>Шанс</b><span>' + (r.p_adm == null ? "квиз не пройден" : Math.round(r.p_adm * 100) + "%") + "</span><b>Программы</b><span>" + (r.apps || 0) + " · подано " + (r.apps_sent || 0) + (r.offers ? " · офферов " + r.offers : "") + "</span><b>Документы</b><span>" + (r.docs ? (r.docs_ready || 0) + " из " + r.docs + " готово" : "не заведены") + "</span><b>Ближайший дедлайн</b><span>" + (r.next_deadline ? fmtDL(r.next_deadline) + " (через " + daysTo(r.next_deadline) + " дн.)" : "нет") + "</span><b>Последний вход</b><span>" + (lastSeen(r) ? fmtDL(lastSeen(r)) : "не заходил") + '</span></div><a class="xs" href="#/s/' + esc(r.user_id) + '/cab" style="display:inline-block;margin-top:8px">подробнее →</a></div>' +
        '<div class="card" style="margin-top:14px"><div class="h2">Открытые задачи · ' + open.length + "</div>" + (open.length ? open.map(function (n) { return '<div class="lst"><span class="pill ' + (daysTo(n.due_on) != null && daysTo(n.due_on) < 0 ? "pill-warn" : "pill-mut") + '">' + (n.due_on ? fmtD(n.due_on) : "без срока") + '</span><div class="t"><b>' + esc(n.text) + "</b></div></div>"; }).join("") : '<div class="empty">Нет открытых задач.</div>') + "</div></div></div>";
      body.innerHTML = h;
      body.querySelectorAll("[data-q]").forEach(function (b) { b.onclick = function () { quickNoteModal(r, b.getAttribute("data-q")); }; });
      body.onchange = function (e) { var cb = e.target.closest("[data-done]"); if (!cb) return; DB.notes.update(cb.getAttribute("data-done"), { done: cb.checked }).then(function (r2) { if (r2.error) { fail(r2); return; } track("school_task_done"); touch(false); tabOverview(r); }); };
      body.onclick = function (e) { var d = e.target.closest("[data-del]"); if (!d) return; if (!confirm("Удалить запись?")) return; DB.notes.remove(d.getAttribute("data-del")).then(function () { tabOverview(r); }); };
    });
  }
  function tabCab(r) {
    var pc = docsPct(r), seen = daysAgo(lastSeen(r));
    $("stBody").innerHTML = '<div class="card"><div class="h2">Кабинет ученика в Scholary Pro</div><p class="sm mut" style="margin:4px 0 12px">Школа видит только сводку: шансы, число программ и документов, активность. Файлы, письма и ответы анкеты остаются у ученика.</p>' +
      '<div class="kpis"><div class="card kpi"><div class="n">' + (r.p_adm == null ? "—" : Math.round(r.p_adm * 100) + "%") + '</div><div class="c">вероятность поступления</div></div><div class="card kpi"><div class="n">' + (r.apps || 0) + '</div><div class="c">программ в портфеле · подано ' + (r.apps_sent || 0) + '</div></div><div class="card kpi"><div class="n">' + (pc == null ? "—" : pc + "%") + '</div><div class="c">документов готово (' + (r.docs_ready || 0) + " из " + (r.docs || 0) + ')</div></div><div class="card kpi"><div class="n">' + (seen == null ? "—" : seen === 0 ? "сегодня" : seen + " дн.") + '</div><div class="c">последний вход</div></div></div>' +
      '<div class="sm" style="margin-top:14px">' + (!r.quiz_done ? "Квиз не пройден — у ученика нет расчёта и плана. Самый быстрый шаг: пройти 7 вопросов на классном часе." : !r.apps ? "Расчёт есть, программ нет — план не начат. Подсказка: «выбрать 3 страны под профиль»." : pc != null && pc < 50 && r.next_deadline ? "Документы отстают от дедлайна: апостиль и переводы занимают 3–4 недели." : "Ученик движется: план есть, документы собираются.") + "</div>" +
      '<div class="tools"><button class="btn btn-soft btn-sm" id="cab-nudge">Текст-напоминание ученику</button></div></div>';
    $("cab-nudge").onclick = function () { var t = firstName(r.name) + ", привет! Это " + (S.school.contact_name || "профориентолог") + ". " + (!r.quiz_done ? "Зайди в Scholary по ссылке школы и пройди расчёт — 7 вопросов, 2 минуты." : !r.apps ? "Открой «Вузы» в кабинете и добавь 3 программы в портфель — обсудим на неделе." : "Загляни в «Документы»: у тебя ближайший дедлайн " + fmtDn(r.next_deadline) + ", готово " + (pc || 0) + "%.") + " Если что-то непонятно — напиши мне."; copy(t, "Текст скопирован — отправьте ученику"); };
  }
  function statusText(r, notes) {
    var who = S.school.contact_name || "профориентолог", par = r.parent_name ? (r.parent_name === "Мама" || r.parent_name === "Папа" ? "" : r.parent_name) : "", fn = firstName(r.name), since = isoToday(-14), pc = docsPct(r);
    var done = (notes || []).filter(function (n) { return n.kind === "task" && n.done && (n.done_at || n.created_at) >= since; }).map(function (n) { return n.text; }).slice(0, 3);
    var lines = ["Здравствуйте" + (par ? ", " + par : "") + "! Коротко, где мы с " + fn + " на " + fmtDn(todayD()) + ".", ""];
    lines.push("Сейчас: " + (!r.quiz_done ? "нужно пройти расчёт шансов в кабинете (7 вопросов)." : !r.apps ? "шансы посчитаны" + (r.p_adm != null ? " (" + Math.round(r.p_adm * 100) + "%)" : "") + ", выбираем первые программы." : "в плане " + r.apps + " " + plural(r.apps, "программа", "программы", "программ") + (r.apps_sent ? ", подано " + r.apps_sent : "") + (r.offers ? ", офферов " + r.offers : "") + "."));
    if (done.length) lines.push("За последние две недели: " + done.join("; ") + ".");
    if (r.docs) lines.push("Документы: готово " + (r.docs_ready || 0) + " из " + r.docs + ".");
    if (r.next_deadline) lines.push("Ближайший дедлайн: " + fmtDn(r.next_deadline) + " (через " + daysTo(r.next_deadline) + " " + plural(daysTo(r.next_deadline), "день", "дня", "дней") + ").");
    if (r.next_step) lines.push("Следующий шаг: " + r.next_step + (r.next_step_on ? " — до " + fmtDn(r.next_step_on) : "") + ".");
    lines.push("", "Если есть вопросы — пишите, отвечу в течение дня.", who + ", " + S.school.name);
    return lines.join("\n");
  }
  function tabFamily(r) {
    var body = $("stBody");
    DB.notes.list(r.user_id).then(function (res) {
      var notes = res.data || [], hist = notes.filter(function (n) { return n.kind === "status"; }), st = daysAgo(r.last_status_at), text = statusText(r, notes);
      body.innerHTML = '<div class="cols"><div><div class="card glow"><div class="h2">Статус для семьи</div><p class="sm mut" style="margin:4px 0 10px">Собран из кабинета ученика и записей школы: где сейчас, что сделано, дедлайн, следующий шаг. Отправьте — и вопрос «а что у нас?» отпадает.</p>' +
        '<textarea class="f" id="st-text" rows="10">' + esc(text) + '</textarea>' +
        '<div class="tools">' + (r.parent_phone ? '<a class="btn btn-primary" id="st-wa" target="_blank" rel="noopener" href="https://wa.me/' + waNum(r.parent_phone) + "?text=" + encodeURIComponent(text) + '">В WhatsApp родителю</a>' : '<button class="btn btn-primary" id="st-wa-none">В WhatsApp родителю</button>') + '<button class="btn btn-ghost" id="st-copy">Копировать</button><button class="btn btn-soft" id="st-mark">Отметить отправленным</button></div>' +
        '<div class="xs mut" style="margin-top:8px">' + (st == null ? "Семья ещё не получала статус." : "Последний статус — " + fmtDL(r.last_status_at) + " (" + st + " " + plural(st, "день", "дня", "дней") + " назад).") + " Хорошая частота — раз в 2–3 недели и перед каждым дедлайном.</div></div></div>" +
        '<div><div class="card"><div class="h-row"><div class="h2">Контакты семьи</div><button class="btn btn-ghost btn-sm" id="fam-edit">Изменить</button></div><div class="kv" style="margin-top:8px"><b>Родитель</b><span>' + esc(r.parent_name || "—") + "</span><b>Телефон</b><span>" + (r.parent_phone ? '<a href="tel:' + esc(r.parent_phone) + '">' + esc(r.parent_phone) + "</a>" : "не указан") + "</span></div></div>" +
        '<div class="card" style="margin-top:14px"><div class="h2">Отправленные статусы · ' + hist.length + "</div>" + (hist.length ? hist.slice(0, 10).map(function (n) { return '<div class="note"><span class="k">' + fmtDT(n.created_at) + '</span><div style="white-space:pre-wrap;font-size:13px">' + esc(n.text.length > 220 ? n.text.slice(0, 220) + "…" : n.text) + "</div></div>"; }).join("") : '<div class="empty">Пока ни одного.</div>') + "</div></div></div>";
      var ta = $("st-text"), wa = $("st-wa");
      ta.oninput = function () { if (wa) wa.href = "https://wa.me/" + waNum(r.parent_phone) + "?text=" + encodeURIComponent(ta.value); };
      if (wa) wa.onclick = function () { track("school_status_sent", { via: "wa" }); };
      var none = $("st-wa-none"); if (none) none.onclick = function () { toast("Нет телефона родителя — добавьте в «Контакты семьи»", "bad"); };
      $("st-copy").onclick = function () { copy(ta.value, "Статус скопирован"); };
      $("st-mark").onclick = function () { DB.notes.add({ user_id: r.user_id, kind: "status", text: ta.value }).then(function (r2) { if (r2.error) { fail(r2); return; } r.last_status_at = new Date().toISOString(); track("school_status_sent", { via: "mark" }); touch(true); toast("Статус записан", "ok"); tabFamily(r); }); };
      $("fam-edit").onclick = function () { openModal('<div class="h2">Контакты семьи</div><form id="f-fam"><label class="fl">Родитель</label><input class="f" name="parent_name" value="' + esc(r.parent_name || "") + '" placeholder="Мама, Гульнара"><label class="fl">Телефон родителя</label><input class="f" name="parent_phone" inputmode="tel" value="' + esc(r.parent_phone || "") + '" placeholder="+7 701 000 00 00"><div class="tools"><button class="btn btn-primary" type="submit">Сохранить</button><button class="btn btn-ghost" type="button" data-close>Отмена</button></div></form>', function (m) { m.querySelector("#f-fam").onsubmit = function (e) { e.preventDefault(); var o = formData(m.querySelector("#f-fam")); DB.meta(r.user_id, { parent_name: o.parent_name || null, parent_phone: o.parent_phone || null }).then(function (r2) { if (r2.error) { fail(r2); return; } r.parent_name = o.parent_name || null; r.parent_phone = o.parent_phone || null; closeModal(); tabFamily(r); }); }; }); };
    });
  }
  function tabInfo(r) {
    $("stBody").innerHTML = '<div class="card"><div class="h-row"><div class="h2">Инфо</div><button class="btn btn-ghost btn-sm" id="info-edit">Заметка</button></div><div class="kv" style="margin-top:8px"><b>Класс</b><span>' + esc(r.class_label || "—") + "</span><b>Уровень</b><span>" + esc(L.level[r.level] || "—") + "</span><b>Страны</b><span>" + esc(countries(r).join(", ") || "—") + "</span><b>Направления</b><span>" + esc(fields(r).join(", ") || "—") + "</span><b>В школе с</b><span>" + fmtDL(r.joined_at) + "</span><b>Заметка</b><span>" + esc(r.note || "—") + "</span></div>" +
      '<div class="tools" style="margin-top:14px"><button class="btn btn-danger btn-sm" id="st-del">Убрать из школы</button></div><div class="xs mut" style="margin-top:6px">Место освободится, Pro у ученика останется до конца срока.</div></div>';
    $("info-edit").onclick = function () { openModal('<div class="h2">Заметка о ученике</div><form id="f-note"><textarea class="f" name="note" maxlength="1000" rows="4">' + esc(r.note || "") + '</textarea><div class="tools"><button class="btn btn-primary" type="submit">Сохранить</button><button class="btn btn-ghost" type="button" data-close>Отмена</button></div></form>', function (m) { m.querySelector("#f-note").onsubmit = function (e) { e.preventDefault(); var t = m.querySelector("[name=note]").value.trim(); DB.meta(r.user_id, { note: t || null }).then(function () { r.note = t || null; closeModal(); viewStudent(); }); }; }); };
    $("st-del").onclick = function () { if (!confirm("Убрать " + r.name + " из школы?")) return; DB.remove(r.user_id).then(function (r2) { if (r2.error || (r2.data && r2.data.ok === false)) { fail(r2); return; } S.roster = S.roster.filter(function (x) { return x.user_id !== r.user_id; }); track("school_member_remove"); toast("Убрали из школы", "ok"); location.hash = "#/students"; }); };
  }

  /* ---------- Настройки ---------- */
  function inviteLink() { return location.origin + "/schools/join/?code=" + (S.school.invite_code || ""); }
  function waText() { var s = S.school, link = inviteLink(); return "Ребята, у нашей школы есть доступ к Scholary — сервис считает реальную вероятность поступить за рубеж со стипендией (236 программ в 56 странах) и ведёт по документам до подачи.\n\nРегистрируйтесь по ссылке школы — доступ Scholary Pro для вас бесплатный" + (s.ends_on ? " до " + fmtDL(s.ends_on) : "") + ":\n" + link + "\n\nЗаймёт 2 минуты: создать аккаунт, указать класс, ответить на 7 вопросов — и вы увидите свои шансы. Вопросы — ко мне."; }
  function viewSettings() {
    var s = S.school, free = Math.max(0, s.seats - s.used), text = waText(), canStaff = s.role === "owner" || s.role === "director";
    var draw = function () {
      var p = prefs(), r = rhythm(), staff = s.staff || [];
      $("view").innerHTML = head("Настройки", esc(s.name) + (s.city ? " · " + esc(s.city) : "") + " · вы: " + ({ owner: "владелец", director: "директор", counselor: "профориентолог" }[s.role] || "—")) + '<div class="cols">' +
        '<div><div class="card glow"><div class="h2">Ссылка для учеников</div><p class="sm mut" style="margin:4px 0 10px">Ученик регистрируется по ней, указывает класс и получает Scholary Pro за счёт школы. Место занимает только тот, кто зарегистрировался.</p>' +
        '<div class="link-row"><input class="f" readonly id="inv" value="' + esc(inviteLink()) + '"><button class="btn btn-ghost" id="inv-copy">Копировать</button></div><div class="xs mut" style="margin-top:6px">Код: <span class="code" style="font-size:16px">' + esc(s.invite_code || "—") + "</span></div>" +
        '<div class="tools"><a class="btn btn-primary" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(text) + '">Отправить в WhatsApp</a><button class="btn btn-ghost" id="inv-txt">Текст для чата класса</button><button class="btn btn-ghost btn-sm" id="regen">Новая ссылка</button></div>' +
        '<div id="regenBox" class="note" hidden style="margin-top:10px"><b>Старая ссылка перестанет работать.</b> Уже зарегистрированные ученики останутся.<div class="tools"><button class="btn btn-danger btn-sm" id="regen-yes">Выпустить новую</button><button class="btn btn-ghost btn-sm" id="regen-no">Отмена</button></div></div></div>' +
        '<div class="card" style="margin-top:14px"><div class="h2">Сотрудники школы</div><p class="sm mut" style="margin:4px 0 10px">Директор видит сводку и отчёт, профориентолог ведёт учеников. Все — без доплаты. Ссылка-приглашение открывается под аккаунтом сотрудника.</p>' +
        (staff.length ? staff.map(function (x) { return '<div class="lst"><span class="pill ' + (x.role === "director" ? "pill-acc" : "pill-mut") + '">' + (x.role === "director" ? "директор" : "профориентолог") + '</span><div class="t"><b>' + esc(x.name || x.email || "без имени") + '</b><span class="xs mut">' + (x.claimed ? "вошёл" : "ещё не открыл приглашение") + (x.email ? " · " + esc(x.email) : "") + "</span></div>" + (canStaff ? (!x.claimed && x.token ? '<button class="btn btn-ghost btn-sm" data-copyinv="' + esc(x.token) + '">Ссылка</button>' : "") + '<button class="btn btn-ghost btn-sm" data-rmstaff="' + x.id + '">Убрать</button>' : "") + "</div>"; }).join("") : '<div class="empty">Пока только вы.</div>') +
        (canStaff ? '<form id="f-staff" class="tools" style="margin-top:10px;align-items:flex-end"><div style="flex:1 1 140px"><label class="fl">Имя</label><input class="f" name="name" placeholder="Айгуль Сериковна"></div><div style="flex:1 1 160px"><label class="fl">Email (необязательно)</label><input class="f" name="email" type="email" placeholder="aigul@school.kz"></div><div><label class="fl">Роль</label><select class="f" name="role"><option value="counselor">Профориентолог</option><option value="director">Директор / завуч</option></select></div><button class="btn btn-primary" type="submit">Пригласить</button></form><div class="xs mut" id="staff-hint" style="margin-top:6px"></div>' : "") + "</div>" +
        '<div class="card" style="margin-top:14px"><div class="h2">Ритм профориентолога</div><p class="sm mut" style="margin:4px 0 10px">Только для сотрудников школы. Касание — звонок, заметка, встреча или статус семье.</p>' +
        '<div class="lst"><div class="t"><b>Цель касаний в неделю</b><span class="xs mut">сейчас ' + r.goal + " · на этой неделе " + r.touches + '</span></div><select class="stage-sel" id="goal">' + [5, 8, 10, 15, 20, 30, 40].map(function (n) { return '<option value="' + n + '"' + (n === r.goal ? " selected" : "") + ">" + n + "</option>"; }).join("") + "</select></div>" +
        '<div class="lst"><div class="t"><b>Недели без просрочек</b><span class="xs mut">' + (r.streak ? r.streak + " подряд · всего " + r.total : "всего " + r.total) + " · пропуск раз в месяц серию не рвёт</span></div></div>" +
        '<div class="lst"><div class="t"><b>Эта неделя</b><span class="xs mut">' + (r.quiet ? "на паузе (каникулы)" : "в работе") + '</span></div><button class="btn btn-ghost btn-sm" id="quiet">' + (r.quiet ? "Снять паузу" : "Пауза") + "</button></div>" +
        '<div class="lst"><div class="t"><b>Ритм и серии</b><span class="xs mut">выключите, если не хотите видеть счётчики</span></div><button class="btn btn-ghost btn-sm" id="rhythm">' + (p.rhythm === false ? "Выкл" : "Вкл") + "</button></div></div></div>" +
        '<div><div class="card"><div class="h2">Тариф и места</div><div class="kv" style="margin-top:8px"><b>План</b><span>' + esc(s.plan_label) + "</span><b>Статус</b><span>" + (s.open ? '<span class="pill pill-ok">доступ открыт</span>' : '<span class="pill pill-warn">' + esc(s.status) + "</span>") + "</span><b>Период</b><span>" + fmtDL(s.starts_on) + " — " + fmtDL(s.ends_on) + "</span><b>Контакт</b><span>" + esc(s.contact_name || "") + "<br>" + esc(s.contact_email || "") + '</span></div><div class="sm" style="margin-top:12px"><b>' + s.used + " из " + s.seats + '</b> мест занято · свободно ' + free + '</div><div class="bar" style="margin-top:6px"><i style="width:' + Math.min(100, pct(s.used, s.seats)) + '%"></i></div><div class="xs mut" style="margin-top:8px">Нужно больше мест — напишите нам, расширим в тот же день. Доплата пропорционально остатку срока.</div><div class="tools"><a class="btn btn-ghost btn-sm" href="/schools/#tariffs">Тарифы</a><a class="btn btn-ghost btn-sm" href="mailto:hello@scholary.kz?subject=' + encodeURIComponent("Школа " + s.name + ": места") + '">Написать нам</a></div></div>' +
        '<div class="card" style="margin-top:14px"><div class="h2">Архив сезона</div><p class="sm mut" style="margin:4px 0 10px">В июне сохраните итоги сезона — в следующем году в сводке появится сравнение «год к году». Снимок хранит только цифры, без имён.</p>' + (((S.dash && S.dash.seasons) || []).map(function (x) { return '<div class="lst"><span class="pill pill-mut">' + esc(x.season) + '</span><div class="t"><b>' + (x.snapshot.students || 0) + " учеников · " + (x.snapshot.sent || 0) + " подали · " + (x.snapshot.offers || 0) + ' офферов</b><span class="xs mut">архив от ' + fmtDL(x.archived_at) + "</span></div></div>"; }).join("")) + (canStaff ? '<div class="tools"><button class="btn btn-soft btn-sm" id="arch-now">Сохранить сезон ' + seasonLabel() + "</button></div>" : "") + "</div>" +
        '<div class="card" style="margin-top:14px"><div class="h2">Аккаунт</div><div class="xs mut">' + esc((S.session && S.session.user.email) || "") + '</div><div class="tools"><button class="btn btn-ghost btn-sm" id="refresh">Обновить данные</button><button class="btn btn-ghost btn-sm" id="out3">Выйти</button></div></div></div></div>';
      $("inv-copy").onclick = function () { copy(inviteLink(), "Ссылка скопирована"); track("school_link_copy"); };
      $("inv-txt").onclick = function () { copy(text, "Текст для чата скопирован"); };
      $("regen").onclick = function () { $("regenBox").hidden = false; }; $("regen-no").onclick = function () { $("regenBox").hidden = true; };
      $("regen-yes").onclick = function () { DB.regen().then(function (r2) { var j = r2.data; if (!j || !j.ok) { fail(r2, "Не удалось выпустить ссылку"); return; } s.invite_code = j.invite_code; track("school_link_regen"); toast("Новая ссылка выпущена", "ok"); text = waText(); draw(); }); };
      $("goal").onchange = function () { var np = Object.assign({}, prefs(), { touch_goal: +$("goal").value }); savePrefs(np, function () { toast("Цель: " + np.touch_goal + " касаний в неделю", "ok"); draw(); }); };
      $("quiet").onclick = function () { var np = Object.assign({}, prefs()), mon = iso(addDays(todayD(), -((todayD().getDay() + 6) % 7))), qset = (np.quiet || []).slice(), i = qset.indexOf(mon); if (i >= 0) qset.splice(i, 1); else qset.push(mon); np.quiet = qset; savePrefs(np, draw); };
      $("rhythm").onclick = function () { var np = Object.assign({}, prefs(), { rhythm: prefs().rhythm === false }); savePrefs(np, draw); };
      $("refresh").onclick = function () { DB.mine().then(function (r2) { if (r2.data) { S.school = r2.data; s = S.school; } loadAll().then(draw); }); };
      $("out3").onclick = out;
      var fs = $("f-staff"); if (fs) fs.onsubmit = function (e) { e.preventDefault(); var o = formData(fs); DB.invite(o.role, o.name, o.email).then(function (r2) { var j = r2.data; if (r2.error || !j || !j.ok) { fail(r2, j && j.why === "limit" ? "Не больше 20 сотрудников" : "Не удалось пригласить"); return; } track("school_staff_invite", { role: o.role }); DB.mine().then(function (r3) { if (r3.data) { S.school = r3.data; s = S.school; } draw(); var lnk = location.origin + "/schools/cabinet/?staff=" + j.token; copy(lnk, "Ссылка-приглашение скопирована — отправьте сотруднику"); $("staff-hint").textContent = "Приглашение: " + lnk; }); }); };
      $("view").querySelectorAll("[data-copyinv]").forEach(function (b) { b.onclick = function () { copy(location.origin + "/schools/cabinet/?staff=" + b.getAttribute("data-copyinv"), "Ссылка-приглашение скопирована"); }; });
      $("view").querySelectorAll("[data-rmstaff]").forEach(function (b) { b.onclick = function () { if (!confirm("Убрать сотрудника из кабинета?")) return; DB.staffRemove(+b.getAttribute("data-rmstaff")).then(function () { DB.mine().then(function (r3) { if (r3.data) { S.school = r3.data; s = S.school; } draw(); }); }); }; });
      var an = $("arch-now"); if (an) an.onclick = function () { var st = stats(), t = targets(), snap = { students: st.total, quiz: st.quiz, plan: st.plan, docs: st.docs50, sent: st.sent, offers: st.offers, funded: st.funded, countries: t.cc.slice(0, 5).map(function (x) { return x[0]; }) }; DB.archive(seasonLabel(), snap).then(function (r2) { var j = r2.data; if (r2.error || !j || !j.ok) { fail(r2, "Не удалось сохранить сезон"); return; } track("school_season_archive"); toast("Сезон " + seasonLabel() + " сохранён", "ok"); loadAll().then(draw); }); };
    };
    if (!S.dash) loadAll().then(draw); else draw();
  }

  /* ---------- старт ---------- */
  sb.auth.getSession().then(function (r) { S.session = r.data.session; if (S.session) enter(); else show("v-auth"); });
  sb.auth.onAuthStateChange(function (ev, session) { S.session = session; if (session) { if (!S.school) enter(); } else if (ev === "SIGNED_OUT") { S.school = null; show("v-auth"); } });
}
(function () {
  if (/[?&]demo=1/.test(location.search) || (window.supabase && window.supabase.createClient)) { __schoolCabinetMain(); return; }
  var n = 0, t = setInterval(function () { if (window.supabase && window.supabase.createClient) { clearInterval(t); __schoolCabinetMain(); } else if (++n > 40) { clearInterval(t); document.getElementById("loading").innerHTML = '<div class="card" style="max-width:420px;margin:60px auto;text-align:center"><b>Не удалось загрузить библиотеку входа</b><div class="sm mut" style="margin-top:6px">Проверьте соединение и обновите страницу.</div></div>'; } }, 100);
})();
