# Scholary v19 — деплой и настройка

Статичный сайт: HTML + CSS + vanilla JS, без сборки. Работает на любом хостинге (GitHub Pages, ps.kz, любой nginx).

## Состав

```
index.html        лендинг (хиро, видео, 3 шага, тарифы, FAQ, футер с реквизитами)
quiz.html         квиз 8 шагов → пейволл-превью → оплата (TipTop/Kaspi) → успех + анкета фазы 2
tariffs.html      тарифы (требование TipTop: цены до оплаты)
oferta.html       публичная оферта на все 3 тарифа
privacy.html      политика конфиденциальности
report-demo.html  пример отчёта (ссылка с пейволла, продающий инструмент)
css/style.css     общая система стилей
js/config.js      ВСЕ настройки — заполнить перед запуском
js/app.js         аналитика + сохранение лидов в Supabase (fail-safe)
```

## Перед запуском — чек-лист (искать "TODO" и "[заполнить]")

1. **js/config.js** — заполнить: `TIPTOP_PUBLIC_TERMINAL_ID` (из ЛК TipTop, раздел «Терминалы»; сначала тестовый `test_api_...`, после верификации боевой), Supabase URL/ключ, email, ссылки на соцсети и видео.
2. **Реквизиты ИП** — в `index.html`, `tariffs.html`, `oferta.html`, `privacy.html` заменить `[заполнить]`: БИН/ИИН, адрес, email, IBAN, банк. Поиск по файлам: `grep -rn "заполнить" *.html`.
3. **Supabase** — создать таблицы:
   ```sql
   create table leads (
     id text primary key,
     updated_at timestamptz,
     utm jsonb,
     name text, whatsapp text, email text, paid boolean, paid_at timestamptz,
     level text, year text, gpa_band text, school_type text,
     lang_status text, ielts_band text, field text, achievements text,
     budget text, priority text,
     p2_gpa_exact text, p2_city_school text, p2_ielts_date text, p2_docs_ready text,
     p2_blocked_account text, p2_lang_year text, p2_decision_maker text, p2_email text
   );
   create table events (
     id bigint generated always as identity primary key,
     lead_id text, event text, data jsonb, utm jsonb, ts timestamptz, page text
   );
   ```
   Включить RLS с политикой insert-only для anon (чтения с фронта нет). В `leads` включён upsert (Prefer: merge-duplicates) — нужен уникальный ключ по id (он есть — primary key).
4. **Вебхук оплаты (задача Диаса Д., бэкенд):** в ЛК TipTop настроить Pay-уведомление на ваш endpoint → по нему: пометить лид оплаченным, сгенерировать PDF (модель + Claude API), отправить на email (Resend/Postmark) и WhatsApp (Green API / Wazzup). Фронт после оплаты только показывает экран успеха — доставку делает бэкенд по вебхуку, это надёжнее.
5. **Видео** — записать по сценарию (док 20), залить на YouTube (unlisted), вставить embed-URL в config.js.

## Деплой

GitHub Pages: залить в репозиторий, Settings → Pages → deploy from branch. Домен scholary.kz: A-записи на GitHub Pages или залить на текущий хостинг ps.kz по FTP/панели — файлы статичные, ограничений нет. Обязательно HTTPS (TipTop работает только с https).

## Что осталось руками после заливки

- Ответить TipTop в чат: ссылки на тарифы (scholary.kz/tariffs.html), оферту, политику; ссылка на видео; ссылки на соцсети.
- Тестовая оплата на тестовом терминале → скриншот для себя.
- Проверить, что квиз проходится с телефона, отчёт-пример открывается, Kaspi-кнопка открывает WhatsApp.

## Известные упрощения MVP (сознательные)

- Превью на пейволле считается упрощённой формулой на фронте (`previewCalc` в quiz.html) — подключить реальную модель по API, там стоит комментарий.
- Kaspi — ручной перевод через WhatsApp: в виджете TipTop Kaspi Pay нет (по их докам: карты, Apple Pay, Google Pay, рассрочка).
- Отчёт генерируется бэкендом после вебхука; в ZIP его нет — это отдельная задача (пайплайн в доке 18, п. 3.4).

## Заливка в GitHub (репо dosymbaev1/scholary-web)

```bash
# из папки с распакованным ZIP:
git clone https://github.com/dosymbaev1/scholary-web.git && cd scholary-web
git checkout -b v19-redesign
cp -r ../scholary-site-v19/* .
git add -A && git commit -m "v19: платный отчёт 4000₸, TipTop, ветвящийся квиз, оферта/privacy, контент-блоки"
git push -u origin v19-redesign   # дальше — Pull Request и деплой
```
Совет: заливать веткой, а не сразу в main — Диас Д. посмотрит diff перед продом.

## v20: фото и база программ

- **images/** — 4 фото университетов по списку в images/README-ФОТО.md (без них карточки — фирменный градиент).
- **data/programs-expansion.json** — +50 программ-кандидатов в базу (30+ стран, каждая с официальной ссылкой, verified:false — Диас А. проверяет перед публикацией).
- **scripts/crawl-programs.mjs** — краулер: обходит официальные страницы, сохраняет тексты и выдаёт CSV с кандидатами на дедлайны/суммы (запускать у себя: `node scripts/crawl-programs.mjs`).
