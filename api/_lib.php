<?php
/* Scholary · общие функции backend-эндпоинтов. */
/* Ошибки PHP никогда не печатаем в ответ: для tiptop.php это сломало бы
   JSON {"code":0} и шлюз ушёл бы в бесконечные ретраи, для остальных —
   невалидный JSON у клиента и утечка путей сервера. */
ini_set('display_errors', '0');
error_reporting(E_ALL);
function cfg() {
  static $c = null;
  if ($c === null) {
    $base = dirname($_SERVER['DOCUMENT_ROOT']) . '/private/';
    $c = is_file($base . 'scholary-config.php') ? require $base . 'scholary-config.php' : [];
    /* Ключи эквайринга лежат отдельным файлом: их можно перевыпустить
       и залить заново, не трогая остальные секреты сервиса. */
    foreach (['tiptop-secrets.php', 'apipay-secrets.php'] as $sf) {
      if (is_file($base . $sf)) {
        $t = require $base . $sf;
        if (is_array($t)) $c = $t + $c;
      }
    }
  }
  return $c;
}
/* ---------- TikTok Events API (серверные события) ----------
   Дублируем ключевые события с сервера: оплата приходит вебхуком, когда
   браузера уже нет, а заявка с сервера надёжнее, чем из вкладки с
   блокировщиком. Идентификатор пикселя — общий с браузерным кодом;
   токен доступа лежит в /private (TIKTOK_ACCESS_TOKEN) и в репозиторий
   не попадает. Почта/телефон — только SHA-256. Нет токена — тихо выходим. */
function tt_api_event($event, $props = [], $user = [], $event_id = null) {
  $c = cfg();
  $tok = (string)($c['TIKTOK_ACCESS_TOKEN'] ?? '');
  $pix = (string)($c['TIKTOK_PIXEL_ID'] ?? 'DACVEIRC77UCRCTVA5DG');
  if ($tok === '' || $pix === '') return null;
  $h = function ($v) { $v = trim((string)$v); return $v === '' ? null : hash('sha256', $v); };
  $phone = preg_replace('/\D/', '', (string)($user['phone'] ?? ''));
  if (strlen($phone) === 11 && $phone[0] === '8') $phone = '7' . substr($phone, 1);
  if (strlen($phone) === 10) $phone = '7' . $phone;
  $u = array_filter([
    'email'        => $h(strtolower((string)($user['email'] ?? ''))),
    'phone'        => $phone !== '' ? $h('+' . $phone) : null,
    'external_id'  => $h((string)($user['external_id'] ?? '')),
    'ip'           => function_exists('client_ip') ? client_ip() : null,
    'user_agent'   => (string)($_SERVER['HTTP_USER_AGENT'] ?? ''),
    'ttclid'       => (string)($user['ttclid'] ?? ($_COOKIE['ttclid'] ?? '')),
    'ttp'          => (string)($_COOKIE['_ttp'] ?? ''),
  ], function ($v) { return $v !== null && $v !== ''; });
  $body = ['event_source' => 'web', 'event_source_id' => $pix, 'data' => [[
    'event'      => $event,
    'event_time' => time(),
    'event_id'   => $event_id ?: ($event . '_' . bin2hex(random_bytes(6))),
    'user'       => (object)$u,
    'page'       => ['url' => (string)($user['url'] ?? ('https://scholary.kz' . ($_SERVER['REQUEST_URI'] ?? '/'))), 'referrer' => (string)($_SERVER['HTTP_REFERER'] ?? '')],
    'properties' => (object)$props,
  ]]];
  $r = http_json('https://business-api.tiktok.com/open_api/v1.3/event/track/', 'POST',
    ['Access-Token: ' . $tok, 'Content-Type: application/json'], $body, 8);
  return $r;
}
function jout($data, $code = 200) {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  echo json_encode($data, JSON_UNESCAPED_UNICODE);
  exit;
}
/* Настоящий IP клиента.
   ВАЖНО: X-Forwarded-For можно подделать — клиент может прислать свой.
   nginx на Plesk ДОБАВЛЯЕТ реальный IP в конец списка, поэтому берём
   последний элемент, а не первый. X-Real-IP nginx перезаписывает сам. */
