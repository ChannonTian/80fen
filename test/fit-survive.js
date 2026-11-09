/* 「我这手压下了能不能活到墩末」的小模型(路线 ③,2026-10-01)—— 代替 pSurvive 里的三个手调常数。
 *
 *   node test/fit-survive.js a.json [b.json …]      (calib-survive.js DUMP= 的输出)
 *
 * 样本:[p0 旧估计, 第3家, 主牌墩, 我是毙, 贴后台面分, 后手对手断这门的最大概率, 末家是对手, 这张是钢板, 这张带分, 中盘, 后手对手几家, 实际拿下]
 * 特征 [1, logit(p0), 第3家, 主牌墩, 毙, 台面分/10, 断门概率, 末家是对手, 钢板, 带分, 中盘] —— 系数贴进 AIP.survW。
 */
'use strict';
const fs=require('fs');
const rows=process.argv.slice(2).flatMap(f=>JSON.parse(fs.readFileSync(f,'utf8')));
const lg=p=>{ p=Math.min(0.995,Math.max(0.005,p)); return Math.log(p/(1-p)); };
const feat=r=>[1,lg(r[0]),r[1],r[2],r[3],r[4]/10,r[5],r[6],r[7],r[8],r[9]];
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
console.log(`${rows.length} 个样本;对数损失 旧估计 ${(rows.reduce((a,r)=>a+ll(r[0],r[11]),0)/rows.length).toFixed(4)} → 模型 ${(P.reduce((a,p,i)=>a+ll(p,Y[i]),0)/rows.length).toFixed(4)}`);
console.log('survW: ['+w.map(v=>+v.toFixed(4)).join(',')+']');
console.log('   特征: [1, logit(旧估计), 第3家, 主牌墩, 毙, 台面分/10, 后手断门概率, 末家是对手, 钢板, 带分, 中盘]');
const m=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
const grp=(t,f)=>{ const id=rows.map((r,i)=>i).filter(i=>f(rows[i])); if(id.length<60) return;
  console.log(`   ${t.padEnd(16)} n=${String(id.length).padStart(6)}  旧估 ${(100*m(id.map(i=>rows[i][0]))).toFixed(0).padStart(3)}%  模型 ${(100*m(id.map(i=>P[i]))).toFixed(0).padStart(3)}%  实 ${(100*m(id.map(i=>Y[i]))).toFixed(0).padStart(3)}%`); };
grp('主牌墩',r=>r[2]); grp('副牌墩 · 跟本门',r=>!r[2]&&!r[3]); grp('副牌墩 · 毙',r=>r[3]);
grp('台面 0 分',r=>r[4]===0); grp('台面有分',r=>r[4]>0); grp('钢板',r=>r[7]); grp('非钢板',r=>!r[7]);
for(let b=0;b<10;b++) grp(`旧估 [${b/10},${(b+1)/10})`,r=>r[0]>=b/10&&(b===9?r[0]<=1:r[0]<(b+1)/10));
