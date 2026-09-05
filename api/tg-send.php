<?php
/* Scholary · рассылка напоминаний о дедлайнах в Telegram.
   ЗАЧЕМ. Бот умел только привязать аккаунт: в кабинете и в самом боте мы
   обещали «дедлайны за 30/14/7/3/1 день», но отправлять их было некому.
   Этот скрипт закрывает обещание.

   КАК ЗАПУСКАЕТСЯ. Планировщиком Plesk раз в сутки утром:
     curl -s -m 300 "https://scholary.kz/api/tg-send.php?key=<TG_CRON_KEY>"
   Ключ лежит в private/scholary-config.php. Без ключа — 403.

   ПОЧЕМУ УТРОМ. У бота обещаны тихие часы 22:00–08:00, и мы их соблюдаем:
   если скрипт вызвали в тихое время, он ничего не шлёт и выходит. */
require __DIR__ . '/_lib.php';

$c = cfg();
$key = (string)($_GET['key'] ?? '');
if (empty($c['TG_CRON_KEY']) || !hash_equals((string)$c['TG_CRON_KEY'], $key)) {
  http_response_code(403); echo 'forbidden'; exit;
}
if (empty($c['TELEGRAM_TOKEN']) || empty($c['TIPTOP_RPC_SECRET'])) {
  http_response_code(503); echo 'not configured'; exit;
}

/* Тихие часы: считаем по времени Казахстана (UTC+5), сервер живёт в UTC. */
$hourKz = (int)gmdate('H', time() + 5 * 3600);
if ($hourKz < 8 || $hourKz >= 22) { echo json_encode(['ok' => true, 'skipped' => 'quiet_hours', 'hour_kz' => $hourKz]); exit; }

function tgs_rpc($c, $fn, $args) {
  return http_json($c['SUPABASE_URL'] . '/rest/v1/rpc/' . $fn, 'POST', [
    'apikey: ' . $c['SUPABASE_ANON'],
    'Authorization: Bearer ' . $c['SUPABASE_ANON'],
    'Content-Type: application/json',
  ], $args, 25);
}

$r = tgs_rpc($c, 'tg_due', ['p_secret' => $c['TIPTOP_RPC_SECRET']]);
$j = is_array($r['json']) ? $r['json'] : null;
if (!$j || empty($j['ok'])) { http_response_code(502); echo json_encode(['ok' => false, 'why' => 'rpc']); exit; }

$items = is_array($j['items'] ?? null) ? $j['items'] : [];

/* web-74 · недельный ритм. Понедельник — дайджест недели (план, документы,
   ближайший дедлайн), четверг — «неделя ещё не засчитана» тем, у кого на
   этой неделе не было ни одного действия. Обещание «не больше одного
   сообщения в день» держим: если человеку сегодня уходит письмо о дедлайне,
   недельная часть приклеивается к нему, а не идёт отдельным сообщением.
   ?kind=digest|nudge|ws — принудительно (для проверки), ?dry=1 — не отправлять. */
$dowKz = (int)gmdate('N', time() + 5 * 3600);   // 1 = понедельник
$forceKind = (string)($_GET['kind'] ?? '');
$weekKind = $forceKind === 'digest' || $forceKind === 'nudge' ? $forceKind : ($dowKz === 1 ? 'digest' : ($dowKz === 4 ? 'nudge' : ''));
$dry = !empty($_GET['dry']);
$weekItems = []; $weekMs = 0; $weekStart = '';
if ($weekKind !== '') {
  $rw = tgs_rpc($c, 'tg_week_due', ['p_secret' => $c['TIPTOP_RPC_SECRET'], 'p_kind' => $weekKind]);
  $jw = is_array($rw['json']) ? $rw['json'] : null;
  if ($jw && !empty($jw['ok'])) {
    $weekItems = is_array($jw['items'] ?? null) ? $jw['items'] : [];
    $weekMs = (int)($jw['milestone'] ?? 0); $weekStart = (string)($jw['week_start'] ?? '');
  }
}
$weekByChat = [];
foreach ($weekItems as $it) { $chat = (string)($it['chat_id'] ?? ''); if ($chat !== '') $weekByChat[$chat] = $it; }

/* web-75 · дайджест профориентологу по понедельникам (workspace): дедлайны недели,
   встречи, просроченное, кто без следующего шага. Тот же лимит «одно сообщение в день». */
$wsKind = $forceKind === 'ws' || ($forceKind === '' && $dowKz === 1);
$wsItems = []; $wsMs = 0; $wsStart = '';
if ($wsKind) {
  $rws = tgs_rpc($c, 'ws_digest_due', ['p_secret' => $c['TIPTOP_RPC_SECRET']]);
  $jws = is_array($rws['json']) ? $rws['json'] : null;
  if ($jws && !empty($jws['ok'])) { $wsItems = is_array($jws['items'] ?? null) ? $jws['items'] : []; $wsMs = (int)($jws['milestone'] ?? 110); $wsStart = (string)($jws['week_start'] ?? ''); }
}
$wsByChat = [];
foreach ($wsItems as $it) { $chat = (string)($it['chat_id'] ?? ''); if ($chat !== '') $wsByChat[$chat] = $it; }

