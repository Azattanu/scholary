/* Scholary · регистрация ученика по ссылке школы (/schools/join/?code=…).
   Сценарий: показать школу → войти/зарегистрироваться → указать класс →
   school_join() → Pro выдан → в кабинет.
   Код школы держим в localStorage: вход через Google уводит на /cabinet/
   (единственный разрешённый адрес возврата), а кабинет по ключу
   scholary_next возвращает сюда — и регистрация доделывается. */
function __schoolJoinMain() {
  "use strict";
  var C = window.SCHOLARY_CONFIG || {};
  var sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
  var $ = function (id) { return document.getElementById(id); };
  var track = window.track || function () {};
  var S = { code: "", school: null, session: null };

  function qs(name) { var m = location.search.match(new RegExp("[?&]" + name + "=([^&]+)")); return m ? decodeURIComponent(m[1]) : ""; }
  function show(id) { ["loading", "v-bad", "v-main"].forEach(function (v) { $(v).hidden = v !== id; }); }
  function step(id) { ["s-auth", "s-class", "s-done"].forEach(function (v) { $(v).hidden = v !== id; }); }
  function fmtD(s) { if (!s) return ""; var d = new Date(s); return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }); }
  function authErr(id, err) {
    var el = $(id), m = (err && err.message) || "Что-то пошло не так";
    if (/Invalid login credentials/i.test(m)) m = "Неверная почта или пароль";
    if (/already registered/i.test(m)) m = "Такой аккаунт уже есть — нажми «Войти»";
    if (/rate limit/i.test(m)) m = "Слишком много попыток — подожди минуту";
    el.textContent = m; el.hidden = false;
  }

  /* ---------- код школы ---------- */
  S.code = (qs("code") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!S.code) { try { S.code = localStorage.getItem("scholary_school_code") || ""; } catch (e) {} }
  if (!S.code) { bad("Нет кода школы", "Открой ссылку, которую прислала школа — в ней есть код. Если ссылка не открывается, попроси её ещё раз у профориентолога."); return; }
  try { localStorage.setItem("scholary_school_code", S.code); } catch (e) {}

  function bad(title, text) {
    $("badTitle").textContent = title; $("badText").textContent = text; show("v-bad");
  }

  sb.rpc("school_by_code", { p_code: S.code }).then(function (r) {
    var j = r.data;
    if (r.error || !j || !j.ok) { bad("Ссылка не работает", "Такой школы не нашли. Проверь, что открыл(а) ссылку целиком, или попроси у профориентолога новую."); track("school_join_bad", { why: "not_found" }); return; }
    S.school = j;
    $("schName").textContent = j.name;
    $("schCity").textContent = j.city ? j.city + " · " + j.plan : j.plan;
    $("schUntil").textContent = j.ends_on ? "до " + fmtD(j.ends_on) : "";
    $("schUntil").hidden = !j.ends_on;
    var free = Math.max(0, (j.seats || 0) - (j.used || 0));
    $("schSeats").textContent = free > 0 ? "свободно мест: " + free : "мест не осталось";
    if (!j.open) {
      if (j.why === "full") bad("Места закончились", "Школа " + j.name + " выбрала все места по своему тарифу. Напиши профориентологу — школа может расширить доступ, и ссылка заработает снова.");
      else bad("Доступ школы закрыт", "Срок подключения " + j.name + " закончился или ещё не начался. Напиши профориентологу — он знает, когда доступ откроют.");
      track("school_join_bad", { why: j.why });
      return;
    }
    show("v-main");
    track("school_join_view", { school: j.name });
    sb.auth.getSession().then(function (r2) { onSession(r2.data.session); });
  });

  /* ---------- вход ---------- */
  function authView(which) {
    $("f-signup").hidden = which !== "signup";
    $("f-login").hidden = which !== "login";
    $("f-forgot").hidden = which !== "forgot";
  }
  $("lnk-login").onclick = function (e) { e.preventDefault(); authView("login"); };
  $("lnk-login2").onclick = function (e) { e.preventDefault(); authView("login"); };
  $("lnk-signup").onclick = function (e) { e.preventDefault(); authView("signup"); };
  $("lnk-forgot").onclick = function (e) { e.preventDefault(); authView("forgot"); };

  $("btn-google").onclick = function () {
    /* Возврат разрешён только на /cabinet/ — кабинет прочитает scholary_next
       и вернёт сюда с уже открытой сессией. */
    try { localStorage.setItem("scholary_next", "/schools/join/?code=" + S.code); } catch (e) {}
    sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + "/cabinet/" } })
      .then(function (r) { if (r.error) authErr("su-err", { message: "Google-вход недоступен — зарегистрируйся по почте" }); });
  };
  $("f-signup").onsubmit = function (e) {
    e.preventDefault(); $("su-err").hidden = true;
    var name = $("su-name").value.trim();
    if (name.length < 2) { authErr("su-err", { message: "Напиши имя" }); return; }
    sb.auth.signUp({ email: $("su-email").value.trim(), password: $("su-pass").value, options: { data: { name: name } } })
      .then(function (r) {
        if (r.error) { authErr("su-err", r.error); return; }
        track("school_signup", {});
        if (!r.data || !r.data.session) {
          var el = $("su-err");
          el.textContent = "Письмо с подтверждением отправлено на " + $("su-email").value.trim() + " — открой ссылку из него, затем вернись по ссылке школы. Если письма нет 2 минуты — проверь «Спам».";
          el.style.color = "#187E54"; el.hidden = false;
        }
      });
  };
  $("f-login").onsubmit = function (e) {
    e.preventDefault(); $("li-err").hidden = true;
    sb.auth.signInWithPassword({ email: $("li-email").value.trim(), password: $("li-pass").value })
      .then(function (r) { if (r.error) authErr("li-err", r.error); });
  };
  $("f-forgot").onsubmit = function (e) {
    e.preventDefault(); $("fg-err").hidden = true;
    sb.auth.resetPasswordForEmail($("fg-email").value.trim(), { redirectTo: location.origin + "/cabinet/" })
      .then(function (r) { if (r.error) { authErr("fg-err", r.error); return; } $("fg-ok").hidden = false; });
  };
  $("lnk-out").onclick = function (e) { e.preventDefault(); sb.auth.signOut().then(function () { step("s-auth"); authView("signup"); }); };

  /* ---------- сессия → класс ---------- */
  function onSession(session) {
    S.session = session;
    if (!session) { step("s-auth"); return; }
    var u = session.user, meta = u.user_metadata || {};
    var name = meta.name || meta.full_name || "";
    $("whoName").textContent = name || u.email;
    $("whoEmail").textContent = name ? u.email : "";
    $("whoAva").textContent = (name || u.email || "S")[0].toUpperCase();
    if (!$("cl-name").value) $("cl-name").value = name;
    step("s-class");
  }
  sb.auth.onAuthStateChange(function (event, session) {
    if (event === "SIGNED_OUT") { onSession(null); return; }
    if (session && (!S.session || S.session.user.id !== session.user.id)) onSession(session);
  });

  $("f-class").onsubmit = function (e) {
    e.preventDefault(); $("cl-err").hidden = true;
    var name = $("cl-name").value.trim();
    if (name.length < 2) { authErr("cl-err", { message: "Напиши имя и фамилию" }); return; }
    if (!$("cl-consent").checked) { authErr("cl-err", { message: "Поставь галочку про согласие — без неё школа не может тебя добавить" }); return; }
    /* Буква класса: на телефоне с английской раскладкой набирают латинскую B/E/A —
       приводим к кириллице, иначе «11B» и «11В» станут разными классами в списке. */
    var LAT = { A: "А", B: "В", C: "С", E: "Е", H: "Н", K: "К", M: "М", O: "О", P: "Р", T: "Т", X: "Х", Y: "У" };
    var grade = $("cl-grade").value, letter = $("cl-letter").value.trim().toUpperCase().replace(/[ABCEHKMOPTXY]/g, function (ch) { return LAT[ch]; });
    var cls = grade === "other" ? letter : (grade + letter);
    var btn = $("joinBtn"); btn.disabled = true; btn.textContent = "Открываю доступ…";
    sb.rpc("school_join", { p_code: S.code, p_grade: grade, p_class: cls, p_name: name }).then(function (r) {
      btn.disabled = false; btn.textContent = "Получить доступ";
      var j = r.data;
      if (r.error || !j || !j.ok) {
        var why = (j && j.why) || (r.error && r.error.message) || "";
        var m = why === "full" ? "Места в школе закончились — напиши профориентологу."
              : why === "closed" ? "Доступ школы закрыт — напиши профориентологу."
              : "Не получилось — попробуй ещё раз или напиши нам в WhatsApp.";
        authErr("cl-err", { message: m }); track("school_join_fail", { why: why }); return;
      }
      try { localStorage.removeItem("scholary_school_code"); localStorage.setItem("scholary_school_joined", j.school || "1"); } catch (e2) {}
      $("doneText").textContent = "Scholary Pro активна" + (j.ends_on ? " до " + fmtD(j.ends_on) : "") + " — дальше кабинет: за 2 минуты посчитаем твою вероятность по 97 программам и соберём план документов.";
      step("s-done");
      track("school_join_ok", { already: !!j.already });
    });
  };
}
(function boot() {
  if (window.supabase && window.supabase.createClient) { __schoolJoinMain(); return; }
  boot.t = boot.t || Date.now();
  if (Date.now() - boot.t < 8000) { setTimeout(boot, 100); return; }
  document.getElementById("loading").innerHTML = '<div style="text-align:center;padding:20px;color:#6E6E73">Не получилось загрузить страницу — отключи блокировщик рекламы или открой в другом браузере.</div>';
})();
