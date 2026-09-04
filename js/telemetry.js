/* ============================================================
   Scholary · телеметрия: ошибки (Sentry) и продуктовая аналитика (PostHog).
   Правила, которые здесь соблюдаются:
   · персональные данные не уходят наружу — имя, телефон и почта
     вырезаются из любого события перед отправкой;
   · записи экрана выключены, автозахват кликов выключен —
     шлём только события, которые сами назвали;
   · всё fail-safe: если скрипт не загрузился, сайт работает как обычно.
   ============================================================ */
(function () {
  "use strict";
  var C = window.SCHOLARY_CONFIG || {};
  var PII = /(^|_)(name|email|mail|phone|whatsapp|wa|tel|token|password|pass)($|_)/i;

  /* убираем персональные поля из любого объекта события */
  function clean(o, depth) {
    if (!o || typeof o !== "object" || (depth || 0) > 3) return o;
    var out = Array.isArray(o) ? [] : {};
    Object.keys(o).forEach(function (k) {
      if (PII.test(k)) return;
      var v = o[k];
      out[k] = (v && typeof v === "object") ? clean(v, (depth || 0) + 1) : v;
    });
    return out;
  }
  window.scholaryClean = clean;

  /* ---------- Sentry: ошибки фронтенда ---------- */
  if (C.SENTRY_DSN) {
    var s = document.createElement("script");
    s.src = "https://browser.sentry-cdn.com/8.55.0/bundle.min.js";
    s.crossOrigin = "anonymous";
    s.onload = function () {
      try {
        window.Sentry.init({
          dsn: C.SENTRY_DSN,
          environment: (location.hostname === "scholary.kz") ? "production" : "dev",
          release: C.RELEASE || "web",
          sendDefaultPii: false,
          tracesSampleRate: 0,
          /* не шумим чужими ошибками: расширения браузера, блокировщики, боты */
          ignoreErrors: [
            "ResizeObserver loop", "Non-Error promise rejection captured",
            "Failed to fetch", "NetworkError", "AbortError", "top.GLOBALS"
          ],
          denyUrls: [/extensions\//i, /^chrome:\/\//i, /^moz-extension:\/\//i],
          beforeSend: function (event) {
            try {
              /* вычищаем возможные персональные данные из адреса и хлебных крошек */
              if (event.request && event.request.url) event.request.url = event.request.url.split("?")[0];
              if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(function (b) {
                if (b && b.data) b.data = clean(b.data);
                /* токен отчёта (?t=) и id лида (?lead=) — ключи доступа, в крошки навигации не попадают */
                if (b && b.data) ["to", "from", "url"].forEach(function (k) { if (typeof b.data[k] === "string") b.data[k] = b.data[k].replace(/([?&])(t|lead)=[^&#]*/g, "$1$2=~"); });
                return b;
              });
              if (event.user) delete event.user;
            } catch (e) {}
            return event;
          }
        });
      } catch (e) {}
    };
    document.head.appendChild(s);
  }

  /* ---------- Яндекс.Метрика ----------
     Ставим рядом с PostHog, а не вместо: PostHog удобен для воронок внутри
     продукта, Метрика — для рекламы, поисковых запросов и карты кликов.
     Все события сайта автоматически становятся целями с теми же именами:
     дублировать их руками в коде не нужно. */
  var YM_ID = String(C.YANDEX_METRIKA_ID || "").replace(/\D/g, "");
  if (YM_ID) {
    window.dataLayer = window.dataLayer || [];
    (function (m, e, t, r, i, k, a) {
      m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
      m[i].l = 1 * new Date();
      for (var j = 0; j < e.scripts.length; j++) { if (e.scripts[j].src === r) return; }
      k = e.createElement(t), a = e.getElementsByTagName(t)[0];
      k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
    })(window, document, "script", "https://mc.yandex.ru/metrika/tag.js?id=" + YM_ID, "ym");
    try {
      window.ym(YM_ID, "init", {
        ssr: true,
        clickmap: true,            // карта кликов
        trackLinks: true,          // переходы по внешним ссылкам
        accurateTrackBounce: true, // отказ считается только при уходе за 15 секунд
        /* вебвизор не пишет кабинет и отчёт: там имя, почта, мотивационные, заметки —
           политика конфиденциальности обещает, что это не записывается */
        webvisor: !!C.YANDEX_WEBVISOR && !/^\/(cabinet|report|r\.html)/.test(location.pathname),
        ecommerce: "dataLayer",    // доход по целям едет через dataLayer
        referrer: document.referrer,
        url: location.origin + location.pathname,   // без ?t=<токен отчёта> и ?lead=<id>
        defer: false
      });
    } catch (e) {}
    /* Вебвизор пишет экран. Поля с именем, телефоном и почтой помечаем так,
       чтобы их содержимое в записи не сохранялось. Делаем это и для полей,
       которые появляются позже — квиз и кабинет рисуют их на ходу. */
    if (C.YANDEX_WEBVISOR) {
      var PRIV = 'input[type=email],input[type=tel],input[type=password],' +
                 'input[autocomplete=name],input[autocomplete=email],input[autocomplete=tel],' +
                 '#fName,#fWa,#fEmail,#li-email,#li-pass,#su-name,#su-email,#su-pass,' +
                 '#rc-pass,#admEmail,#admPass,#proEmail';
      var mark = function () {
        try {
          document.querySelectorAll(PRIV).forEach(function (el) {
            el.classList.add("ym-disable-keys");     // не сохранять ввод
            el.classList.add("ym-hide-content");     // и не показывать значение
          });
        } catch (e) {}
      };
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mark);
      else mark();
      /* формы появляются динамически — подхватываем новые поля */
      try {
        new MutationObserver(mark).observe(document.documentElement, { childList: true, subtree: true });
      } catch (e) {}
    }
    /* Единая точка отправки цели. Персональные поля вырезаются тем же
       фильтром, что и для PostHog. */
    window.scholaryYm = function (goal, params) {
      try {
        if (!window.ym) return;
        window.ym(YM_ID, "reachGoal", goal, params ? clean(params) : undefined);
      } catch (e) {}
    };
  } else {
    window.scholaryYm = function () {};
  }

  /* ---------- Пиксель Meta (Instagram/Facebook Ads) ----------
     Нужен, чтобы реклама оптимизировалась на людей, которые реально
     оставляют заявку, а не просто кликают. Плюс ретаргет и look-alike.
     ID пустой — блок просто не грузится, сайт работает как обычно. */
  var FB_ID = String(C.META_PIXEL_ID || "").replace(/\D/g, "");
  if (FB_ID) {
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    try { window.fbq("init", FB_ID); window.fbq("track", "PageView"); } catch (e) {}

    /* Наши события → стандартные события Meta. Только эти умеют быть
       целью оптимизации в кабинете; остальное шлём как кастомные. */
    var STD = {
      quiz_start:        "ViewContent",
      lead_form_submit:  "Lead",
      quiz_done:         "Lead",
      paywall_view:      "InitiateCheckout",
      pay_click:         "AddPaymentInfo",
      cab_signup:        "CompleteRegistration",
      cab_setup_done:    "CompleteRegistration",
      free_cabinet_click:"Contact",
      pay_kaspi_click:   "Contact"
    };
    var PRICE = { pro_season: 14900, pro_month: 4990, consult: 15000, package: 35000 };

    window.scholaryFb = function (event, data, props) {
      try {
        if (!window.fbq) return;
        var d = data || {}, safe = clean(props || {});
        /* оплата: успех — Purchase с суммой, остальные исходы не считаем продажей */
        if (event === "pay_result") {
          var st = d.status || "", tp = d.type || "";
          if ((st === "success" || st === "appointment") && tp !== "cancel" && tp !== "error") {
            window.fbq("track", "Purchase", {
              value: PRICE[d.kind] || C.PRICE_REPORT || 4000,
              currency: "KZT", content_name: d.kind || "report"
            });
          } else {
            window.fbq("trackCustom", "pay_not_completed", { status: st, type: tp });
          }
          return;
        }
        if (event === "pro_click") {
          window.fbq("track", "InitiateCheckout", { value: PRICE[d.plan === "season" ? "pro_season" : "pro_month"], currency: "KZT" });
          return;
        }
        if (STD[event]) window.fbq("track", STD[event], safe);
        else window.fbq("trackCustom", event, safe);
      } catch (e) {}
    };
  } else {
    window.scholaryFb = function () {};
  }


  /* ---------- Пиксель TikTok (TikTok Ads) ----------
     Базовый код — официальный сниппет TikTok, ttq.page() на каждой странице.
     Наши события → стандартные события TikTok (только они годятся как цель
     оптимизации в Ads Manager); остальное уходит как кастомные с тем же
     именем. Клики по всем кнопкам и ссылкам-действиям ловим глобально —
     ClickButton с названием кнопки, мессенджеры — Contact. Персональные
     поля в свойства не попадают; для Advanced Matching почта и телефон
     уходят только хэшем SHA-256 через ttq.identify. */
  var TT_ID = String(C.TIKTOK_PIXEL_ID || "").trim();
  if (TT_ID) {
    !function (w, d, t) {
      w.TiktokAnalyticsObject = t; var ttq = w[t] = w[t] || []; ttq.methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie", "holdConsent", "revokeConsent", "grantConsent"], ttq.setAndDefer = function (t, e) { t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))); }; }; for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]); ttq.instance = function (t) { for (var e = ttq._i[t] || [], n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(e, ttq.methods[n]); return e; }, ttq.load = function (e, n) { var r = "https://analytics.tiktok.com/i18n/pixel/events.js", o = n && n.partner; ttq._i = ttq._i || {}, ttq._i[e] = [], ttq._i[e]._u = r, ttq._t = ttq._t || {}, ttq._t[e] = +new Date, ttq._o = ttq._o || {}, ttq._o[e] = n || {}; n = document.createElement("script"); n.type = "text/javascript", n.async = !0, n.src = r + "?sdkid=" + e + "&lib=" + t; e = document.getElementsByTagName("script")[0]; e.parentNode.insertBefore(n, e); };
      ttq.load(TT_ID);
      ttq.page();
    }(window, document, "ttq");

    /* Воронка под требования TikTok для нашей вертикали: ViewContent → AddToCart →
       InitiateCheckout → CompletePayment (+ SubmitForm / CompleteRegistration для
       заявок и регистраций). AddToCart = человек выбрал конкретный товар/тариф,
       InitiateCheckout = открыл оплату (виджет или Kaspi), CompletePayment = деньги. */
    var TT_STD = {
      quiz_start:          "ViewContent",
      tariffs_view:        "ViewContent",
      demo_view:           "ViewContent",
      schools_view:        "ViewContent",
      prof_view:           "ViewContent",
      report_view:         "ViewContent",
      paywall_view:        "ViewContent",
      lead_form_submit:    "SubmitForm",
      quiz_done:           "SubmitForm",
      school_apply_ok:     "SubmitForm",
      counselor_apply_ok:  "SubmitForm",
      cab_signup:          "CompleteRegistration",
      cab_setup_done:      "CompleteRegistration",
      school_join_ok:      "CompleteRegistration",
      school_claim_ok:     "CompleteRegistration",
      ws_claim_ok:         "CompleteRegistration",
      pay_click:           "AddToCart",
      pro_click:           "AddToCart",
      pay_widget_open:     "InitiateCheckout",
      pay_kaspi_click:     "InitiateCheckout"
      /* остальные cta_* и клики по кнопкам не дублируем: их ловит глобальный обработчик кликов ниже */
    };
    /* Цены товаров и тарифов (₸) — value для AddToCart/InitiateCheckout/CompletePayment. */
    var TT_PRICE = {
      report: 4000, pro_season: 14900, pro_month: 4990, consult: 15000, package: 35000,
      counselor_pilot: 0, counselor_15: 39000, counselor_50: 79000, counselor_150: 159000,
      school_pilot: 0, school_100: 300000, school_500: 990000, school_1000: 1500000
    };
    /* Кнопки выбора тарифа на страницах → AddToCart с ценой. */
    var TT_CART = {
      cta_tariff_report: "report", cta_tariff_consult: "consult", cta_tariff_package: "package",
      cta_counselor_tariff_pilot: "counselor_pilot", cta_counselor_tariff_15: "counselor_15",
      cta_counselor_tariff_50: "counselor_50", cta_counselor_tariff_150: "counselor_150",
      cta_school_tariff_pilot: "school_pilot", cta_school_tariff_100: "school_100",
      cta_school_tariff_500: "school_500", cta_school_tariff_1000: "school_1000"
    };
    function ttProduct(id, price) {
      return { contents: [{ content_id: id, content_type: "product", content_name: id, price: price, quantity: 1 }], value: price, currency: "KZT" };
    }
    var ttSeq = 0;
    function ttEventId(name) { ttSeq++; return name + "_" + Date.now().toString(36) + "_" + ttSeq; }

    window.scholaryTt = function (event, data, props) {
      try {
        if (!window.ttq) return;
        var d = data || {}, safe = clean(props || {});
        var pageName = location.pathname.replace(/\/$/, "") || "/";
        if (event === "pay_result") {
          var st = d.status || "", tp = d.type || "";
          if ((st === "success" || st === "appointment") && tp !== "cancel" && tp !== "error") {
            var val = TT_PRICE[d.kind] || TT_PRICE.report;
            window.ttq.track("CompletePayment", {
              contents: [{ content_id: d.kind || "report", content_type: "product", content_name: d.kind || "report", price: val, quantity: 1 }],
              value: val, currency: "KZT"
            }, { event_id: d.txn ? "pay_" + d.txn : ttEventId("pay") });   /* тот же id, что у серверного события — TikTok не посчитает дважды */
          } else {
            window.ttq.track("pay_not_completed", { description: st + "/" + tp }, { event_id: ttEventId("pay_nc") });
          }
          return;
        }
        if (event === "pro_click") {
          var pk = d.plan === "season" ? "pro_season" : "pro_month";
          window.ttq.track("AddToCart", ttProduct(pk, TT_PRICE[pk]), { event_id: ttEventId(event) });
          return;
        }
        if (event === "pay_click" || event === "paywall_view" || event === "pay_kaspi_click") {
          var ck = (d.kind && TT_PRICE[d.kind]) ? d.kind : "report";
          window.ttq.track(TT_STD[event], ttProduct(ck, TT_PRICE[ck]), { event_id: ttEventId(event) });
          return;
        }
        if (event === "pay_widget_open") {
          var wk = d.kind || "report", wv = Number(d.amount) || TT_PRICE[wk] || TT_PRICE.report;
          window.ttq.track("InitiateCheckout", ttProduct(wk, wv), { event_id: ttEventId(event) });
          return;
        }
        if (TT_CART[event]) {
          var ck = TT_CART[event];
          window.ttq.track("AddToCart", ttProduct(ck, TT_PRICE[ck]), { event_id: ttEventId(event) });
          return;
        }
        var std = TT_STD[event];
        var payload = { contents: [{ content_id: event, content_type: "product", content_name: event }], description: pageName };
        if (std === "SubmitForm" || std === "CompleteRegistration") payload.content_name = event;
        if (std) window.ttq.track(std, payload, { event_id: ttEventId(event) });
        else window.ttq.track(event, Object.assign({ description: pageName }, safe), { event_id: ttEventId(event) });
      } catch (e) {}
    };

    /* Advanced Matching: почта/телефон — только SHA-256, ничего в открытом виде. */
    window.scholaryTtIdentify = function (fields) {
      try {
        if (!window.ttq || !window.crypto || !window.crypto.subtle) return;
        var out = {}, jobs = [];
        var norm = { email: function (v) { return String(v || "").trim().toLowerCase(); },
                     phone_number: function (v) { var d = String(v || "").replace(/\D/g, ""); if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1); if (d.length === 10) d = "7" + d; return d ? "+" + d : ""; },
                     external_id: function (v) { return String(v || "").trim(); } };
        var map = { email: fields.email, phone_number: fields.phone || fields.phone_number, external_id: fields.external_id };
        Object.keys(map).forEach(function (k) {
          var v = norm[k](map[k]); if (!v) return;
          jobs.push(window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)).then(function (buf) {
            out[k] = Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
          }));
        });
        Promise.all(jobs).then(function () { if (Object.keys(out).length) window.ttq.identify(out); });
      } catch (e) {}
    };

    /* Все кнопки и ссылки-действия сайта: ClickButton с текстом кнопки.
       Мессенджеры и телефон — Contact. Работает и на кнопках, которые
       страница рисует позже (делегирование на document). */
    document.addEventListener("click", function (e) {
      try {
        var el = e.target && e.target.closest && e.target.closest("a,button,[role=button],label.btn");
        if (!el) return;
        var href = (el.getAttribute && el.getAttribute("href")) || "";
        var isBtn = el.tagName === "BUTTON" || /(^|\s)(btn|btn-msg|nav-cta|nav-login|chip|tab|tabs|gbtn|btn-adm)(\s|$|-)/.test(el.className || "") || el.getAttribute("role") === "button" || el.closest(".tabs,#tabbar,.stabs,.switch,.plans");
        if (!isBtn && !/^(https?:\/\/(wa\.me|api\.whatsapp\.com|t\.me)|tel:|mailto:)/.test(href)) return;
        var text = (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
        var pageName = location.pathname.replace(/\/$/, "") || "/";
        if (/^(https?:\/\/(wa\.me|api\.whatsapp\.com|t\.me)|tel:|mailto:)/.test(href)) {
          window.ttq.track("Contact", { contents: [{ content_id: /wa\.me|whatsapp/.test(href) ? "whatsapp" : /t\.me/.test(href) ? "telegram" : /^tel:/.test(href) ? "phone" : "email", content_type: "product", content_name: text }], description: pageName }, { event_id: ttEventId("contact") });
          return;
        }
        window.ttq.track("ClickButton", { contents: [{ content_id: (el.id || href || text || "button").slice(0, 80), content_type: "product", content_name: text }], description: pageName }, { event_id: ttEventId("click") });
      } catch (err) {}
    }, true);

    /* Отправка любой формы сайта — SubmitForm (страничные события добавляют
       к этому конкретику: лид, заявка школы, регистрация). */
    document.addEventListener("submit", function (e) {
      try {
        var f = e.target; if (!f || f.tagName !== "FORM") return;
        window.ttq.track("SubmitForm", { contents: [{ content_id: f.id || "form", content_type: "product", content_name: f.id || "form" }], description: location.pathname.replace(/\/$/, "") || "/" }, { event_id: ttEventId("form") });
      } catch (err) {}
    }, true);
  } else {
    window.scholaryTt = function () {};
    window.scholaryTtIdentify = function () {};
  }

  /* Страницы без app.js (кабинеты школы и профориентолога, регистрация по
     ссылке) тоже должны слать события в пиксели и Метрику. app.js, если
     загружен позже, переопределит track() полной версией. */
  if (!window.track) {
    window.track = function (event, data) {
      try { window.scholaryTt(event, data, Object.assign({ page: location.pathname }, clean(data || {}))); } catch (e) {}
      try { window.scholaryFb(event, data, clean(data || {})); } catch (e) {}
      try { window.scholaryYm(event, clean(data || {})); } catch (e) {}
      try { if (window.posthog && window.posthog.capture) window.posthog.capture(event, Object.assign({ page: location.pathname }, clean(data || {}))); } catch (e) {}
    };
  }

  /* ---------- PostHog: продуктовая аналитика ---------- */
  if (C.POSTHOG_KEY) {
    var host = C.POSTHOG_HOST || "https://us.i.posthog.com";
    /* официальный сниппет-заглушка: копит вызовы, пока грузится библиотека */
    !function (t, e) { var o, n, p, r; e.__SV || (window.posthog = e, e._i = [], e.init = function (i, s, a) { function g(t, e) { var o = e.split("."); 2 == o.length && (t = t[o[0]], e = o[1]); t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))); }; } (p = t.createElement("script")).type = "text/javascript"; p.crossOrigin = "anonymous"; p.async = !0; p.src = (s.ui_assets || s.api_host.replace(".i.posthog.com", "-assets.i.posthog.com")) + "/static/array.js"; (r = t.getElementsByTagName("script")[0]).parentNode.insertBefore(p, r); var u = e; for (void 0 !== a ? u = e[a] = [] : a = "posthog", u.people = u.people || [], u.toString = function (t) { var e = "posthog"; return "posthog" !== a && (e += "." + a), t || (e += " (stub)"), e; }, u.people.toString = function () { return u.toString(1) + ".people (stub)"; }, o = "init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "), n = 0; n < o.length; n++) g(u, o[n]); e._i.push([i, s, a]); }, e.__SV = 1); }(document, window.posthog || []);
    try {
      window.posthog.init(C.POSTHOG_KEY, {
        api_host: host,
        ui_assets: host,            // библиотека тоже едет через наш домен
        ui_host: "https://us.posthog.com",
        person_profiles: "identified_only",
        autocapture: false,          // ловим только те события, которые назвали сами
        capture_pageview: true,
        capture_pageleave: true,
        disable_session_recording: true,
        persistence: "localStorage",  // без cookie — меньше юридических вопросов
        disable_compression: true,    // без сжатия: тело проходит через наш прокси как есть
        before_send: function (ev) {  // вырезаем персональные поля, служебные не трогаем
          try {
            if (ev && ev.properties) {
              var src = ev.properties, out = {};
              Object.keys(src).forEach(function (k) {
                // $-свойства, token и distinct_id нужны самому PostHog — без них событие отбрасывается
                if (k.charAt(0) === "$" || k === "token" || k === "distinct_id") {
                  out[k] = (typeof src[k] === "string" && /url|referrer|pathname/.test(k)) ? src[k].replace(/([?&])(t|lead)=[^&#]*/g, "$1$2=~") : src[k];
                  return;
                }
                if (PII.test(k)) return;
                out[k] = (src[k] && typeof src[k] === "object") ? clean(src[k]) : src[k];
              });
              ev.properties = out;
            }
          } catch (e) {}
          return ev;
        }
      });
    } catch (e) {}
  }
})();
