<?php
/* ============================================================
   Scholary · оплата через Kaspi (ApiPay.kz — счёт на номер телефона).

   POST ?a=create  {kind, phone, email, lead?, account?}
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
$KINDS = ['report', 'pro_month', 'pro_season'];

if (!same_origin()) jout(['error' => 'forbidden'], 403);
if (empty($c['APIPAY_KEY'])) jout(['ok' => false, 'why' => 'kaspi_off'], 503);

/* ---------- создать счёт ---------- */
if ($a === 'create') {
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') jout(['error' => 'method'], 405);
  $in    = body(4000);
  $kind  = (string)($in['kind'] ?? '');
  $phone = wa_digits((string)($in['phone'] ?? ''));
  $email = trim((string)($in['email'] ?? ''));
  $lead  = trim((string)($in['lead'] ?? ''));
  $acc   = trim((string)($in['account'] ?? ''));
  if (!in_array($kind, $KINDS, true)) jout(['ok' => false, 'why' => 'bad_kind'], 400);
  if ($phone === null) jout(['ok' => false, 'why' => 'bad_phone'], 400);
  if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) jout(['ok' => false, 'why' => 'bad_email'], 400);
  if ($kind === 'report' && !preg_match('/^[A-Za-z0-9_-]{8,64}$/', $lead)) jout(['ok' => false, 'why' => 'bad_lead'], 400);
  if ($kind !== 'report' && !filter_var($acc, FILTER_VALIDATE_EMAIL)) jout(['ok' => false, 'why' => 'bad_account'], 400);
  $sum = pay_price_of($kind);
  if ($sum <= 0) jout(['ok' => false, 'why' => 'bad_kind'], 400);

  /* Защита от перебора и от случайного спама счетами одному человеку:
     10 счетов в сутки с одного IP, и один живой счёт на (заявка, товар, номер). */
  $rl = rate_check('kaspi:' . client_ip(), 10);
  if (!$rl['ok']) jout(['ok' => false, 'why' => 'rate'], 429);
  $dupKey = kaspi_dupkey($kind, $lead !== '' ? $lead : $acc, $phone);
  $prev = kaspi_order_by_key($dupKey);
  if ($prev && in_array($prev['status'], ['processing', 'pending'], true) && time() - (int)$prev['created'] < 23 * 3600) {
    kaspi_log('create', 'reuse', ['order' => $prev['order'], 'kind' => $kind]);
    jout(['ok' => true, 'order' => $prev['order'], 'status' => $prev['status'], 'reused' => true, 'amount' => $sum, 'phone' => $phone]);
  }

  $order = 'k' . bin2hex(random_bytes(8));
  $desc  = $kind === 'report' ? 'Scholary: отчёт о вероятности поступления'
         : ($kind === 'pro_season' ? 'Scholary Pro на сезон' : 'Scholary Pro на месяц');
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
  $rec = [
    'order' => $order, 'invoice_id' => (int)($j['id'] ?? 0), 'kind' => $kind, 'amount' => $sum,
    'phone' => $phone, 'email' => $email, 'lead' => $lead, 'account' => $acc,
    'status' => (string)($j['status'] ?? 'processing'), 'is_sandbox' => !empty($j['is_sandbox']),
    'created' => time(), 'updated' => time(), 'checked' => 0, 'fulfilled' => false,
    'kaspi_invoice_id' => (string)($j['kaspi_invoice_id'] ?? ''), 'error_code' => '', 'error_message' => '',
    'dupkey' => $dupKey, 'ip' => client_ip(),
  ];
  kaspi_order_save($rec);
  kaspi_log('create', 'ok', ['order' => $order, 'invoice' => $rec['invoice_id'], 'kind' => $kind, 'sum' => $sum, 'sandbox' => $rec['is_sandbox']]);
  jout(['ok' => true, 'order' => $order, 'status' => $rec['status'], 'amount' => $sum, 'phone' => $phone, 'sandbox' => $rec['is_sandbox']]);
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
    $r = kaspi_api('GET', '/invoices/' . (int)$rec['invoice_id']);
    $rec['checked'] = time();
    if (($r['code'] === 200) && is_array($r['json'])) {
      kaspi_apply_invoice($rec, $r['json'], 'poll');
    } else {
      kaspi_order_save($rec);
    }
  }
  $needFulfill = ($rec['status'] === 'paid' && empty($rec['fulfilled']));
  $resp = json_encode(['ok' => true, 'order' => $order, 'status' => $rec['status'], 'kind' => $rec['kind'], 'amount' => $rec['amount'],
    'error_code' => (string)$rec['error_code'], 'error_message' => (string)$rec['error_message'],
    'age' => time() - (int)$rec['created'], 'fulfilled' => !empty($rec['fulfilled']) || $needFulfill], JSON_UNESCAPED_UNICODE);
  header('Content-Type: application/json; charset=utf-8');
  if (!$needFulfill) { echo $resp; exit; }
  /* Оплата найдена поллингом раньше вебхука: клиенту отвечаем сразу,
     а отчёт/доступ выдаём уже после закрытия соединения (до 40 секунд). */
  tt_finish($resp);
  kaspi_fulfill($rec, 'poll');
  exit;
}

jout(['error' => 'bad_action'], 400);
