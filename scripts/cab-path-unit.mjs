// Юнит-тесты js/cabinet-path.js (недели сезона, темы, задачи, серия недель, прогресс, вехи, календарь, подборки). Запуск: node scripts/cab-path-unit.mjs
import fs from "fs";
global.window = {};
eval(fs.readFileSync(new URL("../js/cabinet-path.js", import.meta.url), "utf8"));
const P = window.ScholaryPath;
let fails = 0; const ok = (c, m) => { console.log((c ? "OK   " : "FAIL ") + m); if (!c) fails++; };
// неделя сезона
const w1 = P.weekInfo(new Date(2026, 8, 1)); ok(w1.n === 1 && w1.key === "2026-08-31", "1 сентября → неделя 1, старт недели 31.08: " + w1.key + " " + w1.label);
const w11 = P.weekInfo(new Date(2026, 10, 15)); ok(w11.n === 11, "15 ноября → неделя 11 (" + w11.n + ")");
const w20 = P.weekInfo(new Date(2027, 0, 15)); ok(w20.n === 20 && w20.seasonStart.getFullYear() === 2026, "15 января 2027 → неделя 20 сезона 2026");
const wJul = P.weekInfo(new Date(2027, 6, 10)); ok(wJul.n === 44, "июль → потолок 44");
// темы
ok(P.themeFor("bachelor", new Date(2026, 8, 20)).key === "9-2" && /IELTS/.test(P.themeFor("bachelor", new Date(2026, 8, 20)).task), "тема бакалавра сен-2: IELTS");
ok(/Рекомендатели/.test(P.themeFor("master", new Date(2026, 8, 20)).title), "тема магистра сен-2: рекомендатели");
ok(P.themeFor("phd", new Date(2026, 11, 20)).key === "12-2", "PhD использует карту магистра");
// дедлайн из MM-DD
const nd = P.nextFromMD("01-15", new Date(2026, 8, 5)); ok(nd.getFullYear() === 2027 && nd.getMonth() === 0, "01-15 в сентябре → 15.01.2027");
ok(P.nextFromMD("02-30", new Date()) === null, "02-30 → null");
// задачи: 2 подачи, апостиль overdue, письмо нет, языка нет
const TYPES = { apostille: { title: "Апостиль" }, motivation: { title: "Письмо" } };
const app = (id, pid, days, missing, req) => ({ a: { id, program_id: pid, submitted_at: null, added_at: "2026-08-01" }, prog: { id: pid, req: req || { language: 6.5, budget: 0 } }, title: "Prog " + pid, days, date: P.addDays(new Date(2026, 8, 7), days), rd: { pct: 30, required: [{ t: "motivation" }, { t: "apostille" }], missing } });
const ctx = { today: new Date(2026, 8, 9), level: "bachelor", ans: { level: "bachelor", lang_status: "none", budget: "0" },
  apps: [app(1, "sh", 40, [{ t: "motivation" }, { t: "apostille" }]), app(2, "gks", 10, [{ t: "motivation" }])],
  plan: [{ t: "apostille", T: TYPES.apostille, required: true, status: "none", urgency: "overdue", daysToStart: -4, chainLead: 28, usesCount: 2, startBy: new Date(2026, 8, 5) }],
  docs: [], state: {}, TYPES };
