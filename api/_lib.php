<?php
/* Scholary · общие функции backend-эндпоинтов. */
function cfg() {
  static $c = null;
  if ($c === null) {
    $p = dirname($_SERVER['DOCUMENT_ROOT']) . '/private/scholary-config.php';
    $c = is_file($p) ? require $p : [];
  }
  return $c;
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
  $cf = trim((string)($_SERVER['HTTP_CF_CONNECTING_IP'] ?? ''));
  if ($cf !== '' && filter_var($cf, FILTER_VALIDATE_IP)) return $cf;
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
  if ($o !== '') return (rtrim($o, '/') === $allow || $o === 'http://localhost:8123');
  $r = (string)($_SERVER['HTTP_REFERER'] ?? '');
  if ($r !== '') return (strpos($r, $allow . '/') === 0 || strpos($r, $allow) === 0 || strpos($r, 'http://localhost:8123') === 0);
  return false;
}
function cors() {
  $allow = cfg()['ALLOW_ORIGIN'] ?? 'https://scholary.kz';
  $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
  if ($origin && ($origin === $allow || $origin === 'http://localhost:8123')) header('Access-Control-Allow-Origin: ' . $origin);
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
