import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve('build'); const PORT=8151;
const M={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const srv=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);let f=path.join(ROOT,u);if(u.endsWith('/'))f=path.join(f,'index.html');
 if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;} r.writeHead(200,{'Content-Type':M[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);});
await new Promise(r=>srv.listen(PORT,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
for(const p0 of ['/cabinet/','/admin/']){
  const p=await b.newPage({viewport:{width:390,height:844}});
  await p.route(/jsdelivr|unpkg/, r=>r.abort());
  await p.goto('http://127.0.0.1:'+PORT+p0,{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(8000);
  const t=(await p.innerText('body')).replace(/\s+/g,' ').trim();
  console.log(p0+' → '+t.slice(0,180));
  await p.close();
}
await b.close(); srv.close();
