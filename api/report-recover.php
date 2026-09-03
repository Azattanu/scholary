<?php
/* Scholary · восстановление доступа к оплаченному отчёту.
 *
 * ЗАЧЕМ. Человек заплатил, но ссылки у него нет: письмо в спаме, WhatsApp с
 * опечаткой, чат потёрт, ссылку открыл не на том телефоне. Раньше это чинил
 * основатель руками. Теперь клиент вводит свой телефон или почту — и сервер
 * сам присылает ссылку.
 *
 * БЕЗОПАСНОСТЬ (важнее удобства):
 *   · токен отчёта НИКОГДА не уходит в браузер. Ссылка отправляется только на
 *     контакты, сохранённые при покупке. Иначе перебор почт = чужие отчёты;
 *   · ответ всегда одинаковый («если заказ есть — отправили»), чтобы форма не
 *     работала как проверялка «есть ли у вас такой клиент»;
 *   · лимит запросов по IP, чтобы форму нельзя было использовать как рассылку;
 *   · вызов Supabase идёт через узкую security-definer функцию с секретом
 *     вебхука — сервисного ключа на хостинге нет.
 *
 * Режим admin: тот же эндпоинт с токеном админа переотправляет отчёт по lead_id.
 */
require __DIR__ . '/_lib.php';
cors();
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') jout(['error' => 'method'], 405);

$c    = cfg();
$in   = body(4000);
$mode = ($in['mode'] ?? 'self') === 'admin' ? 'admin' : 'self';

/* ---------- общий отправитель ---------- */
function rr_send($name, $wa, $mail, $token) {
  $c = cfg();
  $link = 'https://scholary.kz/report/?t=' . rawurlencode($token);
  $first = trim(mb_substr(preg_replace('/[^\p{L}\p{M}\s\-]/u', '', (string)$name), 0, 30));
  $hi = $first !== '' ? $first . ', привет!' : 'Привет!';
  $out = ['whatsapp' => false, 'email' => false];

  $digits = wa_digits($wa);
  if (!empty($c['GREEN_ID']) && !empty($c['GREEN_TOKEN']) && $digits !== null) {
    $msg = $hi . " Вот твой отчёт Scholary 🎓\n\n" . $link . "\n\n"
         . "Ссылка личная и не сгорает — сохрани её или добавь в закладки.\n"
         . "Если отчёт не открывается, просто ответь на это сообщение.";
    $r = http_json('https://api.green-api.com/waInstance' . $c['GREEN_ID'] . '/sendMessage/' . $c['GREEN_TOKEN'],
      'POST', ['Content-Type: application/json'],
      ['chatId' => $digits . '@c.us', 'message' => $msg], 20);
    $out['whatsapp'] = ($r['code'] >= 200 && $r['code'] < 300);
  }

  if (!empty($c['RESEND_KEY']) && filter_var((string)$mail, FILTER_VALIDATE_EMAIL)) {
    $html = '<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#1D1D1F;max-width:520px">'
          . '<h2 style="margin:0 0 12px;font-size:20px">' . htmlspecialchars($hi) . '</h2>'
          . '<p>Вот ссылка на твой отчёт Scholary — она личная и не сгорает.</p>'
          . '<p style="margin:20px 0"><a href="' . htmlspecialchars($link) . '" '
          . 'style="background:#4F46E5;color:#fff;text-decoration:none;font-weight:700;'
          . 'padding:13px 22px;border-radius:10px;display:inline-block">Открыть отчёт</a></p>'
          . '<p style="color:#6B7280;font-size:13px">Не открывается — напиши нам в WhatsApp, поможем за пару минут.</p></div>';
    $r = http_json('https://api.resend.com/emails', 'POST', [
      'Authorization: Bearer ' . $c['RESEND_KEY'], 'Content-Type: application/json',
    ], array_filter([
        'from' => mail_from(), 'to' => [$mail], 'subject' => 'Твой отчёт Scholary — ссылка',
        'reply_to' => mail_reply_to(),
        'html' => $html, 'text' => $hi . "\n\nТвой отчёт Scholary: " . $link],
        function ($v) { return $v !== null; }), 20);
    $out['email'] = ($r['code'] >= 200 && $r['code'] < 300);
  }
  return $out;
}

/* Флаг «уже уведомляли» на файловой системе (как tt_once в tiptop.php). */
function rr_once($key) {
  $dir = dirname($_SERVER['DOCUMENT_ROOT']) . '/private/tiptop';
  if (!is_dir($dir)) @mkdir($dir, 0700, true);
  $f = $dir . '/seen-' . substr(hash('sha256', $key), 0, 32) . '.flag';
  $h = @fopen($f, 'x');
  if ($h === false) return false;
  fwrite($h, (string)time()); fclose($h);
  return true;
}

/* ---------- вызов узкой RPC с секретом вебхука ---------- */
function rr_rpc($fn, $args) {
  $c = cfg();
  if (empty($c['TIPTOP_RPC_SECRET'])) return null;
  $r = http_json($c['SUPABASE_URL'] . '/rest/v1/rpc/' . $fn, 'POST', [
    'apikey: ' . $c['SUPABASE_ANON'],
    'Authorization: Bearer ' . $c['SUPABASE_ANON'],
    'Content-Type: application/json',
  ], ['p_secret' => $c['TIPTOP_RPC_SECRET']] + $args, 20);
  if ($r['code'] < 200 || $r['code'] >= 300) return null;
  return is_array($r['json']) ? $r['json'] : null;
}

