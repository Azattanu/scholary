// Проверка трекера визитов (js/telemetry.js, web-77): что уходит в visit_ping.
// · view при загрузке с utm/тегом ?s=, реферером, устройством; · тот же sid на второй странице, реферер не повторяется;
// · beat с секундами активности при уходе (pagehide) и при скрытии вкладки; · event + track('wa_click') по клику на wa.me;
// · /admin не шлёт ничего; · ?demo=1 попадает в page; · 0 JS-ошибок. Запуск: node scripts/e2e-visits.mjs (нужен build/ и сервер 8123)
import { chromium } from '/home/user/scholary/site/node_modules/playwright/index.mjs';
const BASE = 'http://127.0.0.1:8123';
let pass = 0, fail = 0; const fails = [];
function ok(c, n, x) { if (c) pass++; else { fail++; fails.push(n + (x !== undefined ? ' :: ' + JSON.stringify(x).slice(0, 300) : '')); } }
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
const pings = [], events = [];
await ctx.route(u => /supabase\.co/.test(u.href), async r => {
  const u = r.request().url();
  if (/rpc\/visit_ping/.test(u)) { try { pings.push(JSON.parse(r.request().postData() || '{}').p); } catch (e) { pings.push({ bad: true }); } return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
  if (/rest\/v1\/events/.test(u)) { try { events.push(JSON.parse(r.request().postData() || '{}')); } catch (e) {} return r.fulfill({ status: 201, body: '' }); }
  return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});
await ctx.route(u => !/^http:\/\/127\.0\.0\.1:8123/.test(u.href) && !/supabase\.co/.test(u.href), r => r.abort());
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
/* keepalive-запрос при уходе со страницы Playwright уже не может «ответить» (страница выгружается),
   поэтому beat при pagehide ловим по факту отправки, а не по перехвату */
const sent = []; p.on('request', r => { if (/visit_ping/.test(r.url())) { try { sent.push(JSON.parse(r.postData() || '{}').p); } catch (e) {} } });
await p.goto(BASE + '/?s=WA-School&utm_source=tiktok&utm_medium=cpc&ttclid=abc123', { waitUntil: 'domcontentloaded', referer: 'https://www.tiktok.com/' });
await p.waitForTimeout(700);
const v1 = pings.find(x => x && x.kind === 'view');
ok(!!v1, 'view ушёл');
ok(v1 && /^[a-z0-9-]{8,48}$/.test(v1.sid), 'sid валидный', v1 && v1.sid);
ok(v1 && v1.page === '/' && v1.tag === 'wa-school' && v1.device === 'mobile' && v1.lang && v1.ref === 'https://www.tiktok.com/', 'view: страница, тег (в нижнем регистре), устройство, реферер', v1);
ok(v1 && v1.utm && v1.utm.utm_source === 'tiktok' && v1.utm.ttclid === 'abc123', 'view: utm и ttclid', v1 && v1.utm);
ok(v1 && v1.lead_id === null, 'первый view до app.js: lead_id ещё нет (сервер дополнит его из beat)', v1 && v1.lead_id);
ok(await p.evaluate(() => JSON.parse(sessionStorage.getItem('scholary_utm') || '{}').s === 'wa-school'), 'app.js utm(): ?s попал в scholary_utm');
// активность и уход
await p.waitForTimeout(1600);
await p.goto(BASE + '/prof/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
const beat = sent.find(x => x && x.kind === 'beat');
ok(beat && beat.sid === v1.sid && beat.active_s >= 1 && beat.active_s <= 5, 'beat при уходе со страницы с секундами активности (keepalive)', sent);
const v2 = pings.filter(x => x && x.kind === 'view')[1];
ok(v2 && v2.sid === v1.sid && v2.page === '/prof/' && v2.ref === '' && v2.tag === 'wa-school', 'вторая страница: тот же sid, тег сохранён, реферер пустой', v2);
// скрытие вкладки → beat
await p.evaluate(() => { Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await p.waitForTimeout(300);
ok(pings.filter(x => x && x.kind === 'beat').length >= 1 && pings.some(x => x && x.kind === 'beat' && /^[0-9a-fA-F-]{20,64}$/.test(x.lead_id || '')), 'beat при скрытии вкладки несёт lead_id из app.js', pings.filter(x => x && x.kind === 'beat'));
await p.evaluate(() => { Object.defineProperty(document, 'hidden', { get: () => false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
// клик WhatsApp
const n0 = events.length;
await p.evaluate(() => { const a = document.createElement('a'); a.href = 'https://wa.me/77024666852?text=hi'; a.id = 'waTest'; a.textContent = 'Написать'; a.addEventListener('click', e => e.preventDefault()); document.body.appendChild(a); });
await p.click('#waTest'); await p.waitForTimeout(500);
const evp = pings.find(x => x && x.kind === 'event');
ok(evp && evp.sid === v1.sid, 'клик wa.me → visit_ping event', evp);
ok(events.slice(n0).some(e => e.event === 'wa_click' && e.utm && e.utm.s === 'wa-school'), 'клик wa.me → track(wa_click) в events с меткой', events.slice(n0).map(e => e.event));
// демо-кабинет
await p.goto(BASE + '/schools/cabinet/?demo=1', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
const v3 = pings.filter(x => x && x.kind === 'view').pop();
ok(v3 && v3.page === '/schools/cabinet/?demo=1', 'демо-кабинет: page с ?demo=1', v3 && v3.page);
// админка — тишина
const before = pings.length;
await p.goto(BASE + '/admin/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(900);
ok(pings.length === before, '/admin ничего не шлёт', pings.length - before);
ok(pings.every(x => x && !x.bad && !('name' in x) && !('phone' in x) && !('email' in x)), 'персональных полей нет');
ok(errs.length === 0, '0 JS-ошибок', errs);
await b.close();
console.log(`visits: ${pass} ok, ${fail} fail`); fails.forEach(f => console.log('  FAIL ' + f));
process.exit(fail ? 1 : 0);
