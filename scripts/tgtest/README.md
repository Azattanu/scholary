# Стенд рассылки Telegram (api/tg-send.php)

Проверяет состав писем без реальной отправки: дайджест понедельника, «неделя не засчитана» четверга,
склейка с напоминанием о дедлайне (одно письмо в день), склонения, экранирование, сбой RPC.

```
mkdir -p /tmp/tgtest/root/httpdocs/api /tmp/tgtest/root/private /tmp/tgtest/mock
cp api/_lib.php api/tg-send.php /tmp/tgtest/root/httpdocs/api/
cp scripts/tgtest/stand-config.php /tmp/tgtest/root/private/scholary-config.php
cp scripts/tgtest/server.py /tmp/tgtest/mock/
(cd /tmp/tgtest/mock && python3 server.py &)            # мок Supabase RPC на 8132
(cd /tmp/tgtest/root/httpdocs && php -S 127.0.0.1:8133 &)
python3 scripts/tgtest/test.py                           # ALL OK
```

Секретов в стенде нет: ключи в конфиге — заглушки. Реальная проверка на проде:
`.../api/tg-send.php?key=<TG_CRON_KEY>&kind=digest&dry=1` — вернёт `preview` без отправки.
