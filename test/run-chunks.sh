#!/bin/bash
# 分块跑普扫,**每块跑完立刻落盘**;已经有 RAW 的块直接跳过 ——
# 容器被回收 / 进程被杀之后,重跑同一条命令就能接着跑,不必从头来。
#
#   test/run-chunks.sh <输出目录> <脚本> <起始种子> <块大小> <块数> [K=V ...]
#
# 四个核就开四个,各啃一段种子:
#   for i in 0 1 2 3; do
#     test/run-chunks.sh out test/cf-scan.js $((600000+i*500)) 250 2 MAXH=4 &
#   done
#
# 这个脚本是踩出来的:2000 副的两批中间结果先后被容器清掉过两次
# (一次连 scratchpad 里的聚合脚本一起没)。凡是要跑十分钟以上的量,
# **都要能续跑,而且产物要落在会被 commit 的地方或者能一键重建。**
set -u
OUT=$1; SCRIPT=$2; S0=$3; SZ=$4; NB=$5; shift 5
mkdir -p "$OUT"
for ((i=0;i<NB;i++)); do
  S=$((S0+i*SZ)); F="$OUT/s$S.txt"
  grep -q '^RAW ' "$F" 2>/dev/null && continue        # 这一块已经好了
  env "$@" RAW=1 SEED0=$S node "$SCRIPT" 80fen-test.html "$SZ" > "$F.tmp" 2>&1 \
    && mv "$F.tmp" "$F"                               # 写完才改名,半截文件不会被当成好数据
done
echo "CHUNKS_DONE $OUT $S0"
