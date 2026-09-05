<?php
/* ============================================================
   Scholary · общие функции оплаты для всех шлюзов
   (TipTop Pay — карта, ApiPay — Kaspi).
   Здесь: вызовы узких RPC базы, выдача отчёта клиенту, журнал,
   защита от повторов. Сервисного ключа Supabase на хостинге нет
   специально: утечка конфига не должна давать доступ ко всей базе.
   ============================================================ */
require_once __DIR__ . '/_lib.php';

/* Прайс сайта: сумма из уведомления шлюза обязана совпасть с позицией,
   иначе кто-то подменил amount на 10 ₸ за отчёт. Единый для всех шлюзов. */
function pay_prices() {
  return [4000 => 'report', 15000 => 'consult', 35000 => 'package', 4990 => 'pro_month', 14900 => 'pro_season'];
}
/* Адреса мессенджера и почты: локальный стенд подменяет их моками. */
function pay_wa_base()   { return rtrim((string)(cfg()['GREEN_BASE']  ?? 'https://api.green-api.com'), '/'); }
function pay_mail_base() { return rtrim((string)(cfg()['RESEND_BASE'] ?? 'https://api.resend.com'), '/'); }
function pay_price_of($kind) {
  foreach (pay_prices() as $sum => $k) if ($k === $kind) return (int)$sum;
  return 0;
}

/* Оплата подтверждена шлюзом — выдать купленное. Идемпотентно по $txn:
   повтор уведомления второй отчёт не создаст и второй раз не напишет.
   $kind: report | consult | package | pro_month | pro_season
   $account — почта аккаунта для Pro; $email — почта покупателя;
   $lead — ID заявки квиза (для отчёта); $test — тестовый/песочница.
   Возвращает массив для журнала. */
