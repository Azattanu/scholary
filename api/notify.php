<?php
/* Scholary · уведомления владельцу о новой заявке.
   Вызывается с сайта сразу после формы заявки и после оплаты.
   Получатель ЖЁСТКО задан в конфиге (почта и WhatsApp Азата), поэтому
   эндпоинт нельзя использовать как чужой ретранслятор спама.
   Данные заявки приходят с клиента (у нас нет сервисного ключа Supabase),
   поэтому они чистятся и обрезаются, а частота ограничена по IP. */
require __DIR__ . '/_lib.php';
cors();
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') jout(['error' => 'method'], 405);

$c  = cfg();
$in = body(20000);

/* ---------- защита от флуда ---------- */
$ip  = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$ip  = trim(explode(',', $ip)[0]);
$rl  = rate_check('ip:' . $ip . ':notify', 12);
if (!$rl['ok']) jout(['error' => 'too_many'], 429);
$rlAll = rate_check('all:notify', 300);
if (!$rlAll['ok']) jout(['error' => 'paused'], 429);

/* ---------- разбор заявки ---------- */
function clean($v, $max = 200) {
  $v = is_string($v) ? $v : '';
  $v = preg_replace('/[\x00-\x1F\x7F]/u', ' ', $v);
  return trim(mb_substr($v, 0, $max));
}
$kind  = ($in['kind'] ?? 'lead') === 'paid' ? 'paid' : 'lead';
$name  = clean($in['name'] ?? '', 80);
$phone = clean($in['phone'] ?? '', 32);
$email = clean($in['email'] ?? '', 120);
$note  = clean($in['note'] ?? '', 600);
$lead  = clean($in['lead_id'] ?? '', 64);
$level = clean($in['level'] ?? '', 40);
$page  = clean($in['page'] ?? '', 120);
if ($name === '' && $phone === '' && $email === '') jout(['error' => 'empty'], 400);

$title = $kind === 'paid' ? 'Оплата прошла' : 'Новая заявка с сайта';
$rows  = [
  'Имя'       => $name ?: '—',
  'Телефон'   => $phone ?: '—',
  'Почта'     => $email ?: '—',
  'Уровень'   => $level ?: '—',
  'Страница'  => $page ?: '—',
  'Комментарий' => $note ?: '—',
  'ID лида'   => $lead ?: '—',
];
$plain = $title . "\n\n";
foreach ($rows as $k => $v) $plain .= $k . ': ' . $v . "\n";
$plain .= "\nВремя: " . date('d.m.Y H:i') . " (сервер)";

$sent = ['email' => false, 'whatsapp' => false];

/* ---------- письмо через Resend ---------- */
if (!empty($c['RESEND_KEY']) && !empty($c['MAIL_TO'])) {
  $html = '<div style="font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#1D1D1F">'
        . '<h2 style="margin:0 0 14px;font-size:19px">' . htmlspecialchars($title) . '</h2><table cellpadding="6" style="border-collapse:collapse">';
  foreach ($rows as $k => $v) {
    $html .= '<tr><td style="color:#6B7280;border-bottom:1px solid #EEE">' . htmlspecialchars($k)
          .  '</td><td style="border-bottom:1px solid #EEE"><b>' . htmlspecialchars($v) . '</b></td></tr>';
  }
  $html .= '</table><p style="color:#6B7280;font-size:13px;margin-top:16px">Scholary · '
        .  date('d.m.Y H:i') . '</p></div>';
  $r = http_json('https://api.resend.com/emails', 'POST', [
    'Authorization: Bearer ' . $c['RESEND_KEY'],
    'Content-Type: application/json',
  ], [
    'from'    => $c['MAIL_FROM'],
    'to'      => [$c['MAIL_TO']],
    'subject' => $title . ($name ? ' — ' . $name : ''),
    'html'    => $html,
    'text'    => $plain,
  ], 20);
  $sent['email'] = ($r['code'] >= 200 && $r['code'] < 300);
}

/* ---------- WhatsApp через GREEN-API ---------- */
if (!empty($c['GREEN_ID']) && !empty($c['GREEN_TOKEN']) && !empty($c['OWNER_WA'])) {
  $url = 'https://api.green-api.com/waInstance' . $c['GREEN_ID'] . '/sendMessage/' . $c['GREEN_TOKEN'];
  $r = http_json($url, 'POST', ['Content-Type: application/json'], [
    'chatId'  => preg_replace('/\D/', '', $c['OWNER_WA']) . '@c.us',
    'message' => $plain,
  ], 20);
  $sent['whatsapp'] = ($r['code'] >= 200 && $r['code'] < 300);
}

jout(['ok' => true, 'sent' => $sent]);
