/* Проверка шапки: помещается ли всё, виден ли вход в кабинет,
   открывается ли меню и не появляется ли боковая прокрутка. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve('build'); const PORT = 8151;
const MIME = {'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.txt':'text/plain','.xml':'application/xml'};
const srv = http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);let f=path.join(ROOT,u);if(u.endsWith('/'))f=path.join(f,'index.html');if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);});
await new Promise(r=>srv.listen(PORT,r));

const WIDTHS = [320, 360, 390, 414, 430, 600, 768, 834, 1024, 1280, 1440, 1920];
const PAGES = ['/', '/tariffs/', '/oferta/', '/privacy/', '/demo/', '/quiz/', '/report/'];
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
let bad = 0;
for (const url of PAGES) {
  const line = [];
  for (const w of WIDTHS) {
    const ctx = await b.newContext({viewport:{width:w,height:800}});
    await ctx.route('**', r => r.request().url().startsWith('http://localhost') ? r.continue() : r.abort());
    const p = await ctx.newPage();
    await p.goto(`http://localhost:${PORT}${url}`,{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(500);
    const res = await p.evaluate(() => {
      const de = document.documentElement;
      const over = Math.max(0, de.scrollWidth - de.clientWidth);
      const h = document.querySelector('.site-header');
      const vw = de.clientWidth;
      let hdrOver = 0, items = [];
      if (h) {
        h.querySelectorAll('.logo, .nav > *').forEach(el => {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || el.hidden) return;
          const r = el.getBoundingClientRect();
          if (r.width < 1) return;
          items.push((el.className||el.tagName).toString().split(' ')[0] + ':' + Math.round(r.width));
          if (r.right > vw + 0.5) hdrOver = Math.max(hdrOver, Math.round(r.right - vw));
        });
      }
      const login = document.querySelector('.nav-login');
      const loginVisible = !!(login && getComputedStyle(login).display !== 'none' && login.getBoundingClientRect().width > 1);
      const burger = document.getElementById('navBurger');
      const burgerVisible = !!(burger && getComputedStyle(burger).display !== 'none');
      return { over, hdrOver, items, loginVisible, burgerVisible, hasHeader: !!h };
    });
    // проверяем открытие меню там, где кнопка видна
    let menuOk = 'n/a';
    if (res.burgerVisible) {
      await p.click('#navBurger');
      await p.waitForTimeout(250);
      const m = await p.evaluate(() => {
        const menu = document.getElementById('siteMenu');
        if (!menu || menu.hidden) return null;
        const r = menu.getBoundingClientRect();
        const links = menu.querySelectorAll('a').length;
        const cab = Array.from(menu.querySelectorAll('a')).some(a => /cabinet/.test(a.getAttribute('href')||''));
        return { w: Math.round(r.width), h: Math.round(r.height), links, cab,
                 over: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth) };
      });
      menuOk = m ? (m.over > 1 ? 'ПРОКРУТКА+'+m.over : ('ok ' + m.links + ' ссылок' + (m.cab ? ' +кабинет' : ' БЕЗ КАБИНЕТА'))) : 'НЕ ОТКРЫЛОСЬ';
    }
    const problems = [];
    if (res.over > 1) problems.push('боковая прокрутка +' + res.over);
    if (res.hdrOver > 0) problems.push('шапка вылезает +' + res.hdrOver);
    if (res.hasHeader && url !== '/quiz/' && !res.loginVisible && !res.burgerVisible) problems.push('нет входа в кабинет');
    if (typeof menuOk === 'string' && /ПРОКРУТКА|НЕ ОТКРЫЛОСЬ|БЕЗ КАБИНЕТА/.test(menuOk)) problems.push('меню: ' + menuOk);
    if (problems.length) { bad++; line.push(`${w}px ✖ ${problems.join('; ')}`); }
    await ctx.close();
  }
  console.log(`\n${url}` + (line.length ? '\n  ' + line.join('\n  ') : '  — все ширины чисто'));
}
await b.close(); srv.close();
console.log(`\n===== проблемных сочетаний: ${bad} =====`);
