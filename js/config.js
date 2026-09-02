// ============================================================
// Scholary v19 — конфигурация. ЗАПОЛНИТЬ ПЕРЕД ДЕПЛОЕМ.
// Все места, требующие ваших значений, помечены "TODO".
// ============================================================
window.SCHOLARY_CONFIG = {
  // --- TipTop Pay ---
  // Public ID сайта из личного кабинета TipTop Pay (Сайты → scholary.kz).
  TIPTOP_PUBLIC_TERMINAL_ID: "pk_8b18e6f5ae97bc629948af455d0b9",
  // "test" — терминал в тестовом режиме: деньги не списываются, поэтому
  // кнопку оплаты картой видим только мы (адрес с ?tt=1), а посетителям
  // остаётся Kaspi. Как только TipTop переведёт сайт в боевой режим —
  // поставить "live", и кнопка появится у всех. Это единственное место,
  // которое нужно поменять.
  TIPTOP_MODE: "test",

  // --- Цены (тенге) ---
  PRICE_REPORT: 4000,
  PRICE_CONSULT: 15000,
  PRICE_PACKAGE: 35000,

  // --- Контакты ---
  WHATSAPP_NUMBER: "77024666852", // без «+», для ссылок wa.me
  CONTACT_EMAIL: "azattanu@gmail.com",

  // --- Supabase (для сохранения анкет и событий) ---
  SUPABASE_URL: "https://hpudoeiqykfgtxwfbfbl.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_XQ39e3HavSUXxXMEo9NWvg_XV5ZQ0Up",
  // Ожидаемые таблицы: leads (анкеты), events (аналитика). См. README-DEPLOY.md.

  // --- ИИ-слой (PHP-бэкенд на хостинге, ключ Anthropic лежит вне httpdocs) ---
  AI_URL: "/api/ai.php",
  NOTIFY_URL: "/api/notify.php",
  TELEGRAM_BOT: "askScholary_bot",           // @имя бота — заполнить, когда будет рабочий токен

  // --- Телеметрия (ключи публичные по своей природе, лежат в коде страницы) ---
  SENTRY_DSN:   "https://0ad2d6dd84df02c6c621e990bb7493a9@o4512013087866880.ingest.de.sentry.io/4512013095600208",
  POSTHOG_KEY:  "phc_kF4f8FKLJ9uiL2x8XDAtNzHs8zQwkWGgWsBSMhaCkGKn",
  POSTHOG_HOST: "https://scholary.kz/ph",
  RELEASE:      "web-49",

  // --- Ссылки ---
  DEMO_VIDEO_URL: "TODO_https://www.youtube.com/embed/XXXX", // видеодемо (unlisted)
  INSTAGRAM_URL: "https://www.instagram.com/scholary.ai",
  TIKTOK_URL: "https://tiktok.com/@TODO",
  TELEGRAM_URL: "https://t.me/azattanux"
};
