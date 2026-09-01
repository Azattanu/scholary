<?php
/* Scholary · обратный прокси для PostHog.
   Зачем: блокировщики рекламы режут запросы к posthog.com — по их же оценке
   теряется 10–25 % событий. Запросы идут на наш домен /ph/… и оттуда сюда,
   поэтому блокировщику не за что зацепиться.
   Проксируем ТОЛЬКО известные пути PostHog и только на их хосты. */

$path = isset($_GET['p']) ? (string)$_GET['p'] : '';
$path = ltrim(preg_replace('#[^A-Za-z0-9_\-/\.]#', '', $path), '/');
if ($path === '' || strpos($path, '..') !== false) { http_response_code(400); exit('bad path'); }

/* статика библиотеки лежит на отдельном хосте */
$isStatic = (strncmp($path, 'static/', 7) === 0 || strncmp($path, 'array/', 6) === 0);
$base = $isStatic ? 'https://us-assets.i.posthog.com/' : 'https://us.i.posthog.com/';

/* пути, которые вообще имеет смысл пропускать */
if (!preg_match('#^(static/|array/|i/|e($|/)|batch/|capture/|decide/|flags/|s/|ses/)#', $path)) {
  http_response_code(404); exit('not allowed');
}

$qs  = $_GET; unset($qs['p']);
$url = $base . $path . (count($qs) ? ('?' . http_build_query($qs)) : '');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (!in_array($method, ['GET', 'POST', 'OPTIONS'], true)) { http_response_code(405); exit('method'); }
if ($method === 'OPTIONS') {
  header('Access-Control-Allow-Origin: https://scholary.kz');
  header('Access-Control-Allow-Headers: Content-Type');
  header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
  http_response_code(204); exit;
}

$body = ($method === 'POST') ? file_get_contents('php://input', false, null, 0, 2000000) : null;

$headers = ['Accept-Encoding: identity'];
if (!empty($_SERVER['CONTENT_TYPE'])) $headers[] = 'Content-Type: ' . $_SERVER['CONTENT_TYPE'];
$ip = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '';
if ($ip) $headers[] = 'X-Forwarded-For: ' . trim(explode(',', $ip)[0]);
if (!empty($_SERVER['HTTP_USER_AGENT'])) $headers[] = 'User-Agent: ' . $_SERVER['HTTP_USER_AGENT'];

$ch = curl_init($url);
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_CUSTOMREQUEST  => $method,
  CURLOPT_HTTPHEADER     => $headers,
  CURLOPT_TIMEOUT        => 20,
  CURLOPT_CONNECTTIMEOUT => 8,
  CURLOPT_HEADER         => true,
]);
if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
$res  = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$hlen = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
curl_close($ch);

if ($res === false) { http_response_code(502); exit('upstream'); }
$rawHeaders = substr($res, 0, $hlen);
$payload    = substr($res, $hlen);

http_response_code($code ?: 502);
foreach (explode("\r\n", $rawHeaders) as $h) {
  if (stripos($h, 'content-type:') === 0 || stripos($h, 'cache-control:') === 0 || stripos($h, 'etag:') === 0) header($h, true);
}
header('Access-Control-Allow-Origin: https://scholary.kz');
if ($isStatic) header('Cache-Control: public, max-age=3600');
echo $payload;
