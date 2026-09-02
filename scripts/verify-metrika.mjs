/* Проверка проводки Яндекс.Метрики на локальной сборке build/ (до выкладки).
   Настоящий tag.js подменяем заглушкой-регистратором, чтобы не слать мусор в счётчик,
   но проверяем: адрес запроса, id счётчика, параметры init, все вызовы reachGoal,
   маскировку полей для Вебвизора и наличие noscript-пикселя. */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/user/scholary/site/build';
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.xml':'application/xml','.txt':'text/plain'};
const srv = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, {'Content-Type': MIME[path.extname(f)] || 'application/octet-stream'});
  res.end(fs.readFileSync(f));
});
await new Promise(r=>srv.listen(8099, r));

const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--no-default-browser-check','--disable-domain-reliability','--metrics-recording-only','--disable-features=OptimizationHints,Translate,MediaRouter']});
const ctx = await b.newContext({viewport:{width:390,height:844}});
const tagReq = [];
const watchReq = [];
await ctx.route('**', async route => {
  const u = route.request().url();
  if (/mc\.yandex\.(ru|com)\/metrika\/tag/.test(u)) {
    tagReq.push(u);
    // заглушка вместо настоящего tag.js: сохраняет очередь вызовов в window.__ym
    return route.fulfill({status:200, headers:{'Content-Type':'text/javascript','access-control-allow-origin':'*'}, body:`
      (function(){ var q = (window.ym && window.ym.a) || [];
        window.__ym = []; q.forEach(function(a){ window.__ym.push(Array.prototype.slice.call(a)); });
        window.ym = function(){ window.__ym.push(Array.prototype.slice.call(arguments)); };
        window.__ymLoaded = true; })();`});
  }
  if (/mc\.yandex\.(ru|com)\/(watch|webvisor)/.test(u)) { watchReq.push(u.slice(0,60)); return route.fulfill({status:200, body:''}); }
  if (/posthog|sentry|tiptoppay|supabase\.co/.test(u)) return route.fulfill({status:200, headers:{'Content-Type':'application/json','access-control-allow-origin':'*'}, body:'{}'});
  if (u.startsWith('http://127.0.0.1:8099')) return route.continue();
  return route.fulfill({status:200, body:''});
});

const pages = ['/', '/quiz/', '/cabinet/', '/tariffs/', '/oferta/', '/privacy/', '/admin/', '/report/', '/demo/'];
const out = [];
for (const pg of pages) {
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e=>errs.push(e.message.slice(0,100)));
  tagReq.length = 0;
  await p.goto('http://127.0.0.1:8099'+pg, {waitUntil:'domcontentloaded'});
  await p.waitForTimeout(1200);
  const st = await p.evaluate(()=>{
    const calls = window.__ym || [];
    const init = calls.find(c=>c[1]==='init');
    const priv = document.querySelectorAll('.ym-disable-keys, .ym-hide-content').length;
    const ns = Array.from(document.querySelectorAll('noscript')).find(n=>/mc\.yandex\.ru\/watch\//.test(n.innerHTML));
    return {
      loaded: !!window.__ymLoaded,
      hasYm: typeof window.scholaryYm === 'function',
      id: init ? init[0] : null,
      init: init ? init[2] : null,
      calls: calls.length,
      privMarked: priv,
      noscript: !!ns,
      noscriptId: ns ? (ns.innerHTML.match(/watch\/(\d+)/)||[])[1] : null
    };
  });
  out.push({pg, tag: tagReq[0] ? tagReq[0].replace(/^https?:\/\//,'').slice(0,45) : null, ...st, errs: errs.length?errs:0});
  await p.close();
}
console.log('=== загрузка счётчика по страницам ===');
for (const r of out) console.log(`${r.pg.padEnd(11)} tag=${r.tag||'НЕТ'} id=${r.id} ym()=${r.hasYm} noscript=${r.noscript}(${r.noscriptId}) масок=${r.privMarked} ошибки=${JSON.stringify(r.errs)}`);
console.log('\n=== параметры init (главная) ===');
console.log(JSON.stringify(out[0].init));

// теперь цели: прогоняем track() на квизе
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:8099/quiz/', {waitUntil:'domcontentloaded'});
await p.waitForTimeout(1200);
const goals = await p.evaluate(async ()=>{
  const before = (window.__ym||[]).length;
  window.track('quiz_start', {step:1});
  window.track('cta_tariff_consult', {});
  window.track('cta_tariff_package', {});
  window.track('pay_result', {type:'payment', status:'success', kind:'report'});
  window.track('pay_result', {type:'installmentKz', status:'appointment', kind:'report'});
  window.track('pay_result', {type:'payment', status:'success', kind:'pro_month'});
  window.track('pay_result', {type:'payment', status:'success', kind:'pro_season'});
  window.track('pay_result', {type:'cancel', status:'cancel', kind:'report'});
  window.track('pay_result', {type:'payment', status:'fail', kind:'report'});
  window.track('pay_result', {type:'sbp', status:'wait', kind:'report'});
  await new Promise(r=>setTimeout(r,300));
  return (window.__ym||[]).slice(before).map(c=>[c[1], c[2], c[3]&&(c[3].order_price||null), c[3]&&(c[3].currency||null)]);
});
console.log('\n=== вызовы reachGoal ===');
for (const g of goals) console.log(JSON.stringify(g));
await b.close(); srv.close();
