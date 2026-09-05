// Админка · вкладка «Продукт» (web-74): блок «Возвращаемость кабинета» и редактор материалов.
// Стенд: build/ на 8091 + заглушка RPC (scripts/stub-admin.js). Запуск: node scripts/e2e-admin-retention.mjs
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT='/home/user/scholary/site/build';
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const STUB=fs.readFileSync('/home/user/scholary/site/scripts/stub-admin.js','utf8');
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/'))p+='index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){r.writeHead(404);return r.end();}
  let body=fs.readFileSync(f);
  if(p==='/admin/index.html'){ body=Buffer.from(String(body).replace('<script src="/js/admin.js','<script>'+STUB+'</script>\n<script src="/js/admin.js')); }
  r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'}); r.end(body);});
await new Promise(r=>srv.listen(8091,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
let fails=0; const ok=(c,m)=>{console.log((c?'OK   ':'FAIL ')+m); if(!c)fails++;};
for (const [w,h,tag] of [[1280,1000,'desktop'],[390,850,'mobile']]) {
  const ctx=await b.newContext({viewport:{width:w,height:h},deviceScaleFactor:1});
  await ctx.route('**', r=> r.request().url().startsWith('http://127.0.0.1:8091') ? r.continue() : r.fulfill({status:200,headers:{'Content-Type':'application/javascript'},body:''}));
  const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,120)));
  const rpcs=[]; await p.exposeFunction('__rpcSpy', (fn,args)=>rpcs.push({fn,args}));
  p.on('dialog', d=>d.accept());
  await p.goto('http://127.0.0.1:8091/admin/',{waitUntil:'domcontentloaded',timeout:20000});
  await p.waitForTimeout(1500);
  await p.click('#tabs button[data-t="product"]'); await p.waitForTimeout(800);
  const info=await p.evaluate(()=>({kpis:document.querySelectorAll('#retBody .kpi').length, over:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,
     txt:document.getElementById('view').innerText.replace(/ /g,' '), rows:document.querySelectorAll('#retBody table.adm tr').length, ct:document.querySelectorAll('#contentBody table.adm tr').length}));
  ok(/Возвращаемость кабинета/.test(info.txt), tag+': блок «Возвращаемость кабинета»');
  ok(info.kpis===6, tag+': 6 KPI (' + info.kpis + ')');
  ok(/Активных за 7 дней/.test(info.txt) && /14/.test(info.txt), tag+': активных за 7 дней = 14');
  ok(/≥ 2 дней на этой неделе/.test(info.txt) && /5 из 12/.test(info.txt), tag+': ≥ 2 дней — 5 из 12');
  ok(/Когорты по первой активности/.test(info.txt) && /22%/.test(info.txt) && /41%/.test(info.txt), tag+': когорты D1 22% / W1 41%');
  ok(/По неделям/.test(info.txt) && info.rows>=4, tag+': таблица по неделям ('+info.rows+' строк)');
  ok(/Продления Pro/.test(info.txt), tag+': продления Pro');
  ok(/Материалы для кабинета/.test(info.txt) && info.ct===2, tag+': редактор материалов с 1 строкой');
  ok(/Как попросить рекомендацию/.test(info.txt), tag+': материал из заглушки показан');
  // добавить материал
  await p.fill('#ctTitle', 'Тестовый гайд'); await p.fill('#ctUrl', 'https://scholary.kz/'); await p.fill('#ctAuthor', 'Диас Асанов'); await p.fill('#ctWeeks', '2-5');
  const calls0 = await p.evaluate(()=>window.__RPC_LOG ? window.__RPC_LOG.length : -1);
  await p.click('#btnContentSave'); await p.waitForTimeout(500);
  const log = await p.evaluate(()=>window.__RPC_LOG || []);
  const up = log.filter(x=>x.fn==='admin_cab_content_upsert');
  ok(up.length>=1 && up[up.length-1].args.p.title==='Тестовый гайд' && up[up.length-1].args.p.week_from===2 && up[up.length-1].args.p.week_to===5 && up[up.length-1].args.p.author==='Диас Асанов', tag+': добавление материала уходит в admin_cab_content_upsert с неделями 2–5');
  await p.click('#contentBody [data-act="ct-toggle"]'); await p.waitForTimeout(400);
  const log2 = await p.evaluate(()=>window.__RPC_LOG || []);
  ok(log2.some(x=>x.fn==='admin_cab_content_upsert' && x.args.p.active===false), tag+': выключение материала');
  await p.click('#contentBody [data-act="ct-del"]'); await p.waitForTimeout(400);
  const log3 = await p.evaluate(()=>window.__RPC_LOG || []);
  ok(log3.some(x=>x.fn==='admin_cab_content_delete'), tag+': удаление материала (с подтверждением)');
  ok(!info.over, tag+': нет горизонтальной прокрутки');
  ok(errs.length===0, tag+': без JS-ошибок '+JSON.stringify(errs));
  await p.screenshot({path:'/tmp/claude-0/shots/admin-retention-'+tag+'.png', fullPage:true});
  await ctx.close();
}
await b.close(); srv.close();
console.log(fails?'FAILED '+fails:'ALL OK'); process.exit(fails?1:0);
