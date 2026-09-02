<?php
/* Scholary · ИИ-слой: проверка документа и разбор мотивационного письма.
   Вызывается из кабинета. Требует токен пользователя Supabase.
   Правила (doc-rules.js) работают всегда; этот эндпоинт добавляет
   поверх них разбор модели. При любой ошибке клиент остаётся на правилах. */
require __DIR__ . '/_lib.php';
cors();
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') jout(['error' => 'method'], 405);

$in    = body();
$token = $in['token'] ?? '';
$kind  = $in['kind'] ?? '';
/* Тип разбора проверяем ДО списания лимита: иначе кривой запрос
   молча съедал бы попытки живого человека. */
if (!in_array($kind, ['doc', 'letter'], true)) jout(['error' => 'unknown_kind'], 400);

$user = auth_user($token);
if (!$user) jout(['error' => 'unauthorized'], 401);

$c   = cfg();
$pro = is_pro($token, $user['id']);
$MODEL = $pro ? ($c['ANTHROPIC_MODEL_PRO'] ?? $c['ANTHROPIC_MODEL'])
              : ($c['ANTHROPIC_MODEL_FREE'] ?? $c['ANTHROPIC_MODEL']);

/* Общий предохранитель на весь сайт: регистрация свободная, поэтому
   без него можно завести много аккаунтов и сжечь бюджет на модель. */
$all = rate_check('all:ai', (int)($c['ALL_AI_PER_DAY'] ?? 600));
if (!$all['ok']) jout(['error' => 'busy'], 429);

$rl = rate_check($user['id'], $pro ? (int)$c['PRO_AI_PER_DAY'] : (int)$c['FREE_AI_PER_DAY']);
if (!$rl['ok']) jout(['error' => 'limit', 'used' => $rl['used'], 'limit' => $rl['limit'], 'pro' => $pro], 429);

/* Обрезаем всё, что уходит в модель: длина запроса = деньги. */
function trim_deep($v, $maxStr = 400, $depth = 0) {
  if (is_string($v)) return mb_substr($v, 0, $maxStr);
  if (is_array($v)) {
    if ($depth > 3) return null;
    $out = []; $i = 0;
    foreach ($v as $k => $x) { if (++$i > 40) break; $out[$k] = trim_deep($x, $maxStr, $depth + 1); }
    return $out;
  }
  return $v;
}

$SYS = "Ты — методист приёмной комиссии и консультант по поступлению за рубеж для казахстанских абитуриентов.\n" .
  "Правила:\n" .
  "1. Отвечай СТРОГО валидным JSON без пояснений вокруг.\n" .
  "2. Пиши по-русски, обращение на «ты», коротко и по делу, без воды и без гарантий.\n" .
  "3. Не выдумывай требования программ: опирайся только на данные, которые тебе передали. Если данных не хватает — так и скажи и предложи проверить официальный сайт.\n" .
  "4. Формулируй как «похоже, что…», «проверь…», а не как окончательный вердикт приёмной комиссии.\n" .
  "5. Никаких обещаний поступления, виз и юридических выводов.\n" .
  "6. Никогда не цитируй технические названия полей и коды статусов из входных данных — пиши обычными словами.\n" .
  "7. Ссылайся на конкретные программы абитуриента по названию, а не «первая подача».";

