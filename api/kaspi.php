<?php
/* ============================================================
   Scholary · оплата через Kaspi (ApiPay.kz — счёт на номер телефона).

   POST ?a=create  {kind, phone, email, lead?, account?, name?}
        kind: report (нужен lead) · consult / package (нужны phone+email,
        name по желанию) · pro_month / pro_season (нужен account)
        → выставляем счёт в Kaspi на номер, отвечаем {order, status}.
          Покупатель видит счёт в приложении Kaspi (Платежи → Счета).
   GET  ?a=status&o=<order>
        → текущее состояние счёта. Если вебхук ещё не дошёл, сами
          спрашиваем ApiPay (GET /invoices/{id}) и, увидев paid,
          выдаём покупку — так «после оплаты ничего не произошло»
          невозможно даже при мёртвом вебхуке.

   Заказ хранится файлом /private/kaspi/orders/<order>.json — единственный
   мост между «кто платит» и «что купил»: в Kaspi уходит только сумма,
   описание и номер, персональные данные там не нужны.
   Ключ API и секрет вебхука лежат в /private/apipay-secrets.php.
   ============================================================ */
require __DIR__ . '/_kaspi.php';
cors();
header('Cache-Control: no-store');

$c = cfg();
$a = (string)($_GET['a'] ?? '');
$KINDS = ['report', 'consult', 'package', 'pro_month', 'pro_season'];

if (!same_origin()) jout(['error' => 'forbidden'], 403);
if (empty($c['APIPAY_KEY'])) jout(['ok' => false, 'why' => 'kaspi_off'], 503);

