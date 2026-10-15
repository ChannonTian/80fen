#!/bin/bash
# 重建 ai-pool 用的历史版本池(容器回收后 scratchpad 会丢)。
#   test/pool-make.sh <目录>      → 打印可直接用的 POOL= 字符串
#   POOL=$(test/pool-make.sh /tmp/pool) OVA='{"x":1}' OVB='{"x":0}' node test/ai-pool.js 80fen-test.html 100
# 池子:浏览器里带的两个历史引擎 + git 里的 v0.7.10 / v0.7.19 / v0.7.26 / v0.7.30 测试版(打法各不相同)。
cd "$(dirname "$0")/.." || exit 1
D=${1:?用法: test/pool-make.sh <目录>}; mkdir -p "$D"
git show 877fee2:80fen-test.html > "$D/v0.7.10.html"
git show cad827c:80fen-test.html > "$D/v0.7.19.html"
git show 3a58132:80fen-test.html > "$D/v0.7.26.html"
git show a86cad2:80fen-test.html > "$D/v0.7.30.html"
echo "engines/v0.5.7.js,engines/v0.7.0.js,$D/v0.7.10.html,$D/v0.7.19.html,$D/v0.7.26.html,$D/v0.7.30.html"
