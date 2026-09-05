# 存档:两份已实施的旧方案

从 `docs/DESIGN.md` 搬出来的冻结附录。**这两份是历史,不是现状** ——
里面的判断当时成立,后来被实测推翻过好几处(见 `NOTES/negative-results.md`)。
留着是因为它们记录了「当初为什么这么设计」,改代码时偶尔要回来查。

---

## 附录 A:最初的架构规划(原 `80fen-architecture-plan.md`,2026-07,已实施,仅存档)

> 项目启动前写的规划,里程碑 M1~M6 均已完成。三层架构(引擎/AI/界面)的最终实现见 §0;这里保留原文,包括当时设想、后来没照搬的数据模型草案。原文为英文,未翻译。

Single-file web game (`index.html`, vanilla JS). Human + rule-based AI teammate vs. two rule-based AI opponents. Two modes: Normal Play and Learn-with-Coach.

### 1. Core principle: engine ≠ UI

Even in one file, keep three strictly separated layers. This is what makes the coach mode cheap to add and the rules testable.

```
┌─────────────────────────────────────────────┐
│  UI layer (DOM render + input)              │
│  render(state), card click handlers,        │
│  animations, coach panel                    │
├─────────────────────────────────────────────┤
│  Game engine (pure functions, no DOM)       │
│  state → legalMoves(state, player)          │
│  state' = applyMove(state, move)            │
│  trick/round resolution, scoring            │
├─────────────────────────────────────────────┤
│  AI layer (pure functions over engine API)  │
│  chooseMove(state, player) using            │
│  legalMoves + heuristics + card memory      │
└─────────────────────────────────────────────┘
```

Rule of thumb: the engine never touches `document`; the UI never decides legality; the AI only calls the same public engine functions the UI does.

### 2. Data model

```js
// Card: {suit: 'S'|'H'|'D'|'C'|'JOKER', rank: 2..14|'sj'|'bj', id} — id unique across 2 decks
// GameState:
{
  phase: 'deal' | 'bid' | 'kitty' | 'play' | 'roundEnd',
  players: [{hand: Card[], seat: 0..3, team: 0|1}],   // seat 0 = human; 0&2 vs 1&3
  trump: {suit, rank},          // rank = current level of declaring team
  levels: [2, 2],               // per-team level progression 2→A
  declarer: seatIndex,          // 庄家
  kitty: Card[],                // 底牌 (8 cards)
  trick: {leader, plays: [{seat, cards: Card[]}]},
  points: 0,                    // defender points captured this round (5/10/K)
  history: Trick[],             // completed tricks (feeds AI card memory + coach)
}
```

Key engine functions (all pure):
- `dealRound(state, rng)` — 2 decks (108 cards), 25 each, 8 kitty; trump declaration during deal
- `classifyPlay(cards, trump)` → single | pair | tractor(拖拉机) | throw(甩牌) — the hardest function; write it first and test it hard
- `legalMoves(state, seat)` — follow-suit enforcement, tractor-matching, throw validation/penalty
- `resolveTrick(trick, trump)` — winner + points
- `scoreRound(state)` — 80-point threshold, kitty multiplier if last trick won by defenders, level advancement

### 3. Rule-based AI

One AI module, parameterized by role (teammate vs. opponent behaves identically — good play is good play; the "teammate" just shares your team state).

Layered decision:
1. **Card memory** — track all cards seen (`history`), derive remaining counts per suit/rank. Cheap and makes the AI feel smart.
2. **Legal move generation** — from the engine, never reimplemented.
3. **Heuristic ranking** — priority rules, e.g.:
   - Leading: cash sure winners; lead trump to drain when strong; lead teammate's void
   - Following, partner winning: dump points (5/10/K) to partner
   - Following, opponent winning: win cheaply if points on table; else discard lowest
   - Trump management: count trumps out; save tractor structures
4. **Difficulty knobs** — probability of playing the top-ranked move vs. 2nd/3rd; memory accuracy. Gives Easy/Normal/Hard for free.

Keep each heuristic a named function returning `(move, score, reason)` — the `reason` string is reused by the coach.

### 4. Coach mode

Because the AI already produces `(move, score, reason)`, coach mode is mostly UI:
- **Hint**: run the AI on the human's seat, highlight its top move, show `reason`.
- **Mistake feedback**: after the human plays, compare their move's score vs. best; if gap > threshold, show "Better: ⟨move⟩ because ⟨reason⟩" (non-blocking toast, or blocking in "strict" mode).
- **Explain trick**: after each trick, one-line summary (who won, points captured, what mattered).
- **Guided tutorial**: scripted deals (seeded RNG) teaching bidding → following → tractors → point management, one concept per scenario.
- **Glossary panel**: 主/副牌, 拖拉机, 甩牌, 底牌, 抠底 with examples.

