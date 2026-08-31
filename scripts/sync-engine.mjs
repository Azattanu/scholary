// Источник правды для логики отчёта — js/report-engine.js (работает в браузере).
// Этот скрипт делает его ESM-копию для Deno Edge Functions.
// Запускать после каждого изменения движка: node scripts/sync-engine.mjs
import { readFileSync, writeFileSync, mkdirSync } from "fs";
const src = readFileSync(new URL("../js/report-engine.js", import.meta.url), "utf8");
const esm = "// АВТОГЕНЕРИРОВАНО из js/report-engine.js — НЕ ПРАВИТЬ РУКАМИ (scripts/sync-engine.mjs)\n"
  + "const module = { exports: {} };\n"
  + src
  + "\nexport default module.exports;\n";
mkdirSync(new URL("../supabase/functions/_shared/", import.meta.url), { recursive: true });
writeFileSync(new URL("../supabase/functions/_shared/report-engine.mjs", import.meta.url), esm);
console.log("ok: supabase/functions/_shared/report-engine.mjs обновлён");
