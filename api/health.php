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
$apKey = !empty($c['APIPAY_KEY']); $apSec = !empty($c['APIPAY_WEBHOOK_SECRET']); $apOn = !empty($c['APIPAY_ENABLED']);
if ($apKey) {
  $ah = http_json(rtrim((string)($c['APIPAY_BASE'] ?? 'https://api.apipay.kz/api/v1'), '/') . '/account/health', 'GET', ['X-API-Key: ' . $c['APIPAY_KEY'], 'Accept: application/json'], null, 15);
  $aj = is_array($ah['json']) ? $ah['json'] : [];
  $conn = $aj['connection'] ?? []; $tar = $aj['tariff'] ?? [];
  $kOk = $ah['code'] === 200 && !empty($conn['kaspi_connected']) && empty($conn['needs_reauth']) && in_array((string)($tar['status'] ?? ''), ['active', 'trial'], true);
  require_once __DIR__ . '/_kaspi.php';
  $stuck = kaspi_unfulfilled();            /* оплачено, но не выдано дольше 10 минут */
  $dirOk = is_writable(kaspi_dir('orders'));
  /* Тариф ApiPay кончается — счета перестанут выставляться в один день. Предупреждаем за две недели. */
  $daysLeft = isset($tar['days_remaining']) ? (int)$tar['days_remaining'] : null;
  $soon = $daysLeft !== null && $daysLeft <= 14;
  $allOk = $kOk && $apSec && $apOn && $dirOk && $stuck === 0 && !$soon;
  chk($out, 'kaspi', 'Kaspi — оплата через ApiPay', $allOk,
    $ah['code'] !== 200 ? 'ApiPay не отвечает (HTTP ' . $ah['code'] . ')'
      : (($apOn ? 'включена' : 'ВЫКЛЮЧЕНА (APIPAY_ENABLED)') . ' · кассир ' . (!empty($conn['kaspi_connected']) ? 'подключён' : 'НЕ подключён') . (!empty($conn['needs_reauth']) ? ', нужна переавторизация' : '')
        . ' · тариф ' . (string)($tar['status'] ?? '?') . ($daysLeft !== null ? ', осталось дней: ' . $daysLeft : '') . (!empty($tar['expires_at']) ? ' (до ' . substr((string)$tar['expires_at'], 0, 10) . ')' : '')
        . ($apSec ? '' : ' · НЕТ секрета вебхука') . ($dirOk ? '' : ' · папка заказов не пишется') . ($stuck ? ' · ОПЛАЧЕНО, НО НЕ ВЫДАНО: ' . $stuck : '')),
    $stuck ? 'есть оплаченные заказы без выдачи — смотреть письма «разобрать вручную» и /private/kaspi/orders'
           : ($soon ? 'тариф ApiPay кончается через ' . $daysLeft . ' дн. — продлить в кабинете apipay.kz, иначе кнопка Kaspi перестанет выставлять счета'
           : ($allOk ? '' : 'кнопка Kaspi на сайте не выставит счёт — проверить кабинет apipay.kz (кассир, тариф) и /private/apipay-secrets.php')));

  /* ---- Заказы Kaspi за 30 дней и журнал: что реально происходило ---- */
  $ks = kaspi_orders_summary(30);
  $klog = kaspi_dir('') . '/log-' . gmdate('Y-m') . '.jsonl';
  $klines = is_file($klog) ? @file($klog, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
  $kc = []; $ktail = [];
  foreach ((array)$klines as $l) { $j = json_decode($l, true); if (!is_array($j)) continue; $k = ($j['type'] ?? '?') . '/' . ($j['what'] ?? '?'); $kc[$k] = ($kc[$k] ?? 0) + 1; }
  foreach (array_slice((array)$klines, -8) as $l) { $j = json_decode($l, true); if (!is_array($j)) continue;
    $ktail[] = substr((string)($j['t'] ?? ''), 5, 11) . ' ' . ($j['type'] ?? '') . '/' . ($j['what'] ?? '') . (isset($j['kind']) ? ' ' . $j['kind'] : '') . (isset($j['to']) ? ' →' . $j['to'] : '') . (isset($j['why']) ? ' ' . clean_txt((string)$j['why'], 30) : '') . (isset($j['code']) ? ' http' . (int)$j['code'] : ''); }
  arsort($kc);
  $kbad = ($ks['undelivered'] ?? 0) + ($ks['retrying'] ?? 0);
  chk($out, 'kaspi_orders', 'Kaspi — заказы за 30 дней', $kbad === 0,
    'счетов ' . $ks['total'] . ' · оплачено ' . $ks['paid'] . ' на ' . number_format($ks['sum_paid'], 0, '.', ' ') . ' ₸ · выдано ' . $ks['fulfilled']
      . ' · ждут оплаты ' . $ks['pending'] . ' · ошибка номера/Kaspi ' . $ks['error'] . ' · истекло ' . $ks['expired'] . ' · отменено ' . $ks['cancelled']
      . ($ks['sandbox'] ? ' · песочница ' . $ks['sandbox'] : '') . ($ks['undelivered'] ? ' · НЕ ДОСТАВЛЕНО (ни WhatsApp, ни почта): ' . $ks['undelivered'] : '') . ($ks['retrying'] ? ' · ждут повтора выдачи (база молчала): ' . $ks['retrying'] : '')
      . ' · журнал за месяц: ' . implode(', ', array_map(function ($k, $v) { return $k . ' ' . $v; }, array_keys(array_slice($kc, 0, 8, true)), array_slice($kc, 0, 8, true)))
      . ($ktail ? ' · последние: ' . implode('; ', $ktail) : ''),
    $kbad ? 'открыть вкладку «Отчёты» → «Отправить ещё раз» для недоставленных; если база молчит — смотреть Supabase' : '');

  /* ---- Цены: сайт (js/config.js) и сервер (pay_prices) обязаны совпадать ---- */
  $cfgJs = (string)@file_get_contents($_SERVER['DOCUMENT_ROOT'] . '/js/config.js');
  $map = ['PRICE_REPORT' => 'report', 'PRICE_CONSULT' => 'consult', 'PRICE_PACKAGE' => 'package', 'PRICE_PRO_MONTH' => 'pro_month', 'PRICE_PRO_SEASON' => 'pro_season'];
  $diff = []; $seen = 0;
  foreach ($map as $jsKey => $kind) {
    if (preg_match('/' . $jsKey . '\s*:\s*(\d+)/', $cfgJs, $m)) { $seen++; if ((int)$m[1] !== pay_price_of($kind)) $diff[] = $jsKey . ' ' . $m[1] . ' ≠ ' . pay_price_of($kind); }
  }
  chk($out, 'prices', 'Цены — сайт и сервер', !$diff && $seen >= 3,
    $seen ? ($diff ? 'РАСХОДЯТСЯ: ' . implode(', ', $diff) : 'совпадают (' . $seen . ' позиций): ' . implode(', ', array_map(function ($s, $k) { return $k . ' ' . $s; }, array_keys(pay_prices()), pay_prices()))) : 'js/config.js не прочитан',
    $diff ? 'сервер берёт цену из pay_prices() в api/_pay.php — счёт выставится по серверной цене, а кнопка на сайте обещает другую' : '');
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
$susp = [];
foreach ((array)$lines as $l) { $j = json_decode($l, true); if (!is_array($j)) continue; $w = $j['what'] ?? '';
  if (in_array($w, ['bad_signature', 'mismatch', 'declined', 'db_failed', 'failed', 'report_not_issued'], true)) $susp[] = substr((string)($j['t'] ?? ''), 5, 11) . ' ' . ($j['type'] ?? '') . '/' . $w . (isset($j['ip']) ? ' ip ' . $j['ip'] : '') . (isset($j['fn']) ? ' ' . $j['fn'] : '') . (isset($j['amount']) ? ' ' . $j['amount'] : ''); }
$susp = array_slice($susp, -8);
chk($out, 'tiptop_log', 'Журнал уведомлений шлюза', $forged === 0,
  count($lines) . ' записей за месяц' . ($last ? ', последняя ' . $last : '') .
    ($forged ? '; с чужой подписью: ' . $forged : '') . ($mismatch ? '; отклонено по сумме: ' . $mismatch : '') .
    ($selfTests ? '; из них наших самопроверок: ' . $selfTests : '') . ($susp ? ' · последние отклонения: ' . implode('; ', $susp) : ''),
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
