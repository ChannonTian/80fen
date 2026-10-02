#!/bin/bash
# 从收集表拉真人牌谱(JSONL,一行一局)。要环境变量 RECORDS_READ_KEY(= Apps Script 属性里的 READ_KEY)。
#   test/records-fetch.sh [输出文件=records.jsonl] [起始行=2]
# 只读、一次请求、约 3 秒;拉下来接着跑:node test/records-check.js 文件  /  EG=1 node test/records-vs-ai.js 文件
# (另一条路:Google Sheets 连接器读表「80fen-牌谱」,适合看几列概况;拉整份 JSON 用这个脚本更快更省。)
cd "$(dirname "$0")/.." || exit 1
OUT=${1:-records.jsonl}; FROM=${2:-2}
[ -n "$RECORDS_READ_KEY" ] || { echo "缺环境变量 RECORDS_READ_KEY" >&2; exit 1; }
URL=$(grep -o "const UPLOAD_URL='[^']*'" 80fen-test.html | cut -d"'" -f2)
curl -sSL -m 60 "$URL?key=$RECORDS_READ_KEY&from=$FROM" -o "$OUT" || exit 1
echo "$(grep -c . "$OUT") 局 → $OUT"
