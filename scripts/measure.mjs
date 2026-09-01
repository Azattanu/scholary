import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve('build'); const PORT=8126;
const MIME={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.txt':'text/plain','.xml':'application/xml'};
const srv=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);let f=path.join(ROOT,u);if(u.endsWith('/'))f=path.join(f,'index.html');if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);});
await new Promise(r=>srv.listen(PORT,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
for (const [vn,w,h] of [['desk',1440,900],['mob',390,844]]) {
  const ctx=await b.newContext({viewport:{width:w,height:h}});
  await ctx.route('**',r=>r.request().url().startsWith('http://localhost')?r.continue():r.abort());
  const p=await ctx.newPage();
  await p.goto(`http://localhost:${PORT}/`,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(600);
  await p.evaluate(()=>{document.querySelectorAll('*').forEach(e=>e.style.animation='none');});
  const m = await p.evaluate(()=>{
    const hv=document.querySelector('.hero-visual').getBoundingClientRect();
    const g=s=>{const e=document.querySelector(s); if(!e) return null; const r=e.getBoundingClientRect(); return {top:+(r.top-hv.top).toFixed(1), bottom:+(r.bottom-hv.top).toFixed(1), left:+(r.left-hv.left).toFixed(1), right:+(r.right-hv.left).toFixed(1)};};
    const lastLine=[...document.querySelectorAll('.mr-back-1 .b-line')].pop().getBoundingClientRect();
    const t2=document.querySelector('.mr-back-2 .b-title').getBoundingClientRect();
    return {hvW:+hv.width.toFixed(1), hvH:+hv.height.toFixed(1),
      c1:g('.mr-back-1'), c2:g('.mr-back-2'), mini:g('.mini-report'),
      fb1:g('.fb-1'), fb2:g('.fb-2'),
      c1LastLineBottom:+(lastLine.bottom-hv.top).toFixed(1),
      c2TitleTop:+(t2.top-hv.top).toFixed(1)};
  });
  console.log(vn, JSON.stringify(m));
  await ctx.close();
}
await b.close(); srv.close();
