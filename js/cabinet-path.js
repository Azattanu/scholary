/* ============================================================
   Scholary · Путь сезона в кабинете (web-74)

   Зачем. Кабинет умел показывать «следующий шаг», но не отвечал на главный
   вопрос абитуриента: «что мне делать на ЭТОЙ неделе и успеваю ли я».
   Здесь — чистая логика без DOM-состояния: неделя сезона, тема недели,
   детерминированный генератор задач, «недели с прогрессом», прогресс пути,
   три кольца, вехи, календарь месяца и «стипендия недели» из каталога.
   Всё считается из того, что у человека уже есть (подачи, документы,
   каталог, анкета) — поэтому один и тот же человек в одну и ту же неделю
   получает один и тот же план, и он не «прыгает».

   Исследовательская опора — отчёт 62-a: Fogg (способность + промпт),
   planning prompts (Gollwitzer, Milkman), endowed progress (Nunes & Drèze),
   недельные серии с запасом (Sharif & Shu, Silverman & Barasch),
   вехи только за реальные события (SDT), никаких лидербордов.
   ============================================================ */
window.ScholaryPath = (function () {
  "use strict";

  var DAY = 864e5;
  var MONTHS_RU = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  var MONTHS_NOM = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  var WD_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
  var WD_FULL = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
  /* Страны, которые в новых подборках не показываем (правило проекта). */
  var EXCLUDED_CC = { ru: 1, by: 1 };

  function esc(s) { return String(s == null ? "" : s).replace(/[<>&"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]; }); }
  function plural(n, a, b, c) { var x = n % 100; if (x > 4 && x < 20) return c; x = n % 10; return x === 1 ? a : x > 1 && x < 5 ? b : c; }
  function d0(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function iso(d) { var x = d0(d); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0"); }
  function addDays(d, n) { var x = d0(d); x.setDate(x.getDate() + n); return x; }
  function daysBetween(a, b) { return Math.round((d0(a) - d0(b)) / DAY); }
  function fmtShort(d) { return d ? d.getDate() + " " + MONTHS_RU[d.getMonth()].slice(0, 3) : "—"; }
  function fmtLong(d) { return d ? d.getDate() + " " + MONTHS_RU[d.getMonth()] : "—"; }

  /* ---------- сезон и неделя ---------- */
  /* Сезон подач живёт с 1 сентября по 30 июня. Неделя считается с понедельника. */
  function seasonStart(today) {
    var t = d0(today), y = t.getMonth() >= 8 ? t.getFullYear() : t.getFullYear() - 1;
    return new Date(y, 8, 1);
  }
  function weekStart(d) { var x = d0(d); var wd = (x.getDay() + 6) % 7; return addDays(x, -wd); }
  function weekInfo(today) {
    var t = d0(today), ss = seasonStart(t), ws = weekStart(t), we = addDays(ws, 6);
    var n = Math.max(1, Math.min(44, Math.floor(daysBetween(t, ss) / 7) + 1));
    var label = ws.getMonth() === we.getMonth()
      ? ws.getDate() + "–" + we.getDate() + " " + MONTHS_RU[we.getMonth()]
      : fmtLong(ws) + " – " + fmtLong(we);
    return { n: n, total: 44, start: ws, end: we, key: iso(ws), label: label, seasonStart: ss,
             half: t.getDate() <= 15 ? 1 : 2, month: t.getMonth() };
  }

  /* ---------- тема недели (отчёт 47 + каталог) ---------- */
  /* Ключ: месяц-половина. Тема даёт заголовок недели и одну «задачу темы». */
  var THEMES = {
    bachelor: {
      "9-1":  { title: "Честная точка А", task: "Собрать портфель: 3 программы под свой профиль", why: "Сентябрь — время выбрать, куда реально успеваешь. Три подачи — минимум для расчёта", act: "tab-unis" },
      "9-2":  { title: "Решение по IELTS", task: "Решить с IELTS: выбрать дату экзамена", why: "Языковой порог отсекает больше заявок, чем оценки. Дата экзамена = точка, от которой считается весь план", act: "doc:ielts" },
      "10-1": { title: "Бюджет с родителями", task: "Показать родителям расчёт и обсудить бюджет на год", why: "Родители — ЛПР по деньгам. Разговор в октябре экономит ссоры в январе", act: "chance" },
      "10-2": { title: "Первые жёсткие окна", task: "Проверить, что нужно для GKS (17.10) и DAAD (15.10) — успеваешь ли", why: "Первые дедлайны сезона. Даже если не подаёшь — это репетиция пакета", act: "tab-unis" },
      "11-1": { title: "Апостиль и перевод стартуют", task: "Заказать апостиль на аттестат (до 20 рабочих дней)", why: "Самый длинный документ в цепочке. В ноябре он ещё успевает к январским дедлайнам", act: "doc:apostille" },
      "11-2": { title: "Пакет за две недели до срока", task: "Собрать пакет для ближайшей подачи за 14 дней до дедлайна", why: "Половина заявок уходит в последние 3 дня — и там ломается всё", act: "tab-docs" },
      "12-1": { title: "Мотивационные письма", task: "Написать черновик мотивационного письма", why: "Письма правятся по 3–4 круга. Первый черновик — самый трудный, дальше легче", act: "letter" },
      "12-2": { title: "Каникулы — две свободные недели", task: "Довести письма до финала за каникулы", why: "Единственные две недели без школы за весь сезон. Потом — январь и пик подач", act: "letter" },
      "1-1":  { title: "Пик подач № 1", task: "Проверить пакет и отправить подачу с ближайшим дедлайном", why: "Stipendium Hungaricum 15 января, Erasmus, KAUST, need-blind США — окна закрываются одновременно", act: "tab-apps" },
      "1-2":  { title: "Проверка пакетов", task: "Прогнать финальную проверку по каждой подаче", why: "Последняя точка, где ошибку ещё можно поймать", act: "tab-apps" },
      "2-1":  { title: "Пик подач № 2", task: "Отправить подачи второй волны (CSC, Türkiye Bursları, Чехия)", why: "Февральские окна — последний большой шанс на полное покрытие", act: "tab-apps" },
      "2-2":  { title: "Интервью", task: "Подготовить ответы на 5 типовых вопросов интервью", why: "Часть программ зовёт на интервью в марте. Ответы лучше репетировать заранее", act: "chance" },
      "3-1":  { title: "Италия и ожидание", task: "Проверить окна Италии (MAECI, региональные DSU)", why: "Италия закрывается в марте–апреле, и это часто 0 ₸", act: "discover:free" },
      "3-2":  { title: "Что делать, пока ждёшь", task: "Обновить статусы подач и отметить ответы", why: "Ответы вузов начинают приходить. Отметки уточняют модель для тех, кто идёт следом", act: "tab-apps" },
      "4-1":  { title: "Ответы и запасные окна", task: "Посмотреть апрельские окна: запасной вариант на случай отказа", why: "В апреле 26 дедлайнов в каталоге — больше, чем в любом другом месяце", act: "discover:deadline" },
      "4-2":  { title: "Подготовка к ЕНТ", task: "Проверить сроки действия документов к лету", why: "Сертификат, истекающий до зачисления, — самая обидная причина отказа", act: "tab-docs" },
      "5-1":  { title: "ЕНТ и аттестат", task: "Отметить исходы подач", why: "Офферы приходят в мае–июне. Каждый отмеченный исход — вклад в точность модели", act: "tab-apps" },
      "5-2":  { title: "Офферы", task: "Сравнить два оффера: деньги, город, сроки", why: "Выбор оффера — отдельная работа, не откладывай на август", act: "tab-apps" },
      "6-1":  { title: "Что дальше", task: "Проверить визовые сроки по офферу", why: "Виза занимает 3–8 недель — считать от даты начала учёбы", act: "tab-apps" },
      "6-2":  { title: "Финиш сезона", task: "Записать итог сезона: куда поступил, что помогло", why: "Твой итог — карта для тех, кто пойдёт следом", act: "tab-apps" }
    },
    master: {
      "9-1":  { title: "Оцени диплом честно", task: "Собрать портфель: 3 программы под GPA и язык", why: "У магистра окна раньше и жёстче: SH 15 января, DAAD 15 октября, CSC 15 февраля", act: "tab-unis" },
      "9-2":  { title: "Рекомендатели", task: "Выбрать двух рекомендателей и попросить письма", why: "Преподаватели пишут медленно — три недели минимум. Это главный блокер магистра", act: "doc:recommendation" },
      "10-1": { title: "Ранние окна", task: "Проверить DAAD (15.10) и Chevening: подаёшь в этот цикл или в следующий", why: "Честный ответ экономит месяц работы над не тем пакетом", act: "tab-unis" },
      "10-2": { title: "Мотивационное: первый черновик", task: "Написать черновик мотивационного письма", why: "Первый черновик труднее всех следующих. Октябрь — время для него", act: "letter" },
      "11-1": { title: "Пакет для 30.11", task: "Собрать пакет для швейцарских и канадских окон (30 ноября)", why: "ETH, швейцарские гос. стипендии, UBC — за две недели до срока пакет должен быть собран", act: "tab-docs" },
      "11-2": { title: "Open Doors, HK PhD, SINGA", task: "Проверить окна 1 декабря: подача без пошлин", why: "1 декабря закрывается сразу несколько окон с полным покрытием", act: "discover:deadline" },
      "12-1": { title: "Письма под каждую программу", task: "Адаптировать письмо под MBZUAI / ENS / EPFL (15.12)", why: "Одно письмо на всех не работает: комиссия видит шаблон", act: "letter" },
      "12-2": { title: "Каникулы", task: "Получить рекомендации на руки до нового года", why: "В сессию преподаватели не пишут. Январь — уже поздно", act: "doc:recommendation" },
      "1-1":  { title: "Пик подач № 1", task: "Отправить подачу с ближайшим дедлайном (SH, Eiffel, KAUST)", why: "Stipendium Hungaricum — 113 тысяч заявок в год, окно закрывается 15 января", act: "tab-apps" },
      "1-2":  { title: "Документы Китая", task: "Собрать пакет CSC: медсправка, легализация", why: "CSC 15 февраля требует консульскую легализацию, а не апостиль — это дольше", act: "tab-docs" },
      "2-1":  { title: "Пик подач № 2", task: "Отправить CSC, SI Швеция, KU Leuven", why: "Февраль — последняя большая волна полного покрытия для магистров", act: "tab-apps" },
      "2-2":  { title: "Интервью", task: "Отрепетировать интервью SH / CSC: 5 вопросов", why: "Интервью — точка отвала. Ответы репетируют, а не импровизируют", act: "chance" },
      "3-1":  { title: "NAWA, MEXT", task: "Проверить весенние окна: NAWA (Польша), MEXT (Япония)", why: "Весенние окна закрывают сезон для тех, кто не успел в январе", act: "discover:deadline" },
      "3-2":  { title: "Ожидание", task: "Обновить статусы подач", why: "Ответы начинают приходить. Отметки уточняют модель", act: "tab-apps" },
      "4-1":  { title: "Первые ответы", task: "Отметить исходы и запасные окна", why: "В апреле 26 дедлайнов — есть куда подать при отказе", act: "discover:deadline" },
      "4-2":  { title: "Сроки документов", task: "Проверить сроки действия сертификатов к осени", why: "IELTS действует 2 года — считай до даты зачисления", act: "tab-docs" },
      "5-1":  { title: "Офферы", task: "Сравнить два оффера", why: "Деньги, город, научрук, сроки — таблица на четыре строки решает", act: "tab-apps" },
      "5-2":  { title: "Стипендия и виза", task: "Проверить условия стипендии в оффер-леттере", why: "Сумма и валюта — из письма, не с сайта", act: "tab-apps" },
      "6-1":  { title: "Виза", task: "Собрать пакет на визу", why: "Виза занимает 3–8 недель", act: "tab-apps" },
      "6-2":  { title: "Финиш сезона", task: "Записать итог сезона", why: "Твой итог — карта для тех, кто пойдёт следом", act: "tab-apps" }
    }
  };
  THEMES.phd = THEMES.master;
  function themeFor(level, today) {
    var t = d0(today), key = (t.getMonth() + 1) + "-" + (t.getDate() <= 15 ? 1 : 2);
    var set = THEMES[level === "master" || level === "phd" ? "master" : "bachelor"];
    return Object.assign({ key: key }, set[key] || { title: "Лето: подготовка к сезону", task: "Обновить анкету и портфель к сентябрю", why: "Сезон начинается 1 сентября. Всё, что сделано летом, — фора", act: "tab-unis" });
  }

  /* ---------- дедлайн программы ---------- */
  /* В каталоге типовой день цикла хранится как 'MM-DD' — он точнее русского
     текста. Разворачиваем в ближайшую будущую дату. */
  function nextFromMD(md, today) {
    if (!md || !/^\d{2}-\d{2}$/.test(md)) return null;
    var t = d0(today), m = +md.slice(0, 2) - 1, dd = +md.slice(3);
    var d = new Date(t.getFullYear(), m, dd);
    if (isNaN(d) || d.getMonth() !== m) return null;
    if (d < t) d = new Date(t.getFullYear() + 1, m, dd);
    return d;
  }

  /* ---------- задачи недели ---------- */
  /* ctx: { today, level, ans, apps: appViews(), plan: docPlan, docs, apps_raw, programs,
            state: {key: row}, tgLinked, prevKeys } */
  var TASK_KIND = {
    doc: "Документ", app: "Подача", letter: "Письмо", profile: "Профиль", unis: "Вузы",
    theme: "Тема недели", review: "Обзор", discover: "Каталог", docs: "Документы"
  };
  function buildTasks(ctx) {
    var wk = weekInfo(ctx.today), level = ctx.level || "bachelor";
    var apps = (ctx.apps || []).filter(function (v) { return !v.a.submitted_at; });
    var plan = ctx.plan || [], docs = ctx.docs || [], ans = ctx.ans || {};
    var out = [], seen = {};
    function add(t) {
      var key = wk.key + ":" + t.key;
      if (seen[key]) return; seen[key] = 1;
      t.key = key; out.push(t);
    }
    function docOfType(t) { return docs.filter(function (d) { return d.doc_type === t; })[0] || null; }

    /* 1. документы, которые пора начинать (критический путь doc-rules) */
    plan.filter(function (p) { return p.required && p.status !== "ready" && (p.urgency === "overdue" || p.urgency === "now"); })
      .slice(0, 2).forEach(function (p) {
        var late = p.daysToStart != null && p.daysToStart < 0;
        add({ key: "doc:" + p.t + ":start", kind: "doc", prio: late ? 1 : 2,
              title: (p.status === "progress" ? "Довести: " : "Начать: ") + p.T.title,
              why: "Нужен для " + p.usesCount + " " + plural(p.usesCount, "подачи", "подач", "подач") + " · ≈" + p.chainLead + " " + plural(p.chainLead, "день", "дня", "дней") +
                   (late ? " · старт просрочен на " + (-p.daysToStart) + " " + plural(-p.daysToStart, "день", "дня", "дней") : (p.startBy ? " · начать до " + fmtLong(p.startBy) : "")) +
                   (p.blockedBy ? " · только после: " + ((ctx.TYPES && ctx.TYPES[p.blockedBy]) || {}).title : ""),
              act: "doc:" + p.t, minutes: 15 });
      });

    /* 2. подача с дедлайном в ближайшие 14 дней */
    apps.filter(function (v) { return v.days != null && v.days >= 0 && v.days <= 14; }).slice(0, 2).forEach(function (v) {
      add({ key: "app:" + v.a.id + ":submit", kind: "app", prio: 1,
            title: "Проверить пакет и отправить «" + v.title + "»",
            why: "Дедлайн " + fmtLong(v.date) + " · через " + v.days + " " + plural(v.days, "день", "дня", "дней") + " · готовность " + v.rd.pct + "%",
            act: "presubmit:" + v.a.id, minutes: 20 });
    });

    /* 3–4. письма: нет черновика при дедлайне ≤ 45 дней; есть слабое письмо при дедлайне ≤ 30 */
    apps.filter(function (v) { return v.days != null && v.days <= 45 && v.rd.missing.some(function (m) { return m.t === "motivation"; }); })
      .slice(0, 1).forEach(function (v) {
        var d = docs.filter(function (x) { return x.doc_type === "motivation" && (x.program_ids || []).indexOf(v.a.program_id) >= 0; })[0];
        if (d && d.content && d.score != null && d.score < 7) {
          add({ key: "letter:" + v.a.program_id + ":improve", kind: "letter", prio: 3,
                title: "Дотянуть письмо для «" + v.title + "»", why: "Сейчас " + Number(d.score).toFixed(1) + "/10 · разбор ИИ и правки · дедлайн через " + v.days + " " + plural(v.days, "день", "дня", "дней"),
                act: "doc-id:" + d.id, minutes: 25 });
        } else if (!d || !d.content) {
          add({ key: "letter:" + v.a.program_id + ":draft", kind: "letter", prio: 3,
                title: "Черновик письма для «" + v.title + "»", why: "4 вопроса — и каркас готов · дедлайн через " + v.days + " " + plural(v.days, "день", "дня", "дней"),
                act: "letter:" + v.a.id, minutes: 10 });
        }
      });

    /* 5. язык: сертификата нет, а в подачах есть порог */
    var needLang = apps.some(function (v) { return v.prog && v.prog.req && v.prog.req.language >= 5; });
    var ieltsDoc = docOfType("ielts");
    if (needLang && (ans.lang_status === "none" || ans.lang_status === "soon" || ans.ielts_band === "unknown") && !(ieltsDoc && (ieltsDoc.fields || {}).issued_on)) {
      add({ key: "profile:ielts", kind: "profile", prio: 4,
            title: "Решить с IELTS: выбрать дату экзамена", why: "У " + apps.filter(function (v) { return v.prog && v.prog.req && v.prog.req.language >= 5; }).length + " " + plural(apps.length, "подачи", "подач", "подач") + " есть языковой порог. Впиши дату в карточку сертификата — план пересчитается",
            act: "doc:ielts", minutes: 10 });
    }

    /* 6–7. портфель */
    var total = (ctx.apps || []).length;
    if (total < 3) {
      add({ key: "unis:add3", kind: "unis", prio: 4, title: total ? "Добавить программы: до 3 подач" : "Выбрать первые 3 программы",
            why: "Три подачи — минимум, чтобы шанс «хотя бы один оффер» стал заметным", act: "tab-unis", minutes: 10 });
    } else if (!(ctx.apps || []).some(function (v) { return v.prog && v.prog.req && v.prog.req.budget === 0; }) && (ans.budget === "0" || ans.budget === "<1m")) {
      add({ key: "unis:free", kind: "unis", prio: 5, title: "Найти вариант за 0 ₸ — полное покрытие",
            why: "В каталоге 90+ программ с полным покрытием. Ни одной из них пока нет в подачах", act: "discover:free", minutes: 5 });
    }

    /* 8. тема недели — одна. Если тема уже «сделана» состоянием кабинета
       (портфель собран, сертификат есть), даём её следующий шаг, а не повтор. */
    var th = themeFor(level, ctx.today), thTask = { title: th.task, why: th.why, act: th.act };
    if ((th.key === "9-1") && total >= 3) thTask = { title: "Уточнить портфель: убрать слабую подачу, добавить запасную", why: "Три подачи есть. Теперь баланс: одна «уверенная», одна «по силам», одна «мечта»", act: "discover:budget" };
    if (th.key === "9-2" && ieltsDoc && (ieltsDoc.fields || {}).issued_on) thTask = { title: "Проверить, покрывает ли сертификат все дедлайны", why: "IELTS действует 2 года — сверь дату сдачи с самой поздней подачей", act: "doc:ielts" };
    if (th.key === "11-1" && docOfType("apostille") && docOfType("apostille").status === "ready") thTask = { title: "Заказать нотариальный перевод после апостиля", why: "Перевод делается строго после апостиля — иначе апостиль в перевод не попадёт", act: "doc:translation" };
    if ((th.key === "12-1" || th.key === "10-2") && docs.some(function (d) { return d.doc_type === "motivation" && d.content; })) thTask = { title: "Второй круг правок мотивационного письма", why: "Письма правятся по 3–4 круга. Разбор ИИ подскажет, что заменить и на что", act: "letter" };
    add({ key: "theme:" + th.key, kind: "theme", prio: 5, title: thTask.title, why: thTask.why, act: thTask.act, minutes: 15, theme: th.title });

    /* 9. обзор статусов — раз в две недели */
    if (wk.n % 2 === 0 && total) {
      var stale = (ctx.apps || []).filter(function (v) { var u = v.a.updated_at || v.a.added_at; return u && daysBetween(ctx.today, new Date(u)) >= 14; }).length;
      if (stale) add({ key: "review:apps", kind: "review", prio: 6, title: "Обновить статусы подач", why: stale + " " + plural(stale, "подача", "подачи", "подач") + " без изменений две недели: изучаешь, готовишь или уже подал?", act: "tab-apps", minutes: 3 });
    }

    /* 10. если задач мало — каталог и сроки */
    if (out.length < 3) {
      add({ key: "discover:week", kind: "discover", prio: 7, title: "Открыть стипендию недели", why: "Каталог обновляется: одна программа в неделю, которую стоит посмотреть", act: "discover:week", minutes: 3 });
    }
    if (out.length < 3 && docs.some(function (d) { return d.expires_on; })) {
      add({ key: "docs:expiry", kind: "docs", prio: 7, title: "Проверить сроки действия документов", why: "Сертификат, истекающий до дедлайна, — самая обидная причина отказа", act: "tab-docs", minutes: 3 });
    }

    out.sort(function (a, b) { return a.prio - b.prio; });
    /* Тема недели — всегда в плане: это нить сезона, а не «ещё одна задача».
       Если она не попала в пятёрку, она вытесняет последнюю задачу. */
    if (out.length > 5) {
      var themeIdx = -1;
      for (var ti = 0; ti < out.length; ti++) if (out[ti].kind === "theme") { themeIdx = ti; break; }
      if (themeIdx >= 5) { var themeTask = out.splice(themeIdx, 1)[0]; out = out.slice(0, 4); out.push(themeTask); }
      else out = out.slice(0, 5);
    }

    /* состояние из базы (сделано / перенесено / не актуально / когда) */
    out.forEach(function (t) {
      var st = ctx.state && ctx.state[t.key];
      t.status = st ? st.status : "open";
      t.when = st && st.when_day ? st.when_day : null;
    });
    /* перенос с прошлой недели: до двух задач, которые человек отметил «перенести» */
    var prevKey = iso(addDays(wk.start, -7));
    var moved = [];
    Object.keys(ctx.state || {}).forEach(function (k) {
      var st = ctx.state[k];
      if (st.status === "moved" && k.indexOf(prevKey + ":") === 0 && moved.length < 2) {
        var rest = k.slice(prevKey.length + 1);
        if (out.some(function (t) { return t.key.slice(wk.key.length + 1) === rest; })) return;
        moved.push({ key: wk.key + ":" + rest, kind: rest.split(":")[0], prio: 0, title: st.title || titleFromKey(rest), why: "Перенесено с прошлой недели", act: actFromKey(rest), minutes: 15, carried: true,
                     status: (ctx.state[wk.key + ":" + rest] || {}).status || "open", when: (ctx.state[wk.key + ":" + rest] || {}).when_day || null });
      }
    });
    return { week: wk, tasks: moved.concat(out).slice(0, 6), theme: th };
  }
  function titleFromKey(rest) {
    var p = rest.split(":");
    if (p[0] === "doc") return "Документ: " + p[1];
    if (p[0] === "unis") return "Добавить программы";
    if (p[0] === "letter") return "Письмо: " + (p[2] === "draft" ? "черновик" : "правки");
    return "Задача с прошлой недели";
  }
  function actFromKey(rest) {
    var p = rest.split(":");
    if (p[0] === "doc") return "doc:" + p[1];
    if (p[0] === "app") return "presubmit:" + p[1];
    if (p[0] === "letter") return "tab-apps";
    if (p[0] === "unis") return p[1] === "free" ? "discover:free" : "tab-unis";
    if (p[0] === "discover") return "discover:week";
    if (p[0] === "profile") return "doc:ielts";
    return "tab-today";
  }

  /* ---------- недели с прогрессом ---------- */
  /* activity: [{day:'YYYY-MM-DD', progress:bool}], quiet: ['YYYY-MM-DD' понедельники],
     Неделя засчитана, если есть хоть один день с прогрессом, либо она «тихая» по плану.
     Один пропуск в календарном месяце автоматически «замораживается» — серия не рвётся.
     Никакого «сломано»: если серия прервалась, просто начинаем новую. */
  function weeksProgress(activity, quiet, today) {
    var wk = weekInfo(today), byWeek = {};
    (activity || []).forEach(function (r) {
      if (!r.progress) return;
      var d = new Date(r.day + "T12:00:00"); if (isNaN(d)) return;
      byWeek[iso(weekStart(d))] = 1;
    });
    var quietMap = {}; (quiet || []).forEach(function (q) { quietMap[q] = 1; });
    var thisWeek = !!byWeek[wk.key];
    var streak = 0, frozen = [], freezeMonths = {};
    var cur = (thisWeek || quietMap[wk.key]) ? wk.start : addDays(wk.start, -7);   // незакрытая текущая неделя не рвёт серию
    for (var i = 0; i < 60; i++) {
      var k = iso(cur);
      if (byWeek[k] || quietMap[k]) { streak++; }
      else {
        var mk = cur.getFullYear() + "-" + cur.getMonth();
        if (!freezeMonths[mk] && streak > 0 && cur < wk.start) { freezeMonths[mk] = k; frozen.push(k); }
        else break;
      }
      cur = addDays(cur, -7);
      if (cur < wk.seasonStart) break;
    }
    var total = Object.keys(byWeek).length;
    var thisMonthKey = wk.start.getFullYear() + "-" + wk.start.getMonth();
    return { streak: streak, total: total, thisWeek: thisWeek, quietThisWeek: !!quietMap[wk.key],
             freezeUsedThisMonth: !!freezeMonths[thisMonthKey], frozenWeeks: frozen, byWeek: byWeek };
  }

  /* ---------- прогресс пути и кольца ---------- */
  /* Веса честные и объяснимые: анкета 10 · портфель ≥3 10 · документы 40 · письма 15 · отправки 25.
     Стартует не с нуля — анкета и первые подачи уже засчитаны (endowed progress). */
  function progress(ctx) {
    var apps = ctx.apps || [], plan = (ctx.plan || []).filter(function (p) { return p.required; });
    var docsReady = plan.filter(function (p) { return p.status === "ready"; }).length;
    var docsPart = plan.length ? docsReady / plan.length : 0;
    var needLetter = apps.filter(function (v) { return v.rd.required.some(function (r) { return r.t === "motivation"; }); });
    var lettersReady = needLetter.filter(function (v) { return !v.rd.missing.some(function (m) { return m.t === "motivation"; }); }).length;
    var lettersPart = needLetter.length ? lettersReady / needLetter.length : 0;
    var submitted = apps.filter(function (v) { return v.a.submitted_at; }).length;
    var subPart = apps.length ? submitted / apps.length : 0;
    var parts = [
      { k: "profile", label: "Анкета", w: 10, v: ctx.ans && ctx.ans.level ? 1 : 0 },
      { k: "portfolio", label: "Портфель", w: 10, v: Math.min(1, apps.length / 3) },
      { k: "docs", label: "Документы", w: 40, v: docsPart },
      { k: "letters", label: "Письма", w: 15, v: needLetter.length ? lettersPart : (apps.length ? 0 : 0) },
      { k: "submit", label: "Подачи", w: 25, v: subPart }
    ];
    var pct = Math.round(parts.reduce(function (s, p) { return s + p.w * p.v; }, 0));
    return {
      pct: Math.max(0, Math.min(100, pct)), parts: parts,
      rings: {
        docs: { done: docsReady, total: plan.length, pct: Math.round(docsPart * 100) },
        letters: { done: lettersReady, total: needLetter.length, pct: Math.round(lettersPart * 100) },
        apps: { done: submitted, total: apps.length, pct: Math.round(subPart * 100) }
      }
    };
  }

  /* ---------- вехи: только за реальные события ---------- */
  var ACH = {
    first_app:    { ic: "🎯", title: "Первая программа в подачах", desc: "Портфель начался" },
    three_apps:   { ic: "🧭", title: "Портфель: 3 подачи", desc: "Шанс «хотя бы один оффер» стал заметным" },
    first_file:   { ic: "📎", title: "Первый документ загружен", desc: "Проверка по требованиям программ работает на файле" },
    first_letter: { ic: "✍️", title: "Черновик письма", desc: "Самый трудный первый шаг сделан" },
    letter_8:     { ic: "🏅", title: "Письмо 8/10", desc: "Комиссия увидит конкретику, а не шаблон" },
    ielts_plan:   { ic: "🗓", title: "IELTS-план", desc: "Дата экзамена вписана — план считается от неё" },
    pack_30:      { ic: "📦", title: "Пакет собран за 30 дней до дедлайна", desc: "Так делают те, кто не подаёт в последнюю ночь" },
    first_submit: { ic: "🚀", title: "Первая подача отправлена", desc: "Теперь — ждать ответ и не останавливаться" },
    all_submitted:{ ic: "🏁", title: "Все подачи отправлены", desc: "Сезон подач закрыт" },
    first_offer:  { ic: "🎉", title: "Первый оффер", desc: "Поздравляем — и спасибо за отметку: она уточняет модель" },
    tg_linked:    { ic: "✈️", title: "Telegram подключён", desc: "Дедлайны и план недели придут сами" },
    week_1:       { ic: "✅", title: "Первая неделя с прогрессом", desc: "Одна закрытая задача — неделя засчитана" },
    weeks_4:      { ic: "🔥", title: "4 недели с прогрессом подряд", desc: "Ритм есть. Заморозка на месяц — в подарок и так" }
  };
  function checkAchievements(ctx, earned) {
    earned = earned || {};
    var apps = ctx.apps || [], docs = ctx.docs || [], wp = ctx.weeks || {};
    var want = [];
    if (apps.length >= 1) want.push("first_app");
    if (apps.length >= 3) want.push("three_apps");
    if (docs.some(function (d) { return d.file_path; })) want.push("first_file");
    if (docs.some(function (d) { return d.doc_type === "motivation" && d.content && d.content.length > 200; })) want.push("first_letter");
    if (docs.some(function (d) { return d.doc_type === "motivation" && d.score != null && Number(d.score) >= 8; })) want.push("letter_8");
    if (docs.some(function (d) { return d.doc_type === "ielts" && (d.fields || {}).issued_on; })) want.push("ielts_plan");
    if (apps.some(function (v) { return !v.a.submitted_at && v.rd.pct === 100 && v.days != null && v.days >= 30; })) want.push("pack_30");
    if (apps.some(function (v) { return v.a.submitted_at; })) want.push("first_submit");
    if (apps.length >= 2 && apps.every(function (v) { return v.a.submitted_at; })) want.push("all_submitted");
    if (apps.some(function (v) { return v.a.outcome === "admit"; })) want.push("first_offer");
    if (ctx.tgLinked) want.push("tg_linked");
    if ((wp.total || 0) >= 1) want.push("week_1");
    if ((wp.streak || 0) >= 4) want.push("weeks_4");
    return want.filter(function (k) { return !earned[k]; });
  }

  /* ---------- календарь месяца ---------- */
  /* marks: {'YYYY-MM-DD': [{title, mine:bool}]} */
  function calendarHTML(monthDate, marks, today) {
    var m = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    var first = (m.getDay() + 6) % 7, dim = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    var t = d0(today), tk = iso(t);
    var html = '<div class="cal"><div class="cal-head"><button class="iconbtn" data-act="cal-prev" aria-label="Предыдущий месяц">‹</button>' +
      '<b>' + MONTHS_NOM[m.getMonth()] + " " + m.getFullYear() + '</b><button class="iconbtn" data-act="cal-next" aria-label="Следующий месяц">›</button></div>' +
      '<div class="cal-grid">' + WD_SHORT.map(function (w) { return '<span class="cal-wd">' + w + "</span>"; }).join("");
    for (var i = 0; i < first; i++) html += '<span class="cal-d empty"></span>';
    for (var d = 1; d <= dim; d++) {
      var key = iso(new Date(m.getFullYear(), m.getMonth(), d)), list = marks[key] || [];
      var mine = list.some(function (x) { return x.mine; }), cat = list.some(function (x) { return !x.mine; });
      html += '<button class="cal-d' + (key === tk ? " today" : "") + (list.length ? " has" : "") + '" data-act="cal-day" data-v="' + key + '" aria-label="' + d + " " + MONTHS_RU[m.getMonth()] + (list.length ? ", " + list.length + " " + plural(list.length, "дедлайн", "дедлайна", "дедлайнов") : "") + '">' +
        d + (list.length ? '<i class="' + (mine ? "mine" : "") + (cat ? " cat" : "") + '"></i>' : "") + "</button>";
    }
    html += "</div></div>";
    return html;
  }
  function deadlineMarks(programs, apps, level, today, monthDate) {
    var marks = {}, mine = {};
    (apps || []).forEach(function (v) { if (v.date && !v.a.submitted_at) { var k = iso(v.date); (marks[k] = marks[k] || []).push({ title: v.title, mine: true, id: v.a.id }); mine[v.a.program_id] = 1; } });
    (programs || []).forEach(function (p) {
      if (mine[p.id] || p.available_kz === false || p.duplicate_of) return;
      if (p.levels && p.levels.indexOf(level) === -1) return;
      var d = nextFromMD(p.deadline_md, today); if (!d) return;
      if (d.getMonth() !== monthDate.getMonth() || d.getFullYear() !== monthDate.getFullYear()) return;
      var k = iso(d); (marks[k] = marks[k] || []).push({ title: p.name, mine: false, id: p.id, cc: p.cc });
    });
    return marks;
  }

  /* ---------- «стипендия недели» и подборки ---------- */
  function catalogFor(programs, level) {
    return (programs || []).filter(function (p) {
      if (p.available_kz === false || p.duplicate_of) return false;
      if (EXCLUDED_CC[(p.cc || "").toLowerCase()]) return false;
      if (p.levels && level && p.levels.indexOf(level) === -1) return false;
      return true;
    });
  }
  /* Подборки Discover. matchOf(p) → 0..100 из движка; today нужен для дат. */
  var COLLECTIONS = [
    { key: "deadline", title: "Дедлайн в этом месяце", ic: "⏰", why: "успеть ещё можно" },
    { key: "free", title: "Полное покрытие · 0 ₸", ic: "🎓", why: "обучение бесплатно" },
    { key: "living", title: "Стипендия на жизнь", ic: "💸", why: "платят ежемесячно" },
    { key: "noielts", title: "Можно без IELTS", ic: "🗣", why: "порог языка низкий или внутренний экзамен" },
    { key: "opened", title: "Открылся приём", ic: "🟢", why: "окно открылось в последние недели" },
    { key: "budget", title: "Под мой бюджет", ic: "👛", why: "по ответу в анкете" },
    { key: "field", title: "По моему направлению", ic: "🧭", why: "по направлениям из анкеты" },
    { key: "langyear", title: "Год языка внутри", ic: "🌐", why: "язык учат на месте" },
    { key: "new", title: "Новые в каталоге", ic: "🆕", why: "добавлены недавно" }
  ];
  var BUDGET_AXIS = { "0": 0, "<1m": 2, "1-3m": 4, "3m+": 7 };
  /* «Новое» — только по дате добавления (added_at, миграция 042): updated_at сдвигается
     массовыми правками каталога, и по нему «новым» было бы всё. Нет поля — не новое. */
  function isNew(p, today) { var u = p.added_at ? new Date(p.added_at) : null; return !!u && !isNaN(u) && daysBetween(today, u) <= 30 && daysBetween(today, u) >= 0; }
  function inCollection(p, key, ctx) {
    var req = p.req || {}, today = ctx.today, f = (p.funding || "").toLowerCase();
    var dl = nextFromMD(p.deadline_md, today), op = nextFromMD(p.apply_open_md, today);
    switch (key) {
      case "deadline": return !!dl && dl.getMonth() === d0(today).getMonth() && dl.getFullYear() === d0(today).getFullYear();
      case "free": return req.budget === 0;
      case "living": return /мес|на жизнь|stipend|monthly|в месяц|ежемесяч/.test(f);
      case "noielts": return req.language != null && req.language <= 4.5 || p.lang_year === true;
      case "opened": { if (!op) return false; var dd = daysBetween(today, op); return (dd >= 0 && dd <= 21) || (dd < 0 && dd >= -344); }
      case "budget": { var b = BUDGET_AXIS[(ctx.ans || {}).budget]; return b != null && req.budget != null && req.budget <= b; }
      case "field": { var fs = (ctx.ans || {}).field || []; if (!fs.length || !p.fields) return false; return (p.fields || []).some(function (x) { return fs.indexOf(x) >= 0; }); }
      case "langyear": return p.lang_year === true;
      case "new": return isNew(p, today);
    }
    return false;
  }
  /* «opened»: apply_open_md развернули в БУДУЩУЮ дату; если она в прошлом году-цикле
     (открылось недавно) — nextFromMD даст следующий год. Считаем «недавно открылось»,
     если открытие было в последние 21 день. */
  function openedRecently(p, today) {
    if (!p.apply_open_md || !/^\d{2}-\d{2}$/.test(p.apply_open_md)) return false;
    var t = d0(today), m = +p.apply_open_md.slice(0, 2) - 1, dd = +p.apply_open_md.slice(3);
    var d = new Date(t.getFullYear(), m, dd); if (d > t) d = new Date(t.getFullYear() - 1, m, dd);
    var diff = daysBetween(t, d);
    return diff >= 0 && diff <= 21;
  }
  function collections(programs, ctx) {
    var list = catalogFor(programs, ctx.level);
    return COLLECTIONS.map(function (c) {
      var items = list.filter(function (p) { return c.key === "opened" ? openedRecently(p, ctx.today) : inCollection(p, c.key, ctx); });
      items.sort(function (a, b) {
        if (c.key === "deadline") { var da = nextFromMD(a.deadline_md, ctx.today), db = nextFromMD(b.deadline_md, ctx.today); return (da || 0) - (db || 0); }
        return (ctx.matchOf ? ctx.matchOf(b) - ctx.matchOf(a) : 0);
      });
      return { key: c.key, title: c.title, ic: c.ic, why: c.why, items: items };
    }).filter(function (c) { return c.items.length; });
  }
  /* Одна программа недели: детерминированно по номеру недели среди лучших кандидатов. */
  function programOfWeek(programs, ctx, mineIds) {
    var list = catalogFor(programs, ctx.level).filter(function (p) { return !mineIds[p.id]; });
    var opened = list.filter(function (p) { return openedRecently(p, ctx.today); });
    var soon = list.filter(function (p) { var d = nextFromMD(p.deadline_md, ctx.today); return d && daysBetween(d, ctx.today) <= 45 && daysBetween(d, ctx.today) >= 7; });
    var pool = (opened.length ? opened : soon.length ? soon : list).slice();
    pool.sort(function (a, b) { return (ctx.matchOf ? ctx.matchOf(b) - ctx.matchOf(a) : 0) || String(a.id).localeCompare(String(b.id)); });
    var top = pool.slice(0, 5);
    if (!top.length) return null;
    var wk = weekInfo(ctx.today);
    var p = top[wk.n % top.length];
    return { prog: p, reason: opened.indexOf(p) >= 0 ? "приём открылся недавно" : soon.indexOf(p) >= 0 ? "дедлайн через " + daysBetween(nextFromMD(p.deadline_md, ctx.today), ctx.today) + " " + plural(daysBetween(nextFromMD(p.deadline_md, ctx.today), ctx.today), "день", "дня", "дней") : "высокое совпадение с профилем" };
  }
  /* Плашки на карточке программы. */
  function badges(p, ctx) {
    var out = [], req = p.req || {};
    if (req.budget === 0) out.push({ ic: "🎓", t: "полное покрытие" });
    if (/мес|на жизнь|stipend|monthly|в месяц|ежемесяч/.test((p.funding || "").toLowerCase())) out.push({ ic: "💸", t: "на жизнь" });
    if ((req.language != null && req.language <= 4.5) || p.lang_year) out.push({ ic: "🗣", t: p.lang_year ? "год языка" : "без IELTS" });
    var dl = nextFromMD(p.deadline_md, ctx.today);
    if (dl) { var dd = daysBetween(dl, ctx.today); if (dd <= 45) out.push({ ic: "⏰", t: "через " + dd + " " + plural(dd, "день", "дня", "дней"), cls: dd <= 14 ? "bad" : "warn" }); }
    if (openedRecently(p, ctx.today)) out.push({ ic: "🟢", t: "приём открыт" });
    if (isNew(p, ctx.today)) out.push({ ic: "🆕", t: "новое" });
    if (p.verified) out.push({ ic: "✅", t: "проверено" });
    return out;
  }

  /* ---------- материалы недели (заполняет владелец) ---------- */
  function contentFor(rows, level, weekN) {
    return (rows || []).filter(function (r) {
      if (r.active === false) return false;
      if (r.level && r.level !== level) return false;
      if (r.week_from && weekN < r.week_from) return false;
      if (r.week_to && weekN > r.week_to) return false;
      return true;
    }).sort(function (a, b) { return (a.sort || 100) - (b.sort || 100); }).slice(0, 3);
  }

  /* ---------- deep-links ---------- */
  function parseDeepLink(search) {
    var q = new URLSearchParams(search || "");
    var tab = q.get("tab"), ok = { today: 1, apps: 1, unis: 1, docs: 1, profile: 1 };
    return { tab: ok[tab] ? tab : null, d: q.get("d"), task: q.get("task"), from: q.get("from") };
  }

  return {
    weekInfo: weekInfo, weekStart: weekStart, seasonStart: seasonStart, themeFor: themeFor, THEMES: THEMES,
    buildTasks: buildTasks, TASK_KIND: TASK_KIND, weeksProgress: weeksProgress, progress: progress,
    ACH: ACH, checkAchievements: checkAchievements,
    calendarHTML: calendarHTML, deadlineMarks: deadlineMarks, nextFromMD: nextFromMD,
    COLLECTIONS: COLLECTIONS, collections: collections, programOfWeek: programOfWeek, badges: badges, catalogFor: catalogFor, openedRecently: openedRecently,
    contentFor: contentFor, parseDeepLink: parseDeepLink,
    iso: iso, addDays: addDays, daysBetween: daysBetween, fmtShort: fmtShort, fmtLong: fmtLong, WD_SHORT: WD_SHORT, WD_FULL: WD_FULL, plural: plural, esc: esc
  };
})();
