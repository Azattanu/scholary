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

$sent = 0; $failed = 0;
foreach ($byChat as $chat => $list) {
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
    . "\n\nhttps://scholary.kz/cabinet/\n\nОтключить напоминания: /stop";

  $res = http_json('https://api.telegram.org/bot' . $c['TELEGRAM_TOKEN'] . '/sendMessage', 'POST',
    ['Content-Type: application/json'],
    ['chat_id' => $chat, 'text' => $msg, 'parse_mode' => 'HTML', 'disable_web_page_preview' => true], 15);

  $okSend = ($res['code'] >= 200 && $res['code'] < 300);
  if ($okSend) {
    $sent++;
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
  } else {
    $failed++;
    /* 403 от Telegram = человек заблокировал бота. Это не наша ошибка,
       но и слать ему больше нечего — помечаем, чтобы не долбиться каждый день. */
    if ((int)$res['code'] === 403) {
      foreach ($list as $it) {
        tgs_rpc($c, 'tg_mark_sent', [
          'p_secret' => $c['TIPTOP_RPC_SECRET'], 'p_user' => $it['user_id'],
          'p_program' => $it['program_id'], 'p_milestone' => (int)$it['milestone'],
        ]);
      }
    }
  }
  usleep(120000);   // ~8 сообщений в секунду: лимит Telegram — 30
}

header('Content-Type: application/json; charset=utf-8');
echo json_encode(['ok' => true, 'people' => count($byChat), 'sent' => $sent, 'failed' => $failed, 'items' => count($items)], JSON_UNESCAPED_UNICODE);
