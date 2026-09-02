<?php
/* Scholary · разовая самопроверка эквайринга.
   Собирает уведомление ровно так, как его шлёт TipTop (form-urlencoded +
   заголовок X-Content-HMAC), подписывает НАСТОЯЩИМ ключом из конфига и
   отправляет самому себе. Так проверяется вся цепочка: подпись → сверка
   суммы → RPC в Supabase → отметка лида → уведомление владельцу.
   Файл временный: после проверки заменяется заглушкой. */
require __DIR__ . '/_lib.php';
header('Content-Type: application/json; charset=utf-8');

$c = cfg();
$secret = (string)($c['TIPTOP_API_SECRET'] ?? '');
if ($secret === '') jout(['error' => 'no_api_secret'], 500);

$lead = 'lead_selftest_0001';               // жёстко зашит: чужие лиды не тронуть
$base = 'https://scholary.kz/api/tiptop.php?type=';

function send($url, $fields, $secret, $badSig = false) {
  $body = http_build_query($fields);
  $sig  = base64_encode(hash_hmac('sha256', urldecode($body), $secret, true));
  if ($badSig) $sig = base64_encode(hash_hmac('sha256', 'nope', 'nope', true));
  $r = http_json($url, 'POST', [
    'Content-Type: application/x-www-form-urlencoded',
    'X-Content-HMAC: ' . $sig,
  ], $body, 25);
  return ['http' => $r['code'], 'body' => trim((string)$r['body'])];
}

$txn = 'selftest-' . gmdate('YmdHis');
$f = [
  'TransactionId' => $txn, 'Amount' => '4000.00', 'Currency' => 'KZT',
  'PaymentAmount' => '4000.00', 'PaymentCurrency' => 'KZT',
  'DateTime' => gmdate('Y-m-d H:i:s'), 'CardFirstSix' => '424242', 'CardLastFour' => '4242',
  'CardType' => 'Visa', 'CardExpDate' => '12/25', 'TestMode' => '1',
  'Status' => 'Completed', 'OperationType' => 'Payment',
  'InvoiceId' => $lead, 'Email' => (string)($c['MAIL_TO'] ?? ''),
  'Description' => 'Scholary — самопроверка эквайринга',
];

$out = [
  '1_check_ok'        => send($base . 'check', $f, $secret),
  '2_check_bad_sig'   => send($base . 'check', $f, $secret, true),
  '3_check_bad_amount'=> send($base . 'check', ['Amount' => '10.00'] + $f, $secret),
  '4_check_no_lead'   => send($base . 'check', ['InvoiceId' => ''] + $f, $secret),   // платёжная ссылка: пропускаем
  '5_pay_ok'          => send($base . 'pay',   $f, $secret),
  '6_pay_retry'       => send($base . 'pay',   $f, $secret),
];
/* Подписка Pro: шлюз вернёт почту в AccountId, сервер должен продлить доступ */
if (isset($_GET['pro'])) {
  $pf = ['Amount' => '4990.00', 'InvoiceId' => 'pro_selftest_0001',
         'AccountId' => (string)($c['MAIL_TO'] ?? ''), 'TransactionId' => 'selftestpro-' . gmdate('YmdHis')] + $f;
  $out['7_pay_pro_month'] = send($base . 'pay', $pf, $secret);
  $pf2 = ['Amount' => '14900.00', 'TransactionId' => 'selftestpro2-' . gmdate('YmdHis')] + $pf;
  $out['8_pay_pro_season'] = send($base . 'pay', $pf2, $secret);
  $pf3 = ['AccountId' => 'ne-suschestvuet-' . gmdate('His') . '@example.com',
          'TransactionId' => 'selftestpro3-' . gmdate('YmdHis')] + $pf;
  $out['9_pay_pro_no_account'] = send($base . 'pay', $pf3, $secret);
}
/* Возврат: должен снять доступ ровно по исходной транзакции */
if (isset($_GET['refund'])) {
  $rt = 'selftestref-' . gmdate('YmdHis');
  $rf = ['TransactionId' => $rt, 'PaymentTransactionId' => $txn, 'Amount' => '4000.00',
         'OperationType' => 'Refund', 'DateTime' => gmdate('Y-m-d H:i:s'), 'TestMode' => '1',
         'InvoiceId' => $lead, 'Email' => (string)($c['MAIL_TO'] ?? '')];
  $out['10_refund_full']    = send($base . 'refund', $rf, $secret);
  $out['11_refund_repeat']  = send($base . 'refund', $rf, $secret);
  $out['12_refund_unknown'] = send($base . 'refund', ['PaymentTransactionId' => 'net-takoy-' . gmdate('His'),
                               'TransactionId' => $rt . 'x'] + $rf, $secret);
}
/* Проверяем, что после оплаты отчёт реально создан и привязан к лиду.
   Секрет вебхука лежит в конфиге — им же зовём issue_report на сверку. */
$rpc = $c['SUPABASE_URL'] . '/rest/v1/rpc/tiptop_issue_report';
$rr = http_json($rpc, 'POST', [
  'apikey: ' . $c['SUPABASE_ANON'], 'Authorization: Bearer ' . $c['SUPABASE_ANON'],
  'Content-Type: application/json',
], ['p_secret' => (string)($c['TIPTOP_RPC_SECRET'] ?? ''), 'p_lead' => $lead], 20);
$rj = is_array($rr['json']) ? $rr['json'] : [];
$out['7_report_issued'] = [
  'http' => $rr['code'],
  'ok' => !empty($rj['ok']),
  'existing' => $rj['existing'] ?? null,
  'has_token' => !empty($rj['token']),
  'why' => $rj['why'] ?? null,
];

$out['lead'] = $lead;
$out['txn']  = $txn;
$out['expected'] = [
  '1_check_ok' => '200 {"code":0}', '2_check_bad_sig' => '403 {"code":13}',
  '3_check_bad_amount' => '200 {"code":12}', '4_check_no_lead' => '200 {"code":0} — оплата по ссылке без номера заказа',
  '5_pay_ok' => '200 {"code":0}', '6_pay_retry' => '200 {"code":0}',
  '7_report_issued' => 'ok=true, has_token=true, existing=true (повтор issue не задваивает)',
];
jout($out);
