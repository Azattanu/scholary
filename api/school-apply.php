<?php
/* Scholary · заявка школы на подключение (страница /schools/).
   Что делает: проверяет форму, пишет заявку в базу через узкую RPC с
   секретом (анон в таблицу schools писать не может), шлёт владельцу
   уведомление на почту и WhatsApp, а школе — письмо «заявку получили».
   Лимит: 5 заявок в сутки с одного IP — форма открытая, иначе это спам-рассыльщик. */
require __DIR__ . '/_lib.php';
cors();
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') jout(['error' => 'method'], 405);
if (!same_origin()) jout(['error' => 'forbidden'], 403);

$c  = cfg();
$in = body(8000);

$name  = clean_txt((string)($in['name'] ?? ''), 120);
$city  = clean_txt((string)($in['city'] ?? ''), 60);
$kind  = in_array($in['kind'] ?? '', ['state', 'private', 'other'], true) ? $in['kind'] : 'other';
$cname = clean_txt((string)($in['contact_name'] ?? ''), 80);
$crole = clean_txt((string)($in['contact_role'] ?? ''), 80);
$email = strtolower(trim((string)($in['contact_email'] ?? '')));
$phone = clean_txt((string)($in['contact_phone'] ?? ''), 32);
$plan  = in_array($in['plan'] ?? '', ['pilot', 's100', 's500', 's1000'], true) ? $in['plan'] : 'pilot';
$period= in_array($in['period'] ?? '', ['year', 'month', 'pilot'], true) ? $in['period'] : ($plan === 'pilot' ? 'pilot' : 'year');
$note  = clean_txt((string)($in['note'] ?? ''), 1000);
$exp   = (int)($in['students_expected'] ?? 0);
$src   = clean_txt((string)($in['source'] ?? ''), 60);
/* Ловушка для ботов: поле спрятано со страницы, человек его не заполняет. */
if (trim((string)($in['website'] ?? '')) !== '') jout(['ok' => true, 'bot' => true]);

if (mb_strlen($name) < 3)                                   jout(['ok' => false, 'why' => 'bad_name'], 400);
if (mb_strlen($cname) < 2)                                  jout(['ok' => false, 'why' => 'bad_contact'], 400);
if (!filter_var($email, FILTER_VALIDATE_EMAIL))             jout(['ok' => false, 'why' => 'bad_email'], 400);
if ($phone !== '' && wa_digits($phone) === null)            jout(['ok' => false, 'why' => 'bad_phone'], 400);
if (empty($c['TIPTOP_RPC_SECRET']))                         jout(['ok' => false, 'why' => 'not_configured'], 503);

$rl = rate_check('school-apply:' . client_ip(), 5);
if (!$rl['ok']) jout(['ok' => false, 'why' => 'rate_limited'], 429);

$r = http_json($c['SUPABASE_URL'] . '/rest/v1/rpc/school_apply', 'POST', [
  'apikey: ' . $c['SUPABASE_ANON'],
  'Authorization: Bearer ' . $c['SUPABASE_ANON'],
  'Content-Type: application/json',
], ['p_secret' => $c['TIPTOP_RPC_SECRET'], 'p' => [
  'name' => $name, 'city' => $city, 'kind' => $kind, 'contact_name' => $cname, 'contact_role' => $crole,
  'contact_email' => $email, 'contact_phone' => $phone, 'plan' => $plan, 'period' => $period,
  'note' => $note, 'students_expected' => $exp > 0 ? $exp : null, 'source' => $src,
]], 20);
$j = is_array($r['json']) ? $r['json'] : null;
if (!$j || empty($j['ok'])) jout(['ok' => false, 'why' => is_array($j) ? ($j['why'] ?? 'rpc') : 'rpc'], 502);

$PLANS = ['pilot' => 'Пилот (бесплатно, 30 дней, до 50 учеников)', 's100' => 'Класс · до 100 учеников',
          's500' => 'Школа · до 500 учеников', 's1000' => 'Сеть · до 1000 учеников'];
$KIND  = ['state' => 'государственная', 'private' => 'частная', 'other' => 'другое'];

/* Школе — «получили, ответим». Владельцу — карточка заявки. Оба письма
   не критичны: заявка уже в базе, поэтому сбой почты не ломает ответ. */
if (empty($j['dup'])) {
  notify_owner('Заявка от школы: ' . $name, [
    'Имя'        => $cname . ($crole !== '' ? ' (' . $crole . ')' : ''),
    'Школа'      => $name . ($city !== '' ? ', ' . $city : '') . ' · ' . $KIND[$kind],
    'Почта'      => $email,
    'Телефон'    => $phone !== '' ? $phone : '—',
    'Тариф'      => $PLANS[$plan] . ($period === 'month' ? ' · помесячно' : ''),
    'Учеников'   => $exp > 0 ? (string)$exp : '—',
    'Комментарий'=> $note !== '' ? $note : '—',
    'Что делать' => 'админка → Школы → «Активировать» (письмо со ссылкой уйдёт школе само)',
  ]);

  if (!empty($c['RESEND_KEY'])) {
    $first = explode(' ', $cname)[0];
    $html = '<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#1D1D1F;max-width:560px">'
      . '<h2 style="margin:0 0 12px;font-size:20px">' . htmlspecialchars($first) . ', заявку получили</h2>'
      . '<p>Спасибо, что написали от имени <b>' . htmlspecialchars($name) . '</b>. Мы свяжемся с вами в течение рабочего дня, '
      . 'ответим на вопросы и откроем доступ: вы получите закрытую ссылку для учеников и вход в кабинет школы.</p>'
      . '<p><b>Что вы просили:</b> ' . htmlspecialchars($PLANS[$plan]) . ($period === 'month' ? ' (помесячно)' : '') . '.</p>'
      . '<p>Пока ждёте — посмотрите <a href="https://scholary.kz/schools/cabinet/?demo=1" style="color:#5B4BFF">демо-кабинет школы</a> и <a href="https://scholary.kz/demo/" style="color:#5B4BFF">пример отчёта ученика</a>.</p>'
      . '<p style="color:#6B7280;font-size:13px">Если это письмо пришло по ошибке — просто не отвечайте на него.</p></div>';
    http_json('https://api.resend.com/emails', 'POST', [
      'Authorization: Bearer ' . $c['RESEND_KEY'], 'Content-Type: application/json',
    ], array_filter([
      'from' => mail_from(), 'to' => [$email], 'reply_to' => mail_reply_to(),
      'subject' => 'Scholary для школ — заявку получили',
      'html' => $html,
      'text' => $first . ", заявку от " . $name . " получили. Свяжемся в течение рабочего дня и откроем доступ.",
    ], function ($v) { return $v !== null; }), 20);
  }
}

jout(['ok' => true]);
