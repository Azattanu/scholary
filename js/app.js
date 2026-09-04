// Scholary v19 — общие помощники: аналитика и сохранение лида в Supabase.
// Всё fail-safe: если Supabase не настроен или недоступен, сайт продолжает работать.
(function () {
  const C = window.SCHOLARY_CONFIG || {};
  const configured = C.SUPABASE_URL && !String(C.SUPABASE_URL).startsWith("TODO");

  /* ID лида — это ключ к анкете и к покупке: зная его, посторонний может
     привязать чужой лид к своему кабинету. Поэтому он всегда криптостойкий.
     Раньше запасной вариант был "anon-" + Date.now() — угадывается перебором
     миллисекунд за минуту. Теперь запасной путь тоже случайный. */
  function randId() {
    try {
      if (crypto && crypto.randomUUID) return crypto.randomUUID();
      if (crypto && crypto.getRandomValues) {
        var a = new Uint8Array(18), h = "";
        crypto.getRandomValues(a);
        for (var i = 0; i < a.length; i++) h += ("0" + a[i].toString(16)).slice(-2);
        return "id-" + h;
      }
    } catch (e) {}
    /* Совсем древний браузер без Web Crypto: три независимых источника
       энтропии лучше одного счётчика времени. */
    return "id-" + Date.now().toString(36) +
           Math.random().toString(36).slice(2, 12) +
           Math.random().toString(36).slice(2, 12);
  }

  function leadId() {
    try {
      let id = localStorage.getItem("scholary_lead_id");
      /* Старые id вида «anon-<время>» перебираемы и сервером больше не принимаются —
         такому посетителю выдаём новый криптостойкий id. */
      if (id && !/^[0-9a-fA-F-]{20,64}$/.test(id)) id = null;
      if (!id) {
        id = randId();
        localStorage.setItem("scholary_lead_id", id);
      }
      return id;
    } catch (e) {
      /* localStorage недоступен (приватный режим, блокировка хранилища) —
         держим один и тот же id хотя бы в пределах вкладки, иначе события
         и анкета разъедутся по разным лидам. */
      if (!window.__scholaryLeadFallback) window.__scholaryLeadFallback = randId();
      return window.__scholaryLeadFallback;
    }
  }

  function utm() {
    try {
      const p = new URLSearchParams(location.search);
      const u = {};
      ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid"].forEach(k => { if (p.get(k)) u[k] = p.get(k); });
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

  /* Сколько денег стоит событие — чтобы Метрика показывала доход по целям
     и рекламные кабинеты умели считать стоимость привлечения. */
  /* Метрика различает цели по имени, поэтому одно событие pay_result
     разводим на pay_success / pay_fail / pay_cancel / pay_pending: иначе
     в отчётах отменённая оплата считалась бы конверсией. */
  function ymGoal(event, data) {
    if (event !== "pay_result") return event;
    var st = (data && data.status) || "", tp = (data && data.type) || "";
    if (tp === "cancel" || st === "cancel") return "pay_cancel";
    if (tp === "error") return "pay_fail";
    if (st === "success" || st === "appointment") return "pay_success";
    if (st === "wait") return "pay_pending";
    return "pay_fail";
  }
  function goalPrice(goal, data) {
    var C2 = window.SCHOLARY_CONFIG || {};
    if (goal === "pay_success") {
      if (data && data.kind === "pro_season") return 14900;
      if (data && data.kind === "pro_month") return 4990;
      if (data && data.kind === "consult") return C2.PRICE_CONSULT || 15000;
      if (data && data.kind === "package") return C2.PRICE_PACKAGE || 35000;
      return C2.PRICE_REPORT || 4000;
    }
    if (goal === "cta_tariff_consult") return C2.PRICE_CONSULT || 15000;
    if (goal === "cta_tariff_package") return C2.PRICE_PACKAGE || 35000;
    return null;
  }

  // Событие аналитики: track('quiz_step', {step: 3})
  window.track = function (event, data) {
    var clean = window.scholaryClean || function (x) { return x; };
    var props = Object.assign({ page: location.pathname }, clean(data || {}));
    // то же событие уходит в продуктовую аналитику — без персональных полей
    try {
      if (window.posthog && window.posthog.capture) window.posthog.capture(event, props);
    } catch (e) {}
    /* И в Яндекс.Метрику: имя цели = имя события, кроме pay_result —
       его разводим по исходу (см. ymGoal), чтобы отмена не считалась продажей. */
    /* И в пиксель Meta: стандартные события — чтобы реклама умела
       оптимизироваться на заявку, а не на «клик по ссылке». */
    try { if (window.scholaryFb) window.scholaryFb(event, data, props); } catch (e) {}
    try { if (window.scholaryTt) window.scholaryTt(event, data, props); } catch (e) {}
    try {
      if (window.scholaryYm) {
        var goal = ymGoal(event, data), price = goalPrice(goal, data);
        window.scholaryYm(goal, price ? Object.assign({ order_price: price, currency: "KZT" }, props) : props);
      }
    } catch (e) {}
    return post("events", { lead_id: leadId(), event: event, data: data || {}, utm: utm(), ts: new Date().toISOString(), page: location.pathname });
  };

  // Сохранение/дополнение анкеты лида: saveLead({gpa_band: '4.4-4.0'})
  window.saveLead = function (fields) {
    return post("leads", Object.assign({ id: leadId(), updated_at: new Date().toISOString(), utm: utm() }, fields));
  };

  window.scholaryLeadId = leadId;

  // ---- Телефон WhatsApp: один формат на клиенте, в базе и в отправке ----
  // Люди набирают «8 775…», «+7 775…», «7775…», «775…» — всё это один номер.
  // normalize → «+77753831836» (E.164) или null, если это не похоже на номер.
  // Правила: 10 цифр → +7 + цифры; 11 цифр с 8 → +7 + хвост; 11 с 7 → как есть;
  // 11–15 цифр с другим кодом (набрано через «+») → международный как есть.
  window.ScholaryPhone = (function () {
    function digitsOf(v) { return String(v || "").replace(/\D/g, ""); }
    function normalize(v) {
      var raw = String(v || "").trim();
      var d = digitsOf(raw);
      if (!d) return null;
      if (d.length === 12 && d.slice(0, 2) === "78") d = "7" + d.slice(2); // «+7 8 775…» — привычка набирать через 8
      // Все казахстанские номера в 10-значной записи начинаются на 7 (мобильные
      // 70x/74x/77x, городские 727/717…). Если 10 цифр начинаются с 8 — человек
      // потерял цифру («8775383183»), и достраивать такой номер нельзя: получится
      // правдоподобный, но ЧУЖОЙ номер. Лучше честно отклонить и переспросить.
      if (d.length === 10 && raw[0] !== "+") {
        if (d[0] !== "7") return null;
        d = "7" + d;
      }
      else if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1);
      else if (d.length === 11 && d[0] === "7") { /* ок */ }
      else if (raw[0] === "+" && d.length >= 11 && d.length <= 15) { /* другой код страны */ }
      else return null;
      return "+" + d;
    }
    // Абонентская часть (10 цифр после +7) из того, что набрано.
    // Если в поле уже стоит «+7 …», всё после него — абонентская часть: так
    // «+7 775 383 18 3» не превращается в «+7 753 831 83». Без префикса:
    // 11 цифр с 7/8 — код страны, отбрасываем; ≤10 — всё абонентская часть.
    function subscriber(v) {
      v = String(v || "");
      var t = v.trim(), sub;
      if (t.slice(0, 2) === "+7") sub = digitsOf(t.slice(2));
      else sub = digitsOf(t);
      /* Ведущая 8 — это междугородний префикс, а НЕ первая цифра номера:
         абонентская часть в РК всегда начинается на 7 и длиной ровно 10.
         Без этого «8775383183» (человек потерял цифру) маска достраивала
         в «+7 877 538 31 83» — валидный по виду, но чужой номер. */
      if (sub[0] === "8") sub = sub.slice(1);
      else if (sub.length === 11 && sub[0] === "7") sub = sub.slice(1);
      return sub.slice(0, 10);
    }
    // Красивый вид: +7 775 383 18 36
    function format(v) {
      var t = String(v || "").trim();
      if (!t) return "";
      var sub = subscriber(t);
      var p = [sub.slice(0, 3), sub.slice(3, 6), sub.slice(6, 8), sub.slice(8, 10)].filter(Boolean);
      return "+7" + (p.length ? " " + p.join(" ") : "");
    }
    function valid(v) { var n = normalize(v); return !!n && (n.length === 12 && n.slice(0, 2) === "+7" || n.length > 12); }
    // Маска на input: форматирует по мере ввода, каретка — в конце
    function attach(input) {
      if (!input || input.__phoneMask) return;
      input.__phoneMask = true;
      input.addEventListener("input", function () {
        var v = input.value, t = v.trim();
        var d = digitsOf(v);
        // международный номер (не +7/8) не трогаем — только чистим мусор
        if (t[0] === "+" && d.length > 1 && d[0] !== "7" && d[0] !== "8") { input.value = "+" + d.slice(0, 15); return; }
        if (t === "+" || t === "") { input.value = t; return; }
        input.value = format(v);
      });
      input.addEventListener("focus", function () { if (!input.value) input.value = "+7 "; });
      input.addEventListener("blur", function () { if (input.value.trim() === "+7" || input.value.trim() === "+") input.value = ""; });
    }
    return { normalize: normalize, format: format, valid: valid, attach: attach, digits: digitsOf };
  })();


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
    if (window.track) window.track("pay_widget_open", { kind: o.kind || "report", amount: o.amount });
    loadWidget().then(function () {
      var widget = new window.tiptop.Widget();
      /* Разбор ответа виджета. Типы шлюза: payment, installment, installmentKz, sbp,
         foreignCard, sberPay, tinkoff, spei, cancel, error. Статусы: success,
         appointment (рассрочку одобрили), fail, reject, cancel, wait.
         Проверять только type==="payment" && status==="success" нельзя: тогда
         рассрочка и СБП уходили бы в «оплата не прошла» при списанных деньгах.
         Истина в любом случае за сервером — вебхук в api/tiptop.php. */
      widget.oncomplete = function (r) {
        var type = (r && r.type) || "", status = (r && r.status) || "";
        var cancelled = type === "cancel" || status === "cancel";
        var ok = !cancelled && type !== "error" && (status === "success" || status === "appointment");
        var pending = !cancelled && !ok && status === "wait";
        if (window.track) window.track("pay_result", { type: type, status: status, kind: o.kind || "", txn: String((r && (r.transactionId || r.transaction_id || r.TransactionId)) || "") });
        if (ok) { if (o.onSuccess) o.onSuccess(r); }
        else if (cancelled) { if (o.onCancel) o.onCancel(r); }
        else if (pending) { (o.onPending || o.onSuccess || function () {})(r); }
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

  /* ---------- Оплата через Kaspi (ApiPay.kz) ----------
     Счёт уходит покупателю прямо в приложение Kaspi по номеру телефона,
     дальше страница раз в 3 секунды спрашивает сервер о статусе. Факт
     оплаты ставит сервер (вебхук или его же опрос ApiPay) — с фронта
     ничего не «засчитывается».
     o: {kind, phone, email, lead, account, onCreated, onStatus(status, info), onError(why, msg)}
     Возвращает {stop()} — остановить опрос (ушли с экрана). */
  window.scholaryKaspiReady = function () { return !!(window.SCHOLARY_CONFIG || {}).KASPI_ON; };
  window.scholaryKaspi = function (o) {
    o = o || {};
    var stopped = false, timer = null, started = Date.now();
    var api = (window.SCHOLARY_CONFIG || {}).KASPI_URL || "/api/kaspi.php";
    function stop() { stopped = true; if (timer) clearTimeout(timer); }
    function poll(order, delay) {
      if (stopped) return;
      timer = setTimeout(function () {
        if (stopped) return;
        fetch(api + "?a=status&o=" + encodeURIComponent(order), { cache: "no-store" })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (stopped) return;
            if (!j || !j.ok) { poll(order, 5000); return; }
            var st = j.status;
            if (o.onStatus) o.onStatus(st, j);
            if (st === "paid" || st === "cancelled" || st === "expired" || st === "error" || st === "partially_refunded") {
              if (window.track && st === "paid") window.track("pay_result", { type: "kaspi", status: "success", kind: o.kind || "", txn: "kaspi_" + order });
              if (window.track && st !== "paid") window.track("pay_result", { type: "kaspi", status: st, kind: o.kind || "" });
              stop(); return;
            }
            /* первые 10 минут — каждые 3 с, дальше реже: счёт живёт сутки */
            poll(order, Date.now() - started < 600000 ? 3000 : 15000);
          })
          .catch(function () { poll(order, 6000); });
      }, delay);
    }
    if (window.track) window.track("pay_widget_open", { kind: o.kind || "report", amount: o.amount, via: "kaspi" });
    fetch(api + "?a=create", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: o.kind || "report", phone: o.phone || "", email: o.email || "", lead: o.lead || "", account: o.account || "" })
    }).then(function (r) { return r.json().then(function (j) { j._http = r.status; return j; }); })
      .then(function (j) {
        if (stopped) return;
        if (!j || !j.ok) {
          if (window.track) window.track("pay_widget_error", { why: "kaspi_" + ((j && j.why) || "http"), via: "kaspi" });
          if (o.onError) o.onError((j && j.why) || "http", (j && j.message) || "");
          return;
        }
        if (o.onCreated) o.onCreated(j);
        poll(j.order, 2500);
      })
      .catch(function () { if (o.onError) o.onError("network", ""); });
    return { stop: stop };
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
