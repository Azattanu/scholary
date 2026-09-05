/* Scholary · e2e кабинета 2.0 на локальной сборке build/ с боевой базой.
   Проверяет: регистрацию, клейм лида, все вкладки, карточку документа,
   ИИ-разбор документа и письма, мобайл и десктоп. */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';

const ROOT = path.resolve('build'), PORT = 8127;
const PROD = !!process.env.PROD;
const BASE = PROD ? 'https://scholary.kz' : `http://localhost:${PORT}`;
const SB = 'https://hpudoeiqykfgtxwfbfbl.supabase.co';
const ANON = 'sb_publishable_XQ39e3HavSUXxXMEo9NWvg_XV5ZQ0Up';
const MIME={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.txt':'text/plain','.xml':'application/xml'};
const srv=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);let f=path.join(ROOT,u);if(u.endsWith('/'))f=path.join(f,'index.html');if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end('404');return;}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);});
await new Promise(r=>srv.listen(PORT,r));

const EMAIL = 'e2e.cab2.' + Date.now() + '@scholary-test.kz';
const PASS  = 'Test-' + Date.now() + 'aA!';
const LEAD  = crypto.randomUUID();
const ANSW = { level:'bachelor', year:'2027', gpa_band:'4.4-4.0', lang_status:'have', ielts_band:'6.5',
  field:'it,eng', achievements:'rep_olymp,project', budget:'<1m', priority:'scholarship',
  name:'Айгерим Тест', phone:'+77010000001', email: EMAIL, city:'Алматы' };

// лид создаём заранее — как будто человек прошёл квиз
const up = await fetch(SB + '/rest/v1/rpc/upsert_lead', { method:'POST',
  headers:{'Content-Type':'application/json', apikey:ANON, Authorization:'Bearer '+ANON},
  body: JSON.stringify({ p_id: LEAD, p: Object.assign({ updated_at:new Date().toISOString() }, ANSW) }) });
