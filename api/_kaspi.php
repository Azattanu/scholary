<?php
/* ============================================================
   Scholary · служебные функции Kaspi-оплаты (ApiPay.kz).
   Общие для api/kaspi.php (создание, статус) и api/kaspi-webhook.php.
   ============================================================ */
require_once __DIR__ . '/_pay.php';

function kaspi_base() { return rtrim((string)(cfg()['APIPAY_BASE'] ?? 'https://api.apipay.kz/api/v1'), '/'); }

/* Запрос к ApiPay с ключом. Ключ никогда не попадает в ответ клиенту и в лог. */
function kaspi_api($method, $path, $payload = null, $timeout = 25) {
  $c = cfg();
  return http_json(kaspi_base() . $path, $method, [
    'X-API-Key: ' . (string)$c['APIPAY_KEY'], 'Content-Type: application/json', 'Accept: application/json',
  ], $payload, $timeout);
}

function kaspi_dir($sub) {
  $d = dirname($_SERVER['DOCUMENT_ROOT']) . '/private/kaspi/' . $sub;
  if (!is_dir($d)) @mkdir($d, 0700, true);
  return $d;
}
function kaspi_dupkey($kind, $who, $phone) { return substr(hash('sha256', $kind . '|' . $who . '|' . $phone), 0, 32); }

function kaspi_order_path($order) { return kaspi_dir('orders') . '/' . preg_replace('/[^a-z0-9]/', '', $order) . '.json'; }
function kaspi_order_load($order) {
  $f = kaspi_order_path($order);
  if (!is_file($f)) return null;
  $j = json_decode((string)@file_get_contents($f), true);
  if (!is_array($j)) { usleep(150000); $j = json_decode((string)@file_get_contents($f), true); }   /* кто-то пишет прямо сейчас */
  return is_array($j) ? $j : null;
}
function kaspi_order_save($rec) {
  $rec['updated'] = time();
  $f = kaspi_order_path($rec['order']);
  /* Заказ меняют два процесса сразу (вебхук и опрос): читаем свежую копию
     под замком и никогда не откатываем «оплачен» и «выдан». Пишем во
     временный файл и переименовываем — читатель не увидит полфайла. */
  $h = @fopen($f . '.lock', 'c');
  if ($h) @flock($h, LOCK_EX);
  $cur = kaspi_order_load($rec['order']);
  if ($cur) {
    if (!empty($cur['fulfilled']) && empty($rec['fulfilled'])) foreach (['fulfilled', 'fulfilled_at', 'fulfill_via', 'fulfill_note'] as $k) if (isset($cur[$k])) $rec[$k] = $cur[$k];
    if (!empty($cur['fulfill_started']) && empty($rec['fulfill_started'])) $rec['fulfill_started'] = $cur['fulfill_started'];
    if (($cur['status'] ?? '') === 'paid' && !in_array($rec['status'], ['paid', 'partially_refunded'], true)) { $rec['status'] = 'paid'; if (!empty($cur['paid_at'])) $rec['paid_at'] = $cur['paid_at']; }
  }
  $tmp = $f . '.' . getmypid() . '.tmp';
  if (@file_put_contents($tmp, json_encode($rec, JSON_UNESCAPED_UNICODE)) !== false) @rename($tmp, $f); else @unlink($tmp);
  if ($h) { @flock($h, LOCK_UN); fclose($h); }
  /* индекс по счёту ApiPay и по ключу дубликата — чтобы вебхук и повторное
     нажатие находили заказ без перебора файлов */
  if (!empty($rec['invoice_id'])) @file_put_contents(kaspi_dir('by-invoice') . '/' . (int)$rec['invoice_id'], $rec['order'], LOCK_EX);
  if (!empty($rec['dupkey'])) @file_put_contents(kaspi_dir('by-key') . '/' . preg_replace('/[^a-f0-9]/', '', $rec['dupkey']), $rec['order'], LOCK_EX);
  /* заказы и индексы старше 60 дней не нужны: чистим понемногу */
  if (mt_rand(1, 40) === 1) foreach (['orders/*', 'by-invoice/*', 'by-key/*'] as $g) foreach ((array)@glob(kaspi_dir('') . $g) as $old) {
    if (@filemtime($old) < time() - 60 * 86400) @unlink($old);
  }
  return $rec;
}
function kaspi_order_by_key($dupkey) {
  $f = kaspi_dir('by-key') . '/' . preg_replace('/[^a-f0-9]/', '', $dupkey);
  if (!is_file($f)) return null;
  return kaspi_order_load(trim((string)@file_get_contents($f)));
}
function kaspi_order_by_invoice($invoiceId) {
  $f = kaspi_dir('by-invoice') . '/' . (int)$invoiceId;
  if (!is_file($f)) return null;
  return kaspi_order_load(trim((string)@file_get_contents($f)));
}

