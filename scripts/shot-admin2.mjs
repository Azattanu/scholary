import { chromium } from 'playwright';
const b = await chromium.launch();
const errs = [];
for (const [w, h] of [[1280, 1000], [390, 850]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  p.on('pageerror', e => errs.push(w + 'px pageerror: ' + e));
  p.on('console', m => { if (m.type() === 'error' && !/ERR_CONNECTION|ERR_NAME/.test(m.text())) errs.push(w + 'px console: ' + m.text()); });
  await p.goto('http://127.0.0.1:8123/admin/', { waitUntil: 'load' });
  await p.waitForTimeout(1200);
  const info = await p.evaluate(() => ({
    updated: (document.getElementById('updatedAt')||{}).textContent,
    kpis: document.querySelectorAll('.kpi').length,
    charts: document.querySelectorAll('svg.chart').length,
    over: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  }));
  console.log(w + 'px обзор:', JSON.stringify(info));
  await p.screenshot({ path: `/tmp/adm-${w}-overview.png`, fullPage: w > 500 });
  for (const t of ['money', 'funnel', 'channels', 'people', 'reports', 'product', 'system']) {
    await p.click(`#tabs button[data-t="${t}"]`);
    await p.waitForTimeout(250);
    const r = await p.evaluate(() => ({ boxes: document.querySelectorAll('#view .box').length,
      rows: document.querySelectorAll('#view table.adm tr').length,
      over: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 }));
    console.log(`  ${w}px ${t.padEnd(9)} блоков ${r.boxes}, строк ${r.rows}${r.over ? ' — ГОРИЗОНТАЛЬНАЯ ПРОКРУТКА' : ''}`);
    if (w === 1280) await p.screenshot({ path: `/tmp/adm-${t}.png`, fullPage: true });
  }
  // отчёт
  if (w === 1280) {
    await p.click('#tabs button[data-t="overview"]'); await p.waitForTimeout(200);
    const md = await p.evaluate(() => { let s=''; const orig = Blob; window.Blob = function(parts){ s = parts[0]; return new orig(parts, {type:'text/plain'}); }; document.getElementById('btnReport').click(); window.Blob = orig; return s; });
    console.log('отчёт, первые строки:\n' + String(md).split('\n').slice(0, 10).map(x => '   ' + x).join('\n'));
  }
  await p.close();
}
await b.close();
console.log('ошибки:', errs.length ? errs : 'нет');
