import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve('build'); const PORT=8125;
const MIME={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.txt':'text/plain','.xml':'application/xml'};
const srv=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);let f=path.join(ROOT,u);if(u.endsWith('/'))f=path.join(f,'index.html');if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);});
await new Promise(r=>srv.listen(PORT,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
for (const [vn,w,h] of [['desk',1440,900],['mob',390,844]]) {
  const ctx=await b.newContext({viewport:{width:w,height:h},deviceScaleFactor:2});
  await ctx.route('**',r=>r.request().url().startsWith('http://localhost')?r.continue():r.abort());
  const p=await ctx.newPage();
  await p.goto(`http://localhost:${PORT}/`,{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(700);
  await p.evaluate(()=>document.querySelectorAll('.rv').forEach(e=>e.classList.add('in')));
  await p.evaluate(()=>{document.querySelectorAll('*').forEach(e=>{e.style.animation='none';});});
  await p.evaluate(()=>document.querySelector('.hero-visual').scrollIntoView({block:'center'}));
  await p.waitForTimeout(400);
  const res = await p.evaluate(()=>{
    const hv=document.querySelector('.hero-visual'); if(!hv) return 'нет .hero-visual';
    const targets=[...hv.querySelectorAll('.b-title,.b-line,.mr-head,.mr-big,.mr-cap,.mr-name,.mr-badge,.float-badge')];
    const bad=[];
    for(const t of targets){
      const r=t.getBoundingClientRect(); if(r.width<4||r.height<4) continue;
      const pts=[[r.left+6,r.top+r.height/2],[r.left+r.width/2,r.top+r.height/2],[r.right-6,r.top+r.height/2]];
      let covered=0;
      for(const [x,y] of pts){ const el=document.elementFromPoint(x,y); if(!el||!(t.contains(el)||el.contains(t))) covered++; }
      if(covered>0) bad.push({txt:(t.textContent||'').trim().slice(0,42), covered, cls:t.className});
    }
    const hr=hv.getBoundingClientRect();
    return {height:Math.round(hr.height), bad};
  });
  console.log(vn, JSON.stringify(res, null, 1));
  await p.locator('.hero-visual').screenshot({path:`shots/hero-${vn}.png`});
  await ctx.close();
}
await b.close(); srv.close();
