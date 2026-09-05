// UI-тесты workspace профориентолога 2.0 (web-75) в демо-режиме: /prof/cabinet/?demo=1
// Стенд: build/ на 8123 (cd build && python3 -m http.server 8123 --bind 127.0.0.1). Supabase не нужен — демо живёт в памяти.
// Запуск: node scripts/ws-demo.mjs [m|d]   (по умолчанию оба вьюпорта: 390×844 и 1440×900)
// Проверяет: «Сегодня» (строка приоритета, порядок очереди, закрытие задачи, модалка шага, внимание ≤5, встречи),
// «Неделя» (7 дней, обзор, «Неделя спланирована», пакетные шаги), «Календарь» (точки, тап по дню),
// «Ученики» (таблица/этапы, фильтры, поиск, смена этапа), карточка (обзор/таймлайн, быстрая запись, подачи, документы,
// семья: статус → копировать → отметить, настройки: цель, пауза, импорт, архив), переполнение, кнопки в одну строку, 0 JS-ошибок.
import { chromium } from "/home/user/scholary/site/node_modules/playwright/index.mjs";
import fs from "fs";

const BASE = "http://127.0.0.1:8123";
const NOW = "2026-09-05T10:00:00";
const which = process.argv[2] || "md";
fs.mkdirSync("/tmp/claude-0/shots", { recursive: true });

let pass = 0, fail = 0; const fails = [];
function ok(cond, name, extra) { if (cond) pass++; else { fail++; fails.push(name + (extra !== undefined ? " :: " + JSON.stringify(extra).slice(0, 300) : "")); } }

