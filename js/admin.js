/* ============================================================
   Scholary · панель управления (дашборд владельца)

   Всё считает база: витрина admin_* из миграции 019 отдаёт готовые
   числа. Браузер только рисует. Раньше сюда тянулось 20 000 событий
   и воронка считалась на клиенте — при росте это перестало бы
   открываться вовсе.

   Доступ: обычный вход Supabase + функция is_admin() на стороне базы.
   Ни одного секрета в этом файле нет.
   ============================================================ */
(function () {
  "use strict";
  var C = window.SCHOLARY_CONFIG || {};
  var sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);

  var S = { days: 30, tab: "overview", data: null, loading: false };

  /* ---------- мелочи ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[<>&"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]; }); }
  function num(n) { return (n == null ? 0 : Number(n)).toLocaleString("ru-RU"); }
  function money(n) { return num(Math.round(Number(n) || 0)) + " ₸"; }
  function pct(a, b) {
    if (!b) return 0;
    var v = (a / b) * 100;
    return v > 0 && v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
  }
  function dt(s) {
    if (!s) return "—";
    var d = new Date(s);
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }
  function day(s) {
    if (!s) return "—";
    var d = new Date(s), o = { day: "numeric", month: "short" };
    // Год показываем, только если он не текущий — иначе «1 мар.» вводит в заблуждение
    if (d.getFullYear() !== new Date().getFullYear()) o.year = "numeric";
    return d.toLocaleDateString("ru-RU", o);
  }
  function wa(n) { if (!n) return "—"; var d = String(n).replace(/\D/g, ""); return '<a href="https://wa.me/' + d + '" target="_blank" rel="noopener">' + esc(n) + "</a>"; }
  function plural(n, a, b, c) { n = Math.abs(n) % 100; var m = n % 10; if (n > 10 && n < 20) return c; if (m > 1 && m < 5) return b; if (m === 1) return a; return c; }

  var KIND = { report: "Отчёт", consult: "Консультация", package: "Документы и подача",
               pro_month: "Pro на месяц", pro_season: "Pro на сезон", refund: "Возврат" };
  var LEVELS = { school: "школьник", bachelor: "бакалавр", master: "магистратура", phd: "PhD" };

  function rpc(fn, args) {
    return sb.rpc(fn, args || {}).then(function (r) {
      if (r.error) throw new Error(r.error.message || "ошибка запроса");
      return r.data;
    });
  }

  /* ---------- графики: обычный inline-SVG, без сторонних библиотек ---------- */
  function barChart(rows, keyX, series, opts) {
    opts = opts || {};
    if (!rows || !rows.length) return '<div class="muted">Нет данных за период.</div>';
    var W = 720, H = 170, padL = 44, padB = 22, padT = 10;
    var max = 0;
    rows.forEach(function (r) { series.forEach(function (s) { max = Math.max(max, Number(r[s.key]) || 0); }); });
    if (max === 0) max = 1;
    var n = rows.length, bw = (W - padL - 8) / n;
    var body = "";
    rows.forEach(function (r, i) {
      var x0 = padL + i * bw;
      series.forEach(function (s, si) {
        var v = Number(r[s.key]) || 0;
        var h = Math.round((v / max) * (H - padT - padB));
        var w = Math.max(2, (bw - 4) / series.length);
        var x = x0 + 2 + si * w;
        body += '<rect x="' + x.toFixed(1) + '" y="' + (H - padB - h) + '" width="' + w.toFixed(1) + '" height="' + Math.max(h, v > 0 ? 2 : 0) +
                '" rx="2" fill="' + s.color + '"><title>' + esc(day(r[keyX])) + ": " + (opts.money && s.money ? money(v) : num(v)) + '</title></rect>';
      });
    });
    // ось: минимум, середина, максимум
    var ticks = [0, max / 2, max];
    var axis = ticks.map(function (t) {
      var y = H - padB - (t / max) * (H - padT - padB);
      return '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + W + '" y2="' + y.toFixed(1) + '" stroke="#EFEFF3"/>' +
             '<text x="0" y="' + (y + 4).toFixed(1) + '" font-size="11" fill="#8A8A90">' + (opts.money ? Math.round(t / 1000) + "к" : Math.round(t)) + "</text>";
    }).join("");
    // подписи по краям
    var lbl = '<text x="' + padL + '" y="' + (H - 6) + '" font-size="11" fill="#8A8A90">' + esc(day(rows[0][keyX])) + "</text>" +
              '<text x="' + W + '" y="' + (H - 6) + '" font-size="11" fill="#8A8A90" text-anchor="end">' + esc(day(rows[n - 1][keyX])) + "</text>";
    return '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img">' + axis + body + lbl + "</svg>" +
      '<div class="legend">' + series.map(function (s) { return '<span><i style="background:' + s.color + '"></i>' + esc(s.name) + "</span>"; }).join("") + "</div>";
  }

  function kpi(list) {
    return '<div class="kpis">' + list.map(function (k) {
      return '<div class="kpi' + (k[2] ? " hl" : "") + '"><div class="n">' + k[1] + '</div><div class="l">' + esc(k[0]) + "</div>" +
        (k[3] ? '<div class="s">' + esc(k[3]) + "</div>" : "") + "</div>";
    }).join("") + "</div>";
  }

  function table(cols, rows, cells) {
    if (!rows || !rows.length) return '<div class="muted">Пока пусто.</div>';
    return '<div class="scroll"><table class="adm"><tr>' +
      cols.map(function (c) { return '<th' + (c[1] ? ' class="num"' : "") + ">" + esc(c[0]) + "</th>"; }).join("") + "</tr>" +
      rows.map(function (r) { return "<tr>" + cells(r) + "</tr>"; }).join("") + "</table></div>";
  }

  /* ---------- загрузка ---------- */
  function loadAll() {
    if (S.loading) return;
    S.loading = true;
    $("updatedAt").textContent = "Загружаю…";
    var d = { p_days: S.days };
    Promise.all([
      rpc("admin_dash_summary", d), rpc("admin_revenue_daily", d), rpc("admin_revenue_by_kind", d),
      rpc("admin_funnel", d), rpc("admin_sources", d), rpc("admin_daily", d),
      rpc("admin_payments", { p_limit: 200 }), rpc("admin_subscriptions"),
      rpc("admin_top_programs_json", { p_limit: 15 }), rpc("admin_countries", { p_limit: 12 }),
      rpc("admin_leads", { p_limit: 300 }), rpc("admin_reports", { p_limit: 100 }),
      rpc("admin_paid_without_report"), rpc("admin_timings", d), rpc("admin_quiz_steps", d)
    ]).then(function (r) {
      S.data = { sum: r[0] || {}, revDaily: r[1] || [], revKind: r[2] || [], funnel: r[3] || {},
                 sources: r[4] || [], daily: r[5] || [], payments: r[6] || [], subs: r[7] || [],
                 programs: r[8] || [], countries: r[9] || [], leads: r[10] || [],
                 reports: r[11] || [], paidNoReport: r[12] || [], timings: r[13] || {}, steps: r[14] || [] };
      S.loading = false;
      $("updatedAt").textContent = "Обновлено " + new Date().toLocaleTimeString("ru-RU") + " · период: " + S.days + " " + plural(S.days, "день", "дня", "дней");
      draw();
    }, function (e) {
      S.loading = false;
      $("updatedAt").textContent = "Ошибка: " + e.message;
      $("view").innerHTML = '<div class="box"><h2>Не удалось загрузить данные</h2>' +
        '<p class="sub">' + esc(e.message) + "</p>" +
        (/forbidden|permission/i.test(e.message)
          ? '<div class="note">Твой аккаунт ещё не в списке администраторов. Выполни в SQL-редакторе Supabase:<br><code>select seed_admin(\'почта@аккаунта\');</code></div>'
          : '<div class="note">Проверь, что применены миграции 016–019. Если ошибка про отсутствующую функцию — накати последнюю.</div>') + "</div>";
    });
  }

  /* ---------- вкладки ---------- */
  function draw() {
    if (!S.data) return;
    var v = $("view");
    if (S.tab === "overview") v.innerHTML = viewOverview();
    else if (S.tab === "money") v.innerHTML = viewMoney();
    else if (S.tab === "funnel") v.innerHTML = viewFunnel();
    else if (S.tab === "channels") v.innerHTML = viewChannels();
    else if (S.tab === "people") v.innerHTML = viewPeople();
    else if (S.tab === "reports") v.innerHTML = viewReports();
    else if (S.tab === "product") v.innerHTML = viewProduct();
    else if (S.tab === "system") { v.innerHTML = viewSystem(); loadHealth(false); }
  }

  function viewOverview() {
    var s = S.data.sum, f = S.data.funnel;
    var cr = pct(f.oplatili, f.vsego);
    var avg = s.payments_period ? Math.round(s.revenue_period / s.payments_period) : 0;
    return kpi([
      ["Выручка за период", money(s.revenue_period), true, "всего " + money(s.revenue_all)],
      ["Оплат за период", num(s.payments_period), true, "средний чек " + money(avg)],
      ["Заявок за период", num(s.leads_period), false, "всего " + num(s.leads_total)],
      ["Регистраций", num(s.users_period), false, "всего " + num(s.users_total)],
      ["Конверсия в оплату", cr + "%", false, "из тех, кто дошёл до сайта"],
      ["Активных Pro", num(s.pro_active), false, "подписок сейчас"]
    ]) +
    '<div class="grid2">' +
      '<div class="box"><h2>Деньги по дням</h2><p class="sub">Только боевые платежи. Тестовые в расчёт не идут.</p>' +
        barChart(S.data.revDaily, "den", [{ key: "summa", name: "выручка, ₸", color: "#5B4BFF", money: true }], { money: true }) + "</div>" +
      '<div class="box"><h2>Люди по дням</h2><p class="sub">Заявки из квиза, регистрации в кабинете и начатые квизы.</p>' +
        barChart(S.data.daily, "den", [
          { key: "zayavki", name: "заявки", color: "#5B4BFF" },
          { key: "registracii", name: "регистрации", color: "#0B7A3E" },
          { key: "nachali_kviz", name: "начали квиз", color: "#D9A413" }
        ]) + "</div>" +
    "</div>" +
    '<div class="box"><h2>Что происходит в продукте</h2><p class="sub">Живые счётчики, не за период.</p>' +
      kpi([
        ["С анкетой", num(s.users_with_answers), false, "из " + num(s.users_total) + " аккаунтов"],
        ["Подач ведут", num(s.applications_total), false, num(s.applications_submitted) + " отправлено"],
        ["Документов готово", num(s.documents_ready)],
        ["Отчётов выдано", num(s.reports_total)],
        ["Telegram подключён", num(s.telegram_linked)],
        ["Программ в каталоге", num(s.programs_total)],
        ["Заявок с контактом", num(s.leads_with_contact), false, "можно позвонить"],
        ["Событий за сутки", num(s.events_24h)]
      ]) +
      (Number(s.reports_total) === 0 && Number(s.leads_paid) > 0
        ? '<div class="note"><b>Внимание.</b> Оплаты есть, а отчётов в базе ноль: значит отчёты после оплаты отправляются вручную. Пока это так, каждая ночная оплата — человек, который ждёт.</div>' : "") +
    "</div>";
  }

  function viewMoney() {
    var s = S.data.sum;
    var kinds = S.data.revKind;
    var total = kinds.reduce(function (a, k) { return a + Number(k.summa || 0); }, 0);
    return kpi([
      ["Выручка за период", money(s.revenue_period), true],
      ["Всего за всё время", money(s.revenue_all), true],
      ["Возвратов", num(s.refunds_all), false, money(s.refunded_sum)],
      ["Активных Pro", num(s.pro_active)]
    ]) +
    '<div class="box"><h2>Из чего складывается выручка</h2><p class="sub">За выбранный период, боевые платежи.</p>' +
      (kinds.length ? kinds.map(function (k) {
        var p = total ? Math.round(Number(k.summa) / total * 100) : 0;
        return '<div class="frow"><div>' + esc(KIND[k.vid] || k.vid) + '</div>' +
          '<div class="fbar"><i style="width:' + Math.max(2, p) + '%"></i></div>' +
          '<div class="fnum">' + money(k.summa) + " <small>" + k.oplat + " шт</small></div></div>";
      }).join("") : '<div class="muted">За период оплат не было.</div>') + "</div>" +
    '<div class="box"><h2>Журнал платежей</h2><p class="sub">Последние 200 операций. Тестовые помечены отдельно.</p>' +
      table([["Когда"], ["Сумма", 1], ["За что"], ["Кто"], ["Заявка"], ["Статус"]], S.data.payments, function (p) {
        return "<td>" + dt(p.created_at) + "</td>" +
          '<td class="num">' + money(p.amount) + "</td>" +
          "<td>" + esc(KIND[p.kind] || p.kind || "—") + "</td>" +
          "<td>" + esc(p.user_email || "—") + "</td>" +
          "<td>" + esc(p.lead_id || "—") + "</td>" +
          "<td>" + (p.status === "refunded" ? '<span class="pill bad">возврат</span>' : '<span class="pill ok">оплачен</span>') +
          (p.test_mode ? ' <span class="pill no">тест</span>' : "") + "</td>";
      }) + "</div>" +
    '<div class="box"><h2>Подписки Pro</h2><p class="sub">Кому и до какого числа открыт доступ.</p>' +
      table([["Почта"], ["План"], ["Действует до"], ["Статус"]], S.data.subs, function (u) {
        return "<td>" + esc(u.email) + "</td><td>" + esc(u.pro_plan || "—") + "</td><td>" + day(u.pro_until) + "</td>" +
          "<td>" + (u.aktivna ? '<span class="pill ok">активна</span>' : '<span class="pill no">истекла</span>') + "</td>";
      }) + "</div>";
  }

  function viewFunnel() {
    var f = S.data.funnel;
    var steps = [
      ["Зашли на сайт", f.vsego, "любое событие с устройства"],
      ["Начали квиз", f.nachali_kviz, "нажали «Рассчитать»"],
      ["Дошли до результата", f.doshli_do_rezultata, "ответили на все вопросы"],
      ["Увидели пейволл", f.uvideli_paywall, "экран с ценой отчёта"],
      ["Нажали «Оплатить»", f.nazhali_oplatit, "картой или Kaspi"],
      ["Оплатили", f.oplatili, "деньги на счету"]
    ];
    var max = Math.max(1, Number(f.vsego) || 1);
    var body = steps.map(function (st, i) {
      var n = Number(st[1]) || 0;
      var prev = i ? (Number(steps[i - 1][1]) || 0) : n;
      var conv = i ? pct(n, prev) : 100;
      return '<div class="frow"><div><b>' + esc(st[0]) + '</b><div class="muted" style="font-size:11.5px">' + esc(st[2]) + "</div></div>" +
        '<div class="fbar"><i style="width:' + Math.max(1, n / max * 100) + '%"></i></div>' +
        '<div class="fnum">' + num(n) + (i ? ' <small>' + conv + "%</small>" : "") + "</div></div>";
    }).join("");

    // где узкое место: самый большой обвал между шагами
    var worst = null;
    for (var i = 1; i < steps.length; i++) {
      var prev = Number(steps[i - 1][1]) || 0, cur = Number(steps[i][1]) || 0;
      if (prev < 5) continue;                       // на малых числах вывод не делаем
      var drop = prev - cur;
      if (!worst || drop > worst.drop) worst = { drop: drop, from: steps[i - 1][0], to: steps[i][0], conv: pct(cur, prev) };
    }
    return '<div class="box"><h2>Воронка за ' + S.days + " " + plural(S.days, "день", "дня", "дней") + '</h2>' +
      '<p class="sub">Считаем по уникальным устройствам: один человек — одна единица на каждом шаге.</p>' + body +
      (worst ? '<div class="note"><b>Самый большой обвал:</b> «' + esc(worst.from) + '» → «' + esc(worst.to) +
        '», доходит ' + worst.conv + "%, теряем " + num(worst.drop) + ". Здесь и стоит копать.</div>"
             : '<div class="note">Данных пока мало для выводов — воронка станет показательной после первой сотни визитов.</div>') +
      "</div>" +
      /* Бесплатный кабинет — не шаг цепочки, а развилка: туда уходят те,
         кто не готов платить сразу. Считать его внутри воронки нельзя. */
      '<div class="box"><h2>Развилка на пейволле</h2>' +
      '<p class="sub">Кто не готов платить сразу, уходит в бесплатный кабинет — и остаётся с нами.</p>' +
      '<div class="frow"><div><b>Увидели пейволл</b></div><div class="fbar"><i style="width:100%"></i></div>' +
        '<div class="fnum">' + num(f.uvideli_paywall) + "</div></div>" +
      '<div class="frow"><div><b>→ нажали «Оплатить»</b></div><div class="fbar"><i style="width:' +
        Math.max(1, pct(f.nazhali_oplatit, f.uvideli_paywall)) + '%"></i></div>' +
        '<div class="fnum">' + num(f.nazhali_oplatit) + " <small>" + pct(f.nazhali_oplatit, f.uvideli_paywall) + "%</small></div></div>" +
      '<div class="frow"><div><b>→ пошли в бесплатный кабинет</b></div><div class="fbar"><i style="width:' +
        Math.max(1, pct(f.poshli_v_kabinet, f.uvideli_paywall)) + '%;background:#0B7A3E"></i></div>' +
        '<div class="fnum">' + num(f.poshli_v_kabinet) + " <small>" + pct(f.poshli_v_kabinet, f.uvideli_paywall) + "%</small></div></div>" +
      '<div class="note">Ушедшие в кабинет не потеряны: они видят каталог и дедлайны, а платят позже — за отчёт, Pro или пакет документов.</div></div>';
  }

  function viewChannels() {
    var rows = S.data.sources;
    var totalLeads = rows.reduce(function (a, r) { return a + Number(r.zayavok || 0); }, 0);
    return '<div class="box"><h2>Откуда приходят</h2>' +
      '<p class="sub">Из меток utm в ссылке. «Прямой заход» — без меток: набрали адрес, перешли из профиля или из мессенджера.</p>' +
      table([["Источник"], ["Канал"], ["Кампания"], ["Заявок", 1], ["Доля", 1], ["С контактом", 1], ["Оплат", 1], ["Конверсия", 1], ["Выручка", 1]],
        rows, function (r) {
          return "<td><b>" + esc(r.istochnik) + "</b></td><td>" + esc(r.kanal) + "</td><td>" + esc(r.kampaniya) + "</td>" +
            '<td class="num">' + num(r.zayavok) + '</td><td class="num">' + pct(r.zayavok, totalLeads) + "%</td>" +
            '<td class="num">' + num(r.s_kontaktom) + '</td><td class="num">' + num(r.oplat) + "</td>" +
            '<td class="num">' + pct(r.oplat, r.zayavok) + '%</td><td class="num">' + money(r.summa) + "</td>";
        }) +
      '<div class="note">Чтобы канал был виден отдельно, добавляй метки в ссылку: ' +
      '<code>scholary.kz/?utm_source=instagram&utm_medium=stories&utm_campaign=sentyabr</code>. ' +
      'Без меток всё сольётся в «прямой заход».</div></div>';
  }

  function viewPeople() {
    var leads = S.data.leads;
    var paid = leads.filter(function (l) { return l.paid; });
    var contacts = leads.filter(function (l) { return l.whatsapp; });
    return '<div class="box"><h2>Выдать Pro вручную</h2><p class="sub">Например, если человек оплатил переводом Kaspi.</p>' +
      '<div class="tools"><input id="proEmail" placeholder="почта аккаунта"><input id="proDays" type="number" value="183" placeholder="дней">' +
      '<button class="btn-adm" id="btnPro">Выдать</button></div><div class="muted" id="proMsg" style="margin-top:8px"></div></div>' +
    '<div class="box"><h2>Оплатившие' + (paid.length ? " · " + paid.length : "") + '</h2>' +
      '<p class="sub">Кому мы уже должны результат.</p>' +
      table([["Оплата"], ["Имя"], ["WhatsApp"], ["Уровень"], ["Сумма", 1], ["Отчёт"]], paid, function (l) {
        return "<td>" + dt(l.paid_at) + "</td><td>" + (esc(l.name) || "—") + "</td><td>" + wa(l.whatsapp) + "</td>" +
          "<td>" + esc(LEVELS[l.level] || l.level || "—") + '</td><td class="num">' + (l.paid_amount ? money(l.paid_amount) : "—") + "</td>" +
          "<td>" + (l.report_sent_at ? '<span class="pill ok">отправлен ' + day(l.report_sent_at) + "</span>" : '<span class="pill warn">не отправлен</span>') + "</td>";
      }) + "</div>" +
    '<div class="box"><h2>Заявки с контактом · ' + contacts.length + '</h2>' +
      '<p class="sub">Оставили WhatsApp — с ними можно работать руками.</p>' +
      table([["Когда"], ["Имя"], ["WhatsApp"], ["Уровень"], ["Направление"], ["GPA / IELTS"], ["Статус"]], contacts.slice(0, 80), function (l) {
        var gpa = l.gpa_band || l.gpa_uni || l.gpa_phd || "—";
        return "<td>" + dt(l.updated_at) + "</td><td>" + (esc(l.name) || "—") + "</td><td>" + wa(l.whatsapp) + "</td>" +
          "<td>" + esc(LEVELS[l.level] || l.level || "—") + "</td><td>" + esc(l.field || "—") + "</td>" +
          "<td>" + esc(gpa) + (l.ielts_band ? " / " + esc(l.ielts_band) : "") + "</td>" +
          "<td>" + (l.paid ? '<span class="pill ok">оплатил</span>' : '<span class="pill warn">лид</span>') + "</td>";
      }) + "</div>";
  }

  function viewProduct() {
    return '<div class="grid2">' +
      '<div class="box"><h2>Топ программ</h2><p class="sub">Что чаще всего берут в портфель.</p>' +
        table([["Программа"], ["Страна"], ["Ведут", 1], ["Отправлено", 1], ["Готовность", 1]], S.data.programs, function (r) {
          return "<td><b>" + esc(r.name) + "</b></td><td>" + esc(r.country) + '</td><td class="num">' + num(r.picks) +
            '</td><td class="num">' + num(r.submitted) + '</td><td class="num">' + (r.avg_readiness == null ? "—" : r.avg_readiness + "%") + "</td>";
        }) + "</div>" +
      '<div class="box"><h2>Страны</h2><p class="sub">Куда целятся абитуриенты.</p>' +
        table([["Страна"], ["Подач", 1], ["Отправлено", 1]], S.data.countries, function (r) {
          return "<td>" + esc(r.strana) + '</td><td class="num">' + num(r.podach) + '</td><td class="num">' + num(r.otpravleno) + "</td>";
        }) + "</div>" +
    "</div>";
  }

  /* ---------- отчёты и время прохождения ---------- */
  function dur(sec) {
    sec = Number(sec);
    if (!sec || sec < 0) return "—";
    if (sec < 60) return Math.round(sec) + " сек";
    if (sec < 3600) return Math.round(sec / 60) + " мин";
    if (sec < 86400) return (Math.round(sec / 360) / 10) + " ч";
    return (Math.round(sec / 8640) / 10) + " дн";
  }
  function viewReports() {
    var t = S.data.timings || {}, reps = S.data.reports, waiting = S.data.paidNoReport;
    var steps = S.data.steps;
    var maxStep = steps.reduce(function (a, x) { return Math.max(a, Number(x.doshli) || 0); }, 1);
    var STEP_RU = { level: "Куда поступаешь", gpa: "Успеваемость", lang: "Английский",
                    field: "Направления", achievements: "Достижения", budget: "Бюджет",
                    priority: "Приоритет", contact: "Контакты" };
    return kpi([
      ["Отчётов выдано", num(S.data.sum.reports_total), true, "всего за всё время"],
      ["Ждут отчёт", num(waiting.length), waiting.length > 0, waiting.length ? "оплатили, но не получили" : "никто не ждёт"],
      ["Квиз проходят за", dur(t.kviz_mediana_sek), false, "медиана · у 10% дольше " + dur(t.kviz_p90_sek)],
      ["Думают перед оплатой", dur(t.razdumya_mediana_sek), false, "от пейволла до нажатия «Оплатить»"],
      ["Весь путь до оплаты", dur(t.ves_put_mediana_sek), false, "от начала квиза до успеха"],
      ["Читают главную", dur(t.chtenie_lendinga_mediana_sek), false, "прежде чем начать квиз"]
    ]) +
    (waiting.length ? '<div class="box" style="border-color:#F5C6BE;background:#FFF9F7"><h2>Оплатили, но отчёта не получили</h2>' +
      '<p class="sub">Самый срочный список: этим людям мы уже должны результат.</p>' +
      table([["Оплата"], ["Ждёт", 1], ["Имя"], ["WhatsApp"], ["Почта"], ["Сумма", 1], ["Что делать"]], waiting, function (l) {
        return "<td>" + dt(l.paid_at) + '</td><td class="num">' + num(l.chasov_zhdet) + " ч</td>" +
          "<td>" + (esc(l.name) || "—") + "</td><td>" + wa(l.whatsapp) + "</td><td>" + esc(l.email || "—") + "</td>" +
          '<td class="num">' + (l.paid_amount ? money(l.paid_amount) : "—") + "</td>" +
          '<td><button class="btn-adm" style="min-height:32px;padding:6px 13px;font-size:13px" data-act="issue" data-lead="' + esc(l.id) + '">' +
            (l.est_raschet ? "Выдать отчёт" : "Собрать по анкете") + "</button>" +
            '<div class="muted" style="font-size:11.5px;margin-top:3px" data-msg="' + esc(l.id) + '"></div></td>';
      }) + "</div>" : "") +
    '<div class="box"><h2>Выданные отчёты</h2>' +
      '<p class="sub">Каждый отчёт открывается по своей ссылке — её же получает человек.</p>' +
      (reps.length ? table([["Когда"], ["Кому"], ["Уровень"], ["Программ", 1], ["Тексты ИИ"], ["Отправлен"], ["Ссылка"], ["Отправить ещё раз"]], reps, function (r) {
        return "<td>" + dt(r.created_at) + "</td><td>" + (esc(r.name) || esc(r.lead_id) || "—") + "</td>" +
          "<td>" + esc(LEVELS[r.level] || r.level || "—") + '</td><td class="num">' + num(r.programm_v_otchete) + "</td>" +
          "<td>" + (r.est_teksty ? '<span class="pill ok">есть</span>' : '<span class="pill no">только расчёт</span>') + "</td>" +
          "<td>" + (r.report_sent_at ? '<span class="pill ok">' + day(r.report_sent_at) + "</span>" : '<span class="pill warn">не отмечен</span>') + "</td>" +
          '<td><a href="/report/?t=' + encodeURIComponent(r.token) + '" target="_blank" rel="noopener">открыть</a> · ' +
            '<a href="#" data-act="copy" data-link="/report/?t=' + encodeURIComponent(r.token) + '">скопировать</a></td>' +
          '<td><button class="btn-adm btn-ghost" style="min-height:32px;padding:6px 13px;font-size:13px" data-act="resend" data-lead="' + esc(r.lead_id) + '">WhatsApp + почта</button>' +
            '<div class="muted" style="font-size:11.5px;margin-top:3px" data-msg="' + esc(r.lead_id) + '"></div></td>';
      })
      : '<div class="muted">Отчётов пока нет.</div>' +
        '<div class="note"><b>Почему их ноль.</b> Отчёт после оплаты сейчас никто не создаёт автоматически: ' +
        'таблица заполняется вручную. Экран успеха при этом обещает человеку доставку за 2–3 минуты. ' +
        'Пока терминал в тестовом режиме, это не стреляет — но с боевым первая же ночная оплата ' +
        'оставит человека ждать. Это следующая задача.</div>') + "</div>" +
    '<div class="box"><h2>Где отваливаются в квизе</h2>' +
      '<p class="sub">Сколько разных устройств дошло до каждого шага за период.</p>' +
      (steps.length ? steps.map(function (st, i) {
        var n = Number(st.doshli) || 0;
        var prev = i ? Number(steps[i - 1].doshli) || 0 : n;
        return '<div class="frow"><div><b>Шаг ' + st.shag + "</b> · " + esc(STEP_RU[st.vopros] || st.vopros) + "</div>" +
          '<div class="fbar"><i style="width:' + Math.max(1, n / maxStep * 100) + '%"></i></div>' +
          '<div class="fnum">' + num(n) + (i ? " <small>" + pct(n, prev) + "%</small>" : "") + "</div></div>";
      }).join("") : '<div class="muted">За период квиз не начинали.</div>') + "</div>" +
    '<div class="box"><h2>Как читать время</h2>' +
      '<div class="note">Показана <b>медиана</b>, а не среднее: один человек, ушедший на обед посреди квиза, ' +
      'не должен портить картину. «У 10% дольше» — это девяностый процентиль: столько занимает квиз у самых ' +
      'медленных. Выборка: ' + num(t.vyborka_kviz) + " " + plural(t.vyborka_kviz, "прохождение", "прохождения", "прохождений") +
      " квиза и " + num(t.vyborka_put) + " " + plural(t.vyborka_put, "путь", "пути", "путей") + " до оплаты. " +
      'Значения дольше часа для квиза и дольше недели для пути отбрасываются как случайные.</div></div>';
  }

  /* ---------- система: живая проверка всех подключений ---------- */
  function viewSystem() {
    return '<div class="box"><h2>Внешние сервисы</h2>' +
      '<p class="sub">Живая проверка: каждый пункт опрашивается прямо сейчас. Значения ключей нигде не показываются.</p>' +
      '<div id="healthBox"><div class="muted">Проверяю…</div></div>' +
      '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="btn-adm btn-ghost" id="btnHealth">Проверить ещё раз</button>' +
        '<button class="btn-adm btn-ghost" id="btnMailTest">Отправить тестовое письмо</button></div>' +
      '<div class="muted" id="mailMsg" style="margin-top:8px"></div></div>' +
      '<div class="box"><h2>Что это значит</h2><p class="sub">Короткая расшифровка.</p>' +
      '<div class="note">Красный пункт не всегда авария: например, «Telegram — вебхук» покраснеет, пока бот не подключён, ' +
      'а сайт будет работать. Опасны три: Supabase (не сохранятся анкеты), TipTop (не отметятся оплаты) ' +
      'и WhatsApp (не узнаешь о заявке).</div></div>';
  }
  function loadHealth(sendTest) {
    var box = $("healthBox"); if (!box) return;
    if (sendTest && $("mailMsg")) $("mailMsg").textContent = "Отправляю…";
    sb.auth.getSession().then(function (r) {
      var tok = r.data && r.data.session && r.data.session.access_token;
      if (!tok) { box.innerHTML = '<div class="muted">Нужно войти заново.</div>'; return; }
      return fetch("/api/health.php", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tok, send_test: !!sendTest }) }).then(function (x) { return x.json(); }).then(function (j) {
        if (!box) return;
        if (sendTest && $("mailMsg")) {
          var s = (j && j.sent) || {};
          $("mailMsg").textContent = "Почта: " + (s.email ? "письмо отправлено" : "НЕ отправлено") +
            " · WhatsApp: " + (s.whatsapp ? "сообщение отправлено" : "НЕ отправлено") +
            ". Проверь входящие — если письма нет и в спаме, ключ Resend или домен настроены неверно.";
        }
        if (!j || !j.items) { box.innerHTML = '<div class="muted">Не удалось проверить: ' + esc((j && j.error) || "нет ответа") + "</div>"; return; }
        box.innerHTML = j.items.map(function (it) {
          return '<div class="frow" style="grid-template-columns:1fr auto"><div><b>' + esc(it.title) + "</b>" +
            '<div class="muted" style="font-size:12.5px">' + esc(it.note) + "</div>" +
            (it.hint ? '<div class="muted" style="font-size:12.5px;color:#8A5000">' + esc(it.hint) + "</div>" : "") + "</div>" +
            '<div>' + (it.ok ? '<span class="pill ok">работает</span>' : '<span class="pill bad">внимание</span>') + "</div></div>";
        }).join("");
      });
    }).catch(function (e) { if (box) box.innerHTML = '<div class="muted">Ошибка: ' + esc(e.message) + "</div>"; });
  }

  /* ---------- отчёт файлом ---------- */
  function buildReport() {
    var d = S.data; if (!d) return "";
    var s = d.sum, f = d.funnel;
    var L = [];
    L.push("# Scholary — сводка за " + S.days + " " + plural(S.days, "день", "дня", "дней"));
    L.push("");
    L.push("Сформировано " + new Date().toLocaleString("ru-RU"));
    L.push("");
    L.push("## Деньги");
    L.push("- Выручка за период: **" + money(s.revenue_period) + "** (" + num(s.payments_period) + " " + plural(s.payments_period, "оплата", "оплаты", "оплат") + ")");
    L.push("- Выручка за всё время: " + money(s.revenue_all) + ", всего оплат " + num(s.payments_all));
    L.push("- Средний чек: " + money(s.payments_period ? s.revenue_period / s.payments_period : 0));
    L.push("- Возвраты: " + num(s.refunds_all) + " на " + money(s.refunded_sum));
    L.push("- Активных подписок Pro: " + num(s.pro_active));
    L.push("");
    if (d.revKind.length) {
      L.push("### Из чего складывается");
      d.revKind.forEach(function (k) { L.push("- " + (KIND[k.vid] || k.vid) + ": " + money(k.summa) + " (" + k.oplat + " шт)"); });
      L.push("");
    }
    L.push("## Воронка");
    [["Зашли на сайт", f.vsego], ["Начали квиз", f.nachali_kviz], ["Дошли до результата", f.doshli_do_rezultata],
     ["Увидели пейволл", f.uvideli_paywall], ["Нажали «Оплатить»", f.nazhali_oplatit],
     ["Оплатили", f.oplatili]].forEach(function (st, i, arr) {
      var prev = i ? Number(arr[i - 1][1]) || 0 : Number(st[1]) || 0;
      L.push("- " + st[0] + ": " + num(st[1]) + (i ? " (" + pct(st[1], prev) + "% от предыдущего шага)" : ""));
    });
    L.push("- Развилка: из увидевших пейволл " + num(f.poshli_v_kabinet) + " (" + pct(f.poshli_v_kabinet, f.uvideli_paywall) + "%) ушли в бесплатный кабинет");
    L.push("");
    L.push("## Люди");
    L.push("- Регистраций: " + num(s.users_total) + ", за период " + num(s.users_period));
    L.push("- С заполненной анкетой: " + num(s.users_with_answers));
    L.push("- Заявок всего: " + num(s.leads_total) + ", с контактом " + num(s.leads_with_contact));
    L.push("");
    L.push("## Продукт");
    L.push("- Подач в работе: " + num(s.applications_total) + ", отправлено " + num(s.applications_submitted));
    L.push("- Документов готово: " + num(s.documents_ready));
    L.push("- Отчётов выдано: " + num(s.reports_total));
    L.push("- Программ в каталоге: " + num(s.programs_total));
    L.push("");
    if (d.sources.length) {
      L.push("## Каналы");
      L.push("| Источник | Заявок | Оплат | Конверсия | Выручка |");
      L.push("|---|---:|---:|---:|---:|");
      d.sources.forEach(function (r) {
        L.push("| " + r.istochnik + " | " + num(r.zayavok) + " | " + num(r.oplat) + " | " + pct(r.oplat, r.zayavok) + "% | " + money(r.summa) + " |");
      });
      L.push("");
    }
    var tm = d.timings || {};
    L.push("## Время прохождения (медиана)");
    L.push("- Квиз: " + dur(tm.kviz_mediana_sek) + " (у 10% дольше " + dur(tm.kviz_p90_sek) + ")");
    L.push("- Раздумья перед оплатой: " + dur(tm.razdumya_mediana_sek));
    L.push("- Весь путь до оплаты: " + dur(tm.ves_put_mediana_sek));
    L.push("- Чтение главной до начала квиза: " + dur(tm.chtenie_lendinga_mediana_sek));
    L.push("");
    L.push("## Отчёты");
    L.push("- Выдано отчётов: " + num(s.reports_total));
    L.push("- Оплатили и ждут отчёт: " + num((d.paidNoReport || []).length));
    L.push("");
    if (d.programs.length) {
      L.push("## Топ программ");
      d.programs.slice(0, 10).forEach(function (p, i) { L.push((i + 1) + ". " + p.name + " (" + p.country + ") — ведут " + p.picks); });
    }
    return L.join("\n");
  }
  function downloadReport() {
    var txt = buildReport(); if (!txt) return;
    var blob = new Blob([txt], { type: "text/markdown;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "scholary-svodka-" + new Date().toISOString().slice(0, 10) + ".md";
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- вход ---------- */
  function login() {
    var e = $("gateErr"), email = $("admEmail").value.trim(), pass = $("admPass").value;
    e.hidden = true;
    if (!email || !pass) { e.textContent = "Впиши почту и пароль."; e.hidden = false; return; }
    var btn = $("loginBtn"); btn.disabled = true; btn.textContent = "Захожу…";
    sb.auth.signInWithPassword({ email: email, password: pass }).then(function (r) {
      btn.disabled = false; btn.textContent = "Войти";
      if (r.error) { e.textContent = "Не получилось войти: " + r.error.message; e.hidden = false; return; }
      boot();
    });
  }

  /* ---------- события ---------- */
  document.addEventListener("click", function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    if (t.id === "loginBtn") { login(); return; }
    if (t.id === "btnReload") { loadAll(); return; }
    if (t.id === "btnReport") { downloadReport(); return; }
    if (t.id === "btnLogout") { sb.auth.signOut().then(function () { location.reload(); }); return; }
    if (t.id === "btnPro") { grantPro(); return; }
    if (t.id === "btnHealth") { loadHealth(false); return; }
    if (t.id === "btnMailTest") { loadHealth(true); return; }
    var act = t.closest("[data-act]");
    if (act) {
      var a = act.getAttribute("data-act");
      if (a === "issue")  { e.preventDefault(); issueReport(act); return; }
      if (a === "resend") { e.preventDefault(); resendReport(act); return; }
      if (a === "copy")   { e.preventDefault(); copyLink(act); return; }
    }
    var seg = t.closest("#periodSeg button");
    if (seg) {
      S.days = parseInt(seg.getAttribute("data-d"), 10) || 30;
      Array.prototype.forEach.call(document.querySelectorAll("#periodSeg button"), function (b) { b.classList.toggle("on", b === seg); });
      loadAll(); return;
    }
    var tab = t.closest("#tabs button");
    if (tab) {
      S.tab = tab.getAttribute("data-t");
      Array.prototype.forEach.call(document.querySelectorAll("#tabs button"), function (b) { b.classList.toggle("on", b === tab); });
      draw(); return;
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && $("gate") && !$("gate").hidden) login();
  });

  /* ---------- восстановление отчёта ----------
     Три кнопки закрывают все случаи «человек заплатил, а отчёта у него нет»:
       · «Выдать отчёт» — снимок расчёта уже лежит на лиде (leads.result);
       · «Собрать по анкете» — снимка нет (старая оплата), считаем тем же
         движком report-engine.js прямо здесь, из ответов анкеты;
       · «Отправить ещё раз» — отчёт есть, но не дошёл: сервер шлёт ссылку
         на сохранённые WhatsApp и почту.
     Второй реализации формул нет: и квиз, и админка зовут ScholaryEngine. */
  function say(lead, text, bad) {
    var el = document.querySelector('[data-msg="' + (window.CSS && CSS.escape ? CSS.escape(lead) : lead) + '"]');
    if (el) { el.textContent = text; el.style.color = bad ? "#C0392B" : "#1E874B"; }
  }
  function splitList(v) {
    return String(v || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
  }
  /* Квиз хранит списки строкой через запятую — движок ждёт массивы. */
  function answersFromLead(row) {
    var a = {};
    ["level", "year", "gpa_band", "school_type", "gpa_uni", "gpa_phd", "uni_type", "phd_topic",
     "lang_status", "ielts_band", "sat", "budget", "priority", "target_university", "target_major", "name"
    ].forEach(function (k) { if (row[k]) a[k] = row[k]; });
    ["field", "achievements", "target_countries"].forEach(function (k) {
      var l = splitList(row[k]); if (l.length) a[k] = l;
    });
    return a;
  }
  function issueReport(btn) {
    var lead = btn.getAttribute("data-lead");
    btn.disabled = true; say(lead, "Готовлю…");
    rpc("admin_lead_answers", { p_lead: lead }).then(function (row) {
      if (!row) throw new Error("лид не найден");
      if (row.token) { say(lead, "Отчёт уже есть — жми «Отправить ещё раз»"); return null; }
      if (row.has_result) return rpc("admin_save_report", { p_lead: lead, p_data: null });
      if (!window.ScholaryEngine) throw new Error("движок не загрузился — обнови страницу");
      var a = answersFromLead(row);
      if (!a.level) throw new Error("анкета не заполнена, отчёт не из чего собрать");
      var data = ScholaryEngine.evaluate(a);
      data.answers = a;
      data.generatedAt = new Date().toISOString();
      return rpc("admin_save_report", { p_lead: lead, p_data: data });
    }).then(function (j) {
      if (!j) { btn.disabled = false; return; }
      if (!j.ok) throw new Error(j.why === "no_data" ? "нет ни расчёта, ни анкеты" : (j.why || "не вышло"));
      say(lead, "Отчёт создан. Отправляю ссылку…");
      return sendTo(lead);
    }).then(function () { loadAll(); }, function (e) {
      btn.disabled = false; say(lead, "Ошибка: " + e.message, true);
    });
  }
  function resendReport(btn) {
    var lead = btn.getAttribute("data-lead");
    btn.disabled = true; say(lead, "Отправляю…");
    sendTo(lead).then(function () { btn.disabled = false; }, function (e) {
      btn.disabled = false; say(lead, "Ошибка: " + e.message, true);
    });
  }
  /* Отправку делает сервер: ключи GREEN-API и Resend в браузер не попадают. */
  function sendTo(lead) {
    return sb.auth.getSession().then(function (r) {
      var tok = r.data && r.data.session && r.data.session.access_token;
      if (!tok) throw new Error("сессия истекла, войди заново");
      return fetch("/api/report-recover.php", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
        body: JSON.stringify({ mode: "admin", lead: lead })
      });
    }).then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (j) {
        if (!j.ok) throw new Error(j.why === "no_report" ? "отчёта ещё нет" : (j.error || "сервер не отправил"));
        var s = j.sent || {};
        if (!s.whatsapp && !s.email) { say(lead, "Ни один канал не сработал — отправь ссылку руками", true); return; }
        say(lead, "Ушло: " + [s.whatsapp ? "WhatsApp" : null, s.email ? "почта" : null].filter(Boolean).join(" + "));
      });
  }
  function copyLink(a) {
    var url = location.origin + a.getAttribute("data-link");
    var done = function () { a.textContent = "скопировано"; setTimeout(function () { a.textContent = "скопировать"; }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () {});
    else { var i = document.createElement("input"); i.value = url; document.body.appendChild(i); i.select(); try { document.execCommand("copy"); done(); } catch (e) {} i.remove(); }
  }

  function grantPro() {
    var email = ($("proEmail").value || "").trim();
    var days = parseInt($("proDays").value, 10) || 31;
    var msg = $("proMsg");
    if (!email) { msg.textContent = "Впиши почту"; return; }
    msg.textContent = "Выдаю…";
    rpc("grant_pro", { p_email: email, p_days: days, p_plan: "manual" }).then(function (j) {
      msg.textContent = (j && j.length) ? "Готово: Pro до " + j[0].pro_until
        : "Аккаунта с такой почтой нет — человек должен сначала зарегистрироваться в кабинете.";
      loadAll();
    }, function (e) { msg.textContent = "Ошибка: " + e.message; });
  }

  function boot() {
    sb.auth.getSession().then(function (r) {
      var on = !!(r.data && r.data.session);
      $("gate").hidden = on;
      $("panel").hidden = !on;
      if (on) loadAll();
    });
  }
  boot();
})();
