/* 「庄家方守住最后一墩」的小模型(2026-10-24):代替 pWinLastTrick 的手调式(只用在 aiDiscard 埋底)。
 *
 *   node test/fit-plast.js a.json [b.json …]      (样本:每副庄家埋完底后的 25 张特征 + 实际末墩归属)
 *
 * 特征 [1, logit(旧估计), 主张数/10, 大王数, 小王数, 主级牌数, 副级牌数, 主对子数, 断几门副牌, 无主] —— 系数贴进 AIP.pLastW。
 * 不用庄帮手里的牌(埋底时庄家看不见)。
 */
'use strict';
const fs=require('fs');
const rows=process.argv.slice(2).flatMap(f=>JSON.parse(fs.readFileSync(f,'utf8')));
const lg=p=>{ p=Math.min(0.995,Math.max(0.005,p)); return Math.log(p/(1-p)); };
const feat=r=>[1,lg(r.p),r.nT/10,r.bj,r.sj,r.lvM,r.lvO,r.tp,r.voids,r.nt];
const X=rows.map(feat), Y=rows.map(r=>r.won);
const d=X[0].length; let w=new Array(d).fill(0); w[1]=1;
const sig=z=>1/(1+Math.exp(-z));
for(let it=0;it<60;it++){
  const g=new Array(d).fill(0), H=Array.from({length:d},()=>new Array(d).fill(0));
  for(let i=0;i<X.length;i++){ const x=X[i]; let z=0; for(let j=0;j<d;j++) z+=w[j]*x[j];
    const p=sig(z), r=p-Y[i], s=p*(1-p);
    for(let j=0;j<d;j++){ g[j]+=r*x[j]; for(let k=0;k<d;k++) H[j][k]+=s*x[j]*x[k]; } }
  for(let j=0;j<d;j++){ g[j]+=1e-2*w[j]; H[j][j]+=1e-2; }
  const A=H.map((row,j)=>[...row,g[j]]);
  for(let j=0;j<d;j++){ let m=j; for(let k=j+1;k<d;k++) if(Math.abs(A[k][j])>Math.abs(A[m][j])) m=k; [A[j],A[m]]=[A[m],A[j]];
    for(let k=0;k<d;k++){ if(k===j) continue; const f=A[k][j]/A[j][j]; for(let l=j;l<=d;l++) A[k][l]-=f*A[j][l]; } }
  let mx=0; for(let j=0;j<d;j++){ const st=A[j][d]/A[j][j]; w[j]-=st; mx=Math.max(mx,Math.abs(st)); }
  if(mx<1e-8) break;
}
const P=X.map(x=>sig(x.reduce((a,v,j)=>a+v*w[j],0)));
const ll=(p,y)=>{ p=Math.min(0.999,Math.max(0.001,p)); return -(y?Math.log(p):Math.log(1-p)); };
console.log(`${rows.length} 副;对数损失 旧估计 ${(rows.reduce((a,r)=>a+ll(r.p,r.won),0)/rows.length).toFixed(4)} → 模型 ${(P.reduce((a,p,i)=>a+ll(p,Y[i]),0)/rows.length).toFixed(4)}`);
console.log('pLastW: ['+w.map(v=>+v.toFixed(4)).join(',')+']');
console.log('   特征: [1, logit(旧估计), 主张数/10, 大王, 小王, 主级牌, 副级牌, 主对子, 断门数, 无主]');
const m=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
const grp=(t,f)=>{ const id=rows.map((r,i)=>i).filter(i=>f(rows[i])); if(id.length<30) return;
  console.log(`   ${t.padEnd(16)} n=${String(id.length).padStart(5)}  旧估 ${(100*m(id.map(i=>rows[i].p))).toFixed(0).padStart(3)}%  模型 ${(100*m(id.map(i=>P[i]))).toFixed(0).padStart(3)}%  实 ${(100*m(id.map(i=>Y[i]))).toFixed(0).padStart(3)}%`); };
for(const b of [0,1,2]) grp(`大王 ${b}`,r=>r.bj===b);
for(const [lo,hi] of [[0,8],[8,10],[10,12],[12,14],[14,30]]) grp(`主 ${lo}~${hi-1} 张`,r=>r.nT>=lo&&r.nT<hi);
grp('无主',r=>r.nt); grp('有主',r=>!r.nt);
for(let b=0;b<10;b++) grp(`旧估 [${b/10},${(b+1)/10})`,r=>r.p>=b/10&&r.p<(b+1)/10);
grp('庄帮有大王(庄家看不见)',r=>r.pbj>0); grp('庄帮没大王',r=>r.pbj===0);
