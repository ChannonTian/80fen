# ai2 —— 价值网络(M1)

目标:用「全明牌价值网络 V(落子后局面)→ 终局闲家总分分布」代替收官搜索里的「推演到底」,
让抽样世界搜索在所有手牌数(13..25 张)上都能跑。V 是在**真实不完全信息策略**的自对弈上训练的,
所以对 belief 抽样出的世界取平均是合理的一步策略改进(没有 strategy fusion)。

## 目录
| 文件 | 作用 |
|---|---|
| `sim.js` | 整副牌模拟器(可快照/还原),开局流程照搬 `test/ai-h2h.js` |
| `featurize.js` | **特征唯一出处**(Node/浏览器通用):局面 → 128 字节原始记录 → 稀疏二值特征(1420)+ 稠密标量(50);布局写在文件头注释里 |
| `gen-data.js` / `gen-par.js` | 自对弈数据(`egSearch:0`);每种子 1 条在线对局 + K 个偏离分支,配对记录写 `*.pairs.ndjson` |
| `check-g0.js` | G0 体检(牌守恒、标签 = 引擎总分、独立对局循环复核) |
| `export.js` | shard → `.npy`(idx/dense/y/meta) |
| `train.py` | MLP 512-256-128,41 类(总分/5,≥200 并入末箱)交叉熵,按种子留出(seed%10==9) |
| `vnet.js` / `register.js` | 无依赖前向(fp16 权重);把模型注册进引擎 `setVnet` |
| `eval-g2.js` / `report-g2.js` | G2 排序评测(留出 fork 配对) |
| `weights/` | 权重与指标(< 3MB 的才入库);大数据在 scratchpad,不入库 |

## 怎么跑
```
# 1) 数据(并行,可断点续跑;约 2.4 s/种子/核)
node ai2/gen-par.js --seed0=0 --total=6000 --chunk=100 --workers=4 --k=3 --out=<数据目录>
node ai2/check-g0.js <数据目录> 30
# 2) 导出 + 训练
node ai2/export.js <数据目录> <npy目录> --permute=1
python3 -I ai2/train.py --data <npy目录> --tag v1 --steps 20000
# 3) G2:留出 fork 配对的排序评测(4 路并行)
for i in 0 1 2 3; do node ai2/eval-g2.js --dir=<数据目录> --w=ai2/weights/vnet-v1.json --out=g2-$i.ndjson --part=$i/4 & done; wait
node ai2/report-g2.js g2-*.ndjson
# 4) G3:整局同桌对照(VNET 只注册到新版;OVN 打开开关)
VNET=ai2/weights/vnet-v1.json OVN='{"vnet":1}' SEED0=0 node test/ai-h2h.js 80fen-test.html 80fen-test.html 350
# ai-pool:VNET=… OVA='{"vnet":1}' EG=1 node test/ai-pool.js 80fen-test.html 200
```
开关:`AIP.vnet`(0 关,默认)、`AIP.vnetSamples`(30)、`AIP.vnetMaxCands`(4)。网页里目前没有加载模型的入口,开关只在 Node 测试里生效。

## 结果
(见下,跑完填)