function pay_fulfill($provider, $kind, $sum, $txn, $lead, $email, $account, $test, $extra = [], $buyer = []) {
  $c = cfg();
  $out = ['kind' => $kind, 'txn' => $txn];
  $leadOk = ($lead !== '' && strlen($lead) >= 8 && strlen($lead) <= 64);
  $label = $provider === 'kaspi' ? 'Kaspi' : 'картой';

  if ($kind === 'pro_month' || $kind === 'pro_season') {
    $who  = filter_var($account, FILTER_VALIDATE_EMAIL) ? $account : $email;
    $plan = $kind === 'pro_season' ? 'season' : 'month';
    $r    = tt_rpc('tiptop_grant_pro', ['p_email' => $who, 'p_txn' => (string)$txn,
             'p_amount' => $sum, 'p_plan' => $plan, 'p_test' => $test]);
    $granted = is_array($r) && !empty($r['ok']);
    $out['granted'] = $granted;
    /* База не ответила (null) — это не «аккаунта нет», а сбой: вызывающий код
       повторит выдачу позже, владельцу пока не пишем, чтобы не звать выдавать руками зря. */
    if ($r === null) { $out['db_failed'] = true; tt_log('pay', 'db_failed', ['kind' => $kind, 'txn' => $txn, 'via' => $provider]); return $out; }
    if (tt_once('pro-' . $txn)) {
      if (!$test) tt_api_event('CompletePayment', ['value' => $sum, 'currency' => 'KZT', 'contents' => [['content_id' => $kind, 'content_type' => 'product', 'price' => $sum, 'quantity' => 1]]], ['email' => $who, 'external_id' => (string)$txn, 'url' => 'https://scholary.kz/cabinet/', 'ttclid' => (string)($buyer['ttclid'] ?? ''), 'ip' => (string)($buyer['ip'] ?? ''), 'user_agent' => (string)($buyer['ua'] ?? '')], 'pay_' . $txn);
      notify_owner(($test ? 'Оплачена подписка Pro (ТЕСТ)' : 'Оплачена подписка Pro') . ' · ' . $label, [
        'Сумма'      => number_format($sum, 0, '.', ' ') . ' ₸',
        'План'       => $plan === 'season' ? 'сезон (183 дня)' : 'месяц (31 день)',
        'Аккаунт'    => clean_txt($who, 120) ?: '—',
        'Транзакция' => clean_txt($txn, 40) ?: '—',
        'Режим'      => $test ? 'тестовый' : 'боевой',
        'Доступ'     => $granted ? 'выдан до ' . clean_txt((string)($r['pro_until'] ?? '?'), 20)
                                 : 'НЕ ВЫДАН — аккаунта с такой почтой нет, выдать вручную: select grant_pro(\'почта\', 183)',
      ] + $extra);
    }
    return $out;
  }

  /* разовые покупки: отчёт, консультация, пакет. leads.paid ставим только за
     отчёт — иначе консультация без отчёта попадает в срочный список
     «оплатил, а отчёта нет». Услуги идут в журнал платежей с привязкой к лиду. */
  $res = ($leadOk && $kind === 'report') ? tt_mark($lead, $txn, $sum, $email, $kind, 'success', $test) : null;
  $logRes = tt_rpc('tiptop_log_payment', ['p_txn' => (string)$txn, 'p_lead' => $leadOk ? $lead : null, 'p_email' => $email,
    'p_amount' => $sum, 'p_kind' => $kind, 'p_status' => 'success', 'p_test' => $test]);
  $out['marked'] = $res;
  /* База не ответила: ни отметки оплаты, ни журнала. Выдавать «вслепую» нельзя —
     отчёт не создать, а покупка потеряется из витрин. Возвращаем db_failed,
     вызывающий код повторит выдачу через полминуты (все RPC идемпотентны по txn). */
  if ($logRes === null && ($res === false || $res === null)) {
    $out['db_failed'] = true;
    tt_log('pay', 'db_failed', ['kind' => $kind, 'txn' => $txn, 'via' => $provider]);
    return $out;
  }

  $repNote = null;
  if ($kind === 'report' && $leadOk) {
    $rep = tt_rpc('tiptop_issue_report', ['p_lead' => $lead]);
    if ($rep === null) {
      /* сама отметка прошла, а выпуск отчёта не ответил — тоже повторим позже */
      $out['db_failed'] = true;
      tt_log('pay', 'db_failed', ['kind' => $kind, 'txn' => $txn, 'via' => $provider, 'step' => 'issue_report']);
      return $out;
    }
    if (is_array($rep) && !empty($rep['ok']) && !empty($rep['token'])) {
      $sentR = ['whatsapp' => false, 'email' => false];
      /* кому и по какой ссылке ушёл отчёт — чтобы заказ мог повторить доставку
         и показать ссылку на экране «оплачено», если оба канала молчат */
      $out['report_token'] = (string)$rep['token'];
      $out['report_to'] = ['name' => (string)($rep['name'] ?? ''),
        'wa' => $test ? (string)($c['OWNER_WA'] ?? '') : (string)($rep['whatsapp'] ?? ''),
        'mail' => $test ? (string)($c['MAIL_TO'] ?? '') : (string)($rep['email'] ?? ($email ?: ''))];
      if (tt_once('report-' . $txn)) {
        /* Тестовый платёж не должен выдавать бесплатный отчёт клиенту:
           ссылка уходит только владельцу. */
        $toWa   = $test ? (string)($c['OWNER_WA'] ?? '') : (string)($rep['whatsapp'] ?? '');
        $toMail = $test ? (string)($c['MAIL_TO'] ?? '')  : (string)($rep['email'] ?? ($email ?: ''));
        $sentR = tt_send_report((string)($rep['name'] ?? ''), $toWa, $toMail, (string)$rep['token'], $test);
        tt_rpc('tiptop_mark_report_sent', ['p_lead' => $lead,
          'p_wa' => $sentR['whatsapp'] ? 'sent' : 'failed',
          'p_email' => $sentR['email'] ? 'sent' : 'failed']);
        tt_log('pay', 'report_issued', ['lead' => $lead, 'txn' => $txn, 'via' => $provider,
          'existing' => !empty($rep['existing']), 'wa' => $sentR['whatsapp'], 'mail' => $sentR['email']]);
      }
      $out['report'] = $sentR;
      $repNote = 'выдан автоматически · WhatsApp: ' . ($sentR['whatsapp'] ? 'ушёл' : 'НЕ УШЁЛ')
               . ' · почта: ' . ($sentR['email'] ? 'ушла' : 'НЕ УШЛА');
    } else {
      $why = is_array($rep) ? (string)($rep['why'] ?? 'rpc_failed') : 'rpc_failed';
      $repNote = $why === 'no_result'
        ? 'НЕ ВЫДАН — нет снимка расчёта (старый лид), собрать вручную'
        : 'НЕ ВЫДАН (' . clean_txt($why, 40) . ') — собрать вручную';
      $out['report_error'] = $why;
      tt_log('pay', 'report_not_issued', ['lead' => $lead, 'txn' => $txn, 'via' => $provider, 'why' => $why]);
    }
  } elseif ($kind === 'report') {
    $repNote = 'НЕ ВЫДАН — оплата без ID заявки, привязать вручную';
  }

  /* Консультация и пакет: оплатил — сразу получает подтверждение на WhatsApp
     и почту («профориентолог напишет и назначит дату»), а владельцу уходят
     контакты, чтобы связаться. В песочнице подтверждение уходит только владельцу. */
  $svcNote = null;
  if ($kind === 'consult' || $kind === 'package') {
    $bName  = clean_txt((string)($buyer['name'] ?? ''), 60);
    $bPhone = (string)($buyer['phone'] ?? '');
    $sentS  = ['whatsapp' => false, 'email' => false];
    if (tt_once('svc-' . $txn)) {
      $toWa   = $test ? (string)($c['OWNER_WA'] ?? '') : $bPhone;
      $toMail = $test ? (string)($c['MAIL_TO'] ?? '')  : $email;
      $sentS  = pay_send_service_confirm($kind, $sum, $bName, $toWa, $toMail, $test);
      tt_log('pay', 'service_confirm', ['kind' => $kind, 'txn' => $txn, 'via' => $provider, 'wa' => $sentS['whatsapp'], 'mail' => $sentS['email']]);
    }
    $out['confirm'] = $sentS;
    $svcNote = 'WhatsApp: ' . ($sentS['whatsapp'] ? 'ушло' : 'НЕ УШЛО') . ' · почта: ' . ($sentS['email'] ? 'ушла' : 'НЕ УШЛА');
    $extra = ['Имя' => $bName ?: '—', 'WhatsApp' => $bPhone !== '' ? '+' . clean_txt($bPhone, 16) : '—',
              'Что делать' => 'написать клиенту в WhatsApp и назначить дату онлайн-консультации'] + $extra;
  }

  if (tt_once('paid-' . $txn)) {
    if (!$test) tt_api_event('CompletePayment', ['value' => $sum, 'currency' => 'KZT', 'contents' => [['content_id' => $kind, 'content_type' => 'product', 'price' => $sum, 'quantity' => 1]]], ['email' => $email, 'phone' => (string)($buyer['phone'] ?? ''), 'external_id' => (string)$txn, 'url' => $svcNote !== null ? 'https://scholary.kz/tariffs/' : 'https://scholary.kz/quiz/', 'ttclid' => (string)($buyer['ttclid'] ?? ''), 'ip' => (string)($buyer['ip'] ?? ''), 'user_agent' => (string)($buyer['ua'] ?? '')], 'pay_' . $txn);
    notify_owner(($test ? 'Оплата прошла (ТЕСТ)' : 'Оплата прошла') . ' · ' . $label, [
      'Сумма'      => number_format($sum, 0, '.', ' ') . ' ₸',
      'За что'     => tt_kind_ru($kind),
      'Почта'      => clean_txt($email, 120) ?: '—',
      'ID лида'    => $leadOk ? clean_txt($lead, 64) : ($svcNote !== null ? 'нет (покупка со страницы тарифов)' : 'нет — привязать вручную'),
      'Транзакция' => clean_txt($txn, 40) ?: '—',
      'Режим'      => $test ? 'тестовый' : 'боевой',
      'В базе'     => $res === null ? 'записано в журнал платежей' : ($res ? 'отмечено' : 'НЕ ОТМЕЧЕНО — проверить вручную'),
    ] + ($repNote !== null ? ['Отчёт' => $repNote] : []) + ($svcNote !== null ? ['Подтверждение клиенту' => $svcNote] : []) + $extra);
  }
  return $out;
}