### 5. Build order (milestones)

Each milestone is playable/testable before moving on:

1. **M1 — Engine core**: cards, deal, trump, `classifyPlay`, `legalMoves`, trick resolution. In-file test harness (a `runTests()` with assert cases for tricky plays: tractors across trump, throws, jokers). *This is >50% of total difficulty.*
2. **M2 — Playable game, dumb AI**: full round loop with random-legal AI, minimal UI (text/cards as styled divs). You can now actually verify rules by playing.
3. **M3 — Real AI**: card memory + heuristics + reasons. Play until the teammate stops making you angry.
4. **M4 — Scoring & progression**: 80-point logic, kitty bonus, level advancement across rounds, round-end summary screen.
5. **M5 — Coach mode**: hint / feedback / explain, difficulty settings.
6. **M6 — Polish**: card graphics (unicode/SVG suits), animations, mobile layout, sounds.

### 6. Risks & mitigations

- **Rule ambiguity (biggest risk)**: Shanghai 80分 has house-rule variants (throw penalties, kitty multiplier ×2 vs. 2^n, trump declaration overrides). Mitigation: write a `docs/RULES.md` companion doc as decisions come up; make variant points config flags in one `RULES` object.
- **`classifyPlay`/throw logic bugs**: mitigate with the M1 test harness; add every bug found during play as a test case.
- **Single file growing unwieldy**: acceptable to ~3–5k lines; use clear section banners. If it hurts, split into `engine.js`/`ai.js`/`ui.js` later — the layer separation makes this a 10-minute change.

### 7. First concrete step

Build M1: the engine with a visible test-runner page (no game UI yet). It forces every rules question to the surface early, while it's cheap to answer.

---

## 附录 B:AI v4 提升方案(原 `AI-v4-PROPOSAL.md`,2026-08-05,已实施,仅存档)

> 动手前的诊断原文,机制说明已并入 §2~§5,版本沿革见「附:版本沿革」v4 条目。保留这里是为了回看当时的判断哪些站住了、哪些被后续实测推翻。

> **状态:2026-08-05 已实施(v0.5.0)。** 八条里做完七条,结果与实测数字见 `docs/CHANGELOG.md`,
> 机制说明已并入 `AI-DESIGN.md`。唯一没做的是 §2.3(b)**调王** —— 它需要「对手每门的持有区间」
> 这层模型(§7 第二条),现在只有上界、没有下界,估不出「谁手上还有大主」,所以先欠着。
> 下面保留的是**动手前**的诊断原文,便于回看当时的判断哪些站住了、哪些没有。
>
> 两处判断在实施中被数据推翻,已在 CHANGELOG 与 AI-DESIGN 里记下:
> 一是「给所有主牌领出加正的 edge 奖励」会掉分(符号对、粒度错);
> 二是领出的 Tempo 项按 0.35 加上去只改变 2.1% 的决策,得先把 `bossBase` 里那截让出来。

> 依据:`AI-DESIGN.md`(设计)+ `index.html` 第一个 script 块(实现)+ 200 局无头自对弈实测。
> 实测脚本思路见文末「复现」。所有数字来自 seed = 1..200 × 7919 的同一批牌局。

---

### 0. 实测出来的三个硬数字

| 指标 | 实测 | 含义 |
|---|---|---|
| 庄家丢掉最后一墩 | **39%**(78/200 局) | 平均埋底 11.6 分,每局白送闲家 **9.3 分**(已含 ×2 倍) |
| 将牌领出中的「低将牌」 | **37%**(562/1529) | 领出评分把低主当普通废牌探路 |
| 将牌墩由领出者赢下 | 80.3% | 「能吃却跟小」只有 3~15%,毛病不在跟牌侧 |

第一条单项就大于 v3.1 相对 v3.0 的全部收益(+8.2 分/局)。**优先级排序应以此为准。**

---

### 1. 造反 / 无将(问题 2)—— 先修 bug,再修判据

#### 1.1 `canOverride` 没有座位守卫 → 真的会「反自己」

```js
// index.html:488
function canOverride(cur, next){ return !cur || next.strength>cur.strength; }
```

实测(`cur = {seat:0, suit:'S', strength:1}`,即我自己亮了♠单张):

