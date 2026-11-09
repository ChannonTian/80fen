/* 「本队暂时输着、手里真有压得过的牌时,肯不肯压」的意愿小模型(belief-plan,2026-10-25)。
 *   node test/fit-will.js a.json ...      (will-data.js 或 records-will.js 的输出)
 * 特征 [1, 毙, 超毙, 末家, 台面分/10, 台面0分, 最便宜那张是大牌, 最便宜那张带分, 压得住的张数/3, 后面还有对手, 后面还有自家, 收官≤12张,
 *       末家×台面有分, 超毙×后面还有对手, 末家×毙, 末家×超毙, 同门×最便宜是大牌] —— 系数贴进 AIP.willWFit。旧格式(calib-belief DUMPW)的 partnerAfter 当作「后面还有对手」。 */
'use strict';
const fs=require('fs');
const rows=process.argv.slice(2).flatMap(f=>JSON.parse(fs.readFileSync(f,'utf8')));
const K=r=>typeof r.kind==='number'?r.kind:(r.kind==='毙'?1:r.kind==='超毙'?2:0);
const feat=r=>{ const k=K(r), ob=r.oppBehind!==undefined?r.oppBehind:r.partnerAfter, mb=r.mateBehind||0;
  return [1,k===1?1:0,k===2?1:0,r.last,Math.min(r.pts,40)/10,r.pts===0?1:0,r.cheapBig,r.cheapPts>0?1:0,Math.min(r.nB,6)/3,ob,mb,r.n<=12?1:0,r.last*(r.pts>0?1:0),(k===2?1:0)*ob,r.last*(k===1?1:0),r.last*(k===2?1:0),(k===0?1:0)*r.cheapBig]; };
const names=['1','毙','超毙','末家','台面分/10','台面0分','最便宜是大牌','最便宜带分','压得住张数/3','后面还有对手','后面还有自家','收官','末家×有分','超毙×后面有对手','末家×毙','末家×超毙','同门×最便宜是大牌'];
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
const grp=(t,f)=>{ const id=rows.map((r,i)=>i).filter(i=>f(rows[i])); if(id.length<50) return; console.log(`   ${t.padEnd(20)} n=${String(id.length).padStart(6)} 模型 ${(100*m(id.map(i=>P[i]))).toFixed(0)}% 实 ${(100*m(id.map(i=>Y[i]))).toFixed(0)}%`); };
for(const k of [0,1,2]) for(const l of [0,1]) for(const pz of [0,1]) grp(`${['同门','毙','超毙'][k]}·${l?'末家':'非末家'}·${pz?'有分':'0分'}`,r=>K(r)===k&&r.last===l&&(r.pts>0?1:0)===pz);
grp('后面还有自家',r=>r.mateBehind); grp('后面没有自家',r=>!r.mateBehind);
