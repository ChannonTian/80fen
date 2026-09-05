/* 生成 contest/public/RULES.md —— 发给参赛者的那份规则书。
 *
 *   node contest/gen-public.js          # 写文件
 *   node contest/gen-public.js --check  # 只校验是否与主 repo 同步(check-sync 用)
 *
 * 为什么要生成而不是手工复制一份:主 repo 的 docs/RULES.md 会继续改,手工副本会悄悄漂,
 * 而漂了之后参赛者按老规则写、裁判按新规则判 —— 罚分就成了冤枉。
 * 这里只做两处**必要**的改写,正文一个字不动:
 *   1) 开头提到 index.html / 80fen-test.html —— 参赛者看不到那两个文件
 *   2) 结尾链到 DESIGN.md —— 那是我们的内部文档,不该指过去,链过去也是断的
 * 除这两处之外任何差异都算漂移,check-sync 会报。
 *
 * 所以 docs/RULES.md 里的路径要写**裸文件名**,别写成 `docs/DESIGN.md` ——
 * 这一份是要发出去的,参赛者那边没有我们的目录结构。2026-09-05 把文档收进 docs/ 时
 * 顺手把它也改了,SUBS 立刻失配 —— 那次是 check-sync 挡下来的。
 */
'use strict';
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const SRC=path.join(ROOT,'docs','RULES.md');
const DST=path.join(ROOT,'contest','public','RULES.md');

const SUBS=[
  [`这一份是**权威规则**:每条都与代码里的引擎逐条对应(\`index.html\` / \`80fen-test.html\`
的第一个 \`<script>\` 块,两份逐字节相同),代码改了这里就得改。`,
   `这一份是**权威规则**。比赛裁判的引擎与它逐条对应 —— 若两者不一致,那是裁判的
bug:公开修、受影响的对局重跑。你不需要去猜裁判的实现细节。`],

  [`**范围**:这里只管规则引擎(什么合法、谁赢、算几分)。AI 怎么选牌、界面怎么画,
在 [\`DESIGN.md\`](DESIGN.md);两者不进这一份。`,
   `**范围**:这里只管规则引擎(什么合法、谁赢、算几分)。AI 怎么选牌不在这一份 ——
那正是比赛要你自己想的。`],
];

function build(){
  let s=fs.readFileSync(SRC,'utf8');
  for(const [from,to] of SUBS){
    if(!s.includes(from)){
      console.error(`✗ 主 repo 的 docs/RULES.md 里找不到要替换的这一段:\n---\n${from}\n---`);
      console.error('  (多半是 docs/RULES.md 改了措辞 —— 把 contest/gen-public.js 里的 SUBS 跟着改)');
      process.exit(2);
    }
    s=s.split(from).join(to);
  }
  return s;
}

const out=build();
if(process.argv.includes('--check')){
  const cur=fs.existsSync(DST)?fs.readFileSync(DST,'utf8'):null;
  if(cur===out){ console.log('✓ contest/public/RULES.md 与主 repo 同步'); process.exit(0); }
  console.error('✗ contest/public/RULES.md 与主 repo 不同步 —— 跑 node contest/gen-public.js');
  process.exit(1);
}
fs.writeFileSync(DST,out);
console.log(`✓ 写好 ${path.relative(ROOT,DST)}(${out.split('\n').length} 行,${SUBS.length} 处改写)`);
