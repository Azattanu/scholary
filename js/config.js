// ============================================================
// Scholary v19 — конфигурация. ЗАПОЛНИТЬ ПЕРЕД ДЕПЛОЕМ.
// Все места, требующие ваших значений, помечены "TODO".
// ============================================================
window.SCHOLARY_CONFIG = {
  // --- TipTop Pay ---
  // Public Terminal ID из личного кабинета TipTop Pay (раздел «Терминалы»).
  // Тестовый терминал выглядит как "test_api_...". Боевой выдадут после верификации.
  TIPTOP_PUBLIC_TERMINAL_ID: "TODO_public_terminal_id",

  // --- Цены (тенге) ---
  PRICE_REPORT: 4000,
  PRICE_CONSULT: 15000,
  PRICE_PACKAGE: 25000,

  // --- Контакты ---
  WHATSAPP_NUMBER: "77753831836", // без «+», для ссылок wa.me
  CONTACT_EMAIL: "azattanu@gmail.com",

  // --- Supabase (для сохранения анкет и событий) ---
  SUPABASE_URL: "https://hpudoeiqykfgtxwfbfbl.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_XQ39e3HavSUXxXMEo9NWvg_XV5ZQ0Up",
  // Ожидаемые таблицы: leads (анкеты), events (аналитика). См. README-DEPLOY.md.

  // --- ИИ-слой (PHP-бэкенд на хостинге, ключ Anthropic лежит вне httpdocs) ---
  AI_URL: "/api/ai.php",

  // --- Ссылки ---
  DEMO_VIDEO_URL: "TODO_https://www.youtube.com/embed/XXXX", // видеодемо (unlisted)
  INSTAGRAM_URL: "https://www.instagram.com/scholary.ai",
  TIKTOK_URL: "https://tiktok.com/@TODO",
  TELEGRAM_URL: "https://t.me/azattanux"
};
