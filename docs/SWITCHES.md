# AI 开关登记表

`80fen-test.html` 里 `AIP` 对象的全部可调参数。**这一页是生成的**,改完 AI 重跑:

每个参数一行:默认值、说明(行尾注释,没有就取上方注释的第一句)、**读取于**(读它的函数 —— 看它在打分链里的哪一环,对照 [`DESIGN.md` §5.0 函数地图](DESIGN.md#50-函数地图一次领出--跟牌--扣底经过哪些函数用哪些参数2026-09-25))。

```bash
node test/gen-switches.js 80fen-test.html > /tmp/sw.md   # 再把主体贴回本文件
```

## 怎么用

* **消融**:`AOVER` / `BOVER` 环境变量按座位覆盖任意参数,做同桌配对对照 ——
  用法见 [`notes/measurement.md`](notes/measurement.md)
* **`0` 通常是「退回上一版行为」**。这是这个项目的硬规矩:每条 AI 改动都要能一键退回,
  否则消融结论不可信(全关空跑必须精确 0.00)
* **扫大批量自对弈时记得 `egSearch=0`** —— 收官蒙特卡洛约 460ms/局,不关会很慢

## 几个最要紧的

| 参数 | 默认 | 一句话 |
|---|---|---|
| `egSearch` | `1` | 收官蒙特卡洛总开关。v0.7.0 的主体,+1.46 ±0.52 |
| `leadEV` | `1` | 非钢板领出走统一期望分口径(0 = 退回三条常数式) |
| `leadTeamP` | `1` | 领出侧牌权概率问「本队赢不赢」,不是「我这张活不活」 |
| `pairUrn` | `1` | 对子/拖拉机被压的概率按组合算。v0.5.7 全部收益来自这一条 |
| `cashPointW` | `0.8` | 稳拿这墩时,一张分值折合几级牌序。v0.5.8 单条收益最大(−1.89 若关掉) |
| `ruffOppRule` | `1` | 对手暂大时的「断门有分必毙」 |
| `oppSpendModel` | `1` | 对手「肯不肯花」模型(`oppSpendCeil`)。v0.7.3 把 −0.92 翻成 +0.15 |
| `ruffVoidBehind` | `20` | 后手有已知断门的对手时,毙牌吃罚分。v0.7.5,定点反事实量出来的 |
| `nearBossHold` | `16` | 「上面只剩一张」的留手期权(`futureValue`)。v0.7.8,正式版三批 +0.41 ±0.18、测试版四批 +0.49 ±0.15 |
| `dumpVoidFeedback` | `1` | 贴分时按「贴之后」的台面分重算存活率。v0.7.9,修「已知下家断门还把分贴过去」那一簇(8 条报障) |
| `cashWinPoints` | `1` | 末家稳拿这墩时,把「留着也赢不了墩」的主分牌兑现。v0.7.9,触发 0.17% |
| `throwBossSubset` | `1` | 甩牌可以只甩本门里压不住的那几组,不必整门。v0.7.9,触发 4.71% |
| `endKittyWeight` | — | 护底那个「量纲错误的大数值」。**别拆** —— 三次尝试全部掉分,原因见 negative-results |

**默认关、且已被实测否掉的**(`leadEV2` / `endKittyCap` / `reserveFloor` / `drawTrumpVsOne` /
`tiaoUnlock` / `buryPtShadow` / `takeOverScope` …)集中记在
[`notes/negative-results.md`](notes/negative-results.md),动它们之前先读那一页。

---

## 全部参数

| `voidValue` | `68` | 完全断门的战略价值(折算成分;扫参在 62~100 区间是平的,取低端) |
| `voidChainCredit` | `0.55` | 靠稳赢牌保住牌权再断门的折价(笔记里的「视为50%」) |
| `buryTrumpBlock` | `400` | 主牌埋底的硬性阻力 |
| `buryAceBlock` | `200` | 副花色 A 埋底的硬性阻力(见 faceValue;旧版是 +30,会被断门收益压过) |

### 跟牌侧「他这门有几张」的两条收紧(见 pSurvive 的 kOf)。各自 0 = 退回人均份额。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `holdKRange` | `1` | 持有区间(硬上下界)夹一道 | `pSurvive` |
| `voidCondK` | `1` | 已知断门 → 条件概率抬高他在别门(尤其主门)的密度 | `pSurvive` |
| `voidCondMax` | `2.2` | 抬高倍数的上限(断三门时 pool 会很小,别让它发散) | `pSurvive` |

### 「毙得够高」的候选(见 ruffGuardFollow + oppSpendCeil)。默认开,台面 ≥10 分才考虑。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `ruffGuard` | `1` | (见上方注释)「毙得够高」的候选(见 ruffGuardFollow + oppSpendCeil)。 | `aiChooseFollow` |

### 埋分的影子成本:每 1 分底分,额外折算多少「分」的留手负担。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `buryPtShadow` | `0` | (见上方注释)埋分的影子成本:每 1 分底分,额外折算多少「分」的留手负担。 | `aiDiscard` |
| `buryLowConf` | `2` | (v0.7.23 测试版默认开)守末墩没信心时每分底分的额外代价(0 = 旧行为),见 aiDiscard | `aiDiscard` |
| `buryConfLine` | `0.75` | — | `aiDiscard` |
| `buryConfBand` | `0.2` | — | `aiDiscard` |

### 队友「压回来」要分清是被本门大牌压的、还是被毙掉的(见 partnerRescueP)。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `rescueRuffAware` | `1` | (见上方注释)队友「压回来」要分清是被本门大牌压的、还是被毙掉的(见 partnerRescueP)。 | `partnerRescueP` |

### 规则级加成(push 的第 5 参是**罚分**,所以负数才是加成)。取 −25,和它的同门规则

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `ruffGuardBonus` | `-25` | (见上方注释)规则级加成(push 的第 5 参是**罚分**,所以负数才是加成)。 | `aiChooseFollow` |
| `ruffGuardMinPts` | `10` | 台面分下限(0 = 不设闸)。空气墩上这条规则挣不到钱 | `aiChooseFollow` |
| `ruffGuardEnd` | `1` | 收官阶段也允许(0 = 只在中盘) | `aiChooseFollow` |

### 对手的「肯不肯花」模型(见 oppSpendCeil)。0 = 退回只按持有分布定门槛。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `oppSpendModel` | `1` | (见上方注释)对手的「肯不肯花」模型(见 oppSpendCeil)。 | `aiChooseFollow` |
| `oppSpendGain` | `1` | 台面分在他眼里的权重 | `oppSpendCeil` |
| `oppSpendTempo` | `4` | 拿到牌权对他值多少分 | `oppSpendCeil` |

### v0.7.21 测试版改 0:test/calib-trick.js 量到「我毙了、预测 ≥0.9」实际只有 79% / 81% 拿下 ——

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `willingBeats` | `0` | (见上方注释)v0.7.21 测试版改 0:test/calib-trick.js 量到「我毙了、预测 ≥0.9」实际只有 79% / 81% 拿下 —— | `pSurvive` |

### 后手还有已知断门的对手时,毙牌的罚分(v0.7.5,见上面的反事实回放)。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `ruffVoidBehind` | `20` | 见上面 voidBehind 处的反事实回放 | `aiChooseFollow` |

### 对子/拖拉机被压的概率单独按组合算(见 pBeaterIn)。pairUrn=0 退回旧的单张公式。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `pairUrn` | `1` | (见上方注释)对子/拖拉机被压的概率单独按组合算(见 pBeaterIn)。 | `pBeaterIn` |
| `tractorTighten` | `0.6` | 拖拉机还要求连着,在 p^need 之上再收一道 | `pBeaterIn` |

### 「在外还有更大的对子」的概率低于这个值,就把自己的对子当钢板(见 pPairAbove)。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `pairBossMaxP` | `0.15` | (见上方注释)「在外还有更大的对子」的概率低于这个值,就把自己的对子当钢板(见 pPairAbove)。 | `isBossPlay` |
| `kittyMult` | `2` | 抠底倍数的估计值(按最后一墩单张算) | `aiDiscard` `kittyPts` `kittyMultOf` |
| `kittyPointBias` | `0.8` | 闲家倒推底分时的折扣(庄家倾向不埋分) | `kittyPointsEstRaw` |
| `jokerPairHold` | `7` | 王对的**成对溢价**(单张的压制价值已在 trumpHold 里,别算两遍) | `futureValue` |

### v0.7.8 ——「差一张就是钢板」的期权价值(见 futureValue)。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `nearBossHold` | `16` | 「上面只剩一张」的留手溢价(0 = 关) | `futureValue` |
| `nearBossLeadOnly` | `1` | 只在领出侧生效(反事实量的就是领出侧) | `futureValue` |
| `jokerPairDecl` | `5` | 庄家方护底的额外溢价 | `futureValue` |
| `trumpHoldBase` | `2.5` | 一张主牌的留手底价 | `trumpHold` |
| `trumpHoldTop` | `14` | 「在外已无更大」时额外的留手价值(相对刻度,见 trumpHold) | `trumpHold` |
| `gateDamp` | `0.6` | 对手面临必打关卡时,丢分损失的封顶折减 | `aiDiscard` |

### 钢板领出的基础分(v4:原 56 里有一截其实是「拿住牌权」,

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `bossBase` | `34` | (见上方注释)钢板领出的基础分(v4:原 56 里有一截其实是「拿住牌权」, | `scoreLeadCore` |

### 「领一轮主牌,队友也被迫跟出一张」的代价 —— 把 v0.6.0 查出来的那条先验

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `trumpLeadPrior` | `0` | (见上方注释)「领一轮主牌,队友也被迫跟出一张」的代价 —— 把 v0.6.0 查出来的那条先验 | `trumpLeadPrior` `scoreLeadEV` |
| `dtNegDamp` | `0.5` | 先验显式化之后,dt 负半边保留多少(它现在只表达「主牌不占优」) | `scoreLeadEV` |

### 钢板领出也走统一期望分口径,让 bossBase 退休。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `leadEV2` | `0` | (见上方注释)钢板领出也走统一期望分口径,让 bossBase 退休。 | `scoreLeadCore` |
| `futLeadCashDamp` | `0.35` | 副牌钢板领出时机会成本的折扣:它的未来价值本来就是「以后领出去收分」 | `scoreLeadCore` |
| `bossShapeBonus` | `22` | 配套 leadEV2=1 时的取值(扫参最优);leadEV2=0 时不生效 | `scoreLeadCore` |

### ========== v0.7.0:收官蒙特卡洛(endgameSearch) ==========

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `egSearch` | `1` | 总开关 | `scoreLeadCore` `endgameSearch` |

### 剩几张牌起用搜索。v0.7.0~v0.7.19 是 5;那时扫过「60 样本 + 从 6 张起搜」更差

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `egMaxCards` | `8` | (见上方注释)剩几张牌起用搜索。 | `aiChooseFollow` `endgameSearch` `aiChooseLead` |

### 每次决策抽多少个世界。扫参(配对差,相对 eg 关闭,350 种子 × 交换阵营):

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `egSamples` | `60` | (见上方注释)每次决策抽多少个世界。 | `endgameSearch` |
| `egMinSamples` | `20` | 抽不满这么多就退回启发式(约束太紧,样本不可信) | `endgameSearch` |
| `egRetries` | `24` | 单个世界的重试次数 | `sampleWorld` |
| `egMaxCands` | `6` | 候选多于这个数就不搜(预算) | `aiChooseFollow` `endgameSearch` `aiChooseLead` |

### 搜得更深时样本数按深度递减:samples = max(egMinSamples, egSamples − egSamplesBy×(n−5))。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `egSamplesBy` | `8` | 8 张时 36 个世界、5 张及以下仍是 60 | `endgameSearch` |

### 抽样按软断门概率加权:一张牌落到某家的权重 = 空位 × (1 − pVoid)^egVoidW。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `egVoidW` | `0` | (见上方注释)抽样按软断门概率加权:一张牌落到某家的权重 = 空位 × (1 − pVoid)^egVoidW。 | `sampleWorld` `endgameSearch` |

### 收官抽样:底牌按庄家的埋底策略抽,不再是「三家塞满之后剩下的牌」(见 sampleWorld)

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `egKittyModel` | `1` | 1 = 按埋底策略抽;0 = 均匀(v0.7.14 及以前) | `sampleWorld` |

### 分牌进底牌的相对权重,以及它为什么不算标定死

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `egKittyPtW` | `0.6` | 分牌进底牌的相对权重(1 = 和闲牌一样容易被埋) | `sampleWorld` |

### 收官抽样:把亮主者亮出的那几张(级牌 / 王对)钉在他手里 —— 硬信息,不是推断

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `egDeclKnown` | `0` | 默认关 | `endgameSearch` |

### 收官精确解:抽样世界里用完全信息极小极大代替推演(见 egSolve)

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `egExact` | `0` | 剩这么多张及以下时启用(0 = 关) | `endgameSearch` |

### 搜索结果与启发式打分的融合方式。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `egMargin` | `0.03` | (见上方注释)搜索结果与启发式打分的融合方式。 | `aiChooseFollow` `aiChooseLead` |

### 阶梯是阶跃的 —— 台阶内部要有梯度,搜索才不是瞎的。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `egPointsEps` | `0.008` | (见上方注释)阶梯是阶跃的 —— 台阶内部要有梯度,搜索才不是瞎的。 | `levelUtility` |
| `bossSize` | `8` | 每多一张的加成(对子/拖拉机更难被压) | `scoreLeadCore` |
| `leadTrumpPenalty` | `26` | 未到收官时领出主牌钢板的折扣 | `scoreLeadCore` |
| `drawTrumpUnit` | `6` | 钓主:我方每比对手多一张主牌值多少分 | `drawTrumpValue` |
| `drawTrumpCap` | `30` | 钓主项的上下限 | `drawTrumpValue` `trumpLeadPrior` |
| `leadWeakTrump` | `14` | 领出压不住场的主牌(非钢板)的固定折扣 | `scoreLeadEV` `scoreLeadCore` |

### 钓主(v4.7,见 tiaoWangValue)。tiaoWang=0 即整条关闭,便于消融。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `tiaoWang` | `1` | (见上方注释)钓主(v4.7,见 tiaoWangValue)。 | `partnerAceRead` `tiaoWangValue` |
| `tiaoDrawUnit` | `7` | 每逼出对手一张主牌值多少分(按下界算,最多记 2 张) | `tiaoWangValue` |
| `tiaoNoEdge` | `0.3` | 我方主牌不占优时,「逼消耗」只剩这个折扣(可能是替对手清场) | `tiaoWangValue` |
| `tiaoHandoff` | `1.0` | 牌权过渡给队友这一项的权重 | `tiaoWangValue` |
| `tiaoNoPartnerT` | `0.4` | 队友主门下界为 0(不确定他还有主)时的折扣 | `tiaoWangValue` |

### 副色小牌探路的罚分(v4.7)。豁免:队友多半握 A / 队友已断门(送毙) / 这门分已打光。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `probePenalty` | `12` | (见上方注释)副色小牌探路的罚分(v4.7)。 | `scoreLeadCore` |
| `probePairScale` | `0.5` | 对子探路的罚分折扣(对子难被跟死,危险小一档) | `scoreLeadCore` |
| `probeSafeBonus` | `6` | 推断出队友握 A 时,这门的小牌/分牌是贴分,该出 | `scoreLeadEV` `scoreLeadCore` |
| `leadTrumpEVScale` | `0.45` | 领出主牌时,这一墩能收到的分按副牌口径打的折(主牌人人攥着不放) | `leadPointsEV` `leadLossPoints` |
| `feedRuff` | `1.0` | 送毙(主打队友断门)的权重;设 0 即整条关闭,便于消融 | `trumpEdgeCount` `feedRuffValue` |
| `feedRuffMinP` | `0.35` | 队友断门概率低于这个值就不当成送毙机会 | `feedTempoValue` `feedRuffValue` |

### ===== v0.7.21 牌权交接包(产品方 2026-09-24:「这些问题不是孤立的,一起改完一起测」) =====

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `leadTempoSplit` | `1` | 领出牌权项拆三份:我拿下/队友拿下(算他能兑现多少)/对手拿下(v0.7.21 测试版默认开) | `tiaoWangValue` `leadTempo` `scoreLeadEV` |

### partnerCashValue 里每一项的权重(1 = 与 tempoValue 同一量纲)。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `partnerCashW` | `1.0` | (见上方注释)partnerCashValue 里每一项的权重(1 = 与 tempoValue 同一量纲)。 | `partnerCashValue` |

### bossRuffEV —— 副牌钢板、但对手多半断这门(> bossRuffEVP)时,改走统一期望分口径

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `bossRuffEV` | `1` | 对手多半断这门时,副牌钢板领出改走期望分口径(v0.7.21 测试版默认开) | `scoreLeadCore` |
| `bossRuffEVP` | `0.5` | — | `scoreLeadCore` |

### feedRuffPts —— 送毙(领队友断门的牌)也可以带分:他毙下来,这些分归我方。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `feedRuffPts` | `1` | 送毙(领队友断门的牌)可以带分(v0.7.21 测试版默认开) | `feedRuffValue` |

### tiaoAccept —— 队友领一张非钢板的小主(钓主)时,我跟牌打分里「拿下牌权」那一项

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `tiaoAccept` | `1` | 队友钓主时,接过去那一手的牌权按领出口径计(v0.7.21 测试版默认开) | `aiChooseFollow` |

### ===== §7.13 阶段 0:拆墙 =====

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `trumpLeadRel` | `1` | 领主代价相对化:首选是领进对手断门时,退还钓主的两笔罚分(比例)(v0.7.21 测试版默认开) | `aiChooseLead` |

### voidLeadCost —— 领进对手多半断的门,补上漏掉的那一笔:断门那一家多一次氽废的机会

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `voidLeadCost` | `4` | 领副牌的罚分 × 对手断这门的概率(断门那家多一次氽废)(v0.7.21 测试版默认开) | `scoreLeadEV` |

### ===== §7.13 阶段 3:推断先校准(test/calib-infer.js)=====

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `voidReadSoft` | `0.9` | 行为读牌推到 0 张时的断门概率(voidReadTrust<1 时不单独生效)(v0.7.21 测试版默认开) | `makeVoidProb` |

### voidReadTrust —— 行为读牌**整体**部分采信,不只是推到 0 张那一格:

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `voidReadTrust` | `0.6` | (v0.7.21 测试版默认开)calib-infer:0.8 / 0.6 / 0.4 对数损失 0.353 / 0.354 / 0.355,0.6 分箱最均衡; | `makeVoidProb` |

### declVoidPrior —— 推断**庄家**的断门时,加上「他换过 8 张底、多半做出了断门」的先验:

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `declVoidPrior` | `0.25` | 推断庄家断门时加上换底先验:p ← p+(1−p)×此值(v0.7.21 测试版默认开) | `makeVoidProb` |

### pptMidOpp —— 「对手暂大、指望队友压回来」时,我和队友之间**还隔着一个对手**(我坐第 2 家、队友末手)。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `pptMidOpp` | `1` | 指望队友压回来时,算上中间那家对手先压 / 先毙(v0.7.21 测试版默认开) | `pPartnerTakes` |

### ruffWillCal —— 断门且有主的那家肯不肯毙,按实测改(见 ruffWill)。0 = 旧的 0.80 / 0.35。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `ruffWillCal` | `0` | (见上方注释)ruffWillCal —— 断门且有主的那家肯不肯毙,按实测改(见 ruffWill)。 | `ruffWill` |
| `ruffWillZero` | `0.72` | — | `ruffWill` |
| `ruffWillPts` | `0.88` | — | `ruffWill` |

### 留手价值按座次与底分拆开(产品方,2026-09-25)。0 = 旧行为:「在外已无更大」的主牌一律 +trumpHoldTop,

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `feedTempo` | `1` | (v0.7.23 测试版默认开)跟牌时「压下后下一墩可以送队友毙」的牌权价值权重(0 = 旧行为),见 feedTempoValue | `scorePlay` |
| `stakeHold` | `1` | (v0.7.23 测试版默认开) | `oppSpendCeil` `kittyPointsEst` `trumpHold` `futureValue` |
| `holdCtrlShare` | `0.4` | — | `trumpHold` |
| `stakeRef` | `30` | 底分×2 达到多少算「值得整局留手」(15 分底) | `stakeFactor` |
| `stakeCap` | `1.0` | 只往下打折、不超过旧的顶格值(旧常数就是「底分足够大」时的值);1.5 时自测「收官+30 分底:主A 仍肯花」不过 | `stakeFactor` |
| `partnerKittyK` | `0.25` | — | `kittyPointsEst` |

### trumpSealW 现在是常数。正确形式(产品方,2026-09-25,待做):末家肯不肯拿大主来盖,

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `trumpSealW` | `0.5` | (见上方注释)trumpSealW 现在是常数。 | `pSurvive` |
| `trumpSealWPts` | `0.5` | — | `pSurvive` |
| `trumpTakeAll` | `0` | 1 = 将牌单张墩把每一档压得过的主都列为候选(见 aiChooseFollow 第 0 步);0 = 旧行为         // 台面**有分**时的那一档(= trumpSealW 即旧行为);见 pSurvive             // (v0.7.22 测试版默认开)只在跟牌时生效 | `aiChooseFollow` |

### ===== §7.14 牌权按产品方的模型重做(2026-09-25)=====

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `tempoModel` | `0` | 开 vs 关(1400 种子):−0.78 ±0.32 分/局(t=−2.45,4 块全负)、−0.009 级/局 —— 默认关 | `tempoValue` `scorePlay` `leadTempo` |
| `tempoModelW` | `1.0` | 新口径下跟牌打分里牌权的权重(两边都是「分」,不再打 0.35 折) | `scorePlay` |
| `tempoChainMinP` | `0.3` | 守住概率低于这个的那一手不进链(领出去多半是交牌权,链到此为止) | `leadChainValue` |
| `pwGain` | `0.5` | 比分敏感度对「现在兑现 vs 留着压制」的调节幅度 | `pointWeight` |
| `grabBonus` | `85` | 无庄盘抢庄红利(有主) | `scoreDeclOption` |
| `grabBonusNT` | `58` | 无庄盘抢庄红利(无将,主牌只有12张压不住场) | `scoreDeclOption` |
| `declSingleOption` | `8` | 有对却只亮单张:不暴露 + 保留加固权的价值(信心越足越不值钱) | `scoreDeclOption` |
| `declOverrideCost` | `45` | 亮的单张被别家一对常主反掉的代价 | `scoreDeclOption` |
| `rebelThresholdAdd` | `12` | 造反(相对首亮)的额外门槛:打乱一个已成立的主色有摩擦成本 | `aiDeclDecide` |
| `ntReluctance` | `0.5` | 亮无将的基础不情愿(暴露一对王 + 无将局毙牌手段极少) | `declHandQuality` |
| `ntDefenderEdge` | `0.25` | 无将对闲家有利、对庄家方不利(拆掉长将牌碾压机) | `declHandQuality` |
| `ruffSatTrump` | `12` | 毙牌能力饱和点(有主局,人均9张的约1.35倍) | `aiDiscard` |
| `ruffSatNT` | `5` | 毙牌能力饱和点(无将局,人均3张) | `aiDiscard` |

### v0.5.8 ①:视野前移。旧值 4 + 1/6 在底分 13 时算出 hz=6.2 —— 前 19 墩护底价值恒为零,

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `endHorizon` | `5` | 剩几张牌起算「最后一墩争夺」(底分越大越提前,见 endHorizonOf) | `endHorizonOf` |
| `endHorizonMax` | `12` | 提前量的上限 | `endHorizonOf` |
| `endHorizonPerPt` | `0.25` | 每 1 分底分,把「最后一墩争夺」提前多少张牌 | `endHorizonOf` |

### 护底价值占「底牌那笔翻倍分」的比例。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `endKittyWeight` | `5.0` | (见上方注释)护底价值占「底牌那笔翻倍分」的比例。 | `oppSpendCeil` `futureValue` |
| `reserveMarginal` | `1` | 1=护底代价按边际算(还有第二手钢板就不该全额计价)×reserveHold;0=旧的全额 | `futureValue` |
| `ruffStruct1` | `0.85` | 对手断门时,毙掉我一张副牌单张的把握 | `reserveHold` |
| `ruffStruct2` | `0.45` | 毙掉一个副牌对子(要一对主)的把握 | `reserveHold` |
| `ruffStruct3` | `0.25` | 毙掉三张以上的一手副牌(要同结构的主)的把握 | `reserveHold` |
| `sideReserveDamp` | `0.6` | 副牌护底的折扣:它还要求倒数第二墩就握着牌权 | `reserveHold` |
| `endPhaseKPerPt` | `0.045` | 收官留手折扣随底分的抬升(底分 0 → 0.15,底分 20 → ≈1.05) | `phaseK` |
| `endPhaseKCap` | `1.1` | 抬升上限 | `phaseK` |
| `tempoWeight` | `0.35` | 牌权价值在跟牌打分里的权重 | `scorePlay` |
| `leadTempoWeight` | `1.0` | 牌权价值在领出打分里的权重。比跟牌侧(0.35)高得多, | `aiChooseFollow` `leadTempo` |
| `tempoCap` | `40` | 牌权价值上限(贴现和自己会收敛,这个只当兜底) | `tempoValue` `leadChainValue` `oppChainValue` `partnerCashValue` |
| `tempoDecay` | `0.80` | 待兑现单元按价值降序的贴现率:下一墩权重最高,往后递减 | `tempoValue` `oppChainValue` `partnerCashValue` |
| `oppTempo` | `6` | 牌权落到对手手里的估计代价 | `oppChainValue` `feedTempoValue` `scorePlay` `tiaoWangValue` `leadTempo` `partnerCashValue` `feedRuffValue` |
| `fragileBonus` | `0.18` | 每多一张,组合被拆的风险溢价(飞机大炮该早兑现) | `bossUnits` |
| `dumpPartner` | `0.85` | 队友把本门分贴过来的比例 | `laterPoints` |
| `dumpOpp` | `0.85` | 后手对手能掏出多少本门分 | `laterPoints` `leadLossPoints` |
| `handShare` | `4` | 「某家握有这门未见牌的几分之一」的兜底值(领出时用;跟牌用实际手牌数动态算) | `pSurvive` `pPartnerTakes` `leadChainValue` `aiChooseFollow` |
| `pNoPartnerLeft` | `0.02` | 队友已出过牌、对手暂大时,这墩还能翻盘的概率 | `pPartnerTakes` |

### 「对手暂大、队友还没出牌时,本队还能把这墩夺回来」的概率。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `pPartnerPrior` | `0.32` | (见上方注释)「对手暂大、队友还没出牌时,本队还能把这墩夺回来」的概率。 | `pPartnerTakes` |
| `pPartnerCalc` | `1` | 记牌证据相对先验的采信比例;0 = 完全用先验(v0.7.19 之前的默认) | `pPartnerTakes` |
| `blockWin` | `1` | 1=生成「盖住末家分牌」的吃法候选;0=只用最省的吃法(消融用) | `aiChooseFollow` |

### 第 2 家、领出方暂大、队友坐末手而且高概率断这门(他会毙)—— 贴分(§7.9 的 A3)。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `partnerRuffDump` | `1` | (见上方注释)第 2 家、领出方暂大、队友坐末手而且高概率断这门(他会毙)—— 贴分(§7.9 的 A3)。 | `aiChooseFollow` |
| `partnerRuffDumpPV` | `0.5` | 「队友高概率断这门」的门槛,与 audit-scenarios 同一个数 | `aiChooseFollow` |

### 跟牌时拆掉一个副花对子的代价(见 pairUnit / futureValue)。**默认 0,还在量。**

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `pairHold` | `0` | (见上方注释)跟牌时拆掉一个副花对子的代价(见 pairUnit / futureValue)。 | `futureValue` |

### 闸门改成两个**无状态**条件(v0.7.18 第二轮)。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `pairHoldMaxTricks` | `3` | 已打过的墩数超过它就不给 | `futureValue` |
| `pairHoldMinPairs` | `3` | 手上副花对子少于它就不给 | `futureValue` |

### 毙牌保留价的权重(见 ruffReserve)。**默认 0 —— 第一步,还在量。**

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `ruffReserveW` | `0` | (见上方注释)毙牌保留价的权重(见 ruffReserve)。 | `futureValue` |

### 打级(级牌 5/10/K,那 8 张级牌本身带 40 / 80 分)上单独量出来的两格

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `trumpPtDebt` | `0` | 主牌里的分牌也记「迟早要出」的负债(level 10 自对弈 −0.56 ±0.26,关) | `futureValue` |
| `ptLevelBonus` | `25` | 分级的亮主加成;砍到 0 / 10 打级自对弈 −0.28 / −0.21 级/场,不动 | `declHandQuality` |

### 闲家亮对:把主定在自己的长门上,不再偏爱「先亮单留后路」(见 scoreDeclOption)

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `defDeclPair` | `0` | 默认关 | `scoreDeclOption` |
| `defPairBonus` | `10` | 闲家亮对的加成 | `scoreDeclOption` |
| `defThreshAdd` | `0` | 闲家亮主门槛的增减(负 = 更爱亮) | `aiDeclDecide` |

### 跨线的即时加成:赢下这一墩就把闲家推过某条线(见 ladderCross)

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `ladderCross` | `0` | 加成的强度(0 = 关) | `ladderCross` |

### 「接过队友」的开放范围:0=关 | 1=将牌墩与断门毙分 | 2=全开 | 3/4=单支消融(见 takeOverScoped)。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `takeOverScope` | `4` | (见上方注释)「接过队友」的开放范围:0=关 \| 1=将牌墩与断门毙分 \| 2=全开 \| 3/4=单支消融(见 takeOverScoped)。 | `takeOverScoped` |
| `takeOverMaxCertainty` | `0.85` | 队友暂大且确定性低于此值时,才生成「接过来」的候选(v4.3) | `aiChooseFollow` |

### 压自家队友的固定分差。**v4.4 起是负数,也就是一份加成。**

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `overPartner` | `-4` | (见上方注释)压自家队友的固定分差。 | `aiChooseFollow` |

### 「队友暂大但我断门且台面有分」这一条是**规则**,不是权重:给一份足够大的加成,

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `ruffPartnerBonus` | `-25` | (见上方注释)「队友暂大但我断门且台面有分」这一条是**规则**,不是权重:给一份足够大的加成, | `aiChooseFollow` |
| `ruffPartnerMinPts` | `5` | 台面分下限:一分没有的空气墩不值得动主 | `aiChooseFollow` |
| `takeOverMinPts` | `5` | 断门毙分那一支的桌面分下限 | `takeOverScoped` |
| `partnerHoldAfter` | `0.72` | 队友压回来之后,身后还有对手时守得住的比例 | `pPartnerTakes` |
| `dumpVoidFeedback` | `1` | 贴分时按「贴之后」的台面分重算存活率(0 = 退回旧行为) | `pTeamWin` |
| `cashWinPoints` | `1` | 稳拿这墩时,额外生成一条「把主分牌兑现」的候选(0 = 关) | `aiChooseFollow` |
| `cashWinMinAbove` | `0.3` | 上面压着的主牌要占未见主的这个比例,才算「留着也赢不了墩」 | `aiChooseFollow` |
| `throwBossSubset` | `1` | 甩牌候选可以只甩本门里压不住的那几组(0 = 只能甩整门) | `aiChooseLead` |

### 第 0 波:支配性错误。这四条只会删掉「被支配的选项」,不改任何权衡口径。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `trumpNoPremium` | `1` | ⑦① controlPremium 只对副牌生效(0=退回旧行为) | `isBossPlay` |
| `trumpTopPremium` | `1` | ⑦① 主牌梯子顶端(大小王/正副常主)的控制溢价(0=关闭) | `isBossPlay` |
| `cashPointW` | `0.8` | ⑨  稳拿这墩时,一张分值折合几级牌序(0=关闭,不兑现主分牌) | `isBossPlay` `buildFollow` |
| `dumpTrumpDiscount` | `0.5` | ⑧  贴分排序里主牌上的分打几折(1=退回旧行为) | `isBossPlay` |
| `grabPartnerKeep` | `0.08` | ⑤  无庄盘、庄位已在本队时,抢庄红利还剩几成 | `scoreDeclOption` |

### 第 1 波:补上只写了一半的规则。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `ruffOppRule` | `1` | ③  对手暂大时的「断门有分必毙」(0=关闭,退回纯打分) | `aiChooseFollow` |
| `ruffOppBonus` | `-25` | ③  与 ruffPartnerBonus 同量级 —— 它们本来就是同一条规则的两半 | `aiChooseFollow` |
| `ruffOppMinPts` | `5` | ③  台面分下限 | `aiChooseFollow` |
| `takeOverEndTrump` | `1` | ②  收官阶段对将牌墩放开「接过队友」(0=退回旧行为) | `takeOverScoped` |
| `tiaoUseExp` | `1` | ②  钓主的判据改用**期望**张数而非硬下界(0=退回旧行为) | `tiaoWangValue` |

### ② 「逼出对手的主」解锁了多少我方副牌钢板的价值。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `tiaoUnlock` | `0` | (见上方注释)② 「逼出对手的主」解锁了多少我方副牌钢板的价值。 | `tiaoWangValue` |

### ② drawTrumpValue(**打分项**)也改成一家比一家。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `drawTrumpVsOne` | `0` | (见上方注释)② drawTrumpValue(**打分项**)也改成一家比一家。 | `drawTrumpValue` |

### ② 钓主的「我方主牌占不占优」判据用一家比一家。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `tiaoEdgeVsOne` | `0` | (见上方注释)② 钓主的「我方主牌占不占优」判据用一家比一家。 | `tiaoWangValue` |

### ② 钓主里那条「逼对手吐主」的收益。**默认 0 —— v0.6.0 起改由 pTeam 表达。**

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `tiaoDrawOut` | `0` | (见上方注释)② 钓主里那条「逼对手吐主」的收益。 | `tiaoWangValue` |

### ② 队友救回来的概率到多少才算「这是一次钓主」。**只影响理由字符串,不影响出牌。**

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `tiaoLabelP` | `0.20` | (见上方注释)② 队友救回来的概率到多少才算「这是一次钓主」。 | `scoreLeadEV` |

### 第 2 波:拆掉两处补丁堆。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `leadEV` | `1` | ④⑥ 非钢板领出走统一期望分口径(0=退回三条手写常数式) | `scoreLeadCore` |

### ② v0.6.0:领出侧的牌权概率改问「本队赢不赢得下这墩」。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `leadTeamP` | `1` | 0 = 退回旧的 pSurvive 口径 | `leadWinP` `scoreLeadEV` |
| `leadRescueDamp` | `0.7` | 队友「压回来」的折扣(他要压的是对手那张,不是我这张) | `partnerRescueP` |
| `leadShapeBonus` | `4` | ④⑥ 牌型可打性:拖拉机/对子难被跟死,同 p 下更该打。 | `scoreLeadEV` |
| `endNearGamma` | `0.5` | ①③ 护底曲线的幂(1=旧的线性,视野入口几乎不给分) | `oppSpendCeil` `futureValue` `ruffReserve` |

### ①③ 护底封顶 = kp×kittyMult 的几倍(0=不封顶,退回 endKittyWeight 那条式子)。

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `endKittyCap` | `0` | (见上方注释)①③ 护底封顶 = kp×kittyMult 的几倍(0=不封顶,退回 endKittyWeight 那条式子)。 | `futureValue` |

### ①③ 边际护底的下限。**同样被实测否掉,默认 0(即旧行为)。**

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `reserveFloor` | `0` | (见上方注释)①③ 边际护底的下限。 | `futureValue` |

### ========== v0.6.0:最后一墩的口径 ==========

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `kittyMultDyn` | `1` | 抠底倍数按 reserveUnit 的张数估,不再是常数 2(0=退回常数) | `kittyMultOf` |
| `kittyMultMaxSize` | `3` | 估计时最多按几张算(拖拉机 ×8 已经很极端,别外推更远) | `kittyMultOf` |
| `ladderKitty` | `1` | 阶梯目标的「当前总分」含那笔待翻倍的底分(0=退回旧行为) | `kittyProjection` |
| `guardPw` | `1` | 护底项也过 pointWeight,与当墩 ev 用同一把尺子(0=退回旧行为) | `futureValue` |

### ========== v0.7.11:多张垫/贴的取牌口径 ==========

| 参数 | 默认 | 说明 | 读取于 |
|---|---|---|---|
| `discardGreedy` | `1` | 跟对子/拖拉机要垫多张时逐张贪心,每取一张重算排序键 | `isBossPlay` |
