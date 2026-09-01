<?php
header('Content-Type: application/json; charset=utf-8');
echo json_encode([
  'ok' => true,
  'php' => PHP_VERSION,
  'curl' => function_exists('curl_init'),
  'openssl' => extension_loaded('openssl'),
  'writable_private' => is_writable(dirname($_SERVER['DOCUMENT_ROOT']) . '/private-archive'),
  'doc_root' => basename($_SERVER['DOCUMENT_ROOT'])
]);
