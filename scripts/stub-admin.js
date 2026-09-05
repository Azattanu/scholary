// Заглушка для проверки дашборда: возвращает правдоподобные данные.
(function () {
  function res(data) { return Promise.resolve({ data: data, error: null }); }
  function days(n, f) { var a = [], d = new Date(); for (var i = n - 1; i >= 0; i--) { var x = new Date(d); x.setDate(d.getDate() - i); a.push(f(x.toISOString().slice(0,10), n - i)); } return a; }
  var FIX = {
    admin_ads: { platform: "tiktok", period_days: 30, spend: 152000, impressions: 210000, clicks: 3100, views: 64000, results: 27, days_with_spend: 9, last_spend_day: new Date().toISOString().slice(0,10),
      visitors: 1240, quiz_start: 410, quiz_done: 236, pay_clicks: 41, leads: 118, payments: 9, revenue: 44000,
      daily: days(30, function (d, i) { return { day: d, spend: i > 20 ? 15000 + (i % 3) * 2000 : 0, impressions: i > 20 ? 23000 : 0, clicks: i > 20 ? 340 : 0, views: i > 20 ? 7000 : 0, visitors: i > 20 ? 130 + i : 3, quiz_done: i > 20 ? 25 : 0, leads: i > 20 ? 13 : 0, payments: i > 24 ? 2 : 0, revenue: i > 24 ? 8000 : 0 }; }) },
    admin_ad_spend_list: [ { day: new Date().toISOString().slice(0,10), platform: "tiktok", campaign: "Школьники", spend: 17000, impressions: 23000, clicks: 340, views: 7000, results: 3, note: null },
      { day: new Date(Date.now()-864e5).toISOString().slice(0,10), platform: "tiktok", campaign: "", spend: 15000, impressions: 21000, clicks: 300, views: 6500, results: 2, note: null },
      { day: new Date().toISOString().slice(0,10), platform: "meta", campaign: "", spend: 5000, impressions: 9000, clicks: 100, views: 0, results: 0, note: null } ],
    admin_ad_spend_upsert: { ok: true, saved: 1 }, admin_ad_spend_delete: { ok: true, deleted: 1 },
    admin_retention: { period_days: 30, active_7d: 14, active_30d: 31, active_this_week: 12, active_this_week_2plus: 5, cohort_users: 27, d1_pct: 22, w1_pct: 41, w2_pct: 30, w3_pct: 26, w4_pct: 19, d30_pct: 33, avg_active_days: 2.4, tasks_done: 63, tasks_done_this_week: 17, avg_weeks_progress: 1.8, users_4plus_weeks: 2, badges: 40, tg_linked: 6, pro_payments: 3, pro_renewals: 1, deeplink_returns: 9,
      weekly: [{ w: "2026-08-24", wau: 6, wau2: 1, wau_progress: 3, tasks_done: 0 }, { w: "2026-08-31", wau: 11, wau2: 4, wau_progress: 7, tasks_done: 21 }, { w: "2026-09-07", wau: 12, wau2: 5, wau_progress: 8, tasks_done: 17 }] },
    admin_cab_content_list: [{ id: 1, kind: "guide", title: "Как попросить рекомендацию у учителя", url: "https://scholary.kz/", author: "Scholary", level: null, week_from: 1, week_to: 12, active: true, sort: 10 }],
    admin_cab_content_upsert: { ok: true, id: 2 }, admin_cab_content_delete: { ok: true, deleted: 1 },
    admin_dash_summary: { revenue_all: 187000, revenue_period: 121000, payments_all: 24, payments_period: 15,
      refunds_all: 2, refunded_sum: 8000, users_total: 27, users_period: 11, users_with_answers: 17, pro_active: 3,
      leads_total: 49, leads_period: 22, leads_paid: 12, leads_with_contact: 31, applications_total: 153,
      applications_submitted: 9, documents_ready: 22, reports_total: 3, telegram_linked: 4, programs_total: 108,
      events_24h: 340, period_days: 30 },
    admin_revenue_daily: days(30, function (d, i) { return { den: d, summa: (i % 5 === 0 ? 0 : (i * 700) % 19000), oplat: i % 4 === 0 ? 0 : (i % 3) }; }),
    admin_revenue_by_kind: [ { vid: "report", oplat: 9, summa: 36000 }, { vid: "package", oplat: 2, summa: 70000 },
      { vid: "pro_season", oplat: 1, summa: 14900 }, { vid: "consult", oplat: 0, summa: 0 } ],
    admin_funnel: { vsego: 812, nachali_kviz: 402, doshli_do_rezultata: 233, uvideli_paywall: 219, poshli_v_kabinet: 61, nazhali_oplatit: 38, oplatili: 12 },
    admin_sources: [ { istochnik: "instagram", kanal: "stories", kampaniya: "sentyabr", zayavok: 21, s_kontaktom: 14, oplat: 5, summa: 20000 },
      { istochnik: "прямой заход", kanal: "—", kampaniya: "—", zayavok: 18, s_kontaktom: 11, oplat: 4, summa: 55000 },
      { istochnik: "tiktok", kanal: "video", kampaniya: "—", zayavok: 10, s_kontaktom: 6, oplat: 3, summa: 46000 } ],
    admin_daily: days(30, function (d, i) { return { den: d, zayavki: (i * 3) % 7, registracii: (i * 2) % 4, nachali_kviz: (i * 5) % 11 }; }),
    admin_payments: [ { txn: "1001", lead_id: "lead_ab12cd34", user_email: "a@b.kz", amount: 4000, kind: "report", status: "success", test_mode: false, created_at: new Date().toISOString() },
      { txn: "1002", lead_id: null, user_email: "c@d.kz", amount: 14900, kind: "pro_season", status: "success", test_mode: false, created_at: new Date(Date.now()-86400000).toISOString() },
      { txn: "1003", lead_id: "lead_zz99", user_email: "e@f.kz", amount: 35000, kind: "package", status: "refunded", test_mode: false, created_at: new Date(Date.now()-3*86400000).toISOString() },
      { txn: "1004", lead_id: "lead_test", user_email: "t@t.kz", amount: 4000, kind: "report", status: "success", test_mode: true, created_at: new Date(Date.now()-4*86400000).toISOString() } ],
    admin_subscriptions: [ { email: "c@d.kz", pro_until: "2027-03-01", pro_plan: "season", aktivna: true },
      { email: "old@x.kz", pro_until: "2026-01-01", pro_plan: "month", aktivna: false } ],
    admin_top_programs_json: [ { name: "Stipendium Hungaricum", country: "Венгрия", picks: 31, submitted: 4, avg_readiness: 42 },
      { name: "EDISU Piemonte", country: "Италия", picks: 24, submitted: 2, avg_readiness: 30 },
      { name: "Türkiye Bursları", country: "Турция", picks: 19, submitted: 1, avg_readiness: 18 } ],
    admin_countries: [ { strana: "Венгрия", podach: 31, otpravleno: 4 }, { strana: "Италия", podach: 24, otpravleno: 2 }, { strana: "Турция", podach: 19, otpravleno: 1 } ],
    admin_leads: [
      { id: "l1", name: "Аида", whatsapp: "+7 701 111 22 33", level: "bachelor", field: "it", gpa_band: "4.4-4.0", ielts_band: "6.5", paid: true, paid_at: new Date().toISOString(), paid_amount: 4000, report_sent_at: null, updated_at: new Date().toISOString() },
      { id: "l2", name: "Данияр", whatsapp: "+7 702 333 44 55", level: "master", field: "eng", gpa_uni: "3.67+", ielts_band: "7+", paid: false, updated_at: new Date().toISOString() },
      { id: "l3", name: "", whatsapp: "", level: "phd", field: "sci", paid: false, updated_at: new Date().toISOString() } ],
    admin_reports: [
      { lead_id: "l1", name: "Аида", token: "abc123def456", created_at: new Date(Date.now()-3*36e5).toISOString(), level: "bachelor", programm_v_otchete: 12, est_teksty: true, report_sent_at: new Date(Date.now()-2*36e5).toISOString() },
      { lead_id: "l7", name: "Мадина", token: "zzz999yyy888", created_at: new Date(Date.now()-27*36e5).toISOString(), level: "master", programm_v_otchete: 9, est_teksty: false, report_sent_at: null },
      { lead_id: "l9", name: "Ерасыл", token: "qqq111www222", created_at: new Date(Date.now()-52*36e5).toISOString(), level: "phd", programm_v_otchete: 7, est_teksty: true, report_sent_at: new Date(Date.now()-50*36e5).toISOString() } ],
    admin_paid_without_report: [
      { lead_id: "l4", name: "Динара", whatsapp: "+7 705 444 55 66", email: "dinara@example.com", paid_at: new Date(Date.now()-9*36e5).toISOString(), paid_amount: 4000, chasov_zhdet: 9 },
      { lead_id: "l5", name: "Тимур", whatsapp: "+7 707 222 33 44", email: "", paid_at: new Date(Date.now()-31*36e5).toISOString(), paid_amount: 4000, chasov_zhdet: 31 } ],
    admin_timings: { kviz_mediana_sek: 268, kviz_p90_sek: 640, razdumya_mediana_sek: 151,
      ves_put_mediana_sek: 419, chtenie_lendinga_mediana_sek: 92, vyborka_kviz: 34, vyborka_put: 12 },
    admin_quiz_steps: [
      { shag: 1, vopros: "level", doshli: 412 }, { shag: 2, vopros: "gpa", doshli: 351 },
      { shag: 3, vopros: "lang", doshli: 307 }, { shag: 4, vopros: "field", doshli: 235 },
      { shag: 5, vopros: "budget", doshli: 205 }, { shag: 6, vopros: "achievements", doshli: 179 },
      { shag: 7, vopros: "contact", doshli: 158 } ]
  };
  window.supabase = { createClient: function () { return {
    rpc: function (fn, args) { (window.__RPC_LOG = window.__RPC_LOG || []).push({ fn: fn, args: args || {} }); return res(FIX[fn] !== undefined ? FIX[fn] : []); },
    auth: { getSession: function () { return res({ session: { access_token: "stub-token-1234567890abcdef", user: { email: "azattanu@gmail.com" } } }); },
            signOut: function () { return res(null); },
            signInWithPassword: function () { return res(null); } }
  }; } };
  var of = window.fetch;
  window.fetch = function (u, o) {
    if (String(u).indexOf('/api/health.php') >= 0) {
      return Promise.resolve({ json: function () { return Promise.resolve({ ok: true, items: [
        { title: 'Supabase — база и каталог', ok: true, note: 'отвечает, каталог читается', hint: '' },
        { title: 'Resend — письма', ok: true, note: 'ключ рабочий; подтверждённых доменов: 0; отправитель общий адрес Resend', hint: 'письма уходят с общего адреса Resend — часть попадёт в спам. Нужны DNS-записи для scholary.kz' },
        { title: 'WhatsApp (GREEN-API)', ok: false, note: 'состояние: notAuthorized', hint: 'телефон отвязался — заново отсканировать QR' },
        { title: 'Telegram-бот', ok: true, note: '@askScholary_bot', hint: '' },
        { title: 'Anthropic — разборы с ИИ', ok: true, note: 'ключ на месте', hint: '' },
        { title: 'TipTop Pay — приём оплат', ok: true, note: 'ключ подписи на месте; связь с базой настроена', hint: '' },
        { title: 'Расход ИИ за сегодня', ok: true, note: '12 из 600 общесайтового лимита', hint: '' },
        { title: 'Журнал уведомлений шлюза', ok: true, note: '18 записей за месяц', hint: '' }
      ] }); } });
    }
    return of.apply(this, arguments);
  };
})();
