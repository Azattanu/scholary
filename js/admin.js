/* ============================================================
   Scholary · панель управления (дашборд владельца)

   Всё считает база: витрина admin_* из миграции 019 отдаёт готовые
   числа. Браузер только рисует. Раньше сюда тянулось 20 000 событий
   и воронка считалась на клиенте — при росте это перестало бы
   открываться вовсе.

   Доступ: обычный вход Supabase + функция is_admin() на стороне базы.
   Ни одного секрета в этом файле нет.
   ============================================================ */
function __scholaryMain() {
  "use strict";
  var C = window.SCHOLARY_CONFIG || {};
  var sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);

  var S = { days: 30, tab: "overview", data: null, loading: false, whoami: "" };

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
  function wa(n) {
    if (!n) return "—";
    // «8 775…» и «+7 775…» — один номер; wa.me ждёт 77753831836
    var d = String(n).replace(/\D/g, "");
    if (d.length === 12 && d.slice(0, 2) === "78") d = "7" + d.slice(2);
    if (d.length === 10) d = "7" + d; else if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1);
    var pretty = d.length === 11 && d[0] === "7" ? "+7 " + d.slice(1, 4) + " " + d.slice(4, 7) + " " + d.slice(7, 9) + " " + d.slice(9) : n;
    return '<a href="https://wa.me/' + d + '" target="_blank" rel="noopener">' + esc(pretty) + "</a>";
  }
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
      loadSchools();
    }, function (e) {
      S.loading = false;
      $("updatedAt").textContent = "Ошибка: " + e.message;
      $("view").innerHTML = '<div class="box"><h2>Не удалось загрузить данные</h2>' +
        '<p class="sub">' + esc(e.message) + "</p>" +
        (/forbidden|permission/i.test(e.message)
          ? '<div class="note">Сейчас вход выполнен под <b>' + esc(S.whoami || "неизвестным аккаунтом") + '</b>, а этой почты нет в списке администраторов.<br>' +
            'Если это не твой аккаунт (например, остался тестовый) — <button type="button" id="btnLogout2" class="btn" style="margin-top:8px">выйти и войти своим</button>.<br>' +
            'Если аккаунт твой и доступ нужен — выполни в SQL-редакторе Supabase:<br><code>select seed_admin(\'' + esc(S.whoami || "почта@аккаунта") + '\');</code></div>'
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
    else if (S.tab === "ads") { v.innerHTML = viewAds(); loadAds(); }
    else if (S.tab === "people") v.innerHTML = viewPeople();
    else if (S.tab === "schools") v.innerHTML = viewSchools();
    else if (S.tab === "reports") v.innerHTML = viewReports();
    else if (S.tab === "product") { v.innerHTML = viewProduct(); loadRetention(); }
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


  /* ---------- Реклама: расход площадок × наша воронка ----------
     Расход TikTok/Meta/Google сюда не приходит сам: у площадок для этого
     нужен отдельный «developer app» и токен Marketing API. Поэтому расход
     заносится руками (10 секунд в день) или импортом CSV-выгрузки Ads
     Manager. Всё остальное — визиты, квизы, заявки, оплаты — уже наше:
     сайт кладёт ttclid/fbclid/gclid и utm_source в каждое событие, и база
     считает, кто именно пришёл с рекламы. Отсюда CPM, CPC, CPV, цена
     квиза, CPL, CAC и ROAS без выдуманных чисел. */
  var ADS_PLATFORMS = { tiktok: "TikTok Ads", meta: "Instagram / Meta", google: "Google Ads" };
  S.adsPlatform = S.adsPlatform || "tiktok";
  function per(spend, n) { return n > 0 ? money(spend / n) : "—"; }
  function loadAds() {
    var pf = S.adsPlatform;
    Promise.all([rpc("admin_ads", { p_days: S.days, p_platform: pf }), rpc("admin_ad_spend_list", { p_days: S.days })])
      .then(function (r) {
        S.ads = { sum: r[0] || {}, rows: r[1] || [], platform: pf, days: S.days };
        if (S.tab === "ads") $("view").innerHTML = viewAds();
      }, function (e) {
        var box = $("adsBody");
        if (box) box.innerHTML = '<div class="err">Не удалось загрузить метрики рекламы: ' + esc(e.message) +
          '</div><div class="note">Если ошибка про отсутствующую функцию admin_ads — накати миграцию 041_ad_metrics.sql в Supabase.</div>';
      });
  }
  function viewAds() {
    var pf = S.adsPlatform, pfName = ADS_PLATFORMS[pf] || pf;
    var head = '<div class="box"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between">' +
      '<div><h2 style="margin:0">Реклама · ' + esc(pfName) + '</h2><p class="sub" style="margin:4px 0 0">Расход площадки против нашей воронки за ' + S.days + " " + plural(S.days, "день", "дня", "дней") + '. Кто «с рекламы» — по меткам ttclid / fbclid / gclid и utm_source в ссылке.</p></div>' +
      '<div class="seg" id="adsSeg">' + Object.keys(ADS_PLATFORMS).map(function (k) { return '<button data-pf="' + k + '"' + (k === pf ? ' class="on"' : "") + ">" + esc(ADS_PLATFORMS[k]) + "</button>"; }).join("") + "</div></div></div>";
    if (!S.ads || S.ads.platform !== pf || S.ads.days !== S.days) return head + '<div id="adsBody" class="muted">Загружаю…</div>';
    var a = S.ads.sum, spend = Number(a.spend) || 0;
    var kp = kpi([
      ["Расход за период", money(spend), true, (Number(a.days_with_spend) || 0) + " " + plural(Number(a.days_with_spend) || 0, "день", "дня", "дней") + " с расходом" + (a.last_spend_day ? ", последний " + day(a.last_spend_day) : "")],
      ["Цена просмотра (CPV)", per(spend, Number(a.views)), false, num(a.views) + " просмотров видео по данным площадки"],
      ["Цена 1000 показов (CPM)", Number(a.impressions) > 0 ? money(spend / Number(a.impressions) * 1000) : "—", false, num(a.impressions) + " показов"],
      ["Цена клика (CPC)", per(spend, Number(a.clicks)), false, num(a.clicks) + " кликов по данным площадки"],
      ["Цена визита на сайт", per(spend, Number(a.visitors)), false, num(a.visitors) + " устройств с рекламы — по нашим меткам"],
      ["Цена прохождения квиза", per(spend, Number(a.quiz_done)), true, num(a.quiz_done) + " дошли до результата · начали " + num(a.quiz_start)],
      ["Цена заявки (CPL)", per(spend, Number(a.leads)), true, num(a.leads) + " заявок с контактом"],
      ["Цена покупки (CAC)", per(spend, Number(a.payments)), true, num(a.payments) + " оплат · нажали «Оплатить» " + num(a.pay_clicks)],
      ["Выручка с рекламы", money(a.revenue), false, spend > 0 ? "ROAS " + (Math.round(Number(a.revenue) / spend * 100) / 100) + " · окупаемость " + pct(a.revenue, spend) + "%" : "ROAS появится, когда внесёшь расход"],
      ["Результаты по данным площадки", num(a.results), false, "как считает сам кабинет рекламы (пиксель); цена " + per(spend, Number(a.results))]
    ]);
    var daily = (a.daily || []).filter(function (r) { return Number(r.spend) || Number(r.visitors) || Number(r.leads) || Number(r.payments); });
    var dailyBox = '<div class="grid2"><div class="box"><h2>Расход и заявки по дням</h2><p class="sub">Столбцы: расход (₸) и заявки с рекламы.</p>' +
      barChart(a.daily || [], "day", [{ key: "spend", name: "Расход, ₸", color: "#5B4BFF", money: true }], { money: true }) +
      barChart(a.daily || [], "day", [{ key: "visitors", name: "Визиты", color: "#C7C2FF" }, { key: "quiz_done", name: "Прошли квиз", color: "#8F84FF" }, { key: "leads", name: "Заявки", color: "#1E874B" }, { key: "payments", name: "Оплаты", color: "#E0A800" }]) + "</div>" +
      '<div class="box"><h2>По дням</h2><p class="sub">Только дни, где что-то было.</p>' +
      table([["День"], ["Расход", 1], ["Показы", 1], ["Клики", 1], ["Визиты", 1], ["Квиз", 1], ["Заявки", 1], ["CPL", 1], ["Оплаты", 1], ["CAC", 1], ["Выручка", 1]], daily.slice().reverse(), function (r) {
        var sp = Number(r.spend) || 0;
        return "<td>" + esc(day(r.day)) + '</td><td class="num">' + money(sp) + '</td><td class="num">' + num(r.impressions) + '</td><td class="num">' + num(r.clicks) +
          '</td><td class="num">' + num(r.visitors) + '</td><td class="num">' + num(r.quiz_done) + '</td><td class="num">' + num(r.leads) + '</td><td class="num">' + per(sp, Number(r.leads)) +
          '</td><td class="num">' + num(r.payments) + '</td><td class="num">' + per(sp, Number(r.payments)) + '</td><td class="num">' + money(r.revenue) + "</td>";
      }) + "</div></div>";
    var today = new Date().toISOString().slice(0, 10);
    var form = '<div class="box"><h2>Внести расход</h2><p class="sub">Цифры из кабинета ' + esc(pfName) + ' за день: расход, показы, клики, просмотры видео, результаты. Повторный ввод за тот же день и кампанию перезаписывает строку.</p>' +
      '<div class="adsform">' +
      '<div><label>День</label><input id="adDay" type="date" value="' + today + '" max="' + today + '"></div>' +
      '<div><label>Кампания (необязательно)</label><input id="adCamp" type="text" placeholder="напр. Школьники сентябрь" maxlength="120"></div>' +
      '<div><label>Расход, ₸</label><input id="adSpend" type="number" min="0" step="1" inputmode="numeric" placeholder="0"></div>' +
      '<div><label>Показы</label><input id="adImp" type="number" min="0" step="1" inputmode="numeric" placeholder="0"></div>' +
      '<div><label>Клики</label><input id="adClicks" type="number" min="0" step="1" inputmode="numeric" placeholder="0"></div>' +
      '<div><label>Просмотры видео</label><input id="adViews" type="number" min="0" step="1" inputmode="numeric" placeholder="0"></div>' +
      '<div><label>Результаты (по площадке)</label><input id="adRes" type="number" min="0" step="1" inputmode="numeric" placeholder="0"></div>' +
      '<div><button class="btn-adm" id="btnAdSave" type="button">Сохранить</button></div>' +
      '</div><div id="adMsg" class="muted" style="margin-top:8px"></div>' +
      '<div class="note"><b>Импорт из Ads Manager:</b> Отчёты → «Создать отчёт» → разбивка по дням → Экспорт CSV, затем ' +
      '<label class="btn-adm btn-ghost" style="cursor:pointer;min-height:34px;padding:0 12px;font-size:13px">выбрать файл<input id="adCsv" type="file" accept=".csv,text/csv" hidden></label>. ' +
      'Нужны колонки с датой и расходом (Cost / Spend / Расход); показы, клики, просмотры и результаты подхватятся, если есть. Валюта — как в кабинете (₸).</div></div>';
    var rows = (S.ads.rows || []).filter(function (r) { return r.platform === pf; });
    var list = '<div class="box"><h2>Внесённые строки</h2><p class="sub">' + (rows.length ? rows.length + " " + plural(rows.length, "строка", "строки", "строк") + " за период" : "Пока ничего не внесено — метрики выше считаются с нулевым расходом.") + "</p>" +
      table([["День"], ["Кампания"], ["Расход", 1], ["Показы", 1], ["Клики", 1], ["Просмотры", 1], ["Результаты", 1], [""]], rows, function (r) {
        return "<td>" + esc(day(r.day)) + "</td><td>" + esc(r.campaign || "—") + '</td><td class="num">' + money(r.spend) + '</td><td class="num">' + num(r.impressions) + '</td><td class="num">' + num(r.clicks) +
          '</td><td class="num">' + num(r.views) + '</td><td class="num">' + num(r.results) + '</td><td class="num"><a href="#" data-act="ad-del" data-day="' + esc(r.day) + '" data-camp="' + esc(r.campaign || "") + '">удалить</a></td>';
      }) + "</div>";
    var how = '<div class="box"><h2>Как это считается</h2><p class="sub">Честно и без магии: расход — из кабинета площадки, всё остальное — из нашей базы.</p>' +
      '<div class="metric-help"><b>Визиты, квизы, заявки, оплаты</b> — только устройства, у которых в ссылке была метка площадки: TikTok добавляет <code>ttclid</code> к ссылке из объявления автоматически (в настройках кампании «Отслеживание» должно быть включено), а в ссылке лучше ещё держать <code>utm_source=tiktok</code>. ' +
      'Meta — <code>fbclid</code>, Google — <code>gclid</code>. Заявка — устройство, оставившее WhatsApp или почту. Оплата — боевой платёж по заявке с меткой (по id заявки или её почте). ' +
      '<b>CPL</b> = расход / заявки, <b>CAC</b> = расход / оплаты, <b>ROAS</b> = выручка / расход. Просмотры, показы, клики и «результаты» берутся из кабинета, поэтому CPV/CPM/CPC — по данным площадки.</div></div>';
    return head + '<div id="adsBody">' + kp + dailyBox + form + list + how + "</div>";
  }
  function adNum(id) { var v = Number(($(id) || {}).value || 0); return isFinite(v) && v > 0 ? v : 0; }
  function saveAdRow() {
    var d = ($("adDay") || {}).value;
    var msg = $("adMsg");
    if (!d) { if (msg) { msg.textContent = "Укажи день."; msg.style.color = "#C0392B"; } return; }
    if (!adNum("adSpend") && !adNum("adImp") && !adNum("adClicks") && !adNum("adViews")) { if (msg) { msg.textContent = "Внеси хотя бы расход."; msg.style.color = "#C0392B"; } return; }
    var row = { day: d, platform: S.adsPlatform, campaign: (($("adCamp") || {}).value || "").trim(), spend: adNum("adSpend"), impressions: adNum("adImp"), clicks: adNum("adClicks"), views: adNum("adViews"), results: adNum("adRes") };
    var b = $("btnAdSave"); if (b) b.disabled = true;
    rpc("admin_ad_spend_upsert", { p_rows: [row] }).then(function () {
      if (msg) { msg.textContent = "Сохранено: " + day(d) + " · " + money(row.spend); msg.style.color = "#1E874B"; }
      S.ads = null; loadAds();
    }, function (e) { if (b) b.disabled = false; if (msg) { msg.textContent = "Не сохранилось: " + e.message; msg.style.color = "#C0392B"; } });
  }
  function deleteAdRow(el) {
    var d = el.getAttribute("data-day"), c = el.getAttribute("data-camp") || "";
    if (!confirm("Удалить расход за " + day(d) + (c ? " (" + c + ")" : "") + "?")) return;
    rpc("admin_ad_spend_delete", { p_day: d, p_platform: S.adsPlatform, p_campaign: c }).then(function () { S.ads = null; loadAds(); },
      function (e) { alert("Не удалилось: " + e.message); });
  }
  /* CSV из Ads Manager: разделитель , или ; или таб; заголовки на английском
     или русском; дата в любом из обычных форматов; числа с пробелами и запятой. */
  function parseAdsCsv(text) {
    text = String(text || "").replace(/^﻿/, "");
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (lines.length < 2) return { error: "в файле нет строк с данными" };
    var sep = [",", ";", "\t"].map(function (c) { return [c, (lines[0].match(new RegExp(c === "\t" ? "\t" : "\\" + c, "g")) || []).length]; }).sort(function (a, b) { return b[1] - a[1]; })[0][0];
    function split(l) {
      var out = [], cur = "", q = false;
      for (var i = 0; i < l.length; i++) {
        var ch = l[i];
        if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
        else if (ch === sep && !q) { out.push(cur); cur = ""; }
        else cur += ch;
      }
      out.push(cur); return out.map(function (x) { return x.trim(); });
    }
    var head = split(lines[0]).map(function (h) { return h.toLowerCase(); });
    // колонки «cost per …», «rate», «cpc/cpm/ctr» — производные, их не берём
    function col(re, not) { for (var i = 0; i < head.length; i++) if (re.test(head[i]) && !(not && not.test(head[i]))) return i; return -1; }
    var DERIV = /(cost per|per 1,?000|cpc|cpm|cpv|ctr|rate|%|цена за|средн|стоимость за)/;
    var cDay = col(/^(date|day|день|дата|by day|stat_time_day|время)/), cSpend = col(/(^cost$|^spend|total cost|amount spent|расход|затрат|^стоимость$)/, /(cost per|per )/),
        cImp = col(/(impression|показ)/, DERIV), cClk = col(/(click|клик)/, DERIV), cViews = col(/(video views|video play|2-second|2 s|6-second|просмотр)/, DERIV),
        cRes = col(/(^results?$|^conversions?$|результат|конверси)/, DERIV), cCamp = col(/(campaign name|кампани)/);
    if (cDay < 0 || cSpend < 0) return { error: "не нашёл колонки даты и расхода. Заголовки: " + head.join(" | ") };
    // «12,500.50», «23,000», «15 000,00», «1.234,5» — разделители в выгрузках гуляют
    function n(v) {
      v = String(v == null ? "" : v).replace(/[\s\u00a0₸$€]/g, "");
      var hasC = v.indexOf(",") !== -1, hasD = v.indexOf(".") !== -1;
      if (hasC && hasD) { if (v.lastIndexOf(",") > v.lastIndexOf(".")) v = v.replace(/\./g, "").replace(",", "."); else v = v.replace(/,/g, ""); }
      else if (hasC) { var parts = v.split(","); v = (parts.length === 2 && parts[1].length !== 3) ? parts[0] + "." + parts[1] : parts.join(""); }
      else if (hasD) { var pd = v.split("."); if (pd.length > 2) v = pd.join(""); }
      var x = parseFloat(v); return isFinite(x) && x > 0 ? x : 0;
    }
    function d(v) {
      v = String(v || "").trim();
      var m = v.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + "-" + m[2] + "-" + m[3];
      m = v.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/); if (m) return m[3] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
      m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return m[3] + "-" + ("0" + m[1]).slice(-2) + "-" + ("0" + m[2]).slice(-2);
      var t = Date.parse(v); return isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
    }
    var rows = {}, skipped = 0;
    lines.slice(1).forEach(function (l) {
      var c = split(l); var dd = d(c[cDay]);
      if (!dd || /total|итог|всего/i.test(c[cDay])) { skipped++; return; }
      var camp = cCamp >= 0 ? (c[cCamp] || "") : "";
      var k = dd + "|" + camp;
      var r = rows[k] || (rows[k] = { day: dd, campaign: camp, spend: 0, impressions: 0, clicks: 0, views: 0, results: 0 });
      r.spend += n(c[cSpend]); if (cImp >= 0) r.impressions += n(c[cImp]); if (cClk >= 0) r.clicks += n(c[cClk]);
      if (cViews >= 0) r.views += n(c[cViews]); if (cRes >= 0) r.results += n(c[cRes]);
    });
    var out = Object.keys(rows).map(function (k) { var r = rows[k]; r.spend = Math.round(r.spend); return r; });
    return { rows: out, skipped: skipped };
  }
  function importAdsCsv(file) {
    var msg = $("adMsg");
    var rd = new FileReader();
    rd.onload = function () {
      var p = parseAdsCsv(rd.result);
      if (p.error) { if (msg) { msg.textContent = "CSV не разобран: " + p.error; msg.style.color = "#C0392B"; } return; }
      if (!p.rows.length) { if (msg) { msg.textContent = "В файле не нашлось строк с датой и расходом."; msg.style.color = "#C0392B"; } return; }
      var total = p.rows.reduce(function (a, r) { return a + r.spend; }, 0);
      if (!confirm("Загрузить " + p.rows.length + " " + plural(p.rows.length, "строку", "строки", "строк") + " в " + ADS_PLATFORMS[S.adsPlatform] + " на сумму " + money(total) + "?")) return;
      var rows = p.rows.map(function (r) { r.platform = S.adsPlatform; return r; });
      rpc("admin_ad_spend_upsert", { p_rows: rows }).then(function (j) {
        if (msg) { msg.textContent = "Импортировано строк: " + ((j && j.saved) || rows.length) + " · " + money(total); msg.style.color = "#1E874B"; }
        S.ads = null; loadAds();
      }, function (e) { if (msg) { msg.textContent = "Импорт не прошёл: " + e.message; msg.style.color = "#C0392B"; } });
    };
    rd.readAsText(file);
  }
  window.__parseAdsCsv = parseAdsCsv;   // для автотестов

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

  /* ---------- школы (B2B) ----------
     Заявка → «Активировать» (база выпускает код и токен кабинета) → письмо
     школе уходит через api/school-notify.php. Всё остальное — правки ёмкости,
     срока, паузы — тем же admin_school_set. */
  var PLAN_LABEL = { pilot: "Пилот", s100: "Класс · 100", s500: "Школа · 500", s1000: "Сеть · 1000", c15: "Старт · 15", c50: "Практика · 50", c150: "Агентство · 150" };
  var SCH_KIND = { state: "гос.", private: "частная", other: "", counselor: "профориентолог" };
  var SCH_STATUS = { pending: ["warn", "заявка"], active: ["ok", "активна"], paused: ["no", "пауза"], expired: ["no", "истекла"], rejected: ["bad", "отказ"] };
  function loadSchools() {
    rpc("admin_schools").then(function (rows) { S.schools = rows || []; if (S.tab === "schools") draw(); },
      function (e) { S.schoolsErr = e.message; if (S.tab === "schools") draw(); });
  }
  function viewSchools() {
    if (S.schoolsErr) return '<div class="box"><h2>Школы</h2><p class="sub">Не удалось загрузить: ' + esc(S.schoolsErr) + '</p><div class="note">Проверь, что применена миграция 035_schools.sql.</div></div>';
    var rows = S.schools || [];
    var pending = rows.filter(function (r) { return r.status === "pending"; });
    var active = rows.filter(function (r) { return r.status === "active"; });
    var seatsUsed = active.reduce(function (a, r) { return a + (r.used || 0); }, 0);
    var seatsAll  = active.reduce(function (a, r) { return a + (r.seats || 0); }, 0);
    var activeC = active.filter(function (r) { return r.kind === "counselor"; }).length;
    var h = kpi([["Заявок ждут", pending.length], ["Активных школ", active.length - activeC], ["Workspace профориентологов", activeC], ["Учеников / мест", seatsUsed + " / " + seatsAll]]);
    h += '<div class="box"><h2>Школы и профориентологи · ' + rows.length + '</h2><p class="sub">Активация выпускает ссылку для учеников и вход в кабинет (школы) или workspace (профориентолога); письмо уходит на почту контакта автоматически. Пробный период профориентолога — 14 дней, если поле «мес.» пустое.</p>' +
      (rows.length ? '<div class="scroll"><table class="adm"><tr><th>Школа</th><th>Контакт</th><th>Тариф</th><th class="num">Места</th><th>Срок</th><th>Статус</th><th>Действия</th></tr>' +
        rows.map(function (r) { return "<tr>" + schoolRow(r) + "</tr>"; }).join("") + "</table></div>" : '<div class="muted">Заявок пока нет. Страница для школ: <a href="/schools/" target="_blank">scholary.kz/schools</a></div>') +
      "</div>";
    return h;
  }
  function schoolRow(r) {
    var st = SCH_STATUS[r.status] || ["no", r.status];
    var isC = r.kind === "counselor";
    var link = "https://scholary.kz/schools/join/?code=" + (r.invite_code || "");
    var cab  = (isC ? "https://scholary.kz/prof/cabinet/?claim=" : "https://scholary.kz/schools/cabinet/?claim=") + (r.claim_token || "");
    var id = esc(r.id);
    var actions = "";
    if (r.status === "pending" || r.status === "paused" || r.status === "expired" || r.status === "rejected") {
      actions += '<div class="tools" style="grid-template-columns:90px 90px auto;gap:6px;margin-bottom:6px">' +
        '<input type="number" min="1" placeholder="мест" value="' + (r.seats || 50) + '" data-seats="' + id + '" title="Мест">' +
        '<input type="number" min="1" max="60" placeholder="' + (isC && r.plan === "pilot" ? "14 дн." : "мес.") + '" value="' + (r.plan === "pilot" ? (isC ? "" : 1) : 12) + '" data-months="' + id + '" title="' + (isC && r.plan === "pilot" ? "Пусто = пробные 14 дней" : "Месяцев") + '">' +
        '<button class="btn-adm" data-act="sch-activate" data-id="' + id + '">Активировать</button></div>';
      if (r.status === "pending") actions += '<button class="btn-adm btn-ghost" data-act="sch-status" data-id="' + id + '" data-status="rejected">Отклонить</button> ';
    }
    if (r.status === "active") {
      actions += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">' +
        '<button class="btn-adm btn-ghost" data-act="sch-mail" data-id="' + id + '">' + (isC ? "Письмо профориентологу" : "Письмо школе") + '</button>' +
        '<button class="btn-adm btn-ghost" data-act="copy" data-link="' + esc(link) + '">Ссылка учеников</button>' +
        '<button class="btn-adm btn-ghost" data-act="copy" data-link="' + esc(cab) + '">' + (isC ? "Вход в workspace" : "Вход в кабинет") + '</button>' +
        '<button class="btn-adm btn-ghost" data-act="sch-status" data-id="' + id + '" data-status="paused">Пауза</button>' +
        (r.claimed ? '<button class="btn-adm btn-ghost" data-act="sch-reset" data-id="' + id + '" title="Профориентолог сменился: старая ссылка кабинета перестанет работать, новая уйдёт письмом">Сменить профориентолога</button>' : "") + '</div>' +
        '<div class="tools" style="grid-template-columns:90px 90px auto;gap:6px">' +
        '<input type="number" min="1" placeholder="мест" value="' + (r.seats || 50) + '" data-seats="' + id + '" title="Мест">' +
        '<input type="number" min="1" max="60" placeholder="+мес." data-months="' + id + '" title="Продлить на N месяцев">' +
        '<button class="btn-adm btn-ghost" data-act="sch-update" data-id="' + id + '">Сохранить</button></div>';
    }
    actions += '<div class="muted" data-msg="' + id + '" style="margin-top:6px;font-size:12px"></div>';
    var contact = esc(r.contact_name || "—") + (r.contact_role ? ' <span class="muted">· ' + esc(r.contact_role) + "</span>" : "") +
      "<br><a href=\"mailto:" + esc(r.contact_email) + "\">" + esc(r.contact_email) + "</a>" + (r.contact_phone ? "<br>" + wa(r.contact_phone) : "") +
      (r.claimed ? '<br><span class="pill ok">кабинет привязан</span>' : (r.status === "active" ? '<br><span class="pill warn">в кабинет ещё не входили</span>' : ""));
    var note = (r.note ? '<div class="muted" style="font-size:12px;margin-top:4px;max-width:260px">' + esc(r.note) + "</div>" : "") +
      (r.students_expected ? '<div class="muted" style="font-size:12px">ожидают ' + r.students_expected + " уч.</div>" : "");
    return "<td><b>" + esc(r.name) + "</b>" + (r.is_test ? ' <span class="pill no">тест</span>' : "") + "<br><span class=\"muted\">" + esc([r.city, SCH_KIND[r.kind] || ""].filter(Boolean).join(" · ")) + "</span>" + note +
      '<div class="muted" style="font-size:12px;margin-top:4px">заявка ' + dt(r.created_at) + "</div></td>" +
      "<td>" + contact + "</td>" +
      "<td>" + esc(PLAN_LABEL[r.plan] || r.plan) + (r.period === "month" ? '<br><span class="muted">помесячно</span>' : "") + "</td>" +
      '<td class="num">' + (r.used || 0) + " / " + (r.seats || 0) + "</td>" +
      "<td>" + (r.ends_on ? day(r.starts_on) + " — " + day(r.ends_on) : "—") + "</td>" +
      '<td><span class="pill ' + st[0] + '">' + st[1] + "</span>" + (r.invite_code ? '<br><code style="font-size:12px">' + esc(r.invite_code) + "</code>" : "") + "</td>" +
      "<td>" + actions + "</td>";
  }
  function schoolSay(id, text, bad) {
    var el = document.querySelector('[data-msg="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (el) { el.textContent = text; el.style.color = bad ? "#C0392B" : "#1E874B"; }
  }
  function schoolSet(id, args, okText, thenMail) {
    schoolSay(id, "Сохраняю…");
    return rpc("admin_school_set", Object.assign({ p_id: id }, args)).then(function (j) {
      if (!j || !j.ok) { schoolSay(id, "Не получилось: " + ((j && j.why) || "ошибка"), true); return; }
      schoolSay(id, okText || "Сохранено");
      return (thenMail ? schoolMail(id) : Promise.resolve()).then(loadSchools);
    }, function (e) { schoolSay(id, "Ошибка: " + e.message, true); });
  }
  function schoolMail(id) {
    schoolSay(id, "Отправляю письмо школе…");
    return sb.auth.getSession().then(function (r) {
      var tok = r.data && r.data.session && r.data.session.access_token;
      return fetch("/api/school-notify.php", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok }, body: JSON.stringify({ id: id }) })
        .then(function (x) { return x.json(); }).then(function (j) {
          if (j && j.ok) schoolSay(id, "Письмо ушло на " + j.to);
          else schoolSay(id, "Письмо не ушло: " + ((j && (j.why || j.error)) || "ошибка") + " — скопируй ссылки и отправь вручную", true);
        }, function () { schoolSay(id, "Письмо не ушло (сеть) — скопируй ссылки и отправь вручную", true); });
    });
  }
  function schoolAction(act, id, btn) {
    var seatsEl = document.querySelector('[data-seats="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    var monthsEl = document.querySelector('[data-months="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    var seats = seatsEl ? parseInt(seatsEl.value, 10) : null, months = monthsEl ? parseInt(monthsEl.value, 10) : null;
    if (act === "sch-activate") return schoolSet(id, { p_status: "active", p_seats: seats || null, p_months: months || null }, "Активирована", true);
    if (act === "sch-update")   return schoolSet(id, { p_seats: seats || null, p_months: months || null }, "Сохранено" + (months ? " · срок продлён, Pro ученикам продлена" : ""));
    if (act === "sch-status")   return schoolSet(id, { p_status: btn.getAttribute("data-status") }, "Статус изменён");
    if (act === "sch-mail")     return schoolMail(id);
    if (act === "sch-reset") {
      if (!btn.getAttribute("data-armed")) { btn.setAttribute("data-armed", "1"); btn.textContent = "Точно сменить? Нажмите ещё раз"; setTimeout(function () { if (btn.isConnected) { btn.removeAttribute("data-armed"); btn.textContent = "Сменить профориентолога"; } }, 5000); return; }
      schoolSay(id, "Отвязываю…");
      return rpc("admin_school_reset_owner", { p_id: id }).then(function (j) {
        if (!j || !j.ok) { schoolSay(id, "Не получилось", true); return; }
        schoolSay(id, "Кабинет отвязан, новая ссылка выпущена");
        return schoolMail(id).then(loadSchools);
      }, function (e) { schoolSay(id, "Ошибка: " + e.message, true); });
    }
  }

  /* ---------- возвращаемость кабинета (web-74) ----------
     Считается по аккаунтам (cab_activity), а не по устройствам, как events:
     иначе один человек с телефона и ноутбука выглядел бы как двое, а «вернулся» — как «новый». */
  function loadRetention() {
    Promise.all([rpc("admin_retention", { p_days: S.days }), rpc("admin_cab_content_list")]).then(function (r) {
      S.ret = r[0] || {}; S.content = r[1] || [];
      if (S.tab === "product") { var b = $("retBody"); if (b) b.innerHTML = retentionHTML(); var c = $("contentBody"); if (c) c.innerHTML = contentHTML(); }
    }, function (e) {
      var b = $("retBody");
      if (b) b.innerHTML = '<div class="err">Не удалось загрузить возвращаемость: ' + esc(e.message) + '</div><div class="note">Если ошибка про отсутствующую функцию admin_retention — накати миграцию 042_cabinet_retention.sql.</div>';
    });
  }
  function pctTxt(v) { return v == null ? "—" : num(v) + "%"; }
  function retentionHTML() {
    var r = S.ret || {};
    if (!r.period_days) return '<div class="muted">Загружаю…</div>';
    var w = r.weekly || [];
    var maxW = w.reduce(function (a, x) { return Math.max(a, Number(x.wau) || 0); }, 1);
    return kpi([
      ["Активных за 7 дней", num(r.active_7d), true, "аккаунтов, открывших кабинет"],
      ["Активных за 30 дней", num(r.active_30d), false, "по аккаунтам, тестовые исключены"],
      ["≥ 2 дней на этой неделе", num(r.active_this_week_2plus) + " из " + num(r.active_this_week), Number(r.active_this_week_2plus) > 0, "цель Азата: 2–3 захода в неделю"],
      ["Задач закрыто на неделе", num(r.tasks_done_this_week), false, "всего за период: " + num(r.tasks_done)],
      ["Недель с прогрессом", (r.avg_weeks_progress == null ? "—" : Number(r.avg_weeks_progress).toFixed(1)), false, "в среднем на активного · 4+ недель: " + num(r.users_4plus_weeks)],
      ["Продления Pro", num(r.pro_renewals), Number(r.pro_renewals) > 0, "аккаунтов с ≥ 2 оплатами · оплат за период: " + num(r.pro_payments)]
    ]) +
    '<div class="grid2"><div class="box"><h2>Когорты по первой активности</h2><p class="sub">Доля вернувшихся: на следующий день, на 1–4-й неделе, за 30 дней. Когорта — ' + num(r.cohort_users) + ' аккаунтов за ' + r.period_days + ' дней.</p>' +
      '<div class="scroll"><table class="adm"><tr><th>D1</th><th>Неделя 1</th><th>Неделя 2</th><th>Неделя 3</th><th>Неделя 4</th><th>D30</th><th>Активных дней</th></tr>' +
      '<tr><td class="num">' + pctTxt(r.d1_pct) + '</td><td class="num">' + pctTxt(r.w1_pct) + '</td><td class="num">' + pctTxt(r.w2_pct) + '</td><td class="num">' + pctTxt(r.w3_pct) + '</td><td class="num">' + pctTxt(r.w4_pct) + '</td><td class="num">' + pctTxt(r.d30_pct) + '</td><td class="num">' + (r.avg_active_days == null ? "—" : Number(r.avg_active_days).toFixed(2)) + "</td></tr></table></div>" +
      '<p class="sub" style="margin-top:8px">Ориентир для education-приложений: D1 ≈ 18 %, D7 ≈ 8–10 %, D30 ≈ 4 % (Adjust). Для сезонного кабинета важнее недельные когорты и доля с ≥ 2 заходами в неделю.</p></div>' +
    '<div class="box"><h2>По неделям</h2><p class="sub">Активных аккаунтов, из них с ≥ 2 днями и с прогрессом; закрытых задач.</p>' +
      (w.length ? '<div class="scroll"><table class="adm"><tr><th>Неделя</th><th class="num">Активных</th><th class="num">≥ 2 дней</th><th class="num">С прогрессом</th><th class="num">Задач</th><th></th></tr>' +
        w.map(function (x) { return "<tr><td>" + esc(String(x.w).slice(5)) + '</td><td class="num">' + num(x.wau) + '</td><td class="num">' + num(x.wau2) + '</td><td class="num">' + num(x.wau_progress) + '</td><td class="num">' + num(x.tasks_done) +
          '</td><td><div style="height:8px;border-radius:6px;background:#5B4BFF;width:' + Math.round(100 * (Number(x.wau) || 0) / maxW) + '%;min-width:2px"></div></td></tr>'; }).join("") + "</table></div>" : '<div class="muted">Пока нет активности — блок наполнится после релиза web-74.</div>') +
      '<p class="sub" style="margin-top:8px">Вехи выдано: ' + num(r.badges) + ' · Telegram привязан: ' + num(r.tg_linked) + ' · возвратов по ссылке из Telegram: ' + num(r.deeplink_returns) + '</p></div></div>';
  }
  /* ---------- материалы для кабинета: заполняет владелец ----------
     Без выдуманных авторов: пока таблица пуста, блока в кабинете нет. */
  var CONTENT_KIND = { tip: "совет", article: "статья", video: "видео", story: "история", guide: "гайд" };
  function contentHTML() {
    var rows = S.content || [];
    return '<p class="sub">Показываются на «Сегодня» (блок «Материалы недели»), до 3 штук по уровню и неделе сезона. Только реальные ссылки и авторы.</p>' +
      '<div class="adsform">' +
      '<div><label>Заголовок</label><input id="ctTitle" type="text" placeholder="обязательно" maxlength="140"></div>' +
      '<div><label>Ссылка</label><input id="ctUrl" type="url" placeholder="https://…"></div>' +
      '<div><label>Автор (реальный)</label><input id="ctAuthor" type="text" maxlength="80" placeholder="напр. Диас Асанов"></div>' +
      '<div><label>Тип</label><select id="ctKind">' + Object.keys(CONTENT_KIND).map(function (k) { return '<option value="' + k + '">' + CONTENT_KIND[k] + "</option>"; }).join("") + "</select></div>" +
      '<div><label>Уровень</label><select id="ctLevel"><option value="">всем</option><option value="bachelor">бакалавр</option><option value="master">магистр</option><option value="phd">PhD</option></select></div>' +
      '<div><label>Недели сезона</label><input id="ctWeeks" type="text" placeholder="напр. 1-6 · пусто = всегда"></div>' +
      '<div><label>Описание в одну строку</label><input id="ctBody" type="text" maxlength="200" placeholder="о чём материал"></div>' +
      '<div><button class="btn-adm" id="btnContentSave" type="button">Добавить</button></div></div>' +
      (rows.length ? table([["Заголовок"], ["Тип"], ["Уровень"], ["Недели"], ["Автор"], ["Активен"], [""]], rows, function (r) {
        return "<td><b>" + esc(r.title) + "</b>" + (r.url ? ' <a href="' + esc(r.url) + '" target="_blank" rel="noopener">↗</a>' : "") + "</td><td>" + esc(CONTENT_KIND[r.kind] || r.kind) + "</td><td>" + esc(r.level || "всем") +
          "</td><td>" + (r.week_from || r.week_to ? esc((r.week_from || 1) + "–" + (r.week_to || 44)) : "всегда") + "</td><td>" + esc(r.author || "—") + "</td><td>" + (r.active ? "да" : "нет") +
          '</td><td><a href="#" data-act="ct-toggle" data-id="' + r.id + '" data-on="' + (r.active ? 1 : 0) + '">' + (r.active ? "выключить" : "включить") + '</a> · <a href="#" data-act="ct-del" data-id="' + r.id + '">удалить</a></td>';
      }) : '<div class="muted">Материалов пока нет — в кабинете блок скрыт.</div>');
  }
  function saveContent() {
    var t = $("ctTitle").value.trim(); if (!t) { $("ctTitle").focus(); return; }
    var wk = ($("ctWeeks").value || "").match(/(\d+)\s*[-–]\s*(\d+)/);
    var row = { title: t, url: $("ctUrl").value.trim(), author: $("ctAuthor").value.trim(), kind: $("ctKind").value, level: $("ctLevel").value, body: $("ctBody").value.trim(),
                week_from: wk ? +wk[1] : null, week_to: wk ? +wk[2] : null, active: true };
    rpc("admin_cab_content_upsert", { p: row }).then(function () { loadRetention(); }, function (e) { alert("Не сохранилось: " + e.message); });
  }
  function contentAction(a, el) {
    var id = +el.getAttribute("data-id");
    if (a === "ct-del") { if (!confirm("Удалить материал?")) return; rpc("admin_cab_content_delete", { p_id: id }).then(function () { loadRetention(); }); }
    if (a === "ct-toggle") { rpc("admin_cab_content_upsert", { p: { id: id, title: (S.content.filter(function (r) { return r.id === id; })[0] || {}).title, active: el.getAttribute("data-on") !== "1" } }).then(function () { loadRetention(); }); }
  }

  function viewProduct() {
    return '<div class="box"><h2>Возвращаемость кабинета</h2><p class="sub">Заходят ли люди в кабинет снова — по аккаунтам, за ' + S.days + ' ' + plural(S.days, "день", "дня", "дней") + '.</p><div id="retBody">' + retentionHTML() + '</div></div>' +
      '<div class="box"><h2>Материалы для кабинета</h2><div id="contentBody">' + contentHTML() + '</div></div>' +
      '<div class="grid2">' +
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
    /* Аккаунт владельца заведён через Google и пароля не имеет — без этой
       ветки в панель было не попасть вообще. Кнопка ловится и по вложенным
       элементам (svg внутри), поэтому closest, а не сравнение id. */
    if (t.id === "googleBtn" || (t.closest && t.closest("#googleBtn"))) {
      var gb = document.getElementById("googleBtn");
      if (gb) { gb.disabled = true; gb.textContent = "Открываю Google…"; }
      sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + "/admin/" } })
        .then(function (r) {
          if (r && r.error) {
            var e2 = document.getElementById("gateErr");
            if (e2) { e2.textContent = "Google-вход недоступен: " + r.error.message; e2.hidden = false; }
            if (gb) { gb.disabled = false; gb.textContent = "Войти через Google"; }
          }
        });
      return;
    }
    if (t.id === "btnReload") { loadAll(); return; }
    if (t.id === "btnReport") { downloadReport(); return; }
    if (t.id === "btnLogout" || t.id === "btnLogout2") { sb.auth.signOut().then(function () { try { Object.keys(localStorage).filter(function (k) { return /^sb-/.test(k); }).forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {} location.reload(); }); return; }
    if (t.id === "btnPro") { grantPro(); return; }
    if (t.id === "btnHealth") { loadHealth(false); return; }
    if (t.id === "btnAdSave") { saveAdRow(); return; }
    if (t.id === "btnContentSave") { saveContent(); return; }
    var pfb = t.closest("#adsSeg button");
    if (pfb) { S.adsPlatform = pfb.getAttribute("data-pf") || "tiktok"; S.ads = null; draw(); return; }
    if (t.id === "btnMailTest") { loadHealth(true); return; }
    var act = t.closest("[data-act]");
    if (act) {
      var a = act.getAttribute("data-act");
      if (a === "issue")  { ev.preventDefault(); issueReport(act); return; }
      if (a === "resend") { ev.preventDefault(); resendReport(act); return; }
      if (a === "copy")   { ev.preventDefault(); copyLink(act); return; }
      if (a === "ad-del") { ev.preventDefault(); deleteAdRow(act); return; }
      if (a === "ct-del" || a === "ct-toggle") { ev.preventDefault(); contentAction(a, act); return; }
      if (/^sch-/.test(a)) { ev.preventDefault(); schoolAction(a, act.getAttribute("data-id"), act); return; }
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
  document.addEventListener("change", function (e) {
    if (e.target && e.target.id === "adCsv" && e.target.files && e.target.files[0]) { importAdsCsv(e.target.files[0]); e.target.value = ""; }
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
    var raw = a.getAttribute("data-link");
    var url = /^https?:/.test(raw) ? raw : location.origin + raw;   // ссылки школ уже абсолютные
    var was = a.textContent;
    var done = function () { a.textContent = "скопировано"; setTimeout(function () { a.textContent = was === "скопировано" ? "скопировать" : was; }, 1600); };
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
      /* Чей это вход — видно сразу: в браузере мог остаться чужой или тестовый
         аккаунт, и тогда «forbidden» выглядит как поломка админки. */
      S.whoami = on ? ((r.data.session.user || {}).email || "") : "";
      $("gate").hidden = on;
      $("panel").hidden = !on;
      if (on) loadAll();
    });
  }
  boot();
}

