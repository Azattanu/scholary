import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await p.addInitScript(() => { window.__STUB_PROFILE = { user_id: '00000000-0000-0000-0000-000000000001', name: 'Тест', answers: null, lead_ids: [] }; });
await p.goto('http://127.0.0.1:8123/cabinet/', { waitUntil: 'load' });
await p.waitForTimeout(1200);

const seen = async () => p.evaluate(() => ['loading','v-auth','v-claim','v-setup','v-empty','v-app'].filter(id => { const e = document.getElementById(id); return e && !e.hidden; }));
console.log('после входа виден экран:', await seen());

await p.click('#btn-empty-setup');
await p.waitForTimeout(300);
console.log('после «Заполнить анкету»:', await seen());

const picks = [
  ['Бакалавриат'], ['2027'], ['5.0–4.5'], ['IELTS 6.5'],
  ['IT и Computer Science', 'Инженерия и технологии'],
  ['0 ₸ — только стипендия'],
  ['Республиканские олимпиады']
];
for (let step = 0; step < picks.length; step++) {
  const q = await p.textContent('.setup-q');
  const count = await p.textContent('#setup-count');
  for (const label of picks[step]) {
    await p.click(`.setup-opt:has-text("${label}")`);
    await p.waitForTimeout(120);
  }
  await p.waitForTimeout(450);
  const nowQ = (await p.$('.setup-q')) ? await p.textContent('.setup-q') : null;
  const advanced = nowQ !== q;
  console.log(`  шаг ${count.padEnd(8)} «${q}» → ${picks[step].join(', ')}${advanced ? ' | ушёл дальше сам' : ' | жму «Далее»'}`);
  if (!advanced) { await p.click('#setup-next'); await p.waitForTimeout(400); }
}
await p.waitForTimeout(1800);
console.log('после анкеты виден экран:', await seen());
console.log('вкладок в приложении:', await p.evaluate(() => document.querySelectorAll('#tabbar button').length));
console.log('заголовок «Сегодня»:', (await p.textContent('#tab-today').catch(()=>'')).slice(0,80).replace(/\s+/g,' '));
const upd = await p.evaluate(() => (window.__STUB_UPDATES || []).map(u => ({ t: u.t, keys: Object.keys(u.patch), ans: u.patch.answers })));
console.log('записано в профиль:', JSON.stringify(upd[0] && upd[0].ans));
console.log('ошибки:', errs.length ? errs : 'нет');
await p.screenshot({ path: '/tmp/setup-done.png' });
await b.close();
