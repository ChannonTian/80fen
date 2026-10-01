/* 「某家握着这门在外最大的那张」的小模型(路线 ② / ③,2026-10-01)。
 *
 *   node test/fit-holdtop.js a.json [b.json …]      (calib-holds.js DUMP= 的输出;自对弈和池子混打的样本一起拟合)
 *
 * 样本:[均匀估计 p, 真实 y, 有机会领却没领这门 skip, 他是庄家 decl, 他是我队友 partner]
 * 逻辑回归,特征 [1, logit(p), skip, skip·decl, skip·partner, decl]:
 *   以均匀估计为底,信号按对数几率加减 —— 系数直接贴进 AIP.holdTopW。
 */
'use strict';
const fs=require('fs');
const rows=process.argv.slice(2).flatMap(f=>JSON.parse(fs.readFileSync(f,'utf8')));
const lg=p=>{ p=Math.min(0.995,Math.max(0.005,p)); return Math.log(p/(1-p)); };
const X=rows.map(r=>[1,lg(r[0]),r[2],r[2]*r[3],r[2]*r[4],r[3]]), Y=rows.map(r=>r[1]);
const d=X[0].length; let w=new Array(d).fill(0); w[1]=1;
const sig=z=>1/(1+Math.exp(-z));
for(let it=0;it<40;it++){
  const g=new Array(d).fill(0), H=Array.from({length:d},()=>new Array(d).fill(0));
  for(let i=0;i<X.length;i++){ const x=X[i]; let z=0; for(let j=0;j<d;j++) z+=w[j]*x[j];
    const p=sig(z), r=p-Y[i], s=p*(1-p);
    for(let j=0;j<d;j++){ g[j]+=r*x[j]; for(let k=0;k<d;k++) H[j][k]+=s*x[j]*x[k]; } }
  for(let j=0;j<d;j++){ g[j]+=1e-3*w[j]; H[j][j]+=1e-3; }
  const A=H.map((row,j)=>[...row,g[j]]);
  for(let j=0;j<d;j++){ let m=j; for(let k=j+1;k<d;k++) if(Math.abs(A[k][j])>Math.abs(A[m][j])) m=k; [A[j],A[m]]=[A[m],A[j]];
    for(let k=0;k<d;k++){ if(k===j) continue; const f=A[k][j]/A[j][j]; for(let l=j;l<=d;l++) A[k][l]-=f*A[j][l]; } }
  let mx=0; for(let j=0;j<d;j++){ const st=A[j][d]/A[j][j]; w[j]-=st; mx=Math.max(mx,Math.abs(st)); }
  if(mx<1e-7) break;
}
const P=X.map(x=>sig(x.reduce((a,v,j)=>a+v*w[j],0)));
const ll=(p,y)=>{ p=Math.min(0.999,Math.max(0.001,p)); return -(y?Math.log(p):Math.log(1-p)); };
const L0=rows.reduce((a,r)=>a+ll(r[0],r[1]),0)/rows.length, L1=P.reduce((a,p,i)=>a+ll(p,Y[i]),0)/rows.length;
console.log(`${rows.length} 个样本;对数损失 均匀估计 ${L0.toFixed(4)} → 模型 ${L1.toFixed(4)}`);
console.log('holdTopW: ['+w.map(v=>+v.toFixed(4)).join(',')+']');
console.log('   特征: [1, logit(均匀估计), 没领, 没领·庄家, 没领·队友, 庄家]');
const grp=(t,f)=>{ const id=rows.map((r,i)=>i).filter(i=>f(rows[i])); if(id.length<100) return;
  const m=a=>a.reduce((x,y)=>x+y,0)/a.length;
  console.log(`   ${t.padEnd(18)} n=${String(id.length).padStart(6)}  均匀 ${(100*m(id.map(i=>rows[i][0]))).toFixed(1)}%  模型 ${(100*m(id.map(i=>P[i]))).toFixed(1)}%  实 ${(100*m(id.map(i=>Y[i]))).toFixed(1)}%`); };
grp('对手 · 没领',r=>r[2]&&!r[4]); grp('对手 · 无信号',r=>!r[2]&&!r[4]); grp('队友 · 没领',r=>r[2]&&r[4]);
grp('庄家 · 没领',r=>r[2]&&r[3]); grp('庄家 · 无信号',r=>!r[2]&&r[3]);