/* ---------- создать счёт ---------- */
if ($a === 'create') {
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') jout(['error' => 'method'], 405);
  /* Рубильник: APIPAY_ENABLED в /private/apipay-secrets.php. Выключен —
     новые счета не выставляем (кнопка честно говорит «Kaspi временно
     недоступен»), а статус уже выставленных и вебхук работают как обычно. */
  if (empty($c['APIPAY_ENABLED'])) jout(['ok' => false, 'why' => 'kaspi_off'], 503);
  $in    = body(4000);
  $kind  = (string)($in['kind'] ?? '');
  $phone = wa_digits((string)($in['phone'] ?? ''));
  $email = trim((string)($in['email'] ?? ''));
  $lead  = trim((string)($in['lead'] ?? ''));
  $acc   = trim((string)($in['account'] ?? ''));
  $name  = clean_txt((string)($in['name'] ?? ''), 60);
  $isPro = ($kind === 'pro_month' || $kind === 'pro_season');
  $isSvc = ($kind === 'consult' || $kind === 'package');
  if (!in_array($kind, $KINDS, true)) jout(['ok' => false, 'why' => 'bad_kind'], 400);
  if ($phone === null) jout(['ok' => false, 'why' => 'bad_phone'], 400);
  if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) jout(['ok' => false, 'why' => 'bad_email'], 400);
  if ($kind === 'report' && !preg_match('/^[A-Za-z0-9_-]{8,64}$/', $lead)) jout(['ok' => false, 'why' => 'bad_lead'], 400);
  if ($isSvc && $lead !== '' && !preg_match('/^[A-Za-z0-9_-]{8,64}$/', $lead)) $lead = '';   /* необязательная привязка к заявке квиза */
  if ($isSvc && $email === '') jout(['ok' => false, 'why' => 'bad_email'], 400);              /* подтверждение уходит и на почту */
  if ($isPro && !filter_var($acc, FILTER_VALIDATE_EMAIL)) jout(['ok' => false, 'why' => 'bad_account'], 400);
  $sum = pay_price_of($kind);
  if ($sum <= 0) jout(['ok' => false, 'why' => 'bad_kind'], 400);

  /* Один живой счёт на (заявка, товар, номер): повторное нажатие не плодит
     счета и не тратит лимит. */
  $dupKey = kaspi_dupkey($kind, $lead !== '' ? $lead : ($acc !== '' ? $acc : $email), $phone);
  $prev = kaspi_order_by_key($dupKey);
  if ($prev && in_array($prev['status'], ['processing', 'pending'], true) && time() - (int)$prev['created'] < 23 * 3600) {
    kaspi_log('create', 'reuse', ['order' => $prev['order'], 'kind' => $kind]);
    jout(['ok' => true, 'order' => $prev['order'], 'status' => $prev['status'], 'reused' => true, 'amount' => $sum, 'phone' => $phone]);
  }
  /* Уже оплачено за последние сутки (отчёт по этой заявке или Pro на этот
     аккаунт): человек перезагрузил страницу до экрана «оплачено» и нажал
     снова. Второй счёт выставлять нельзя — отдаём оплаченный заказ, экран
     сразу покажет результат и ссылку на отчёт. Консультация и пакет —
     отдельные покупки, для них правило не действует. */
  if ($prev && in_array($prev['status'], ['paid', 'partially_refunded'], true) && ($kind === 'report' || $isPro) && time() - (int)$prev['created'] < 24 * 3600) {
    kaspi_log('create', 'reuse_paid', ['order' => $prev['order'], 'kind' => $kind]);
    jout(['ok' => true, 'order' => $prev['order'], 'status' => 'paid', 'reused' => true, 'paid_before' => true, 'amount' => $sum, 'phone' => $phone,
      'fulfilled' => !empty($prev['fulfilled']), 'report_url' => !empty($prev['report_token']) ? 'https://scholary.kz/report/?t=' . rawurlencode((string)$prev['report_token']) : null]);
  }
  /* Защита от перебора и спама счетами: 6 счетов в сутки на (IP, номер) —
     и 40 на IP, потому что мобильные операторы сажают тысячи людей на один адрес. */
  $rl = rate_check('kaspi:' . client_ip() . '|' . $phone, 6);
  if ($rl['ok']) $rl = rate_check('kaspi-ip:' . client_ip(), 40);
  if (!$rl['ok']) jout(['ok' => false, 'why' => 'rate'], 429);

  $order = 'k' . bin2hex(random_bytes(8));
  $DESC  = ['report' => 'Scholary: отчёт о вероятности поступления', 'consult' => 'Scholary: разбор со специалистом',
            'package' => 'Scholary: документы и подача', 'pro_season' => 'Scholary Pro на сезон', 'pro_month' => 'Scholary Pro на месяц'];
  $desc  = $DESC[$kind];
  $r = kaspi_api('POST', '/invoices', [
    'phone_number' => (strlen($phone) === 11 && $phone[0] === '7') ? '8' . substr($phone, 1) : $phone,   /* ApiPay ждёт 8XXXXXXXXXX */
    'amount' => $sum,
    'description' => $desc,                                   /* Kaspi показывает первые 60 символов */
    'internal_comment' => 'scholary ' . $kind . ($lead !== '' ? ' lead=' . $lead : '') . ($acc !== '' ? ' acc=' . $acc : ''),
    'external_order_id' => $order,
    'external_order_id_idempotency' => $order,
  ]);
  $j = is_array($r['json']) ? $r['json'] : [];
  if ($r['code'] !== 201 && $r['code'] !== 200) {
    $why = (string)($j['error_code'] ?? $j['error'] ?? ('http_' . $r['code']));
    kaspi_log('create', 'failed', ['code' => $r['code'], 'why' => $why, 'kind' => $kind]);
    /* Кассир Kaspi отвалился или тариф ApiPay кончился — владельцу знать сразу */
    if (in_array($why, ['kaspi_session_expired', 'tariff_inactive', 'kyc_rejected'], true) && tt_once('kaspi-down-' . $why . '-' . gmdate('Y-m-d'))) {
      notify_owner('Kaspi-оплата не работает: ' . $why, ['Что' => 'ApiPay отказал выставить счёт', 'Код' => $why,
        'Что делать' => $why === 'tariff_inactive' ? 'продлить тариф в кабинете apipay.kz' : 'переподключить кассира Kaspi в кабинете apipay.kz (Настройки → Авторизация Kaspi)']);
    }
    $code = $r['code'] === 429 ? 429 : ($r['code'] >= 500 || $r['code'] === 0 ? 503 : 400);
    jout(['ok' => false, 'why' => $why, 'message' => clean_txt((string)($j['message'] ?? ''), 200)], $code);
  }
  if ((int)($j['id'] ?? 0) <= 0) {
    /* 2xx без номера счёта — так не бывает, но без id заказ нельзя ни опросить, ни сверить */
    kaspi_log('create', 'no_id', ['kind' => $kind, 'body' => substr((string)$r['body'], 0, 200)]);
    jout(['ok' => false, 'why' => 'http_noid'], 503);
  }
  $rec = [
    'order' => $order, 'invoice_id' => (int)($j['id'] ?? 0), 'kind' => $kind, 'amount' => $sum,
    'phone' => $phone, 'email' => $email, 'lead' => $lead, 'account' => $acc, 'name' => $name,
    'status' => (string)($j['status'] ?? 'processing'), 'is_sandbox' => !empty($j['is_sandbox']),
    'created' => time(), 'updated' => time(), 'checked' => 0, 'fulfilled' => false,
    'kaspi_invoice_id' => (string)($j['kaspi_invoice_id'] ?? ''), 'error_code' => '', 'error_message' => '',
    'dupkey' => $dupKey, 'ip' => client_ip(),
    /* для события CompletePayment в TikTok: оплата придёт вебхуком без браузера */
    'ua' => substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200),
    'ttclid' => substr(preg_replace('/[^A-Za-z0-9._\-]/', '', (string)($in['ttclid'] ?? ($_COOKIE['ttclid'] ?? ''))), 0, 200),
  ];
  kaspi_order_save($rec);
  kaspi_log('create', 'ok', ['order' => $order, 'invoice' => $rec['invoice_id'], 'kind' => $kind, 'sum' => $sum, 'sandbox' => $rec['is_sandbox']]);
  jout(['ok' => true, 'order' => $order, 'status' => $rec['status'], 'amount' => $sum, 'phone' => $phone, 'sandbox' => $rec['is_sandbox']]);
}