/* Подтверждение оплаты консультации / пакета покупателю: WhatsApp + почта.
   В логи — только флаги «ушло/не ушло». */
function pay_send_service_confirm($kind, $sum, $name, $wa, $mail, $test) {
  $c = cfg();
  $first = trim(mb_substr(preg_replace('/[^\p{L}\p{M}\s\-]/u', '', (string)$name), 0, 30));
  $hi = $first !== '' ? $first . ', спасибо!' : 'Спасибо!';
  $what = $kind === 'package' ? 'пакет «Документы и подача»' : '«Разбор со специалистом»';
  $next = $kind === 'package'
    ? 'назначить дату первого созвона (30 минут) и собрать список твоих программ'
    : 'назначить дату и время онлайн-консультации (90 минут, Zoom / Google Meet)';
  $sumTxt = number_format((int)$sum, 0, '.', ' ') . ' ₸';
  $out = ['whatsapp' => false, 'email' => false];

  $digits = wa_digits($wa);
  if (!empty($c['GREEN_ID']) && !empty($c['GREEN_TOKEN']) && $digits !== null) {
    $msg = $hi . " Оплата " . $sumTxt . " за " . $what . " получена ✅\n\n"
         . "Профориентолог Scholary скоро напишет тебе сюда, в WhatsApp, и на почту"
         . (filter_var($mail, FILTER_VALIDATE_EMAIL) ? " " . $mail : "") . ", чтобы " . $next . ".\n\n"
         . "Если удобнее написать первым — просто ответь на это сообщение.";
    if ($test) $msg = "[ТЕСТОВЫЙ ПЛАТЁЖ]\n" . $msg;
    $r = http_json(pay_wa_base() . '/waInstance' . $c['GREEN_ID'] . '/sendMessage/' . $c['GREEN_TOKEN'],
      'POST', ['Content-Type: application/json'],
      ['chatId' => $digits . '@c.us', 'message' => $msg], 20);
    $out['whatsapp'] = ($r['code'] >= 200 && $r['code'] < 300);
  }

  if (!empty($c['RESEND_KEY']) && filter_var($mail, FILTER_VALIDATE_EMAIL)) {
    $subj = ($test ? '[ТЕСТ] ' : '') . 'Оплата получена — Scholary';
    $html = '<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#1D1D1F;max-width:520px">'
          . '<h2 style="margin:0 0 12px;font-size:20px">' . htmlspecialchars($hi) . '</h2>'
          . '<p>Оплата <b>' . htmlspecialchars($sumTxt) . '</b> за ' . htmlspecialchars($what) . ' получена.</p>'
          . '<p>Профориентолог Scholary скоро напишет тебе в WhatsApp' . ($digits !== null ? ' на +' . htmlspecialchars($digits) : '')
          . ' и на эту почту, чтобы ' . htmlspecialchars($next) . '.</p>'
          . '<p style="color:#6B7280;font-size:13px">Если удобнее написать первым — ответь на это письмо или напиши нам в WhatsApp: +7 702 466 68 52.</p></div>';
    $text = $hi . "\n\nОплата " . $sumTxt . " за " . $what . " получена. Профориентолог Scholary скоро напишет тебе в WhatsApp и на почту, чтобы " . $next . ".";
    $r = http_json(pay_mail_base() . '/emails', 'POST', [
      'Authorization: Bearer ' . $c['RESEND_KEY'], 'Content-Type: application/json',
    ], array_filter([
        'from' => mail_from(), 'to' => [$mail], 'subject' => $subj,
        'reply_to' => mail_reply_to(),
        'html' => $html, 'text' => $text], function ($v) { return $v !== null; }), 20);
    $out['email'] = ($r['code'] >= 200 && $r['code'] < 300);
  }
  return $out;
}

