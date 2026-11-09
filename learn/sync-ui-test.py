#!/usr/bin/env python3
"""从 learn.html 生成界面测试页 80fen-learn-ui-test.html。
两页只差四处:独立的存档前缀(测试页的进度不碰正式页)、标题、
「去打牌」指向打牌测试页、学牌入口指向测试页自己。改 learn.html 之后跑一次:
    python3 learn/sync-ui-test.py
"""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
s = (root / 'learn.html').read_text(encoding='utf8')
R = [
    ('<!-- 80分 · 学一手：正式教学页。六六设计系统只用于学牌界面。 -->',
     '<!-- 80分 · 学一手 界面测试页:由 learn/sync-ui-test.py 从 learn.html 生成,别直接改这一份。 -->'),
    ('<title>六六八十分 · 学一手</title>', '<title>六六八十分 · 学牌测试</title>'),
    ("const LS='80fenlearn-';", "const LS='80fen-luit-';"),
    ('href="learn.html"', 'href="80fen-learn-ui-test.html"'),
]
for a, b in R:
    if s.count(a) != 1:
        raise SystemExit('learn.html 变了,对不上: ' + a)
    s = s.replace(a, b)
n = s.count('href="index.html"') + s.count("location.assign('index.html')")
s = s.replace('href="index.html"', 'href="80fen-play-ui-test.html"').replace("location.assign('index.html')", "location.assign('80fen-play-ui-test.html')")
(root / '80fen-learn-ui-test.html').write_text(s, encoding='utf8')
print(f'80fen-learn-ui-test.html 已生成(去打牌链接 {n} 处)')
