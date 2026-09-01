/* Скриншоты «глубоких» экранов кабинета на боевом сайте: подписка, мой шанс,
   паспорт подачи, письмо, пустые состояния. */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
const SB='https://hpudoeiqykfgtxwfbfbl.supabase.co', ANON='sb_publishable_XQ39e3HavSUXxXMEo9NWvg_XV5ZQ0Up';
const EMAIL='e2e.scr.'+Date.now()+'@scholary-test.kz', PASS='Test-'+Date.now()+'aA!', LEAD=crypto.randomUUID();
const ANSW={level:'bachelor',year:'2027',gpa_band:'4.4-4.0',lang_status:'have',ielts_band:'6.5',field:'it,eng',
  achievements:'rep_olymp,project',budget:'<1m',priority:'scholarship',name:'Айгерим Тест',phone:'+77010000002',email:EMAIL,city:'Алматы'};
await fetch(SB+'/rest/v1/rpc/upsert_lead',{method:'POST',headers:{'Content-Type':'application/json',apikey:ANON,Authorization:'Bearer '+ANON},
  body:JSON.stringify({p_id:LEAD,p:Object.assign({updated_at:new Date().toISOString()},ANSW)})});
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
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
  await p.goto('https://scholary.kz/cabinet/');
  await p.evaluate(([l,a])=>{localStorage.setItem('scholary_lead_id',l);localStorage.setItem('scholary_quiz_v1',JSON.stringify({answers:a,step:7}));},[LEAD,ANSW]);
  await p.reload(); await p.waitForSelector('#v-auth:not([hidden])',{timeout:25000});
  await p.click('#lnk-signup'); await p.fill('#su-name','Айгерим Тест'); await p.fill('#su-email',EMAIL); await p.fill('#su-pass',PASS);
  await p.click('#f-signup button[type=submit]');
  await p.waitForSelector('#v-claim:not([hidden]), #v-app:not([hidden])',{timeout:30000});
  if (await p.locator('#v-claim:not([hidden])').count()) await p.click('#btn-claim');
  await p.waitForSelector('#v-app:not([hidden])',{timeout:30000}); await p.waitForTimeout(2500);
  const shot=n=>p.screenshot({path:`shots/scr-${vn}-${n}.png`,fullPage:true});

  // подписка
  await p.click('#tabbar button[data-tab=profile]'); await p.waitForTimeout(900);
  const sub=p.locator('#tab-profile [data-act="subscribe"]').first();
  if (await sub.count()) { await sub.click({force:true}); await p.waitForTimeout(1400); await shot('subscribe');
    const bk=p.locator('#sub-view [data-act="back"]').first(); if (await bk.count()) { await bk.click({force:true}); await p.waitForTimeout(800); } }
  // мой шанс
  await p.click('#tabbar button[data-tab=today]'); await p.waitForTimeout(900);
  const ch=p.locator('#tab-today [data-act="chance"]').first();
  if (await ch.count()) { await ch.click({force:true}); await p.waitForTimeout(1400); await shot('chance');
    const bk=p.locator('#sub-view [data-act="back"]').first(); if (await bk.count()) { await bk.click({force:true}); await p.waitForTimeout(800); } }
  // паспорт подачи
  await p.click('#tabbar button[data-tab=apps]'); await p.waitForTimeout(1200);
  const app=p.locator('#tab-apps [data-act="app"]').first();
  if (await app.count()) { await app.click({force:true}); await p.waitForTimeout(1600); await shot('app');
    const bk=p.locator('#sub-view [data-act="back"]').first();
    if (await bk.count()) { await bk.click({force:true}); await p.waitForTimeout(800); } }
  // письмо
  await p.click('#tabbar button[data-tab=docs]'); await p.waitForTimeout(900);
  const lw=p.locator('#tab-docs [data-act="doc"], #tab-docs [data-act="doc-new"]').first();
  if (await lw.count()) { await lw.click({force:true}); await p.waitForTimeout(1800); await shot('doc'); }
  // телеграм
  await p.click('#tabbar button[data-tab=profile]'); await p.waitForTimeout(800);
  const tg=p.locator('#tab-profile [data-act="tg"]').first();
  if (await tg.count()) { await tg.click({force:true}); await p.waitForTimeout(1400); await shot('telegram'); }
  console.log(vn, errs.length? 'JS-ОШИБКИ: '+JSON.stringify(errs.slice(0,3)) : 'без JS-ошибок');
  await ctx.close();
}
await b.close(); console.log('EMAIL='+EMAIL);