/* Перенести поля счёта ApiPay (из вебхука или GET /invoices/{id}) в заказ.
   Оплата после cancelled/expired всё равно побеждает — так велит Kaspi. */
function kaspi_apply_invoice(&$rec, $inv, $via) {
  $st = (string)($inv['status'] ?? '');
  $known = ['processing', 'pending', 'paid', 'cancelled', 'expired', 'error', 'partially_refunded', 'cancelling'];
  if (!in_array($st, $known, true)) $st = $rec['status'];
  if ($st === 'cancelling') $st = 'pending';
  $was = $rec['status'];
  if ($rec['status'] !== 'paid' || $st === 'paid' || $st === 'partially_refunded') $rec['status'] = $st;
  if (!empty($inv['id']) && empty($rec['invoice_id'])) $rec['invoice_id'] = (int)$inv['id'];
  if (!empty($inv['kaspi_invoice_id'])) $rec['kaspi_invoice_id'] = (string)$inv['kaspi_invoice_id'];
  if (isset($inv['is_sandbox'])) $rec['is_sandbox'] = !empty($inv['is_sandbox']);
  if (!empty($inv['paid_at'])) $rec['paid_at'] = (string)$inv['paid_at'];
  if (isset($inv['error_code'])) $rec['error_code'] = clean_txt((string)$inv['error_code'], 60);
  if (isset($inv['error_message'])) $rec['error_message'] = clean_txt((string)$inv['error_message'], 200);
  if (isset($inv['amount'])) $rec['paid_amount'] = (int)round((float)$inv['amount']);
  if ($was !== $rec['status']) kaspi_log($via, 'status', ['order' => $rec['order'], 'from' => $was, 'to' => $rec['status'], 'invoice' => $rec['invoice_id']]);
  $rec = kaspi_order_save($rec);
}

/* Счёт оплачен — выдать покупку ровно один раз (вебхук и поллинг могут
   прийти одновременно; замок — атомарный файл). */
function kaspi_fulfill(&$rec, $via) {
  if (!empty($rec['fulfilled'])) return;
  if (!tt_once('kaspi-fulfill-' . $rec['order'])) {
    /* Кто-то уже выдаёт. Если «выдаёт» дольше 10 минут — процесс упал на
       середине: зовём владельца один раз, деньги не должны потеряться молча. */
    $st = (int)($rec['fulfill_started'] ?? 0);
    if ($st > 0 && time() - $st > 600 && tt_once('kaspi-stuck-' . $rec['order'])) {
      kaspi_log($via, 'stuck', ['order' => $rec['order']]);
      notify_owner('Kaspi: оплата есть, выдача зависла — разобрать вручную', ['Заказ' => $rec['order'], 'За что' => tt_kind_ru((string)$rec['kind']),
        'Сумма' => (int)$rec['amount'] . ' ₸', 'Телефон' => '+' . clean_txt((string)$rec['phone'], 16), 'Почта' => clean_txt((string)$rec['email'], 120) ?: '—',
        'Что' => 'выдача началась ' . date('d.m H:i', $st) . ' и не завершилась — выдать покупку руками']);
    }
    return;
  }
  $rec['fulfill_started'] = time();
  $rec = kaspi_order_save($rec);
  $sum  = (int)$rec['amount'];
  $paid = (int)($rec['paid_amount'] ?? $sum);
  $txn  = 'kaspi_' . (int)$rec['invoice_id'];
  $test = !empty($rec['is_sandbox']);
  if ($paid !== $sum) {
    /* Сумма не сходится с прайсом — деньги не теряем, но выдаём руками. */
    kaspi_log($via, 'mismatch', ['order' => $rec['order'], 'want' => $sum, 'got' => $paid]);
    notify_owner('Kaspi: оплата с непонятной суммой — разобрать', ['Ожидали' => $sum . ' ₸', 'Пришло' => $paid . ' ₸',
      'Заказ' => $rec['order'], 'Счёт ApiPay' => (string)$rec['invoice_id'], 'ID лида' => clean_txt((string)$rec['lead'], 64) ?: '—']);
    $rec['fulfilled'] = true; $rec['fulfill_note'] = 'mismatch';
    $rec = kaspi_order_save($rec);
    return;
  }
  $res = pay_fulfill('kaspi', $rec['kind'], $sum, $txn, (string)$rec['lead'], (string)$rec['email'], (string)$rec['account'], $test,
    ['Kaspi-счёт' => (string)($rec['kaspi_invoice_id'] ?: $rec['invoice_id']), 'Телефон' => '+' . clean_txt((string)$rec['phone'], 16)],
    ['name' => (string)($rec['name'] ?? ''), 'phone' => (string)$rec['phone']]);
  $rec['fulfilled'] = true; $rec['fulfilled_at'] = time(); $rec['fulfill_via'] = $via;
  $rec = kaspi_order_save($rec);
  kaspi_log($via, 'fulfilled', ['order' => $rec['order'], 'kind' => $rec['kind'], 'test' => $test, 'res' => $res]);
}