console.log('0. лид создан:', up.status);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const log = [];
async function run(vn, w, h) {
  const ctx = await b.newContext({ viewport:{width:w,height:h}, deviceScaleFactor:2, isMobile: vn==='mob', hasTouch: vn==='mob' });
  await ctx.route('**', async route => {
    let url = route.request().url();
    if (!PROD && url.startsWith(BASE + '/api/')) url = 'https://scholary.kz' + url.slice(BASE.length);
    else if (!PROD && url.startsWith(BASE)) return route.continue();
    try {
      const req = route.request();
      const r = await fetch(url, { method: req.method(),
        headers: Object.fromEntries(Object.entries(req.headers()).filter(([k])=>!/^(host|content-length|accept-encoding|origin|referer)$/i.test(k))),
        body: ['GET','HEAD'].includes(req.method()) ? undefined : req.postDataBuffer() });
      const buf = Buffer.from(await r.arrayBuffer());
      const hd = {}; r.headers.forEach((v,k)=>{ if(!/^(content-encoding|content-length|transfer-encoding)$/i.test(k)) hd[k]=v; });
      hd['access-control-allow-origin'] = '*';
      return route.fulfill({ status:r.status, headers:hd, body:buf });
    } catch(e) { return route.abort(); }
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0,160)));
  p.on('console', m => { if (m.type()==='error') errs.push('console: ' + m.text().slice(0,160)); });
  const shot = n => p.screenshot({ path:`shots/cab-${PROD?'prod-':''}${vn}-${n}.png`, fullPage:true });
  const ok = (n, c) => log.push(`${vn} ${c ? '✓' : '✗'} ${n}`);

  await p.goto(BASE + '/cabinet/');
  await p.evaluate(([lead, ans]) => {
    localStorage.setItem('scholary_lead_id', lead);
    localStorage.setItem('scholary_quiz_v1', JSON.stringify({ answers: ans, step: 7 }));
  }, [LEAD, ANSW]);
  await p.reload();
  await p.waitForSelector('#v-auth:not([hidden])', { timeout:20000 });
  ok('экран входа', true); await shot('1-auth');

  if (vn === 'mob') {
    await p.click('#lnk-signup');
    await p.fill('#su-name', 'Айгерим Тест'); await p.fill('#su-email', EMAIL); await p.fill('#su-pass', PASS);
    await p.click('#f-signup button[type=submit]');
  } else {
    await p.fill('#li-email', EMAIL); await p.fill('#li-pass', PASS);
    await p.click('#f-login button[type=submit]');
  }
  const claimed = await p.waitForSelector('#v-claim:not([hidden]), #v-app:not([hidden])', { timeout:30000 }).catch(()=>null);
  ok('вход/регистрация', !!claimed);
  if (await p.locator('#v-claim:not([hidden])').count()) { await shot('2-claim'); await p.click('#btn-claim'); }
  await p.waitForSelector('#v-app:not([hidden])', { timeout:30000 });
  await p.waitForTimeout(2500);
  ok('кабинет открылся', true); await shot('3-today');
  /* web-74: «Сегодня» — неделя сезона, задачи, путь, календарь (до и после миграции 042: без базы — localStorage) */
  const today = await p.locator('#tab-today').innerText();
  ok('неделя сезона на «Сегодня»', /Неделя \d+ из 44/.test(today));
  ok('задачи недели', (await p.locator('#tab-today .task').count()) >= 2);
  ok('прогресс пути', /Пройдено \d+% пути/.test(today));
  ok('календарь', (await p.locator('#tab-today .cal-d, #side-widget .cal-d').count()) >= 28);
  /* отметка задачи должна уйти в базу (cab_task_state), а не только в localStorage */
  const tkey = await p.locator('#tab-today .task').first().getAttribute('data-key');
  const tresp = p.waitForResponse(r => /cab_task_state/.test(r.url()) && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null);
  await p.locator(`#tab-today .task[data-key="${tkey}"] [data-act="task-done"]`).click();
  const tr = await tresp; ok(`отметка задачи записана в базу (${tr ? tr.status() : 'нет ответа'})`, !!tr && tr.status() < 300);
  await p.waitForTimeout(600);
  ok('«Неделя засчитана» после первой задачи', /Неделя засчитана/.test(await p.locator('#tab-today').innerText()));

  const tabs = ['apps','unis','docs','profile'];
  for (const t of tabs) {
    await p.click(`#tabbar button[data-tab=${t}]`).catch(()=>{});
    await p.waitForTimeout(1200);
    const txt = await p.locator(`#tab-${t}`).innerText().catch(()=> '');
    ok(`вкладка ${t} (${txt.length} симв.)`, txt.length > 40);
    if (t === 'unis') ok(`Discover: ${await p.locator('#tab-unis .disc-row').count()} подборок, без «новое» на всём каталоге`, (await p.locator('#tab-unis .disc-row').count()) >= 4 && !/🆕 новое/.test(txt));
    if (t === 'docs') ok(`сетка документов (${await p.locator('#tab-docs .dcard').count()} карточек) + общая картина`, (await p.locator('#tab-docs .dcard').count()) >= 4 && /Собрано \d+ из \d+/.test(txt));
    if (t === 'profile') ok('настройки «Моя неделя» в профиле', /Моя неделя/.test(txt));
    await shot('4-' + t);
  }

  // карточка документа + ИИ
  await p.click('#tabbar button[data-tab=docs]'); await p.waitForTimeout(900);
  const docCard = p.locator('[data-act="doc"], [data-act="doc-new"]').first();
  if (await docCard.count()) {
    await docCard.click(); await p.waitForTimeout(1500);
    ok('карточка документа открылась', await p.locator('#sub-view:not([hidden])').count() > 0);
    await shot('5-doc');
    const aiBtn = p.locator('[data-act="ai-doc"]').first();
    if (await aiBtn.count()) {
      await aiBtn.click();
      await p.waitForTimeout(1000);
      await shot('6-ai-loading');
      await p.waitForFunction(()=>!document.querySelector('.spin-sm'), null, { timeout:70000 }).catch(()=>{});
      await p.waitForTimeout(1200);
      const t = await p.locator('#sub-view').innerText();
      ok('ИИ-разбор документа', /ИИ/.test(t) && !/не получился/.test(t));
      await shot('7-ai-doc');
    } else ok('кнопка ИИ на документе', false);
  } else ok('есть документы', false);

  const over = await p.evaluate(()=>document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(`нет горизонтальной прокрутки (${over}px)`, over <= 1);
  /* Метрика заблокирована из песочницы — это не ошибка кабинета */
  const realErrs = errs.filter(e => !/mc\.yandex|ERR_FAILED|Failed to load resource/.test(e));
  if (realErrs.length) log.push(`${vn} ✗ JS-ошибки: ${JSON.stringify(realErrs.slice(0,4))}`);
  else log.push(`${vn} ✓ без JS-ошибок`);
  await ctx.close();
}
const TAG = PROD ? 'prod' : 'loc';
await run('mob', 390, 844);
await run('desk', 1440, 900);
await b.close(); srv.close();
console.log(log.join('\n'));
console.log('EMAIL=' + EMAIL);
