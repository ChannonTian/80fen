/* 校准第 4a 步(人机一致率那一半):对每个 λ,在 set B(只排引擎自己的候选)的留出决策上,
 * 用交叉拟合的权重(奇数 fold 的局用 hfSet=1 = 偶数 fold 训练的;偶数 fold 用 hfSet=2)重排:score + λ·修正,
 * 报与真人一致率、与基线首选不同的比例;另给 λ=1 修正的大小分布(用全部局那套权重)。
 *   node test/hf-calib.js <human-fit-data 的目录>
 */
'use strict';
const fs=require('fs'), path=require('path');
const M=require('./records-seat-swap.js');
const E=M.loadSrc(M.blockOf(fs.readFileSync(M.HTML,'utf8')));
const dir=process.argv[2];
const decs=fs.readFileSync(path.join(dir,'decisions.jsonl'),'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(d=>d.n>=2&&d.chosen>=0);
function engineOnly(d){
  if(d.inEng[d.chosen]!==1) return null;
  const idx=d.inEng.map((v,i)=>v?i:-1).filter(i=>i>=0); if(idx.length<2) return null;
  return {...d,X:idx.map(i=>d.X[i]),s:idx.map(i=>d.s[i]),chosen:idx.indexOf(d.chosen),n:idx.length};
}
const LAMS=[0,0.1,0.2,0.4,0.7,1.0];
const corr=(kind,set,x)=>{ const W=E.HF_W[kind].sets[set]; let v=0; for(let j=0;j<x.length;j++) v+=W[j]*x[j]; return v; };
const am=a=>{ let b=0; for(let i=1;i<a.length;i++) if(a[i]>a[b]) b=i; return b; };
const q=(a,p)=>{ const s=a.slice().sort((x,y)=>x-y); return s[Math.min(s.length-1,Math.floor(p*s.length))]; };
const pct=x=>(100*x).toFixed(1)+'%';
for(const kind of ['lead','follow']){
  const ds=decs.filter(d=>d.kind===kind).map(engineOnly).filter(Boolean);
  console.log(`\n==== ${kind==='lead'?'领出':'跟牌'}(set B,${ds.length} 个留出决策,交叉拟合权重)====`);
  console.log('  λ      与真人一致率   与基线首选不同的比例');
  const out={};
  for(const lam of LAMS){
    let hit=0, chg=0;
    for(const d of ds){
      const set=d.fold%2===0?2:1;   // 偶数 fold 的局用奇数 fold 训练的那套
      const base=am(d.s);
      const sc=d.s.map((s,i)=>s+lam*corr(kind,set,d.X[i]));
      const b=am(sc); hit+=+(b===d.chosen); chg+=+(b!==base);
    }
    console.log(`  ${lam.toFixed(1).padEnd(5)}  ${pct(hit/ds.length).padStart(10)}   ${pct(chg/ds.length).padStart(10)}`);
  }
  // λ=1(全部局权重)的修正大小
  const cc=[], gap=[], rng=[];
  for(const d of ds){
    const c=d.X.map(x=>corr(kind,0,x)); cc.push(Math.abs(c[d.chosen]));
    const ss=d.s.slice().sort((a,b)=>b-a); gap.push(ss[0]-ss[1]); rng.push(Math.max(...c)-Math.min(...c));
  }
  console.log(`  λ=1 修正量(全部局权重)|真人所选候选的修正| p5/p50/p95/max: ${[q(cc,.05),q(cc,.5),q(cc,.95),Math.max(...cc)].map(v=>v.toFixed(1)).join(' / ')}`);
  console.log(`  同一决策里各候选修正的极差 p5/p50/p95: ${[q(rng,.05),q(rng,.5),q(rng,.95)].map(v=>v.toFixed(1)).join(' / ')};  引擎首选与次选的分差 p5/p50/p95: ${[q(gap,.05),q(gap,.5),q(gap,.95)].map(v=>v.toFixed(1)).join(' / ')}`);
}
