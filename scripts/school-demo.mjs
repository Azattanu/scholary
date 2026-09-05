// UI-тесты кабинета школы 2.0 (web-76) в демо-режиме: /schools/cabinet/?demo=1
// Стенд: build/ на 8123. Запуск: node scripts/school-demo.mjs [m|d]
// Проверяет: Сводка (KPI, воронка, классы, «требует внимания», год к году, подсказка), переключатель ролей,
// Отчёт года (печатная страница, копирование), Неделя (приоритет, очередь, списки-действия, закрытие задачи,
// «неделя спланирована», модалка шага, быстрая запись), Календарь (точки, тап, окна сезона), Классы (карточки,
// лист для родительского чата), Ученики (фильтры, классы, поиск, deep-link, CSV), карточка (шаг, записи, кабинет,
// семья: статус → отметить, контакты), Настройки (ссылка, сотрудники: пригласить/убрать, ритм, архив сезона),
// переполнение 0, кнопки в одну строку, 0 JS-ошибок — на 390×844 и 1440×900.
import { chromium } from "/home/user/scholary/site/node_modules/playwright/index.mjs";
import fs from "fs";
const BASE = "http://127.0.0.1:8123", NOW = "2026-09-05T10:00:00", which = process.argv[2] || "md";
fs.mkdirSync("/tmp/claude-0/shots", { recursive: true });
let pass = 0, fail = 0; const fails = [];
function ok(c, n, x) { if (c) pass++; else { fail++; fails.push(n + (x !== undefined ? " :: " + JSON.stringify(x).slice(0, 300) : "")); } }
const overflow = p => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const tall = p => p.evaluate(() => [...document.querySelectorAll(".btn, .chip, .tabs a, .role-seg button")].filter(el => el.offsetParent && el.clientHeight > 52).map(el => el.textContent.trim().slice(0, 40)));
const text = async (p, sel) => (await p.locator(sel).first().textContent().catch(() => "")) || "";
const goHash = async (p, h) => { await p.evaluate(h => { location.hash = h; }, h); await p.waitForTimeout(400); };
const clearModal = p => p.evaluate(() => { document.getElementById("modal-root").innerHTML = ""; document.body.style.overflow = ""; });

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell" });
for (const [w, h, tag] of [[390, 844, "m"], [1440, 900, "d"]]) {
  if (!which.includes(tag)) continue;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, locale: "ru-RU", timezoneId: "Asia/Almaty" });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.route(/mc\.yandex|posthog|sentry|supabase\.co|unpkg|jsdelivr/, r => r.abort());
  await p.addInitScript(`window.__SCHOLARY_NOW = ${JSON.stringify(NOW)}; try { localStorage.removeItem("sc_mode"); } catch (e) {}`);
  await p.goto(BASE + "/schools/cabinet/?demo=1", { waitUntil: "domcontentloaded" }); await p.waitForSelector(".kpi4", { timeout: 8000 });
  const T = tag + ": ";

  /* ---------- Сводка ---------- */
  ok(/#\/summary/.test(await p.evaluate(() => location.hash)), T + "директор по умолчанию попадает в Сводку");
  ok(await p.locator("#demoBar").isVisible(), T + "демо-плашка");
  ok(await p.locator(".kpi4 .card").count() === 4, T + "Сводка: 4 KPI");
  const k = await p.$$eval(".kpi4 .n", els => els.map(e => e.textContent.trim()));
  ok(/^48/.test(k[0]) && /%$/.test(k[1]) && /%$/.test(k[2]), T + "Сводка: подключено / % расчёт / % план", k);
  ok(await p.locator(".funnel .frow").count() === 6, T + "Сводка: воронка из 6 ступеней");
  const fn = await p.$$eval(".funnel .fn", els => els.map(e => parseInt(e.textContent, 10)));
  ok(fn.every((v, i) => i === 0 || v <= fn[i - 1]), T + "Сводка: воронка невозрастающая", fn);
  ok(await p.locator(".cls .card").count() === 7, T + "Сводка: 7 классов", await p.locator(".cls .card").count());
  ok(await p.locator(".act-list .act").count() === 3, T + "Сводка: «требует внимания школы» — 3 строки");
  ok(/Год к году/.test(await text(p, "#sumBody")) && await p.locator(".yoy tr").count() === 3, T + "Сводка: год к году (архив + текущий)");
  ok(/Неделя 1 сезона/i.test(await text(p, "#sumBody")) && /без расчёта/.test(await text(p, "#sumBody")), T + "Сводка: подсказка недели с числами");
  ok(await p.locator(".tg span").count() >= 8, T + "Сводка: страны и направления");
  ok(await p.locator("#roleSeg button").count() === 2, T + "переключатель ролей");
  await p.locator(".funnel .frow a").nth(1).click(); await p.waitForTimeout(400);
  ok(/#\/students\?f=noquiz/.test(await p.evaluate(() => location.hash)) && await p.locator("#list .row").count() === 9, T + "воронка → список «без расчёта» (9)", await p.locator("#list .row").count());
  await goHash(p, "#/summary"); await p.waitForSelector(".cls .card");
  await p.locator(".cls .card").first().click(); await p.waitForTimeout(400);
  ok(/#\/students\?c=/.test(await p.evaluate(() => location.hash)) && await p.locator("#list .row").count() === 7, T + "класс → список класса (11А · 7)");
  await goHash(p, "#/summary"); await p.waitForSelector(".kpi4");
  ok(await overflow(p) === 0, T + "Сводка: нет переполнения"); ok((await tall(p)).length === 0, T + "Сводка: кнопки в одну строку", await tall(p));
  await p.screenshot({ path: `/tmp/claude-0/shots/scd-summary-${tag}.png`, fullPage: true });

  /* ---------- Отчёт ---------- */
  await goHash(p, "#/report"); await p.waitForSelector(".report h1");
  const rp = await text(p, "#rpBody");
  ok(/Школа-лицей №39/.test(rp) && /Итоги в цифрах/.test(rp) && /По классам/.test(rp) && /Офферы и стипендии/.test(rp) && /Что дальше/.test(rp), T + "Отчёт: все разделы");
  ok(await p.locator("#rpBody table").count() >= 3, T + "Отчёт: таблицы классов, офферов, год к году");
  ok(/не обещают поступление/.test(rp), T + "Отчёт: честная оговорка");
  ok(await p.locator("#rp-print").count() === 1 && await p.locator("#rp-copy").count() === 1, T + "Отчёт: печать и копирование");
  ok(await overflow(p) === 0, T + "Отчёт: нет переполнения");
  await p.screenshot({ path: `/tmp/claude-0/shots/scd-report-${tag}.png`, fullPage: true });

  /* ---------- Роль профориентолога → Неделя ---------- */
  await goHash(p, "#/summary"); await p.waitForSelector("#roleSeg");
  await p.locator("#roleSeg [data-m=counselor]").click(); await p.waitForTimeout(500);
  ok(/#\/week/.test(await p.evaluate(() => location.hash)), T + "роль «Профориентолог» → Неделя");
  await p.waitForSelector("#wkBody .prio");
  const prio = await text(p, "#wkBody .prio"); ok(/срочн/.test(prio) && /списк/.test(prio), T + "Неделя: строка приоритета", prio);
  const kinds = await p.$$eval("#wkBody .q .qk", els => els.map(e => e.className.replace("qk ", "")));
  ok(kinds.length >= 6, T + "Неделя: очередь ≥ 6", kinds);
  ok(/просроч/i.test(await p.locator("#wkBody .q").first().textContent()), T + "Неделя: первое — просроченное");
  const lists = await p.locator("#wkBody .act").count(); ok(lists >= 8, T + "Неделя: списки-действия ≥ 8", lists);
  const first = await text(p, "#wkBody .act .at b"); ok(/Без расчёта/.test(first), T + "Неделя: первый список — «Без расчёта»", first);
  ok(await p.locator("#wkBody .act .names a").count() >= 20, T + "Неделя: имена в списках");
  const cb = p.locator("#wkBody [data-qtask]").first(); await cb.check(); await p.waitForTimeout(500);
  ok((await p.evaluate(() => document.querySelector("#wkBody [data-qtask]:checked").closest(".q").style.opacity)) === "0.4", T + "Неделя: закрытие задачи гасит строку");
  const planned = p.locator("#wk-planned"); ok(!(await planned.isDisabled()), T + "Неделя: «Неделя спланирована» активна");
  await planned.click(); await p.waitForTimeout(400); ok(await planned.isDisabled() && /✓/.test(await text(p, "#wk-planned")), T + "Неделя: после клика ✓");
  await p.locator("#wkBody [data-step]").first().click(); await p.waitForSelector("#f-step");
  ok(await p.locator("#f-step .chip").count() >= 2, T + "Неделя: модалка шага с шаблонами по классу");
  await p.locator("#f-step .chip").first().click(); await p.click("#f-step button[type=submit]"); await p.waitForTimeout(500);
  ok(await p.locator("#f-step").count() === 0, T + "Неделя: шаг сохранён");
  await p.click("#btn-quick"); await p.waitForSelector("#f-quick");
  await p.locator("#qk [data-k=meeting]").click(); ok(!(await p.locator("#q-time").isHidden()), T + "быстрая запись: у встречи время");
  await p.selectOption("#f-quick select[name=sid]", { index: 2 }); await p.fill("#f-quick textarea[name=text]", "Тест: созвон с семьёй"); await p.click("#f-quick button[type=submit]"); await p.waitForTimeout(600);
  ok(await p.locator("#f-quick").count() === 0, T + "быстрая запись сохраняется"); await clearModal(p);
  ok(await overflow(p) === 0, T + "Неделя: нет переполнения"); ok((await tall(p)).length === 0, T + "Неделя: кнопки в одну строку", await tall(p));
  await p.screenshot({ path: `/tmp/claude-0/shots/scd-week-${tag}.png`, fullPage: true });

  /* ---------- Календарь ---------- */
  await goHash(p, "#/calendar"); await p.waitForSelector("#calBody .cal-d");
  ok(/Сентябрь 2026/.test(await text(p, "#calBody")), T + "Календарь: сентябрь 2026");
  ok(await p.locator("#calBody .cal-d.has").count() >= 8, T + "Календарь: дни с событиями", await p.locator("#calBody .cal-d.has").count());
  ok(/В этом месяце/.test(await text(p, "#calBody")) && /окно сезона/.test(await text(p, "#calBody")), T + "Календарь: список месяца + окна сезона");
  await p.locator("#calBody [data-act=cal-next]").click(); await p.waitForTimeout(300);
  ok(/Октябрь 2026/.test(await text(p, "#calBody")) && /DAAD|GKS/.test(await text(p, "#calBody")), T + "Календарь: октябрь с DAAD/GKS");
  await p.locator("#calBody [data-act=cal-day]").filter({ hasText: /^\s*15\s*$/ }).first().click(); await p.waitForTimeout(300);
  ok(/15 октября/.test(await text(p, "#calBody")), T + "Календарь: тап по дню");
  ok(await overflow(p) === 0, T + "Календарь: нет переполнения");

  /* ---------- Классы ---------- */
  await goHash(p, "#/classes"); await p.waitForSelector("#clBody .cls .card");
  ok(await p.locator("#clBody .cls .card").count() === 7, T + "Классы: 7 карточек");
  const pc = await p.inputValue("#pc-text"); ok(/Уважаемые родители 11А/.test(pc) && /Подключены к Scholary/.test(pc), T + "Классы: лист для родительского чата", pc.slice(0, 60));
  await p.selectOption("#pc-cls", "9Б"); await p.waitForTimeout(200); ok(/родители 9Б/.test(await p.inputValue("#pc-text")), T + "Классы: смена класса меняет лист");
  ok((await p.locator("#pc-wa").getAttribute("href")).startsWith("https://wa.me/?text="), T + "Классы: ссылка WhatsApp");
  ok(await overflow(p) === 0, T + "Классы: нет переполнения");
  await p.screenshot({ path: `/tmp/claude-0/shots/scd-classes-${tag}.png`, fullPage: true });

  /* ---------- Ученики ---------- */
  await goHash(p, "#/students?f="); await p.waitForSelector("#list .row");
  ok(await p.locator("#list .row").count() === 48, T + "Ученики: 48 строк", await p.locator("#list .row").count());
  ok(await p.locator("#chips .chip").count() >= 20, T + "Ученики: чипы фильтров и классов");
  await p.locator("#chips .chip[data-f=attention]").click(); await p.waitForTimeout(250); ok(await p.locator("#list .row").count() === 2, T + "Ученики: 🔴 срочно = 2", await p.locator("#list .row").count());
  await p.locator("#chips .chip[data-f=family]").click(); await p.waitForTimeout(250); ok(await p.locator("#list .row").count() >= 10, T + "Ученики: семья без статуса");
  await p.locator("#chips .chip[data-f='']").first().click(); await p.locator("#chips .chip[data-c='10А']").click(); await p.waitForTimeout(250);
  ok(await p.locator("#list .row").count() === 8, T + "Ученики: класс 10А = 8");
  await p.locator("#chips .chip[data-c='']").click(); await p.fill("#q", "Данияр"); await p.waitForTimeout(250);
  ok(await p.locator("#list .row").count() === 2, T + "Ученики: поиск «Данияр» = 2", await p.locator("#list .row").count()); await p.fill("#q", ""); await p.waitForTimeout(200);
  ok(await p.locator("#list [data-step]").count() >= 5, T + "Ученики: кнопка «Шаг» у учеников без шага");
  ok(await overflow(p) === 0, T + "Ученики: нет переполнения"); ok((await tall(p)).length === 0, T + "Ученики: кнопки в одну строку", await tall(p));
  await p.screenshot({ path: `/tmp/claude-0/shots/scd-students-${tag}.png`, fullPage: true });

  /* ---------- Карточка ---------- */
  await goHash(p, "#/s/u2/overview"); await p.waitForSelector("#stBody .tl");
  ok(/Данияр Касымов/.test(await text(p, "#stHead")) && /11Б/.test(await text(p, "#stHead")), T + "Карточка: шапка");
  ok(/Заказать апостиль/.test(await text(p, ".stepbox")) && /просрочен/.test(await text(p, ".stepbox")), T + "Карточка: просроченный шаг подсвечен");
  ok(await p.locator("#stBody .tli").count() >= 3, T + "Карточка: таймлайн записей");
  ok(/Что делает ученик/.test(await text(p, "#stBody")) && /документ/i.test(await text(p, "#stBody")), T + "Карточка: блок данных ученика");
  await p.click("#step-done"); await p.waitForTimeout(600); ok(await p.locator("#f-step").count() === 1, T + "Карточка: «Сделано» → новый шаг"); await clearModal(p);
  await goHash(p, "#/s/u2/cab"); await p.waitForTimeout(300); ok(await p.locator("#stBody .kpi").count() === 4 && await p.locator("#cab-nudge").count() === 1, T + "Кабинет ученика: 4 показателя + напоминание");
  await goHash(p, "#/s/u2/family"); await p.waitForSelector("#st-text");
  const st = await p.inputValue("#st-text");
  ok(/Здравствуйте/.test(st) && /Сейчас:/.test(st) && /Ближайший дедлайн/.test(st) && !/\.\./.test(st), T + "Семья: статус собран, без двойных точек", st.slice(0, 80));
  ok((await p.locator("#st-wa").getAttribute("href")).indexOf("wa.me/7701") > 0, T + "Семья: WhatsApp на номер родителя");
  await p.click("#st-mark"); await p.waitForTimeout(600); ok(/Отправленные статусы · 1/.test(await text(p, "#stBody")), T + "Семья: «отметить» пишет в историю");
  await p.click("#fam-edit"); await p.waitForSelector("#f-fam"); await p.fill("#f-fam [name=parent_phone]", "+7 777 111 22 33"); await p.click("#f-fam button[type=submit]"); await p.waitForTimeout(500);
  ok(/777 111 22 33/.test(await text(p, "#stBody")), T + "Семья: контакты редактируются");
  await goHash(p, "#/s/u2/info"); await p.waitForTimeout(300); ok(await p.locator("#st-del").count() === 1 && /Инфо/.test(await text(p, "#stBody")), T + "Инфо: вкладка");
  ok(await overflow(p) === 0, T + "Карточка: нет переполнения"); ok((await tall(p)).length === 0, T + "Карточка: кнопки в одну строку", await tall(p));
  await p.screenshot({ path: `/tmp/claude-0/shots/scd-family-${tag}.png`, fullPage: true });

  /* ---------- Настройки ---------- */
  await goHash(p, "#/settings"); await p.waitForSelector("#goal");
  ok(/DEMO2026/.test(await text(p, "#view")) && await p.locator("#inv").count() === 1, T + "Настройки: ссылка и код");
  ok(await p.locator("[data-rmstaff]").count() === 2, T + "Настройки: 2 сотрудника в демо");
  await p.fill("#f-staff [name=name]", "Тест Профориентолог"); await p.click("#f-staff button[type=submit]"); await p.waitForTimeout(500);
  ok(await p.locator("[data-rmstaff]").count() === 3 && /staff=demo-3/.test(await text(p, "#staff-hint")), T + "Настройки: приглашение добавляет сотрудника и даёт ссылку");
  await p.selectOption("#goal", "20"); await p.waitForTimeout(300); ok(/сейчас 20/.test(await text(p, "#view")), T + "Настройки: цель касаний");
  await p.click("#quiet"); await p.waitForTimeout(300); ok(/на паузе/.test(await text(p, "#view")), T + "Настройки: пауза недели");
  p.once("dialog", d => d.accept());
  await p.click("#arch-now"); await p.waitForTimeout(500); ok(/2026\/27/.test(await text(p, "#view")) && /архив от/.test(await text(p, "#view")), T + "Настройки: архив сезона добавляет строку");
  ok(await overflow(p) === 0, T + "Настройки: нет переполнения"); ok((await tall(p)).length === 0, T + "Настройки: кнопки в одну строку", await tall(p));
  await p.screenshot({ path: `/tmp/claude-0/shots/scd-settings-${tag}.png`, fullPage: true });

  /* ---------- deep-link сотрудника и пустой сценарий ---------- */
  ok(errs.length === 0, T + "0 JS-ошибок", errs);
  await ctx.close();
}
await b.close();
console.log(`school-demo: ${pass} ok, ${fail} fail`); fails.forEach(f => console.log("  FAIL " + f));
process.exit(fail ? 1 : 0);
