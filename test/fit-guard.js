/* 守底概率的拟合(guardPlan 的系数 AIP.guardW)。
 *
 *   node test/fit-guard.js <html> [种子数=1500]        (OV= 覆盖 AIP)
 *
 * 自对弈:庄家每一次出牌前,记下他看得到的 guardFeat(n 手里张数、t 手里主牌、b 钢板主、U 在外主牌),
 * 标签 = 这一局最后一墩是不是庄家方拿下。逻辑回归,特征与 guardP 一致:
 *   [1, min(b,1), min(b,3), t, U, n, min(b,1)·t]
 * 输出系数(贴进 AIP.guardW)与分箱校准表。标签依赖当前打法 —— 打法改了要重拟合。
 */
'use strict';
const fs=require('fs'),vm=require('vm');
const FILE=process.argv[2]||'80fen-test.html';
const src=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c;
vm.createContext(c);vm.runInContext(src,c);
const E=c.module.exports;
E.AIP.egSearch=0;
if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV));
const N=+process.argv[3]||1500, S0=+(process.env.SEED0||0);
const X=[], Y=[], KP=[];
const feat=f=>[1,Math.min(f.b,1),Math.min(f.b,3),f.t,f.U,f.n,Math.min(f.b,1)*f.t];
for(let seed=S0+1;seed<=S0+N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) declSeat=first;
  hands[declSeat].push(...kitty); const buried=E.aiDiscard(hands[declSeat],trump); buried.forEach(x=>E.removeCard(hands[declSeat],x));
  const kp=E.countPoints(buried);
  const rand=E.rng(seed^0x9e3779b9); const history=[]; let leader=declSeat, last=-1; const rows=[];
  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      if(seat===declSeat) rows.push(feat(E.guardFeat(hand,E.makeMemory(view),trump)));
      let cards;
      if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,trump); cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand); }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    history.push(...plays); leader=E.resolveTrick(plays,trump).winner; last=leader;
  }
  const y=last%2===declSeat%2?1:0;
  for(const r of rows){ X.push(r); Y.push(y); KP.push(kp); }
}
// 逻辑回归(牛顿法,带一点 L2)
const d=X[0].length; let w=new Array(d).fill(0);
const sig=z=>1/(1+Math.exp(-z));
for(let it=0;it<30;it++){
  const g=new Array(d).fill(0), H=Array.from({length:d},()=>new Array(d).fill(0));
  for(let i=0;i<X.length;i++){ const x=X[i]; let z=0; for(let j=0;j<d;j++) z+=w[j]*x[j];
    const p=sig(z), r=p-Y[i], s=p*(1-p);
    for(let j=0;j<d;j++){ g[j]+=r*x[j]; for(let k=0;k<d;k++) H[j][k]+=s*x[j]*x[k]; } }
  for(let j=0;j<d;j++){ g[j]+=1e-3*w[j]; H[j][j]+=1e-3; }
  // 解 H·Δ = g
  const A=H.map((row,j)=>[...row,g[j]]);
  for(let j=0;j<d;j++){ let m=j; for(let k=j+1;k<d;k++) if(Math.abs(A[k][j])>Math.abs(A[m][j])) m=k; [A[j],A[m]]=[A[m],A[j]];
    for(let k=0;k<d;k++){ if(k===j) continue; const f=A[k][j]/A[j][j]; for(let l=j;l<=d;l++) A[k][l]-=f*A[j][l]; } }
  const step=A.map((row,j)=>row[d]/row[j]); let mx=0;
  for(let j=0;j<d;j++){ w[j]-=step[j]; mx=Math.max(mx,Math.abs(step[j])); }
  if(mx<1e-7) break;
}
const P=X.map(x=>sig(x.reduce((a,v,j)=>a+v*w[j],0)));
let ll=0,ll0=0; const yb=Y.reduce((a,b)=>a+b,0)/Y.length;
for(let i=0;i<Y.length;i++){ ll-=Y[i]?Math.log(P[i]):Math.log(1-P[i]); ll0-=Y[i]?Math.log(yb):Math.log(1-yb); }
console.log(`${FILE}${process.env.OV?' OV='+process.env.OV:''} —— ${N} 副,庄家决策点 ${X.length} 个,庄家方守住最后一墩 ${(100*yb).toFixed(1)}%`);
console.log(`对数损失 ${(ll/Y.length).toFixed(4)}(只用均值 ${(ll0/Y.length).toFixed(4)})`);
console.log('guardW: ['+w.map(v=>+v.toFixed(4)).join(',')+']');
console.log('   特征: [1, min(b,1), min(b,3), t, U, n, min(b,1)·t]');
console.log('\n分箱校准:');
for(let b=0;b<10;b++){ const lo=b/10,hi=(b+1)/10; const id=P.map((p,i)=>i).filter(i=>P[i]>=lo&&(b===9?P[i]<=hi:P[i]<hi)); if(id.length<50) continue;
  console.log(`  [${lo.toFixed(1)},${hi.toFixed(1)})  n=${String(id.length).padStart(6)}  估 ${(100*id.reduce((a,i)=>a+P[i],0)/id.length).toFixed(1)}%  实 ${(100*id.reduce((a,i)=>a+Y[i],0)/id.length).toFixed(1)}%`); }
console.log('\n按阶段(手里张数)× 钢板主张数 的实际守住率:');
for(const [lo,hi] of [[20,25],[12,19],[6,11],[1,5]]){
  const row=[0,1,2,3].map(bb=>{ const id=X.map((x,i)=>i).filter(i=>X[i][5]>=lo&&X[i][5]<=hi&&Math.min(3,X[i][2])===bb); return id.length>=30?`b=${bb}: ${(100*id.reduce((a,i)=>a+Y[i],0)/id.length).toFixed(0)}%(${id.length})`:`b=${bb}: —`; });
  console.log(`  ${String(lo).padStart(2)}~${String(hi).padEnd(2)} 张  ${row.join('   ')}`); }