| 我接着要亮 | 现在允许? | 应该 |
|---|---|---|
| ♥ 一对级牌(strength 2) | ✅ true | ❌ 改花色反自己 |
| 小王对 → 无将(3) | ✅ true | ❌ 反自己成无将 |
| 大王对 → 无将(4) | ✅ true | ❌ 同上 |
| ♠ 一对级牌(2) | ✅ true | ✅ 这是加固 |

`aiDeclDecide` 用 `legal = cands.filter(o => canOverride(D.curDecl, o))` 做唯一的合法性闸门,
所以这个洞直接漏进 AI 的候选集;`scoreDeclOption` 里对应的惩罚只有 `30 × (−0.3) = −9`,
根本压不住无将的 `grabBonusNT = 58` 或 `Rebel = +30`。

**改法(引擎层,AI 与 UI 一起受益):**

```js
function canOverride(cur, next, seat){
  if(!cur) return true;
  if(next.strength <= cur.strength) return false;
  if(seat !== undefined && cur.seat === seat)
    return next.suit === cur.suit;   // 同一人只能加固:同花色 单张→一对
  return true;
}
```

`canReinforce2` 已经有正确的语义(`decl.seat!==seat` 直接 false),但它只管 UI 的加固按钮,
没有守住 `canOverride` 这条主路。加两条断言进 `runTests`。

#### 1.2 造反用的是绝对门槛,从没看过「现状」

```
亮 ⇔ V(opt) ≥ θ(v)
```

`V(opt)` 只评价「以 opt 为主时我这手牌好不好」。造反的正确判据不是这个,而是**增量**:

```
反 ⇔ V(opt) − V(现状) ≥ θ_rebel
```

现在的公式从头到尾没有算过「维持当前主色时我这手牌值多少」。
于是出现「我这门本来就是长主、却因为摸到小王对去反无将」这类无逻辑行为 ——
不是权重没调好,是**比较对象缺失**。

**改法:** 在 `scoreDeclOption` 外面包一层。`D.curDecl` 存在时,先把「当前主」当成一个虚拟候选
算出 `V₀`(去掉 Grab / Reveal / Rebel 这三个与「我这手牌好不好」无关的项),再比 `V(opt) − V₀`。
`Rebel`(谁已亮)、`Reveal`(暴露代价)保留在增量侧,它们本来就是造反的边际成本/收益。

#### 1.3 无将的 Fit 用错了统计量

```js
const L = projectLen(trumpCountUnder(D.vis, opt, D.trumpRank), v, 12);
fit = 0.6*clamp((L-2.8)/2.2,-1,1) + 0.6*sideQuality(...) - reluctance;
```

无将局主牌**总共只有 12 张**(4 王 + 8 级牌),人均 2.8。这时候「期望长度」不是好尺子 ——
关键是**这 12 张里最大的那几张在不在我手上**。握大王对 + 两张级牌(4/12)和握 4 张级牌无王(4/12)
在这个公式里完全等价,实战里天差地别。

**改法:** 无将的 Fit 换成「12 张主牌的**牌力占比**」而不是张数占比:
大王 记 1.0、小王 0.75、级牌 0.4,除以全场总和归一。`sideQuality` 保留。

另外,「无将对闲家更有利」这条(设计文档 §3.2 已论证)现在只体现在 Level 项的 `+0.35`,
只有级数是 5/10/K 时才生效。它应该是 Fit 层的常项:闲家反无将 `+0.25`,庄家方 `−0.15`。

---

### 2. 将牌消耗 / 牌权 / 队内配合(问题 1、问题 4)

问题 1 和问题 4 是同一个根:**领出评分里主牌和副牌用同一把尺子,而且完全没有牌权项。**

#### 2.1 低将牌领出几乎没有代价

```js
// scoreLeadPlay 兜底分支
let s = 16 - cl.top*0.8 - pts*6 - (cl.suit==='T' ? 6 : 0) - fut;   // reason:'小牌探路'
```

主牌只比副牌低一个常数 6,而低主的 `futureValue` 只有 `2.5 + 0.5·ordIdx ≈ 3~5`(再乘 PHASE_K)。
实测 **1529 次将牌领出里 562 次(37%)是低将牌**,理由字符串全是「小牌探路」。
一次这样的领出 = 主动交出牌权 + 烧掉一张主,收益为零。

**改法:领出主牌单独成一类「吊主」,只有有优势时才给正分。**

