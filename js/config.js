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
  KASPI_ON: true,               /* оплата через Kaspi (ApiPay.kz): счёт на номер телефона */

  // --- Цены (тенге) ---
  PRICE_REPORT: 4000,
  PRICE_CONSULT: 15000,
  PRICE_PACKAGE: 35000,
  PRICE_PRO_MONTH: 4990,        /* Scholary Pro на месяц — те же числа, что в api/_pay.php pay_prices() */
  PRICE_PRO_SEASON: 14900,      /* Scholary Pro на сезон */

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
  RELEASE:      "web-76",

  // --- Яндекс.Метрика ---
  // Номер счётчика из metrika.yandex.ru (только цифры). Пустая строка = выключено.
  // Как только сюда попадёт номер, все события сайта начнут уходить целями
  // с теми же именами — список целей для создания в интерфейсе см. в 32-АНАЛИТИКА.md
  /* Пиксель Meta (Facebook/Instagram). Вставь сюда ID из Events Manager —
     без него реклама не умеет оптимизироваться на заявки и собирать ретаргет. */
  META_PIXEL_ID: "",
  // TikTok Pixel (Events Manager → Web → Manual). Пустой ID — блок не грузится.
  TIKTOK_PIXEL_ID: "DACVEIRC77UCRCTVA5DG",

  YANDEX_METRIKA_ID: "111376927",
  // Вебвизор записывает движения, клики и прокрутку. Включён по решению
  // владельца; в политике конфиденциальности про это написано отдельно.
  // Поля с именем, телефоном и почтой помечены классами Метрики так,
  // чтобы их содержимое в записи не сохранялось.
  YANDEX_WEBVISOR: true,

  // --- Ссылки ---
  DEMO_VIDEO_URL: "TODO_https://www.youtube.com/embed/XXXX", // видеодемо (unlisted)
  INSTAGRAM_URL: "https://www.instagram.com/scholary.ai",
  TIKTOK_URL: "https://tiktok.com/@TODO",
  TELEGRAM_URL: "https://t.me/azattanux"
};
