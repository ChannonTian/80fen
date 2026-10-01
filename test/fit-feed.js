/* 第 2 家「贴分后本队拿下这墩」的小模型(路线 ③,2026-10-01)。
 *
 *   node test/fit-feed.js a.json [b.json …]      (calib-feed.js DUMP= 的输出;自对弈与池子混打的样本一起拟合)
 *
 * 样本:[p 现在的估计, #3 断门概率, #4 断门概率, 庄=#1, 庄=#3, 庄=#4, 庄=我, 贴后台面分, #3 没领这门, #4 没领这门, 手里张数, 实际拿下]
 * 逻辑回归,特征 [1, logit(p), v3, v4, 庄#3, 庄#4, 庄我, 台面分/10, skip3, skip4] —— 庄 #1 是基准。系数贴进 AIP.feedW。
 */
'use strict';
const fs=require('fs');
const rows=process.argv.slice(2).flatMap(f=>JSON.parse(fs.readFileSync(f,'utf8')));
const lg=p=>{ p=Math.min(0.995,Math.max(0.005,p)); return Math.log(p/(1-p)); };
const feat=r=>[1,lg(r[0]),r[1],r[2],r[4],r[5],r[6],r[7]/10,r[8],r[9]];
const X=rows.map(feat), Y=rows.map(r=>r[11]);
const d=X[0].length; let w=new Array(d).fill(0); w[1]=1;
const sig=z=>1/(1+Math.exp(-z));
for(let it=0;it<50;it++){
  const g=new Array(d).fill(0), H=Array.from({length:d},()=>new Array(d).fill(0));
  for(let i=0;i<X.length;i++){ const x=X[i]; let z=0; for(let j=0;j<d;j++) z+=w[j]*x[j];
    const p=sig(z), r=p-Y[i], s=p*(1-p);
    for(let j=0;j<d;j++){ g[j]+=r*x[j]; for(let k=0;k<d;k++) H[j][k]+=s*x[j]*x[k]; } }
  for(let j=0;j<d;j++){ g[j]+=1e-2*w[j]; H[j][j]+=1e-2; }
  const A=H.map((row,j)=>[...row,g[j]]);
  for(let j=0;j<d;j++){ let m=j; for(let k=j+1;k<d;k++) if(Math.abs(A[k][j])>Math.abs(A[m][j])) m=k; [A[j],A[m]]=[A[m],A[j]];
    for(let k=0;k<d;k++){ if(k===j) continue; const f=A[k][j]/A[j][j]; for(let l=j;l<=d;l++) A[k][l]-=f*A[j][l]; } }
  let mx=0; for(let j=0;j<d;j++){ const st=A[j][d]/A[j][j]; w[j]-=st; mx=Math.max(mx,Math.abs(st)); }
  if(mx<1e-7) break;
}
const P=X.map(x=>sig(x.reduce((a,v,j)=>a+v*w[j],0)));
const ll=(p,y)=>{ p=Math.min(0.999,Math.max(0.001,p)); return -(y?Math.log(p):Math.log(1-p)); };
console.log(`${rows.length} 个样本;对数损失 现在的估计 ${(rows.reduce((a,r)=>a+ll(r[0],r[11]),0)/rows.length).toFixed(4)} → 模型 ${(P.reduce((a,p,i)=>a+ll(p,Y[i]),0)/rows.length).toFixed(4)}`);
console.log('feedW: ['+w.map(v=>+v.toFixed(4)).join(',')+']');
console.log('   特征: [1, logit(现估), #3 断门, #4 断门, 庄#3, 庄#4, 庄我, 贴后台面分/10, #3 没领, #4 没领](庄 #1 为基准)');
const m=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
const grp=(t,f)=>{ const id=rows.map((r,i)=>i).filter(i=>f(rows[i])); if(id.length<60) return;
  console.log(`   ${t.padEnd(14)} n=${String(id.length).padStart(5)}  现估 ${(100*m(id.map(i=>rows[i][0]))).toFixed(0).padStart(3)}%  模型 ${(100*m(id.map(i=>P[i]))).toFixed(0).padStart(3)}%  实 ${(100*m(id.map(i=>Y[i]))).toFixed(0).padStart(3)}%`); };
grp('庄 #1',r=>r[3]); grp('庄 #3',r=>r[4]); grp('庄 #4',r=>r[5]); grp('我是庄',r=>r[6]);
for(let b=0;b<10;b++) grp(`模型 [${b/10},${(b+1)/10})`,r=>{ const p=sig(feat(r).reduce((a,v,j)=>a+v*w[j],0)); return p>=b/10&&p<(b+1)/10; });
