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

  async function post(table, body) {
    if (!configured) { console.log("[scholary]", table, body); return; }
    try {
      await fetch(C.SUPABASE_URL + "/rest/v1/" + table, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": C.SUPABASE_ANON_KEY,
          "Authorization": "Bearer " + C.SUPABASE_ANON_KEY,
          "Prefer": "resolution=merge-duplicates"
        },
        body: JSON.stringify(body)
      });
    } catch (e) { /* не мешаем пользователю */ }
  }

  // Событие аналитики: track('quiz_step', {step: 3})
  window.track = function (event, data) {
    post("events", { lead_id: leadId(), event: event, data: data || {}, utm: utm(), ts: new Date().toISOString(), page: location.pathname });
  };

  // Сохранение/дополнение анкеты лида: saveLead({gpa_band: '4.4-4.0'})
  window.saveLead = function (fields) {
    post("leads", Object.assign({ id: leadId(), updated_at: new Date().toISOString(), utm: utm() }, fields));
  };

  window.scholaryLeadId = leadId;
})();