/* Отметить лид оплаченным через узкий security-definer RPC.
   Сервисного ключа Supabase на хостинге нет специально: утечка конфига
   не должна давать доступ ко всей базе. */
/* Отправка готового отчёта клиенту: WhatsApp + почта.
   Никаких персональных данных в логи — только флаги «ушло/не ушло». */
function tt_send_report($name, $wa, $mail, $token, $test) {
  $c = cfg();
  $link = 'https://scholary.kz/report/?t=' . rawurlencode($token);
  $first = trim(mb_substr(preg_replace('/[^\p{L}\p{M}\s\-]/u', '', (string)$name), 0, 30));
  $hi = $first !== '' ? $first . ', привет!' : 'Привет!';
  $out = ['whatsapp' => false, 'email' => false];

  $digits = wa_digits($wa);
  if (!empty($c['GREEN_ID']) && !empty($c['GREEN_TOKEN']) && $digits !== null) {
    $msg = $hi . " Твой отчёт Scholary готов 🎓

"
         . "Вероятности по каждой программе, портфель подач и план документов — по ссылке:
"
         . $link . "

"
         . "Ссылка личная, работает всегда — можно показать родителям.
"
         . "Вопросы по отчёту? Просто ответь на это сообщение.";
    if ($test) $msg = "[ТЕСТОВЫЙ ПЛАТЁЖ]
" . $msg;
    $r = http_json(pay_wa_base() . '/waInstance' . $c['GREEN_ID'] . '/sendMessage/' . $c['GREEN_TOKEN'],
      'POST', ['Content-Type: application/json'],
      ['chatId' => $digits . '@c.us', 'message' => $msg], 20);
    $out['whatsapp'] = ($r['code'] >= 200 && $r['code'] < 300);
  }

  if (!empty($c['RESEND_KEY']) && filter_var($mail, FILTER_VALIDATE_EMAIL)) {
    $subj = ($test ? '[ТЕСТ] ' : '') . 'Твой отчёт Scholary готов';
    $html = '<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#1D1D1F;max-width:520px">'
          . '<h2 style="margin:0 0 12px;font-size:20px">' . htmlspecialchars($hi) . '</h2>'
          . '<p>Отчёт о вероятности поступления готов: вероятности по каждой программе, '
          . 'портфель подач, дедлайны и план документов.</p>'
          . '<p style="margin:20px 0"><a href="' . htmlspecialchars($link) . '" '
          . 'style="background:#4F46E5;color:#fff;text-decoration:none;font-weight:700;'
          . 'padding:13px 22px;border-radius:10px;display:inline-block">Открыть отчёт</a></p>'
          . '<p style="color:#6B7280;font-size:13px">Ссылка личная и не сгорает. '
          . 'Не открывается — напиши нам в WhatsApp, поможем.</p></div>';
    $text = $hi . "\n\nТвой отчёт Scholary готов: " . $link;
    $r = http_json(pay_mail_base() . '/emails', 'POST', [
      'Authorization: Bearer ' . $c['RESEND_KEY'], 'Content-Type: application/json',
    ], array_filter([
        'from' => mail_from(), 'to' => [$mail], 'subject' => $subj,
        'reply_to' => mail_reply_to(),   /* «Ответить» ведёт живому человеку */
        'html' => $html, 'text' => $text], function ($v) { return $v !== null; }), 20);
    $out['email'] = ($r['code'] >= 200 && $r['code'] < 300);
  }
  return $out;
}

