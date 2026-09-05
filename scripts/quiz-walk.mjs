// Прогон квиза: маска телефона, ошибки, пейволл. Supabase/внешние запросы блокируются.
import { chromium } from "/home/user/scholary/site/node_modules/playwright/index.mjs";
const base = "http://127.0.0.1:8123";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell" });
let fails = 0;
const ok = (c, m) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) fails++; };

for (const [w, h, tag] of [[390, 844, "m"], [1440, 900, "d"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  p.on("pageerror", e => errors.push(e.message));
  await p.route(/supabase\.co|tiptoppay|mc\.yandex|posthog|sentry|facebook|google/, r => r.abort());
  await p.goto(base + "/quiz.html", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(600);
  // 7 шагов: кликаем первый вариант каждой группы, затем «Дальше»
  for (let i = 0; i < 8; i++) {
    const q = await p.locator(".quiz-q").first().textContent().catch(() => "");
    if (/Куда прислать/.test(q)) break;
    for (let k = 0; k < 8; k++) {
      const box = p.locator("#screen .opts:not(:has(.selected)), #screen .chips:not(:has(.selected))").first();
      if (!(await box.count())) break;
      await box.locator("button").first().click();
      await p.waitForTimeout(120);
    }
    const next = p.locator("#screen .quiz-nav .btn-primary, #screen button.btn-primary").last();
    if (await next.count()) { await next.click().catch(() => {}); await p.waitForTimeout(250); }
  }
  const q = await p.locator(".quiz-q").first().textContent().catch(() => "");
  ok(/Куда прислать/.test(q), tag + ": дошли до контактов (" + q.trim() + ")");
  await p.fill("#fName", "Тест");
  const wa = p.locator("#fWa");
  await wa.click(); await wa.type("87753831836", { delay: 20 });
  const v1 = await wa.inputValue();
  ok(v1 === "+7 775 383 18 36", tag + ": маска 8775… → «" + v1 + "»");
  await wa.fill(""); await wa.type("+7 8 775 383 18 36", { delay: 10 });
  ok((await wa.inputValue()) === "+7 775 383 18 36", tag + ": «+7 8 775…» → «" + await wa.inputValue() + "»");
  await wa.fill(""); await wa.type("+7 775 383 18 3", { delay: 10 });
  await p.locator("#screen .quiz-nav .btn-primary").click();
  await p.waitForTimeout(300);
  const hintErr = await p.locator("#fWaHint.is-error").count();
  const still = /Куда прислать/.test(await p.locator(".quiz-q").first().textContent());
  ok(hintErr === 1 && still, tag + ": короткий номер → ошибка, остаёмся на форме");
  await p.screenshot({ path: `/tmp/claude-0/shots/quiz-contact-err-${tag}.png` });
  await wa.fill(""); await wa.type("8 775 383 18 36", { delay: 10 });
  await p.locator("#screen .quiz-nav .btn-primary").click();
  await p.waitForTimeout(700);
  const pay = await p.locator("#screen").textContent();
  ok(/Готово, Тест/.test(pay), tag + ": после валидного номера — пейволл");
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem("scholary_quiz_v1") || "null"));
  ok(saved && saved.answers && saved.answers.whatsapp === "+77753831836", tag + ": в localStorage whatsapp = " + (saved && saved.answers && saved.answers.whatsapp));
  ok(saved && saved.result && typeof saved.result.pAtLeastOne === "number", tag + ": result.pAtLeastOne сохранён = " + (saved && saved.result && saved.result.pAtLeastOne));
  await p.screenshot({ path: `/tmp/claude-0/shots/quiz-paywall-${tag}.png`, fullPage: true });
  const hscroll = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  ok(!hscroll, tag + ": нет горизонтального скролла на пейволле");
  ok(errors.length === 0, tag + ": без JS-ошибок " + JSON.stringify(errors));
  await p.close();
}
await b.close();
console.log(fails ? "FAILED " + fails : "ALL OK");
process.exit(fails ? 1 : 0);