/* Выдача в фоне: вебхук ApiPay ждёт ответ не дольше 5 с, а отчёт уходит
   на WhatsApp и почту до 40 с. Хостинг не отдаёт ответ до конца скрипта
   (fastcgi_finish_request здесь не помогает), поэтому дёргаем сами себя
   отдельным запросом с коротким таймаутом: этот скрипт отвечает сразу,
   а второй процесс доделывает работу (ignore_user_abort). Если самозапрос
   не ушёл — выдаём прямо здесь, пусть и медленно. */
function kaspi_fulfill_async(&$rec, $via) {
  if (!empty($rec['fulfilled'])) return;
  $c = cfg();
  $base = rtrim((string)($c['SELF_BASE'] ?? 'https://scholary.kz'), '/');   /* локальный стенд переопределяет */
  $sig = hash_hmac('sha256', 'fulfill|' . $rec['order'], (string)($c['APIPAY_WEBHOOK_SECRET'] ?? ''));
  $ch = curl_init($base . '/api/kaspi.php?a=fulfill');
  curl_setopt_array($ch, [
    CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_NOSIGNAL => true,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Origin: ' . rtrim((string)($c['ALLOW_ORIGIN'] ?? 'https://scholary.kz'), '/')],
    CURLOPT_POSTFIELDS => json_encode(['order' => $rec['order'], 'sig' => $sig, 'via' => $via]),
    CURLOPT_CONNECTTIMEOUT_MS => 1500, CURLOPT_TIMEOUT_MS => 1500,
  ]);
  curl_exec($ch);
  $errno = curl_errno($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $connected = (float)curl_getinfo($ch, CURLINFO_CONNECT_TIME) > 0;
  curl_close($ch);
  /* 28 = таймаут ПОСЛЕ соединения: запрос ушёл, сервер продолжает работать —
     это норма. Таймаут без соединения или любой другой сбой — делаем сами. */
  if ($errno !== 0 && !($errno === 28 && $connected)) { kaspi_log($via, 'async_failed', ['order' => $rec['order'], 'errno' => $errno]); kaspi_fulfill($rec, $via); }
  elseif ($errno === 0 && $code >= 400) { kaspi_log($via, 'async_http', ['order' => $rec['order'], 'code' => $code]); kaspi_fulfill($rec, $via); }
}

/* Для проверки подключений: оплаченные, но не выданные заказы старше 10 минут —
   единственная ситуация, где деньги взяты, а клиент ничего не получил. */
function kaspi_unfulfilled($minAge = 600) {
  $n = 0;
  foreach ((array)@glob(kaspi_dir('orders') . '/*.json') as $f) {
    $j = json_decode((string)@file_get_contents($f), true);
    if (is_array($j) && ($j['status'] ?? '') === 'paid' && empty($j['fulfilled']) && time() - (int)($j['updated'] ?? 0) > $minAge) $n++;
  }
  return $n;
}

function kaspi_log($type, $what, $data) {
  $dir = kaspi_dir('');
  $line = json_encode(['t' => gmdate('c'), 'type' => $type, 'what' => $what] + $data, JSON_UNESCAPED_UNICODE);
  @file_put_contents(rtrim($dir, '/') . '/log-' . gmdate('Y-m') . '.jsonl', $line . "\n", FILE_APPEND | LOCK_EX);
}
