#!/usr/bin/env bash
# ShengJi+ 对我们的 AI —— 本机一条龙(云端会话下不了权重:链接是纯 http,云端代理只走 HTTPS)。
#
#   bash test/sjplus/run-local.sh            # 全部:约 1~2 小时(4 核)
#   N=100 bash test/sjplus/run-local.sh      # 先小跑一遍看通不通
#
# 所有下载物和输出都放在仓库**外面**的 $SJ_EXT(默认 ../sjplus-ext):ShengJi+ 没有许可证,代码和权重不进我们的仓库。
# 任何一步不符合预期就停(退出码非 0),把 $SJ_EXT/out/summary.txt 发回给 AI 线即可。
# 断点续跑:重跑同一条命令,已经下好 / 打完的种子会跳过。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
EXT="${SJ_EXT:-$ROOT/../sjplus-ext}"; N="${N:-400}"; NB="${NB:-100}"
EVAL_GAMES="${EVAL_GAMES:-400}"; BENCH_SECONDS="${BENCH_SECONDS:-240}"
GATES="${GATES:-1}"                                 # GATES=0 只给调脚本用:门槛不过也往下走(读数作废)"
JOBS="${JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}"; [ "$JOBS" -gt 8 ] && JOBS=8
URL="${SJ_URL:-http://jiaruishan.com/files/shengji_plus/1180000.zip}"
PIN=62cec433a67479d29750f8c7dc063c4dd81a6a64        # 适配层对拍过的那次提交(new 分支,2023-05)
mkdir -p "$EXT/dl" "$EXT/out"; EXT="$(cd "$EXT" && pwd)"; OUT="$EXT/out"; SUM="$OUT/summary.txt"
say(){ printf '\n== %s ==\n' "$*" | tee -a "$SUM"; }
stop(){ printf '\n!! 停:%s\n' "$*" | tee -a "$SUM"; exit 2; }
gate(){ if [ "$GATES" = 1 ]; then stop "$@"; else printf '\n!! 门槛没过(GATES=0,继续;读数作废):%s\n' "$*" | tee -a "$SUM"; fi; }
: > "$SUM"; cd "$ROOT"

say "1 环境"
node -e 'if(+process.versions.node.split(".")[0]<20){console.error("Node 要 >= 20");process.exit(1)}' || stop "Node 版本不够"
python3 -c 'import sys; sys.exit(0 if sys.version_info>=(3,10) else 1)' || stop "Python 要 >= 3.10"
[ -x "$EXT/venv/bin/python" ] || python3 -m venv "$EXT/venv"
PY="$EXT/venv/bin/python"
"$PY" -c 'import torch, numpy, tqdm' 2>/dev/null || "$EXT/venv/bin/pip" install -q torch numpy tqdm
[ -d "$EXT/repo/.git" ] || git clone -q --branch new https://github.com/TheMoon2000/shengji_plus "$EXT/repo"
git -C "$EXT/repo" checkout -q "$PIN" 2>/dev/null || stop "ShengJi+ 仓库里找不到提交 $PIN"
{ echo "node $(node -v)  $("$PY" -V)  torch $("$PY" -c 'import torch;print(torch.__version__)')  $JOBS 进程  $(uname -sm)"
  echo "我们的仓库 $(git rev-parse --short HEAD)  ShengJi+ $(git -C "$EXT/repo" rev-parse --short HEAD)"; } | tee -a "$SUM"

say "2 下载并解开权重"
Z="$EXT/dl/1180000.zip"
if [ ! -s "$Z" ]; then
  curl -fL --connect-timeout 30 --max-time 3600 -o "$Z.part" "$URL" || stop "权重链接下不下来($URL)。不要自己从头训练,告诉产品方。"
  mv "$Z.part" "$Z"
fi
rm -rf "$EXT/ckpt"; mkdir -p "$EXT/ckpt"
"$PY" -I "$HERE/unpack_ckpt.py" --zip "$Z" --out "$EXT/ckpt" --repo "$EXT/repo" | tee -a "$SUM" || stop "权重包解不开或内容不对"
CK="$(cat "$EXT/ckpt/MAIN_DIR")"
grep -q -- '--static-encoding' "$CK/command.txt" 2>/dev/null && stop "权重是静态编码练的,适配层没覆盖"
SJARGS=(--repo "$EXT/repo" --ckpt "$CK" --py "$PY")

