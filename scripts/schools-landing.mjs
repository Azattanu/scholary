// UI-тесты лендинга /schools/ (web-76): 12 блоков по порядку, схема SVG/мобильная, вкладки ролей,
// шаги подключения, год школы, сравнение, калькулятор (формула), основания/анти-обещания, тарифы (год/месяц),
// FAQ, форма, переполнение, кнопки в одну строку, 0 JS-ошибок. 390×844 и 1440×900. Запуск: node scripts/schools-landing.mjs
import { chromium } from "/home/user/scholary/site/node_modules/playwright/index.mjs";
const BASE = "http://127.0.0.1:8123";
let pass = 0, fail = 0; const fails = [];
function ok(c, n, x) { if (c) pass++; else { fail++; fails.push(n + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 240) : "")); } }
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell" });
for (const [w, h, tag] of [[390, 844, "m"], [1440, 900, "d"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, locale: "ru-RU" }); const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.route(/mc\.yandex|posthog|sentry|tiktok|facebook|google|supabase\.co/, r => r.abort());
  await p.goto(BASE + "/schools/", { waitUntil: "domcontentloaded" }); await p.waitForTimeout(800);
  const T = tag + ": ";
  const txt = (await p.evaluate(() => document.body.innerText)).replace(/[\u202f\u00a0]/g, " ").replace(/НА ЧЁМ ОСНОВАНО/g, "На чём основано").replace(/ЧЕГО МЫ НЕ ОБЕЩАЕМ/g, "Чего мы не обещаем");
  const hero = txt.indexOf("Вся параллель");
  const order = ["выпускников школ в 2025", "Одна платформа — три кабинета", "Что получает каждый", "Подключение — один день", "Год школы — по неделям", "Сейчас в школе → со Scholary", "Сколько это стоит на одного ученика", "На чём основано", "Чего мы не обещаем", "Тарифы для школ", "Частые вопросы школ", "Заполните форму — перезвоним"];
  let last = hero, inOrder = hero >= 0; for (const k of order) { const i = txt.indexOf(k, hero); if (i < 0 || i < last) { inOrder = false; ok(false, T + "блок по порядку: " + k, i); } last = Math.max(last, i); }
  ok(inOrder, T + "все блоки по порядку");
  ok(!/гарантируем/i.test(txt) && !/\+\d+ ?% поступлен/i.test(txt), T + "нет «гарантируем» и обещанных процентов");
  ok(!/64-b\d/.test(txt), T + "нет внутренних ссылок на отчёты");
  ok(await p.locator(".sch-hero .btn").count() >= 2 && await p.locator(".sch-hero .mk4 > div").count() === 4, T + "hero: кнопки и мок сводки");
  ok(await p.locator(".stats4 .stat-big").count() === 4, T + "4 цифры с источниками");
  ok(/UNESCO/.test(txt) && /№ 47/.test(txt), T + "цифры: источники названы");
  // схема
  const svgVis = await p.locator(".scheme-svg").isVisible(), mVis = await p.locator(".scheme-m").isVisible();
  ok(tag === "d" ? svgVis && !mVis : !svgVis && mVis, T + "схема: SVG на десктопе, стек на мобиле", [svgVis, mVis]);
  if (tag === "d") ok(await p.locator(".scheme-svg .sn").count() === 6 && await p.locator(".scheme-svg .sl path").count() === 6, T + "схема: 6 узлов, 6 связей");
  // роли
  ok(await p.locator(".role-tabs label").count() === 4, T + "роли: 4 вкладки");
  ok(await p.locator("#p-dir").isVisible() && !(await p.locator("#p-prof").isVisible()), T + "роли: по умолчанию директор");
  await p.locator('.role-tabs label[for=r-par]').click(); await p.waitForTimeout(200);
  ok(await p.locator("#p-par").isVisible() && /Болашак/.test(await p.locator("#p-par").innerText()), T + "роли: вкладка родителя с честным фактом про Болашак");
  await p.locator('.role-tabs label[for=r-prof]').click(); await p.waitForTimeout(200);
  ok(await p.locator("#p-prof .mlist > div").count() >= 3, T + "роли: мок списков профориентолога");
  ok(await p.locator(".role-pane .btn").count() === 4, T + "роли: у каждой — ссылка в демо");
  // подключение, год, сравнение
  ok(await p.locator(".flow4 .fs").count() === 4, T + "подключение: 4 шага");
  ok(await p.locator(".yrow .ym").count() === 9 && await p.locator(".yrow .ym.hot").count() === 2, T + "год школы: 9 месяцев, 2 горячих");
  ok(/15\.01/.test(txt) && /14\.02/.test(txt) && /20\.02/.test(txt) && /16\.03/.test(txt), T + "год школы: реальные даты");
  ok(await p.locator(".cmp .cmp-r").count() === 7, T + "сравнение: 7 строк");
  // калькулятор
  const setN = async n => { await p.evaluate(n => { const r = document.getElementById("calcN"); r.value = n; r.dispatchEvent(new Event("input", { bubbles: true })); }, n); await p.waitForTimeout(100); };
  await setN(300); ok((await p.locator("#calcPlan").innerText()) === "Школа · до 500" && /3 300/.test(await p.locator("#calcPer").innerText()), T + "калькулятор: 300 → до 500, 3 300 ₸", await p.locator("#calcPer").innerText());
  await setN(80); ok(/до 100/.test(await p.locator("#calcPlan").innerText()) && /3 750/.test(await p.locator("#calcPer").innerText()), T + "калькулятор: 80 → до 100, 3 750 ₸");
  await setN(1000); ok(/до 1000/.test(await p.locator("#calcPlan").innerText()) && /1 500 ₸/.test(await p.locator("#calcPer").innerText()) && /266 учеников/.test(await p.locator("#calcEq").innerText()), T + "калькулятор: 1000 → 1 500 ₸, 266 учеников", await p.locator("#calcEq").innerText());
  ok(/Формула: цена тарифа ÷ число учеников/.test(txt), T + "калькулятор: формула открыта");
  // основания
  ok(await p.locator(".proof2 .card").count() === 2 && await p.locator(".proof2 .anti li").count() === 5, T + "основания + 5 анти-обещаний");
  // тарифы
  ok(await p.locator(".tariff").count() === 4, T + "4 тарифа");
  await p.locator('.switch [data-period="month"]').click(); await p.waitForTimeout(200);
  ok(await p.locator('input[name="period"][value="month"]').isChecked(), T + "период → форма");
  await p.locator('.switch [data-period="year"]').click();
  // FAQ
  const faq = await p.locator("#faq details").count(); ok(faq >= 13, T + "FAQ ≥ 13", faq);
  ok(/Күнделік/.test(txt) && /Что видит директор/.test(txt), T + "FAQ: новые вопросы");
  // форма
  await p.evaluate(() => document.querySelector("#apply").scrollIntoView());
  await p.click("#applyBtn"); await p.waitForTimeout(300);
  ok(await p.locator(".input-error").count() >= 1, T + "форма: валидация");
  // счётчики
  await p.evaluate(() => document.querySelectorAll(".stat-big").forEach(e => e.scrollIntoView())); await p.waitForTimeout(2400);
  const nums = await p.$$eval(".stat-big .num", els => els.map(e => e.textContent.replace(/[\u202f\u00a0]/g, " ").trim()));
  ok(nums[0] === "216 900" && nums[1] === "75 396" && nums[3] === "236", T + "счётчики докрутились", nums);
  // вёрстка
  await p.evaluate(() => document.querySelectorAll(".rv").forEach(e => e.classList.add("in")));
  ok((await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) === 0, T + "нет горизонтального переполнения");
  const tall = await p.evaluate(() => [...document.querySelectorAll(".btn, .role-tabs label")].filter(el => el.offsetParent && el.clientHeight > 62).map(el => el.textContent.trim().slice(0, 40)));
  ok(tall.length === 0, T + "кнопки в одну строку", tall);
  ok((await p.$$eval("a[href*='/schools/cabinet/?demo=1']", els => els.length)) >= 5, T + "ссылки на демо-кабинет");
  ok(errs.length === 0, T + "0 JS-ошибок", errs);
  await p.screenshot({ path: `/tmp/claude-0/shots/schools-landing-${tag}.png`, fullPage: true });
  await p.close();
}
await b.close();
console.log(`schools-landing: ${pass} ok, ${fail} fail`); fails.forEach(f => console.log("  FAIL " + f));
process.exit(fail ? 1 : 0);
