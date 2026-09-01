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
    if (!configured) { console.log("[scholary]", table, body); return; }
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
