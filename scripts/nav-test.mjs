/* Роль абитуриента: пройти путь и убедиться, что из любого места можно вернуться. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve('build'), PORT=8179;
const MIME={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
const srv=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);let f=path.join(ROOT,u);if(u.endsWith('/'))f=path.join(f,'index.html');if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);});
await new Promise(r=>srv.listen(PORT,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await b.newContext({viewport:{width:390,height:844}});
await ctx.route('**',r=>r.request().url().startsWith('http://localhost')?r.continue():r.fulfill({status:200,body:''}));
const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,80)));
const B='http://localhost:'+PORT;
const say=(ok,t)=>console.log((ok?'  ✓ ':'  ✖ ')+t);

// 1. главная → меню → кабинет → назад
await p.goto(B+'/',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(700);
await p.click('#navBurger'); await p.waitForTimeout(300);
say(await p.isVisible('#siteMenu'), 'меню открывается');
await p.click('#siteMenu a[href="/cabinet/"]'); await p.waitForTimeout(900);
say(p.url().includes('/cabinet/'), 'из меню попадаем в кабинет ('+p.url().replace(B,'')+')');
await p.goBack({waitUntil:'domcontentloaded'}); await p.waitForTimeout(700);
say(p.url().replace(B,'')==='/' , 'кнопка «назад» возвращает на главную');
say(await p.evaluate(()=>document.getElementById('siteMenu').hidden), 'после возврата меню закрыто');

// 2. главная → квиз → назад
await p.click('a.nav-cta'); await p.waitForTimeout(900);
say(p.url().includes('/quiz/'), 'кнопка в шапке ведёт в квиз');
await p.goBack({waitUntil:'domcontentloaded'}); await p.waitForTimeout(600);
say(p.url().replace(B,'')==='/', 'из квиза «назад» работает');

// 3. внутри квиза: шаг вперёд и кнопка «назад» на самом экране
await p.goto(B+'/quiz/',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(800);
const step1=await p.evaluate(()=>(document.querySelector('.quiz-prog,.quiz-step,#screen')||{}).textContent?.slice(0,40));
// выбираем вариант, затем жмём «Далее» — сам по себе выбор шаг не переключает
// на экране может быть несколько обязательных групп — выбираем по одному в каждой
await p.evaluate(()=>{
  document.querySelectorAll('#screen .opts, #screen .chips').forEach(g=>{
    const b=g.querySelector('button'); if(b) b.click();
  });
});
await p.waitForTimeout(400);
await p.evaluate(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>/далее/i.test(x.textContent||'')); if(b && !b.disabled) b.click();});
await p.waitForTimeout(700);
const step2=await p.evaluate(()=>document.body.innerText.match(/Вопрос\s+(\d+)\s+из/)?.[1]);
say(step2==='2', 'квиз перешёл на второй вопрос (сейчас '+step2+')');
const hasBack=await p.evaluate(()=>!!Array.from(document.querySelectorAll('button,a')).find(e=>/назад|←/i.test(e.textContent||'')));
say(hasBack, 'на экране квиза есть кнопка «назад»');
if (hasBack) {
  await p.evaluate(()=>{const e=Array.from(document.querySelectorAll('button,a')).find(x=>/назад|←/i.test(x.textContent||'')); e.click();});
  await p.waitForTimeout(600);
  const s=await p.evaluate(()=>document.body.innerText.match(/Вопрос\s+(\d+)\s+из/)?.[1]);
  say(s==='1', 'кнопка «назад» в квизе возвращает на первый вопрос (сейчас '+s+')');
}

// 4. страницы оферты и политики: есть ли путь домой
for (const u of ['/oferta/','/privacy/','/tariffs/','/demo/','/report/']) {
  await p.goto(B+u,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(600);
  const home=await p.evaluate(()=>!!document.querySelector('a.logo[href="/"], a[href="/"]'));
  const cab=await p.evaluate(()=>!!document.querySelector('a[href="/cabinet/"]'));
  say(home && cab, u+' — есть путь на главную и в кабинет');
}
console.log(errs.length ? '  ✖ ошибки JS: '+JSON.stringify([...new Set(errs)]) : '  ✓ ошибок JS нет');
await b.close(); srv.close();
