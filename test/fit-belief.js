/* belief-calib 的样本:均匀发牌口径 vs 加上出牌信号的 logistic,留出一半种子做检验(2026-10-24)。
 *   node test/fit-belief.js a.json ...     */
'use strict';
const fs=require('fs');
const files=process.argv.slice(2); const train=[],test=[];
files.forEach((f,i)=>{ const r=JSON.parse(fs.readFileSync(f,'utf8')); (i%2?test:train).push(...r); });
const lg=p=>{ p=Math.min(0.995,Math.max(0.005,p)); return Math.log(p/(1-p)); };
const feat=r=>[1,lg(r.urn),r.cap0,Math.min(r.played,6)/3,Math.min(r.duck,3),Math.min(r.ruff,3),Math.min(r.disc,3),Math.min(r.lead,4)/2,r.skip,r.decl,r.partner,r.decl*r.skip,Math.min(r.wonHigh,3),r.joker];
const names=['1','logit(均匀)','上界=0','出过这门张数/3','对手暂大有分时跟小没压','毙过这门','垫过这门','领过这门次数/2','有机会领没领','他是庄家','他是我队友','庄家×没领','末家压过本门','这张是王'];
const sig=z=>1/(1+Math.exp(-z));
const feat2=r=>{ const f=feat(r); f[1]=lg(r.samp); return f; };
function fit(rows,F){ F=F||feat; const X=rows.map(F),Y=rows.map(r=>r.truth); const d=X[0].length; let w=new Array(d).fill(0); w[1]=1;
  for(let it=0;it<60;it++){ const g=new Array(d).fill(0), H=Array.from({length:d},()=>new Array(d).fill(0));
    for(let i=0;i<X.length;i++){ const x=X[i]; let z=0; for(let j=0;j<d;j++) z+=w[j]*x[j]; const p=sig(z), r=p-Y[i], s=p*(1-p);
      for(let j=0;j<d;j++){ g[j]+=r*x[j]; for(let k=0;k<d;k++) H[j][k]+=s*x[j]*x[k]; } }
    for(let j=0;j<d;j++){ g[j]+=1e-2*w[j]; H[j][j]+=1e-2; }
    const A=H.map((row,j)=>[...row,g[j]]);
    for(let j=0;j<d;j++){ let m=j; for(let k=j+1;k<d;k++) if(Math.abs(A[k][j])>Math.abs(A[m][j])) m=k; [A[j],A[m]]=[A[m],A[j]];
      for(let k=0;k<d;k++){ if(k===j) continue; const f=A[k][j]/A[j][j]; for(let l=j;l<=d;l++) A[k][l]-=f*A[j][l]; } }
    let mx=0; for(let j=0;j<d;j++){ const st=A[j][d]/A[j][j]; w[j]-=st; mx=Math.max(mx,Math.abs(st)); } if(mx<1e-8) break; }
  return w; }
const fit2=rows=>fit(rows,feat2);
const ll=(p,y)=>{ p=Math.min(0.999,Math.max(0.001,p)); return -(y?Math.log(p):Math.log(1-p)); };
const m=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
for(const kind of ['side','T']){
  const tr=train.filter(r=>r.su===kind), te=test.filter(r=>r.su===kind);
  const w=fit(tr); const P=te.map(r=>sig(feat(r).reduce((a,v,j)=>a+v*w[j],0)));
  const base=m(te.map(r=>r.truth)); 
  console.log(`\n== ${kind==='side'?'副牌门「在外最大那张」':'主「在外最大那张」(多半是王)'}:训练 ${tr.length}、检验 ${te.length},真握的比例 ${(100*base).toFixed(1)}%`);
  console.log(`   检验集对数损失:均匀口径 ${m(te.map(r=>ll(r.urn,r.truth))).toFixed(4)}  →  加信号 ${m(te.map((r,i)=>ll(P[i],r.truth))).toFixed(4)}   (只用比例 ${m(te.map(r=>ll(base,r.truth))).toFixed(4)})`
    +(te[0]&&te[0].samp!==undefined?`   约束抽样 ${m(te.map(r=>ll(r.samp,r.truth))).toFixed(4)}`:''));
  if(te[0]&&te[0].samp!==undefined){ const w2=fit2(tr); const P2=te.map(r=>sig(feat2(r).reduce((a,v,j)=>a+v*w2[j],0)));
    console.log(`   约束抽样 + 信号:${m(te.map((r,i)=>ll(P2[i],r.truth))).toFixed(4)}   系数 `+names.map((n,j)=>`${n} ${w2[j].toFixed(2)}`).join(' | ')); }
  console.log('   系数:'+names.map((n,j)=>`${n} ${w[j].toFixed(2)}`).join(' | '));
  const grp=(t,f)=>{ const id=te.map((r,i)=>i).filter(i=>f(te[i])); if(id.length<80) return;
    console.log(`     ${t.padEnd(26)} n=${String(id.length).padStart(6)}  均匀 ${(100*m(id.map(i=>te[i].urn))).toFixed(0).padStart(3)}%  抽样 ${(100*m(id.map(i=>te[i].samp===undefined?NaN:te[i].samp))).toFixed(0).padStart(3)}%  加信号 ${(100*m(id.map(i=>P[i]))).toFixed(0).padStart(3)}%  实 ${(100*m(id.map(i=>te[i].truth))).toFixed(0).padStart(3)}%`); };
  grp('全部',r=>1); grp('他是庄家',r=>r.decl); grp('他是庄家·有机会领没领',r=>r.decl&&r.skip); grp('不是庄家·有机会领没领',r=>!r.decl&&r.skip);
  grp('对手暂大有分时跟小没压 ≥1',r=>r.duck>0); grp('毙过这门(已断)',r=>r.ruff>0); grp('垫过这门',r=>r.disc>0);
  grp('出过这门 ≥3 张',r=>r.played>=3); grp('出过这门 0 张',r=>r.played===0); grp('领过这门',r=>r.lead>0);
  grp('他是我队友',r=>r.partner); grp('上界=0(引擎认为没有)',r=>r.cap0); grp('末家压过本门',r=>r.wonHigh>0);
  for(let b=0;b<10;b++) grp(`均匀估 [${b/10},${(b+1)/10})`,r=>r.urn>=b/10&&r.urn<(b+1)/10);
}
