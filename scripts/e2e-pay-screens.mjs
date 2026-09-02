/* Проход квиза до пейволла на локальной сборке и проверка экранов после оплаты:
   успех, отказ, «в обработке», рассрочка. Виджет TipTop подменён заглушкой. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT='/home/user/scholary/site/build';
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/'))p+='index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');} r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'}); r.end(fs.readFileSync(f));});
srv.on('error',e=>{console.log('СЕРВЕР:',e.message); process.exit(1);});
const PORT=8093;
await new Promise(r=>srv.listen(PORT,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox']});
const WIDGET=`window.tiptop={Widget:function(){this.start=function(){var s=this;setTimeout(function(){s.oncomplete(window.__result);},10);};}};`;

async function run(w,result,label){
  const ctx=await b.newContext({viewport:{width:w,height:900}});
  await ctx.route('**', r=>{const u=r.request().url();
    if(u.startsWith('http://127.0.0.1:'+PORT)) return r.continue();
    if(/widget\.tiptoppay\.kz/.test(u)) return r.fulfill({status:200,headers:{'Content-Type':'text/javascript'},body:WIDGET});
    return r.fulfill({status:200,headers:{'Content-Type':'application/json','access-control-allow-origin':'*'},body:'{}'});});
  const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,80)));
  await p.goto(`http://127.0.0.1:${PORT}/quiz/?tt=1`,{waitUntil:'domcontentloaded',timeout:20000});
  await p.waitForTimeout(600);
  let steps=0;
  for(;steps<25;steps++){
    if(await p.$('#fName')) break;
    // на шаге бывает несколько групп (например «уровень» + «год») — выбираем в каждой
    await p.evaluate(()=>{ document.querySelectorAll('.opts,.chips').forEach(g=>{
      const b=g.querySelector('button'); if(b && !/selected|active|\bon\b/.test(b.className)) b.click(); }); });
    await p.waitForTimeout(120);
    const n=await p.$('button:has-text("Далее")'); if(n) await n.click({timeout:1200}).catch(()=>{});
    await p.waitForTimeout(200);
  }
  const atContact=!!(await p.$('#fName'));
  if(atContact){
    await p.fill('#fName','Тест Тестов',{timeout:2000}); await p.fill('#fWa','+7 701 000 00 00',{timeout:2000});
    const em=await p.$('#fEmail'); if(em) await p.fill('#fEmail','test@example.com');
    const g=await p.$('button:has-text("Показать результат")')||await p.$('button:has-text("Далее")');
    if(g) await g.click({timeout:2000}).catch(()=>{});
    await p.waitForTimeout(1600);
  }
  const pay=await p.$('#toPay'), free=await p.$('#toFree');
  let screen='—', scrollX=0;
  if(pay){
    await p.evaluate(r=>{window.__result=r;},result);
    await pay.click({timeout:2000}).catch(()=>{}); await p.waitForTimeout(900);
    // на экране оплаты просят почту для отчёта и чека
    await p.fill('#fEmail','test@example.com',{timeout:2000}).catch(()=>{});
    const card=await p.$('#payCard'); if(card) await card.click({timeout:2000}).catch(()=>{});
    await p.waitForTimeout(1200);
    if(process.env.DBG) console.log('   после клика:', JSON.stringify(await p.evaluate(()=>({
      terminal: window.scholaryTerminalReady && window.scholaryTerminalReady(),
      tiptop: typeof window.tiptop, opts: window.__opts||null,
      txt: document.body.innerText.replace(/\n+/g,' | ').slice(0,220)}))));
    screen=await p.evaluate(()=>{const t=document.body.innerText;
      if(/Платёж обрабатывается/.test(t)) return 'в обработке';
      if(/Оплата не прошла/.test(t)) return 'отказ';
      if(/Ещё пара вопросов|Спасибо|Оплата прошла|уточним/i.test(t)) return 'успех';
      return t.slice(0,45).replace(/\n/g,' ');});
    scrollX=await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  }
  console.log(`${label.padEnd(12)} ${(w+'px').padEnd(7)} шагов:${String(steps).padEnd(2)} контакты:${atContact?'✓':'✗'} пейволл:${pay?'✓':'✗'} беспл.кабинет:${free?'✓':'✗'} → «${screen}» скролл:${scrollX} ошибки:${errs.length?errs.slice(0,2):'нет'}`);
  await ctx.close();
}
for(const w of [390,1440]){
  await run(w,{type:'payment',status:'success'},'успех');
  await run(w,{type:'payment',status:'fail'},'отказ');
  await run(w,{type:'sbp',status:'wait'},'в обработке');
  await run(w,{type:'installmentKz',status:'appointment'},'рассрочка');
}
await b.close(); srv.close();
