/* Scholary · кабинет школы (профориентолога), /schools/cabinet/.
   Вход тем же Supabase Auth, что и у учеников. Привязка школы к аккаунту —
   по токену из письма (?claim=…). Данные — только через RPC school_mine /
   school_roster / school_regen_code / school_remove_member: таблицы школ
   закрыты RLS целиком. */
function __schoolCabinetMain() {
  "use strict";
  var C = window.SCHOLARY_CONFIG || {};
  var sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
  var $ = function (id) { return document.getElementById(id); };
  var track = window.track || function () {};
  var S = { session: null, school: null, roster: [], q: "", cls: "", risk: false, entering: false };

  function esc(s) { return String(s == null ? "" : s).replace(/[<>&"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]; }); }
  function show(id) { ["loading", "v-auth", "v-none", "v-app"].forEach(function (v) { $(v).hidden = v !== id; }); }
  function toast(msg, kind) {
    var t = document.createElement("div"); t.className = "toast" + (kind ? " " + kind : ""); t.textContent = msg;
    $("toast-root").appendChild(t); setTimeout(function () { t.remove(); }, 3200);
  }
  function qs(name) { var m = location.search.match(new RegExp("[?&]" + name + "=([^&]+)")); return m ? decodeURIComponent(m[1]) : ""; }
  function fmtD(s) { if (!s) return "—"; return new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }); }
  function fmtDL(s) { if (!s) return "—"; return new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }); }
  function daysTo(s) { if (!s) return null; return Math.ceil((new Date(s) - new Date()) / 864e5); }
  function daysAgo(s) { if (!s) return null; return Math.floor((new Date() - new Date(s)) / 864e5); }
  function plural(n, a, b, c) { n = Math.abs(n) % 100; var m = n % 10; if (n > 10 && n < 20) return c; if (m > 1 && m < 5) return b; if (m === 1) return a; return c; }
  var L = {
    level: { bachelor: "Бакалавриат", master: "Магистратура", phd: "PhD" },
    field: { it: "IT", eng: "Инженерия", med: "Медицина", bus: "Бизнес", sci: "Науки", hum: "Гуманитарные", art: "Искусство", law: "Право" },
    cc: { hu: "Венгрия", de: "Германия", it: "Италия", cz: "Чехия", tr: "Турция", cn: "Китай", kr: "Корея", jp: "Япония", pl: "Польша", us: "США", fr: "Франция", nl: "Нидерланды", ae: "ОАЭ", eu: "Европа", se: "Швеция", sa: "Сауд. Аравия", hk: "Гонконг", sg: "Сингапур", uk: "Британия", gb: "Британия", ca: "Канада", kz: "Казахстан", ch: "Швейцария", at: "Австрия", my: "Малайзия", in: "Индия" }
  };
  function listOf(v) { if (!v) return []; if (Array.isArray(v)) return v; try { var j = JSON.parse(v); if (Array.isArray(j)) return j; } catch (e) {} return String(v).replace(/[\[\]"]/g, "").split(",").map(function (x) { return x.trim(); }).filter(Boolean); }
  function direction(r) {
    var f = listOf(r.field).map(function (x) { return L.field[x] || x; }).slice(0, 2).join(", ");
    var c = listOf(r.countries).map(function (x) { return L.cc[String(x).toLowerCase()] || x; }).slice(0, 2).join(", ");
    var lv = L.level[r.level] || "";
    return [c, f].filter(Boolean).join(" · ") || lv || "";
  }
  function isRisk(r) { var d = daysTo(r.next_deadline); return d != null && d <= 30 && (r.docs_ready || 0) < Math.max(1, r.docs || 0); }
  function isIdle(r) { var d = daysAgo(r.last_active); return d == null || d >= 7; }

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
    try { localStorage.setItem("scholary_next", "/schools/cabinet/" + (claim ? "?claim=" + encodeURIComponent(claim) : "")); } catch (e) {}
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
  function out() { sb.auth.signOut().then(function () { location.href = "/schools/cabinet/"; }); }
  $("btn-out").onclick = out; $("btn-out2").onclick = out;

  /* ---------- вход в кабинет ---------- */
  function enter() {
    if (S.entering) return; S.entering = true; show("loading");
    var claim = qs("claim");
    var p = claim ? sb.rpc("school_claim", { p_token: claim }).then(function (r) {
      var j = r.data;
      if (j && j.ok) { track("school_claim_ok"); history.replaceState(null, "", "/schools/cabinet/"); toast("Кабинет школы " + j.name + " привязан к вашему аккаунту", "ok"); }
      else if (j && j.why === "taken") toast("Эта школа уже привязана к другому аккаунту — войдите им или напишите нам", "bad");
      else if (j && j.why === "not_found") toast("Ссылка привязки не найдена — откройте актуальное письмо", "bad");
    }) : Promise.resolve();
    p.then(function () { return sb.rpc("school_mine"); }).then(function (r) {
      S.entering = false;
      S.school = r.data || null;
      if (!S.school) {
        $("noneEmail").textContent = (S.session && S.session.user.email) || "";
        show("v-none"); track("school_cab_none"); return;
      }
      drawHead(); show("v-app"); loadRoster(); track("school_cab_open");
    });
  }

  function drawHead() {
    var s = S.school;
    $("scName").textContent = s.name;
    $("scMeta").textContent = [s.city, s.plan_label, s.ends_on ? "до " + fmtDL(s.ends_on) : ""].filter(Boolean).join(" · ");
    $("scStatus").innerHTML = s.open ? '<span class="pill pill-ok">доступ открыт</span>' : (s.status === "active" ? '<span class="pill pill-warn">срок истёк</span>' : '<span class="pill pill-mut">' + esc(s.status) + '</span>');
    var link = location.origin + "/schools/join/?code=" + s.invite_code;
    $("inviteLink").value = link; $("inviteCode").textContent = s.invite_code || "—";
    var free = Math.max(0, s.seats - s.used);
    $("seatUsed").textContent = s.used; $("seatTotal").textContent = s.seats;
    $("seatBar").style.width = Math.min(100, Math.round(100 * s.used / Math.max(1, s.seats))) + "%";
    $("seatFree").textContent = free > 0 ? "свободно " + free + " " + plural(free, "место", "места", "мест") : "места закончились — ссылка временно не принимает новых";
    var msg = "Ребята, у нашей школы есть доступ к Scholary — сервис считает реальную вероятность поступить за рубеж со стипендией (97 программ в 54 странах) и ведёт по документам и дедлайнам.\n\n" +
      "Регистрируйтесь по ссылке школы — доступ Scholary Pro для вас бесплатный" + (s.ends_on ? " до " + fmtDL(s.ends_on) : "") + ":\n" + link +
      "\n\nЗаймёт 2 минуты: создать аккаунт, указать класс, ответить на 7 вопросов — и вы увидите свои шансы. Вопросы — ко мне.";
    $("msgText").value = msg;
    $("btn-wa").href = "https://wa.me/?text=" + encodeURIComponent(msg);
  }

  function loadRoster() {
    $("rosterSub").textContent = "Загружаю…";
    sb.rpc("school_roster").then(function (r) {
      S.roster = r.data || [];
      if (r.error) { $("roster").innerHTML = '<div class="sm mut">Не удалось загрузить список: ' + esc(r.error.message) + "</div>"; return; }
      drawChips(); drawRoster(); drawKpi();
    });
  }
  function drawKpi() {
    var risk = S.roster.filter(isRisk).length, idle = S.roster.filter(isIdle).length, nocalc = S.roster.filter(function (r) { return r.p_adm == null; }).length;
    $("riskN").textContent = risk; $("idleN").textContent = idle; $("noCalcN").textContent = nocalc;
  }
  function classes() {
    var m = {}; S.roster.forEach(function (r) { var k = r.class_label || (r.grade && r.grade !== "other" ? r.grade : "—"); m[k] = (m[k] || 0) + 1; });
    return Object.keys(m).sort().map(function (k) { return { k: k, n: m[k] }; });
  }
  function drawChips() {
    var cs = classes();
    var h = '<button class="chip' + (!S.cls && !S.risk ? " on" : "") + '" data-cls="">Все · ' + S.roster.length + "</button>";
    cs.forEach(function (c) { h += '<button class="chip' + (S.cls === c.k ? " on" : "") + '" data-cls="' + esc(c.k) + '">' + esc(c.k) + " · " + c.n + "</button>"; });
    h += '<button class="chip risk' + (S.risk ? " on" : "") + '" data-risk="1">В зоне риска · ' + S.roster.filter(isRisk).length + "</button>";
    $("classChips").innerHTML = h;
  }
  function filtered() {
    var q = S.q.toLowerCase();
    return S.roster.filter(function (r) {
      if (S.cls && (r.class_label || (r.grade !== "other" ? r.grade : "—")) !== S.cls) return false;
      if (S.risk && !isRisk(r)) return false;
      if (q && String(r.name || "").toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) {
      var ra = isRisk(a) ? 1 : 0, rb = isRisk(b) ? 1 : 0; if (ra !== rb) return rb - ra;
      var da = daysTo(a.next_deadline), db = daysTo(b.next_deadline);
      if (da != null && db != null && da !== db) return da - db;
      if ((da == null) !== (db == null)) return da == null ? 1 : -1;
      return String(a.name).localeCompare(String(b.name), "ru");
    });
  }
  function drawRoster() {
    var rows = filtered();
    $("rosterSub").textContent = S.roster.length ? S.roster.length + " " + plural(S.roster.length, "ученик", "ученика", "учеников") + " · показано " + rows.length : "Пока никто не зарегистрировался — разошлите ссылку";
    if (!S.roster.length) { $("roster").innerHTML = '<div class="sm mut" style="padding:10px 0">Первые ученики появятся здесь сразу после регистрации по ссылке. Обычно класс регистрируется за один классный час.</div>'; return; }
    if (!rows.length) { $("roster").innerHTML = '<div class="sm mut" style="padding:10px 0">Никого не нашли по этому фильтру.</div>'; return; }
    var h = '<table class="r"><tr><th>Ученик</th><th>Направление</th><th>Вероятность</th><th class="num">Подачи</th><th class="num">Документы</th><th>Дедлайн</th><th>Активность</th><th></th></tr>';
    rows.forEach(function (r) {
      var p = r.p_adm == null ? null : Math.round(Number(r.p_adm) * 100);
      var d = daysTo(r.next_deadline), ago = daysAgo(r.last_active);
      var dl = d == null ? '<span class="pill pill-mut">нет подач</span>'
             : '<span class="pill ' + (d < 30 ? "pill-bad" : d < 75 ? "pill-warn" : "pill-mut") + '">' + fmtD(r.next_deadline) + " · " + (d < 0 ? "прошёл" : d + " " + plural(d, "день", "дня", "дней")) + "</span>";
      var act = ago == null ? '<span class="sub">—</span>' : ago === 0 ? "сегодня" : ago === 1 ? "вчера" : (ago >= 7 ? '<span style="color:var(--warn);font-weight:650">' : "") + ago + " " + plural(ago, "день", "дня", "дней") + " назад" + (ago >= 7 ? "</span>" : "");
      h += "<tr" + (isRisk(r) ? ' style="background:#FFF8F7"' : "") + ">" +
        '<td><div class="name">' + esc(r.name) + '</div><div class="sub">' + esc(r.class_label || (r.grade !== "other" ? r.grade + " класс" : "класс не указан")) + "</div></td>" +
        '<td><div>' + esc(direction(r) || "—") + '</div><div class="sub">' + esc(L.level[r.level] || "") + "</div></td>" +
        "<td>" + (p == null ? '<span class="sub">квиз не пройден</span>' : '<span class="pbar"><i><b style="width:' + p + '%"></b></i><b>' + p + "%</b></span>") + "</td>" +
        '<td class="num">' + (r.apps_sent || 0) + " / " + (r.apps || 0) + "</td>" +
        '<td class="num">' + (r.docs_ready || 0) + " / " + (r.docs || 0) + "</td>" +
        "<td>" + dl + "</td>" +
        "<td>" + act + "</td>" +
        '<td class="num"><button class="rm" data-rm="' + esc(r.user_id) + '" title="Убрать из школы" aria-label="Убрать из школы">×</button></td></tr>';
    });
    h += "</table>";
    $("roster").innerHTML = h;
  }

  /* ---------- действия ---------- */
  $("q").addEventListener("input", function () { S.q = $("q").value.trim(); drawRoster(); });
  $("classChips").addEventListener("click", function (e) {
    var b = e.target.closest(".chip"); if (!b) return;
    if (b.hasAttribute("data-risk")) { S.risk = !S.risk; S.cls = ""; }
    else { S.cls = b.getAttribute("data-cls") || ""; S.risk = false; }
    drawChips(); drawRoster();
  });
  $("roster").addEventListener("click", function (e) {
    var b = e.target.closest("[data-rm]"); if (!b) return;
    var uid = b.getAttribute("data-rm");
    if (b.getAttribute("data-armed")) {
      sb.rpc("school_remove_member", { p_user: uid }).then(function (r) {
        if (r.data && r.data.ok) { toast("Ученик убран из школы — место освободилось", "ok"); S.roster = S.roster.filter(function (x) { return x.user_id !== uid; }); S.school.used = Math.max(0, S.school.used - 1); drawHead(); drawChips(); drawRoster(); drawKpi(); track("school_member_removed"); }
        else toast("Не получилось убрать", "bad");
      });
      return;
    }
    b.setAttribute("data-armed", "1"); b.textContent = "Убрать?"; b.style.color = "var(--bad)"; b.style.fontSize = "12.5px"; b.style.fontWeight = "700";
    setTimeout(function () { if (b.isConnected) { b.removeAttribute("data-armed"); b.textContent = "×"; b.style.cssText = ""; } }, 4000);
  });
  function copy(text, okMsg) {
    var done = function () { toast(okMsg || "Скопировано", "ok"); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    else fallback();
    function fallback() { var i = $("inviteLink"); i.select(); try { document.execCommand("copy"); done(); } catch (e) { toast("Скопируйте вручную", "bad"); } }
  }
  $("btn-copy").onclick = function () { copy($("inviteLink").value, "Ссылка скопирована"); track("school_link_copy"); };
  $("btn-msg").onclick = function () { $("msgBox").hidden = !$("msgBox").hidden; };
  $("btn-msg-copy").onclick = function () { copy($("msgText").value, "Текст скопирован"); };
  $("btn-regen").onclick = function () { $("regenBox").hidden = false; };
  $("btn-regen-no").onclick = function () { $("regenBox").hidden = true; };
  $("btn-regen-yes").onclick = function () {
    $("regenBox").hidden = true;
    sb.rpc("school_regen_code").then(function (r) {
      if (r.data && r.data.ok) { S.school.invite_code = r.data.invite_code; drawHead(); toast("Новая ссылка выпущена — старая больше не работает", "ok"); track("school_link_regen"); }
      else toast("Не получилось выпустить ссылку", "bad");
    });
  };
  $("btn-refresh").onclick = function () { sb.rpc("school_mine").then(function (r) { if (r.data) { S.school = r.data; drawHead(); } loadRoster(); }); };
  $("btn-csv").onclick = function () {
    var rows = filtered();
    var head = ["Ученик", "Класс", "Направление", "Уровень", "Вероятность %", "Подач отправлено", "Подач всего", "Документов готово", "Документов всего", "Ближайший дедлайн", "Последняя активность", "Зарегистрирован"];
    var lines = [head.join(";")].concat(rows.map(function (r) {
      return [r.name, r.class_label || r.grade || "", direction(r), L.level[r.level] || "", r.p_adm == null ? "" : Math.round(Number(r.p_adm) * 100),
              r.apps_sent || 0, r.apps || 0, r.docs_ready || 0, r.docs || 0, r.next_deadline || "", r.last_active ? String(r.last_active).slice(0, 10) : "", r.joined_at ? String(r.joined_at).slice(0, 10) : ""]
        .map(function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; }).join(";");
    }));
    var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "scholary-" + (S.school.name || "school").replace(/[^\wа-яА-ЯёЁ-]+/g, "_") + ".csv";
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    track("school_csv");
  };

  /* ---------- сессия ---------- */
  sb.auth.onAuthStateChange(function (event, session) {
    if (session && S.session && S.session.user.id === session.user.id && S.school) { S.session = session; return; }
    S.session = session;
    if (session) enter(); else { S.entering = false; show("v-auth"); authView("login"); }
  });
  sb.auth.getSession().then(function (r) { if (!r.data.session) { show("v-auth"); authView("login"); } });
}
(function boot() {
  if (window.supabase && window.supabase.createClient) { __schoolCabinetMain(); return; }
  boot.t = boot.t || Date.now();
  if (Date.now() - boot.t < 8000) { setTimeout(boot, 100); return; }
  document.getElementById("loading").innerHTML = '<div style="text-align:center;padding:20px;color:#6E6E73">Не получилось загрузить страницу — отключите блокировщик рекламы или откройте в другом браузере.</div>';
})();