function client_ip() {
  /* Если перед сайтом стоит Cloudflare, он кладёт настоящий IP посетителя
     в CF-Connecting-IP, а в X-Forwarded-For последним оказывается уже адрес
     самого Cloudflare — и тогда все посетители выглядели бы одним человеком,
     а лимит «12 заявок с одного IP» отрезал бы всех подряд. */
  /* CF-Connecting-IP верим ТОЛЬКО если сайт реально за Cloudflare
     (флаг в конфиге). Иначе любой клиент подставляет заголовок и
     обходит все IP-лимиты «с нового адреса» на каждый запрос. */
  if (!empty(cfg()['BEHIND_CLOUDFLARE'])) {
    $cf = trim((string)($_SERVER['HTTP_CF_CONNECTING_IP'] ?? ''));
    if ($cf !== '' && filter_var($cf, FILTER_VALIDATE_IP)) return $cf;
  }
  $real = trim((string)($_SERVER['HTTP_X_REAL_IP'] ?? ''));
  if ($real !== '' && filter_var($real, FILTER_VALIDATE_IP)) return $real;
  $xff = (string)($_SERVER['HTTP_X_FORWARDED_FOR'] ?? '');
  if ($xff !== '') {
    $parts = array_map('trim', explode(',', $xff));
    $last  = end($parts);
    if ($last !== false && filter_var($last, FILTER_VALIDATE_IP)) return $last;
  }
  $ra = (string)($_SERVER['REMOTE_ADDR'] ?? '');
  return filter_var($ra, FILTER_VALIDATE_IP) ? $ra : 'unknown';
}
/* Запрос пришёл с нашего же сайта? Проверяем Origin, иначе Referer.
   Не броня от скрипта, но отсекает вызовы «в лоб» с чужих страниц. */
function same_origin() {
  $allow = rtrim((string)(cfg()['ALLOW_ORIGIN'] ?? 'https://scholary.kz'), '/');
  $o = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
  $dev = !empty(cfg()['DEV']);   /* локальный стенд: localhost разрешён только с DEV => true в конфиге */
  if ($o !== '') return (rtrim($o, '/') === $allow || ($dev && $o === 'http://localhost:8123'));
  $r = (string)($_SERVER['HTTP_REFERER'] ?? '');
  if ($r !== '') {
    /* сравниваем именно хост: «https://scholary.kz.evil.com/» раньше проходил по префиксу */
    $h = strtolower((string)parse_url($r, PHP_URL_HOST));
    $ah = strtolower((string)parse_url($allow, PHP_URL_HOST));
    return $h !== '' && ($h === $ah || ($dev && $h === 'localhost'));
  }
  return false;
}
function cors() {
  $allow = cfg()['ALLOW_ORIGIN'] ?? 'https://scholary.kz';
  $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
  if ($origin && ($origin === $allow || (!empty(cfg()['DEV']) && $origin === 'http://localhost:8123'))) header('Access-Control-Allow-Origin: ' . $origin);
  else header('Access-Control-Allow-Origin: ' . $allow);
  header('Access-Control-Allow-Headers: Content-Type, Authorization');
  header('Access-Control-Allow-Methods: POST, OPTIONS');
  if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
}
function body($maxBytes = 80000) {
  $raw = file_get_contents('php://input', false, null, 0, $maxBytes + 1);
  if (strlen($raw) > $maxBytes) jout(['error' => 'too_large'], 413);
  $j = json_decode($raw, true);
  return is_array($j) ? $j : [];
}
function http_json($url, $method, $headers, $payload = null, $timeout = 60) {
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_HTTPHEADER     => $headers,
    CURLOPT_TIMEOUT        => $timeout,
    CURLOPT_CONNECTTIMEOUT => 10,
  ]);
  if ($payload !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, is_string($payload) ? $payload : json_encode($payload, JSON_UNESCAPED_UNICODE));
  $res  = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $err  = curl_error($ch);
  curl_close($ch);
  return ['code' => $code, 'body' => $res, 'err' => $err, 'json' => json_decode((string)$res, true)];
}
/* Проверка пользователя по токену Supabase. Возвращает [id, email] или null. */
function auth_user($token) {
  if (!$token || strlen($token) < 20 || strlen($token) > 4000) return null;
  $c = cfg();
  $r = http_json($c['SUPABASE_URL'] . '/auth/v1/user', 'GET', [
    'apikey: ' . $c['SUPABASE_ANON'], 'Authorization: Bearer ' . $token
  ], null, 15);
  if ($r['code'] !== 200 || empty($r['json']['id'])) return null;
  return ['id' => $r['json']['id'], 'email' => $r['json']['email'] ?? ''];
}
/* Подписка Pro: читаем профиль ЕГО же токеном (RLS сам ограничит строку). */
function is_pro($token, $uid) {
  $c = cfg();
  $r = http_json($c['SUPABASE_URL'] . '/rest/v1/profiles?select=pro_until&user_id=eq.' . urlencode($uid), 'GET', [
    'apikey: ' . $c['SUPABASE_ANON'], 'Authorization: Bearer ' . $token
  ], null, 15);
  $row = $r['json'][0] ?? null;
  if (!$row || empty($row['pro_until'])) return false;
  return strtotime($row['pro_until']) >= strtotime(date('Y-m-d'));
}
/* Лимит вызовов в сутки: файловый счётчик.
   Читаем и пишем под одной блокировкой, иначе два одновременных запроса
   прочитают одно и то же число и лимит можно обойти. */
