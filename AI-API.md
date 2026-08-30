# 80分 AI 比赛 —— 参赛者手册

你要交的是**一个 `.js` 文件**。规则引擎、发牌、结算、排名全由裁判负责,你只写决策。

三份文档的分工:

| 想知道 | 看 |
|---|---|
| 这个游戏怎么玩、每个判定的准确形式 | [`RULES.md`](RULES.md) |
| 这一版 AI 是怎么想的、每个参数什么意思 | [`DESIGN.md`](DESIGN.md) §1–§11、[`SWITCHES.md`](SWITCHES.md) |
| **接口、赛制、怎么本地跑分** | 本文 |

---

## 1. 交什么

```js
// my-ai.js
module.exports = ({E, AI}) => ({
  name: '你的名字',

  onDeal(view)         { return null; },        // 亮主 / 反主 / 加固
  onRebel(view)        { return false; },       // 低分造反
  discard(view)        { return view.hand.slice(0, E.RULES.kittySize); },  // 扣底 8 张
  lead(view)           { return [view.hand[0]]; },        // 领出
  follow(view, plays)  { return [view.hand[0]]; },        // 跟牌
});
```

裁判把 `{E, AI}` 传给你的工厂:

* **`E`** —— 引擎。30 个纯函数,是**稳定契约**,见 §5。
* **`AI`** —— 基线 v0.7.13 的全部内部函数(101 个)。想从基线改起就用它,但它**不保证跨版本稳定**,用了就绑在这一版上。想从零写就别碰。

五个方法可以只实现一部分 —— 没实现的阶段走裁判兜底(用基线的对应函数),不算违规,但那一段等于放弃。

**你拿到的是你自己那一份 `E` 和 `AI`**,在你自己的 realm 里加载。改 `AI.AIP`、改 `Array.prototype`、甚至改引擎,都只改到你自己那份,污染不到裁判和对手。裁判用第三份独立加载的引擎判合法性,你碰不到。

---

## 2. `view` —— 你能看到的一切

这是 AI 的**唯一**信息入口。没有别的口子:看不到别人的手牌,看不到未发的牌,看不到底牌(除非你是庄家)。

`view` 和里面每一张牌都是**冻结**的深拷贝。你改不动,也不必改。基线 AI 内部会往 view 上挂字段,所以基线包装里先 `Object.assign({}, view)` 化冻 —— 你要复用基线函数也得这么做。

### 每个阶段都有的

| 字段 | 类型 | 说明 |
|---|---|---|
| `phase` | `'deal'｜'rebel'｜'discard'｜'lead'｜'follow'` | 这次问的是哪件事 |
| `seat` | `0..3` | 你的座位。0=南 1=东 2=北 3=西,`(seat+1)%4` 是你下家 |
| `myTeam` | `0｜1` | `seat%2`。队友是 `(seat+2)%4` |
| `hand` | `Card[]` | **你自己**的手牌。`deal` 阶段只有已发到你手上的那几张 |
| `trumpRank` | `2..14` | 本局打几 |
| `trump` | `{suit, rank}｜null` | 主。`suit===null` 是无主局。`deal` 阶段恒为 `null` |
| `declSeat` | `0..3｜-1` | 庄家。`deal` 阶段恒为 `-1` |
| `curDecl` | `{seat,suit,strength}｜null` | 当前的亮主。`strength`: 1=单张 2=一对 3=小王对 4=大王对 |
| `rebelHappened` | `boolean` | 已经有人用王对反过 —— 之后不能再加固 |
| `dealerKnown` | `boolean` | `false` = 无庄局,各家按自己队的级数抢亮,最终亮主者坐庄 |
| `dealer` | `0..3｜-1` | 本局庄家(无庄局为 `-1`) |
| `firstTaker` | `0..3` | 先拿牌的那家 |
| `levels` | `[l0, l1]` | 两队级数。`levels[myTeam]` 是你队打到几 |
| `played` | `[p0, p1]` | 各队**坐庄守住过**的最高级数,没有则 `-1`。关卡判定要用 |
| `gates` | `number[]` | 必打关卡,默认 `[2,5,10,13]` |
| `round` | `number` | 这是整场的第几局(0 起) |
| `kittySize` | `8` | 底牌张数 |
| `history` | `Play[]` | 已出的牌,见下 |
| `buriedKnown` | `Card[]` | 底牌 —— **只有庄家非空**,别人恒为 `[]` |

