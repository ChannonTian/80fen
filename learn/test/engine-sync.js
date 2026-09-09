/* learn.html 里那段引擎移植,必须与 index.html 逐字相同。
       node learn/test/engine-sync.js          # 在仓库根目录跑
   为什么要钉:拖拉机能不能连,取决于级数牌抽走之后的相邻关系(打 7 时 66+88 才连得上)。
   这种判定自己重写一份必错,而且会跟正式版**悄悄**漂开 —— 教学版说 66+88 是拖拉机、
   正式版说不是,学到的东西就是假的。所以整段照抄,并在这里钉住。
   与 test/check-sync.js 同一个套路:不变量写下来,不符就退出码 1。 */
const fs=require('fs');

const NAMES=['cardPoints','countPoints','effSuit','natOrder','ordIdx','pairKey','decompose','classify','countPairsIn',
             'maxTractorLen','pairsInLead','isLegalFollow','structSig','structMatches','resolveTrick','canBeatComp','checkThrow'];

function grab(src,name){
  const i=src.indexOf('function '+name+'(');
  if(i<0) throw new Error('index.html 里找不到 function '+name);
  let j=src.indexOf('{',i), d=0, k=j;
  for(;;){ const ch=src[k]; if(ch==='{')d++; else if(ch==='}'){d--; if(!d)break;} k++; }
  return src.slice(i,k+1);
}

const src=fs.readFileSync('index.html','utf8');
const learn=fs.readFileSync('learn.html','utf8');

const S='/* ==LEARN-ENGINE-PORT-START==', E='/* ==LEARN-ENGINE-PORT-END== */';
const a=learn.indexOf(S), b=learn.indexOf(E);
if(a<0||b<0){ console.error('learn.html 里找不到移植段的哨兵注释'); process.exit(1); }
const block=learn.slice(a,b);

let bad=0;
for(const n of NAMES){
  const want=grab(src,n);
  if(!block.includes(want)){
    bad++;
    console.error(`✗ ${n}:learn.html 里的那份与 index.html 不一致(或缺失)`);
  }
}
// 反向:移植段里不该混进 index.html 没有的函数定义
for(const m of block.matchAll(/^function (\w+)\(/gm)){
  if(!NAMES.includes(m[1])){ bad++; console.error(`✗ 移植段里多了一个 index.html 没有的函数:${m[1]}`); }
}
if(bad){ console.error(`\n${bad} 处不符。改法:重新从 index.html 整段复制,不要手改 learn.html 里的那份。`); process.exit(1); }
console.log(`✓ 移植段与 index.html 逐字相同(${NAMES.length} 个函数)`);
