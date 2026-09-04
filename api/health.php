<?php
/* ============================================================
   Scholary · проверка всех подключений.
   Открывается только администратору: клиент присылает свой токен
   Supabase, мы спрашиваем у базы is_admin() и лишь потом что-то
   рассказываем. Значения ключей НИКОГДА не отдаются — только
   «есть/нет» и ответ сервиса.
   Нужна, чтобы одним взглядом видеть, что из внешних сервисов
   отвалилось: раньше это выяснялось по тишине в WhatsApp.
   ============================================================ */
require __DIR__ . '/_lib.php';
cors();
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') jout(['error' => 'method'], 405);
if (!same_origin()) jout(['error' => 'forbidden'], 403);

$c   = cfg();
$in  = body(4000);
$tok = (string)($in['token'] ?? '');
$u   = auth_user($tok);
if (!$u) jout(['error' => 'unauthorized'], 401);

/* Права проверяет база, а не мы: список админов живёт там. */
$adm = http_json($c['SUPABASE_URL'] . '/rest/v1/rpc/is_admin', 'POST', [
  'apikey: ' . $c['SUPABASE_ANON'], 'Authorization: Bearer ' . $tok, 'Content-Type: application/json'
], [], 15);
if ($adm['code'] !== 200 || $adm['json'] !== true) jout(['error' => 'forbidden'], 403);

$rl = rate_check('health:' . $u['id'], 60);
if (!$rl['ok']) jout(['error' => 'too_many'], 429);

$out = [];
function chk(&$out, $name, $title, $ok, $note, $hint = '') {
  $out[] = ['key' => $name, 'title' => $title, 'ok' => (bool)$ok, 'note' => $note, 'hint' => $hint];
}

/* ---- База ---- */
$r = http_json($c['SUPABASE_URL'] . '/rest/v1/programs_public?select=id&limit=1', 'GET', [
  'apikey: ' . $c['SUPABASE_ANON']], null, 12);
chk($out, 'supabase', 'Supabase — база и каталог', $r['code'] === 200,
  $r['code'] === 200 ? 'отвечает, каталог читается' : 'код ответа ' . $r['code'],
  'если не отвечает — сайт покажет расчёт, но не сохранит анкету');

/* ---- Почта ---- */
if (empty($c['RESEND_KEY'])) chk($out, 'resend', 'Resend — письма', false, 'ключ не прописан', 'письма о заявках и оплатах не уходят');
else {
  /* Ключ Resend бывает «только отправка» — тогда список доменов он
     не покажет и вернёт 401. Это НЕ поломка: письма всё равно уходят.
     Поэтому 401 трактуем отдельно, а настоящую проверку отправки
     делает кнопка «Отправить тестовое письмо». */
  $r = http_json('https://api.resend.com/domains', 'GET', ['Authorization: Bearer ' . $c['RESEND_KEY']], null, 12);
  $from = mail_from();   /* показываем адрес, с которого письма реально уходят */
  $ownDomain = strpos($from, 'scholary.kz') !== false;
  if ($r['code'] === 200) {
    $ver = [];
    foreach ((array)($r['json']['data'] ?? []) as $d) if (($d['status'] ?? '') === 'verified') $ver[] = $d['name'] ?? '';
    chk($out, 'resend', 'Resend — письма', true,
      'ключ рабочий; подтверждённых доменов: ' . count($ver) . ($ver ? ' (' . implode(', ', $ver) . ')' : '') .
      '; отправитель ' . ($ownDomain ? 'свой домен' : 'общий адрес Resend'),
      $ownDomain ? '' : 'письма уходят с общего адреса Resend — часть попадёт в спам. Нужны DNS-записи для scholary.kz');
  } elseif ($r['code'] === 401 || $r['code'] === 403) {
    chk($out, 'resend', 'Resend — письма', true,
      'ключ с правом только на отправку (список доменов закрыт) — это нормально; отправитель ' .
      ($ownDomain ? 'свой домен' : 'общий адрес Resend'),
      'проверить отправку по-настоящему: кнопка «Отправить тестовое письмо» ниже');
  } else {
    chk($out, 'resend', 'Resend — письма', false, 'код ответа ' . $r['code'],
      'письма о заявках и оплатах могут не уходить');
  }
}