/* Библиотека Supabase грузится с CDN; если основной адрес заблокирован,
   cabinet.html подставляет запасной — но он async и может приехать ПОЗЖЕ
   этого файла. Раньше в этом случае страница падала с TypeError и человек
   видел вечный спиннер. Ждём библиотеку до 8 секунд, потом честно говорим. */
(function boot() {
  if (window.supabase && window.supabase.createClient) { __scholaryMain(); return; }
  boot.t = boot.t || Date.now();
  if (Date.now() - boot.t < 8000) { setTimeout(boot, 100); return; }
  var el = document.getElementById("loading") || document.body;
  el.innerHTML = '<div style="max-width:520px;margin:14vh auto;padding:28px;text-align:center;font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#1D1D1F">' +
    '<h1 style="font-size:22px;margin:0 0 10px">Не получилось загрузить страницу</h1>' +
    '<p style="color:#6E6E73">Часть кода заблокирована (блокировщик рекламы, VPN или сеть оператора). Отключи блокировщик и обнови страницу или зайди из другого браузера.</p>' +
    '<p><a href="https://wa.me/' + ((window.SCHOLARY_CONFIG && window.SCHOLARY_CONFIG.WHATSAPP_NUMBER) || "77024666852") + '" style="display:inline-flex;min-height:44px;align-items:center;padding:0 22px;background:#0B7A3E;color:#fff;border-radius:999px;text-decoration:none;font-weight:700">Написать нам в WhatsApp</a></p></div>';
})();
