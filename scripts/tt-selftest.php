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
  '4_check_no_lead'   => send($base . 'check', ['InvoiceId' => ''] + $f, $secret),
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
$out['lead'] = $lead;
$out['txn']  = $txn;
$out['expected'] = [
  '1_check_ok' => '200 {"code":0}', '2_check_bad_sig' => '403 {"code":13}',
  '3_check_bad_amount' => '200 {"code":12}', '4_check_no_lead' => '200 {"code":10}',
  '5_pay_ok' => '200 {"code":0}', '6_pay_retry' => '200 {"code":0}',
];
jout($out);
