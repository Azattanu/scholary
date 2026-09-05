// UI-тесты кабинета web-74: неделя сезона, задачи, путь, кольца, календарь, вехи,
// сетка документов + запрос рекомендации, Discover/фильтры/плашки, настройки недели, deep-link.
// Стенд: настоящий кабинет из build/ на 8123, Supabase подменён фейком в браузере,
// каталог — реальный (data/cab-catalog.json = programs_public на момент релиза).
// Запуск: node scripts/cab-path.mjs [scenario] ; сценарии: three | empty | one | master | jan | sep1 | many
// three — бакалавр, 3 подачи, документы наполовину, без Pro, вход 9 сентября (+ перенесённая задача с прошлой недели, 768 px)
// empty — пустой кабинет · one — 1 подача, вход 15 ноября, Pro · master — магистр, 20 октября, Pro
// jan — 20 января, всё собрано · sep1 — магистр, 1 сентября (граница сезона) · many — 12 документов, длинные имена файлов, 1 декабря
import { chromium } from "/home/user/scholary/site/node_modules/playwright/index.mjs";
import fs from "fs";
import path from "path";

const BASE = "http://127.0.0.1:8123";
const only = process.argv[2] || null;
const CAT_PATH = fs.existsSync("/tmp/claude-0/cat/live_public_after.json") ? "/tmp/claude-0/cat/live_public_after.json" : path.resolve("data/cab-catalog.json");
const catalog = JSON.parse(fs.readFileSync(CAT_PATH, "utf8"));
fs.mkdirSync("/tmp/claude-0/shots", { recursive: true });

const SCEN = {
  three:  { now: "2026-09-09T10:00:00", level: "bachelor", apps: 3, docs: "mid", pro: false },
  empty:  { now: "2026-09-09T10:00:00", level: "bachelor", apps: 0, docs: "none", pro: false, noAuto: true },
  one:    { now: "2026-11-15T10:00:00", level: "bachelor", apps: 1, docs: "none", pro: true },
  master: { now: "2026-10-20T10:00:00", level: "master", apps: 3, docs: "mid", pro: true },
  jan:    { now: "2027-01-20T10:00:00", level: "bachelor", apps: 3, docs: "done", pro: false },
  sep1:   { now: "2026-09-01T09:00:00", level: "master", apps: 1, docs: "none", pro: false },
  many:   { now: "2026-12-01T10:00:00", level: "bachelor", apps: 3, docs: "many", pro: true }
};

