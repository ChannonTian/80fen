/* 领出打分各项的权重,按「同一决策里谁更好」回归(2026-11-07,ai-progress 第四节第 12 项 E:「权重从续打结果回归,不手调」)。
 *   node test/fit-lead.js a.json …      (test/lead-rank.js CAPTURE=1 的输出;Y=lv 按净升级,默认按本局得分)
 * 成对 logistic:同一局面里两个候选的特征差 → 哪个续打结果更好;两折(按种子奇偶)看留出的排对率,和现在的打分(s0)比。 */
'use strict';
const fs=require('fs');
const R=process.argv.slice(2).flatMap(f=>JSON.parse(fs.readFileSync(f,'utf8'))).filter(r=>r.cands.every(c=>c.f));
const Y=process.env.Y==='lv'?'lv':'pts';
const names=['现打分','本墩EV','留手','牌型','主多奖励','主牌罚','钓主值','喂毙','队友A','进断门罚','牌权','p','p自己','牌分','主','对子','拖拉机','甩牌','钢板','王','按队主差×主','剩张×主','帮家×主','闲家×主','牌分×(1−p)','这门张数/剩张'];
const feat=c=>{ const f=c.f, t=f.trump||0;
  return [c.s0,f.ev||0,f.fut||0,f.shape||0,f.dtPos||0,f.trumpPen||0,f.tw||0,f.fr||0,f.probe||0,f.voidCost||0,f.tempo||0,f.p||0,f.pMine||0,f.pts||0,t,f.pair||0,f.tractor||0,f.throw||0,f.boss||0,f.joker||0,
    t*f.teamTrump/10,t*f.n/25,f.role===1?t:0,f.role===2?t:0,(f.pts||0)*(1-(f.p||0)),f.mySuit/f.n]; };
const pairs=rs=>{ const P=[]; for(const r of rs){ const a=r.cands; for(let i=0;i<a.length;i++) for(let j=i+1;j<a.length;j++){ const dy=a[i][Y]-a[j][Y]; if(!dy) continue;
  const xi=feat(a[i]), xj=feat(a[j]); P.push({x:xi.map((v,k)=>v-xj[k]),y:dy>0?1:0,w:Math.abs(dy),s0:a[i].s0-a[j].s0,seed:r.seed}); } } return P; };
const d=feat(R[0].cands[0]).length;
const all=pairs(R); const sd=new Array(d).fill(0); for(const p of all) p.x.forEach((v,k)=>sd[k]+=v*v); for(let k=0;k<d;k++) sd[k]=Math.sqrt(sd[k]/all.length)||1;
const sig=z=>1/(1+Math.exp(-z));
function fit(P,lam){ const w=new Array(d).fill(0);
  for(let it=0;it<30;it++){ const g=new Array(d).fill(0), H=Array.from({length:d},()=>new Array(d).fill(0));
    for(const p of P){ const x=p.x.map((v,k)=>v/sd[k]); let z=0; for(let k=0;k<d;k++) z+=w[k]*x[k]; const q=sig(z), e=q-p.y, s=q*(1-q);
      for(let k=0;k<d;k++){ g[k]+=e*x[k]; for(let l=0;l<d;l++) H[k][l]+=s*x[k]*x[l]; } }
    for(let k=0;k<d;k++){ g[k]+=lam*w[k]; H[k][k]+=lam; }
    const A=H.map((row,k)=>[...row,g[k]]);
    for(let k=0;k<d;k++){ let q=k; for(let l=k+1;l<d;l++) if(Math.abs(A[l][k])>Math.abs(A[q][k])) q=l; [A[k],A[q]]=[A[q],A[k]]; for(let l=0;l<d;l++){ if(l===k) continue; const f=A[l][k]/A[k][k]; for(let m=k;m<=d;m++) A[l][m]-=f*A[k][m]; } }
    let mx=0; for(let k=0;k<d;k++){ const st=A[k][d]/A[k][k]; w[k]-=st; mx=Math.max(mx,Math.abs(st)); } if(mx<1e-7) break; }
  return w; }
const evalP=(P,w)=>{ let ok=0,ok0=0,l=0,l0=0; for(const p of P){ const z=w?p.x.reduce((a,v,k)=>a+v/sd[k]*w[k],0):0; if(Math.sign(z)===(p.y?1:-1)) ok++; else l+=p.w; if(Math.sign(p.s0)===(p.y?1:-1)) ok0++; else l0+=p.w; }
  return {n:P.length,acc:ok/P.length,acc0:ok0/P.length,loss:l/P.length,loss0:l0/P.length}; };
console.log(`${R.length} 个局面、${all.length} 对(按${Y==='lv'?'净升级':'本局得分'})`);
for(const lam of [1,10,100]){ const A=all.filter(p=>p.seed%2===0), B=all.filter(p=>p.seed%2===1);
  const ea=evalP(B,fit(A,lam)), eb=evalP(A,fit(B,lam)), n=ea.n+eb.n;
  console.log(`  λ=${String(lam).padEnd(4)} 留出排对:现在 ${(100*(ea.acc0*ea.n+eb.acc0*eb.n)/n).toFixed(1)}% → 回归 ${(100*(ea.acc*ea.n+eb.acc*eb.n)/n).toFixed(1)}%   每对损失 ${((ea.loss0*ea.n+eb.loss0*eb.n)/n).toFixed(2)} → ${((ea.loss*ea.n+eb.loss*eb.n)/n).toFixed(2)}`); }
const w=fit(all,10); console.log('  系数(标准化后,λ=10):'); names.forEach((n,k)=>console.log(`    ${n.padEnd(12)} ${w[k]>=0?'+':''}${w[k].toFixed(3)}`));
