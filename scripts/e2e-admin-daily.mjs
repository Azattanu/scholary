// UI-тест вкладки «День» и меток ссылок в админке (web-77) на заглушке RPC (scripts/stub-admin.js).
// Проверяет: вкладка «День» открывается первой, 16 KPI в 4 группах с дельтами, 2 почасовых графика (24 столбца),
// воронка дня, каналы, страницы, лента, таблица 14 дней, навигация по дням (вчера/сегодня/‹/›/дата),
// метки ссылок во вкладке «Каналы» (список, ссылки на 4 страницы, форма), период скрыт на «Дне»,
// кнопки в одну строку, нет горизонтального переполнения, 0 JS-ошибок. 1280 и 390. Запуск: node scripts/e2e-admin-daily.mjs
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = '/home/user/scholary/site/build';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const STUB = fs.readFileSync('/home/user/scholary/site/scripts/stub-admin.js', 'utf8');
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  let body = fs.readFileSync(f);
  if (p === '/admin/index.html') body = Buffer.from(String(body).replace('<script src="/js/admin.js', '<script>' + STUB + '</script>\n<script src="/js/admin.js'));
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(body); });
await new Promise(r => srv.listen(8091, r));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
for (const [w, h, tag] of [[1280, 1000, 'desktop'], [390, 850, 'mobile']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, timezoneId: 'America/New_York' }); // браузер нарочно не в Алматы
  await ctx.route('**', r => r.request().url().startsWith('http://127.0.0.1:8091') ? r.continue() : r.fulfill({ status: 200, headers: { 'Content-Type': 'application/javascript' }, body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  p.on('dialog', d => d.accept());
  await p.goto('http://127.0.0.1:8091/admin/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await p.waitForTimeout(1500);
  const T = tag + ': ';
  const st = await p.evaluate(() => ({
    onTab: document.querySelector('#tabs button.on')?.getAttribute('data-t'), segHidden: document.getElementById('periodSeg').hidden,
    groups: [...document.querySelectorAll('#view .kgrp h3')].map(e => e.textContent), kpis: document.querySelectorAll('#view .kgrp .kpi').length,
    deltas: document.querySelectorAll('#view .kpi .delta').length, up: document.querySelectorAll('#view .delta.up').length, down: document.querySelectorAll('#view .delta.down').length,
    charts: [...document.querySelectorAll('#view svg.chart')].map(s => s.querySelectorAll('rect').length), h2: [...document.querySelectorAll('#view h2')].map(e => e.textContent),
    frows: document.querySelectorAll('#view .frow').length, tables: document.querySelectorAll('#view table.adm').length,
    txt: document.getElementById('view').innerText.replace(/[  ]/g, ' '), title: document.querySelector('.daytitle')?.textContent,
    over: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    rpc: (window.__RPC_LOG || []).map(x => x.fn + ':' + JSON.stringify(x.args)) }));
  ok(st.onTab === 'day', T + 'первая вкладка — «День»');
  ok(st.segHidden === true, T + 'переключатель периода скрыт на «Дне»');
  ok(st.groups.join('|') === 'Деньги|Квиз|Визиты|Кабинеты и B2B', T + '4 группы KPI: ' + st.groups.join('|'));
  ok(st.kpis === 16, T + '16 карточек (' + st.kpis + ')');
  ok(st.deltas === 32 && st.up > 0 && st.down > 0, T + 'у каждой карточки 2 дельты, есть рост и падение (' + st.deltas + '/' + st.up + '/' + st.down + ')');
  ok(/Вчера, 5 сентября|вс, 5 сентября|сб, 5 сентября/.test(st.title || ''), T + 'заголовок дня: ' + st.title);
  ok(st.rpc.some(x => x.startsWith('admin_day:') && /"p_day":"\d{4}-\d{2}-\d{2}"/.test(x)) && st.rpc.some(x => x.startsWith('admin_days:{"p_days":14}')), T + 'запросы admin_day(p_day) и admin_days(14)');
  ok(st.charts.length === 2 && st.charts[0] >= 24 && st.charts[1] >= 72, T + '2 почасовых графика (' + st.charts.join(',') + ' прямоугольников)');
  ok(st.frows === 7, T + 'воронка дня: 7 шагов');
  ok(/Каналы за день/.test(st.h2.join()) && /TikTok · реклама/.test(st.txt) && /WhatsApp · школам/.test(st.txt), T + 'каналы дня с метками ссылок');
  ok(/Страницы за день/.test(st.h2.join()) && /\/schools\/cabinet\/\?demo=1/.test(st.txt), T + 'страницы дня, демо-кабинет отдельно');
  ok(/Лента дня/.test(st.h2.join()) && /оплата/.test(st.txt) && /Лицей № 1/.test(st.txt) && /4 000 ₸/.test(st.txt), T + 'лента: оплата, школа, сумма');
  ok(/Последние 14 дней/.test(st.h2.join()) && st.tables >= 4, T + 'таблица 14 дней есть');
  ok(/143/.test(st.txt) && /12 000 ₸/.test(st.txt) && /1 м 14 с/.test(st.txt) && /72% от открывших/.test(st.txt), T + 'числа: 143 заходов, 12 000 ₸, 1 м 14 с, 72% от открывших');
  ok(/из них Kaspi: 6/.test(st.txt), T + 'подпись «из них Kaspi»');
  ok(/14:12/.test(st.txt), T + 'время ленты показано по Алматы (14:12), а не по часовому поясу браузера');
  ok(!st.over, T + 'нет горизонтального переполнения');
  // навигация
  await p.click('.daynav [data-day="' + today + '"]'); await p.waitForTimeout(500);
  const t2 = await p.evaluate(() => ({ title: document.querySelector('.daytitle')?.textContent, pick: document.getElementById('dayPick').value, nextDis: document.querySelector('.daynav [data-day="next"]').disabled,
    faded: document.querySelectorAll('#view svg.chart rect[opacity=".18"]').length, note: /день ещё идёт/.test(document.querySelector('.daynav').innerText) }));
  ok(/^Сегодня/.test(t2.title || '') && t2.pick === today && t2.nextDis && t2.note, T + '«Сегодня»: заголовок, дата, › выключен, пометка: ' + t2.title);
  ok(t2.faded > 0, T + 'сегодня: будущие часы приглушены (' + t2.faded + ')');
  await p.click('.daynav [data-day="prev"]'); await p.waitForTimeout(400);
  const t3 = await p.$eval('.daytitle', e => e.textContent);
  ok(/^Вчера/.test(t3), T + '‹ от сегодня → вчера: ' + t3);
  await p.click('.daynav [data-day="prev"]'); await p.waitForTimeout(400);
  const t4 = await p.$eval('.daytitle', e => e.textContent);
  ok(/^(пн|вт|ср|чт|пт|сб|вс), /.test(t4), T + '‹ ещё раз → день недели: ' + t4);
  await p.evaluate(() => { const i = document.getElementById('dayPick'); i.value = '2026-09-01'; i.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(400);
  ok(/1 сентября/.test(await p.$eval('.daytitle', e => e.textContent)), T + 'выбор даты в календаре');
  // строка таблицы 14 дней кликабельна
  await p.click('#view table.adm a[data-day]'); await p.waitForTimeout(300);
  ok(/^Сегодня/.test(await p.$eval('.daytitle', e => e.textContent)), T + 'клик по строке в таблице дней открывает день');
  // вкладка «Каналы»: метки
  await p.click('#tabs button[data-t="channels"]'); await p.waitForTimeout(700);
  const ch = await p.evaluate(() => ({ segHidden: document.getElementById('periodSeg').hidden, h2: [...document.querySelectorAll('#view h2')].map(e => e.textContent),
    links: [...document.querySelectorAll('#view .taglink')].map(a => a.getAttribute('data-link')), rows: document.querySelectorAll('#view [data-act="tag-del"]').length, form: !!document.getElementById('btnTagSave') }));
  ok(ch.segHidden === false, T + 'период снова виден на «Каналах»');
  ok(/Ссылки с меткой/.test(ch.h2[0]) && ch.rows === 2 && ch.form, T + 'метки: 2 строки и форма');
  ok(ch.links.includes('https://scholary.kz/?s=wa-school') && ch.links.includes('https://scholary.kz/schools/?s=wa-school') && ch.links.includes('https://scholary.kz/prof/?s=ig-bio'), T + 'ссылки на 4 страницы с ?s=');
  await p.click('#btnTagSave'); await p.waitForTimeout(200);
  ok(/Нужны метка и название/.test(await p.$eval('#tagMsg', e => e.textContent)), T + 'валидация пустой формы метки');
  await p.fill('#tagId', 'QR-Almaty'); await p.fill('#tagLabel', 'QR · Алматы'); await p.click('#btnTagSave'); await p.waitForTimeout(500);
  const up = await p.evaluate(() => (window.__RPC_LOG || []).filter(x => x.fn === 'admin_link_tag_upsert').pop());
  ok(up && up.args.p_tag === 'qr-almaty' && up.args.p_label === 'QR · Алматы' && up.args.p_channel === 'whatsapp_schools', T + 'сохранение метки: ' + JSON.stringify(up && up.args));
  await p.click('#view [data-act="tag-del"]'); await p.waitForTimeout(400);
  ok((await p.evaluate(() => (window.__RPC_LOG || []).some(x => x.fn === 'admin_link_tag_delete' && x.args.p_tag === 'wa-school'))), T + 'удаление метки (после подтверждения)');
  // остальные вкладки живы
  for (const t of ['overview', 'money', 'funnel', 'people', 'system']) { await p.click('#tabs button[data-t="' + t + '"]'); await p.waitForTimeout(300); }
  ok((await p.evaluate(() => document.querySelectorAll('#view .box').length)) > 0, T + 'старые вкладки рисуются');
  await p.click('#tabs button[data-t="day"]'); await p.waitForTimeout(300);
  // вёрстка: кнопки в одну строку
  const tall = await p.evaluate(() => [...document.querySelectorAll('.btn-adm, #tabs button, .seg button')].filter(el => el.offsetParent && el.clientHeight > 50).map(el => el.textContent.trim().slice(0, 30)));
  ok(tall.length === 0, T + 'кнопки в одну строку ' + JSON.stringify(tall));
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)), T + 'нет переполнения после навигации');
  ok(errs.length === 0, T + 'без JS-ошибок ' + JSON.stringify(errs));
  await p.screenshot({ path: '/tmp/claude-0/shots/admin-day-' + tag + '.png', fullPage: true });
  await ctx.close();
}
await b.close(); srv.close(); console.log(fails ? ('FAILS ' + fails) : 'ALL OK'); process.exit(fails ? 1 : 0);