/* ---- WhatsApp ---- */
if (empty($c['GREEN_ID']) || empty($c['GREEN_TOKEN'])) chk($out, 'whatsapp', 'WhatsApp (GREEN-API)', false, 'реквизиты не прописаны', 'уведомления о заявках и оплатах не придут в WhatsApp');
else {
  $r = http_json('https://api.green-api.com/waInstance' . $c['GREEN_ID'] . '/getStateInstance/' . $c['GREEN_TOKEN'], 'GET', [], null, 12);
  $st = (string)($r['json']['stateInstance'] ?? '');
  chk($out, 'whatsapp', 'WhatsApp (GREEN-API)', $st === 'authorized',
    $st !== '' ? ('состояние: ' . $st) : ('код ответа ' . $r['code']),
    $st === 'authorized' ? '' : 'телефон отвязался — заново отсканировать QR в личном кабинете GREEN-API');
}

/* ---- Telegram ---- */
if (empty($c['TELEGRAM_TOKEN'])) chk($out, 'telegram', 'Telegram-бот', false, 'токен не прописан', 'напоминания о дедлайнах в Telegram не работают');
else {
  $r = http_json('https://api.telegram.org/bot' . $c['TELEGRAM_TOKEN'] . '/getMe', 'GET', [], null, 12);
  $ok = !empty($r['json']['ok']);
  chk($out, 'telegram', 'Telegram-бот', $ok,
    $ok ? ('@' . ($r['json']['result']['username'] ?? '?')) : ('код ответа ' . $r['code']),
    $ok ? '' : 'токен недействителен — взять новый у @BotFather');
  if ($ok) {
    $w = http_json('https://api.telegram.org/bot' . $c['TELEGRAM_TOKEN'] . '/getWebhookInfo', 'GET', [], null, 12);
    $url = (string)($w['json']['result']['url'] ?? '');
    $pend = (int)($w['json']['result']['pending_update_count'] ?? 0);
    chk($out, 'telegram_hook', 'Telegram — вебхук', $url !== '',
      $url !== '' ? ('подключён, в очереди ' . $pend) : 'не установлен',
      $url !== '' ? '' : 'бот не получает сообщения: установить вебхук на /api/tg.php');
  }
}

/* ---- ИИ ---- */
chk($out, 'anthropic', 'Anthropic — разборы с ИИ', !empty($c['ANTHROPIC_KEY']),
  !empty($c['ANTHROPIC_KEY']) ? 'ключ на месте, модель ' . (string)($c['ANTHROPIC_MODEL'] ?? '—') : 'ключ не прописан',
  !empty($c['ANTHROPIC_KEY']) ? '' : 'проверка документов и письма работать не будут');

/* ---- Эквайринг ---- */
$hasApi = !empty($c['TIPTOP_API_SECRET']); $hasRpc = !empty($c['TIPTOP_RPC_SECRET']);
chk($out, 'tiptop', 'TipTop Pay — приём оплат', $hasApi && $hasRpc,
  ($hasApi ? 'ключ подписи на месте' : 'НЕТ ключа подписи') . '; ' . ($hasRpc ? 'связь с базой настроена' : 'НЕТ секрета для базы'),
  ($hasApi && $hasRpc) ? '' : 'уведомления шлюза будут отвергаться — оплаты не отметятся');

/* ---- Kaspi через ApiPay.kz ---- */
$apKey = !empty($c['APIPAY_KEY']); $apSec = !empty($c['APIPAY_WEBHOOK_SECRET']);
if ($apKey) {
  $ah = http_json(rtrim((string)($c['APIPAY_BASE'] ?? 'https://api.apipay.kz/api/v1'), '/') . '/account/health', 'GET', ['X-API-Key: ' . $c['APIPAY_KEY'], 'Accept: application/json'], null, 15);
  $aj = is_array($ah['json']) ? $ah['json'] : [];
  $conn = $aj['connection'] ?? []; $tar = $aj['tariff'] ?? [];
  $kOk = $ah['code'] === 200 && !empty($conn['kaspi_connected']) && empty($conn['needs_reauth']) && in_array((string)($tar['status'] ?? ''), ['active', 'trial'], true);
  chk($out, 'kaspi', 'Kaspi — оплата через ApiPay', $kOk && $apSec,
    $ah['code'] !== 200 ? 'ApiPay не отвечает (HTTP ' . $ah['code'] . ')'
      : ('кассир ' . (!empty($conn['kaspi_connected']) ? 'подключён' : 'НЕ подключён') . (!empty($conn['needs_reauth']) ? ', нужна переавторизация' : '')
        . ' · тариф ' . (string)($tar['status'] ?? '?') . (isset($tar['days_remaining']) ? ', осталось дней: ' . (int)$tar['days_remaining'] : '')
        . ($apSec ? '' : ' · НЕТ секрета вебхука')),
    $kOk && $apSec ? '' : 'кнопка Kaspi на сайте не выставит счёт — проверить кабинет apipay.kz (кассир, тариф) и /private/apipay-secrets.php');
} else {
  chk($out, 'kaspi', 'Kaspi — оплата через ApiPay', false, 'ключ API не прописан', "добавить /private/apipay-secrets.php с APIPAY_KEY и APIPAY_WEBHOOK_SECRET");
}

