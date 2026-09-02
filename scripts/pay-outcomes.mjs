/* Проверяем разбор ответа виджета TipTop: какой исход какой обработчик вызывает.
   Настоящий виджет подменяем заглушкой — деньги и шлюз не участвуют. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT='/home/user/scholary/site/build';
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon'};
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/'))p+='index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');} r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'}); r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(8097,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--no-default-browser-check','--disable-domain-reliability','--metrics-recording-only','--disable-features=OptimizationHints,Translate,MediaRouter']});
const ctx=await b.newContext({viewport:{width:390,height:844}});
await ctx.route('**', async route=>{const u=route.request().url();
 if(u.startsWith('http://127.0.0.1:8097')) return route.continue();
 if(/widget\.tiptoppay\.kz/.test(u)) return route.fulfill({status:200,headers:{'Content-Type':'text/javascript'},body:`window.tiptop={Widget:function(){this.start=function(o){window.__opts=o; var w=this; setTimeout(function(){ w.oncomplete(window.__result); },10);};}};`});
 return route.fulfill({status:200,headers:{'Content-Type':'application/json','access-control-allow-origin':'*'},body:'{}'});});
const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,100)));
await p.goto('http://127.0.0.1:8097/quiz/?tt=1',{waitUntil:'domcontentloaded'});
await p.waitForTimeout(800);
const cases=[
 ['payment/success',      {type:'payment',status:'success'},      'onSuccess'],
 ['installmentKz/appoint',{type:'installmentKz',status:'appointment'},'onSuccess'],
 ['installment/success',  {type:'installment',status:'success'},  'onSuccess'],
 ['sbp/success',          {type:'sbp',status:'success'},          'onSuccess'],
 ['foreignCard/success',  {type:'foreignCard',status:'success'},  'onSuccess'],
 ['payment/fail',         {type:'payment',status:'fail'},         'onFail'],
 ['payment/reject',       {type:'payment',status:'reject'},       'onFail'],
 ['cancel/cancel',        {type:'cancel',status:'cancel'},        'onCancel'],
 ['payment/cancel',       {type:'payment',status:'cancel'},       'onCancel'],
 ['error/-',              {type:'error',status:''},               'onFail'],
 ['sbp/wait',             {type:'sbp',status:'wait'},             'onPending'],
 ['пустой ответ',         null,                                   'onFail'],
];
console.log('исход виджета            → обработчик        ожидали   ');
let bad=0;
for (const [name,res,want] of cases){
  const got = await p.evaluate(async (res)=>{
    window.__result = res; let hit='—';
    await new Promise(done=>{
      window.scholaryPay({kind:'report',amount:4000,externalId:'t'+Date.now(),
        onSuccess:()=>{hit='onSuccess';done();}, onFail:()=>{hit='onFail';done();},
        onCancel:()=>{hit='onCancel';done();}, onPending:()=>{hit='onPending';done();},
        onError:()=>{hit='onError';done();}});
      setTimeout(done,1500);
    });
    return hit;
  }, res);
  const ok = got===want; if(!ok) bad++;
  console.log(`${name.padEnd(24)} → ${got.padEnd(16)} ${want.padEnd(10)} ${ok?'ok':'ОШИБКА'}`);
}
console.log('\nJS-ошибки:', errs.length?errs:'нет');
console.log(bad? `ПРОВАЛЕНО: ${bad}` : 'ВСЕ ИСХОДЫ РАЗОБРАНЫ ВЕРНО');
await b.close(); srv.close();