/* ---------- фоновая выдача (самозапрос из вебхука или опроса) ---------- */
if ($a === 'fulfill') {
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') jout(['error' => 'method'], 405);
  $in = body(2000);
  $order = (string)($in['order'] ?? ''); $sig = (string)($in['sig'] ?? '');
  if (!preg_match('/^k[0-9a-f]{16}$/', $order)) jout(['ok' => false, 'why' => 'bad_order'], 400);
  $want = hash_hmac('sha256', 'fulfill|' . $order, (string)($c['APIPAY_WEBHOOK_SECRET'] ?? ''));
  if (empty($c['APIPAY_WEBHOOK_SECRET']) || !hash_equals($want, $sig)) jout(['ok' => false, 'why' => 'bad_sig'], 403);
  ignore_user_abort(true); @set_time_limit(240);
  $rec = kaspi_order_load($order);
  if (!$rec) jout(['ok' => false, 'why' => 'not_found'], 404);
  if (in_array($rec['status'], ['paid', 'partially_refunded'], true) && empty($rec['fulfilled'])) kaspi_fulfill($rec, (string)($in['via'] ?? 'async'));
  if (!empty($rec['deliver_pending'])) kaspi_deliver_retry($rec, (string)($in['via'] ?? 'async'));
  jout(['ok' => true, 'fulfilled' => !empty($rec['fulfilled'])]);
}

/* ---------- статус счёта ---------- */
if ($a === 'status') {
  $order = (string)($_GET['o'] ?? '');
  if (!preg_match('/^k[0-9a-f]{16}$/', $order)) jout(['ok' => false, 'why' => 'bad_order'], 400);
  $rec = kaspi_order_load($order);
  if (!$rec) jout(['ok' => false, 'why' => 'not_found'], 404);
  $terminal = ['paid', 'cancelled', 'expired', 'error', 'partially_refunded'];
  /* Не терминальный и давно не проверяли — спрашиваем ApiPay сами.
     Лимит на этот GET у них 1000/мин, но нам хватит раза в 4 секунды. */
  if (!in_array($rec['status'], $terminal, true) && time() - (int)$rec['checked'] >= 4 && $rec['invoice_id'] > 0) {
    $r = kaspi_api('GET', '/invoices/' . (int)$rec['invoice_id'], null, 6);   /* короткий таймаут: опрос идёт раз в 3–4 с */
    $rec['checked'] = time();
    if (($r['code'] === 200) && is_array($r['json'])) {
      kaspi_apply_invoice($rec, $r['json'], 'poll');
    } else {
      kaspi_order_save($rec);
    }
  }
  /* Оплата найдена поллингом раньше вебхука: выдачу запускаем фоном,
     клиенту отвечаем сразу. Пока идёт пауза между повторами (база молчала) —
     самозапрос не дёргаем. */
  $isPaid = in_array($rec['status'], ['paid', 'partially_refunded'], true);
  if ($isPaid && empty($rec['fulfilled']) && (empty($rec['fulfill_retry_after']) || time() >= (int)$rec['fulfill_retry_after'])) kaspi_fulfill_async($rec, 'poll');
  if (!empty($rec['deliver_pending'])) kaspi_deliver_retry($rec, 'poll');
  /* Ссылку на отчёт видит только тот, кто знает номер заказа (случайные 16 hex,
     известны лишь браузеру, выставившему счёт) — это его же покупка. */
  $reportUrl = ($isPaid && !empty($rec['fulfilled']) && !empty($rec['report_token'])) ? 'https://scholary.kz/report/?t=' . rawurlencode((string)$rec['report_token']) : null;
  $dl = is_array($rec['deliver'] ?? null) ? ['wa' => !empty($rec['deliver']['wa']), 'mail' => !empty($rec['deliver']['mail'])] : null;
  jout(['ok' => true, 'order' => $order, 'status' => $rec['status'], 'kind' => $rec['kind'], 'amount' => $rec['amount'],
    'error_code' => (string)$rec['error_code'], 'error_message' => (string)$rec['error_message'],
    'age' => time() - (int)$rec['created'], 'fulfilled' => !empty($rec['fulfilled']),
    'report_url' => $reportUrl, 'delivered' => $dl, 'retrying' => ($isPaid && empty($rec['fulfilled']) && ($rec['fulfill_note'] ?? '') === 'db_failed')]);
}

jout(['error' => 'bad_action'], 400);
