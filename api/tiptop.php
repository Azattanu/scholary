<?php
/* ============================================================
   Scholary · приём уведомлений TipTop Pay.
   Один файл на все типы, тип берётся из ?type= (отдельный URL
   на каждый тип прописан в ЛК TipTop).

   Почему это важно: RPC upsert_lead намеренно не умеет писать
   поля оплаты, поэтому saveLead({paid:true}) с фронта ничего не
   меняет. Единственный доверенный источник факта оплаты — это
   уведомление шлюза, подпись которого проверена по HMAC.

   Правило ответа шлюзу: HTTP 200 и {"code":0}. Любой другой
   HTTP-код заставит TipTop повторять уведомление.
   ============================================================ */
require __DIR__ . '/_lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$c    = cfg();
$type = strtolower(preg_replace('/[^a-z]/i', '', (string)($_GET['type'] ?? '')));
$allowed = ['check', 'pay', 'fail', 'confirm', 'refund', 'cancel', 'recurrent'];
if (!in_array($type, $allowed, true)) { http_response_code(400); echo '{"code":13}'; exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { http_response_code(405); echo '{"code":13}'; exit; }

/* ---------- 1. Подпись ----------
   Шлюз шлёт два заголовка: X-Content-HMAC считается от URL-decoded
   параметров, Content-HMAC — от encoded. Сырое тело у нас encoded,
   поэтому сверяем обе версии и принимаем совпадение с любым. */
$raw = file_get_contents('php://input', false, null, 0, 65536);
$secret = (string)($c['TIPTOP_API_SECRET'] ?? '');
if ($secret === '') { tt_log($type, 'no_secret', []); http_response_code(500); echo '{"code":13}'; exit; }

$got = [];
foreach (['HTTP_X_CONTENT_HMAC', 'HTTP_CONTENT_HMAC', 'HTTP_X_API_SIGNATURE'] as $h) {
  $v = trim((string)($_SERVER[$h] ?? ''));
  if ($v !== '') $got[] = $v;
}
$want = [
  base64_encode(hash_hmac('sha256', $raw, $secret, true)),
  base64_encode(hash_hmac('sha256', urldecode($raw), $secret, true)),
];
$sigOk = false;
foreach ($got as $g) foreach ($want as $w) if (hash_equals($w, $g)) $sigOk = true;

if (!$sigOk) {
  /* Настоящий TipTop всегда подписывает. Значит это подделка —
     отвечаем 403 и ничего не пишем в базу. */
  tt_log($type, 'bad_signature', ['ip' => client_ip(), 'headers' => count($got),
    'self' => (($_SERVER['REMOTE_ADDR'] ?? '') === ($_SERVER['SERVER_ADDR'] ?? ''))]);
  http_response_code(403); echo '{"code":13}'; exit;
}

/* ---------- 2. Разбор полей ---------- */
parse_str($raw, $f);
$txn      = trim((string)($f['TransactionId'] ?? ''));
$amount   = (float)str_replace(',', '.', (string)($f['Amount'] ?? '0'));
$currency = strtoupper(trim((string)($f['Currency'] ?? '')));
$lead     = trim((string)($f['InvoiceId'] ?? ''));
$email    = trim((string)($f['Email'] ?? ''));
$account  = trim((string)($f['AccountId'] ?? ''));   // кабинет кладёт сюда почту пользователя
$status   = trim((string)($f['Status'] ?? ''));
$test     = ((string)($f['TestMode'] ?? '0')) === '1';
$reason   = clean_txt((string)($f['Reason'] ?? ''), 120);

/* Прайс сайта. Сумма из уведомления должна совпасть с одной из позиций —
   иначе кто-то подменил amount в виджете на 10 ₸ за отчёт. */
$PRICES = [4000 => 'report', 15000 => 'consult', 35000 => 'package', 4990 => 'pro_month', 14900 => 'pro_season'];
$sum    = (int)round($amount);
$kind   = $PRICES[$sum] ?? null;
$leadOk = ($lead !== '' && strlen($lead) >= 8 && strlen($lead) <= 64);

tt_log($type, 'in', ['txn' => $txn, 'lead' => $lead, 'amount' => $amount, 'cur' => $currency, 'status' => $status, 'test' => $test]);

/* ---------- 3. check: разрешить или отклонить платёж ----------
   Коды: 0 — можно проводить, 10 — неверный номер заказа,
   11 — неверный AccountId, 12 — неверная сумма, 13 — не принимаем. */
if ($type === 'check') {
  /* Отклоняем ТОЛЬКО по сумме и валюте. Отсутствие номера заказа — не повод
     завернуть деньги: так оплачиваются платёжные ссылки из ЛК TipTop, где
     InvoiceId не задан. Такой платёж просто ляжет в журнал payments,
     а владельцу придёт письмо «привязать вручную». */
  if ($currency === 'KZT' && $kind !== null) { echo '{"code":0}'; exit; }
  tt_finish('{"code":12}');
  /* Отказ на check — это несостоявшаяся продажа. Чаще всего причина не
     во взломе, а в том, что цену поменяли в js/config.js и забыли в $PRICES.
     Поэтому владельцу пишем сразу, а не ждём, пока он заметит тишину. */
  tt_log('check', 'declined', ['code' => 12, 'txn' => $txn, 'lead' => $lead, 'amount' => $amount, 'cur' => $currency]);
  if (tt_once('checkfail-' . $sum . '-' . $currency . '-' . gmdate('Y-m-d'))) {
    notify_owner('Платёж отклонён на проверке — оплата не прошла', [
      'Причина'    => 'сумма или валюта не из прайса',
      'Сумма'      => $amount . ' ' . clean_txt($currency, 8),
      'ID лида'    => clean_txt($lead, 64) ?: '—',
      'Транзакция' => clean_txt($txn, 32) ?: '—',
      'Что делать' => 'сверить цены в js/config.js и в списке $PRICES в api/tiptop.php',
    ]);
  }
  exit;
}

/* ---------- 4. pay / fail ---------- */
if ($type === 'pay' || $type === 'confirm' || $type === 'recurrent') {
  $isPro = ($kind === 'pro_month' || $kind === 'pro_season');

  /* ---- подписка Pro: продлеваем доступ владельцу аккаунта ---- */
  if ($isPro && $currency === 'KZT') {
    $who  = filter_var($account, FILTER_VALIDATE_EMAIL) ? $account : $email;
    $plan = $kind === 'pro_season' ? 'season' : 'month';
    $r    = tt_rpc('tiptop_grant_pro', ['p_email' => $who, 'p_txn' => (string)$txn,
             'p_amount' => $sum, 'p_plan' => $plan, 'p_test' => $test]);
    $granted = is_array($r) && !empty($r['ok']);
    tt_finish('{"code":0}');
    if (tt_once('pro-' . $txn)) {
      if (!$test) tt_api_event('CompletePayment', ['value' => $sum, 'currency' => 'KZT', 'contents' => [['content_id' => $kind, 'content_type' => 'product', 'price' => $sum, 'quantity' => 1]]], ['email' => $who, 'external_id' => (string)$txn, 'url' => 'https://scholary.kz/cabinet/'], 'pay_' . $txn);
      notify_owner($test ? 'Оплачена подписка Pro (ТЕСТ)' : 'Оплачена подписка Pro', [
        'Сумма'      => number_format($sum, 0, '.', ' ') . ' ₸',
        'План'       => $plan === 'season' ? 'сезон (183 дня)' : 'месяц (31 день)',
        'Аккаунт'    => clean_txt($who, 120) ?: '—',
        'Транзакция' => clean_txt($txn, 32) ?: '—',
        'Режим'      => $test ? 'тестовый' : 'боевой',
        'Доступ'     => $granted ? 'выдан до ' . clean_txt((string)($r['pro_until'] ?? '?'), 20)
                                 : 'НЕ ВЫДАН — аккаунта с такой почтой нет, выдать вручную: select grant_pro(\'почта\', 183)',
      ]);
    }
    exit;
  }

  /* ---- разовые покупки: отчёт, консультация, пакет ---- */
  if ($kind !== null && $currency === 'KZT') {
    /* Лид может отсутствовать: так приходят оплаты по платёжной ссылке.
       Деньги всё равно записываем и зовём владельца привязать заказ. */
    $res = $leadOk ? tt_mark($lead, $txn, $sum, $email, $kind, 'success', $test) : null;
    tt_rpc('tiptop_log_payment', ['p_txn' => (string)$txn, 'p_lead' => $leadOk ? $lead : null, 'p_email' => $email,
      'p_amount' => $sum, 'p_kind' => $kind, 'p_status' => 'success', 'p_test' => $test]);
    /* Шлюзу отвечаем СРАЗУ: письмо и WhatsApp занимают до 40 секунд,
       за это время TipTop успел бы посчитать обработчик недоступным
       и начать слать повторы. */
    tt_finish('{"code":0}');

    /* Куплен отчёт — выдаём его СРАЗУ, не дожидаясь человека:
       строка в reports создаётся из снимка расчёта (leads.result),
       ссылка уходит на WhatsApp и почту. Повтор уведомления шлюза
       второй отчёт не создаст — RPC идемпотентна. */
    $repNote = null; // строка «Отчёт» в уведомлении — только для покупки отчёта
    if ($kind === 'report' && $leadOk) {
      $rep = tt_rpc('tiptop_issue_report', ['p_lead' => $lead]);
      if (is_array($rep) && !empty($rep['ok']) && !empty($rep['token'])) {
        $sentR = ['whatsapp' => false, 'email' => false];
        if (tt_once('report-' . $txn)) {
          /* Тестовый платёж (терминал в test-режиме, карта 4242…) не должен
             выдавать бесплатный отчёт клиенту: ссылка уходит только владельцу. */
          $toWa   = $test ? (string)($c['OWNER_WA'] ?? '') : (string)($rep['whatsapp'] ?? '');
          $toMail = $test ? (string)($c['MAIL_TO'] ?? '')  : (string)($rep['email'] ?? ($email ?: ''));
          $sentR = tt_send_report(
            (string)($rep['name'] ?? ''),
            $toWa, $toMail,
            (string)$rep['token'], $test);
          tt_rpc('tiptop_mark_report_sent', ['p_lead' => $lead,
            'p_wa' => $sentR['whatsapp'] ? 'sent' : 'failed',
            'p_email' => $sentR['email'] ? 'sent' : 'failed']);
          tt_log('pay', 'report_issued', ['lead' => $lead, 'txn' => $txn,
            'existing' => !empty($rep['existing']), 'wa' => $sentR['whatsapp'], 'mail' => $sentR['email']]);
        }
        $repNote = 'выдан автоматически · WhatsApp: ' . ($sentR['whatsapp'] ? 'ушёл' : 'НЕ УШЁЛ')
                 . ' · почта: ' . ($sentR['email'] ? 'ушла' : 'НЕ УШЛА');
      } else {
        $why = is_array($rep) ? (string)($rep['why'] ?? 'rpc_failed') : 'rpc_failed';
        $repNote = $why === 'no_result'
          ? 'НЕ ВЫДАН — нет снимка расчёта (старый лид), собрать вручную'
          : 'НЕ ВЫДАН (' . clean_txt($why, 40) . ') — собрать вручную';
        tt_log('pay', 'report_not_issued', ['lead' => $lead, 'txn' => $txn, 'why' => $why]);
      }
    } elseif ($kind === 'report') {
      $repNote = 'НЕ ВЫДАН — оплата без ID заявки (платёжная ссылка), привязать вручную';
    }

    if (tt_once('paid-' . $txn)) {
      if (!$test) tt_api_event('CompletePayment', ['value' => $sum, 'currency' => 'KZT', 'contents' => [['content_id' => $kind, 'content_type' => 'product', 'price' => $sum, 'quantity' => 1]]], ['email' => $email, 'external_id' => (string)$txn, 'url' => 'https://scholary.kz/quiz/'], 'pay_' . $txn);
      notify_owner($test ? 'Оплата прошла (ТЕСТ)' : 'Оплата прошла', [
        'Сумма'      => number_format($sum, 0, '.', ' ') . ' ₸',
        'За что'     => tt_kind_ru($kind),
        'Почта'      => clean_txt($email, 120) ?: '—',
        'ID лида'    => $leadOk ? clean_txt($lead, 64) : 'нет — оплата по ссылке, привязать вручную',
        'Транзакция' => clean_txt($txn, 32) ?: '—',
        'Режим'      => $test ? 'тестовый' : 'боевой',
        'В базе'     => $res === null ? 'записано в журнал платежей' : ($res ? 'отмечено' : 'НЕ ОТМЕЧЕНО — проверить вручную'),
      ] + ($repNote !== null ? ['Отчёт' => $repNote] : []));
    }
  } else {
    /* Деньги пришли, но заказ не сходится с прайсом — не теряем: пишем в лог
       и зовём владельца руками. Шлюзу всё равно отвечаем 0, иначе он будет
       повторять уведомление бесконечно. */
    tt_log($type, 'mismatch', ['txn' => $txn, 'lead' => $lead, 'amount' => $amount]);
    tt_finish('{"code":0}');
    if (tt_once('mismatch-' . $txn)) {
      notify_owner('Оплата с непонятной суммой — разобрать', [
        'Сумма' => $amount . ' ' . $currency, 'ID лида' => clean_txt($lead, 64) ?: '—',
        'Транзакция' => clean_txt($txn, 32) ?: '—',
      ]);
    }
  }
  exit;
}

if ($type === 'fail') {
  if ($leadOk) tt_mark($lead, $txn, $sum, $email, $kind, 'fail', $test);
  tt_log('fail', 'declined', ['txn' => $txn, 'lead' => $lead, 'reason' => $reason]);
  echo '{"code":0}'; exit;
}

/* ---------- 5. возврат ----------
   Возврат делает владелец руками в ЛК TipTop. Наша задача — снять
   ровно то, что выдал исходный платёж: отчёт или дни подписки.
   Частичный возврат доступ не снимает. */
if ($type === 'refund') {
  $orig = trim((string)($f['PaymentTransactionId'] ?? ''));
  $r = tt_rpc('tiptop_refund', ['p_orig_txn' => $orig, 'p_refund_txn' => (string)$txn, 'p_amount' => $amount]);
  tt_finish('{"code":0}');
  tt_log('refund', 'done', ['orig' => $orig, 'refund' => $txn, 'amount' => $amount, 'res' => is_array($r) ? $r : null]);
  if (tt_once('refund-' . $txn)) {
    $what = is_array($r) ? $r : [];
    notify_owner($test ? 'Возврат денег (ТЕСТ)' : 'Возврат денег', [
      'Сумма'      => number_format((float)$amount, 0, '.', ' ') . ' ₸',
      'За что'     => tt_kind_ru((string)($what['kind'] ?? '')) ?: '—',
      'Транзакция' => clean_txt((string)$orig, 32) ?: '—',
      'Доступ'     => !empty($what['partial']) ? 'частичный возврат — доступ оставлен'
                    : (!empty($what['ok']) ? 'снят' : 'НЕ СНЯТ — платежа нет в журнале, разобрать вручную'),
      'ID лида'    => clean_txt((string)($what['lead'] ?? ''), 64) ?: '—',
    ]);
  }
  exit;
}

/* cancel — отмена холда двухстадийного платежа. Мы работаем по Single,
   поэтому сюда попадать не должны; фиксируем и зовём человека. */
tt_log($type, 'noted', ['txn' => $txn, 'lead' => $lead, 'amount' => $amount]);
tt_finish('{"code":0}');
if (tt_once($type . '-' . $txn)) {
  notify_owner('Отмена платежа — посмотреть', [
    'Тип'        => clean_txt($type, 20),
    'Сумма'      => $amount . ' ' . clean_txt($currency, 8),
    'Транзакция' => clean_txt($txn, 32) ?: '—',
    'ID лида'    => clean_txt($lead, 64) ?: '—',
  ]);
}

/* ============================================================ */

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
    $r = http_json('https://api.green-api.com/waInstance' . $c['GREEN_ID'] . '/sendMessage/' . $c['GREEN_TOKEN'],
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
    $r = http_json('https://api.resend.com/emails', 'POST', [
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

function tt_log($type, $what, $data) {
  $dir = dirname($_SERVER['DOCUMENT_ROOT']) . '/private/tiptop';
  if (!is_dir($dir)) @mkdir($dir, 0700, true);
  $line = json_encode(['t' => gmdate('c'), 'type' => $type, 'what' => $what] + $data, JSON_UNESCAPED_UNICODE);
  @file_put_contents($dir . '/log-' . gmdate('Y-m') . '.jsonl', $line . "\n", FILE_APPEND | LOCK_EX);
}