function ws_text($it) {
  $name = trim((string)($it['name'] ?? '')); $name = $name !== '' ? explode(' ', $name)[0] : 'Коллега';
  $n = (int)($it['students'] ?? 0); $dl7 = (int)($it['deadlines_7'] ?? 0); $dl45 = (int)($it['deadlines_45'] ?? 0); $od = (int)($it['overdue'] ?? 0); $mt = (int)($it['meetings'] ?? 0); $ns = (int)($it['no_step'] ?? 0); $idle = (int)($it['idle'] ?? 0);
  $lines = [$name . ', план недели по workspace (' . $n . ' ' . plural_ru($n, 'ученик', 'ученика', 'учеников') . '):', ''];
  $lines[] = '• Дедлайнов на этой неделе: <b>' . $dl7 . '</b>' . ($dl45 ? ' · в 45 дней: ' . $dl45 : '');
  if ($od) $lines[] = '• Просроченных задач: <b>' . $od . '</b>';
  if ($mt) $lines[] = '• Встреч с семьями: <b>' . $mt . '</b>';
  if ($ns) $lines[] = '• Без следующего шага: <b>' . $ns . '</b> — назначьте по одному в «Неделе»';
  if ($idle) $lines[] = '• Без касания 14+ дней: <b>' . $idle . '</b>';
  if (!$od && !$ns && !$dl7) $lines[] = '• Срочного нет — хорошее время для статусов семьям';
  $lines[] = '';
  $lines[] = 'Открыть неделю: https://scholary.kz/prof/cabinet/?from=tg#/week';
  $lines[] = '';
  $lines[] = 'Отключить: Настройки → «Мой ритм» или /stop';
  return implode("\n", $lines);
}

/* $short — часть письма, которое уже начинается с обращения и ссылки на кабинет:
   без повторного имени и без второй ссылки. */
function week_text($it, $kind, $short = false) {
  $name = trim((string)($it['name'] ?? '')); $name = $name !== '' ? explode(' ', $name)[0] : 'друг';
  $week = (int)($it['week'] ?? 0); $open = (int)($it['apps_open'] ?? 0); $dr = (int)($it['docs_ready'] ?? 0); $dt = (int)($it['docs_total'] ?? 0);
  $np = trim((string)($it['next_program'] ?? '')); $nd = $it['next_days'] ?? null; $done = (int)($it['tasks_done'] ?? 0); $prev = (int)($it['tasks_done_prev'] ?? 0);
  $link = 'https://scholary.kz/cabinet/?tab=today&from=tg';
  if ($kind === 'nudge') {
    return ($short ? 'На этой неделе' : $name . ', на этой неделе') . ' в кабинете пока тихо — а неделя засчитывается за одну закрытую задачу.'
      . ($np !== '' && $nd !== null && !$short ? "\n\nБлижайший дедлайн: <b>" . htmlspecialchars($np, ENT_QUOTES, 'UTF-8') . '</b> — через ' . (int)$nd . ' ' . plural_ru((int)$nd, 'день', 'дня', 'дней') . '.' : '')
      . ($short ? "\n\nВ плане недели есть задача на 10 минут — этого достаточно." : "\n\nОткрой план недели — там одна задача на 10 минут: " . $link)
      . "\n\nОтключить: Профиль → «Моя неделя» или /stop";
  }
  $lines = [];
  $lines[] = ($short ? 'План на неделю ' : $name . ', план на неделю ') . ($week ?: '?') . ' сезона готов.';
  $lines[] = '';
  $lines[] = '• Открытых подач: <b>' . $open . '</b>' . ($dt ? ' · документов готово: <b>' . $dr . ' из ' . $dt . '</b>' : '');
  if ($np !== '' && $nd !== null) $lines[] = '• Ближайший дедлайн: <b>' . htmlspecialchars($np, ENT_QUOTES, 'UTF-8') . '</b> — через ' . (int)$nd . ' ' . plural_ru((int)$nd, 'день', 'дня', 'дней');
  $lines[] = '• Прошлая неделя: ' . ($prev ? 'закрыто ' . $prev . ' ' . plural_ru($prev, 'задача', 'задачи', 'задач') . ' 👍' : 'задачи не закрывались — на этой неделе достаточно одной');
  if (!$short) { $lines[] = ''; $lines[] = 'Открыть план недели: ' . $link; }
  $lines[] = '';
  $lines[] = 'Отключить дайджест: Профиль → «Моя неделя» или /stop';
  return implode("\n", $lines);
}

/* Не больше одного сообщения в день на человека — так обещано в боте.
   Если у человека сегодня несколько рубежей, собираем их в одно письмо. */
$byChat = [];
foreach ($items as $it) {
  $chat = (string)($it['chat_id'] ?? '');
  if ($chat === '') continue;
  $byChat[$chat][] = $it;
}

function plural_ru($n, $a, $b, $c) {
  $x = $n % 100; if ($x > 4 && $x < 20) return $c;
  $x = $n % 10;  return $x === 1 ? $a : ($x > 1 && $x < 5 ? $b : $c);
}