### 分阶段追加的

| 阶段 | 追加 |
|---|---|
| `rebel` | `rebelReason: {pts, nT, byPts, byTrump}` —— 你凭什么够格造反 |
| `lead` / `follow` | `trickNo` —— 这是第几墩(0 起) |

### `Card`

```js
{suit: 'S'|'H'|'D'|'C'|'X', rank: 2..16, id: 0..107}
```

`X` 是王:`rank` 15=小王,16=大王。两副牌,所以每种牌有两张,**`id` 全场唯一** —— 裁判只认 `id`。

### `history` —— 最容易写错的地方

它是**扁平**的 `{seat, cards}` 数组,不是按墩分组的。

* **每连续 4 个元素是一墩**,第一个是那墩的领出。
* 一手可能是多张(对子、拖拉机、甩牌)—— 但**一墩永远是 4 手**,不管每手几张。
* `history.length % 4` 就是本墩已经出了几手。
* 你在 `follow` 里拿到的 `history` **已经包含**本墩前面几家出的牌;`plays` 参数是同样这几手，单独给一份方便用。

想按墩切:

```js
const tricks = [];
for (let i = 0; i + 4 <= view.history.length; i += 4)
  tricks.push(view.history.slice(i, i + 4));
```

`E.makeVoids` 之类的基线函数就是这么解析的 —— 你自己写也得守同一个约定。

---

## 3. 五个方法

### `onDeal(view) → {suit, strength} | null`

发牌是**逐张**的,每发到你手上一张就问你一次 —— 100 次。发完之后还会绕圈再问,直到一整圈没人动作(上限 4 圈),所以"最后一张到手才够格亮"也来得及。

返回 `null` = 这次不亮。返回一个选项 = 现在就亮。

**合法的选项**只有这些(裁判会校验,不合法当作没亮并记一次违规):

```js
const cands = [...E.declOptions(view.hand, view.trumpRank)];  // 手上的级数牌
const jp = E.jokerPairOf(view.hand); if (jp) cands.push(jp);  // 王对
```

* `declOptions` 给的是 `{suit, strength:1}`(单张)和 `{suit, strength:2}`(一对)。有一对时**两个都给** —— 亮单张不暴露这对牌、还留着"加固"这条后路,亮一对除王对外无人能反但把牌摊给了对手。
* `jokerPairOf` 给 `{suit:null, strength:3}`(小王对)或 `{suit:null, strength:4}`(大王对) —— 反成无主局。
* 压过别人要 `E.canOverride(view.curDecl, opt, view.seat)`:`strength` 必须更大,且**不能反自己**。
* **加固**(自己亮的单张升成一对)是唯一的例外,`canOverride` 对它返回 `false`。条件是 `E.canReinforce2(curDecl, seat, hand, trumpRank, rebelHappened)` —— 必须是你自己亮的、必须是单张、必须还没人用王对反过。裁判会认这一条。

**无庄局**(`dealerKnown === false`)里,你的级数是 `view.trumpRank`,它已经按 `levels[seat%2]` 算好了 —— 各家按自己队的级数抢亮,谁亮到就用谁的级数打。

### `onRebel(view) → boolean`

定主之后,如果你手牌太差(分 ≤ 15,或主牌 ≤ 3 张),裁判会问你要不要掀桌重发。只有**庄家的对方队**会被问,从庄家下家起问一圈,第一个说 `true` 的生效。

重发之后按无庄局处理(双方重新抢庄)。同一局最多连重发 3 次(`RULES.maxRedeal`),之后直接开打。

⚠️ **基线在这里没有策略** —— 界面块里这件事是掷骰子决定的(`rand() < 0.7`),AI 层从来没为它写过判断,基线只好照抄"够格就反"。这是最明摆着的可超越点之一。

### `discard(view) → Card[8]`

