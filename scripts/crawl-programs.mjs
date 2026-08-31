// Краулер-заготовка для графа требований Scholary.
// Что делает: берёт data/programs-expansion.json, обходит source_url каждой программы,
// сохраняет текст страницы и вытаскивает кандидатов на дедлайны/суммы → CSV на проверку Диасу.
// Запуск: node scripts/crawl-programs.mjs   (Node 18+, из корня сайта)
// Дальше по плану (док 15, часть 3.4): экстрактор → детектор изменений → проверка экспертом.

import { readFileSync, writeFileSync, mkdirSync } from "fs";

const SRC = new URL("../data/programs-expansion.json", import.meta.url);
const OUT_DIR = new URL("../data/crawl/", import.meta.url);
mkdirSync(OUT_DIR, { recursive: true });

const { programs } = JSON.parse(readFileSync(SRC, "utf8"));
const rows = [["country", "name", "url", "status", "deadline_candidates", "money_candidates"]];

// Простые паттерны дат и сумм (RU/EN); краулер ищет кандидатов, решает человек.
const DATE_RE = /\b(\d{1,2}\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s*\d{0,2},?\s*20\d{2}\b|\b\d{1,2}[./]\d{1,2}[./]20\d{2}\b|deadline[^.\n]{0,80}/gi;
const MONEY_RE = /(€|EUR|\$|USD|CHF|SEK|PLN|CNY|KRW|¥|HKD|SGD|AED|NTD|CAD|£)\s?\d[\d\s.,]{1,10}/g;

function extract(text, re, cap = 6) {
  const found = [...new Set((text.match(re) || []).map(s => s.trim().slice(0, 90)))];
  return found.slice(0, cap).join(" | ");
}

for (const p of programs) {
  process.stdout.write(`→ ${p.country} · ${p.name} ... `);
  try {
    const res = await fetch(p.source_url, { redirect: "follow", signal: AbortSignal.timeout(20000), headers: { "user-agent": "Mozilla/5.0 ScholaryBot/0.1 (+scholary.kz)" } });
    const html = await res.text();
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const slug = (p.country + "-" + p.name).toLowerCase().replace(/[^a-zа-я0-9]+/gi, "-").slice(0, 60);
    writeFileSync(new URL(slug + ".txt", OUT_DIR), text.slice(0, 200000));
    rows.push([p.country, p.name, p.source_url, "HTTP " + res.status, extract(text, DATE_RE), extract(text, MONEY_RE)]);
    console.log("ok (" + res.status + ")");
  } catch (e) {
    rows.push([p.country, p.name, p.source_url, "ERROR: " + (e.message || e), "", ""]);
    console.log("fail");
  }
  await new Promise(r => setTimeout(r, 1500)); // вежливая пауза
}

const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\n");
writeFileSync(new URL("crawl-report.csv", OUT_DIR), "﻿" + csv);
console.log("\nГотово: data/crawl/crawl-report.csv (+ текст каждой страницы). Диас проверяет колонку deadline_candidates и заполняет граф.");
