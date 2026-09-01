<?php
/* Scholary · вебхук Telegram-бота.
   Telegram шлёт сюда апдейты. Секрет проверяем заголовком, который
   Telegram добавляет сам (setWebhook с параметром secret_token) —
   без него запрос не принимаем.
   Бот умеет ровно две вещи: привязать аккаунт по одноразовому коду
   из кабинета и отвязаться. Никаких данных пользователя он не читает. */
require __DIR__ . '/_lib.php';

$c = cfg();
if (empty($c['TELEGRAM_TOKEN'])) { http_response_code(503); echo 'bot off'; exit; }

$got = $_SERVER['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN'] ?? '';
if (empty($c['TELEGRAM_SECRET']) || !hash_equals((string)$c['TELEGRAM_SECRET'], (string)$got)) {
  http_response_code(403); echo 'forbidden'; exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { http_response_code(405); echo 'method'; exit; }

$u   = body(60000);
$msg = $u['message'] ?? $u['edited_message'] ?? null;
if (!$msg) { echo 'ok'; exit; }

$chat = (string)($msg['chat']['id'] ?? '');
$text = trim((string)($msg['text'] ?? ''));
if ($chat === '') { echo 'ok'; exit; }

function tg_send($token, $chat, $text) {
  http_json('https://api.telegram.org/bot' . $token . '/sendMessage', 'POST',
    ['Content-Type: application/json'],
    ['chat_id' => $chat, 'text' => $text, 'parse_mode' => 'HTML', 'disable_web_page_preview' => true], 15);
}
function rpc($c, $fn, $args) {
  return http_json($c['SUPABASE_URL'] . '/rest/v1/rpc/' . $fn, 'POST', [
    'apikey: ' . $c['SUPABASE_ANON'],
    'Authorization: Bearer ' . $c['SUPABASE_ANON'],
    'Content-Type: application/json',
  ], $args, 15);
}

if (preg_match('/^\/start(?:\s+(\S+))?/u', $text, $m)) {
  $code = $m[1] ?? '';
  if ($code === '') {
    tg_send($c['TELEGRAM_TOKEN'], $chat,
      "Привет! Это бот Scholary.\n\nЯ присылаю напоминания о дедлайнах и один шаг дня — не чаще раза в день.\n\n" .
      "Чтобы привязать аккаунт, открой кабинет на scholary.kz → Профиль → Уведомления в Telegram и нажми кнопку там. " .
      "Или пришли мне код привязки одним сообщением.");
    echo 'ok'; exit;
  }
  $r = rpc($c, 'tg_bind', ['p_code' => strtoupper($code), 'p_chat_id' => $chat]);
  $okBind = ($r['code'] === 200 && $r['json'] === true);
  tg_send($c['TELEGRAM_TOKEN'], $chat, $okBind
    ? "Готово — аккаунт привязан.\n\nБуду писать о дедлайнах за 30, 14, 7, 3 и 1 день и присылать шаг дня. Тихие часы 22:00–08:00.\nОтключить: /stop"
    : "Такой код не подошёл. Он одноразовый и живёт до первой привязки — открой кабинет ещё раз и возьми свежий: scholary.kz/cabinet/ → Профиль → Уведомления в Telegram.");
  echo 'ok'; exit;
}

if (preg_match('/^\/(stop|unlink)/u', $text)) {
  rpc($c, 'tg_unbind', ['p_chat_id' => $chat]);
  tg_send($c['TELEGRAM_TOKEN'], $chat, "Отключил уведомления. Вернуться можно тем же кодом из кабинета.");
  echo 'ok'; exit;
}

if (preg_match('/^[A-Za-z0-9]{6,12}$/u', $text)) {
  $r = rpc($c, 'tg_bind', ['p_code' => strtoupper($text), 'p_chat_id' => $chat]);
  $okBind = ($r['code'] === 200 && $r['json'] === true);
  tg_send($c['TELEGRAM_TOKEN'], $chat, $okBind
    ? "Готово — аккаунт привязан. Отключить: /stop"
    : "Код не подошёл. Возьми свежий в кабинете: Профиль → Уведомления в Telegram.");
  echo 'ok'; exit;
}

tg_send($c['TELEGRAM_TOKEN'], $chat,
  "Я умею только напоминать о дедлайнах.\n\n/start — привязать аккаунт кодом из кабинета\n/stop — отключить уведомления\n\n" .
  "Вопросы по поступлению — на сайте: scholary.kz");
echo 'ok';
