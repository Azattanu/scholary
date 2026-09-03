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