你是庄家,手上 33 张(25 + 底牌 8 张),扣掉 8 张。

必须**恰好 8 张、全在手上、无重复**。不合契约记一次违规,裁判用基线的 `aiDiscard` 替你扣,局照打。

扣底的分会翻倍算给闲家 —— 倍数是 `2 × 最后一墩每人的张数`,所以末墩被拖拉机拿走就是 ×8。

### `lead(view) → Card[]`

领出。返回 `Card[]` 或 `{cards: Card[]}` 都行(基线返回后者)。

甩牌要过 `E.checkThrow(hands, seat, cards, trump)` —— 但你看不到 `hands`,所以甩牌永远是**赌**:赌没人能吃下你最小的那一组。赌输了裁判罚你只出 `chk.forced`(`top` 最小的那一组)并记一次违规。

### `follow(view, plays) → Card[]`

跟牌。`plays` 是本墩已出的几手,`plays[0]` 是领出。

```js
const lead = E.classify(plays[0].cards, view.trump);   // {type, len, suit, top, cards}
```

必须过 `E.isLegalFollow(hand, lead, chosen, trump)`,否则裁判替你出 `E.genFollow(...)`(合法但很笨)并记一次违规。跟牌规则的完整形式见 `RULES.md` §S3,要点:

1. 张数必须等于领出的张数;
2. **有则必跟**:本门有几张就得出几张(`min(领出张数, 本门张数)`);
3. **对子也得跟**:领出有 `need` 对,你本门有 `have` 对,就得出 `min(need, have)` 对;
4. 领出是拖拉机时,手上有同长或更长(可拆)的拖拉机**必须跟**;只有更短的也必须跟出短的(`partialTractorFollow`,默认开)。

**自己先用 `isLegalFollow` 验一遍再返回。** 兜底的 `genFollow` 会把你的牌打烂。

---

## 4. 裁判的校验与兜底

| 情况 | 裁判怎么做 | 记违规 |
|---|---|---|
| 抛异常 | 当作没返回,走兜底 | ✅ |
| 返回的牌不在手上 / 有重复 / 形状不对 | 走兜底 | ✅ |
| `onDeal` 返回不合法的选项 | 当作不亮 | ✅ |
| `discard` 张数不对 | 用基线的 `aiDiscard` | ✅ |
| `lead` 甩牌被吃 | 罚出 `top` 最小的一组 | ❌ **不算违规** |
| `follow` 不合法 | 用 `genFollow` | ✅ |
| 没实现某个方法 | 走兜底 | ❌ |

裁判**只认 `id`**:你返回什么形状的对象都无所谓,它按 `id` 去自己那份手牌里取真牌。所以伪造牌面、返回篡改过的副本,一律无害也无用。

违规不会让你当场判负,但会计入排名报告。**大量违规 = 你的 AI 有 bug**,不是策略。

甩牌被罚单独数,不算违规 —— 甩牌本来就是赌没人吃得下你最小的那一组,基线自己也会赌输(240 场里 9 次)。混进违规里报会让你以为自己写错了。

**超时**:每次调用都计时。node 里同步调用没法真正打断,所以超时不会中断你 —— 但总用时会公示,超出预算(默认基线的 3 倍)的提交不进决赛。这是君子协定加护栏的诚实边界。

---

## 5. `E` —— 引擎给了什么

```
RULES  makeDeck  cardPoints  countPoints  rng  dealRound  cutForFirst
effSuit  ordIdx  decompose  classify  isLegalFollow  resolveTrick  checkThrow
declarationOf  canOverride  declOptions  jokerPairOf  canReinforce2  canFullRebel
dealerAfterDecl  scoreRound  advanceMatch  clampAtGate  countPairsIn  maxTractorLen
structMatches  removeCard  aiLead  genFollow
```

最常用的六个:

