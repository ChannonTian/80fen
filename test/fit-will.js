/* 「后手对手拿得出时,真的会压 / 毙我吗」的意愿小模型(belief-plan ①②,2026-10-24)。
 *   node test/fit-will.js w0.json ...      (calib-belief.js DUMPW= 的输出;对手手里**真**有压得住的牌时的样本)
 * 特征 [1, 毙, 超毙, 他是末家, 台面分/10, 台面0分, 最便宜那张是大牌, 最便宜那张带分, 压得住的张数/3, 他后面还有我队友, 收官≤12张,
 *       末家×台面有分, 超毙×非末家] —— 系数贴进 AIP.willW。 */
'use strict';
const fs=require('fs');
const rows=process.argv.slice(2).flatMap(f=>JSON.parse(fs.readFileSync(f,'utf8')));
const feat=r=>[1,r.kind==='毙'?1:0,r.kind==='超毙'?1:0,r.last,Math.min(r.pts,40)/10,r.pts===0?1:0,r.cheapBig,r.cheapPts>0?1:0,Math.min(r.nB,6)/3,r.partnerAfter,r.n<=12?1:0,r.last*(r.pts>0?1:0),(r.kind==='超毙'?1:0)*(1-r.last)];
const names=['1','毙','超毙','末家','台面分/10','台面0分','最便宜是大牌','最便宜带分','压得住张数/3','后面还有我队友','收官','末家×有分','超毙×非末家'];
const sig=z=>1/(1+Math.exp(-z));
const X=rows.map(feat), Y=rows.map(r=>r.beat); const d=X[0].length; let w=new Array(d).fill(0);
for(let it=0;it<60;it++){ const g=new Array(d).fill(0), H=Array.from({length:d},()=>new Array(d).fill(0));
  for(let i=0;i<X.length;i++){ const x=X[i]; let z=0; for(let j=0;j<d;j++) z+=w[j]*x[j]; const p=sig(z), r=p-Y[i], s=p*(1-p);
    for(let j=0;j<d;j++){ g[j]+=r*x[j]; for(let k=0;k<d;k++) H[j][k]+=s*x[j]*x[k]; } }
  for(let j=0;j<d;j++){ g[j]+=1e-2*w[j]; H[j][j]+=1e-2; }
  const A=H.map((row,j)=>[...row,g[j]]);
  for(let j=0;j<d;j++){ let m=j; for(let k=j+1;k<d;k++) if(Math.abs(A[k][j])>Math.abs(A[m][j])) m=k; [A[j],A[m]]=[A[m],A[j]];
    for(let k=0;k<d;k++){ if(k===j) continue; const f=A[k][j]/A[j][j]; for(let l=j;l<=d;l++) A[k][l]-=f*A[j][l]; } }
  let mx=0; for(let j=0;j<d;j++){ const st=A[j][d]/A[j][j]; w[j]-=st; mx=Math.max(mx,Math.abs(st)); } if(mx<1e-8) break; }
const P=X.map(x=>sig(x.reduce((a,v,j)=>a+v*w[j],0)));
const ll=(p,y)=>{ p=Math.min(0.999,Math.max(0.001,p)); return -(y?Math.log(p):Math.log(1-p)); };
const m=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
console.log(`${rows.length} 个样本;对数损失 只用比例 ${m(Y.map(y=>ll(m(Y),y))).toFixed(4)} → 模型 ${m(P.map((p,i)=>ll(p,Y[i]))).toFixed(4)}`);
console.log('willW: ['+w.map(v=>+v.toFixed(4)).join(',')+']');
console.log('   '+names.map((n,j)=>`${n} ${w[j].toFixed(2)}`).join(' | '));
