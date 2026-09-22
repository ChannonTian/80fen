/* 把一届联赛的记录打包成发出去的那一份。
 *
 *   node contest/gen-season.js <日期> <目标目录>
 *   node contest/gen-season.js <日期> <目标目录> --check    # 只检查,不写
 *
 * 例:node contest/gen-season.js 2026-09-06 ../80fen-contest/season1
 *
 * `contest/results/<日期>-*` 是**给我们自己看的**:它让你 `node contest/run.js` 去重跑,
 * 引它 `docs/notes/` 里的笔记,管裁判引擎叫 `index.html`。参赛者三样都没有。
 * 所以发出去之前要改掉那几处 —— 和 `gen-public.js` 一个路子:**改动是写死的、
 * 一处对不上就报错**,不做模糊替换。手工复制过一次就会漂,漂了之后参赛者照着
 * 一份跑不起来的说明去复盘。
 *
 * 只管**生成的**那几份(赛报、复盘、league.json)。逐墩记录 `plays/` 由
 * `league.js --plays=` 直接写到目标目录,README/FORMAT/replay.js 是手写的,都不碰。
 */
'use strict';
const fs=require('fs'), path=require('path');

const argv=process.argv.slice(2);
const CHECK=argv.includes('--check');
const pos=argv.filter(a=>!a.startsWith('--'));
const [DATE, DST]=pos;
if(!DATE||!DST){
  console.error('用法: node contest/gen-season.js <日期> <目标目录> [--check]');
  process.exit(1);
}
const SRC=path.join(__dirname,'results');
/* 赛季目录名从目标路径推 —— 生成出来的赛报和复盘里带着「怎么复盘某一局」的命令,
 * 写死 `season1` 的话,第二赛季的文档会让人去跑上一季的路径。
 * 阅读器和格式说明在**仓库根**,两季共用一份(复制一份迟早会漂)。 */
const SEASON=path.basename(path.resolve(DST));

/* 一处改写:from 必须**恰好出现一次**。出现 0 次或 2 次都停下来报错 ——
 * 那说明上游的 report.js / review.js 改了措辞,这里得跟着改,而不是默默少改一处。 */
function rewrite(text, file, edits){
  for(const [from, to, why] of edits){
    const n=text.split(from).length-1;
    if(n!==1){
      console.error(`✗ ${file}:「${why}」这处改写匹配到 ${n} 次(应当恰好 1 次)`);
      console.error(`  找的是:${JSON.stringify(from.length>90?from.slice(0,90)+'…':from)}`);
      console.error(`  多半是 contest/report.js 或 contest/review.js 改了措辞,同步改这里。`);
      process.exit(1);
    }
    text=text.replace(from, to);
  }
  return text;
}

// 赛报:三处
const REPORT_EDITS=[
  ['| 裁判引擎 | `index.html` |', '| 裁判引擎 | 主办方的线上正式版 |',
   '裁判引擎的文件名'],
  ['凭空算出一个不小的 SE —— 这是 `docs/notes/measurement.md` 记过的坑,这里守住。',
   '凭空算出一个不小的 SE。',
   '指向内部笔记的链接'],
];
// 「记录文件」整节:文件名和重跑的命令在参赛者那边都不成立,换成这一季自己的东西
const RECORDS_FROM=/## 记录文件\n[\s\S]*?```sh\nnode contest\/run\.js[^\n]*\n```\n/;
const RECORDS_TO=`## 记录文件

| 文件 | 内容 |
|---|---|
| \`league.json\` | 积分榜 + 每一对的配对样本(\`pairL\`/\`pairP\`/\`pairW\`,一个种子一个数)|
| \`plays/\` | **逐墩记录**,一对一个文件:发牌、底牌、扣底、每一墩谁出了哪几张、谁赢 |
| \`reviews/\` | 逐选手复盘 |

复盘某一局 —— [\`replay.js\`](../replay.js) 直接渲染成牌谱:

\`\`\`sh
node replay.js ${SEASON}/plays/<A>__<B>.ndjson.gz 7 --hands
\`\`\`

自己解也行,格式见 [\`FORMAT.md\`](../FORMAT.md):

\`\`\`sh
zcat ${SEASON}/plays/<A>__<B>.ndjson.gz | jq -c 'select(.seed==7)'
\`\`\`
`;

// 复盘:结尾那条重跑命令
const REVIEW_EDITS=[
  ['```sh\n# 复现某一局(第一个数是 seed,跑够那么多种子才会走到它)\nnode contest/run.js <我的目录> <对手目录> <seed> --eg\n```',
   '```sh\n# 看某一局怎么打的\nnode replay.js '+SEASON+'/plays/<A>__<B>.ndjson.gz <seed> --round=<no> --hands\n```',
   '重跑命令换成牌谱阅读器'],
];

const out=[];   // [目标路径, 内容]

// 赛报
{
  const src=path.join(SRC, `${DATE}-league.md`);
  let t=fs.readFileSync(src,'utf8');
  t=rewrite(t, path.basename(src), REPORT_EDITS);
  if(!RECORDS_FROM.test(t)){
    console.error(`✗ ${path.basename(src)}:找不到「记录文件」那一节(到 node contest/run.js 那个代码块为止)`);
    process.exit(1);
  }
  t=t.replace(RECORDS_FROM, RECORDS_TO);
  out.push([path.join(DST,'standings.md'), t]);
}

// league.json 原样
out.push([path.join(DST,'league.json'), fs.readFileSync(path.join(SRC, `${DATE}-league.json`),'utf8')]);

// 复盘
for(const f of fs.readdirSync(SRC).filter(f=>f.startsWith(`${DATE}-review-`)&&f.endsWith('.md'))){
  let t=fs.readFileSync(path.join(SRC,f),'utf8');
  t=rewrite(t, f, REVIEW_EDITS);
  out.push([path.join(DST,'reviews',f.replace(`${DATE}-review-`,'')), t]);
}

let drift=0;
for(const [p,t] of out){
  const same=fs.existsSync(p) && fs.readFileSync(p,'utf8')===t;
  if(same) continue;
  drift++;
  if(CHECK) console.error(`✗ 和生成的不一致:${path.relative(process.cwd(),p)}`);
  else { fs.mkdirSync(path.dirname(p),{recursive:true}); fs.writeFileSync(p,t); }
}
if(CHECK){
  if(drift){ console.error(`\n${drift} 份漂了。重新生成:node contest/gen-season.js ${DATE} ${DST}`); process.exit(1); }
  console.log(`✓ ${out.length} 份都和生成的一致`);
}else{
  console.log(`→ ${DST}:写了 ${drift} 份,${out.length-drift} 份本来就一样`);
}
