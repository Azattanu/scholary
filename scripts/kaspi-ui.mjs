// UI-тесты оплаты через Kaspi: квиз (пейволл → счёт → ожидание → успех/ошибки) и кабинет (Pro).
// /api/kaspi.php мокируется прямо в браузере, сценарии статусов задаются в тесте.
import { chromium } from "/home/user/scholary/site/node_modules/playwright/index.mjs";
const base = "http://127.0.0.1:8123";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell" });
let fails = 0;
const ok = (c, m) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// мок ApiPay-бэкенда: create отвечает по script.create, status — по очереди script.statuses
function mockKaspi(p, script, calls) {
  return p.route(/\/api\/kaspi\.php/, async r => {
    const u = new URL(r.request().url());
    if (u.searchParams.get("a") === "create") {
      let body = {}; try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
      calls.push({ a: "create", body });
      const c = typeof script.create === "function" ? script.create(body) : script.create;
      return r.fulfill({ status: c.http || 200, contentType: "application/json", body: JSON.stringify(c.json || c) });
    }
    if (u.searchParams.get("a") === "status") {
      calls.push({ a: "status", o: u.searchParams.get("o") });
      const st = script.statuses.length > 1 ? script.statuses.shift() : script.statuses[0];
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(Object.assign({ ok: true, order: u.searchParams.get("o"), kind: "report", amount: 4000, error_code: "", error_message: "", age: 5, fulfilled: false }, st)) });
    }
    return r.fulfill({ status: 400, body: "{}" });
  });
}