function tt_rpc($fn, $args) {
  $c = cfg();
  if (empty($c['TIPTOP_RPC_SECRET'])) { tt_log('rpc', 'no_secret', ['fn' => $fn]); return null; }
  $r = http_json($c['SUPABASE_URL'] . '/rest/v1/rpc/' . $fn, 'POST', [
    'apikey: ' . $c['SUPABASE_ANON'],
    'Authorization: Bearer ' . $c['SUPABASE_ANON'],
    'Content-Type: application/json',
  ], ['p_secret' => $c['TIPTOP_RPC_SECRET']] + $args, 20);
  if ($r['code'] < 200 || $r['code'] >= 300) {
    tt_log('rpc', 'failed', ['fn' => $fn, 'code' => $r['code'], 'body' => substr((string)$r['body'], 0, 300)]);
    return null;
  }
  return is_array($r['json']) ? $r['json'] : ['ok' => true];
}

function tt_mark($lead, $txn, $amount, $email, $kind, $status, $test = false) {
  /* p_test отделяет тестовые платежи от боевых: без него проверка эквайринга
     тестовой картой ставила leads.paid и попадала и в выручку, и в срочный
     список «оплатил, но отчёта нет». */
  return tt_rpc('tiptop_mark_paid', [
    'p_lead' => $lead, 'p_txn' => (string)$txn, 'p_amount' => $amount,
    'p_email' => $email ?: null, 'p_kind' => $kind, 'p_status' => $status,
    'p_test' => (bool)$test,
  ]) !== null;
}

