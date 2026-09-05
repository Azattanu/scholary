// UI-тесты web-72: ссылка на отчёт на экране «оплачено», обрыв связи → «Проверить статус» (тот же счёт),
// повторное нажатие после оплаты (paid_before), модалка тарифов при обрыве.
import { chromium } from "/home/user/scholary/site/node_modules/playwright/index.mjs";
const base = "http://127.0.0.1:8123";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell" });
let fails = 0;
const ok = (c, m) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) fails++; };
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
      if (st && st.abort) return r.abort();
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
  await p.fill("#fEmail", "aigul@gmail.com"); await p.locator("#fEmail").dispatchEvent("change");
}
const abort8 = Array.from({ length: 9 }, () => ({ abort: true }));
for (const [w, h, tag] of [[390, 844, "m"], [1440, 900, "d"]]) {
  // 1. оплачено → отчёт выдаётся → ссылка на экране
  {
    const p = await b.newPage({ viewport: { width: w, height: h } }); const errors = []; p.on("pageerror", e => errors.push(e.message)); const calls = [];
    await mockKaspi(p, { create: { ok: true, order: "k0123456789abcdef", status: "pending", amount: 4000, phone: "77753831836" },
      statuses: [{ status: "paid", fulfilled: false }, { status: "paid", fulfilled: false }, { status: "paid", fulfilled: true, report_url: "https://scholary.kz/report/?t=tok123", delivered: { wa: true, mail: true } }] }, calls);
    await toPayment(p); await p.click("#payKaspi");
    await p.waitForFunction(() => /Оплата прошла/.test(document.querySelector("#screen").textContent), null, { timeout: 9000 }).catch(() => {});
    let t = await p.locator("#screen").textContent();
    ok(/Оплата прошла/.test(t) && /Готовим отчёт/.test(t), tag + ": paid → «Оплата прошла» + «Готовим отчёт…» пока выдача в фоне");
    await p.waitForFunction(() => document.querySelector("#reportLinkBox a"), null, { timeout: 12000 }).catch(() => {});
    const href = await p.locator("#reportLinkBox a").getAttribute("href").catch(() => null);
    t = await p.locator("#screen").textContent();
    ok(href === "https://scholary.kz/report/?t=tok123" && /Открыть отчёт/.test(t) && /ушла на WhatsApp и почту/.test(t), tag + ": fulfilled → кнопка «Открыть отчёт» с личной ссылкой");
    const n = calls.filter(c => c.a === "status").length; await p.waitForTimeout(3500);
    ok(calls.filter(c => c.a === "status").length === n, tag + ": после выдачи опрос остановлен");
    ok(await p.locator("#phase2box .field").count() >= 5, tag + ": анкета фазы 2 на месте, не перерисована");
    await p.screenshot({ path: `/tmp/claude-0/shots/kaspi72-link-${tag}.png` });
    ok(errors.length === 0, tag + ": без JS-ошибок " + JSON.stringify(errors));
    await p.close();
  }
  // 2. оба канала не доставили → предупреждение и та же кнопка
  {
    const p = await b.newPage({ viewport: { width: w, height: h } }); const calls = [];
    await mockKaspi(p, { create: { ok: true, order: "k0123456789abcdef", status: "pending", amount: 4000 },
      statuses: [{ status: "paid", fulfilled: true, report_url: "https://scholary.kz/report/?t=tok9", delivered: { wa: false, mail: false } }] }, calls);
    await toPayment(p); await p.click("#payKaspi");
    await p.waitForFunction(() => document.querySelector("#reportLinkBox a"), null, { timeout: 9000 }).catch(() => {});
    const t = await p.locator("#screen").textContent();
    ok(/Не смогли отправить ссылку/.test(t) && /Открыть отчёт/.test(t), tag + ": WhatsApp+почта не ушли → честное предупреждение и кнопка с отчётом");
    await p.close();
  }
  // 3. обрыв связи после выставления счёта → «Проверить статус» → тот же заказ → paid
  {
    const p = await b.newPage({ viewport: { width: w, height: h } }); const calls = [];
    await mockKaspi(p, { create: { ok: true, order: "kabcdefabcdefabcd", status: "pending", amount: 4000 },
      statuses: [...abort8, { status: "paid", fulfilled: true, report_url: "https://scholary.kz/report/?t=tokR" }] }, calls);
    await toPayment(p); await p.click("#payKaspi");
    await p.waitForFunction(() => /Связь с сервером прервалась/.test(document.querySelector("#screen").textContent), null, { timeout: 70000 }).catch(() => {});
    let t = await p.locator("#screen").textContent();
    ok(/Связь с сервером прервалась/.test(t) && /Если ты его оплатил/.test(t) && /Проверить статус/.test(t), tag + ": 8 обрывов подряд → «Связь прервалась», не «Kaspi недоступен»");
    await p.screenshot({ path: `/tmp/claude-0/shots/kaspi72-lost-${tag}.png` });
    const creates = calls.filter(c => c.a === "create").length;
    await p.click("#kaspiRetry");
    await p.waitForFunction(() => /Оплата прошла/.test(document.querySelector("#screen").textContent), null, { timeout: 9000 }).catch(() => {});
    t = await p.locator("#screen").textContent();
    ok(calls.filter(c => c.a === "create").length === creates && calls.filter(c => c.a === "status").slice(-1)[0].o === "kabcdefabcdefabcd" && /Оплата прошла/.test(t), tag + ": «Проверить статус» опрашивает тот же счёт без нового create и доводит до «Оплата прошла»");
    await p.close();
  }
  // 4. повторное нажатие после оплаты → сервер вернул paid_before → сразу успех со ссылкой
  {
    const p = await b.newPage({ viewport: { width: w, height: h } }); const calls = [];
    await mockKaspi(p, { create: { ok: true, order: "k0123456789abcdef", status: "paid", reused: true, paid_before: true, fulfilled: true, report_url: "https://scholary.kz/report/?t=tokP", amount: 4000 },
      statuses: [{ status: "paid", fulfilled: true, report_url: "https://scholary.kz/report/?t=tokP", delivered: { wa: true, mail: false } }] }, calls);
    await toPayment(p); await p.click("#payKaspi");
    await p.waitForFunction(() => document.querySelector("#reportLinkBox a"), null, { timeout: 9000 }).catch(() => {});
    const t = await p.locator("#screen").textContent();
    ok(/Оплата прошла/.test(t) && /Открыть отчёт/.test(t) && calls.filter(c => c.a === "create").length === 1, tag + ": уже оплачено → сразу «Оплата прошла» + ссылка, второй счёт не выставлен");
    await p.close();
  }
  // 5. модалка тарифов: обрыв → «Проверить статус» → тот же счёт → «Оплата прошла»
  {
    const p = await b.newPage({ viewport: { width: w, height: h } }); const calls = []; const errors = []; p.on("pageerror", e => errors.push(e.message));
    await p.route(/supabase\.co|tiptoppay|mc\.yandex|posthog|sentry|facebook|google|tiktok/, r => r.abort());
    await p.route(/\/api\/(notify|ph)\.php/, r => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
    await mockKaspi(p, { create: { ok: true, order: "kfedcbafedcbafed", status: "pending", amount: 15000 }, statuses: [...abort8, { status: "paid", fulfilled: true, kind: "consult", amount: 15000 }] }, calls);
    await p.goto(base + "/tariffs/", { waitUntil: "domcontentloaded" }); await p.waitForTimeout(400);
    await p.locator('[data-kaspi="consult"]').first().click(); await p.waitForTimeout(300);
    await p.fill("#kpName", "Дана"); await p.locator("#kpPhone").click(); await p.locator("#kpPhone").type("87011234567", { delay: 5 }); await p.fill("#kpEmail", "dana@example.com");
    await p.click('[data-kp="go"]');
    await p.waitForFunction(() => /Связь с сервером прервалась/.test((document.querySelector(".kpay-body") || {}).textContent || ""), null, { timeout: 70000 }).catch(() => {});
    let t = await p.locator(".kpay-body").textContent();
    ok(/Связь с сервером прервалась/.test(t) && /Проверить статус/.test(t), tag + ": модалка: обрыв → «Связь прервалась» + «Проверить статус»");
    const creates = calls.filter(c => c.a === "create").length;
    await p.click('[data-kp="retry"]');
    await p.waitForFunction(() => /Оплата прошла/.test((document.querySelector(".kpay-body") || {}).textContent || ""), null, { timeout: 9000 }).catch(() => {});
    t = await p.locator(".kpay-body").textContent();
    ok(/Оплата прошла/.test(t) && calls.filter(c => c.a === "create").length === creates, tag + ": модалка: тот же счёт → «Оплата прошла», нового create нет");
    ok(errors.length === 0, tag + ": модалка без JS-ошибок " + JSON.stringify(errors));
    await p.close();
  }
}
await b.close();
console.log(fails ? "FAILS " + fails : "ALL OK");
process.exit(fails ? 1 : 0);