| 函数 | 干什么 |
|---|---|
| `effSuit(c, trump)` | 这张牌**实际**算哪门 —— 主牌(王、级数牌、主花色)一律返回 `'T'` |
| `ordIdx(c, trump)` | 主牌内部的大小:15 大王 / 14 小王 / 13 正级 / 12 副级 / 11–0 主花色散牌 |
| `decompose(cards, trump)` | 把一把同花色的牌拆成单张/对子/拖拉机 |
| `classify(cards, trump)` | 一手牌是什么结构 → `{type:'single'｜'pair'｜'tractor'｜'throw', len, suit, top, cards}` |
| `isLegalFollow(hand, lead, chosen, trump)` | 这么跟合不合法 |
| `resolveTrick(plays, trump)` | 这墩谁赢、多少分 → `{winner, points}` |

`RULES.md` §S3 有全部八个判定的伪码,§S5 有约 60 条自测向量 —— 你要自己重写引擎的某一部分(比如为了搜索得更快),拿那张表验。

---

## 6. 赛制

**打级,考全套。** 一场从 2 打到 A,谁先打过 A 谁赢,平均 30 局左右。亮主、造反、扣底、出牌全部由参赛者决定。

**排名**:所有人对**同一个基线**(`contest/ai-baseline.js`)打同一批种子。N 个人跑 N 次,不是 N² 次。前几名再两两决赛。

**交换阵营**:每个种子跑两场,第二场阵营对调,**两场用同一个 `matchSeed`** —— 第一局的牌完全相同。打级里这只能消掉第一局的牌运:庄家轮换按输赢分叉,之后两场的牌序列必然发散。这是打级赛制的固有代价(单副对照能把牌运消干净,打级不能)。

**三个口径**同时打出来:

| 口径 | 是什么 | 用途 |
|---|---|---|
| 胜场 | 谁先打过 A | **排名用这个** —— 打级的定义 |
| 级数差 | 终局你的级数 − 对手的级数 | 连续量,方差比胜场小 |
| 每局净分 | 把整场拆回单副 | 样本量 ×30,判断"改动有没有用"最灵敏 |

**看配对口径那一段,别看逐场那一段。** 这是 [`NOTES/measurement.md`](NOTES/measurement.md) 里反复讲过的教训:交换阵营的两场是同一批牌,牌运在它们之间是**反相**的。把它们当成两个独立样本(逐场口径),两边完全一样时 `d` 与 `−d` 成对出现、均值恒为 0,SE 却会算出一个不小的数。先把同一种子的两场合成 `D = (d₀+d₁)/2` 再求 SE(配对口径),两边一样时 `D` 每个种子都恰好是 0,SE 也就是 0 —— 余下的方差全部来自两边**行为真的不同**的那些种子。

跑分器同时打出「两边行为不同的种子占比」和符号检验的 p 值。占比很低说明你的改动只在少数局面上起作用 —— 那时真实样本量是那个数,不是种子数。

### 要跑多少种子

实测标定(120 种子,基线 vs `contest/ai-norebel.js`):级数差 SE **0.35 级/场**、每局净分 SE **0.62 分/局**。SE 按 `1/√N` 走,于是要在 `t=2` 上分辨:

| 想分辨的差距 | 种子数 | 单核耗时 |
|---|---|---|
| 1.5 级/场(≈选手之间的差距) | 30 | 5 分钟 |
| 0.7 级/场 / 1.2 分/局 | 120 | 18 分钟 |
| 0.35 级/场 / 0.6 分/局 | 480 | 75 分钟 |
| 0.2 级/场 / 0.3 分/局 | 1500 | 4 小时 |

**排名用 120 种子够**(选手之间的差距远大于这个分辨率)。但你自己调参时要当心:这个项目历史上量到过的 AI 改动是 **+0.56 ~ +0.88 分/局**那个量级 —— 120 种子分辨不了,得跑 500 上下。跑不动就用 `test/cf-*.js`(定点反事实),它量的是"一次决策值多少分",不受整局方差影响。

**级数差是三个口径里最灵敏的**(那次标定 t=4.47,胜率只有 3.11)。胜场决定排名,但判断改动有没有用要看级数差。

**默认设置**:`gates=[2,5,10,13]`、`fullRebel='scramble'`、`speedRun=false`、`egSearch=0`(收官蒙特卡洛约 460ms/局,开着整场要 20 秒、关着 4.6 秒)。

