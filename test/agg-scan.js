/* 把若干份 cf-scan / cf-scan-lead 的 RAW 输出并成一张表。
 *
 *   RAW=1 SEED0=0 node test/cf-scan-lead.js 80fen-test.html 500 > out/s0.txt
 *   node test/agg-scan.js out/*.txt
 *
 * 每一格是「AI 选了哪一类 → 换成哪一类」,**dp>0 = AI 选错了类**。
 * 按 dp 从高到低排,排在最上面而且样本够的那一格,才是线索。
 *
 * ⚠️ 一张表十几个格子,期望本来就该出现 ~0.7 个 p<0.05 的格子。
 * 排在最上面的那一格**不是发现,是候选** —— 判据写死、换全新种子再验。
 * 见 docs/notes/negative-results.md 教训 6 和 9。
 *
 * MIN=<n> 改最小样本量(默认 25)。
 */
const fs=require('fs');
const rec=[]; let nElig=0,N=0;
for(const f of process.argv.slice(2)){
  const L=fs.readFileSync(f,'utf8').split('\n').find(x=>x.startsWith('RAW '));
  if(!L){ console.error('no RAW in '+f); continue; }
  const o=JSON.parse(L.slice(4)); rec.push(...o.rec); nElig+=o.nElig; N+=o.N;
}
function erf(x){ // Abramowitz-Stegun 7.1.26
  const t=1/(1+0.3275911*x);
  return 1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x);
}
const stat=a=>{
  if(!a.length) return {n:0,m:0,se:0,t:0,p:1,s:'n=0'};
  const m=a.reduce((x,y)=>x+y,0)/a.length;
  const sd=Math.sqrt(a.reduce((x,y)=>x+(y-m)*(y-m),0)/a.length);
  const se=sd/Math.sqrt(a.length);
  const pos=a.filter(x=>x>0).length,neg=a.filter(x=>x<0).length;
  // 符号检验:非平局里正的占几成,双侧 p(正态近似)
  const nz=pos+neg, z=nz?(pos-neg)/Math.sqrt(nz):0;
  const p=nz? 2*(1-0.5*(1+erf(Math.abs(z)/Math.SQRT2))) : 1;
  return {n:a.length,m,se,t:se?m/se:0,pos,neg,p,
    s:`${m>=0?'+':''}${m.toFixed(2)} ±${se.toFixed(2)} (t=${se?(m/se).toFixed(2):'—'}) ${pos}/${neg}/${a.length-pos-neg} 符号p=${p.toFixed(3)}`};
};
const LEAD=rec.length&&rec[0].uT!==undefined;   // 领出那一把才有 uT
console.log(`合并 ${N} 局:合格决策点 ${nElig},抽样 ${rec.length}`);
console.log(`总表 分数 ${stat(rec.map(r=>r.dp)).s}   级数 ${stat(rec.map(r=>r.dl)).s}`);
const MIN=+(process.env.MIN||25);
const groups=(keyf,title,min)=>{
  const g={}; for(const r of rec){ const k=keyf(r); if(k==null)continue; (g[k]=g[k]||[]).push(r); }
  const rows=Object.keys(g).map(k=>({k,st:stat(g[k].map(r=>r.dp)),share:g[k].length/rec.length}))
    .filter(x=>x.st.n>=(min||MIN)).sort((a,b)=>b.st.m-a.st.m);
  console.log('\n'+title+'(按 dp 从高到低;dp>0 = AI 选错了类):');
  for(const r of rows)
    console.log(`  ${r.k.padEnd(24)} ${r.st.s.padEnd(48)} n=${String(r.st.n).padEnd(5)} 占样本 ${(r.share*100).toFixed(1)}%`);
};
groups(r=>r.a+'→'+r.b, '按「AI 选的类 → 替代类」');
if(LEAD) groups(r=>r.a+'→'+r.b+(r.nT>r.uT*2/3?' [主门有优势]':' [主门无优势]'), '同上再按 主门优势 拆开', 20);
else groups(r=>r.a+'→'+r.b+(r.pw?' [队友暂大]':' [对手暂大]'), '同上再按 队友/对手 暂大拆开', 20);
groups(r=>r.a, '只看「AI 选了哪一类」');
/* 领出那一把记了 AI 自己写的理由 —— 比按类别分格细一层,
 * 能把「打分器没标定」落到具体哪几条动机上 */
if(rec.some(r=>r.rsn!==undefined)) groups(r=>r.rsn||'(无)', '按 AI 自己写的**领出理由**', 20);
const lay=LEAD?[
  ['主门有优势 nT>2uT/3',r=>r.nT>r.uT*2/3],['主门无优势',r=>r.nT<=r.uT*2/3],
  ['主牌 nT≥10',r=>r.nT>=10],['主牌 nT 6~9',r=>r.nT>=6&&r.nT<10],['主牌 nT≤5',r=>r.nT<6],
  ['庄家方',r=>r.decl],['闲家方',r=>!r.decl],
  ['手上还剩≥3门',r=>r.voids>=3],['手上剩≤2门',r=>r.voids<=2],
  ['开局手≥17',r=>r.phase>=17],['中盘手9~16',r=>r.phase>=9&&r.phase<17],['收官手≤8',r=>r.phase<9]]
:[['pw=1 队友暂大',r=>r.pw],['pw=0 对手暂大',r=>!r.pw],
  ['末手',r=>r.last],['非末手',r=>!r.last],['庄家方',r=>r.decl],['闲家方',r=>!r.decl],
  ['台面0分',r=>r.tab===0],['台面1~9',r=>r.tab>0&&r.tab<10],['台面≥10',r=>r.tab>=10],
  ['开局手≥17',r=>r.phase>=17],['中盘手9~16',r=>r.phase>=9&&r.phase<17],['收官手≤8',r=>r.phase<9]];
console.log('\n分层(横切所有格):');
for(const [k,f] of lay){ const s=stat(rec.filter(f).map(r=>r.dp)); if(s.n>=MIN) console.log(`  ${k.padEnd(20)} ${s.s} n=${s.n}`); }
console.log('\n(gap 分位自检另跑:node test/gapq.js <同样这些文件>)');