async function toPayment(p) {
  await p.route(/supabase\.co|tiptoppay|mc\.yandex|posthog|sentry|facebook|google|tiktok/, r => r.abort());
  await p.route(/\/api\/(notify|ph)\.php/, r => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await p.goto(base + "/quiz/", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(500);
  for (let i = 0; i < 8; i++) {
    const q = await p.locator(".quiz-q").first().textContent().catch(() => "");
    if (/Куда прислать/.test(q)) break;
    for (let k = 0; k < 8; k++) {
      const box = p.locator("#screen .opts:not(:has(.selected)), #screen .chips:not(:has(.selected))").first();
      if (!(await box.count())) break;
      await box.locator("button").first().click(); await p.waitForTimeout(100);
    }
    const next = p.locator("#screen .quiz-nav .btn-primary, #screen button.btn-primary").last();
    if (await next.count()) { await next.click().catch(() => {}); await p.waitForTimeout(200); }
  }
  await p.fill("#fName", "Айгуль");
  const wa = p.locator("#fWa"); await wa.click(); await wa.type("87753831836", { delay: 10 });
  await p.locator("#screen .quiz-nav .btn-primary").click(); await p.waitForTimeout(600);
  await p.click("#toPay"); await p.waitForTimeout(300);
}

for (const [w, h, tag] of [[390, 844, "m"], [1440, 900, "d"]]) {
  // ---------- 1. успешная оплата ----------
  {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const errors = []; p.on("pageerror", e => errors.push(e.message));
    const calls = [];
    await mockKaspi(p, { create: { ok: true, order: "k0123456789abcdef", status: "processing", amount: 4000, phone: "77753831836" },
      statuses: [{ status: "processing" }, { status: "pending" }, { status: "paid", fulfilled: true }] }, calls);
    await toPayment(p);
    const txt = await p.locator("#screen").textContent();
    ok(/Оплатить через Kaspi/.test(txt) && !/Оплатить картой/.test(txt), tag + ": на экране оплаты кнопка Kaspi (карта скрыта в test-режиме)");
    ok(/Счёт придёт в приложение Kaspi на номер \+7 775 383 18 36/.test(txt), tag + ": подпись с номером под кнопкой");
    // без почты — ошибка, счёт не создаём
    await p.click("#payKaspi"); await p.waitForTimeout(300);
    ok(calls.filter(c => c.a === "create").length === 0 && await p.locator("#fEmailHint.is-error").count() === 1, tag + ": без почты счёт не выставляется, поле подсвечено");
    await p.fill("#fEmail", "aigul@gmail.com"); await p.locator("#fEmail").dispatchEvent("change");
    await p.click("#payKaspi"); await p.waitForTimeout(400);
    const cr = calls.find(c => c.a === "create");
    ok(cr && cr.body.kind === "report" && cr.body.phone === "+77753831836" && cr.body.email === "aigul@gmail.com" && /^[A-Za-z0-9_-]{8,}$/.test(cr.body.lead), tag + ": create с kind/phone/email/lead " + JSON.stringify(cr && cr.body));
    let t2 = await p.locator("#screen").textContent();
    ok(/Счёт отправлен в Kaspi/.test(t2) && /\+7 775 383 18 36/.test(t2) && /Платежи → Счета/.test(t2), tag + ": экран ожидания с инструкцией и номером");
    await p.screenshot({ path: `/tmp/claude-0/shots/kaspi-wait-${tag}.png` });
    const leadBefore = cr.body.lead;
    await p.waitForFunction(() => /ждём оплату/.test(document.querySelector("#screen").textContent), null, { timeout: 9000 }).catch(() => {});
    t2 = await p.locator("#screen").textContent();
    ok(/Счёт выставлен — ждём оплату/.test(t2), tag + ": после pending — «ждём оплату»");
    await p.waitForFunction(() => /Оплата прошла/.test(document.querySelector("#screen").textContent), null, { timeout: 9000 }).catch(() => {});
    t2 = await p.locator("#screen").textContent();
    ok(/Оплата прошла/.test(t2) && /aigul@gmail\.com/.test(t2), tag + ": paid → экран «Оплата прошла» с почтой");
    const nStatus = calls.filter(c => c.a === "status").length;
    await p.waitForTimeout(3500);
    ok(calls.filter(c => c.a === "status").length === nStatus, tag + ": после paid опрос остановлен");
    ok(await p.evaluate(() => localStorage.getItem("scholary_lead_id")) !== leadBefore && await p.evaluate(() => localStorage.getItem("scholary_quiz_v1")) === null, tag + ": лид и ответы сброшены после покупки (следующий квиз — новый лид)");
    await p.screenshot({ path: `/tmp/claude-0/shots/kaspi-success-${tag}.png` });
    ok(errors.length === 0, tag + ": без JS-ошибок " + JSON.stringify(errors));
    await p.close();
  }
  // ---------- 2. номер не в Kaspi → другой номер ----------
  {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const calls = [];
    await mockKaspi(p, { create: { ok: true, order: "k0123456789abcdef", status: "processing", amount: 4000 },
      statuses: [{ status: "error", error_code: "client_not_found", error_message: "Этот номер телефона не зарегистрирован в Kaspi." }] }, calls);
    await toPayment(p);
    await p.fill("#fEmail", "aigul@gmail.com"); await p.locator("#fEmail").dispatchEvent("change");
    await p.click("#payKaspi"); await p.waitForTimeout(3200);
    const t = await p.locator("#screen").textContent();
    ok(/не зарегистрирован в Kaspi/.test(t) && /Указать другой номер/.test(t), tag + ": client_not_found → понятный экран + «Указать другой номер»");
    await p.screenshot({ path: `/tmp/claude-0/shots/kaspi-nokaspi-${tag}.png` });
    await p.click("#kaspiRetry"); await p.waitForTimeout(300);
    ok(!(await p.locator("#waEditBox").isHidden()), tag + ": вернулись на оплату с открытым редактором номера");
    await p.fill("#fWa2", ""); await p.locator("#fWa2").type("87011112233", { delay: 10 }); await p.click("#waSaveBtn"); await p.waitForTimeout(200);
    await p.click("#payKaspi"); await p.waitForTimeout(400);
    const last = calls.filter(c => c.a === "create").pop();
    ok(last && last.body.phone === "+77011112233", tag + ": новый счёт на новый номер " + (last && last.body.phone));
    await p.close();
  }
  // ---------- 3. Kaspi недоступен при создании / истёк / назад останавливает опрос ----------
  {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const calls = [];
    const script = { create: { http: 503, json: { ok: false, why: "kaspi_session_expired", message: "" } }, statuses: [{ status: "pending" }] };
    await mockKaspi(p, script, calls);
    await toPayment(p);
    await p.fill("#fEmail", "aigul@gmail.com"); await p.locator("#fEmail").dispatchEvent("change");
    await p.click("#payKaspi"); await p.waitForTimeout(500);
    let t = await p.locator("#screen").textContent();
    ok(/Kaspi временно недоступен/.test(t) && /WhatsApp/.test(t), tag + ": ошибка создания → «временно недоступен» + WhatsApp");
    script.create = { ok: true, order: "k0123456789abcdef", status: "pending", amount: 4000 };
    script.statuses = [{ status: "expired" }];
    await p.click("#kaspiRetry"); await p.waitForTimeout(200); await p.click("#payKaspi"); await p.waitForTimeout(3300);
    t = await p.locator("#screen").textContent();
    ok(/Срок счёта истёк/.test(t), tag + ": expired → «Срок счёта истёк»");
    script.statuses = [{ status: "pending" }];
    await p.click("#kaspiRetry"); await p.waitForTimeout(200); await p.click("#payKaspi"); await p.waitForTimeout(500);
    await p.click("#kaspiBack"); await p.waitForTimeout(200);
    const n = calls.filter(c => c.a === "status").length;
    await p.waitForTimeout(3500);
    ok(calls.filter(c => c.a === "status").length === n && /Оплата/.test(await p.locator(".quiz-q").first().textContent()), tag + ": «Вернуться» останавливает опрос");
    await p.close();
  }
}

// ---------- 4. кабинет: Pro через Kaspi (стенд из cab-harness) ----------
{
  const fs = await import("fs");
  const src = fs.readFileSync("/tmp/claude-0/cab-harness.mjs", "utf8");
  const tpl = src.slice(src.indexOf("const stub = `") + "const stub = `".length, src.indexOf("`;\n\nconst b ="));
  const catalog = JSON.parse(fs.readFileSync("/tmp/v3/engine_view.json", "utf8"));
  const stub = new Function("scenario", "catalog", "return `" + tpl + "`")("mid", catalog);
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; p.on("pageerror", e => errors.push(e.message));
  const calls = [];
  await p.route(/supabase\.co|tiptoppay|mc\.yandex|posthog|sentry|facebook|google|tiktok|scholary\.kz/, r => r.abort());
  await p.route(/supabase-js@.*umd\/supabase(\.min)?\.js/, r => r.fulfill({ body: "/* stubbed */", contentType: "application/javascript" }));
  await p.addInitScript(stub);
  await p.route(/cabinet\.html/, async r => { const res = await r.fetch(); let body = await res.text(); body = body.replace(/ integrity="[^"]*"/g, ""); await r.fulfill({ body, contentType: "text/html; charset=utf-8" }); });
  await mockKaspi(p, { create: { ok: true, order: "kfedcba9876543210", status: "processing", amount: 14900 }, statuses: [{ status: "pending", kind: "pro_season", amount: 14900 }, { status: "paid", kind: "pro_season", amount: 14900, fulfilled: true }] }, calls);
  await p.goto(base + "/cabinet.html", { waitUntil: "domcontentloaded" }); await p.waitForTimeout(2500);
  await p.evaluate(() => { const el = document.querySelector('[data-act="subscribe"]'); if (el) el.click(); }); await p.waitForTimeout(400);
  let t = await p.locator("#sub-view").textContent();
  ok(/Scholary Pro/.test(t) && /Оплата через Kaspi — счёт приходит в приложение/.test(t), "кабинет: панель подписки с текстом про Kaspi");
  await p.click('[data-act="pay-pro"][data-v="season"]'); await p.waitForTimeout(400);
  t = await p.locator("#sub-view").textContent();
  ok(/Номер, на который установлен Kaspi/.test(t) && /test@scholary\.kz/.test(t), "кабинет: экран ввода номера Kaspi (без карты в test-режиме идём сразу в Kaspi)");
  await p.screenshot({ path: "/tmp/claude-0/shots/kaspi-cab-phone.png" });
  await p.fill("#kaspiPhone", "123"); await p.click('[data-act="kaspi-pro-go"]'); await p.waitForTimeout(300);
  t = await p.locator("#sub-view").textContent();
  ok(/Проверь номер/.test(t) && calls.length === 0, "кабинет: кривой номер → ошибка, счёт не создан");
  await p.fill("#kaspiPhone", "8 775 383 18 36"); await p.click('[data-act="kaspi-pro-go"]'); await p.waitForTimeout(500);
  const cr = calls.find(c => c.a === "create");
  ok(cr && cr.body.kind === "pro_season" && cr.body.phone === "77753831836" && cr.body.account === "test@scholary.kz", "кабинет: create pro_season с телефоном и аккаунтом " + JSON.stringify(cr && cr.body));
  t = await p.locator("#sub-view").textContent();
  ok(/Счёт отправлен в Kaspi/.test(t) && /14 900/.test(t), "кабинет: экран ожидания с суммой");
  await p.screenshot({ path: "/tmp/claude-0/shots/kaspi-cab-wait.png" });
  await p.waitForFunction(() => /Оплата прошла/.test(document.querySelector("#sub-view").textContent), null, { timeout: 12000 }).catch(() => {});
  t = await p.locator("#sub-view").textContent();
  ok(/Оплата прошла/.test(t), "кабинет: paid → «Оплата прошла»");
  await p.screenshot({ path: "/tmp/claude-0/shots/kaspi-cab-done.png" });
  // ошибка client_not_found в кабинете
  const calls2 = []; await p.unroute(/\/api\/kaspi\.php/);
  await mockKaspi(p, { create: { ok: true, order: "kfedcba9876543211", status: "processing", amount: 4990 }, statuses: [{ status: "error", error_code: "client_not_found", error_message: "нет Kaspi" }] }, calls2);
  await p.waitForTimeout(3800);
  await p.evaluate(() => { const el = document.querySelector('[data-act="subscribe"]'); if (el) el.click(); }); await p.waitForTimeout(300);
  await p.click('[data-act="pay-pro"][data-v="month"]'); await p.waitForTimeout(300);
  await p.fill("#kaspiPhone", "+7 700 000 00 00"); await p.click('[data-act="kaspi-pro-go"]');
  await p.waitForFunction(() => /не зарегистрирован в Kaspi/.test(document.querySelector("#sub-view").textContent), null, { timeout: 9000 }).catch(() => {});
  t = await p.locator("#sub-view").textContent();
  ok(/не зарегистрирован в Kaspi/.test(t) && /Указать другой номер/.test(t), "кабинет: client_not_found → понятный экран");
  await p.click('[data-act="kaspi-pro-change"]'); await p.waitForTimeout(200);
  ok(/Номер, на который установлен Kaspi/.test(await p.locator("#sub-view").textContent()), "кабинет: «Указать другой номер» возвращает к вводу");
  ok(errors.length === 0, "кабинет: без JS-ошибок " + JSON.stringify(errors));
  await p.close();
}
await b.close();
console.log(fails ? "FAILED " + fails : "ALL OK");
process.exit(fails ? 1 : 0);
