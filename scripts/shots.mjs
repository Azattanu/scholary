import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || 'build');
const PORT = 8123;
const MIME = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml',
  '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.txt':'text/plain', '.xml':'application/xml' };

const srv = http.createServer((req,res)=>{
  let u = decodeURIComponent(req.url.split('?')[0]);
  let f = path.join(ROOT, u);
  if (u.endsWith('/')) f = path.join(f, 'index.html');
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, {'Content-Type': MIME[path.extname(f)] || 'application/octet-stream'});
  fs.createReadStream(f).pipe(res);
});
await new Promise(r=>srv.listen(PORT, r));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

const PAGES = process.env.PAGES ? JSON.parse(process.env.PAGES) : [
  ['home','/'], ['quiz','/quiz/'], ['demo','/demo/'], ['tariffs','/tariffs/'],
  ['oferta','/oferta/'], ['privacy','/privacy/'], ['cabinet','/cabinet/'], ['admin','/admin/'], ['report','/report/']
];
const VIEWS = [['desk',1440,900],['mob',390,844]];
const OUT = process.env.OUT || 'shots';
fs.mkdirSync(OUT, {recursive:true});
const problems = [];

for (const [vn,w,h] of VIEWS) {
  const ctx = await browser.newContext({ viewport:{width:w,height:h}, deviceScaleFactor:2,
    isMobile: vn==='mob', hasTouch: vn==='mob' });
  // весь внешний трафик — через node fetch (в песочнице у браузера нет сети)
  await ctx.route('**', async route => {
    const url = route.request().url();
    if (url.startsWith(`http://localhost:${PORT}`)) return route.continue();
    try {
      const r = await fetch(url, { method: route.request().method(),
        headers: route.request().headers(), body: route.request().postData() || undefined });
      const buf = Buffer.from(await r.arrayBuffer());
      const hdrs = {}; r.headers.forEach((v,k)=>{ if(!/^content-encoding|content-length$/i.test(k)) hdrs[k]=v; });
      return route.fulfill({ status: r.status, headers: hdrs, body: buf });
    } catch(e) { return route.abort(); }
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0,200)));
  page.on('console', m => { if (m.type()==='error') errs.push('console: '+m.text().slice(0,200)); });
  for (const [name, url] of PAGES) {
    errs.length = 0;
    try {
      await page.goto(`http://localhost:${PORT}${url}`, { waitUntil:'networkidle', timeout:30000 });
    } catch(e) { problems.push(`${name}/${vn}: goto ${String(e).slice(0,120)}`); }
    await page.waitForTimeout(1200);
    // раскрыть анимации появления, иначе на полностраничном скриншоте блоки пустые
    await page.evaluate(() => document.querySelectorAll('.rv').forEach(e => { e.classList.add('in'); e.style.transitionDelay='0ms'; }));
    await page.waitForTimeout(500);
    // горизонтальное переполнение
    const ov = await page.evaluate(() => {
      const de = document.documentElement;
      const wide = [...document.querySelectorAll('body *')].filter(el=>{
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1);
      }).slice(0,6).map(el => el.tagName.toLowerCase()+'.'+(el.className||'').toString().split(' ')[0]);
      return { scrollW: de.scrollWidth, innerW: window.innerWidth, wide };
    });
    if (ov.scrollW > ov.innerW + 1) problems.push(`${name}/${vn}: гориз. прокрутка ${ov.scrollW}>${ov.innerW} ${JSON.stringify(ov.wide)}`);
    if (errs.length) problems.push(`${name}/${vn}: JS ${JSON.stringify(errs.slice(0,3))}`);
    await page.screenshot({ path: `${OUT}/${name}-${vn}.png`, fullPage: true });
  }
  await ctx.close();
}
await browser.close(); srv.close();
console.log(problems.length ? 'ПРОБЛЕМЫ:\n' + problems.join('\n') : 'Проблем не найдено');