function rate_check($uid, $limit) {
  $dir = dirname($_SERVER['DOCUMENT_ROOT']) . '/private/usage';
  if (!is_dir($dir)) @mkdir($dir, 0700, true);
  $f  = $dir . '/' . gmdate('Y-m-d') . '.json';
  $fh = @fopen($f, 'c+');
  if (!$fh) return ['ok' => true, 'used' => 0, 'limit' => $limit];   // не ломаем сервис из-за диска
  if (!flock($fh, LOCK_EX)) { fclose($fh); return ['ok' => true, 'used' => 0, 'limit' => $limit]; }
  $raw  = stream_get_contents($fh);
  $data = $raw ? (json_decode($raw, true) ?: []) : [];
  $key  = substr(hash('sha256', (string)$uid), 0, 24);
  $n    = (int)($data[$key] ?? 0);
  if ($n >= $limit) { flock($fh, LOCK_UN); fclose($fh); return ['ok' => false, 'used' => $n, 'limit' => $limit]; }
  $data[$key] = $n + 1;
  ftruncate($fh, 0); rewind($fh);
  fwrite($fh, json_encode($data));
  fflush($fh); flock($fh, LOCK_UN); fclose($fh);
  rate_gc($dir);
  return ['ok' => true, 'used' => $n + 1, 'limit' => $limit];
}
/* Счётчики старше недели больше не нужны — иначе папка растёт вечно. */
function rate_gc($dir) {
  if (mt_rand(1, 200) !== 1) return;                 // подметаем изредка, чтобы не грузить диск
  foreach ((array)@glob($dir . '/*.json') as $old) {
    if (@filemtime($old) < time() - 7 * 86400) @unlink($old);
  }
}
/* Вызов Anthropic: вернуть текст ответа модели. */
function claude($system, $user, $maxTokens = 1400, $model = null) {
  $c = cfg();
  if (empty($c['ANTHROPIC_KEY'])) return ['ok' => false, 'why' => 'no_key'];
  $r = http_json('https://api.anthropic.com/v1/messages', 'POST', [
    'x-api-key: ' . $c['ANTHROPIC_KEY'],
    'anthropic-version: 2023-06-01',
    'content-type: application/json'
  ], [
    'model' => $model ?: $c['ANTHROPIC_MODEL'],
    'max_tokens' => $maxTokens,
    'system' => $system,
    'messages' => [['role' => 'user', 'content' => $user]]
  ], 90);
  if ($r['code'] !== 200) return ['ok' => false, 'why' => 'upstream_' . $r['code']];
  /* модель может вернуть несколько блоков — берём все текстовые */
  $txt = '';
  foreach (($r['json']['content'] ?? []) as $blk) {
    if (($blk['type'] ?? '') === 'text' && isset($blk['text'])) $txt .= $blk['text'];
  }
  $usage = $r['json']['usage'] ?? [];
  return ['ok' => true, 'text' => $txt, 'usage' => $usage, 'stop' => $r['json']['stop_reason'] ?? ''];
}
/* Достаём JSON из ответа модели, даже если он обёрнут в текст. */
function parse_json_block($txt) {
  $txt = trim((string)$txt);
  if ($txt === '') return null;
  $s = strpos($txt, '{'); $sa = strpos($txt, '[');
  if ($sa !== false && ($s === false || $sa < $s)) $s = $sa;
  if ($s === false) return null;
  $e = max(strrpos($txt, '}'), strrpos($txt, ']'));
  if ($e === false || $e <= $s) return null;
  return json_decode(substr($txt, $s, $e - $s + 1), true);
}
/* Убрать управляющие символы и ссылки: текст пишет посторонний человек,
   а письмо и WhatsApp читает владелец — фишинговой ссылке там не место. */
function clean_txt($v, $max = 200) {
  $v = is_string($v) ? $v : '';
  $v = preg_replace('/[\x00-\x1F\x7F]/u', ' ', $v);
  $v = preg_replace('#(https?://|www\.)\S+#iu', '[ссылка убрана]', $v);
  return trim(mb_substr($v, 0, $max));
}
/* Адрес отправителя писем.
   Домен scholary.kz подтверждён в Resend (DKIM + SPF-CNAME + DMARC), поэтому
   письма уходят со своего адреса. Раньше отправка шла с общего адреса Resend:
   такие письма чаще попадают в спам у mail.ru и Яндекса, а человек, купивший
   отчёт, письмо в спаме просто не находит.
   Значение MAIL_FROM из конфига уважаем, только если оно уже на нашем домене:
   иначе один забытый старый адрес молча вернул бы всё как было. */
