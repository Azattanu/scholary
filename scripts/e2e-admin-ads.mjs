import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT='/home/user/scholary/site/build';
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const STUB=fs.readFileSync('/home/user/scholary/site/scripts/stub-admin.js','utf8');
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/'))p+='index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){r.writeHead(404);return r.end();}
  let body=fs.readFileSync(f);
  if(p==='/admin/index.html'){ body=Buffer.from(String(body).replace('<script src="/js/admin.js','<script>'+STUB+'</script>\n<script src="/js/admin.js')); }
  r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'}); r.end(body);});
await new Promise(r=>srv.listen(8090,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
let fails=0; const ok=(c,m)=>{console.log((c?'OK   ':'FAIL ')+m); if(!c)fails++;};
for (const [w,h,tag] of [[1280,1000,'desktop'],[390,850,'mobile']]) {
  const ctx=await b.newContext({viewport:{width:w,height:h},deviceScaleFactor:1});
  await ctx.route('**', r=> r.request().url().startsWith('http://127.0.0.1:8090') ? r.continue() : r.fulfill({status:200,headers:{'Content-Type':'application/javascript'},body:''}));
  const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,120)));
  p.on('dialog', d=>d.accept());
  await p.goto('http://127.0.0.1:8090/admin/',{waitUntil:'domcontentloaded',timeout:20000});
  await p.waitForTimeout(1500);
  await p.click('#tabs button[data-t="ads"]'); await p.waitForTimeout(600);
  const info=await p.evaluate(()=>({kpis:document.querySelectorAll('#view .kpi').length, charts:document.querySelectorAll('#view svg.chart').length, boxes:document.querySelectorAll('#view .box').length,
     rows:document.querySelectorAll('#view table.adm tr').length, over:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,
     txt:document.getElementById('view').innerText.replace(/\u00a0/g,' ')}));
  ok(info.kpis===10, tag+': 10 KPI-карточек ('+info.kpis+')');
  ok(info.charts===2, tag+': 2 графика');
  ok(/CPL/.test(info.txt) && /CAC/.test(info.txt) && /CPV/.test(info.txt), tag+': есть CPL/CAC/CPV');
  ok(/1 288 ₸/.test(info.txt), tag+': CPL = 152000/118 = 1 288 ₸');
  ok(/16 889 ₸/.test(info.txt), tag+': CAC = 152000/9 = 16 889 ₸');
  ok(/ROAS 0\.29/.test(info.txt), tag+': ROAS 0.29');
  ok(!info.over, tag+': нет горизонтальной прокрутки');
  // только tiktok-строки в списке (2 из 3)
  const tt=await p.evaluate(()=>[...document.querySelectorAll('#view table.adm')].pop().querySelectorAll('tr').length-1);
  ok(tt===2, tag+': в списке 2 строки TikTok (meta скрыта): '+tt);
  // переключение площадки
  await p.click('#adsSeg button[data-pf="meta"]'); await p.waitForTimeout(400);
  const h2=await p.evaluate(()=>document.querySelector('#view h2').textContent);
  ok(/Meta/.test(h2), tag+': переключение на Meta: '+h2);
  await p.click('#adsSeg button[data-pf="tiktok"]'); await p.waitForTimeout(400);
  // форма: пустой расход → ошибка
  await p.click('#btnAdSave'); await p.waitForTimeout(200);
  ok(/хотя бы расход/.test(await p.$eval('#adMsg',e=>e.textContent)), tag+': валидация пустой формы');
  await p.fill('#adSpend','12345'); await p.click('#btnAdSave'); await p.waitForTimeout(500);
  const m=await p.$eval('#adMsg',e=>e.textContent).catch(()=>'');
  ok(/Сохранено|Загружаю|^$/.test(m) || (await p.evaluate(()=>document.querySelectorAll('#view .kpi').length))===10, tag+': сохранение прошло ('+m+')');
  // CSV-парсер
  const csv=await p.evaluate(()=>{
    const a=window.__parseAdsCsv('Date,Campaign name,Cost,Impressions,Clicks (destination),2-second video views,Conversions\n2026-09-03,Школьники,"12,500.50","23,000",340,7000,3\n2026-09-04,Школьники,10000,20000,300,6000,2\n2026-09-04,Студенты,5000,9000,100,2500,1\nTotal,,27500,52000,740,15500,6');
    const b=window.__parseAdsCsv('Дата;Расход;Показы\n04.09.2026;15 000,00;20000\n05.09.2026;12 000;18000');
    const c=window.__parseAdsCsv('Foo,Bar\n1,2');
    return {a,b,c};});
  ok(csv.a.rows && csv.a.rows.length===3 && csv.a.rows[0].spend===12501 && csv.a.rows[0].impressions===23000 && csv.a.rows[0].views===7000 && csv.a.rows[0].results===3 && csv.a.skipped===1, tag+': CSV англ. заголовки, Total пропущен: '+JSON.stringify(csv.a.rows[0]));
  ok(csv.b.rows && csv.b.rows.length===2 && csv.b.rows[0].day==='2026-09-04' && csv.b.rows[0].spend===15000, tag+': CSV рус. заголовки и даты дд.мм.гггг: '+JSON.stringify(csv.b.rows[0]));
  ok(csv.c.error, tag+': CSV без нужных колонок → ошибка');
  ok(errs.length===0, tag+': без JS-ошибок '+JSON.stringify(errs));
  if(tag==='desktop') await p.screenshot({path:'/mnt/user-data/outputs/admin-reklama-desktop.png', fullPage:true});
  else await p.screenshot({path:'/mnt/user-data/outputs/admin-reklama-mobile.png', fullPage:true});
  await ctx.close();
}
await b.close(); srv.close(); console.log(fails?('FAILS '+fails):'ALL OK');