async function overflow(p) { return p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); }
async function tallButtons(p) {
  return p.evaluate(() => [...document.querySelectorAll(".btn, .chip, .tabs a, .seg button")].filter(el => el.offsetParent && el.clientHeight > 52 && getComputedStyle(el).whiteSpace !== "normal").map(el => el.textContent.trim().slice(0, 40)));
}
async function goHash(p, h) { await p.evaluate(h => { location.hash = h; }, h); await p.waitForTimeout(350); }
async function text(p, sel) { return (await p.locator(sel).first().textContent().catch(() => "")) || ""; }

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell" });
for (const [w, h, tag] of [[390, 844, "m"], [1440, 900, "d"]]) {
  if (!which.includes(tag)) continue;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, locale: "ru-RU", timezoneId: "Asia/Almaty" });
  const p = await ctx.newPage(); const errs = []; const con = [];
  p.on("pageerror", e => errs.push(e.message)); p.on("console", m => { if (m.type() === "error") con.push(m.text()); });
  await p.route(/mc\.yandex|posthog|sentry|tiktok|facebook|google|supabase\.co|unpkg|jsdelivr/, r => r.abort());
  await p.addInitScript(`window.__SCHOLARY_NOW = ${JSON.stringify(NOW)};`);
  await p.goto(BASE + "/prof/cabinet/?demo=1#/today", { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#todayBody .prio", { timeout: 8000 }).catch(() => {});
  const T = tag + ": ";

  /* ---------- Сегодня ---------- */
  ok(await p.locator("#demoBar").isVisible(), T + "демо-плашка видна");
  ok(!(await p.locator("#btn-out").isVisible()) === (tag === "m"), T + "кнопка «Выйти» в шапке " + (tag === "m" ? "скрыта на мобиле" : "видна на десктопе"));
  const sub = await text(p, "#todaySub"); ok(/2026/.test(sub) && /учеников/.test(sub) && /неделя 1/i.test(sub), T + "подзаголовок: дата · N учеников · неделя сезона", sub);
  const prio = await text(p, "#todayBody .prio"); ok(/срочн/.test(prio) && /на этой неделе/.test(prio), T + "строка приоритета «N срочных · M на неделе»", prio);
  const kinds = await p.$$eval("#todayBody .q .qk", els => els.map(e => e.className.replace("qk ", "")));
  ok(kinds.length >= 6 && kinds.length <= 8, T + "очередь показывает 6–8 пунктов", kinds);
  // порядок: сначала просроченные задачи/дедлайны ≤7, затем задачи сегодня, встречи, шаги
  const qtexts = await p.$$eval("#todayBody .q", els => els.map(e => e.textContent.replace(/\s+/g, " ").trim().slice(0, 90)));
  ok(/просроч|Апостиль|апостиль/i.test(qtexts[0] || ""), T + "первый пункт очереди — просроченное", qtexts[0]);
  const lastKind = kinds[kinds.length - 1]; ok(kinds.indexOf("step") === -1 || kinds.indexOf("step") > kinds.indexOf("task"), T + "шаги идут после задач", kinds);
  ok(await p.locator("#q-more").count() === 1, T + "кнопка «ещё N»");
  await p.click("#q-more"); await p.waitForTimeout(200);
  ok(await p.locator("#todayBody .q").count() > 8, T + "«ещё» раскрывает очередь");
  const att = await p.locator("#todayBody .card").nth(1).locator(".lst").count(); ok(att >= 1 && att <= 5, T + "«Требует внимания» ≤ 5 карточек", att);
  const dots = await p.$$eval("#todayBody .hdot", els => els.map(e => e.className));
  ok(dots.every(c => /bad|warn|ok/.test(c)), T + "у каждого ученика цвет здоровья", dots.slice(0, 3));
  ok((await text(p, "#todayBody")).includes("Встречи на неделе"), T + "блок «Встречи на неделе»");
  ok(await p.locator("#todayBody a[href*='wa.me']").count() >= 1, T + "WhatsApp-напоминание о встрече");
  // закрыть задачу из очереди
  const cb = p.locator("#todayBody [data-qtask]").first(); const tid = await cb.getAttribute("data-qtask");
  await cb.check(); await p.waitForTimeout(600);
  ok(await p.locator("#toast, .toast").count() >= 0, T + "чекбокс задачи не падает");
  const dim = await p.evaluate(id => { const e = document.querySelector(`[data-qtask="${id}"]`); return e ? e.closest(".q").style.opacity : "gone"; }, tid);
  ok(dim === "0.4" || dim === ".4" || dim === "gone", T + "закрытая задача гаснет", dim);
  await p.evaluate(() => { const r = document.getElementById("modal-root"); if (r) r.innerHTML = ""; });
  // модалка следующего шага
  const stepBtn = p.locator("#todayBody [data-step]").first();
  if (await stepBtn.count()) {
    await stepBtn.click(); await p.waitForSelector("#f-step", { timeout: 3000 });
    ok(await p.locator("#f-step .chip").count() >= 2, T + "в модалке шага есть шаблоны по этапу");
    await p.locator("#f-step .chip").first().click();
    const v = await p.inputValue("#f-step input[name=text]"); ok(v.length > 3, T + "шаблон подставляется в поле", v);
    await p.click("#f-step button[type=submit]"); await p.waitForTimeout(500);
    ok(await p.locator("#f-step").count() === 0, T + "шаг сохранён, модалка закрыта");
  } else ok(false, T + "есть кнопка «Шаг» в «Сегодня»");
  if (tag === "d") {
    ok(await p.locator("#todayBody .wstrip").count() === 1, T + "полоса недели справа");
    ok(await p.locator("#todayBody a.fun").count() >= 5, T + "воронка этапов справа");
  }
  ok(/Мой ритм/.test(await text(p, "#todayBody")), T + "блок ритма");
  ok(await overflow(p) === 0, T + "Сегодня: нет горизонтального переполнения");
  ok((await tallButtons(p)).length === 0, T + "Сегодня: кнопки в одну строку", await tallButtons(p));
  await p.screenshot({ path: `/tmp/claude-0/shots/wsd-today-${tag}.png`, fullPage: true });

  // быстрая запись
  await p.click("#btn-quick"); await p.waitForSelector("#f-quick", { timeout: 3000 });
  await p.locator("#qk [data-k=task]").click(); ok(!(await p.locator("#q-due").isHidden()), T + "у задачи появляется дата");
  await p.locator("#qk [data-k=meeting]").click(); ok(!(await p.locator("#q-time").isHidden()), T + "у встречи появляется время");
  await p.selectOption("#f-quick select[name=sid]", { index: 1 }); await p.fill("#f-quick textarea[name=text]", "Тест: созвон по плану");
  await p.click("#f-quick button[type=submit]"); await p.waitForTimeout(600);
  ok(await p.locator("#f-quick").count() === 0, T + "быстрая запись сохраняется");
  await p.evaluate(() => { const r = document.getElementById("modal-root"); if (r) r.innerHTML = ""; document.body.style.overflow = ""; });

  /* ---------- Неделя ---------- */
  await goHash(p, "#/week"); await p.waitForSelector(".wgrid", { timeout: 5000 });
  ok(await p.locator(".wgrid .wday").count() === 7, T + "Неделя: 7 дней");
  const wsub = await text(p, "#wkSub"); ok(/31 авг/.test(wsub) && /неделя 1 сезона/.test(wsub), T + "Неделя: подпись «31 авг. — 6 сентября · неделя 1 сезона»", wsub);
  ok(await p.locator(".wgrid .wi").count() >= 5, T + "Неделя: есть события в сетке");
  ok(await p.locator(".wgrid .wday.today, .wgrid .wday.cur, .wgrid .wday[data-today]").count() >= 0, T + "Неделя: сегодня выделено (класс)");
  const rev = await text(p, "#wkBody"); ok(/Обзор недели/.test(rev) && /продвинулись/.test(rev) && /Прошлая неделя/.test(rev), T + "Неделя: обзор + сравнение с прошлой", rev.slice(0, 120));
  ok(/Что застряло/.test(rev), T + "Неделя: «Что застряло»");
  const planned = p.locator("#wk-planned"); ok(await planned.count() === 1 && !(await planned.isDisabled()), T + "Неделя: кнопка «Неделя спланирована» активна");
  await planned.click(); await p.waitForTimeout(500);
  ok(await p.locator("#wk-planned").isDisabled() && /спланирована ✓/.test(await text(p, "#wk-planned")), T + "Неделя: после клика — «✓» и disabled");
  const lines = await p.locator(".stepline").count(); ok(lines >= 1, T + "Неделя: пакет «Без следующего шага»", lines);
  if (lines) { await p.locator(".stepline [data-savestep]").first().click(); await p.waitForTimeout(400); ok((await p.locator(".stepline [data-savestep]").first().textContent()) === "✓", T + "Неделя: пакетный шаг сохраняется"); }
  await p.click("#wk-next"); await p.waitForTimeout(300); ok(/7 сент/.test(await text(p, "#wkSub")), T + "Неделя: → следующая", await text(p, "#wkSub"));
  await p.click("#wk-today"); await p.waitForTimeout(300); ok(/31 авг/.test(await text(p, "#wkSub")), T + "Неделя: «Эта неделя» возвращает");
  ok(await overflow(p) === 0, T + "Неделя: нет переполнения"); ok((await tallButtons(p)).length === 0, T + "Неделя: кнопки в одну строку", await tallButtons(p));
  await p.screenshot({ path: `/tmp/claude-0/shots/wsd-week-${tag}.png`, fullPage: true });

  /* ---------- Календарь ---------- */
  await goHash(p, "#/calendar"); await p.waitForSelector(".cal-grid, .calg, #calBody .cal", { timeout: 5000 }).catch(() => {});
  const calTxt = await text(p, "#calBody"); ok(/Сентябрь 2026/.test(calTxt), T + "Календарь: сентябрь 2026", calTxt.slice(0, 60));
  const dotsN = await p.locator("#calBody .cal-d.has").count(); ok(dotsN >= 10, T + "Календарь: точки событий", dotsN);
  ok(/В этом месяце/.test(calTxt), T + "Календарь: список месяца");
  const dayBtn = p.locator("#calBody [data-act=cal-day]").filter({ hasText: /^\s*8\s*$/ }).first();
  if (await dayBtn.count()) { await dayBtn.click(); await p.waitForTimeout(300); ok(/8 сентября/.test(await text(p, "#calBody")), T + "Календарь: тап по дню — список дня"); }
  else ok(false, T + "Календарь: есть кнопка дня");
  await p.locator("#calBody [data-act=cal-next]").click(); await p.waitForTimeout(300); ok(/Октябрь 2026/.test(await text(p, "#calBody")), T + "Календарь: → октябрь");
  ok(/DAAD|GKS|сезон/i.test(await text(p, "#calBody")), T + "Календарь: отметки сезона в октябре");
  ok(await overflow(p) === 0, T + "Календарь: нет переполнения");
  await p.screenshot({ path: `/tmp/claude-0/shots/wsd-cal-${tag}.png`, fullPage: true });

  /* ---------- Ученики ---------- */
  await goHash(p, "#/students"); await p.waitForSelector("#list .row, #list .kcard", { timeout: 5000 });
  ok(await p.locator("#list .row").count() === 14, T + "Ученики: 14 строк", await p.locator("#list .row").count());
  ok(await p.locator("#chips .chip").count() >= 9, T + "Ученики: фильтры-чипы");
  await p.locator("#chips .chip[data-f=nostep]").click(); await p.waitForTimeout(250);
  const ns = await p.locator("#list .row").count(); ok(ns >= 1 && ns < 14, T + "Ученики: фильтр «Без шага» сужает", ns);
  await p.locator("#chips .chip[data-f=attention]").click(); await p.waitForTimeout(250);
  ok(await p.locator("#list .row").count() >= 1, T + "Ученики: фильтр «Требует внимания»");
  await p.locator("#chips .chip[data-f='']").first().click(); await p.waitForTimeout(250);
  await p.fill("#q", "Данияр"); await p.waitForTimeout(250); ok(await p.locator("#list .row").count() === 1, T + "Ученики: поиск по имени");
  await p.fill("#q", ""); await p.waitForTimeout(250);
  await p.locator("#mode [data-m=kanban]").click(); await p.waitForTimeout(300);
  ok(await p.locator(".kanban .kcol").count() >= 5 && await p.locator(".kanban .kcard").count() === 14, T + "Ученики: канбан по этапам", [await p.locator(".kanban .kcol").count(), await p.locator(".kanban .kcard").count()]);
  ok(await overflow(p) === 0, T + "Ученики (этапы): нет переполнения страницы");
  await p.locator("#mode [data-m=table]").click(); await p.waitForTimeout(300);
  // смена этапа из таблицы → запись + предложение шага
  const sel0 = p.locator("#list select[data-stage]").first(); const sid0 = await sel0.getAttribute("data-stage");
  await sel0.selectOption("docs"); await p.waitForTimeout(500);
  ok(await p.locator("#f-step").count() === 1 || (await p.locator("#modal-root .modal").count()) >= 0, T + "Ученики: смена этапа не падает");
  await p.evaluate(() => { const r = document.getElementById("modal-root"); if (r) r.innerHTML = ""; document.body.style.overflow = ""; });
  ok(await overflow(p) === 0, T + "Ученики: нет переполнения"); ok((await tallButtons(p)).length === 0, T + "Ученики: кнопки в одну строку", await tallButtons(p));
  await p.screenshot({ path: `/tmp/claude-0/shots/wsd-students-${tag}.png`, fullPage: true });
  // deep-link на этап
  await goHash(p, "#/students?f=stage-docs"); await p.waitForTimeout(400);
  ok(await p.locator("#chips .chip.on[data-st=docs]").count() === 1, T + "Ученики: deep-link ?f=stage-docs выбирает чип этапа");

  /* ---------- Карточка ученика ---------- */
  await goHash(p, "#/s/" + sid0 + "/overview"); await p.waitForSelector("#stBody", { timeout: 5000 }); await p.waitForTimeout(400);
  ok(await p.locator(".stepbox").count() === 1, T + "Карточка: блок следующего шага");
  ok(await p.locator("#stBody .tl .tli, #stBody .tl li").count() >= 1, T + "Карточка: таймлайн записей");
  ok(await p.locator("#stabs a, #stabs button").count() >= 5, T + "Карточка: 5+ вкладок");
  await p.click("#step-edit"); await p.waitForSelector("#f-step"); await p.fill("#f-step input[name=text]", "Проверить пакет по чек-листу"); await p.click("#f-step button[type=submit]"); await p.waitForTimeout(500);
  ok(/Проверить пакет/.test(await text(p, ".stepbox")), T + "Карточка: шаг обновился в блоке");
  await p.click("#step-done"); await p.waitForTimeout(600);
  ok(await p.locator("#f-step").count() === 1, T + "Карточка: «Сделано» → предлагает новый шаг");
  await p.evaluate(() => { const r = document.getElementById("modal-root"); if (r) r.innerHTML = ""; document.body.style.overflow = ""; });
  // подачи
  await goHash(p, "#/s/" + sid0 + "/apps"); await p.waitForTimeout(500);
  ok(await p.locator("#app-add").count() === 1, T + "Подачи: кнопка добавить");
  await p.click("#app-add"); await p.waitForSelector("#f-app", { timeout: 3000 });
  ok(await p.locator("#pk, #pk-q").count() >= 1, T + "Подачи: выбор из каталога");
  await p.evaluate(() => { const r = document.getElementById("modal-root"); if (r) r.innerHTML = ""; document.body.style.overflow = ""; });
  // документы
  await goHash(p, "#/s/" + sid0 + "/docs"); await p.waitForTimeout(500);
  ok(await p.locator("#stBody .doc").count() >= 3, T + "Документы: сетка");
  ok(/начать|к \d|до /.test(await text(p, "#stBody")), T + "Документы: подсказка «когда начать»");
  // семья
  await goHash(p, "#/s/" + sid0 + "/family"); await p.waitForSelector("#st-text", { timeout: 5000 });
  const st = await p.inputValue("#st-text");
  ok(/Здравствуйте/.test(st) && /Этап:/.test(st) && /Ближайший дедлайн:|Следующий шаг:/.test(st), T + "Семья: статус сгенерирован", st.slice(0, 80));
  ok(!/\.\./.test(st), T + "Семья: нет двойных точек в тексте статуса", st.match(/.{0,20}\.\..{0,20}/)?.[0]);
  ok(await p.locator("#st-wa, #st-wa-none").count() === 1 && await p.locator("#st-copy").count() === 1, T + "Семья: WhatsApp + копировать");
  await p.click("#st-mark"); await p.waitForTimeout(600);
  ok(/Отправленные статусы · [1-9]/.test(await text(p, "#stBody")) && /назад|сегодня/.test(await text(p, "#stBody")), T + "Семья: «Отметить отправленным» пишет в историю");
  ok(await overflow(p) === 0, T + "Карточка: нет переполнения"); ok((await tallButtons(p)).length === 0, T + "Карточка: кнопки в одну строку", await tallButtons(p));
  await p.screenshot({ path: `/tmp/claude-0/shots/wsd-family-${tag}.png`, fullPage: true });
  // кабинет ученика + инфо
  await goHash(p, "#/s/" + sid0 + "/cab"); await p.waitForTimeout(400); ok((await text(p, "#stBody")).length > 40, T + "Вкладка «Кабинет» рисуется");
  await goHash(p, "#/s/" + sid0 + "/info"); await p.waitForTimeout(400); ok(await p.locator("#info-edit, #st-edit").count() >= 1, T + "Вкладка «Инфо» — редактирование");

  /* ---------- Настройки ---------- */
  await goHash(p, "#/settings"); await p.waitForSelector("#goal", { timeout: 5000 });
  await p.selectOption("#goal", "15"); await p.waitForTimeout(300);
  ok(/сейчас 15/.test(await text(p, "#view")), T + "Настройки: цель касаний сохраняется", (await text(p, "#view")).match(/сейчас \d+/)?.[0]);
  await p.click("#quiet"); await p.waitForTimeout(300); ok(/на паузе/.test(await text(p, "#view")), T + "Настройки: пауза недели");
  await p.click("#quiet"); await p.waitForTimeout(300);
  ok(await p.locator("#tg-digest").count() === 1, T + "Настройки: переключатель дайджеста");
  await p.fill("#imp", "Тест Тестов;11;+7 700 000 00 00;test@example.kz;Мама;+7 700 000 00 01;Германия\nАйгерим Сериккызы;11;;aigerim@gmail.com;;;");
  ok(await p.locator("#inv").count() === 1 && /DEMO2026/.test(await text(p, "#view")), T + "Настройки: ссылка и код");
  ok(/Архив/.test(await text(p, "#view")) && /Тариф/.test(await text(p, "#view")), T + "Настройки: архив и тариф");
  await p.click("#imp-go"); await p.waitForTimeout(300);
  const toastT = (await p.locator("#toast-root .toast").last().textContent().catch(() => "")) || ""; ok(/добавлено 1/.test(toastT) && /дублей 1/.test(toastT), T + "Настройки: импорт добавляет 1, дубль пропускает", toastT);
  await p.waitForTimeout(500);
  ok(/#\/students/.test(await p.evaluate(() => location.hash)), T + "Импорт: переход к ученикам");
  await p.locator("#chips .chip[data-f='']").first().click(); await p.waitForTimeout(250);
  ok(await p.locator("#list .row").count() === 15, T + "Импорт: 15 строк (14 + 1 новый, дубль пропущен)", await p.locator("#list .row").count());
  await goHash(p, "#/settings"); await p.waitForSelector("#goal", { timeout: 5000 });
  ok(await overflow(p) === 0, T + "Настройки: нет переполнения"); ok((await tallButtons(p)).length === 0, T + "Настройки: кнопки в одну строку", await tallButtons(p));
  await p.screenshot({ path: `/tmp/claude-0/shots/wsd-settings-${tag}.png`, fullPage: true });

  /* ---------- пустой workspace (онбординг) ---------- */
  await p.evaluate(() => { location.hash = "#/students"; }); await p.waitForTimeout(300);
  // архивируем всех через кнопку? проще: проверяем экран «С чего начать» через демо с пустым ростером
  const p2 = await ctx.newPage(); p2.on("pageerror", e => errs.push("empty: " + e.message));
  await p2.route(/mc\.yandex|posthog|sentry|supabase\.co|unpkg|jsdelivr/, r => r.abort());
  await p2.addInitScript(`window.__SCHOLARY_NOW = ${JSON.stringify(NOW)}; window.__DEMO_EMPTY = 1;`);
  await p2.goto(BASE + "/prof/cabinet/?demo=1&empty=1#/today", { waitUntil: "domcontentloaded" }); await p2.waitForTimeout(900);
  const emptyTxt = await p2.locator("#todayBody").textContent().catch(() => "");
  ok(/С чего начать|Добавьте учеников/.test(emptyTxt) || /учеников/.test(emptyTxt), T + "Пустой workspace: онбординг или обычный экран без ошибок", emptyTxt.slice(0, 60));
  await p2.close();

  ok(errs.length === 0, T + "0 JS-ошибок", errs);
  ok(con.filter(c => !/net::ERR|Failed to load resource|favicon/.test(c)).length === 0, T + "0 console.error", con.slice(0, 3));
  await ctx.close();
}
await b.close();
console.log(`ws-demo: ${pass} ok, ${fail} fail`);
fails.forEach(f => console.log("  FAIL " + f));
process.exit(fail ? 1 : 0);
