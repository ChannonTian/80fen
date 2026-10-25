/* 「不压的那一家会不会往这墩里放分」的小模型(2026-10-25,替 laterPoints 的常数)。
 *   node test/fit-dump.js a.json ...      (dump-data.js 的输出)
 * 只对「手里有能放的分牌、又不是被迫」的样本拟合 P(放分);被迫(本门只剩分牌 / 断门且副牌只剩分牌)= 1;放的分按手里最大的那张算。
 * 特征 [1, 本队暂大, 末家, 有本门, 本队暂大×末家, 主牌墩, 台面分/10, 收官, 最大分牌是10/K, 本队暂大×有本门] → AIP.dumpW */
'use strict';
const fs=require('fs');
const rows=process.argv.slice(2).flatMap(f=>JSON.parse(fs.readFileSync(f,'utf8')));
const avail=r=>r.has?r.maxIn:r.sideMax, forced=r=>r.has?r.onlyPts:r.sideOnlyPts;
const S=rows.filter(r=>avail(r)>0&&!forced(r));
const feat=r=>[1,r.mateWin,r.last,r.has,r.mateWin*r.last,r.trumpLead,Math.min(r.tbl,40)/10,r.n<=12?1:0,avail(r)>=10?1:0,r.mateWin*r.has];
const names=['1','本队暂大','末家','有本门','暂大×末家','主牌墩','台面分/10','收官','最大是10/K','暂大×有本门'];
const sig=z=>1/(1+Math.exp(-z));
const X=S.map(feat), Y=S.map(r=>r.pts>0?1:0); const d=X[0].length; let w=new Array(d).fill(0);
for(let it=0;it<60;it++){ const g=new Array(d).fill(0), H=Array.from({length:d},()=>new Array(d).fill(0));
  for(let i=0;i<X.length;i++){ const x=X[i]; let z=0; for(let j=0;j<d;j++) z+=w[j]*x[j]; const p=sig(z), r=p-Y[i], s=p*(1-p); for(let j=0;j<d;j++){ g[j]+=r*x[j]; for(let k=0;k<d;k++) H[j][k]+=s*x[j]*x[k]; } }
  for(let j=0;j<d;j++){ g[j]+=1e-2*w[j]; H[j][j]+=1e-2; } const A=H.map((row,j)=>[...row,g[j]]);
  for(let j=0;j<d;j++){ let m=j; for(let k=j+1;k<d;k++) if(Math.abs(A[k][j])>Math.abs(A[m][j])) m=k; [A[j],A[m]]=[A[m],A[j]]; for(let k=0;k<d;k++){ if(k===j) continue; const f=A[k][j]/A[j][j]; for(let l=j;l<=d;l++) A[k][l]-=f*A[j][l]; } }
  let mx=0; for(let j=0;j<d;j++){ const st=A[j][d]/A[j][j]; w[j]-=st; mx=Math.max(mx,Math.abs(st)); } if(mx<1e-8) break; }
const m=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
const pred=r=>avail(r)<=0?0:(forced(r)?avail(r):avail(r)*sig(feat(r).reduce((a,v,j)=>a+v*w[j],0)));
console.log(`${rows.length} 个样本(其中可选放不放 ${S.length});放分 平均 实 ${m(rows.map(r=>r.pts)).toFixed(2)} 模型 ${m(rows.map(pred)).toFixed(2)};平均绝对误差 ${m(rows.map(r=>Math.abs(pred(r)-r.pts))).toFixed(2)}`);
console.log('dumpW: ['+w.map(v=>+v.toFixed(4)).join(',')+']'); console.log('   '+names.map((n,j)=>`${n} ${w[j].toFixed(2)}`).join(' | '));
const g=(t,f)=>{ const a=rows.filter(f); if(a.length<50) return; console.log(`   ${t.padEnd(26)} n=${String(a.length).padStart(5)} 实 ${m(a.map(r=>r.pts)).toFixed(2)} 模型 ${m(a.map(pred)).toFixed(2)}`); };
for(const mw of [1,0]) for(const has of [1,0]) for(const l of [0,1]) g(`${mw?'本队暂大':'对手暂大'}·${has?'有本门':'断门'}·${l?'末家':'非末家'}`,r=>r.mateWin===mw&&r.has===has&&r.last===l);