`egSearch=0` 是裁判在加载你的提交**之前**设的,所以你可以在自己的工厂里 `AI.AIP.egSearch=5` 把它设回来。这是有意留的口子:计算预算该由超时来管,不该由裁判禁掉某个功能 —— 想搜就搜,代价是时间。

---

## 7. 本地怎么跑

```bash
node contest/run.js my-ai.js contest/ai-baseline.js 120        # 120 种子 × 交换阵营 = 240 场
node contest/run.js my-ai.js contest/ai-baseline.js 120 --eg   # 开收官搜索(慢 4 倍)
BUILD=80fen-test.html node contest/run.js ...                  # 换一份 build 当引擎
```

裁判跑的就是这个脚本,同一份代码、同一批种子。

**先过准入**:

```bash
node contest/selftest.js index.html                       # 裁判器自己的 24 项自测
node contest/run.js my-ai.js contest/ai-baseline.js 5     # 你的违规必须是 0
```

违规不为 0 就先修 bug,那不是策略问题。

`contest/ai-cheater.js` 是个专门用来打裁判的夹具(投毒内建、改引擎常量、出不存在的牌、抛异常、扣 3 张底),`selftest.js` 拿它验证护栏。想知道某种越界会被怎么处理,看那个文件比看本文快。

**判别力**:`contest/ai-norebel.js` 是"基线但从不低分造反",和基线只差一个布尔值 —— 拿它跑一遍就知道当前样本量能分辨多小的差距。

---

## 8. 已知的可超越点

不是暗示,是白送的线索 —— 这几处基线确实没做:

1. **低分造反没有判断**(见 §3 `onRebel`)。
2. **亮主的执行是掷骰子的**。基线 `aiDeclDecide` 算出 `pass` 之后,产品里还要过一次 `rand() < min(0.95, 0.45 + margin/40)` —— 贴着门槛时有一半的时候不亮。比赛把决定权整个交给你了,所以基线在这里被改成"说 pass 就亮",比产品里更爱亮主。这个门槛值得重新标定。
3. **`gateAhead` 在产品里是死的**。`AIP.gateDamp`("对手面临必打关卡 → 损失封顶")全项目只有 `aiDiscard` 里一处读取、零处传入 —— 因为界面块调的是 `aiDiscard(hand, trump)` 两个参数。打级赛制第一次把关卡信息放进了 `view`,基线也第一次真的传上了,但那个参数从没被标定过。
4. **整场视角基本没有**。基线的每个决策都只看这一局:对手在 A 上、我方停在关卡上、`played` 说这一级还没守住过 —— 这些 `view` 里都有,基线只在 `aiDeclDecide` 里用了一点点。
5. **无跨墩规划**(`DESIGN.md` §7 第一行)。`endgameSearch` 只在最后几墩起作用。

---

## 9. 容易写错的十个地方

1. `history` 是扁平的,每 4 个一墩,一墩恒 4 手不管每手几张。
2. 王的 `suit` 是 `'X'` 不是 `null`;`trump.suit === null` 才是无主局。
3. `effSuit` 返回 `'T'` 的不只是主花色 —— 王和**两门副花色的级数牌**都是主。
4. `ordIdx` 的低位段(主花色散牌)**与级数无关**:把级数牌从 2..14 里挖掉之后按顺序编号。
5. 两副牌,同一张牌有两张,`rank` 和 `suit` 相同但 `id` 不同。判重要用 `id`。
6. 拖拉机要 `ordIdx` 差**恰好为 1** 才连得上,不是 `rank` 差 1。
7. `decompose` 按 `(suit, rank)` 配对 —— 主花色里 `♠A♠A` 和 `♥2♥2`(副级)`ordIdx` 相邻但不同 `suit`,连不连得上看 `RULES.offsuitRankTractor`。
8. 平手(结构相同、大小相同)是**先出者赢**。
9. 抠底倍数是 `2 × 最后一墩每人的张数`,不是固定 2 倍。
10. `deal` 阶段的 `view.hand` 只有已发到的牌,不是 25 张。别在那里假设手牌完整。
