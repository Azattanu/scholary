<?php
/* Scholary · письмо школе после активации (вызывает админка).
   Права проверяет база: is_admin() по токену вошедшего. Данные школы
   (включая claim_token) читаем ТЕМ ЖЕ токеном через admin_schools —
   сервисного ключа на хостинге нет.
   Письмо: закрытая ссылка для учеников, код, вход в кабинет школы, срок и
   места, памятка из трёх шагов. Копия — владельцу. */
require __DIR__ . '/_lib.php';
cors();
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') jout(['error' => 'method'], 405);

$c   = cfg();
$hdr = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? '');
$tok = preg_match('/Bearer\s+(\S+)/i', $hdr, $m) ? $m[1] : '';
$u   = auth_user($tok);
if (!$u) jout(['error' => 'unauthorized'], 401);

$chk = http_json($c['SUPABASE_URL'] . '/rest/v1/rpc/is_admin', 'POST',
  ['apikey: ' . $c['SUPABASE_ANON'], 'Authorization: Bearer ' . $tok, 'Content-Type: application/json'],
  new stdClass(), 15);
if ($chk['code'] !== 200 || $chk['json'] !== true) jout(['error' => 'forbidden'], 403);

$in = body(4000);
$id = trim((string)($in['id'] ?? ''));
if (!preg_match('/^[0-9a-f-]{36}$/i', $id)) jout(['error' => 'bad_id'], 400);

$r = http_json($c['SUPABASE_URL'] . '/rest/v1/rpc/admin_schools', 'POST',
  ['apikey: ' . $c['SUPABASE_ANON'], 'Authorization: Bearer ' . $tok, 'Content-Type: application/json'],
  new stdClass(), 20);
$rows = is_array($r['json']) ? $r['json'] : [];
$s = null;
foreach ($rows as $row) if (($row['id'] ?? '') === $id) { $s = $row; break; }
if (!$s) jout(['ok' => false, 'why' => 'not_found'], 404);
if (($s['status'] ?? '') !== 'active' || empty($s['invite_code']) || empty($s['claim_token'])) jout(['ok' => false, 'why' => 'not_active'], 400);
if (empty($c['RESEND_KEY'])) jout(['ok' => false, 'why' => 'mail_off'], 503);

$join  = 'https://scholary.kz/schools/join/?code=' . rawurlencode($s['invite_code']);
$cab   = 'https://scholary.kz/schools/cabinet/?claim=' . rawurlencode($s['claim_token']);
$first = trim(explode(' ', trim((string)($s['contact_name'] ?? '')))[0]);
$hi    = $first !== '' ? $first . ', ' : '';
$until = !empty($s['ends_on']) ? date('d.m.Y', strtotime($s['ends_on'])) : '—';
$seats = (int)($s['seats'] ?? 0);
$plan  = (string)($s['plan_label'] ?? '');
$name  = (string)($s['name'] ?? '');

$esc = function ($v) { return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8'); };
$btn = function ($href, $text, $bg) use ($esc) {
  return '<a href="' . $esc($href) . '" style="display:inline-block;background:' . $bg . ';color:#fff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:12px">' . $esc($text) . '</a>';
};

$html = '<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#1D1D1F;max-width:600px">'
  . '<h2 style="margin:0 0 10px;font-size:21px">' . $esc($hi) . 'доступ для ' . $esc($name) . ' открыт</h2>'
  . '<p style="margin:0 0 18px;color:#424245">Тариф <b>' . $esc($plan) . '</b> · до <b>' . $seats . '</b> учеников · действует до <b>' . $esc($until) . '</b>.</p>'

  . '<div style="background:#F0EEFF;border-radius:14px;padding:16px 18px;margin:0 0 18px">'
  . '<div style="font-size:12px;font-weight:800;letter-spacing:.06em;color:#4739E0;text-transform:uppercase">Ссылка для учеников</div>'
  . '<div style="font-size:16px;font-weight:700;margin:6px 0 4px;word-break:break-all"><a href="' . $esc($join) . '" style="color:#1D1D1F">' . $esc($join) . '</a></div>'
  . '<div style="color:#424245;font-size:13.5px">Код школы: <b style="font-size:16px;letter-spacing:.08em">' . $esc($s['invite_code']) . '</b></div>'
  . '</div>'

  . '<p style="margin:0 0 6px"><b>Как запустить — три шага</b></p>'
  . '<ol style="margin:0 0 18px;padding-left:20px;color:#424245">'
  . '<li>Разошлите ссылку ученикам 9–11 классов (и родителям) — в чат класса, в Kundelik/BilimClass, на классном часе.</li>'
  . '<li>Ученик открывает ссылку, создаёт аккаунт, указывает класс — и сразу получает полный доступ Scholary Pro на весь срок.</li>'
  . '<li>Вы открываете кабинет школы и видите, кто зарегистрировался, куда целится, какая вероятность и что не собрано к дедлайну.</li>'
  . '</ol>'

  . '<p style="margin:0 0 8px">' . $btn($cab, 'Открыть кабинет школы', '#5B4BFF') . '</p>'
  . '<p style="margin:0 0 18px;color:#6B7280;font-size:13px">Ссылка кабинета личная: при первом входе она привяжется к вашему аккаунту (Google или почта + пароль). Не пересылайте её ученикам.</p>'

  . '<p style="margin:0 0 6px"><b>Если ссылку получил кто-то посторонний</b> — в кабинете есть кнопка «Новая ссылка»: старая перестанет работать, а зарегистрированные ученики останутся.</p>'
  . '<p style="margin:0 0 18px"><b>Место занимает только зарегистрировавшийся ученик.</b> Свободные места видны в кабинете; когда они кончатся — напишите нам, расширим.</p>'

  . '<p style="color:#6B7280;font-size:13px;margin:0">Вопросы — просто ответьте на это письмо или напишите в WhatsApp: <a href="https://wa.me/' . preg_replace('/\\D/', '', (string)($c['OWNER_WA'] ?? '77024666852')) . '" style="color:#5B4BFF">+7 702 466 68 52</a>.</p>'
  . '</div>';

$text = $hi . "доступ для " . $name . " открыт.\n\nТариф: " . $plan . " · до " . $seats . " учеников · до " . $until
  . "\n\nСсылка для учеников: " . $join . "\nКод школы: " . $s['invite_code']
  . "\n\nКабинет школы: " . $cab . "\n\nВопросы — ответьте на это письмо.";

$to = [(string)$s['contact_email']];
$r2 = http_json('https://api.resend.com/emails', 'POST', [
  'Authorization: Bearer ' . $c['RESEND_KEY'], 'Content-Type: application/json',
], array_filter([
  'from' => mail_from(), 'to' => $to, 'reply_to' => mail_reply_to(),
  'bcc' => !empty($c['MAIL_TO']) ? [$c['MAIL_TO']] : null,
  'subject' => 'Scholary для ' . $name . ' — доступ открыт',
  'html' => $html, 'text' => $text,
], function ($v) { return $v !== null; }), 20);

$ok = ($r2['code'] >= 200 && $r2['code'] < 300);
jout(['ok' => $ok, 'to' => $s['contact_email'], 'why' => $ok ? null : ('mail_' . $r2['code'])]);
