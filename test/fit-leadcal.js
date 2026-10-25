/* 领出侧校准层(2026-10-25):在 leadWinBelief 之上再拟一道 logistic —— 特征 [1, logit(新), logit(旧 leadWinP), 主牌, 收官, 主牌×logit(新)]。
 *   node test/fit-leadcal.js train.json test.json      (calib-lead.js DUMP 的输出)  → 系数贴进 AIP.leadCalW */
'use strict';
const fs=require('fs'); const [a,b]=process.argv.slice(2); const tr=JSON.parse(fs.readFileSync(a)), te=JSON.parse(fs.readFileSync(b));
const lg=p=>{ p=Math.min(0.995,Math.max(0.005,p)); return Math.log(p/(1-p)); };
const feat=r=>[1,lg(r.p1),lg(r.p0),r.trump,r.n<=12?1:0,r.trump*lg(r.p1)];
const sig=z=>1/(1+Math.exp(-z));
const X=tr.map(feat), Y=tr.map(r=>r.y); const d=X[0].length; let w=new Array(d).fill(0); w[1]=1;
for(let it=0;it<60;it++){ const g=new Array(d).fill(0), H=Array.from({length:d},()=>new Array(d).fill(0));
  for(let i=0;i<X.length;i++){ const x=X[i]; let z=0; for(let j=0;j<d;j++) z+=w[j]*x[j]; const p=sig(z), r=p-Y[i], s=p*(1-p); for(let j=0;j<d;j++){ g[j]+=r*x[j]; for(let k=0;k<d;k++) H[j][k]+=s*x[j]*x[k]; } }
  for(let j=0;j<d;j++){ g[j]+=1e-2*w[j]; H[j][j]+=1e-2; } const A=H.map((row,j)=>[...row,g[j]]);
  for(let j=0;j<d;j++){ let m=j; for(let k=j+1;k<d;k++) if(Math.abs(A[k][j])>Math.abs(A[m][j])) m=k; [A[j],A[m]]=[A[m],A[j]]; for(let k=0;k<d;k++){ if(k===j) continue; const f=A[k][j]/A[j][j]; for(let l=j;l<=d;l++) A[k][l]-=f*A[j][l]; } }
  let mx=0; for(let j=0;j<d;j++){ const st=A[j][d]/A[j][j]; w[j]-=st; mx=Math.max(mx,Math.abs(st)); } if(mx<1e-8) break; }
const ll=(p,y)=>{ p=Math.min(0.999,Math.max(0.001,p)); return -(y?Math.log(p):Math.log(1-p)); };
const m=x=>x.reduce((s,v)=>s+v,0)/x.length;
const P=te.map(r=>sig(feat(r).reduce((s,v,j)=>s+v*w[j],0)));
console.log(`检验 ${te.length}:对数损失 旧 ${m(te.map(r=>ll(r.p0,r.y))).toFixed(4)}  抽样走完 ${m(te.map(r=>ll(r.p1,r.y))).toFixed(4)}  + 校准层 ${m(te.map((r,i)=>ll(P[i],r.y))).toFixed(4)}`);
console.log('leadCalW: ['+w.map(v=>+v.toFixed(4)).join(',')+']');
const g=(t,f)=>{ const id=te.map((r,i)=>i).filter(i=>f(te[i])); if(id.length<50) return; console.log(`  ${t.padEnd(16)} n=${String(id.length).padStart(5)} 旧 ${(100*m(id.map(i=>te[i].p0))).toFixed(0)}% 校准后 ${(100*m(id.map(i=>P[i]))).toFixed(0)}% 实 ${(100*m(id.map(i=>te[i].y))).toFixed(0)}%`); };
g('全部',r=>1); g('AI 选的',r=>r.ai); g('副牌',r=>!r.trump); g('主牌',r=>r.trump); g('收官',r=>r.n<=12);
for(let b=0;b<10;b++) g(`校准后 [${b/10},${(b+1)/10})`,(r=>0)); 
const bins={}; te.forEach((r,i)=>{ const k=Math.min(9,Math.floor(P[i]*10)); (bins[k]=bins[k]||[]).push(i); });
for(const k of Object.keys(bins).sort((a,b)=>a-b)) console.log(`  校准后 [${k/10},${(+k+1)/10}) n=${String(bins[k].length).padStart(5)} 估 ${(100*m(bins[k].map(i=>P[i]))).toFixed(0)}% 实 ${(100*m(bins[k].map(i=>te[i].y))).toFixed(0)}%`);
