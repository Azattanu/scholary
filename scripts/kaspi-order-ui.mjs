// UI-тесты покупки консультации / пакета через Kaspi с тарифов, главной и примера отчёта.
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
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(Object.assign({ ok: true, order: u.searchParams.get("o"), kind: "consult", amount: 15000, error_code: "", error_message: "", age: 5, fulfilled: false }, st)) });
    }
    return r.fulfill({ status: 400, body: "{}" });
  });
}
async function open(p, path) {
  await p.route(/supabase\.co|tiptoppay|mc\.yandex|posthog|sentry|facebook|google|tiktok/, r => r.abort());
  await p.route(/\/api\/(notify|ph)\.php/, r => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await p.goto(base + path, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(500);
}
const oneLine = async (loc) => loc.evaluate(el => { const r = document.createRange(); r.selectNodeContents(el); const rects = Array.from(r.getClientRects()).filter(x => x.width > 0); const tops = new Set(rects.map(x => Math.round(x.top / 4))); return tops.size === 1; });

for (const [w, h, tag] of [[360, 780, "m"], [1440, 900, "d"]]) {
  // ---------- 1. тарифы: кнопки и успешная оплата консультации ----------
  {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const errors = []; p.on("pageerror", e => errors.push(e.message));
    const calls = [];
    await mockKaspi(p, { create: { ok: true, order: "k0123456789abcdef", status: "processing", amount: 15000, phone: "77012345678" },
      statuses: [{ status: "pending" }, { status: "paid", fulfilled: true }] }, calls);
    await open(p, "/tariffs/");
    const btns = p.locator("[data-kaspi]");
    ok(await btns.count() === 2 && await btns.nth(0).getAttribute("data-kaspi") === "consult" && await btns.nth(1).getAttribute("data-kaspi") === "package", tag + ": на тарифах две кнопки Kaspi (consult, package)");
    ok(await oneLine(btns.nth(0)) && await oneLine(btns.nth(1)) && await oneLine(p.locator("#waConsult")) && await oneLine(p.locator("#waPackage")), tag + ": кнопки «Оставить заявку» и «Оплатить через Kaspi» — в одну строку");
    const bb1 = await p.locator("#waConsult").boundingBox(), bb2 = await btns.nth(0).boundingBox();
    ok(bb2.y > bb1.y + bb1.height - 1 && bb2.y - (bb1.y + bb1.height) <= 14 && Math.abs(bb2.width - bb1.width) < 2, tag + ": Kaspi-кнопка под «Оставить заявку», той же ширины");
    await btns.nth(0).click(); await p.waitForTimeout(300);
    const dlg = p.locator(".kpay");
    ok(await dlg.count() === 1 && /Разбор со специалистом/.test(await dlg.textContent()) && /15 000/.test(await dlg.textContent()), tag + ": окно оплаты: название и цена");
    await p.screenshot({ path: `/tmp/claude-0/shots/kpay-form-${tag}.png` });
    // пустая форма — ошибка
    await p.click('[data-kp="go"]'); await p.waitForTimeout(200);
    ok(calls.length === 0 && await p.locator("#kpPhone.input-error").count() === 1 && await p.locator("#kpEmail.input-error").count() === 1, tag + ": пустые номер и почта подсвечены, счёт не создаём");
    await p.fill("#kpName", "Аида");
    await p.locator("#kpPhone").click(); await p.locator("#kpPhone").type("87012345678", { delay: 10 });
    ok(await p.inputValue("#kpPhone") === "+7 701 234 56 78", tag + ": маска номера");
    await p.fill("#kpEmail", "aida@example.com");
    await p.click('[data-kp="go"]'); await p.waitForTimeout(400);
    const cr = calls.find(c => c.a === "create");
    ok(cr && cr.body.kind === "consult" && cr.body.phone === "+77012345678" && cr.body.email === "aida@example.com" && cr.body.name === "Аида", tag + ": create consult с именем/номером/почтой " + JSON.stringify(cr && cr.body));
    let t = await dlg.textContent();
    ok(/Счёт отправлен в Kaspi/.test(t) && /\+7 701 234 56 78/.test(t) && /15 000 ₸/.test(t), tag + ": экран ожидания с номером и суммой");
    ok(await oneLine(p.locator('[data-kp="change"]')), tag + ": кнопка «Другой номер» в одну строку");
    await p.screenshot({ path: `/tmp/claude-0/shots/kpay-wait-${tag}.png` });
    await p.waitForFunction(() => /Оплата прошла/.test((document.querySelector(".kpay") || {}).textContent || ""), null, { timeout: 9000 }).catch(() => {});
    t = await dlg.textContent();
    ok(/Оплата прошла/.test(t) && /Аида, спасибо/.test(t) && /Профориентолог Scholary скоро напишет/.test(t) && /\+7 701 234 56 78/.test(t) && /aida@example\.com/.test(t) && /онлайн-консультации/.test(t), tag + ": «Оплата прошла»: профориентолог напишет в WhatsApp на номер и на почту, назначит дату");
    await p.screenshot({ path: `/tmp/claude-0/shots/kpay-done-${tag}.png` });
    const n = calls.filter(c => c.a === "status").length; await p.waitForTimeout(3500);
    ok(calls.filter(c => c.a === "status").length === n, tag + ": после paid опрос остановлен");
    await p.click('[data-kp="close"]'); await p.waitForTimeout(200);
    ok(await p.locator(".kpay").count() === 0 && !(await p.evaluate(() => document.body.classList.contains("kpay-open"))), tag + ": «Готово» закрывает окно");
    // повторное открытие — контакты запомнены
    await btns.nth(1).click(); await p.waitForTimeout(200);
    ok(await p.inputValue("#kpName") === "Аида" && await p.inputValue("#kpPhone") === "+7 701 234 56 78" && await p.inputValue("#kpEmail") === "aida@example.com" && /Документы и подача/.test(await dlg.textContent()) && /35 000/.test(await dlg.textContent()), tag + ": пакет: окно с ценой 35 000, контакты подставлены");
    await p.keyboard.press("Escape"); await p.waitForTimeout(200);
    ok(await p.locator(".kpay").count() === 0, tag + ": Escape закрывает");
    ok(errors.length === 0, tag + ": без JS-ошибок " + errors.join(" | "));
    await p.close();
  }
  // ---------- 2. ошибки: номер не в Kaspi → другой номер; истёк; Kaspi выключен ----------
  {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const calls = [];
    const script = { create: { ok: true, order: "k0123456789abcdef", status: "processing", amount: 15000, phone: "77012345678" }, statuses: [{ status: "error", error_code: "client_not_found", error_message: "Client not found" }] };
    await mockKaspi(p, script, calls);
    await open(p, "/");
    ok(await p.locator("[data-kaspi]").count() === 2 && await oneLine(p.locator("[data-kaspi]").nth(0)), tag + ": на главной две кнопки Kaspi в тарифах, в одну строку");
    await p.locator("[data-kaspi=consult]").click(); await p.waitForTimeout(200);
    await p.fill("#kpName", "Ерлан"); await p.locator("#kpPhone").click(); await p.locator("#kpPhone").type("7012345678", { delay: 5 }); await p.fill("#kpEmail", "e@example.com");
    await p.click('[data-kp="go"]');
    await p.waitForFunction(() => /не зарегистрирован в Kaspi/.test((document.querySelector(".kpay") || {}).textContent || ""), null, { timeout: 9000 }).catch(() => {});
    let t = await p.locator(".kpay").textContent();
    ok(/Этот номер не зарегистрирован в Kaspi/.test(t) && /Указать другой номер/.test(t), tag + ": client_not_found → экран «номер не в Kaspi»");
    await p.screenshot({ path: `/tmp/claude-0/shots/kpay-err-${tag}.png` });
    await p.click('[data-kp="retry"]'); await p.waitForTimeout(200);
    ok(await p.locator("#kpPhone").count() === 1 && await p.evaluate(() => document.activeElement && document.activeElement.id === "kpPhone"), tag + ": «Указать другой номер» → форма, фокус на номере");
    // истёк
    script.statuses = [{ status: "expired" }];
    await p.click('[data-kp="go"]');
    await p.waitForFunction(() => /истёк/.test((document.querySelector(".kpay") || {}).textContent || ""), null, { timeout: 9000 }).catch(() => {});
    ok(/Срок счёта истёк/.test(await p.locator(".kpay").textContent()), tag + ": expired → «Срок счёта истёк»");
    // выключен
    script.create = { http: 503, json: { ok: false, why: "kaspi_off" } };
    await p.click('[data-kp="retry"]'); await p.waitForTimeout(200); await p.click('[data-kp="go"]'); await p.waitForTimeout(500);
    t = await p.locator(".kpay").textContent();
    ok(/Kaspi временно недоступен/.test(t) && /WhatsApp/.test(t), tag + ": kaspi_off → «временно недоступен» + WhatsApp");
    // ушёл — опрос остановлен
    script.create = { ok: true, order: "k0123456789abcdef", status: "processing", amount: 15000 }; script.statuses = [{ status: "pending" }];
    await p.click('[data-kp="retry"]'); await p.waitForTimeout(200); await p.click('[data-kp="go"]'); await p.waitForTimeout(3500);
    const n1 = calls.filter(c => c.a === "status").length; ok(n1 >= 1, tag + ": опрос идёт");
    await p.locator(".kpay-x").click(); await p.waitForTimeout(3500);
    ok(calls.filter(c => c.a === "status").length === n1, tag + ": закрыл окно → опрос остановлен");
    await p.close();
  }
  // ---------- 3. пример отчёта и KASPI_ON=false ----------
  {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await open(p, "/demo/");
    const bt = p.locator("[data-kaspi]");
    ok(await bt.count() === 2 && await oneLine(bt.nth(0)) && await oneLine(bt.nth(1)), tag + ": пример отчёта: две Kaspi-кнопки в одну строку");
    await bt.nth(1).click(); await p.waitForTimeout(200);
    ok(/Документы и подача/.test(await p.locator(".kpay").textContent()), tag + ": открывается окно пакета");
    await p.close();
    const p2 = await b.newPage({ viewport: { width: w, height: h } });
    await p2.addInitScript(() => { document.addEventListener("DOMContentLoaded", () => {}); Object.defineProperty(window, "__off", { value: 1 }); });
    await p2.route(/\/js\/config\.js/, async r => { const res = await r.fetch(); const body = (await res.text()).replace("KASPI_ON: true", "KASPI_ON: false"); r.fulfill({ status: 200, contentType: "application/javascript", body }); });
    await open(p2, "/tariffs/");
    ok(await p2.locator("[data-kaspi]:visible").count() === 0 && await p2.locator("#waConsult").isVisible(), tag + ": KASPI_ON=false → кнопки Kaspi скрыты, «Оставить заявку» на месте");
    await p2.close();
  }
}
await b.close();
console.log(fails ? "FAILS: " + fails : "ALL PASSED");
process.exit(fails ? 1 : 0);