$sent = 0; $failed = 0; $weekSent = 0; $wsSent = 0; $preview = null;
$chats = array_values(array_unique(array_merge(array_keys($byChat), array_keys($weekByChat), array_keys($wsByChat))));
foreach ($chats as $chat) {
  $list = $byChat[$chat] ?? [];
  $msg = '';
  if ($list) {
    usort($list, function ($a, $b) { return (int)$a['milestone'] - (int)$b['milestone']; });
    $first = $list[0];
    $name  = trim((string)($first['name'] ?? ''));
    $name  = $name !== '' ? explode(' ', $name)[0] : 'друг';

    $lines = [];
    foreach (array_slice($list, 0, 5) as $it) {
      $d = (int)$it['milestone'];
      $lines[] = '• <b>' . htmlspecialchars((string)$it['program'], ENT_QUOTES, 'UTF-8') . '</b> — через '
        . $d . ' ' . plural_ru($d, 'день', 'дня', 'дней')
        . ' (' . htmlspecialchars((string)$it['deadline'], ENT_QUOTES, 'UTF-8') . ')';
    }
    $n = count($list);
    $head = $n === 1
      ? $name . ', напоминаю про дедлайн:'
      : $name . ', ' . $n . ' ' . plural_ru($n, 'дедлайн приближается', 'дедлайна приближаются', 'дедлайнов приближаются') . ':';

    $tail = ((int)$first['milestone'] <= 3)
      ? "\n\nЭто последние дни. Если чего-то не хватает — открой кабинет и посмотри, что ещё можно успеть."
      : "\n\nОткрой кабинет: там видно, какие документы по этим подачам ещё не собраны и что делается дольше всего.";

    $msg = $head . "\n\n" . implode("\n", $lines) . $tail
      . "\n\nhttps://scholary.kz/cabinet/?tab=today&from=tg";
  }
  $wi = $weekByChat[$chat] ?? null;
  if ($wi) {
    /* к письму о дедлайне добавляем короткую недельную часть: без повтора имени и ссылки */
    $msg = $msg === '' ? week_text($wi, $weekKind) : $msg . "\n\n— — —\n\n" . week_text($wi, $weekKind, true);
  }
  $wsi = $wsByChat[$chat] ?? null;
  if ($wsi) { $wt2 = ws_text($wsi); $msg = $msg === '' ? $wt2 : $msg . "\n\n— — —\n\n" . preg_replace('~\n\nОтключить: [^\n]+$~u', '', $wt2); }
  if ($msg === '') continue;
  if (strpos($msg, '/stop') === false) $msg .= "\n\nОтключить напоминания: /stop";
  if ($preview === null) $preview = $msg;
  if ($dry) { $sent++; continue; }

  $res = http_json('https://api.telegram.org/bot' . $c['TELEGRAM_TOKEN'] . '/sendMessage', 'POST',
    ['Content-Type: application/json'],
    ['chat_id' => $chat, 'text' => $msg, 'parse_mode' => 'HTML', 'disable_web_page_preview' => true], 15);

  $okSend = ($res['code'] >= 200 && $res['code'] < 300);
  /* 403 от Telegram = человек заблокировал бота. Это не наша ошибка,
     но и слать ему больше нечего — помечаем, чтобы не долбиться каждый день. */
  $mark = $okSend || (int)$res['code'] === 403;
  if ($okSend) $sent++; else $failed++;
  if ($mark) {
    /* Отмечаем ВСЕ рубежи этого письма, а не только первый: иначе завтра
       человек получит то же самое ещё раз. */
    foreach ($list as $it) {
      tgs_rpc($c, 'tg_mark_sent', [
        'p_secret'    => $c['TIPTOP_RPC_SECRET'],
        'p_user'      => $it['user_id'],
        'p_program'   => $it['program_id'],
        'p_milestone' => (int)$it['milestone'],
      ]);
    }
    if ($wi) {
      $weekSent++;
      tgs_rpc($c, 'tg_mark_sent', [
        'p_secret' => $c['TIPTOP_RPC_SECRET'], 'p_user' => $wi['user_id'],
        'p_program' => 'week:' . $weekStart, 'p_milestone' => $weekMs,
      ]);
    }
    if ($wsi) {
      $wsSent++;
      tgs_rpc($c, 'tg_mark_sent', [
        'p_secret' => $c['TIPTOP_RPC_SECRET'], 'p_user' => $wsi['user_id'],
        'p_program' => 'ws:' . $wsStart, 'p_milestone' => $wsMs,
      ]);
    }
  }
  usleep(120000);   // ~8 сообщений в секунду: лимит Telegram — 30
}

header('Content-Type: application/json; charset=utf-8');
echo json_encode(['ok' => true, 'people' => count($chats), 'sent' => $sent, 'failed' => $failed, 'items' => count($items),
  'week' => ['kind' => $weekKind, 'people' => count($weekByChat), 'sent' => $weekSent, 'dry' => $dry],
  'ws' => ['on' => $wsKind, 'people' => count($wsByChat), 'sent' => $wsSent],
  'preview' => $dry ? $preview : null], JSON_UNESCAPED_UNICODE);
