/* 拟合「留着的副牌分牌最后归本队」的概率(分牌命运,11-09):逻辑回归,按种子分训练 / 检验(后 1/4 种子检验)。
 *   node test/fit-fate.js a.jsonl [b.jsonl ...]     → 对数损失、分档校准、引擎用的权重(原始特征单位) */
'use strict';
const fs=require('fs');
const R=process.argv.slice(2).flatMap(f=>fs.readFileSync(f,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l))).filter(r=>r.y!==undefined);
const FEAT=[
  ['decl',r=>r.decl],['p10',r=>r.pts===10?1:0],['n',r=>r.n/25],['myLen',r=>r.myLen/5],['myHi',r=>Math.min(r.myHi,3)/3],['myTr',r=>r.myTr/10],
  ['boss',r=>r.hi===0?1:0],['lhi',r=>Math.log(1+r.hi)],['unseen',r=>r.unseenS/10],
  ['pMV',r=>r.pMV],['pOV',r=>r.pOV],['pMVT',r=>r.pMVT],['pOVT',r=>r.pOVT],['pMHi',r=>r.pMHi],['pOHi',r=>r.pOHi],
  ['mTr',r=>r.mTr/10],['oTr',r=>r.oTr/20],['mHiNoO',r=>r.pMHi*(1-r.pOHi)],['bossNoOV',r=>(r.hi===0?1:0)*(1-r.pOVT)],
];
const X=R.map(r=>FEAT.map(f=>f[1](r))), Y=R.map(r=>r.y);
const seeds=[...new Set(R.map(r=>r.seed))].sort((a,b)=>a-b), cut=seeds[Math.floor(seeds.length*0.75)];
const tr=R.map((r,i)=>i).filter(i=>R[i].seed<cut), te=R.map((r,i)=>i).filter(i=>R[i].seed>=cut);
const d=FEAT.length, mu=Array(d).fill(0), sd=Array(d).fill(0);
for(const i of tr) for(let j=0;j<d;j++) mu[j]+=X[i][j]/tr.length;
for(const i of tr) for(let j=0;j<d;j++) sd[j]+=(X[i][j]-mu[j])**2/tr.length;
for(let j=0;j<d;j++) sd[j]=Math.sqrt(sd[j])||1;
const Z=X.map(x=>x.map((v,j)=>(v-mu[j])/sd[j]));
const sig=z=>1/(1+Math.exp(-z));
function fit(cols){ let w=Array(d).fill(0), b=0; const lr=0.5, L2=1e-4;
  for(let it=0;it<400;it++){ const g=Array(d).fill(0); let gb=0;
    for(const i of tr){ let z=b; for(const j of cols) z+=w[j]*Z[i][j]; const e=sig(z)-Y[i]; gb+=e; for(const j of cols) g[j]+=e*Z[i][j]; }
    b-=lr*gb/tr.length; for(const j of cols) w[j]-=lr*(g[j]/tr.length+L2*w[j]); }
  return {w,b,cols}; }
const pred=(m,i)=>{ let z=m.b; for(const j of m.cols) z+=m.w[j]*Z[i][j]; return sig(z); };
const ll=(m,ix)=>-ix.reduce((a,i)=>{const p=Math.min(0.999,Math.max(0.001,pred(m,i)));return a+(Y[i]?Math.log(p):Math.log(1-p));},0)/ix.length;
const base=tr.reduce((a,i)=>a+Y[i],0)/tr.length;
const llb=ix=>-ix.reduce((a,i)=>a+(Y[i]?Math.log(base):Math.log(1-base)),0)/ix.length;
console.log(`样本 ${R.length}(训练 ${tr.length} / 检验 ${te.length}),种子 ${seeds.length};归本队基率 ${(100*base).toFixed(1)}%`);
console.log(`只用基率            对数损失 训练 ${llb(tr).toFixed(4)}  检验 ${llb(te).toFixed(4)}`);
const all=[...Array(d).keys()];
const sets=[['只有角色+分值',[0,1]],['+阶段/长度/主',[0,1,2,3,4,5]],['+大小(不看抽样)',[0,1,2,3,4,5,6,7,8]],['全部(含抽样世界)',all]];
let M=null;
for(const [nm,cols] of sets){ const m=fit(cols); console.log(`${nm.padEnd(18)} 对数损失 训练 ${ll(m,tr).toFixed(4)}  检验 ${ll(m,te).toFixed(4)}`); M=m; }
console.log('\n检验集分档校准(全部特征):');
const bins=[0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.01];
for(let b=0;b<bins.length-1;b++){ const ix=te.filter(i=>{const p=pred(M,i);return p>=bins[b]&&p<bins[b+1];}); if(ix.length<30) continue;
  console.log(`  估 ${bins[b].toFixed(1)}~${Math.min(1,bins[b+1]).toFixed(1)}  n=${String(ix.length).padStart(6)}  估 ${(100*ix.reduce((a,i)=>a+pred(M,i),0)/ix.length).toFixed(0).padStart(3)}%  实 ${(100*ix.reduce((a,i)=>a+Y[i],0)/ix.length).toFixed(0).padStart(3)}%`); }
console.log('\n按角色 × 分值(检验集):');
for(const dc of [0,1]) for(const p of [5,10]){ const ix=te.filter(i=>R[i].decl===dc&&R[i].pts===p);
  console.log(`  ${dc?'庄队':'闲家'}·${p}分  n=${ix.length}  估 ${(100*ix.reduce((a,i)=>a+pred(M,i),0)/ix.length).toFixed(0)}%  实 ${(100*ix.reduce((a,i)=>a+Y[i],0)/ix.length).toFixed(0)}%`); }
// 换回原始特征单位:z=(x-mu)/sd → w_raw=w/sd, b_raw=b-Σ w mu/sd
const wr=FEAT.map((f,j)=>+(M.w[j]/sd[j]).toFixed(4)), br=+(M.b-FEAT.reduce((a,f,j)=>a+M.w[j]*mu[j]/sd[j],0)).toFixed(4);
console.log('\n标准化系数(看哪个特征分量大):'); FEAT.forEach((f,j)=>console.log(`  ${f[0].padEnd(9)} ${M.w[j].toFixed(3)}`));
console.log('\n引擎权重(原始特征单位,顺序同 FEAT):'); console.log(JSON.stringify({b:br,w:wr}));
