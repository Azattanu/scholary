# Локальный стенд оплат (Kaspi/ApiPay + TipTop + Supabase RPC + Resend + Green API — всё моками)

Стенд живёт в `/tmp/claude-0/paytest` (пути в test.py). Восстановить из репо:

```
mkdir -p /tmp/claude-0/paytest/root/httpdocs /tmp/claude-0/paytest/root/private
cp -r scripts/paytest/mock /tmp/claude-0/paytest/mock
cp scripts/paytest/test.py /tmp/claude-0/paytest/test.py
ln -s $PWD/api /tmp/claude-0/paytest/root/httpdocs/api          # PHP берётся прямо из репо
cat > /tmp/claude-0/paytest/root/private/scholary-config.php <<'PHP'
<?php return ['SUPABASE_URL' => 'http://127.0.0.1:8131/supabase', 'SUPABASE_ANON' => 'anon',
  'TIPTOP_RPC_SECRET' => 'rpcsecret', 'TIPTOP_API_SECRET' => 'ttsecret', 'ALLOW_ORIGIN' => 'http://localhost:8123',
  'OWNER_WA' => '77024666852', 'MAIL_TO' => 'owner@example.com', 'SELF_BASE' => 'http://127.0.0.1:8130', 'DEV' => true,
  'GREEN_ID' => '1', 'GREEN_TOKEN' => 't', 'GREEN_BASE' => 'http://127.0.0.1:8131/green',
  'RESEND_KEY' => 'r', 'RESEND_BASE' => 'http://127.0.0.1:8131/resend'];
PHP
(cd /tmp/claude-0/paytest/mock && python3 server.py &)                      # мок на 8131
(cd /tmp/claude-0/paytest/root/httpdocs && PHP_CLI_SERVER_WORKERS=6 php -S 127.0.0.1:8130 &)
python3 /tmp/claude-0/paytest/test.py                                        # 106 проверок
```

UI-харнессы (Playwright, сайт из `build/` на 8123: `cd build && python3 -m http.server 8123`):
`node scripts/kaspi-ui.mjs` (квиз + кабинет), `node scripts/kaspi-ui2.mjs` (web-72: ссылка на отчёт, обрыв связи, paid_before),
`node scripts/kaspi-order-ui.mjs` (консультация/пакет с тарифов), `node scripts/quiz-walk.mjs` (маска телефона, пейволл).
Мок умеет `POST /__set` с флагами: `fail_create [код, error_code]`, `invoice_get_fail`, `no_id`, `fail_rpc`, `fail_wa`, `fail_mail`.
