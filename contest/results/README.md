# 历次联赛的记录

| 日期 | 选手 | 规模 | 说明 |
|---|---|---|---|
| `2026-09-06` | 5 份提交 + 陪练 | 15 对 × 600 场 | **第一届正赛** —— 交卷截止之后的完整联赛 |
| `2026-09-04` | 2 份提交 + 陪练 | 3 对 × 600 场 | 前两份交卷时跑的一次预赛,留档;名次以 09-06 那次为准 |

一次联赛留三份东西,文件名前缀是跑的日期:

| 文件 | 内容 |
|---|---|
| `<日期>-league.md` | 赛报 —— 积分榜、对战表、逐对配对统计、打法画像。给人看的 |
| `<日期>-league.json` | 积分榜 + 每一对的配对样本(`pairL`/`pairP`/`pairW`,一个种子一个数)|
| `<日期>-rounds.ndjson.gz` | 一行一场,`rounds[]` 里一局一条:庄家、亮主、闲家得分、罚分、级数怎么走的 |
| `<日期>-review-<选手>.md` | 逐选手复盘 —— 分差丢在哪一侧、关卡局、底、亮主、丢分最多的十局 |
| `<日期>-league.txt` | 跑的时候的终端输出,存档用 |

复盘某一场:

```sh
zcat 2026-09-04-rounds.ndjson.gz | jq -c 'select(.a=="claude-opus-5" and .seed==7)'
```

`a`/`b` 是这一对的两名选手,`aTeam` 是 a 这一场坐哪一队(0 或 1)。
同一个 `seed` 有两条记录、`aTeam` 分别是 0 和 1 —— 那就是交换阵营的那一对。

**逐墩默认不记** —— 一亿多手,排名、赛报、复盘一个字节都用不上。要看某一局怎么打的,
拿同一个种子重跑一遍就有了(决策路径里没有 `Math.random`/`Date.now`,同种子必然同牌同走法):

```sh
node contest/run.js <A> <B> <场数> --eg
```

要把**整季对局公开出去**才开 `--plays=DIR`:一对一个 `<A>__<B>.ndjson.gz`,
是逐局记录的**严格超集**(逐局那 17 个字段一个不少,再加发牌种子、底牌、扣牌、每一墩)。
一季 258722 局约 55 MB。第一赛季那份在参赛 repo 的
[`season1/`](https://github.com/ChannonTian/80fen-contest/tree/main/season1),
连同阅读器和格式说明 —— 那边是发出去的,这边不留副本。

```sh
node contest/league.js ... --log-rounds --log=<日期>-rounds.ndjson.gz --plays=<参赛repo>/seasonN/plays
node contest/gen-season.js <日期> <参赛repo>/seasonN     # 赛报和复盘改写成发出去的那一份
```

赛报和复盘都是**生成**的,记录改了重跑就有:

```sh
node contest/report.js <日期>-league.json <日期>-rounds.ndjson.gz
node contest/review.js <日期>-rounds.ndjson.gz --all
```

跑几个钟头的联赛加 `--resume`:每打完一对就往断点文件追加一行,进程掉了接着跑
(逐局记录以追加方式续写,gzip 多成员 `gunzip` 认)。续跑出来的榜和一口气跑的
**逐字节相同** —— 断点行就是当时收下的那个结果对象,吸收路径完全一样。

```sh
node contest/league.js ... --resume --ckpt=league.ckpt.ndjson
```

怎么跑一次新的联赛,见 [`docs/contest-ops.md`](../../docs/contest-ops.md) §2。