/* =========================== режим админа =========================== */
if ($mode === 'admin') {
  $hdr = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? '');
  $tok = preg_match('/Bearer\s+(\S+)/i', $hdr, $m) ? $m[1] : '';
  $u = auth_user($tok);
  if (!$u) jout(['error' => 'unauthorized'], 401);
  /* права проверяет сама база: is_admin() читает список админов */
  $chk = http_json($c['SUPABASE_URL'] . '/rest/v1/rpc/is_admin', 'POST',
    ['apikey: ' . $c['SUPABASE_ANON'], 'Authorization: Bearer ' . $tok, 'Content-Type: application/json'],
    new stdClass(), 15);
  if ($chk['code'] !== 200 || $chk['json'] !== true) jout(['error' => 'forbidden'], 403);

  $lead = trim((string)($in['lead'] ?? ''));
  if (strlen($lead) < 8 || strlen($lead) > 64) jout(['error' => 'bad_lead'], 400);

  $r = http_json($c['SUPABASE_URL'] . '/rest/v1/rpc/admin_lead_answers', 'POST',
    ['apikey: ' . $c['SUPABASE_ANON'], 'Authorization: Bearer ' . $tok, 'Content-Type: application/json'],
    ['p_lead' => $lead], 20);
  $row = is_array($r['json']) ? $r['json'] : null;
  if (!$row || empty($row['token'])) jout(['ok' => false, 'why' => 'no_report'], 200);

  $sent = rr_send($row['name'] ?? '', $row['whatsapp'] ?? '', $row['email'] ?: ($row['p2_email'] ?? ''), $row['token']);
  rr_rpc('tiptop_mark_report_sent', [
    'p_lead' => $lead,
    'p_wa'    => $sent['whatsapp'] ? 'sent' : 'failed',
    'p_email' => $sent['email'] ? 'sent' : 'failed',
  ]);
  jout(['ok' => true, 'sent' => $sent]);
}

/* =========================== самообслуживание =========================== */
if (!same_origin()) jout(['error' => 'forbidden'], 403);

$contact = trim((string)($in['contact'] ?? ''));
if ($contact === '' || mb_strlen($contact) > 120) jout(['ok' => true, 'note' => 'checked']);

/* Лимит: 6 попыток в сутки с одного IP. Форма шлёт письма и WhatsApp —
   без лимита это готовый рассыльщик. Считаем ДО обращения к базе. */
$rl = rate_check('recover:' . client_ip(), 6);
if (!$rl['ok']) jout(['ok' => false, 'why' => 'rate_limited'], 429);

/* Ответ клиенту одинаков в любом случае и отдаётся ДО поиска и отправки:
   иначе по времени ответа (2–3 HTTP-вызова при найденном контакте против
   одного RPC при ненайденном) можно было проверять, кто наш клиент. */
$answer = ['ok' => true, 'note' => 'checked'];
ignore_user_abort(true);
http_response_code(200);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
$__body = json_encode($answer, JSON_UNESCAPED_UNICODE);
header('Content-Length: ' . strlen($__body));
echo $__body;
if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
else { while (ob_get_level() > 0) @ob_end_flush(); @flush(); }

$found = rr_rpc('find_paid_report', ['p_contact' => $contact]);

if (is_array($found) && !empty($found['ok']) && !empty($found['token'])) {
  $sent = rr_send($found['name'] ?? '', $found['whatsapp'] ?? '', $found['email'] ?? '', $found['token']);
  rr_rpc('tiptop_mark_report_sent', [
    'p_lead'  => (string)($found['lead'] ?? ''),
    'p_wa'    => $sent['whatsapp'] ? 'sent' : 'failed',
    'p_email' => $sent['email'] ? 'sent' : 'failed',
  ]);
  /* Ни один канал не сработал — это уже наша проблема, зовём человека. */
  if (!$sent['whatsapp'] && !$sent['email']) {
    notify_owner('Клиент просит отчёт, отправка не прошла', [
      'ID лида' => clean_txt((string)($found['lead'] ?? ''), 64) ?: '—',
      'Имя'     => clean_txt((string)($found['name'] ?? ''), 60) ?: '—',
      'Что делать' => 'открыть админку → Отчёты → скопировать ссылку и отправить вручную',
    ]);
  }
} elseif (is_array($found) && ($found['why'] ?? '') === 'no_report' && rr_once('noreport-' . ($found['lead'] ?? '') . '-' . gmdate('Y-m-d'))) {
  /* Оплата есть, отчёта нет — самый болезненный случай. Клиенту тот же
     нейтральный ответ, а владельцу — срочное уведомление (не чаще раза в сутки на лид,
     иначе форму можно использовать как звонилку владельцу). */
  notify_owner('СРОЧНО: оплатил, отчёта нет — клиент ищет его сам', [
    'ID лида'   => clean_txt((string)($found['lead'] ?? ''), 64) ?: '—',
    'Имя'       => clean_txt((string)($found['name'] ?? ''), 60) ?: '—',
    'Расчёт в базе' => !empty($found['has_result']) ? 'есть — выдаётся в один клик в админке' : 'НЕТ — собрать по ответам анкеты',
    'Что делать' => 'админка → Оплаты без отчёта → «Выдать отчёт»',
  ]);
}

exit;