```
吊主收益 = (我方主牌数 − 对手预估剩余主牌数) × unit − Future(x)
对手预估剩余主牌 ≈ 在外主牌总数 × (单个对手手牌数 / 未见牌总数) × 2
```

没有主牌数量优势时,领出主牌应当是负分。这条顺带替换掉现在写死的

```js
if(unit) cands.push({cards:unit.cards, score:46, reason:'主力雄厚,吊主清场'});
```

—— 常数 46 无条件压过其他所有候选,且不看对手还剩几张主。实测里它是低主领出的一大来源。

#### 2.2 `scoreLeadPlay` 完全没有 Tempo 项

`tempoValue` / `bossUnits` 只在 `scorePlay`(跟牌)里用。可领出恰恰是牌权最该计价的地方 ——
领出赢下 = 保住牌权继续兑现,领出输掉 = 把牌权交给对手。

**改法:**

```
scoreLeadPlay += ( pWinLead·tempoValue(L, cards) − (1−pWinLead)·AIP.oppTempo ) · AIP.tempoWeight
```

`pWinLead`:钢板 ≈ 0.95(已有 `allBoss` 判定),拖拉机/大对 ≈ 0.6,小牌探路 ≈ 0.2。
这样「手上还有 3 个待兑现的钢板单元」会自动压过「随手探一张小牌」——
也就是把「不考虑牌权」这条直接补上。

#### 2.3 队内配合缺的是**候选**,不是权重

现在全部的队内配合只有兜底分支里一句:

```js
if(L.partnerVoid(cl.suit) && !pts){ s += 8; reason='队友缺这门,给他机会'; }
```

+8 在一堆 20~60 分的候选里等于没有。而且它只是给已有候选加分,不是一类独立策略。

**改法:加两类显式候选,各自打分。**

**(a) 送毙(feed ruff)—— 主打队友断门**

```
收益 = pPartnerVoid · pPartnerRuffHolds · ( 台面预期分 + tempoValue(队友视角) )
     − (1 − pPartnerVoid) · 这门在外分被对手收走的风险
```

`pPartnerVoid` 已经有了(`makeVoidProb` / `maxHoldIn`),缺的是把它做成候选。
注意还要加一条闸门:**对手不能也断这门**,否则是送给对手毙。`oppVoidP` 已经有了。

**(b) 调王(小主换牌权)**

领出一张明知打不赢、但能逼出对手一张大主的小主,把队友手上的次大主洗成钢板。
判据是「我方(我 + 队友推断)持有的高主数量 > 对手」。
这条依赖对手建模,可以先用粗版:按 `maxHoldIn` 的上界估对手主牌数;
等设计文档 §7 第二条(持有**区间**而非单点概率)做完再精化。

**建议:两类候选都带独立开关**,方便做单组件消融——设计文档 §6 的教训就是「先确认参数真的在起作用」。

#### 2.4 大主牌的 Future 是线性的,断层太大

```js
v += c.rank===trump.rank ? 7 : 2.5 + ordIdx(c,trump)*0.5;   // 普通主牌
if(bj>=2) v += AIP.jokerPairHold;                            // 王对 18
```

一对主 A(`ordIdx ≈ 24`)算出来 14.5,王对 18 —— 但「全场第三大的主」和「全场第十大的主」
在这条线性式子里差得很近。**该按「在外还有几张压得住它」算,不是按牌面序号算:**

```
Future(主牌 x) = base + hold · ( 1 − 在外能压住 x 的张数 / 在外主牌总数 )
```

`unseenBeats` 现成可用。这条同时缓解「过早打大王对」——因为它让**次大的主牌**也拿到应有的
留手价值,AI 不会为了保王对而先把 A、K 撒光,再被迫在没牌权时打王对。

---

### 3. 底牌埋分 vs 最后一墩(问题 3)—— 单点最值钱

**实测:庄家 39% 的局丢掉最后一墩,平均埋底 11.6 分 → 每局白送闲家 9.3 分。**

三处都要改:

#### 3.1 `PHASE_K.end = 0.15` 在最该在意底牌的时候把留手价值抹平了

```js
const PHASE_K = {open:1.0, mid:0.7, end:0.15};
```

设计文档 §5.2 已经识别出这个硬伤,补丁是在 `futureValue` 里加一条 `flat` 项,
但触发条件极苛刻:`phase==='end'` **且** `hand.length <= AIP.endHorizon(=4)` **且**
这一手是 `isBossPlay`。三个条件同时成立时,大部分该留的牌早就打掉了。

**改法:收官的 PHASE_K 由底分决定,而不是常数。**