if ($kind === 'doc') {
  $doc  = trim_deep($in['doc'] ?? []);
  $apps = trim_deep(array_slice($in['apps'] ?? [], 0, 12));
  $u = "Документ абитуриента и его подачи. Дай список замечаний.\n\n" .
       "ДОКУМЕНТ: " . json_encode($doc, JSON_UNESCAPED_UNICODE) . "\n\n" .
       "ПОДАЧИ (программа, страна, дедлайн, требования): " . json_encode($apps, JSON_UNESCAPED_UNICODE) . "\n\n" .
       "Сегодня: " . date('Y-m-d') . ".\n" .
       "Верни JSON-массив объектов вида {\"level\":\"ok|warn|blocker\",\"title\":\"коротко\",\"text\":\"1-2 предложения что делать\"}.\n" .
       "Максимум 6 объектов, сначала blocker, потом warn, потом ok. Учитывай сроки изготовления документов и даты дедлайнов.";
  $r = claude($SYS, $u, 3000, $MODEL);
  if (!$r['ok']) jout(['error' => 'ai_unavailable', 'why' => $r['why']], 502);
  $j = parse_json_block($r['text']);
  if (!is_array($j)) jout(['error' => 'bad_ai_json', 'stop' => $r['stop'] ?? '', 'len' => mb_strlen((string)$r['text'])], 502);
  $out = [];
  foreach (array_slice($j, 0, 6) as $v) {
    if (!is_array($v) || empty($v['title'])) continue;
    $lvl = in_array(($v['level'] ?? 'warn'), ['ok', 'warn', 'blocker'], true) ? $v['level'] : 'warn';
    $out[] = ['level' => $lvl, 'title' => mb_substr((string)$v['title'], 0, 160), 'text' => mb_substr((string)($v['text'] ?? ''), 0, 500), 'ai' => true];
  }
  jout(['ok' => true, 'verdicts' => $out, 'used' => $rl['used'], 'limit' => $rl['limit'], 'pro' => $pro]);
}

if ($kind === 'letter') {
  $text = mb_substr((string)($in['text'] ?? ''), 0, 9000);
  $prog = trim_deep($in['program'] ?? []);
  if (mb_strlen(trim($text)) < 40) jout(['error' => 'too_short'], 400);
  $u = "Разбери мотивационное письмо под конкретную программу.\n\n" .
       "ПРОГРАММА: " . json_encode($prog, JSON_UNESCAPED_UNICODE) . "\n\n" .
       "ПИСЬМО:\n" . $text . "\n\n" .
       "Верни JSON вида {\"score\":число 0-10,\"criteria\":[{\"k\":\"название\",\"v\":число 0-10}],\"verdicts\":[{\"level\":\"ok|warn|blocker\",\"title\":\"...\",\"text\":\"...\"}]}.\n" .
       "Критерии ровно эти пять: Конкретика, Связь с программой, Структура, Язык и клише, Что после выпуска.\n" .
       "В verdicts 3-6 пунктов с КОНКРЕТНЫМИ правками: что заменить и на что. Цитируй проблемные фразы письма.";
  $r = claude($SYS, $u, 4000, $MODEL);
  if (!$r['ok']) jout(['error' => 'ai_unavailable', 'why' => $r['why']], 502);
  $j = parse_json_block($r['text']);
  if (!is_array($j) || !isset($j['score'])) jout(['error' => 'bad_ai_json', 'stop' => $r['stop'] ?? '', 'len' => mb_strlen((string)$r['text'])], 502);
  $crit = [];
  foreach (array_slice($j['criteria'] ?? [], 0, 6) as $x) {
    if (!empty($x['k'])) $crit[] = ['k' => mb_substr((string)$x['k'], 0, 40), 'v' => max(0, min(10, (float)($x['v'] ?? 0)))];
  }
  $vs = [];
  foreach (array_slice($j['verdicts'] ?? [], 0, 6) as $v) {
    if (empty($v['title'])) continue;
    $lvl = in_array(($v['level'] ?? 'warn'), ['ok', 'warn', 'blocker'], true) ? $v['level'] : 'warn';
    $vs[] = ['level' => $lvl, 'title' => mb_substr((string)$v['title'], 0, 160), 'text' => mb_substr((string)($v['text'] ?? ''), 0, 600), 'ai' => true];
  }
  jout(['ok' => true, 'score' => max(0, min(10, (float)$j['score'])), 'criteria' => $crit, 'verdicts' => $vs,
        'used' => $rl['used'], 'limit' => $rl['limit'], 'pro' => $pro]);
}

/* сюда не доходим: kind проверен выше */
jout(['error' => 'unknown_kind'], 400);