/* Отдать ответ шлюзу и закрыть соединение, продолжив работу в фоне. */
function tt_finish($json) {
  ignore_user_abort(true);
  header('Content-Length: ' . strlen($json));
  echo $json;
  if (function_exists('fastcgi_finish_request')) { fastcgi_finish_request(); return; }
  while (ob_get_level() > 0) @ob_end_flush();
  @flush();
}

function tt_kind_ru($k) {
  $m = ['report' => 'Отчёт', 'consult' => 'Консультация', 'package' => 'Документы и подача',
        'pro_month' => 'Pro на месяц', 'pro_season' => 'Pro на сезон'];
  return $m[$k] ?? (string)$k;
}

/* Один и тот же платёж шлюз может прислать несколько раз (ретраи).
   Владельцу пишем только про первый. */
function tt_once($key) {
  $dir = dirname($_SERVER['DOCUMENT_ROOT']) . '/private/tiptop';
  if (!is_dir($dir)) @mkdir($dir, 0700, true);
  $f = $dir . '/seen-' . substr(hash('sha256', $key), 0, 32) . '.flag';
  /* fopen('x') атомарен: два одновременных ретрая шлюза не пройдут оба */
  $h = @fopen($f, 'x');
  if ($h === false) return false;
  fwrite($h, (string)time()); fclose($h);
  foreach ((array)@glob($dir . '/seen-*.flag') as $old) {
    if (@filemtime($old) < time() - 30 * 86400) @unlink($old);
  }
  return true;
}

/* Снять замок tt_once — для повторной выдачи, когда первая попытка упала. */
function tt_forget($key) {
  $f = dirname($_SERVER['DOCUMENT_ROOT']) . '/private/tiptop/seen-' . substr(hash('sha256', $key), 0, 32) . '.flag';
  return @unlink($f);
}

function tt_log($type, $what, $data) {
  $dir = dirname($_SERVER['DOCUMENT_ROOT']) . '/private/tiptop';
  if (!is_dir($dir)) @mkdir($dir, 0700, true);
  $line = json_encode(['t' => gmdate('c'), 'type' => $type, 'what' => $what] + $data, JSON_UNESCAPED_UNICODE);
  @file_put_contents($dir . '/log-' . gmdate('Y-m') . '.jsonl', $line . "\n", FILE_APPEND | LOCK_EX);
}