```
PHASE_K.end = clamp(0.15 + 0.045 · 底分估计, 0.15, 1.1)
```

底分 0 → 0.15(现状,正确);底分 20 → 1.05(收官反而比中盘更该留牌,也正确)。

#### 3.2 领出侧根本没有这条

`leadCtx` 里 `phase` 和 `hand` 都齐了,但 `futureValue` 的底牌分支要求 `hand.length <= 4`。
庄家扣了 20 分进底,从**中盘**就该开始规划「留一手全场最大」。

**改法:** `endHorizon` 从 4 提到 6~8,并让它随底分放大:`endHorizon = 4 + 底分/6`。

#### 3.3 缺一个显式的「保底手」预算

最直接的做法:在 `leadCtx` / `followCtx` 里算一个 `reserveUnit` ——
手上最可能赢下最后一墩的那一手(通常是王对,或最长主门的最大牌),
给它一个额外 Future 加成 `底分 × 2 × pWinLastTrick`,
**直到剩余墩数 ≤ 这一手能撑住的墩数**为止。

设计文档 §7 的「收官策略不会切换」写的是「分牌倾向留手」,但更重要的其实是**留控制牌** ——
分牌留在手里是负债(`futureValue` 里已经有 `−cardPoints × 0.30`),留控制牌才是资产。

#### 3.4 闲家侧:`kittyPointsEst` 是无信息先验

```js
return unseenPts * Math.min(1, RULES.kittySize / unseenCnt);   // 未见分均匀摊到 8 张底
```

均摊假设庄家随机埋底。但庄家的埋牌行为**本身就是信息**:他绝不埋主(`buryTrumpBlock=400`)、
倾向埋短门、分牌按 `PointΔ` 有条件地埋。闲家应该按同一套 `aiDiscard` 的倾向反推,
而不是把未见分均匀摊。粗版:把未见的主牌从分母里剔掉,再乘一个 `分牌被埋倾向` 系数。

---

### 4. 建议的执行顺序

按「实测收益 ÷ 改动风险」排:

| # | 改动 | 预期 | 风险 |
|---|---|---|---|
| 1 | `canOverride` 座位守卫 + 两条测试 | 修 bug,不是调参 | 极低 |
| 2 | 收官 PHASE_K 随底分 + endHorizon 随底分(3.1 / 3.2) | 冲着那 9.3 分去 | 低 |
| 3 | 领出加 Tempo 项(2.2) | 直接补「不考虑牌权」 | 中,需消融验证 |
| 4 | 吊主单独成类,替换硬编码 46(2.1) | 砍掉 37% 的无效主牌领出 | 中 |
| 5 | 造反改增量判据(1.2) | 修「逻辑不清」 | 中,亮主链路要重跑场景测试 |
| 6 | 保底手预算 `reserveUnit`(3.3) | 收官策略切换 | 中高 |
| 7 | 送毙 / 调王候选(2.3) | 队内配合从 0 到 1 | 高,建议带开关 |
| 8 | 主牌 Future 改按「在外压制数」(2.4)、无将 Fit 改牌力占比(1.3) | 精化 | 中 |

**每一条都要单独跑交换阵营的配对对照**(设计文档 §6),不要打包上线。
§6 的三条教训在这里全部适用,尤其是「先确认这个参数真的在影响决策」——
`voidValue` / `pSurvive` / `dumpOpp` 三次都是白躺了一个版本。

#### 需要新增的场景断言

- 自己已亮♠单张,摸到大王对 → `aiDeclDecide` 不产出无将候选
- 自己已亮♠单张,摸到♥级牌对 → 不产出♥候选;摸到第二张♠ → 产出加固候选
- 手握长♠主 + 小王对,对手已亮♥ → 反♠(而不是反无将)
- 底分 20、剩 8 张、手握王对 → 领出评分不选王对;剩 2 张 → 选
- 我方主牌 5 张、对手预估 7 张 → 低主领出为负分;反过来则为正
- 队友已知缺♦、对手不缺♦、我有♦小牌 → 送毙候选排第一

---

### 复现

```bash
node -e "
const fs=require('fs');
const b=[...fs.readFileSync('index.html','utf8')
  .matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
global.window={}; global.localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
(0,eval)(b[0]+'\n'+b[1]);   // 引擎 + AI + runTests,150 项全通过
"
```

自对弈探针复制 `simulateRound`(index.html:1759)的循环,在 `resolveTrick` 前后插桩即可,
不需要改动被测代码。
