<?php
/* ============================================================
   Scholary · вебхук ApiPay.kz (оплата через Kaspi).
   Адрес в кабинете ApiPay: https://scholary.kz/kaspi/webhook
   (.htaccess переписывает на этот файл).

   Правила ApiPay: подпись X-Webhook-Signature: sha256=<hex> — HMAC-SHA256
   от сырого тела секретом вебхука; отвечать 2xx быстро (≤5 с), тяжёлую
   работу делать после ответа; одно и то же событие может прийти повторно —
   дедупликация по (invoice.id, status). 4xx они не повторяют, поэтому
   подделку отбиваем 401, а «не наш» счёт подтверждаем 200, чтобы не
   копить ретраи.
   ============================================================ */
require __DIR__ . '/_kaspi.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { http_response_code(405); echo '{"ok":false,"error":"method"}'; exit; }

$c = cfg();
$secret = (string)($c['APIPAY_WEBHOOK_SECRET'] ?? '');
$raw = file_get_contents('php://input', false, null, 0, 65536);
if ($secret === '') { kaspi_log('webhook', 'no_secret', []); http_response_code(500); echo '{"ok":false,"error":"no_secret"}'; exit; }

/* ---------- 1. Подпись ---------- */
$sig = trim((string)($_SERVER['HTTP_X_WEBHOOK_SIGNATURE'] ?? ''));
$want = 'sha256=' . hash_hmac('sha256', $raw, $secret);
$sigOk = $sig !== '' && hash_equals($want, $sig);
if (!$sigOk && $sig !== '' && strncmp($sig, 'sha256=', 7) !== 0) $sigOk = hash_equals(hash_hmac('sha256', $raw, $secret), $sig);
if (!$sigOk) {
  kaspi_log('webhook', 'bad_signature', ['ip' => client_ip(), 'has_sig' => $sig !== '', 'len' => strlen($raw)]);
  http_response_code(401); echo '{"ok":false,"error":"bad_signature"}'; exit;
}

/* ---------- 2. Событие ---------- */
$j = json_decode($raw, true);
if (!is_array($j)) { kaspi_log('webhook', 'bad_json', ['len' => strlen($raw)]); http_response_code(400); echo '{"ok":false,"error":"bad_json"}'; exit; }
$event = (string)($j['event'] ?? '');

if ($event === 'webhook.test' || $event === '') {
  kaspi_log('webhook', 'test', ['event' => $event]);
  echo '{"ok":true,"test":true}'; exit;
}

/* Возвраты: снять доступ так же, как при возврате по карте. */
if ($event === 'invoice.refunded') {
  $inv = is_array($j['invoice'] ?? null) ? $j['invoice'] : [];
  $ref = is_array($j['refund'] ?? null) ? $j['refund'] : [];
  $invId = (int)($inv['id'] ?? 0);
  $rstat = (string)($ref['status'] ?? '');
  $ramt  = (float)($ref['amount'] ?? 0);
  tt_finish('{"ok":true}');
  if ($invId > 0 && $rstat === 'completed' && tt_once('kaspi-refund-' . (int)($ref['id'] ?? 0) . '-' . $rstat)) {
    $r = tt_rpc('tiptop_refund', ['p_orig_txn' => 'kaspi_' . $invId, 'p_refund_txn' => 'kaspi_refund_' . (int)($ref['id'] ?? 0), 'p_amount' => $ramt]);
    kaspi_log('webhook', 'refund', ['invoice' => $invId, 'amount' => $ramt, 'res' => is_array($r) ? $r : null]);
    $what = is_array($r) ? $r : [];
    notify_owner('Возврат денег · Kaspi', [
      'Сумма'      => number_format($ramt, 0, '.', ' ') . ' ₸',
      'За что'     => tt_kind_ru((string)($what['kind'] ?? '')) ?: '—',
      'Счёт ApiPay' => (string)$invId,
      'Доступ'     => !empty($what['partial']) ? 'частичный возврат — доступ оставлен'
                    : (!empty($what['ok']) ? 'снят' : 'НЕ СНЯТ — платежа нет в журнале, разобрать вручную'),
    ]);
  }
  exit;
}

