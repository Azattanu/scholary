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
  $r = http_json('https://api.resend.com/domains', 'GET', ['Authorization: Bearer ' . $c['RESEND_KEY']], null, 12);
  $doms = $r['json']['data'] ?? [];
  $ver = [];
  foreach ((array)$doms as $d) if (($d['status'] ?? '') === 'verified') $ver[] = $d['name'] ?? '';
  $from = (string)($c['MAIL_FROM'] ?? '');
  $ownDomain = strpos($from, 'scholary.kz') !== false;
  chk($out, 'resend', 'Resend — письма', $r['code'] === 200,
    $r['code'] === 200
      ? ('ключ рабочий; подтверждённых доменов: ' . count($ver) . ($ver ? ' (' . implode(', ', $ver) . ')' : '') .
         '; отправитель ' . ($ownDomain ? 'свой домен' : 'общий адрес Resend'))
      : 'код ответа ' . $r['code'],
    $ownDomain ? '' : 'письма уходят с общего адреса Resend — часть попадёт в спам. Нужны DNS-записи для scholary.kz');
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
$bad = 0; $last = null;
foreach ((array)$lines as $l) {
  $j = json_decode($l, true);
  if (!is_array($j)) continue;
  if (($j['what'] ?? '') === 'bad_signature' || ($j['what'] ?? '') === 'mismatch') $bad++;
  $last = $j['t'] ?? $last;
}
chk($out, 'tiptop_log', 'Журнал уведомлений шлюза', $bad === 0,
  count($lines) . ' записей за месяц' . ($last ? ', последняя ' . $last : '') . ($bad ? '; подозрительных: ' . $bad : ''),
  $bad ? 'есть уведомления с неверной подписью или суммой — посмотреть private/tiptop/' : '');

jout(['ok' => true, 'checked_at' => gmdate('c'), 'items' => $out]);
