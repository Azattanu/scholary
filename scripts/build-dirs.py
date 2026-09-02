#!/usr/bin/env python3
"""Scholary · сборка «папочных» URL.
Хостинг отдаёт всё, что кончается на .html, с кэшем на 10 лет,
а каталоги (/cabinet/) — с no-cache. Поэтому канонические адреса —
каталоги, а старые .html становятся вечными заглушками-редиректами
(они сами больше никогда не меняются, поэтому их кэш безвреден)."""
import subprocess, sys as _sys
import io, os, shutil

PAGES = {          # исходник -> каталог
    "quiz.html": "quiz",
    "cabinet.html": "cabinet",
    "r.html": "report",
    "report-demo.html": "demo",
    "oferta.html": "oferta",
    "privacy.html": "privacy",
    "tariffs.html": "tariffs",
    "admin.html": "admin",
}
STUB = """<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="https://scholary.kz/{d}/">
<title>Scholary</title>
<script>location.replace("/{d}/" + location.search + location.hash);</script>
<meta http-equiv="refresh" content="0;url=/{d}/">
<style>body{{font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;color:#1D1D1F}}</style>
</head><body><p>Открываем <a href="/{d}/">scholary.kz/{d}/</a>…</p></body></html>
"""
INDEX_STUB = """<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="https://scholary.kz/">
<title>Scholary</title>
<script>location.replace("/" + location.search + location.hash);</script>
<meta http-equiv="refresh" content="0;url=/">
</head><body><p>Открываем <a href="/">scholary.kz</a>…</p></body></html>
"""

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out  = os.path.join(root, "build")
if os.path.isdir(out): shutil.rmtree(out)
os.makedirs(out)

# 1. каталоги с настоящими страницами
for src, d in PAGES.items():
    s = io.open(os.path.join(root, src), encoding="utf-8").read()
    os.makedirs(os.path.join(out, d), exist_ok=True)
    io.open(os.path.join(out, d, "index.html"), "w", encoding="utf-8").write(s)

# 2. корневые .html — вечные заглушки
for src, d in PAGES.items():
    io.open(os.path.join(out, src), "w", encoding="utf-8").write(STUB.format(d=d))

# 3. главная остаётся настоящей на /
shutil.copy(os.path.join(root, "index.html"), os.path.join(out, "index.html"))

# 4. статика и api — как есть
for d in ("css", "js", "images", "data", "api", "error_docs"):
    src = os.path.join(root, d)
    if os.path.isdir(src):
        shutil.copytree(src, os.path.join(out, d))
for f in ("robots.txt", "sitemap.xml"):
    if os.path.isfile(os.path.join(root, f)):
        shutil.copy(os.path.join(root, f), os.path.join(out, f))

print("build/ готов:", sorted(os.listdir(out)))

# ---- страховка: не собираем сборку со сломанной структурой HTML ----
_r = subprocess.run([_sys.executable, __file__.replace('build-dirs.py', 'html-check.py')],
                    capture_output=True, text=True)
if _r.returncode != 0:
    print(_r.stdout)
    raise SystemExit('Сборка остановлена: в HTML есть незакрытые теги (см. выше)')