if ($event !== 'invoice.status_changed' && $event !== 'invoice.qr_scanned') {
  /* подписки, чеки, смены — нам не нужны, но подтверждаем получение */
  kaspi_log('webhook', 'ignored', ['event' => $event]);
  echo '{"ok":true,"ignored":true}'; exit;
}

$inv = is_array($j['invoice'] ?? null) ? $j['invoice'] : [];
$invId  = (int)($inv['id'] ?? 0);
$status = (string)($inv['status'] ?? '');
$extId  = (string)($inv['external_order_id'] ?? '');
if ($invId <= 0) { kaspi_log('webhook', 'no_id', ['event' => $event]); echo '{"ok":true}'; exit; }

kaspi_log('webhook', 'in', ['event' => $event, 'invoice' => $invId, 'status' => $status, 'order' => $extId,
  'sandbox' => !empty($inv['is_sandbox']), 'amount' => (string)($inv['amount'] ?? '')]);

if ($event === 'invoice.qr_scanned') { echo '{"ok":true}'; exit; }

$rec = null;
if (preg_match('/^k[0-9a-f]{16}$/', $extId)) $rec = kaspi_order_load($extId);
if (!$rec) $rec = kaspi_order_by_invoice($invId);

/* Дедупликация по (invoice.id, status): повтор той же доставки — просто 200.
   Флаг ставим только когда заказ найден, чтобы сбой чтения не «съел» событие. */
if ($rec && !tt_once('kaspi-wh-' . $invId . '-' . $status)) { echo '{"ok":true,"dup":true}'; exit; }

if (!$rec) {
  /* Счёт выставлен не сайтом (вручную из кабинета ApiPay). Деньги видим,
     но что куплено — не знаем: зовём владельца. */
  tt_finish('{"ok":true,"unknown":true}');
  ignore_user_abort(true);
  if ($status === 'paid' && tt_once('kaspi-wh-unknown-' . $invId)) {
    notify_owner('Kaspi: оплачен счёт не с сайта — привязать вручную', [
      'Сумма' => (string)($inv['amount'] ?? '?') . ' ₸', 'Счёт ApiPay' => (string)$invId,
      'Kaspi-счёт' => clean_txt((string)($inv['kaspi_invoice_id'] ?? ''), 32) ?: '—',
      'Телефон' => clean_txt((string)($inv['client_phone'] ?? ''), 16) ?: '—',
      'Описание' => clean_txt((string)($inv['description'] ?? ''), 100) ?: '—',
    ]);
  }
  exit;
}

kaspi_apply_invoice($rec, $inv, 'webhook');

if ($rec['status'] === 'paid') {
  /* Выдача — в фоновом самозапросе (до 1.5 с), ответ ApiPay — сразу после. */
  kaspi_fulfill_async($rec, 'webhook');
  echo '{"ok":true}'; exit;
}
tt_finish('{"ok":true}');
if ($status === 'error') {
  /* Ошибка на стороне Kaspi (например, номер не в Kaspi) — покупатель
     увидит это на экране через поллинг; владельцу пишем один раз в день
     на случай системной проблемы. */
  if (tt_once('kaspi-error-' . (string)$rec['error_code'] . '-' . gmdate('Y-m-d'))) {
    notify_owner('Kaspi: счёт не выставился (' . clean_txt((string)$rec['error_code'], 40) . ')', [
      'Причина' => clean_txt((string)$rec['error_message'], 200) ?: '—', 'За что' => tt_kind_ru($rec['kind']),
      'Телефон' => '+' . clean_txt((string)$rec['phone'], 16), 'Заказ' => $rec['order'],
      'Что' => $rec['error_code'] === 'client_not_found' ? 'покупатель указал номер без Kaspi — на экране ему предложено ввести другой' : 'если повторяется — проверить кассира в кабинете apipay.kz',
    ]);
  }
}
exit;
