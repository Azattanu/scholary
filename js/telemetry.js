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
                if (k.charAt(0) === "$" || k === "token" || k === "distinct_id") { out[k] = src[k]; return; }
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