say "3 在它自己的环境里验权重(README:对随机 Level Rate 97.7%)"
"$PY" -I "$HERE/sj_eval.py" --repo "$EXT/repo" --ckpt "$CK" --opp random --games "$EVAL_GAMES" --procs "$JOBS" --json "$OUT/eval-random.json" | tee "$OUT/eval-random.txt" | tee -a "$SUM" \
  || stop "权重读不进它的网络(结构对不上?)或评测出错"
node -e 'process.exit(require(process.argv[1]).level_rate>=0.93?0:1)' "$OUT/eval-random.json" \
  || gate "对随机的级数占比和 README 的 97.7% 不符(门槛 93%;读数见上)"
"$PY" -I "$HERE/sj_eval.py" --repo "$EXT/repo" --ckpt "$CK" --opp strategic --games "$EVAL_GAMES" --procs "$JOBS" | tee "$OUT/eval-strategic.txt" | tee -a "$SUM"

say "4a 适配层自检:张量对拍(不需要权重)"
node test/sjplus/match.js --sj 80fen-test.html --sj-ov '{"egSearch":0}' --opp engines/v0.5.7.js --n 15 --cap 1000000 --dump "$OUT/dec.jsonl" >/dev/null
"$PY" -I "$HERE/selfcheck_tensor.py" --repo "$EXT/repo" --dump "$OUT/dec.jsonl" | tee -a "$SUM" || stop "张量对拍不过"

M(){ # M <标签> <match.js 的其余参数...>:跑一组对局,结果进 summary
  local tag="$1"; shift
  node test/sjplus/match.js "$@" --jobs "$JOBS" --out "$OUT/$tag.jsonl" --json "$OUT/$tag.json" | tee "$OUT/$tag.txt" | tee -a "$SUM" \
    || stop "$tag 这一组没跑完"
}
say "4b 适配层自检:我们的规则下 ShengJi+ 对随机合法出牌必须大胜"
M vs-random "${SJARGS[@]}" --opp random --n "$NB"
node -e 'const r=require(process.argv[1]); process.exit(r.pts>=20&&r.lv>=0.4?0:1)' "$OUT/vs-random.json" \
  || gate "对随机没有大胜(要 >= +20 分/局 且 >= +0.4 级/局;参照:v0.5.7 对随机 +52 分 / +0.9 级)—— 适配层可能有错,先查错再对局"

say "5 对局($N 种子 × 交换阵营)"
M vs-v0767-eg1 "${SJARGS[@]}" --opp 80fen-test.html --n "$N"
M vs-v0767-eg0 "${SJARGS[@]}" --opp 80fen-test.html --opp-ov '{"egSearch":0}' --n "$N"
M vs-v057      "${SJARGS[@]}" --opp engines/v0.5.7.js --n "$N"

say "5b 对照:对面不许甩牌(它的引擎判甩牌墩有毛病,这一组量这条规则差异占多少)"
M vs-v0767-eg1-nothrow "${SJARGS[@]}" --opp 80fen-test.html --opp-nothrow --n "$N"

say "5c 参照:同一把尺子上别的选手落在哪($NB 种子)"
M ref-random-vs-v0767   --sj random --opp 80fen-test.html --opp-ov '{"egSearch":0}' --n "$NB"
M ref-v057-vs-v0767     --sj engines/v0.5.7.js --opp 80fen-test.html --opp-ov '{"egSearch":0}' --n "$NB"
M ref-v057-vs-random    --sj engines/v0.5.7.js --opp random --n "$NB"

say "7 速度(给档 2 用)"
"$PY" -I "$HERE/sj_eval.py" --repo "$EXT/repo" --ckpt "$CK" --selfplay 20 | tee -a "$SUM"
"$PY" -I "$HERE/sj_trainbench.py" --repo "$EXT/repo" --workdir "$EXT/work" --seconds "$BENCH_SECONDS" | tee -a "$SUM" || true

say "完"
echo "汇总在 $SUM —— 整份发回给 AI 线(或让本机的 Claude 读它,补 docs/notes/advanced-methods.md 四点五的「对局读数」)。" | tee -a "$SUM"
