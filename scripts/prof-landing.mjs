// UI-тесты лендинга /prof/ (web-75): структура блоков, мок-экраны, переключатель тарифов год/месяц,
// валидация формы заявки, FAQ, счётчики с префиксом, переполнение, кнопки в одну строку, 0 JS-ошибок. 390×844 и 1440×900.
// Стенд: build/ на 8123. Запуск: node scripts/prof-landing.mjs
import { chromium } from "/home/user/scholary/site/node_modules/playwright/index.mjs";
import fs from "fs";
const BASE = "http://127.0.0.1:8123";
fs.mkdirSync("/tmp/claude-0/shots", { recursive: true });
let pass = 0, fail = 0; const fails = [];
function ok(c, n, x) { if (c) pass++; else { fail++; fails.push(n + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 240) : "")); } }
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell" });
for (const [w, h, tag] of [[390, 844, "m"], [1440, 900, "d"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, locale: "ru-RU" }); const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await p.route(/mc\.yandex|posthog|sentry|tiktok|facebook|google|supabase\.co/, r => r.abort());
  await p.goto(BASE + "/prof/", { waitUntil: "domcontentloaded" }); await p.waitForTimeout(800);
  const T = tag + ": ";
  const txt = (await p.evaluate(() => document.querySelector("main, body").innerText)).replace(/\u00a0/g, " ");
  // структура: hero → цифры → один день → знакомо → сезон → экраны → ученик/родители → сравнение → тарифы → FAQ → заявка
  const order = ["ни одного пропущенного дедлайна", "учеников приходится", "Один день с workspace", "Знакомо?", "Сезон — по неделям, а не «как получится»", "Пять экранов вместо Excel", "Ученик и родители", "WhatsApp + Excel → Workspace", "Первым 50 профориентологам", "Частые вопросы"];
  const hero = txt.indexOf("50 учеников");
  let last = hero, inOrder = true; for (const k of order) { const i = txt.indexOf(k, hero); if (i < 0 || i < last) { inOrder = false; ok(false, T + "блок присутствует и по порядку: " + k, i); } last = Math.max(last, i); }
  ok(inOrder, T + "все 10 блоков по порядку");
  ok(!/гарантируем/i.test(txt), T + "нет слова «гарантируем»");
  ok(!/Россия|Беларус|РУДН|МГУ/i.test(txt), T + "нет программ РФ/РБ в тексте");
  ok(await p.locator(".sch-hero .btn").count() >= 2, T + "hero: две кнопки");
  ok(await p.locator(".sch-hero .mprio, .sch-hero .mcard").count() >= 1, T + "hero: мок «Сегодня»");
  ok(await p.locator("#how .mstep, #how .mbubble").count() >= 2, T + "«Один день»: мок-карточки");
  ok(await p.locator("#why .pain4 > *, #why .ba").count() >= 4, T + "«Знакомо?»: 4 боли было→стало");
  ok(await p.locator("#season .srow .sm").count() >= 5, T + "«Сезон»: ≥5 месяцев с окнами");
  ok(/DAAD 15\.10|GKS 17\.10|SH 15\.01|CSC 15\.02/.test(txt), T + "«Сезон»: реальные даты окон");
  ok(await p.locator("#what .scr").count() >= 4, T + "«Пять экранов»: ≥4 мок-экрана");
  ok(await p.locator(".cmp .cmp-r").count() >= 6, T + "сравнение: ≥6 строк");
  // счётчики
  await p.evaluate(() => document.querySelector("#how").scrollIntoView());
  await p.evaluate(() => document.querySelectorAll(".stat-big").forEach(e => e.scrollIntoView()));
  await p.waitForTimeout(1600);
  const nums = await p.$$eval(".stat-big .num", els => els.map(e => e.textContent.trim()));
  ok(nums[0] === "~500" && nums.includes("236"), T + "счётчики докрутились с префиксом", nums);
  // тарифы: переключатель
  ok(await p.locator(".tariff").count() === 4, T + "4 тарифа");
  const before = await p.locator(".tariff").nth(1).locator(".price").innerText();
  await p.locator('.switch [data-period="month"]').click(); await p.waitForTimeout(200);
  const after = await p.locator(".tariff").nth(1).locator(".price").innerText();
  ok(before !== after && /мес|9 900/.test(after + (await p.locator(".tariff").nth(1).innerText())), T + "переключатель год→месяц меняет цену", [before, after]);
  ok((await p.inputValue('input[name="period"]:checked').catch(() => "")) === "month" || await p.locator('input[name="period"][value="month"]').isChecked(), T + "период попадает в форму");
  await p.locator('.switch [data-period="year"]').click(); await p.waitForTimeout(150);
  ok(await p.locator(".tariff .was:visible").count() >= 3, T + "на году показана зачёркнутая цена");
  // FAQ
  const faq = await p.locator("#faq details").count(); ok(faq >= 8, T + "FAQ ≥ 8 вопросов", faq);
  await p.locator("#faq details summary").first().click(); ok(await p.locator("#faq details").first().getAttribute("open") !== null, T + "FAQ раскрывается");
  // форма
  await p.evaluate(() => document.querySelector("#apply").scrollIntoView());
  await p.click("#applyBtn"); await p.waitForTimeout(300);
  ok(await p.locator(".input-error, .is-error").count() >= 1, T + "форма: пустая отправка подсвечивает ошибки");
  ok(await p.locator("#applyOk").isHidden(), T + "форма: успех не показан без данных");
  await p.fill("#sName", "Тест"); await p.fill("#sEmail", "bad-email"); await p.click("#applyBtn"); await p.waitForTimeout(300);
  ok(/почт|email/i.test(await p.locator("#sEmailHint").innerText().catch(() => "")), T + "форма: подсказка про email");
  // переполнение и кнопки
  await p.evaluate(() => document.querySelectorAll(".rv").forEach(e => e.classList.add("in")));
  const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(over === 0, T + "нет горизонтального переполнения", over);
  const tall = await p.evaluate(() => [...document.querySelectorAll(".btn")].filter(el => el.offsetParent && el.clientHeight > 62).map(el => el.textContent.trim().slice(0, 40)));
  ok(tall.length === 0, T + "кнопки в одну строку", tall);
  const links = await p.$$eval("a[href^='/prof/cabinet']", els => els.map(e => e.getAttribute("href")));
  ok(links.some(l => /demo=1/.test(l)), T + "есть ссылка на демо", links);
  ok(errs.length === 0, T + "0 JS-ошибок", errs);
  await p.screenshot({ path: `/tmp/claude-0/shots/prof-landing-${tag}.png`, fullPage: true });
  await p.close();
}
await b.close();
console.log(`prof-landing: ${pass} ok, ${fail} fail`); fails.forEach(f => console.log("  FAIL " + f));
process.exit(fail ? 1 : 0);
