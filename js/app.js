// Scholary v19 — общие помощники: аналитика и сохранение лида в Supabase.
// Всё fail-safe: если Supabase не настроен или недоступен, сайт продолжает работать.
(function () {
  const C = window.SCHOLARY_CONFIG || {};
  const configured = C.SUPABASE_URL && !String(C.SUPABASE_URL).startsWith("TODO");

  function leadId() {
    try {
      let id = localStorage.getItem("scholary_lead_id");
      if (!id) {
        id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
        localStorage.setItem("scholary_lead_id", id);
      }
      return id;
    } catch (e) { return "anon-" + Date.now(); }
  }

  function utm() {
    try {
      const p = new URLSearchParams(location.search);
      const u = {};
      ["utm_source", "utm_medium", "utm_campaign", "utm_content"].forEach(k => { if (p.get(k)) u[k] = p.get(k); });
      if (Object.keys(u).length) sessionStorage.setItem("scholary_utm", JSON.stringify(u));
      return JSON.parse(sessionStorage.getItem("scholary_utm") || "{}");
    } catch (e) { return {}; }
  }

  function hdrs() {
    return {
      "Content-Type": "application/json",
      "apikey": C.SUPABASE_ANON_KEY,
      "Authorization": "Bearer " + C.SUPABASE_ANON_KEY,
      "Prefer": "return=minimal"
    };
  }

  async function post(table, body) {
    if (!configured) { console.log("[scholary] событие в таблицу", table); return; }  // без содержимого: там бывают имя и телефон
    try {
      if (table === "leads") {
        // Запись лида идёт через RPC upsert_lead (insert-or-update на стороне базы)
        const p = Object.assign({}, body); const id = p.id; delete p.id;
        await fetch(C.SUPABASE_URL + "/rest/v1/rpc/upsert_lead", {
          method: "POST", headers: hdrs(), body: JSON.stringify({ p_id: id, p: p })
        });
        return;
      }
      await fetch(C.SUPABASE_URL + "/rest/v1/" + table, {
        method: "POST", headers: hdrs(), body: JSON.stringify(body)
      });
    } catch (e) { /* не мешаем пользователю */ }
  }

  // Событие аналитики: track('quiz_step', {step: 3})
  window.track = function (event, data) {
    // то же событие уходит в продуктовую аналитику — без персональных полей
    try {
      if (window.posthog && window.posthog.capture) {
        var clean = window.scholaryClean || function (x) { return x; };
        window.posthog.capture(event, Object.assign({ page: location.pathname }, clean(data || {})));
      }
    } catch (e) {}
    return post("events", { lead_id: leadId(), event: event, data: data || {}, utm: utm(), ts: new Date().toISOString(), page: location.pathname });
  };

  // Сохранение/дополнение анкеты лида: saveLead({gpa_band: '4.4-4.0'})
  window.saveLead = function (fields) {
    return post("leads", Object.assign({ id: leadId(), updated_at: new Date().toISOString(), utm: utm() }, fields));
  };

  window.scholaryLeadId = leadId;


  // ---- Меню в шапке на телефоне и планшете ----
  // Второстепенные ссылки прячутся под кнопку, а вход в кабинет и главная
  // кнопка остаются на виду. Работает одинаково на всех страницах.
  function initMenu() {
    var burger = document.getElementById("navBurger");
    var menu = document.getElementById("siteMenu");
    if (!burger || !menu) return;
    function close() {
      menu.hidden = true;
      burger.classList.remove("open");
      burger.setAttribute("aria-expanded", "false");
      burger.setAttribute("aria-label", "Открыть меню");
    }
    function open() {
      menu.hidden = false;
      burger.classList.add("open");
      burger.setAttribute("aria-expanded", "true");
      burger.setAttribute("aria-label", "Закрыть меню");
    }
    burger.addEventListener("click", function (e) {
      e.stopPropagation();
      if (menu.hidden) { open(); if (window.track) window.track("menu_open"); } else close();
    });
    // клик мимо меню, Escape и переход по ссылке — закрывают
    document.addEventListener("click", function (e) {
      if (menu.hidden) return;
      if (menu.contains(e.target) || burger.contains(e.target)) return;
      close();
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    menu.querySelectorAll("a").forEach(function (a) { a.addEventListener("click", close); });
    // если человек повернул телефон или растянул окно — меню не должно висеть
    window.addEventListener("resize", function () { if (window.innerWidth > 900) close(); });
    close();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initMenu);
  else initMenu();

  /* ================= Оплата через TipTop Pay =================
     Одна реализация на весь сайт: квиз и кабинет зовут scholaryPay().
     Виджет подгружается по требованию, чтобы не тянуть чужой скрипт
     на страницы, где никто ничего не покупает. */
  window.scholaryTerminalReady = function () {
    var c = window.SCHOLARY_CONFIG || {};
    var id = c.TIPTOP_PUBLIC_TERMINAL_ID || "";
    if (!id || String(id).indexOf("TODO") === 0) return false;
    if (c.TIPTOP_MODE === "live") return true;
    // Тестовый терминал не списывает деньги. Показать такую кнопку всем —
    // значит отдавать отчёты бесплатно, поэтому она только для проверки.
    try {
      if (location.search.indexOf("tt=1") >= 0) { sessionStorage.setItem("scholary_tt", "1"); return true; }
      return sessionStorage.getItem("scholary_tt") === "1" || location.hostname === "localhost";
    } catch (e) { return location.search.indexOf("tt=1") >= 0; }
  };
  var widgetPromise = null;
  function loadWidget() {
    if (window.tiptop && window.tiptop.Widget) return Promise.resolve();
    if (widgetPromise) return widgetPromise;
    widgetPromise = new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[src*="widget.tiptoppay.kz"]');
      var timer = setTimeout(function () { widgetPromise = null; reject(new Error("timeout")); }, 12000);
      function ok() { clearTimeout(timer); (window.tiptop && window.tiptop.Widget) ? resolve() : bad(); }
      function bad() { clearTimeout(timer); widgetPromise = null; reject(new Error("load_failed")); }
      if (existing) { existing.addEventListener("load", ok); existing.addEventListener("error", bad); return; }
      var s = document.createElement("script");
      s.src = "https://widget.tiptoppay.kz/bundles/widget.js";
      s.addEventListener("load", ok);
      s.addEventListener("error", bad);
      document.head.appendChild(s);
    });
    return widgetPromise;
  }
  window.scholaryPay = function (o) {
    o = o || {};
    var fail = o.onError || function () {};
    if (!window.scholaryTerminalReady()) { fail(new Error("no_terminal")); return; }
    if (!o.amount || !o.externalId) { fail(new Error("bad_params")); return; }
    loadWidget().then(function () {
      var widget = new window.tiptop.Widget();
      widget.oncomplete = function (r) {
        var type = r && r.type, status = r && r.status;
        if (window.track) window.track("pay_result", { type: type, status: status, kind: o.kind || "" });
        if (type === "payment" && status === "success") { if (o.onSuccess) o.onSuccess(r); }
        else if (type === "cancel") { if (o.onCancel) o.onCancel(r); }
        else if (o.onFail) o.onFail(r);
      };
      widget.start({
        publicTerminalId: (window.SCHOLARY_CONFIG || {}).TIPTOP_PUBLIC_TERMINAL_ID,
        description: o.description || "Scholary",
        paymentSchema: "Single",
        currency: "KZT",
        amount: o.amount,
        externalId: String(o.externalId),
        accountId: o.accountId || undefined,
        receiptEmail: o.email || undefined
      });
    }, function (e) {
      if (window.track) window.track("pay_widget_error", { why: e && e.message });
      fail(e);
    });
  };

  // UX: все внешние ссылки (мессенджеры, соцсети, чужие сайты) — в новой вкладке
  function externalizeLinks() {
    document.querySelectorAll('a[href^="http"]').forEach(function (a) {
      try {
        if (new URL(a.href).host !== location.host) {
          a.target = "_blank";
          a.rel = a.rel ? a.rel + " noopener" : "noopener";
        }
      } catch (e) {}
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", externalizeLinks);
  else externalizeLinks();
  window.addEventListener("load", externalizeLinks); // ссылки, чьи href проставляются скриптами страницы
  // страховка для ссылок, добавляемых динамически (квиз, кабинет)
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href^="http"]') : null;
    if (!a || a.target === "_blank") return;
    try { if (new URL(a.href).host !== location.host) { a.target = "_blank"; a.rel = "noopener"; } } catch (err) {}
  }, true);
})();