function mail_from() {
  $f = trim((string)(cfg()['MAIL_FROM'] ?? ''));
  if ($f !== '' && stripos($f, '@scholary.kz') !== false) return $f;
  /* Не no-reply: человек, купивший отчёт, часто отвечает на письмо, и это
     самый дешёвый канал поддержки. Ящика hello@ нет — ответы уводит
     Reply-To на живую почту владельца. */
  return 'Scholary <hello@scholary.kz>';
}
/* Куда человек попадёт, если нажмёт «Ответить» в почтовом клиенте. */
function mail_reply_to() {
  $t = trim((string)(cfg()['MAIL_TO'] ?? ''));
  return $t !== '' ? $t : null;
}

/* Номер WhatsApp → цифры для GREEN-API (chatId = <цифры>@c.us).
   Люди пишут «8 775…», «+7 775…», «775…» — это один номер 77753831836.
   Те же правила, что в js/app.js (ScholaryPhone) и в базе (norm_phone):
   10 цифр → 7+цифры; 11 с 8 → 7+хвост; 11 с 7 → как есть; «+7 8 775…» → без 8;
   11–15 цифр с другим кодом → как есть. Иначе null — отправлять некуда. */
function wa_digits($phone) {
  $raw = trim((string)$phone);
  $d = preg_replace('/\D/', '', $raw);
  if ($d === '') return null;
  if (strlen($d) === 12 && substr($d, 0, 2) === '78') $d = '7' . substr($d, 2);
  // 10 цифр без «+» — это абонентская часть, она у всех номеров РК начинается
  // на 7. Начинается на 8 — потеряна цифра; достраивать нельзя, вернём null.
  if (strlen($d) === 10 && $raw[0] !== '+') {
    if ($d[0] !== '7') return null;
    $d = '7' . $d;
  }
  elseif (strlen($d) === 11 && $d[0] === '8') $d = '7' . substr($d, 1);
  elseif (strlen($d) === 11 && $d[0] === '7') { /* ок */ }
  elseif ($raw !== '' && $raw[0] === '+' && strlen($d) >= 11 && strlen($d) <= 15) { /* другой код страны */ }
  else return null;
  return $d;
}

/* Уведомление владельцу: почта через Resend + WhatsApp через GREEN-API.
   Получатели жёстко заданы в конфиге, поэтому это не ретранслятор спама. */
function notify_owner($title, $rows) {
  $c = cfg();
  $plain = $title . "\n\n";
  foreach ($rows as $k => $v) $plain .= $k . ': ' . $v . "\n";
  $plain .= "\nВремя: " . date('d.m.Y H:i') . " (сервер)";
  $sent = ['email' => false, 'whatsapp' => false];

  if (!empty($c['RESEND_KEY']) && !empty($c['MAIL_TO'])) {
    $html = '<div style="font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#1D1D1F">'
          . '<h2 style="margin:0 0 14px;font-size:19px">' . htmlspecialchars($title) . '</h2><table cellpadding="6" style="border-collapse:collapse">';
    foreach ($rows as $k => $v) {
      $html .= '<tr><td style="color:#6B7280;border-bottom:1px solid #EEE">' . htmlspecialchars($k)
            .  '</td><td style="border-bottom:1px solid #EEE"><b>' . htmlspecialchars($v) . '</b></td></tr>';
    }
    $html .= '</table><p style="color:#6B7280;font-size:13px;margin-top:16px">Scholary · ' . date('d.m.Y H:i') . '</p></div>';
    $subj = $title;
    if (!empty($rows['Имя']) && $rows['Имя'] !== '—') $subj .= ' — ' . $rows['Имя'];
    $r = http_json(rtrim((string)($c['RESEND_BASE'] ?? 'https://api.resend.com'), '/') . '/emails', 'POST', [
      'Authorization: Bearer ' . $c['RESEND_KEY'],
      'Content-Type: application/json',
    ], [
      'from' => mail_from(), 'to' => [$c['MAIL_TO']],
      'subject' => $subj, 'html' => $html, 'text' => $plain,
    ], 20);
    $sent['email'] = ($r['code'] >= 200 && $r['code'] < 300);
  }

  if (!empty($c['GREEN_ID']) && !empty($c['GREEN_TOKEN']) && !empty($c['OWNER_WA']) && empty($GLOBALS['NOTIFY_MAIL_ONLY'])) {
    $url = rtrim((string)($c['GREEN_BASE'] ?? 'https://api.green-api.com'), '/') . '/waInstance' . $c['GREEN_ID'] . '/sendMessage/' . $c['GREEN_TOKEN'];
    $r = http_json($url, 'POST', ['Content-Type: application/json'], [
      'chatId'  => preg_replace('/\D/', '', $c['OWNER_WA']) . '@c.us',
      'message' => $plain,
    ], 20);
    $sent['whatsapp'] = ($r['code'] >= 200 && $r['code'] < 300);
  }
  return $sent;
}
