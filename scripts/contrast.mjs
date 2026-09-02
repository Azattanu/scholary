import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve('/home/user/scholary/site/build'), PORT=8163;
const MIME={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const srv=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);let f=path.join(ROOT,u);if(u.endsWith('/'))f=path.join(f,'index.html');if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);});
await new Promise(r=>srv.listen(PORT,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await b.newContext({viewport:{width:390,height:844}});
await ctx.route('**',r=>r.request().url().startsWith('http://localhost')?r.continue():r.fulfill({status:200,body:''}));
const p=await ctx.newPage();
const seen=new Map();
for (const url of ['/','/quiz/','/tariffs/','/oferta/','/privacy/','/report/','/demo/','/cabinet/','/admin/']) {
  await p.goto('http://localhost:'+PORT+url,{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(700);
  await p.evaluate(()=>document.querySelectorAll('.rv').forEach(e=>e.classList.add('in')));
  const res=await p.evaluate(()=>{
    const out=[];
    function lum(c){const m=c.match(/[\d.]+/g);if(!m)return null;const[r,g,bl]=m.slice(0,3).map(Number);const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(r)+.7152*f(g)+.0722*f(bl)}
    function bgOf(el){for(let a=el;a;a=a.parentElement){const bg=getComputedStyle(a).backgroundColor;const m=bg.match(/[\d.]+/g);if(m&&(m.length<4||Number(m[3])>.5))return bg}return 'rgb(255,255,255)'}
    document.querySelectorAll('body *').forEach(el=>{
      const cs=getComputedStyle(el);
      if(cs.display==='none'||cs.visibility==='hidden'||el.hidden)return;
      const hasText=Array.from(el.childNodes).some(n=>n.nodeType===3&&n.textContent.trim().length>2);
      if(!hasText)return;
      const l1=lum(cs.color),l2=lum(bgOf(el));if(l1==null||l2==null)return;
      const ratio=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
      const fs=parseFloat(cs.fontSize),bold=parseInt(cs.fontWeight)>=700;
      const need=(fs>=24||(fs>=18.66&&bold))?3:4.5;
      if(ratio<need-0.05){
        const sel=el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(typeof el.className==='string'&&el.className.trim()?'.'+el.className.trim().split(/\s+/).join('.'):'');
        out.push({sel,ratio:+ratio.toFixed(2),need,color:cs.color,bg:bgOf(el),fs,bold,txt:(el.textContent||'').trim().slice(0,26)});
      }
    });
    return out;
  });
  res.forEach(x=>{ const k=x.sel+'|'+x.color+'|'+x.bg; if(!seen.has(k)) seen.set(k,{...x,url}); });
}
await b.close(); srv.close();
console.log('РАЗНЫХ СЛУЧАЕВ НИЗКОГО КОНТРАСТА:', seen.size);
[...seen.values()].sort((a,b)=>a.ratio-b.ratio).forEach(x=>
  console.log(`  ${String(x.ratio).padStart(5)} (нужно ${x.need})  ${x.sel.slice(0,46).padEnd(48)} ${x.color} на ${x.bg}  «${x.txt}»  ${x.url}`));
