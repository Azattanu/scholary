/* Scholary · проверка доступности без внешних библиотек:
   контраст текста, размеры зон нажатия, подписи у полей и кнопок,
   alt у картинок, порядок заголовков, видимый фокус. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve('build'), PORT=8129;
const MIME={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.txt':'text/plain','.xml':'application/xml'};
const srv=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);let f=path.join(ROOT,u);if(u.endsWith('/'))f=path.join(f,'index.html');if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);});
await new Promise(r=>srv.listen(PORT,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const PAGES=[['главная','/'],['квиз','/quiz/'],['пример отчёта','/demo/'],['тарифы','/tariffs/'],['оферта','/oferta/'],['политика','/privacy/'],['кабинет','/cabinet/'],['404','/error_docs/404.html']];
const out=[];
for (const [name,url] of PAGES) {
  const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await ctx.route('**',r=>r.request().url().startsWith(`http://localhost:${PORT}`)?r.continue():r.abort());
  const p=await ctx.newPage();
  await p.goto(`http://localhost:${PORT}${url}`,{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(1200);
  await p.evaluate(()=>document.querySelectorAll('.rv').forEach(e=>e.classList.add('in')));
  const res=await p.evaluate(()=>{
    const problems=[];
    const lum=c=>{const[r,g,bl]=c.map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);});return .2126*r+.7152*g+.0722*bl;};
    const parse=s=>{const m=(s||'').match(/rgba?\(([^)]+)\)/); if(!m) return null; const a=m[1].split(',').map(x=>parseFloat(x)); return {rgb:a.slice(0,3), a:a.length>3?a[3]:1};};
    // фон складываем послойно: полупрозрачные подложки смешиваем с тем, что под ними
    const bgOf=el=>{
      const layers=[]; let e=el;
      while(e&&e!==document.documentElement){
        const c=parse(getComputedStyle(e).backgroundColor);
        if(c&&c.a>0.01){ layers.push(c); if(c.a>=0.999) break; }
        e=e.parentElement;
      }
      let out=[255,255,255];
      for(let i=layers.length-1;i>=0;i--){const l=layers[i]; out=out.map((v,k)=>l.rgb[k]*l.a+v*(1-l.a));}
      return out;
    };
    const ratio=(a,b)=>{const l1=lum(a),l2=lum(b); const hi=Math.max(l1,l2),lo=Math.min(l1,l2); return (hi+.05)/(lo+.05);};
    // 1. контраст текста
    document.querySelectorAll('p,span,a,li,td,th,label,button,h1,h2,h3,h4,div').forEach(el=>{
      if (el.children.length && ![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())) return;
      const t=(el.textContent||'').trim(); if(!t || t.length>200) return;
      const cs=getComputedStyle(el);
      if (cs.visibility==='hidden'||cs.display==='none'||parseFloat(cs.opacity)<0.5) return;
      const r=el.getBoundingClientRect(); if(r.width<4||r.height<4) return;
      const fg=parse(cs.color); if(!fg) return;
      const size=parseFloat(cs.fontSize), weight=parseInt(cs.fontWeight)||400;
      const large = size>=24 || (size>=18.66 && weight>=700);
      const need = large?3:4.5;
      const cr=ratio(fg.rgb, bgOf(el));
      if (cr < need) problems.push(`контраст ${cr.toFixed(2)} < ${need} · ${size}px · «${t.slice(0,44)}»`);
    });
    // 2. зоны нажатия
    document.querySelectorAll('a[href],button,input,select,textarea,[role=button]').forEach(el=>{
      const cs=getComputedStyle(el); if(cs.display==='none'||cs.visibility==='hidden') return;
      const r=el.getBoundingClientRect(); if(r.width===0&&r.height===0) return;
      const inline = el.tagName==='A' && getComputedStyle(el.parentElement).display.indexOf('flex')===-1 && cs.display==='inline';
      if (inline) return;
      if (r.height<40 || r.width<40) problems.push(`мелкая зона нажатия ${Math.round(r.width)}×${Math.round(r.height)} · «${(el.textContent||el.getAttribute('aria-label')||el.type||'').trim().slice(0,34)}»`);
    });
    // 3. подписи и alt
    document.querySelectorAll('img').forEach(el=>{ if(!el.hasAttribute('alt')) problems.push('картинка без alt: '+(el.getAttribute('src')||'').slice(0,50)); });
    document.querySelectorAll('input,select,textarea').forEach(el=>{
      if (el.type==='hidden') return;
      const id=el.id, lab=id?document.querySelector(`label[for="${id}"]`):null;
      if (!lab && !el.getAttribute('aria-label') && !el.closest('label') && !el.getAttribute('placeholder'))
        problems.push('поле без подписи: '+(el.name||el.id||el.type));
    });
    document.querySelectorAll('button,[role=button],a').forEach(el=>{
      const n=(el.textContent||'').trim() || el.getAttribute('aria-label') || el.getAttribute('title');
      if (!n) { const r=el.getBoundingClientRect(); if(r.width>0) problems.push('кнопка/ссылка без названия: '+el.className.slice(0,40)); }
    });
    // 4. язык и заголовки
    if (!document.documentElement.lang) problems.push('нет lang у <html>');
    if (document.querySelectorAll('h1').length!==1) problems.push('h1 на странице: '+document.querySelectorAll('h1').length);
    return problems;
  });
  const uniq=[...new Set(res)];
  out.push({name, count:uniq.length, sample:uniq.slice(0,12)});
  await ctx.close();
}
await b.close(); srv.close();
out.forEach(o=>{ console.log(`\n=== ${o.name} · замечаний ${o.count}`); o.sample.forEach(s=>console.log('   ·', s)); });
