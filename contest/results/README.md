# 历次联赛的记录

一次联赛留三份东西,文件名前缀是跑的日期:

| 文件 | 内容 |
|---|---|
| `<日期>-league.md` | 赛报 —— 积分榜、对战表、逐对配对统计、打法画像。给人看的 |
| `<日期>-league.json` | 积分榜 + 每一对的配对样本(`pairL`/`pairP`/`pairW`,一个种子一个数)|
| `<日期>-rounds.ndjson.gz` | 一行一场,`rounds[]` 里一局一条:庄家、亮主、闲家得分、罚分、级数怎么走的 |
| `<日期>-league.txt` | 跑的时候的终端输出,存档用 |

复盘某一场:

```sh
zcat 2026-09-04-rounds.ndjson.gz | jq -c 'select(.a=="claude-opus-5" and .seed==7)'
```

`a`/`b` 是这一对的两名选手,`aTeam` 是 a 这一场坐哪一队(0 或 1)。
同一个 `seed` 有两条记录、`aTeam` 分别是 0 和 1 —— 那就是交换阵营的那一对。

**逐墩不记。** 要看某一局怎么打的,拿同一个种子重跑一遍就有了 —— 决策路径里没有
`Math.random`/`Date.now`,同种子必然同牌同走法:

```sh
node contest/run.js <A> <B> <场数> --eg
```

怎么跑一次新的联赛,见 `AI-API.md` §2。
