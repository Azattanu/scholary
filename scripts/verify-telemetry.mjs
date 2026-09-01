/* Проверяем на боевом сайте, что Sentry и PostHog реально грузятся и шлют события. */
import { chromium } from 'playwright';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await b.newContext({viewport:{width:390,height:844}});
const seen={sentry:[],posthog:[]};
await ctx.route('**', async route=>{
  const u=route.request().url();
  if(/ingest\.(de|us)\.sentry\.io|sentry-cdn\.com/.test(u)) seen.sentry.push(u.split('?')[0].slice(0,80));
  if(/posthog\.com/.test(u)) seen.posthog.push(u.split('?')[0].slice(0,80));
  try{const q=route.request();
    const r=await fetch(u,{method:q.method(),headers:Object.fromEntries(Object.entries(q.headers()).filter(([k])=>!/^(host|content-length|accept-encoding|origin|referer)$/i.test(k))),body:['GET','HEAD'].includes(q.method())?undefined:q.postDataBuffer()});
    const buf=Buffer.from(await r.arrayBuffer()); const hd={}; r.headers.forEach((v,k)=>{if(!/^(content-encoding|content-length|transfer-encoding)$/i.test(k))hd[k]=v;}); hd['access-control-allow-origin']='*';
    return route.fulfill({status:r.status,headers:hd,body:buf});}catch(e){return route.abort();}
});
const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,120)));
await p.goto('https://scholary.kz/',{waitUntil:'domcontentloaded'});
await p.waitForTimeout(6000);
const st=await p.evaluate(()=>({sentry: typeof window.Sentry, posthog: typeof window.posthog, phLoaded: !!(window.posthog && window.posthog.__loaded), cfg: !!(window.SCHOLARY_CONFIG && window.SCHOLARY_CONFIG.POSTHOG_KEY)}));
// шлём тестовое событие и тестовую ошибку
await p.evaluate(()=>{ try{ window.track && window.track('telemetry_smoke_test', {ok:1, email:'должно быть вырезано'}); }catch(e){} });
await p.evaluate(()=>{ try{ window.Sentry && window.Sentry.captureMessage('scholary telemetry smoke test'); }catch(e){} });
await p.waitForTimeout(5000);
console.log('состояние:', JSON.stringify(st));
console.log('запросы Sentry :', [...new Set(seen.sentry)].slice(0,4).join('\n                 '));
console.log('запросы PostHog:', [...new Set(seen.posthog)].slice(0,4).join('\n                 '));
console.log('JS-ошибки:', errs.length? errs.slice(0,3) : 'нет');
await b.close();