function stubFor(sc) {
  return `
window.__SCHOLARY_NOW = ${JSON.stringify(sc.now)};
window.__CATALOG = ${JSON.stringify(catalog)};
window.__SC = ${JSON.stringify(sc)};
window.__CALLS = { rpc: [], upserts: [], inserts: [], updates: [] };
(function () {
  const sc = window.__SC, now = new Date(window.__SCHOLARY_NOW);
  const cat = window.__CATALOG.filter(p => p.available_kz !== false && !p.duplicate_of);
  function md(daysAhead) { const d = new Date(now.getTime() + daysAhead * 864e5); return String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  // три программы уровня с контролируемыми дедлайнами: через 10, 40 и 120 дней
  const lvlProgs = cat.filter(p => (p.levels || []).indexOf(sc.level) >= 0 && (p.cc || "") !== "ru");
  const picks = [lvlProgs[0], lvlProgs[5], lvlProgs[10]].filter(Boolean);
  const ahead = [10, 40, 120];
  picks.forEach((p, i) => { p.deadline_md = md(ahead[i]); p.deadline = "тест"; });
  const apps = picks.slice(0, sc.apps).map((p, i) => ({ id: i + 1, user_id: "u1", program_id: p.id, status: i === 0 ? "prep" : "study", checklist: {}, added_at: new Date(now.getTime() - 20 * 864e5).toISOString(), updated_at: new Date(now.getTime() - 20 * 864e5).toISOString(), submitted_at: null }));
  const docsMid = [
    { id: 11, user_id: "u1", doc_type: "diploma", title: "Диплом", status: "ready", fields: { gpa: "4.2", lang: "ru" }, program_ids: [], verdicts: [], version: 1, file_path: "u1/x.pdf", file_name: "attestat.pdf", updated_at: new Date(now.getTime() - 2 * 864e5).toISOString() },
    { id: 12, user_id: "u1", doc_type: "ielts", title: "IELTS", status: "progress", fields: { band: "6.0" }, program_ids: [], verdicts: [], version: 1, updated_at: new Date(now.getTime() - 1 * 864e5).toISOString() },
    { id: 13, user_id: "u1", doc_type: "passport", title: "Паспорт", status: "none", fields: {}, program_ids: [], verdicts: [], version: 1 },
    { id: 14, user_id: "u1", doc_type: "motivation", title: "Мотивационное письмо", status: "progress", fields: {}, program_ids: [picks[0] && picks[0].id], verdicts: [], version: 3, content: "Уважаемая комиссия, ".repeat(20), score: 6.2, updated_at: new Date(now.getTime() - 1 * 864e5).toISOString() }
  ];
  const longName = "Очень_длинное_имя_файла_которое_должно_обрезаться_а_не_ломать_сетку_карточек_документов_на_телефоне_2026.pdf";
  const docsMany = docsMid.concat(["translation", "apostille", "recommendation", "cv", "medical", "income", "photo", "finance"].map((t, i) => ({ id: 20 + i, user_id: "u1", doc_type: t, title: "Документ с очень длинным названием, которое не должно ломать сетку " + t, status: i % 3 === 0 ? "ready" : i % 3 === 1 ? "progress" : "none", fields: {}, program_ids: [], verdicts: [], version: 1, file_path: i % 3 === 0 ? "u1/" + longName : null, file_name: i % 3 === 0 ? longName : null, updated_at: new Date(now.getTime() - i * 864e5).toISOString() })));
  const docs = sc.docs === "none" ? [] : sc.docs === "done" ? docsMid.map(d => Object.assign({}, d, { status: "ready" })) : sc.docs === "many" ? docsMany : docsMid;
  const profile = { user_id: "u1", name: "Айгерим Сериковна", whatsapp: "+77753831836", pro_until: sc.pro ? new Date(now.getTime() + 20 * 864e5).toISOString() : null, cab: { goal: 3 },
    answers: { level: sc.level, year: "2027", gpa_band: "4.4-4.0", gpa_uni: "3.67+", lang_status: "soon", ielts_band: "6.0", field: ["it", "eng"], achievements: ["rep_olymp", "project"], budget: "0", priority: "scholarship" } };
  const wsMon = (function () { const d = new Date(now); d.setHours(0,0,0,0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; })();
  const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const activity = [];
  for (let w = 1; w <= 3; w++) { const d = new Date(wsMon); d.setDate(d.getDate() - 7 * w + 2); activity.push({ day: iso(d), progress: true, actions: 3 }); }
  const prevMon = iso(new Date(wsMon.getTime() - 7 * 864e5));
  const tasks = sc.apps === 3 && sc.level === "bachelor" && sc.docs === "mid" ? [{ task_key: prevMon + ":letter:3:draft", status: "moved", when_day: null, week_start: prevMon, title: "Черновик письма для третьей программы" }] : [];
  const cabState = { tasks, activity: sc.apps ? activity : [], ach: sc.apps ? [{ key: "first_app", earned_at: now.toISOString() }] : [],
    content: [{ id: 1, kind: "guide", title: "Как попросить рекомендацию у учителя", url: "https://scholary.kz/", body: "Готовый текст письма и три правила вежливого напоминания", author: "Scholary", level: null, week_from: null, week_to: null, sort: 10 }] };

  function res(data) { return Promise.resolve({ data: data, error: null }); }
  function q(data, table) {
    const api = {
      select: function () { return api; }, eq: function () { return api; }, order: function () { return api; }, limit: function () { return api; }, gte: function () { return api; },
      maybeSingle: function () { return res(Array.isArray(data) ? (data[0] || null) : data); },
      single: function () { return res(Array.isArray(data) ? (data[0] || null) : data); },
      insert: function (rows) { window.__CALLS.inserts.push({ table, rows }); if (table === "portfolio_items" && sc.noAuto) return q([], table); const r = Array.isArray(rows) ? rows.map((x, i) => Object.assign({ id: 900 + i }, x)) : Object.assign({ id: 901 }, rows); if (table === "user_documents") docs.push(r); return q(r, table); },
      upsert: function (row) { window.__CALLS.upserts.push({ table, row }); return q(row, table); },
      update: function (patch) { window.__CALLS.updates.push({ table, patch }); if (table === "profiles") Object.assign(profile, patch); return q(data, table); },
      then: function (a, b) { return res(data).then(a, b); }
    };
    return api;
  }
  const TABLES = { profiles: profile, portfolio_items: apps, user_documents: docs, programs_public: cat, probability_history: [], tg_links: sc.pro ? { user_id: "u1", chat_id: "1", prefs: { digest: true } } : null, cab_task_state: [], cab_achievements: [] };
  window.supabase = { createClient: function () { return {
    from: function (t) { return q(TABLES[t] !== undefined ? TABLES[t] : [], t); },
    rpc: function (fn, args) { window.__CALLS.rpc.push({ fn, args }); if (fn === "cab_state") return res(cabState); if (fn === "cab_touch") return res({ ok: true, day: iso(now), progress: !!(args && args.p_progress) }); if (fn === "my_reports") return res([]); if (fn === "school_for_student") return res(null); return res(null); },
    storage: { from: function () { return { upload: function () { return res({ path: "u1/new.pdf" }); }, createSignedUrl: function () { return res({ signedUrl: "about:blank" }); } }; } },
    auth: {
      getSession: function () { return res({ session: { user: { id: "u1", email: "test@scholary-test.kz", user_metadata: { name: "Айгерим" } } } }); },
      onAuthStateChange: function (cb) { setTimeout(function () { cb("SIGNED_IN", { user: { id: "u1", email: "test@scholary-test.kz", user_metadata: { name: "Айгерим" } } }); }, 30); return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: function () { return res({}); }
    }
  }; } };
  // фиксируем «сегодня» для всего кода страницы
  const RealDate = Date; const fixed = new RealDate(window.__SCHOLARY_NOW).getTime();
  window.Date = class extends RealDate { constructor(...a) { if (a.length === 0) super(fixed); else super(...a); } static now() { return fixed; } };
})();
`;
}

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell" });
let fails = 0;
const ok = (c, m) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) fails++; };
async function openCab(sc, w, h, query) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  p.on("console", m => { const t = m.text(); if (m.type() === "error" && !/ERR_FAILED|Failed to load resource|integrity|net::/.test(t)) errs.push("console: " + t.slice(0, 160)); });
  await p.route(/supabase\.co|mc\.yandex|posthog|sentry|facebook|google|tiktok|scholary\.kz/, r => r.abort());
  await p.route(/supabase-js@.*umd\/supabase(\.min)?\.js/, r => r.fulfill({ body: "/* stubbed */", contentType: "application/javascript" }));
  await p.addInitScript(stubFor(sc));
  await p.route(/cabinet\.html/, async r => { const res = await r.fetch(); let body = await res.text(); body = body.replace(/ integrity="[^"]*"/g, ""); await r.fulfill({ body, contentType: "text/html; charset=utf-8" }); });
  await p.goto(BASE + "/cabinet.html" + (query || ""), { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1800);
  return { p, errs };
}
async function tab(p, t) { await p.locator(`.tabbar [data-tab="${t}"]`).first().click(); await p.waitForTimeout(500); }
async function noHScroll(p) { return !(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)); }
async function twoLineButtons(p) {
  return p.evaluate(() => [...document.querySelectorAll(".btn, .chip, .when, .tabbar button")].filter(el => el.offsetParent && el.offsetWidth > 0).filter(el => {
    const cs = getComputedStyle(el); const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
    const inner = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    return inner > lh * 1.7 && !el.classList.contains("dcard") && !el.closest(".tabbar") && !el.classList.contains("ring3");
  }).map(el => el.textContent.trim().slice(0, 40)));
}

for (const [name, sc] of Object.entries(SCEN)) {
  if (only && only !== name) continue;
  for (const [w, h, tag] of (name === "three" ? [[390, 844, "m"], [768, 1024, "t"], [1440, 900, "d"]] : [[390, 844, "m"], [1440, 900, "d"]])) {
    const { p, errs } = await openCab(sc, w, h);
    const T = `${name}/${tag}`;
    if (tag === "t") {   // планшет: только каркас, без сценариев кликов
      const ttxt = await p.locator("#tab-today").innerText();
      ok(/Неделя \d+ из 44/.test(ttxt) && (await p.locator("#tab-today .task").count()) >= 2, `${T}: 768 px — неделя и задачи`);
      ok(await noHScroll(p), `${T}: 768 px — без горизонтального скролла`);
      for (const tb of ["docs", "unis", "profile"]) { await tab(p, tb); ok(await noHScroll(p), `${T}: 768 px — ${tb} без горизонтального скролла`); }
      const twoLineT = await twoLineButtons(p); ok(twoLineT.length === 0, `${T}: 768 px — кнопки в одну строку`);
      ok(errs.length === 0, `${T}: 768 px — без JS-ошибок ${JSON.stringify(errs.slice(0, 2))}`);
      await p.screenshot({ path: `/tmp/claude-0/shots/cab74-today-${name}-t.png`, fullPage: true });
      await p.close(); continue;
    }
    const txt = await p.locator("#tab-today").innerText();
    ok(/Неделя \d+ из 44/.test(txt), `${T}: заголовок недели сезона (${(txt.match(/Неделя \d+ из 44 · [^·\n]+/) || [""])[0]})`);
    const nTasks = await p.locator("#tab-today .task").count();
    ok(nTasks >= 2 && nTasks <= 6, `${T}: задач недели 2–6 (${nTasks})`);
    ok(/Задачи недели/i.test(txt) && /\d из \d/.test(txt), `${T}: блок «Задачи недели» с целью`);
    ok(/Пройдено \d+% пути/.test(txt), `${T}: прогресс пути (${(txt.match(/Пройдено \d+% пути/) || [""])[0]})`);
    const ringsWhere = tag === "d" ? "#side-widget" : "#tab-today";
    ok((await p.locator(ringsWhere + " .ring3").count()) === 3, `${T}: три кольца готовности (${tag === "d" ? "справа" : "в колонке"})`);
    const calWhere = tag === "d" ? "#side-widget" : "#tab-today";
    ok((await p.locator(calWhere + " .cal-d:not(.empty)").count()) >= 28, `${T}: календарь месяца отрисован`);
    if (sc.apps) ok((await p.locator(calWhere + " .cal-d.has").count()) >= 1, `${T}: в календаре есть точки дедлайнов`);
    ok((await p.locator(calWhere + " .cal-d.today").count()) === 1, `${T}: сегодня подсвечено`);
    const powWhere = tag === "d" ? "#side-widget" : "#tab-today";
    ok(/Стипендия недели/i.test(await p.locator(powWhere).innerText()), `${T}: «Стипендия недели» из каталога`);
    ok(/Совет недели|Совет · по твоим данным/i.test(await p.locator(powWhere).innerText()), `${T}: совет недели`);
    ok(/Материалы недели/i.test(await p.locator(powWhere).innerText()), `${T}: материалы недели (из cab_content)`);
    if (sc.apps) ok(/Вехи/i.test(txt) && /Первая программа/.test(txt), `${T}: вехи показаны`);
    if (sc.apps >= 3) { const expStreak = sc.now.indexOf("2026-09") === 0 ? 1 : 3; ok(new RegExp(expStreak + " недел[ия] с прогрессом подряд").test(txt), `${T}: недели с прогрессом (${expStreak} подряд — активность до 1 сентября в сезон не входит)`); }
    if (name === "three") {
      ok(/Продолжить с места остановки/.test(txt) && /Мотивационное/.test(txt), `${T}: карточка «Продолжить» (письмо в работе)`);
      ok(/Проверить пакет и отправить/.test(txt), `${T}: задача «отправить» для подачи через 10 дней`);
    }
    if (name === "empty") ok(/Выбрать первые 3 программы/.test(txt), `${T}: пустой кабинет → задача «выбрать 3 программы»`);
    if (name === "three") ok(/Перенесено с прошлой недели/.test(txt) && /Черновик письма для третьей программы/.test(txt), `${T}: перенесённая задача с прошлой недели в плане`);
    if (name === "sep1") ok(/Неделя 1 из 44/.test(txt), `${T}: 1 сентября — неделя 1 (граница сезона)`);
    // Pro / не-Pro: карточка подписки на «Сегодня»
    ok(sc.pro ? /Scholary Pro активна/.test(txt) : /Pro/.test(txt) && !/Scholary Pro активна/.test(txt), `${T}: ${sc.pro ? "Pro активна — без продажи" : "без Pro — предложение Pro"}`);
    if (name === "master") ok(/черновик|Рекомендател/i.test(txt), `${T}: магистр в октябре — тема «первый черновик письма»`);
    // задачи: отметить, снять, «когда», меню
    const firstKey = await p.locator("#tab-today .task").first().getAttribute("data-key");
    await p.locator(`#tab-today .task[data-key="${firstKey}"] [data-act="task-done"]`).click(); await p.waitForTimeout(400);
    let calls = await p.evaluate(() => window.__CALLS);
    ok(calls.upserts.some(u => u.table === "cab_task_state" && u.row.task_key === firstKey && u.row.status === "done"), `${T}: отметка задачи сохранена в cab_task_state`);
    ok(calls.rpc.some(r => r.fn === "cab_touch" && r.args && r.args.p_progress === true), `${T}: cab_touch(progress) вызван`);
    ok((await p.locator(`#tab-today .task[data-key="${firstKey}"]`).getAttribute("class")).includes("done"), `${T}: задача зачёркнута`);
    ok(/1 из 3|Неделя засчитана/.test(await p.locator("#tab-today").innerText()), `${T}: счётчик «1 из 3» / неделя засчитана`);
    await p.locator(`#tab-today .task[data-key="${firstKey}"] [data-act="task-done"]`).click(); await p.waitForTimeout(300);
    ok(!(await p.locator(`#tab-today .task[data-key="${firstKey}"]`).getAttribute("class")).includes("done"), `${T}: отметку можно снять`);
    await p.locator(`#tab-today .task[data-key="${firstKey}"] [data-act="task-when"]`).click(); await p.waitForTimeout(300);
    ok((await p.locator(".modal [data-w]").count()) === 7, `${T}: модалка «когда» — 7 дней`);
    await p.locator(".modal [data-w='3']").click(); await p.waitForTimeout(300);
    ok(/ср/.test(await p.locator(`#tab-today .task[data-key="${firstKey}"] .when`).innerText()), `${T}: день недели назначен (ср)`);
    await p.locator(`#tab-today .task[data-key="${firstKey}"] [data-act="task-menu"]`).click(); await p.waitForTimeout(300);
    await p.locator(".modal [data-m='skip']").click(); await p.waitForTimeout(300);
    ok((await p.locator(`#tab-today .task[data-key="${firstKey}"]`).getAttribute("class")).includes("skipped"), `${T}: «не актуально» убирает задачу без окраски провала`);
    await p.locator(`#tab-today .task[data-key="${firstKey}"] [data-act="task-undo"]`).click(); await p.waitForTimeout(300);
    ok(!(await p.locator(`#tab-today .task[data-key="${firstKey}"]`).getAttribute("class")).includes("skipped"), `${T}: задачу можно вернуть`);
    await p.locator(`#tab-today .task[data-key="${firstKey}"] [data-act="task-menu"]`).click(); await p.waitForTimeout(300);
    await p.locator(".modal [data-m='move']").click(); await p.waitForTimeout(300);
    calls = await p.evaluate(() => window.__CALLS);
    ok(calls.upserts.some(u => u.table === "cab_task_state" && u.row.task_key === firstKey && u.row.status === "moved" && u.row.title), `${T}: «перенести» сохраняет moved с названием`);
    ok(/перенесено на следующую неделю/.test(await p.locator(`#tab-today .task[data-key="${firstKey}"]`).innerText()), `${T}: перенесённая задача помечена, не окрашена провалом`);
    await p.locator(`#tab-today .task[data-key="${firstKey}"] [data-act="task-undo"]`).click(); await p.waitForTimeout(300);
    ok(!calls.inserts.some(i => i.table === "cab_achievements" && i.rows.key === "first_app"), `${T}: уже полученная веха не выдаётся повторно`);
    const achKeys = calls.inserts.filter(i => i.table === "cab_achievements").map(i => i.rows.key);
    ok(achKeys.length === new Set(achKeys).size, `${T}: каждая веха выдаётся один раз (${achKeys.join(",") || "новых нет"})`);
    // тихая неделя и цель
    await p.locator('#tab-today [data-act="quiet-week"]').click(); await p.waitForTimeout(300);
    ok(/Тихая неделя/.test(await p.locator("#tab-today").innerText()), `${T}: пауза недели включается`);
    calls = await p.evaluate(() => window.__CALLS);
    ok(calls.updates.some(u => u.table === "profiles" && u.patch.cab && Array.isArray(u.patch.cab.quiet)), `${T}: пауза сохранена в profiles.cab`);
    await p.locator('#tab-today [data-act="quiet-week"]').click(); await p.waitForTimeout(200);
    await p.locator('#tab-today [data-act="week-goal"]').click(); await p.waitForTimeout(200);
    await p.locator(".modal [data-g='4']").click(); await p.waitForTimeout(300);
    ok(/из 4/.test(await p.locator("#tab-today").innerText()), `${T}: цель недели изменена на 4`);
    // календарь: навигация и выбор дня
    await p.locator(calWhere + ' [data-act="cal-next"]').click(); await p.waitForTimeout(300);
    const calTxt = await p.locator(calWhere + " .cal-head b").innerText();
    ok(!/Сентябрь 2026/.test(calTxt) || sc.now.indexOf("2026-09") < 0, `${T}: следующий месяц (${calTxt})`);
    await p.locator(calWhere + ' [data-act="cal-prev"]').click(); await p.waitForTimeout(200);
    const hasDay = p.locator(calWhere + " .cal-d.has").first();
    if (await hasDay.count()) { await hasDay.click(); await p.waitForTimeout(300); ok((await p.locator(calWhere + " .cal-sel .lst").count()) >= 1, `${T}: тап по дню показывает программы`); }
    ok(await noHScroll(p), `${T}: без горизонтального скролла (Сегодня)`);
    await p.screenshot({ path: `/tmp/claude-0/shots/cab74-today-${name}-${tag}.png`, fullPage: true });

    // ---- Документы ----
    await tab(p, "docs");
    const dtxt = await p.locator("#tab-docs").innerText();
    if (sc.apps) {
      ok((await p.locator("#tab-docs .dcard").count()) >= 4, `${T}: сетка карточек документов (${await p.locator("#tab-docs .dcard").count()})`);
      if (name === "many") {
        ok((await p.locator("#tab-docs .dcard").count()) >= 10, `${T}: 12 документов — сетка из ${await p.locator("#tab-docs .dcard").count()} карточек`);
        const wide = await p.evaluate(() => [...document.querySelectorAll("#tab-docs .dcard")].filter(c => c.scrollWidth > c.clientWidth + 2).length);
        ok(wide === 0, `${T}: длинные названия не вылезают из карточек (${wide})`);
        const hs = await p.evaluate(() => { const cs = [...document.querySelectorAll("#tab-docs .dcard")].map(c => c.getBoundingClientRect().height); return { min: Math.min(...cs), max: Math.max(...cs) }; });
        ok(hs.max - hs.min < 80, `${T}: карточки одной высоты в ряду (${Math.round(hs.min)}–${Math.round(hs.max)} px)`);
      }
      ok(/Собрано \d+ из \d+/.test(dtxt) && /цепочка/i.test(dtxt), `${T}: общая картина: собрано + критический путь`);
      ok(/Попросить рекомендацию/.test(dtxt) || sc.level === "bachelor", `${T}: карточка «Попросить рекомендацию» (магистр) / не требуется`);
      if (/Попросить рекомендацию/.test(dtxt)) {
        await p.locator('#tab-docs [data-act="rec-request"]').click(); await p.waitForTimeout(400);
        const rt = await p.locator("#rec-text").inputValue();
        ok(/рекомендательное письмо/.test(rt) && /до /.test(rt), `${T}: шаблон письма учителю с программой и датой`);
        await p.locator('[data-act="rec-lang"][data-v="en"]').click(); await p.waitForTimeout(300);
        ok(/letter of recommendation/.test(await p.locator("#rec-text").inputValue()), `${T}: английская версия письма`);
        await p.locator('[data-act="rec-mark"]').click(); await p.waitForTimeout(500);
        calls = await p.evaluate(() => window.__CALLS);
        ok(calls.updates.some(u => u.table === "user_documents" && u.patch.fields && u.patch.fields.requested_at) || calls.inserts.some(i => i.table === "user_documents" && i.rows.doc_type === "recommendation"), `${T}: «запрошено» сохранено в документе`);
        await p.locator('[data-act="back"]').first().click(); await p.waitForTimeout(400);
      }
    } else {
      ok((await p.locator("#tab-docs .dcard").count()) >= 5 && /Типовой набор/.test(dtxt), `${T}: без подач — типовой набор с честной пометкой`);
    }
    ok(await noHScroll(p), `${T}: без горизонтального скролла (Документы)`);
    await p.screenshot({ path: `/tmp/claude-0/shots/cab74-docs-${name}-${tag}.png`, fullPage: true });

    // ---- Вузы ----
    await tab(p, "unis");
    let utxt = await p.locator("#tab-unis").innerText();
    ok(/Discover/.test(utxt) && /Все программы/.test(utxt), `${T}: сегмент Discover / Все программы`);
    const nCols = await p.locator("#tab-unis .disc-row").count();
    ok(nCols >= 4, `${T}: подборок Discover ≥ 4 (${nCols})`);
    ok(/Полное покрытие/.test(utxt) && /Дедлайн в этом месяце|Без IELTS/.test(utxt), `${T}: подборки «Полное покрытие», «Дедлайн/Без IELTS»`);
    ok((await p.locator("#tab-unis .badge").count()) >= 5, `${T}: плашки на карточках`);
    ok(!/🇷🇺/.test(utxt), `${T}: программ РФ в подборках нет`);
    await p.screenshot({ path: `/tmp/claude-0/shots/cab74-discover-${name}-${tag}.png`, fullPage: true });
    await p.locator('#tab-unis [data-act="disc-col"][data-v="free"]').first().click(); await p.waitForTimeout(500);
    ok((await p.locator("#tab-unis .prog").count()) >= 10, `${T}: подборка «0 ₸» открыта списком (${await p.locator("#tab-unis .prog").count()})`);
    await p.locator('#tab-unis [data-act="disc-back"]').click(); await p.waitForTimeout(300);
    await p.locator('#tab-unis [data-act="unimode"][data-v="all"]').click(); await p.waitForTimeout(400);
    const allN = await p.locator("#tab-unis .prog").count();
    ok(allN >= 10, `${T}: «Все программы» — список (${allN})`);
    ok((await p.locator('#tab-unis [data-act="unicc"]').count()) >= 8, `${T}: страны-фильтры из каталога`);
    await p.locator('#tab-unis [data-act="unidl"][data-v="3m"]').click(); await p.waitForTimeout(400);
    const dlN = await p.locator("#tab-unis .prog").count();
    ok(dlN < allN, `${T}: фильтр «дедлайн в 3 месяца» сужает список (${dlN} < ${allN})`);
    await p.locator('#tab-unis [data-act="unisort"][data-v="deadline"]').click(); await p.waitForTimeout(300);
    ok(/сортировка/.test(await p.locator("#tab-unis").innerText()), `${T}: сортировка по дедлайну`);
    await p.locator('#tab-unis [data-act="unibudget"]').click(); await p.waitForTimeout(300);
    await p.locator('#tab-unis [data-act="uniielts"]').click(); await p.waitForTimeout(300);
    utxt = await p.locator("#tab-unis").innerText();
    ok(/программ|Под эти фильтры ничего нет/.test(utxt), `${T}: комбинация фильтров не ломает экран`);
    await p.locator('#tab-unis [data-act="unireset"], #tab-unis [data-act="unibudget"]').first().click(); await p.waitForTimeout(200);
    ok(await noHScroll(p), `${T}: без горизонтального скролла (Вузы)`);
    await p.screenshot({ path: `/tmp/claude-0/shots/cab74-unis-${name}-${tag}.png`, fullPage: true });

    // ---- Профиль ----
    await tab(p, "profile");
    const ptxt = await p.locator("#tab-profile").innerText();
    ok(/Моя неделя/.test(ptxt) && /Цель недели/.test(ptxt), `${T}: настройки недели в профиле`);
    if (sc.pro) ok(/Дайджест недели в Telegram/.test(ptxt), `${T}: настройки дайджеста при привязанном Telegram`);
    const twoLine = await twoLineButtons(p);
    ok(twoLine.length === 0, `${T}: кнопки в одну строку ${twoLine.length ? JSON.stringify(twoLine.slice(0, 3)) : ""}`);
    await tab(p, "today");
    const twoLine2 = await twoLineButtons(p);
    ok(twoLine2.length === 0, `${T}: кнопки в одну строку (Сегодня) ${twoLine2.length ? JSON.stringify(twoLine2.slice(0, 3)) : ""}`);
    ok(errs.length === 0, `${T}: без JS-ошибок ${JSON.stringify(errs.slice(0, 2))}`);
    await p.close();
  }
}

// deep-link из Telegram: ?tab=unis&d=free&from=tg → вкладка «Вузы», подборка «0 ₸»
if (!only || only === "three") {
  const { p, errs } = await openCab(SCEN.three, 390, 844, "?tab=unis&d=free&from=tg");
  const t = await p.locator("#tab-unis").innerText();
  ok(!(await p.locator("#tab-unis").isHidden()) && /Полное покрытие/.test(t) && (await p.locator("#tab-unis .prog").count()) >= 10, "deep-link: открыта вкладка «Вузы» с подборкой «0 ₸»");
  ok(await p.evaluate(() => location.search === ""), "deep-link: адрес очищен после перехода");
  ok(errs.length === 0, "deep-link: без JS-ошибок");
  await p.close();
  const r2 = await openCab(SCEN.three, 390, 844, "?tab=docs");
  ok(!(await r2.p.locator("#tab-docs").isHidden()), "deep-link ?tab=docs открывает документы");
  await r2.p.close();
}
await b.close();
console.log(fails ? "FAILED " + fails : "ALL OK");
process.exit(fails ? 1 : 0);
