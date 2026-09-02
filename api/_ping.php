<?php
/* Scholary · служебная диагностика сервера.
   Раньше отдавала версию PHP и имя корня сайта любому желающему — это лишняя
   подсказка тому, кто ищет дыры. Теперь нужен секрет из конфига:
   /api/_ping.php?k=<PING_KEY>. Без него — обычная 404, как у несуществующей страницы. */
require __DIR__ . '/_lib.php';
$c   = cfg();
$key = (string)($c['PING_KEY'] ?? '');
$got = (string)($_GET['k'] ?? '');
if ($key === '' || !hash_equals($key, $got)) { http_response_code(404); exit(); }

jout([
  'ok'       => true,
  'php'      => PHP_VERSION,
  'curl'     => function_exists('curl_init'),
  'openssl'  => extension_loaded('openssl'),
  'private_writable' => is_writable(dirname($_SERVER['DOCUMENT_ROOT']) . '/private'),
  'usage_dir'=> is_dir(dirname($_SERVER['DOCUMENT_ROOT']) . '/private/usage'),
  'client_ip'=> client_ip(),
  'saw'      => [
    'X-Real-IP'       => isset($_SERVER['HTTP_X_REAL_IP']),
    'X-Forwarded-For' => isset($_SERVER['HTTP_X_FORWARDED_FOR']),
    'remote'          => $_SERVER['REMOTE_ADDR'] ?? '',
  ],
  'time'     => gmdate('c'),
]);
