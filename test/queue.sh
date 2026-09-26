#!/bin/bash
# 断点续跑的实验队列(2026-09-25 起用;对局实验一跑几个钟头,容器会被回收、进程会丢)。
#
#   test/queue.sh <任务列表.tsv> [并行数=4]
#
# 列表每行三栏,制表符分隔:<输出文件>\t<环境变量(空格分隔,JSON 里不能有空格)>\t<命令>
#   /tmp/x/h-0.txt	SEED0=70000 OVN={"guardPlan":1}	node test/ai-h2h.js a.html a.html 350
# 输出先写 <输出>.tmp,跑完改名并追加一行 DONE;重跑同一份列表时末行是 DONE 的跳过 —— 断了就原样再跑一遍。
# 全部结束后打印 ALLDONE(别的等待脚本可以 grep 它接力)。
# 注意:命令里读的 html 在跑的过程中不要改 —— 要继续改代码,先复制一份快照给队列用。
cd "$(dirname "$0")/.." || exit 1
LIST=$1; PAR=${2:-4}
run(){ local out="$1" envs="$2" cmd="$3"
  env $envs bash -c "$cmd" > "$out.tmp" 2>&1 && { mv "$out.tmp" "$out"; echo DONE >> "$out"; }
}
while IFS=$'\t' read -r out envs cmd; do
  [ -z "$out" ] && continue
  [ -f "$out" ] && tail -1 "$out" | grep -q '^DONE' && continue
  while [ "$(jobs -rp | wc -l)" -ge "$PAR" ]; do sleep 5; done
  run "$out" "$envs" "$cmd" &
done < "$LIST"
wait
echo ALLDONE
