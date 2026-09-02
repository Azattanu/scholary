#!/usr/bin/env python3
"""Проверка структуры HTML: незакрытые и лишние теги.
Ловит ровно ту ошибку, из-за которой открытый <div> меню втянул в себя
всю страницу. Запускать перед каждой сборкой."""
import io, re, sys, glob, os
from html.parser import HTMLParser

VOID = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}

class P(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True); self.stack=[]; self.err=[]
    def handle_starttag(self, t, a):
        if t not in VOID: self.stack.append(t)
    def handle_endtag(self, t):
        if t in VOID: return
        if not self.stack: self.err.append('лишний </%s>' % t); return
        if self.stack[-1] == t: self.stack.pop()
        elif t in self.stack:
            while self.stack and self.stack[-1] != t: self.err.append('не закрыт <%s>' % self.stack.pop())
            if self.stack: self.stack.pop()
        else: self.err.append('лишний </%s>' % t)

os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
bad = 0
for f in sorted(glob.glob('*.html')):
    if 'design' in f or 'backup' in f: continue
    s = io.open(f, encoding='utf-8').read()
    s = re.sub(r'<script.*?</script>', '', s, flags=re.S)
    s = re.sub(r'<style.*?</style>', '', s, flags=re.S)
    s = re.sub(r'<!--.*?-->', '', s, flags=re.S)
    p = P(); p.feed(s)
    left = [t for t in p.stack if t not in ('html', 'body')]
    if left or p.err:
        bad += 1
        print(f'✖ {f}: незакрытые {left[:6]} | ошибки {p.err[:6]}')
    else:
        print(f'ok {f}')
print(f'\n=== файлов с проблемами: {bad} ===')
sys.exit(1 if bad else 0)
