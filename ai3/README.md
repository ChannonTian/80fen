# ai3 —— 打牌阶段快速规则内核

纯 JS、无依赖、TypedArray,只管打牌阶段(不含发牌后的亮主 / 埋底决策)。规则以 `80fen-test.html` 889~1162 行为准,
与现引擎的一致性由 `difftest.js` 逐位对拍保证。UMD:Node `require('./kernel.js')`,浏览器全局 `K80`。
模块内用全局 scratch,**非可重入**(单线程顺序调用)。

## 表示法
- 牌种 `t=0..53`:`suitIdx*13+(rank-2)`,花色序 S,H,D,C;52 小王,53 大王。现引擎 `id%54 === t`。
- 手牌 = 54 长计数数组(0..2),四家连在 `st.hand`(座位 p 的偏移 `p*54`)。一手出牌 = 牌种升序数组(对子写两次)。
- 有效花色 0..3,4 = 主;`ord` = 现引擎 `ordIdx`;主牌表 `K80.tbl(ts,tr)`(ts 0..3 或 4=无主,tr 2..14)懒构建并缓存。
- 候选缓冲:扁平 `[len,t1..tlen,len,...]`(调用方给 Uint8Array,建议 64KB);第 i 个候选的起点在 `K80.pos[i]`。

## API
- 状态:`newState() / reset(st,hands4,kitty,ts,tr,declarer) / copy(dst,src) / dealRandom(st,rng,ts,tr,declarer,mode) / makeRng(seed)`。
  `declarer`=庄,首墩由庄领出;`mode` 0 正常洗牌,1 按「对子单元」洗(压测用),2 再把级牌放最前(同序号多对)。
  状态含:四家手牌、张数、底牌计数、领出描述(`leadSuit/leadKind/leadLen/leadNeed/leadRuns…`)、当前墩、`defPts`、`lastLeadSize`、`lastWinner`、扁平出牌日志 `log`(每手 `seat,len,types…`,`logLen`)。
- 领出:`enumLeads(st,buf,throwMode)` → 候选数(缓冲/pos 溢出返回 -1)。0 = 只出单张 / 对子 / 拖拉机及全部连续子段(同序号多对每种选法都出);1 = 另加「必成功」甩牌(整手分解后没人压得住的组件集合 U 的 ≥2 组件子集;|U|>6 只出 U 整体与两两组合;同序号多对时对每个并集做完整复核)。
- `playLead(st,buf,pos)`:接受任意同一有效花色非空牌集;多组件走 checkThrow,不过改出被压组件里最小的(先比张数再比 top)。返回 0 原样 / 1 被强制 / -1 非法。
- 跟牌:`enumFollows(st,buf,cap)`(全部合法跟法,个数或搜索节点预算(2 万)超限返回 -1,n=1 快路径);`sampleFollow(st,rng,buf,pos)`;`isLegalFollow(st,seat,buf,pos)`;`playFollow(st,buf,pos)`(第 4 手自动结算一墩,返回 1)。
- 局末:`done(st)`、`score(st)` → `{total,mult,kittyPts,defendersWin,declarerWins,ups}`(`ups` = 胜方升级数,与 `scoreRound` 的 defenderLevelsUp / declarerLevelsUp 对应;抠底倍数 = 2×最后一墩每人张数)。
- 无状态辅助 `K80.util`(给向量 / 对拍用):`classifyT / decomposeT / checkThrowT / isLegalFollowT / structMatchesT / resolveTrickT / maxTractorLenT / countPairsInT / scoreRoundT`。

## 等价归并口径
两副牌里同牌种两张完全等价,所以手牌是计数、候选是多重集:同一多重集只出现一次(无损)。
`enumFollows` 在「有对必对 / 拖拉机必跟(含短拖)」约束下穷举多重集;门内牌 ≤ 张数时本门全出,其余张数任选(出门外牌的组合最多,超 cap 即 -1)。

## 已知与现引擎的差别 / 角落
1. **牌序依赖。** 现引擎 `decompose` 里,同序号的多对(有主时三门副级对都是 12,无主四门级牌对都是 13)落哪一层、同序号单张谁先,取决于传入牌数组的顺序(首次出现序 + 稳定排序)。内核定死为**牌种号升序**;对拍时喂引擎的牌数组一律是「规范 id」:同牌种第 1 张用 id=t、第 2 张 id=t+54,整体按 id 升序(引擎手牌也按计数重建成这种形式)。影响只在甩牌被压时「强制出哪张」的**同序号并列**上(例如 ♥2♥2 与 ♦2♦2 同序同大小,引擎取数组里先出现的那个):它们强度完全相同,只是具体花色可能不同。变异测试证明此条被对拍捕获(并列规则改 `<=` 后立刻出差异)。
2. 引擎 `isLegalFollow` 对 `lead=null`(混门领出)会抛异常;内核领出入口直接返回 -1 / classify 返回 null。
3. 内核不做:亮主 / 反主 / 埋底决策 / 整场升级与庄家轮换。
4. `maxTractorLenT` 按有效花色分别取最大;引擎 `maxTractorLen` 对整串牌 decompose 不分花色(混门串里结果可能不同,规则里从不这样用)。
5. 领出抽样未实现(bench 模式 3 的领出只是随机出一张单牌)。

## 怎么跑
```
node ai3/difftest.js --games=100000 --seed0=1000000 --workers=8 --fz=20   # 对拍,断点续跑(同参数重跑即接着跑,--fresh 重来),结果在 ai3/out/
node ai3/vectors.js                                                       # test/rules-vectors.js 的 52 条向量
node ai3/bench.js --games=20000 [--cap=256]                               # 单核测速三个数
```
对拍检查项(每手都查):领出每个候选的 classify(type/len/top/suit)与 checkThrow ok;领出描述符;跟牌每个候选的引擎 isLegalFollow 与内核谓词;每墩赢家 / 分数;每局 `scoreRound`。
抽样查:领出完备性(某门 ≤12 张时穷举全部多重集,非甩牌集合须与内核相等,甩牌的 checkThrow {ok,forced} 须与引擎相等);跟牌完备性(C(手牌,n)≤3 万时穷举全部 id 子集与内核枚举相等);大空间随机子集 + 扰动子集的谓词比对;`sampleFollow` 合法且在枚举内;随机甩牌尝试。
另有每局 `--fz` 个「结构压测」用例(单门随机牌型,多对 / 同序号多对 / 长拖拉机):decompose(组件顺序与牌)、maxTractorLen、classify、checkThrow、跟牌完备性 / 谓词、resolveTrick。
