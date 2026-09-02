/* Проверяем новый выход с пейволла: кнопка «Открыть бесплатный кабинет»
   должна быть видна и вести в /cabinet/. Гоняем по локальной сборке. */
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:8123';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const [vn, w, h] of [['мобильный', 390, 844], ['десктоп', 1440, 900]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto(BASE + '/quiz/', { waitUntil: 'load' });
  await p.waitForTimeout(700);
  // проходим квиз: на каждом шаге кликаем первый вариант в каждой группе и жмём «Далее»
  for (let step = 0; step < 12; step++) {
    const contact = await p.$('#fName');
    if (contact) break;
    const groups = await p.$$('.quiz-group, .opts, .quiz-opts');
    const opts = await p.$$('.opt, .quiz-opt, button.opt');
    if (opts.length) { for (const o of opts.slice(0, 1)) { await o.click().catch(()=>{}); } }
    // разные группы на одном шаге
    const chips = await p.$$('.chip');
    if (chips.length) await chips[0].click().catch(()=>{});
    const next = await p.$('button:has-text("Далее")');
    if (next) { await next.click().catch(()=>{}); }
    await p.waitForTimeout(280);
  }
  const atContact = !!(await p.$('#fName'));
  if (atContact) {
    await p.fill('#fName', 'Тест Тестов');
    await p.fill('#fWa', '+7 701 000 00 00');
    const go = await p.$('button:has-text("Показать результат")') || await p.$('button:has-text("Далее")');
    if (go) await go.click();
    await p.waitForTimeout(1500);
  }
  const free = await p.$('#toFree');
  const pay = await p.$('#toPay');
  console.log(`${vn}: контакты ${atContact ? '✓' : '✗'} · пейволл ${pay ? '✓' : '✗'} · кнопка бесплатного кабинета ${free ? '✓' : '✗'}`);
  if (free) {
    await free.click();
    await p.waitForTimeout(900);
    console.log(`   после клика: ${new URL(p.url()).pathname}`);
  }
  console.log('   ошибки:', errs.length ? errs.slice(0,3) : 'нет');
  await p.close();
}
await b.close();
