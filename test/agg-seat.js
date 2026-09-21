/* 合并若干份 cf-seat 的 RAW 输出。
 *
 *   node test/agg-seat.js out/*.txt
 *
 * ⚠️ **主检验只有一行**:全体样本上 `C − A` 的**级数**(DESIGN §7.8 写死的判据)。
 * 下面的分层、以及 B / D 两条支路,**全部是描述性的** ——
 * 一张表十几格,期望本来就该出现 ~0.7 个 p<0.05(负结果笔记教训 6、9)。
 */
const fs=require('fs');
const rec=[]; let N=0,nHit=0;
for(const f of process.argv.slice(2)){
  const L=fs.readFileSync(f,'utf8').split('\n').find(x=>x.startsWith('RAW '));
  if(!L){ console.error('no RAW in '+f); continue; }
  const o=JSON.parse(L.slice(4)); rec.push(...o.rec); N+=o.N; nHit+=o.nHit;
}
function erf(x){const t=1/(1+0.3275911*x);
  return 1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x);}
const stat=a=>{
  a=a.filter(x=>x!==null&&x!==undefined);
  if(!a.length) return 'n=0';
  const m=a.reduce((x,y)=>x+y,0)/a.length;
  const sd=Math.sqrt(a.reduce((x,y)=>x+(y-m)*(y-m),0)/a.length);
  const se=sd/Math.sqrt(a.length);
  const p=a.filter(x=>x>0).length,n=a.filter(x=>x<0).length,nz=p+n;
  const z=nz?(p-n)/Math.sqrt(nz):0;
  const pv=nz?2*(1-0.5*(1+erf(Math.abs(z)/Math.SQRT2))):1;
  return `${m>=0?'+':''}${m.toFixed(3)} ±${se.toFixed(3)} (t=${se?(m/se).toFixed(1):'—'}) ${p}/${n} 符号p=${pv.toFixed(4)} n=${a.length}`;
};
console.log(`合并 ${N} 局:命中 ${rec.length} 个`);
console.log(`AI 实际选择:压 ${rec.filter(r=>r.aWins).length}/${rec.length}`
  +`,其中挑最省的 ${rec.filter(r=>r.aIsCheap).length}、挑最大的 ${rec.filter(r=>r.aIsTop).length}`);
console.log('\n★ 主检验(DESIGN §7.8 写死):全体样本 C−A 的级数');
console.log('   ' + stat(rec.map(r=>r.dlC)));
console.log('\n以下全部只作描述,不作判据 ——');
const show=(lbl,f)=>{
  const g=rec.filter(f); if(g.length<20) return;
  console.log(`  ${lbl}  n=${g.length}`);
  for(const [k,dp,dl] of [['B 最省的压','dpB','dlB'],['C 最大的压','dpC','dlC'],['D 不  争 ','dpD','dlD']]){
    console.log(`    ${k} − A  分 ${stat(g.map(r=>r[dp]))}`);
    console.log(`                级 ${stat(g.map(r=>r[dl]))}`);
  }
};
show('【全部】', ()=>true);
show('【第 2 家】队友坐末手', r=>r.seat===1);
show('【第 3 家】只剩末手的对手', r=>r.seat===2);
show('【台面 10~19 分】', r=>r.pts<20);
show('【台面 ≥20 分】', r=>r.pts>=20);
show('【AI 挑了最省的那张】', r=>r.aIsCheap);
show('【能压的有 ≥3 张】', r=>r.nWin>=3);
