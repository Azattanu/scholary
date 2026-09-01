/* Scholary · e2e квиза на боевом сайте: 7 вопросов + контакты,
   лид уходит в базу, показывается вердикт и пейволл. */
import { chromium } from 'playwright';
const BASE='https://scholary.kz';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const log=[];
for (const [vn,w,h] of [['mob',390,844],['desk',1440,900]]) {
  const ctx=await b.newContext({viewport:{width:w,height:h},deviceScaleFactor:2,isMobile:vn==='mob',hasTouch:vn==='mob'});
  await ctx.route('**', async route=>{
    try{const q=route.request();
      const r=await fetch(q.url(),{method:q.method(),headers:Object.fromEntries(Object.entries(q.headers()).filter(([k])=>!/^(host|content-length|accept-encoding|origin|referer)$/i.test(k))),body:['GET','HEAD'].includes(q.method())?undefined:q.postDataBuffer()});
      const buf=Buffer.from(await r.arrayBuffer()); const hd={}; r.headers.forEach((v,k)=>{if(!/^(content-encoding|content-length|transfer-encoding)$/i.test(k))hd[k]=v;}); hd['access-control-allow-origin']='*';
      return route.fulfill({status:r.status,headers:hd,body:buf});}catch(e){return route.abort();}
  });
  const p=await ctx.newPage(); const errs=[];
  p.on('pageerror',e=>errs.push(e.message.slice(0,140)));
  p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text().slice(0,140));});
  const ok=(n,c)=>log.push(`${vn} ${c?'✓':'✗'} ${n}`);

  await p.goto(BASE+'/quiz/',{waitUntil:'domcontentloaded'});
  await p.evaluate(()=>{try{localStorage.clear();}catch(e){}});
  await p.reload(); await p.waitForTimeout(1500);
  ok('квиз открылся', await p.locator('.quiz-q').count()>0);
  const label=await p.locator('#metaLeft').innerText();
  ok(`счётчик «${label}»`, /из 7/.test(label));

  for (let step=0; step<7; step++) {
    // выбираем первый вариант в каждой группе, пока «Далее» не активна
    for (let i=0;i<8;i++){
      const dis=await p.locator('.quiz-nav .btn-primary').isDisabled().catch(()=>true);
      if (!dis) break;
      // в каждой группе выбираем ровно один вариант; после клика шаг перерисовывается
      const clicked = await p.evaluate(() => {
        const groups = [...document.querySelectorAll('#screen .opts, #screen .chips')];
        for (const g of groups) {
          if (g.querySelector('.selected')) continue;
          const b = g.querySelector('button');
          if (b) { b.click(); return true; }
        }
        return false;
      });
      if (!clicked) break;
      await p.waitForTimeout(400);
    }
    const dis=await p.locator('.quiz-nav .btn-primary').isDisabled().catch(()=>true);
    if (dis) { ok(`шаг ${step+1}: кнопка «Далее» не активировалась`, false); break; }
    await p.locator('.quiz-nav .btn-primary').click(); await p.waitForTimeout(800);
  }
  const contact = await p.locator('#q-name, input[placeholder*="Аида"], .quiz-q').first().innerText().catch(()=> '');
  ok('дошли до контактов', /прислать результат/i.test(await p.locator('.quiz-q').first().innerText().catch(()=>'')));
  await p.screenshot({path:`shots/quiz-${vn}-contact.png`,fullPage:true});

  // заполняем контакты
  const inputs = p.locator('#screen input');
  const cnt = await inputs.count();
  for (let i=0;i<cnt;i++){
    const ph=(await inputs.nth(i).getAttribute('placeholder'))||'';
    if (/@/.test(ph)) await inputs.nth(i).fill('e2e.quiz.'+Date.now()+'@scholary-test.kz');
    else if (/7|\+/.test(ph)) await inputs.nth(i).fill('+77010000003');
    else await inputs.nth(i).fill('Айгерим Тест');
  }
  await p.waitForTimeout(400);
  const go=p.locator('#screen .btn-primary').last();
  await go.click({force:true}); await p.waitForTimeout(3500);
  const txt=await p.locator('body').innerText();
  ok('показан результат/пейволл', /вероятност|шанс|4\s?000|отч[её]т/i.test(txt));
  await p.screenshot({path:`shots/quiz-${vn}-result.png`,fullPage:true});
  const over=await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  ok(`нет горизонтальной прокрутки (${over}px)`, over<=1);
  log.push(`${vn} ${errs.length?'✗ JS: '+JSON.stringify(errs.slice(0,3)):'✓ без JS-ошибок'}`);
  await ctx.close();
}
await b.close(); console.log(log.join('\n'));
