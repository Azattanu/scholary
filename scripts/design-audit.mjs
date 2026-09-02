/* Строгий аудит вёрстки и дизайна.
   Проверяет то, что реально ломает опыт на телефоне и в вебе:
   боковую прокрутку, вылет за экран, налезание блоков, мелкие цели,
   мелкий шрифт, зум iOS на полях ввода, контраст, длину строки,
   висячие слова, выравнивание контейнеров и отсутствующие alt. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve('build'); const PORT = 8161;
const MIME = {'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.txt':'text/plain','.xml':'application/xml','.ico':'image/x-icon'};
const srv = http.createServer((q, r) => {
  let u = decodeURIComponent(q.url.split('?')[0]); let f = path.join(ROOT, u);
  if (u.endsWith('/')) f = path.join(f, 'index.html');
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, {'Content-Type': MIME[path.extname(f)] || 'application/octet-stream'});
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(PORT, r));

const PAGES = ['/', '/quiz/', '/tariffs/', '/oferta/', '/privacy/', '/report/', '/demo/', '/cabinet/', '/admin/'];
const VIEWS = [['320', 320, 700], ['360', 360, 780], ['390', 390, 844], ['414', 414, 896],
               ['430', 430, 932], ['600', 600, 900], ['768', 768, 1024], ['834', 834, 1112],
               ['1024', 1024, 768], ['1280', 1280, 800], ['1440', 1440, 900], ['1920', 1920, 1080]];

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const found = [];

for (const [vn, w, h] of VIEWS) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await ctx.route('**', route => { const u=route.request().url(); return u.startsWith('http://localhost') ? route.continue() : route.fulfill({status:200,headers:{'Content-Type':'application/javascript'},body:''}); });
  if(false) await ctx.route('**', async route => {
    const u = route.request().url();
    if (u.startsWith('http://localhost')) return route.continue();
    try {
      const rq = route.request();
      const res = await fetch(u, { method: rq.method(), headers: rq.headers(), body: rq.postData() || undefined });
      const buf = Buffer.from(await res.arrayBuffer());
      const hh = {}; res.headers.forEach((v, k) => { if (!/^content-encoding|content-length$/i.test(k)) hh[k] = v; });
      return route.fulfill({ status: res.status, headers: hh, body: buf });
    } catch (e) { return route.abort(); }
  });
  const p = await ctx.newPage();
  for (const url of PAGES) {
    try { await p.goto(`http://localhost:${PORT}${url}`, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
    catch (e) { found.push({ vn, url, kind: 'страница не открылась', info: e.message.slice(0, 80) }); continue; }
    await p.waitForTimeout(900);
    await p.evaluate(() => document.querySelectorAll('.rv').forEach(e => e.classList.add('in')));
    await p.waitForTimeout(250);

    const res = await p.evaluate(() => {
      const out = [];
      const de = document.documentElement;
      const vw = de.clientWidth;
      const vis = el => {
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && !el.hidden && parseFloat(cs.opacity || '1') > 0.05;
      };
      const clipped = el => {
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (/hidden|clip|auto|scroll/.test(cs.overflowX + cs.overflow)) return true;
        }
        return false;
      };
      const label = el => (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''));

      // 1. боковая прокрутка
      const over = de.scrollWidth - de.clientWidth;
      if (over > 1) out.push({ kind: 'боковая прокрутка', info: '+' + Math.round(over) + 'px' });

      const all = Array.from(document.querySelectorAll('body *'));

      // 2. вылет за экран
      all.forEach(el => {
        if (!vis(el) || getComputedStyle(el).position === 'fixed') return;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        if (clipped(el)) return;
        if (r.right > vw + 1.5 || r.left < -1.5)
          out.push({ kind: 'вылезает за экран', info: label(el) + ' ' + Math.round(r.left) + '…' + Math.round(r.right), txt: (el.textContent||'').trim().slice(0,30) });
      });

      // 3. поля ввода мельче 16px — iOS Safari зумит страницу при фокусе
      document.querySelectorAll('input:not([type=hidden]), textarea, select').forEach(el => {
        if (!vis(el)) return;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs && fs < 16) out.push({ kind: 'поле ввода мельче 16px (iOS зумит)', info: label(el) + ' ' + fs + 'px' });
      });

      // 4. цели нажатия
      document.querySelectorAll('a[href], button, [role=button], input[type=submit], .chip, .opt').forEach(el => {
        if (!vis(el)) return;
        const cs = getComputedStyle(el);
        if (cs.display === 'inline') return;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        if (r.height < 40) out.push({ kind: 'маленькая цель нажатия', info: label(el) + ' ' + Math.round(r.width) + '×' + Math.round(r.height), txt: (el.textContent||'').trim().slice(0,24) });
      });

      // 5. налезание соседних блоков одного уровня
      const sections = Array.from(document.querySelectorAll('main > section, .container > *'));
      for (let i = 0; i + 1 < sections.length; i++) {
        const a = sections[i], c = sections[i + 1];
        if (!vis(a) || !vis(c)) continue;
        const ra = a.getBoundingClientRect(), rc = c.getBoundingClientRect();
        if (ra.height < 5 || rc.height < 5) continue;
        if (getComputedStyle(a).position !== 'static' || getComputedStyle(c).position !== 'static') continue;
        // в сетке и флексе соседи стоят рядом по горизонтали — это не наложение
        const pd = getComputedStyle(a.parentElement).display;
        if (pd === 'grid' || pd === 'flex' || pd === 'inline-flex') continue;
        const hOverlap = Math.min(ra.right, rc.right) - Math.max(ra.left, rc.left);
        if (hOverlap <= 0) continue;
        const vOverlap = ra.bottom - rc.top;
        if (vOverlap > 12) out.push({ kind: 'блоки налезают друг на друга', info: label(a) + ' ↔ ' + label(c) + ' на ' + Math.round(vOverlap) + 'px' });
      }

      // 6. контраст текста
      function lum(c) {
        const m = c.match(/[\d.]+/g); if (!m) return null;
        const [r, g, bl] = m.slice(0, 3).map(Number);
        const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
        return .2126 * f(r) + .7152 * f(g) + .0722 * f(bl);
      }
      function bgOf(el) {
        for (let a = el; a; a = a.parentElement) {
          const bg = getComputedStyle(a).backgroundColor;
          const m = bg.match(/[\d.]+/g);
          if (m && (m.length < 4 || Number(m[3]) > .5)) return bg;
        }
        return 'rgb(255,255,255)';
      }
      all.forEach(el => {
        if (!vis(el)) return;
        const hasText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim().length > 2);
        if (!hasText) return;
        const cs = getComputedStyle(el);
        const l1 = lum(cs.color), l2 = lum(bgOf(el));
        if (l1 == null || l2 == null) return;
        const ratio = (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
        const fs = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700;
        const need = (fs >= 24 || (fs >= 18.66 && bold)) ? 3 : 4.5;
        if (ratio < need - 0.05)
          out.push({ kind: 'низкий контраст', info: label(el) + ' ' + ratio.toFixed(2) + ' < ' + need, txt: (el.textContent||'').trim().slice(0,30) });
      });

      // 7. картинки без alt
      document.querySelectorAll('img').forEach(el => {
        if (!el.hasAttribute('alt')) out.push({ kind: 'картинка без alt', info: (el.getAttribute('src')||'').slice(-40) });
      });

      // 8. висячее слово в заголовке
      document.querySelectorAll('h1, h2, h3').forEach(el => {
        const t = (el.textContent || '').trim();
        if (t.split(/\s+/).length < 4) return;
        const range = document.createRange(); range.selectNodeContents(el);
        const rects = Array.from(range.getClientRects()).filter(r => r.width > 1);
        if (rects.length < 2) return;
        const last = rects[rects.length - 1], prev = rects[rects.length - 2];
        if (prev.width > 0 && last.width / prev.width < 0.18)
          out.push({ kind: 'висячее слово в заголовке', info: t.slice(0, 44) });
      });

      // 9. слишком длинная строка текста
      document.querySelectorAll('p').forEach(el => {
        if (!vis(el)) return;
        const t = (el.textContent || '').trim();
        if (t.length < 120) return;
        const r = el.getBoundingClientRect();
        const fs = parseFloat(getComputedStyle(el).fontSize);
        const chars = r.width / (fs * 0.5);
        if (chars > 105) out.push({ kind: 'слишком длинная строка', info: Math.round(chars) + ' знаков: ' + t.slice(0, 30) });
      });

      return out;
    });
    res.forEach(x => found.push({ vn, url, ...x }));
  }
  await ctx.close();
}
await b.close(); srv.close();

const byKind = {};
found.forEach(f => { (byKind[f.kind] = byKind[f.kind] || []).push(f); });
const order = Object.keys(byKind).sort((a, b) => byKind[b].length - byKind[a].length);
for (const k of order) {
  const list = byKind[k];
  console.log(`\n■ ${k} — ${list.length} шт.`);
  const seen = new Set();
  for (const f of list) {
    const key = f.url + '|' + f.info;
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > 8) { console.log(`   …и ещё ${list.length - 8}`); break; }
    console.log(`   [${f.vn}] ${f.url}  ${f.info}${f.txt ? '  «' + f.txt + '»' : ''}`);
  }
}
console.log(`\n===== ВСЕГО ЗАМЕЧАНИЙ: ${found.length} =====`);
