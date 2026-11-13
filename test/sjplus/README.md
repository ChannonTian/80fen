# ShengJi+ 对我们的 AI(适配层)

要回答的问题:**从零自对弈约 118 万局的神经网络([ShengJi+](https://github.com/TheMoon2000/shengji_plus),伯克利 2023 硕士论文),
对我们手写打分 + 收官搜索的引擎是强是弱。** 结论和读法写在 [`docs/notes/advanced-methods.md`](../../docs/notes/advanced-methods.md) 四点五。

ShengJi+ 仓库**没有许可证**:它的代码和权重都放在本仓库**外面**(默认 `../sjplus-ext/`),这里只有我们自己写的适配层,按路径引用它。

## 一条命令(本机)

```bash
bash test/sjplus/run-local.sh
```

依次做:建 venv 装 torch → 克隆 ShengJi+(钉在对拍过的提交)→ 下载并安全解开权重 → 在它自己的环境里验权重 →
适配层两项自检 → 三组对局 + 对照 + 参照 → 速度。任何一步不符合预期就停。
汇总写在 `../sjplus-ext/out/summary.txt`,整份发回即可。先小跑看通不通:`N=100 bash test/sjplus/run-local.sh`。
重跑同一条命令会跳过已经打完的种子。**必须在本机跑**:权重链接是纯 http,云端会话的代理只走 HTTPS。

## 文件

| 文件 | 做什么 |
| --- | --- |
| `match.js` | 对局。裁判 = `80fen-test.html`;主、庄、底牌照 `ai-h2h.js`;扣底两边都用裁判引擎的 `aiDiscard`;同批种子、交换阵营、配对口径报 分/局、级/局 ± SE。按我们的规则枚举候选,发给 `sj_server.py` 打分。 |
| `sj_server.py` | Python 常驻进程:一行 JSON 进(局面 + 候选),一行 JSON 出(分数最高的下标)。 |
| `sj_common.py` | 读权重(`weights_only=True`)、牌名 / 座位换算、消息 → 它的 `Observation`、逐项断言、拼张量。 |
| `selfcheck_tensor.py` | 自检 A:同一副牌在它自己的 `env/Game.py` 里重打,每一手的张量和适配层的逐位比。不需要权重。 |
| `sj_eval.py` | 在它自己的环境里对随机 / 对它自带的规则基线评测(等价于它 README 的评测命令,但不 `pickle.load`、不 import 下载目录里的代码、没有 N 卡也能跑);`--selfplay` 量速度。 |
| `sj_trainbench.py` | 把它 README 的训练命令跑几分钟,量 局/小时。 |
| `unpack_ckpt.py` | 安全解包:只取 `.pt`;`state.pkl` / `stats.pkl`(pickle)不解;`Models.py` / `command.txt` 当文本。 |
| `run-local.sh` | 上面那条龙。 |

Python 一律带 `-I` 跑(不把当前目录 / 环境变量里的路径挂进 `sys.path`)。

## 手动跑一组

```bash
PY=../sjplus-ext/venv/bin/python; R=../sjplus-ext/repo; CK=$(cat ../sjplus-ext/ckpt/MAIN_DIR)
node test/sjplus/match.js --repo $R --ckpt $CK --py $PY --opp 80fen-test.html --n 400 --jobs 4                       # 对 v0.7.67,收官搜索开
node test/sjplus/match.js --repo $R --ckpt $CK --py $PY --opp 80fen-test.html --opp-ov '{"egSearch":0}' --n 400 --jobs 4   # 搜索关
node test/sjplus/match.js --repo $R --ckpt $CK --py $PY --opp engines/v0.5.7.js --n 400 --jobs 4                      # 老引擎
node test/sjplus/match.js --repo $R --ckpt $CK --py $PY --opp random --n 100 --jobs 4                                 # 自检 B:对随机必须大胜
node test/sjplus/match.js --sj 80fen-test.html --opp index.html --n 50        # 两边都是我们的引擎 = ai-h2h(核对循环用,数字和 ai-h2h 逐位相同)
```

输出里「前者」= `--sj` 那一边。`--out x.jsonl` 断点续跑,`--json x.json` 存汇总,`--dump x.jsonl` 存每一手(给自检 A)。

## 适配层对齐了什么

- **牌名**:我们 `花色字母 + 点数`(`S14`,`X15` 小王,`X16` 大王)↔ 它 `A♠` / `XJ` / `DJ`。
- **座位**:我们 0..3(下家 +1)↔ 它 N→W→S→E(也是出牌顺序);相对位置由它自己的 `relative_to` 算。
- **级牌 / 主**:`trump.rank` ↔ `dominant_rank`;花色主 ↔ 同花色;无主 ↔ 王对亮主(`XJ` / `DJ`)或没人亮主(`declaration=None`,它那边也是无主)。
- **庄 / 亮主者**:照 `ai-h2h.js`,亮主者就是庄家(对应它「首局抢庄」那一半训练局)。
- **得分**:只有闲家已得分(不含抠底);它的环境把「庄家方分」那一栏也填成闲家分(原仓库如此),照做。
- **每墩历史**:最近 15 墩(含当前墩),按相对位置分栏;**未见牌** = 108 − 已出 − 自己手牌 −(庄家)底牌;**底牌**只有庄家看得到。
- **是否暂时最大**(每个候选一位):默认用我们裁判的判定(`--dom ours`),并统计和它自己判定不同的个数。
- **炒地次数**恒 0。带 oracle 练的权重还吃「别家明牌」(亮主亮出的牌、甩牌失败亮出的牌),也接了。

每条消息过 `check_msg` 的断言(牌张守恒、轮次、得分重算、底牌、候选在手牌里);出错直接中止,不带病续打。

## 限制(读数时要记得)

1. **不给 ShengJi+ 甩牌。** 它的领出候选只有单张 / 对子 / 拖拉机。
2. **跟牌候选上限 500**(`--cap`):超过就随机抽 500 个;大甩牌 + 缺门时组合数过大改为直接抽样。触发次数在输出里。
3. **它是在另一套规则下练的**,到我们的规则下成绩是**下限**。逐条核对见 `advanced-methods.md` 四点五;最要紧的一条:
   它的引擎判甩牌墩有毛病(同门、结构对得上的跟牌一律算赢过甩牌),所以它没学过「甩牌是赢墩」。`--opp-nothrow` 是量这一条的对照。
4. 扣底、亮主都不是它自己做的(只比打牌阶段)。