const r = P.buildTasks(ctx);
console.log(r.tasks.map(t => t.key + " | " + t.title).join("\n"));
ok(r.tasks.length >= 3 && r.tasks.length <= 6, "3–6 задач (" + r.tasks.length + ")");
ok(r.tasks[0].key === "2026-09-07:doc:apostille:start" || r.tasks[0].key === "2026-09-07:app:2:submit", "первой — просроченный апостиль или подача через 10 дней: " + r.tasks[0].key);
ok(r.tasks.some(t => /app:2:submit/.test(t.key)), "подача с дедлайном через 10 дней в задачах");
ok(r.tasks.some(t => /letter:/.test(t.key)), "письмо в задачах");
ok(r.tasks.some(t => /theme:9-1/.test(t.key)), "тема недели 9-1");
ok(r.tasks.every(t => t.key.startsWith("2026-09-07:")), "ключи детерминированы по понедельнику недели");
const r2 = P.buildTasks(ctx); ok(JSON.stringify(r2.tasks.map(t => t.key)) === JSON.stringify(r.tasks.map(t => t.key)), "повторный вызов даёт тот же план");
// состояние и перенос
ctx.state = { "2026-08-31:docs:expiry": { status: "moved", title: "Проверить сроки действия документов" }, "2026-09-07:theme:9-1": { status: "done" } };
const r3 = P.buildTasks(ctx);
ok(r3.tasks[0].carried && r3.tasks[0].key === "2026-09-07:docs:expiry" && r3.tasks.length <= 6, "перенесённая задача с прошлой недели стоит первой, всего ≤ 6 (" + r3.tasks.length + ")");
ok(r3.tasks.find(t => t.key === "2026-09-07:theme:9-1").status === "done", "статус done подхватывается");
// пустой кабинет
const r4 = P.buildTasks({ today: new Date(2026, 8, 9), level: "master", ans: {}, apps: [], plan: [], docs: [], state: {} });
ok(r4.tasks.length >= 2 && r4.tasks.some(t => /unis:add3/.test(t.key)), "пусто → «выбрать 3 программы» + тема + стипендия недели (" + r4.tasks.map(t => t.key.split(":").slice(1).join(":")).join(", ") + ")");
// недели с прогрессом: 8-я неделя (сегодня 26 окт), прогресс 5 из 6 прошлых недель с пропуском одной в октябре
const today = new Date(2026, 9, 26);
const act = ["2026-09-08", "2026-09-16", "2026-09-22", "2026-10-06", "2026-10-13", "2026-10-20"].map(d => ({ day: d, progress: true }));
const wp = P.weeksProgress(act, [], today);
ok(wp.streak === 6 && wp.frozenWeeks.length === 1 && !wp.thisWeek, "пропуск 28.09 заморожен → серия 6, текущая неделя пока не закрыта (" + wp.streak + ", frozen " + wp.frozenWeeks.join(",") + ")");
const wp2 = P.weeksProgress(act.slice(3), [], today); ok(wp2.streak === 3, "три недели подряд → 3");
const wp3 = P.weeksProgress([{ day: "2026-09-08", progress: true }], [], today); ok(wp3.streak === 0 && wp3.total === 1, "давняя активность → серия 0 без «сломано», всего недель 1");
const wp4 = P.weeksProgress(act.slice(3), ["2026-10-26"], today); ok(wp4.streak === 4 && wp4.quietThisWeek, "тихая текущая неделя засчитана");
// прогресс
const pr = P.progress({ ans: { level: "bachelor" }, apps: ctx.apps, plan: [{ required: true, status: "ready" }, { required: true, status: "none" }] });
ok(pr.pct === 10 + Math.round(10 * 2 / 3) + 20 && pr.rings.docs.pct === 50 && pr.rings.letters.total === 2, "прогресс: анкета 10 + портфель 7 + документы 20 = " + pr.pct + ", кольца docs 50%, letters 0/2");
// вехи
const ach = P.checkAchievements({ apps: ctx.apps, docs: [{ doc_type: "motivation", content: "x".repeat(300), score: 8.5 }, { file_path: "a" }], weeks: { total: 1, streak: 1 }, tgLinked: true }, { first_app: 1 });
ok(ach.indexOf("first_app") < 0 && ach.indexOf("letter_8") >= 0 && ach.indexOf("first_file") >= 0 && ach.indexOf("week_1") >= 0 && ach.indexOf("tg_linked") >= 0 && ach.indexOf("three_apps") < 0, "вехи: новые без уже полученных: " + ach.join(","));
// календарь
const cal = P.calendarHTML(new Date(2026, 8, 1), { "2026-09-15": [{ title: "X", mine: true }], "2026-09-20": [{ title: "Y", mine: false }] }, new Date(2026, 8, 9));
ok(/Сентябрь 2026/.test(cal) && (cal.match(/class="cal-d/g) || []).length >= 30 && /today/.test(cal) && /mine/.test(cal) && / cat"/.test(cal), "календарь: месяц, 30 дней, сегодня, метки мои/каталог");
// подборки
const progs = [
  { id: "a", name: "A", cc: "hu", levels: ["bachelor"], req: { budget: 0, language: 6 }, funding: "обучение + 1 000 €/мес", deadline_md: "09-25", apply_open_md: "08-25", verified: true },
  { id: "b", name: "B", cc: "ru", levels: ["bachelor"], req: { budget: 0 }, deadline_md: "09-20" },
  { id: "c", name: "C", cc: "kr", levels: ["master"], req: { budget: 0 }, deadline_md: "10-17" },
  { id: "d", name: "D", cc: "de", levels: ["bachelor"], req: { budget: 3, language: 4 }, lang_year: true, deadline_md: "01-15", updated_at: new Date(2026, 8, 1).toISOString(), added_at: new Date(2026, 8, 1).toISOString() }
];
const cctx = { today: new Date(2026, 8, 9), level: "bachelor", ans: { budget: "1-3m", field: ["it"] }, matchOf: p => p.id === "a" ? 80 : 40 };
const cols = P.collections(progs, cctx);
const byKey = Object.fromEntries(cols.map(c => [c.key, c.items.map(p => p.id)]));
ok(byKey.deadline && byKey.deadline.join() === "a" && !byKey.deadline.includes("b"), "«дедлайн в этом месяце»: только A (РФ исключена, C — магистр): " + JSON.stringify(byKey.deadline));
ok(byKey.free.join() === "a" && byKey.noielts.join() === "d" && byKey.living.join() === "a" && byKey.new.join() === "d" && byKey.budget.includes("d") && byKey.opened.join() === "a" && byKey.langyear.join() === "d", "подборки free/noielts/living/new/budget/opened/langyear: " + JSON.stringify(byKey));
const pow = P.programOfWeek(progs, cctx, {}); ok(pow && pow.prog.id === "a" && /открылся/.test(pow.reason), "программа недели: A (приём открылся): " + (pow && pow.reason));
const bd = P.badges(progs[0], cctx).map(b => b.t); ok(bd.includes("полное покрытие") && bd.includes("на жизнь") && bd.some(x => /через 16 дн/.test(x)) && bd.includes("приём открыт") && bd.includes("проверено"), "плашки A: " + bd.join(" · "));
ok(P.contentFor([{ title: "x", level: "master" }, { title: "y", week_from: 1, week_to: 3 }, { title: "z", active: false }, { title: "w" }], "bachelor", 2).map(r => r.title).join() === "y,w", "материалы: фильтр по уровню/неделе/active");
ok(P.parseDeepLink("?tab=unis&d=free&from=tg").tab === "unis" && P.parseDeepLink("?tab=hack").tab === null, "deep-link парсится и валидируется");
console.log(fails ? "FAILS " + fails : "ALL OK"); process.exit(fails ? 1 : 0);