/* ---- TikTok Events API (серверные события: заявки, оплаты) ---- */
$ttTok = !empty($c['TIKTOK_ACCESS_TOKEN']);
chk($out, 'tiktok', 'TikTok — Events API', $ttTok,
  $ttTok ? 'токен доступа на месте, пиксель ' . (string)($c['TIKTOK_PIXEL_ID'] ?? 'DACVEIRC77UCRCTVA5DG') : 'токен не прописан — уходят только события браузера',
  $ttTok ? '' : "добавьте 'TIKTOK_ACCESS_TOKEN' => '…' в /private/scholary-config.php");

/* ---- Дневные лимиты ИИ ---- */
$dir = dirname($_SERVER['DOCUMENT_ROOT']) . '/private/usage/' . gmdate('Y-m-d') . '.json';
$used = 0;
if (is_file($dir)) { $j = json_decode((string)@file_get_contents($dir), true); if (is_array($j)) foreach ($j as $v) $used += (int)$v; }
chk($out, 'ai_limit', 'Расход ИИ за сегодня', $used < (int)($c['ALL_AI_PER_DAY'] ?? 600),
  $used . ' из ' . (int)($c['ALL_AI_PER_DAY'] ?? 600) . ' общесайтового лимита',
  $used >= (int)($c['ALL_AI_PER_DAY'] ?? 600) ? 'лимит исчерпан — разборы сегодня отключены' : '');

/* ---- Журнал вебхуков ---- */
$logDir = dirname($_SERVER['DOCUMENT_ROOT']) . '/private/tiptop';
$log = $logDir . '/log-' . gmdate('Y-m') . '.jsonl';
$lines = is_file($log) ? @file($log, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
/* Считаем отдельно: подделанная подпись — тревога, несовпавшая сумма —
   чаще всего наша же рассинхронизация прайса, а не атака. */
$forged = 0; $mismatch = 0; $selfTests = 0; $last = null;
$selfIp = (string)($_SERVER['SERVER_ADDR'] ?? '');
foreach ((array)$lines as $l) {
  $j = json_decode($l, true);
  if (!is_array($j)) continue;
  $w = $j['what'] ?? '';
  if ($w === 'bad_signature') {
    /* Скрипт самопроверки нарочно шлёт уведомление с чужой подписью —
       и делает это с этого же сервера. Такие записи не тревога. */
    if (!empty($j['self']) || (isset($j['ip']) && $selfIp !== '' && $j['ip'] === $selfIp)) $selfTests++;
    else $forged++;
  }
  if ($w === 'mismatch' || $w === 'declined') $mismatch++;
  $last = $j['t'] ?? $last;
}
chk($out, 'tiptop_log', 'Журнал уведомлений шлюза', $forged === 0,
  count($lines) . ' записей за месяц' . ($last ? ', последняя ' . $last : '') .
    ($forged ? '; с чужой подписью: ' . $forged : '') . ($mismatch ? '; отклонено по сумме: ' . $mismatch : '') .
    ($selfTests ? '; из них наших самопроверок: ' . $selfTests : ''),
  $forged ? 'кто-то шлёт уведомления с чужой подписью — посмотреть private/tiptop/'
          : ($mismatch ? 'были отказы по сумме: сверить цены в js/config.js и в списке $PRICES в api/tiptop.php' : ''));

/* Отдельное действие: реально отправить письмо себе.
   Единственный честный способ проверить, что почта доходит. */
if (!empty($in['send_test'])) {
  $sent = notify_owner('Проверка связи из панели Scholary', [
    'Что это'  => 'тестовое письмо из раздела «Система»',
    'Когда'    => date('d.m.Y H:i'),
    'Что дальше' => 'если письмо пришло — почта работает, ничего делать не нужно',
  ]);
  jout(['ok' => true, 'sent' => $sent, 'items' => $out]);
}

jout(['ok' => true, 'checked_at' => gmdate('c'), 'items' => $out]);
