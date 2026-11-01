/* 「队友暂大、后面还有对手时,肯不肯自己压上去保」(10-31,教练线交的第四节第 11 项):
 * teamWinBelief / trickEVBelief 的推演里「本队赢着 → 跟小」是写死的 —— 第 2 家把分垫给后面的队友,第 3 家(领出那家的队友)
 * 看着队友那张小牌暂大就永远不毙,下家已知断门时估本队拿下 63%、实 35%。这里收样本、拟合 willMateW。
 * 样本:单张领出,某家出牌时**本队暂大**、后面还有对手、手里真有压得过暂大那张的牌;标签 = 他这手成了暂大。
 * 特征全从他自己看得到的东西算:暂大那张上面在外还有几张(关键牌)、后面的对手是否已知断这门 / 断主、台面分……
 *   node test/willmate-data.js [html] [种子数=300]   (SEED0=;DUMP=x.json;OV=)
 *   node test/willmate-data.js --fit a.json ...       */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const names=['1','毙','超毙','台面分/10','台面0分','最便宜是大牌','最便宜带分','暂大那张上面在外张数/3','上面在外0张',
  '后面对手断这门','后面对手断这门×暂大是副牌','后面对手断主','暂大那家是领出的','收官≤12张','后面还有自家'];
const feat=r=>[1,r.kind===1?1:0,r.kind===2?1:0,Math.min(r.pts,40)/10,r.pts===0?1:0,r.cheapBig,r.cheapPts>0?1:0,Math.min(r.hi,6)/3,r.hi===0?1:0,
  r.vB,r.vB*(r.curSide?1:0),r.vBT,r.curLead,r.n<=12?1:0,r.mateBehind];
if(process.argv[2]==='--fit'){
  const rows=process.argv.slice(3).flatMap(f=>JSON.parse(fs.readFileSync(f,'utf8')));
  const sig=z=>1/(1+Math.exp(-z)), ll=(p,y)=>{ p=Math.min(0.999,Math.max(0.001,p)); return -(y?Math.log(p):Math.log(1-p)); }, m=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
  const fit=rs=>{ const X=rs.map(feat), Y=rs.map(r=>r.beat), d=X[0].length; const w=new Array(d).fill(0);
    for(let it=0;it<60;it++){ const g=new Array(d).fill(0), H=Array.from({length:d},()=>new Array(d).fill(0));
      for(let i=0;i<X.length;i++){ const x=X[i]; let z=0; for(let j=0;j<d;j++) z+=w[j]*x[j]; const p=sig(z), e=p-Y[i], s=p*(1-p);
        for(let j=0;j<d;j++){ g[j]+=e*x[j]; for(let k=0;k<d;k++) H[j][k]+=s*x[j]*x[k]; } }
      for(let j=0;j<d;j++){ g[j]+=1e-2*w[j]; H[j][j]+=1e-2; }
      const A=H.map((row,j)=>[...row,g[j]]);
      for(let j=0;j<d;j++){ let q=j; for(let k=j+1;k<d;k++) if(Math.abs(A[k][j])>Math.abs(A[q][j])) q=k; [A[j],A[q]]=[A[q],A[j]];
        for(let k=0;k<d;k++){ if(k===j) continue; const f=A[k][j]/A[j][j]; for(let l=j;l<=d;l++) A[k][l]-=f*A[j][l]; } }
      let mx=0; for(let j=0;j<d;j++){ const st=A[j][d]/A[j][j]; w[j]-=st; mx=Math.max(mx,Math.abs(st)); } if(mx<1e-8) break; }
    return w; };
  const pr=(w,r)=>sig(feat(r).reduce((a,v,j)=>a+v*w[j],0));
  const A=rows.filter((r,i)=>i%2===0), Bh=rows.filter((r,i)=>i%2===1), wA=fit(A), wB=fit(Bh);
  const cv=m([...Bh.map(r=>ll(pr(wA,r),r.beat)),...A.map(r=>ll(pr(wB,r),r.beat))]);
  const w=fit(rows), base=m(rows.map(r=>r.beat));
  console.log(`${rows.length} 个样本,压了 ${(100*base).toFixed(0)}%;对数损失 只用比例 ${m(rows.map(r=>ll(base,r.beat))).toFixed(4)} → 模型(两折)${cv.toFixed(4)}`);
  console.log('willMateW: ['+w.map(v=>+v.toFixed(4)).join(',')+']');
  console.log('   '+names.map((n,j)=>`${n} ${w[j].toFixed(2)}`).join(' | '));
  const grp=(t,f)=>{ const a=rows.filter(f); if(a.length<30) return; console.log(`   ${t.padEnd(26)} n=${String(a.length).padStart(5)} 模型 ${(100*m(a.map(r=>pr(w,r)))).toFixed(0)}% 实 ${(100*m(a.map(r=>r.beat))).toFixed(0)}%`); };
  for(const k of [0,1,2]) for(const v of [0,1]) grp(`${['同门','毙','超毙'][k]}·后面对手${v?'已知断这门':'没露断门'}`,r=>r.kind===k&&r.vB===v);
  for(const h of [0,1,2,3]) grp(`暂大那张上面在外 ${h===3?'≥3':h} 张`,r=>h===3?r.hi>=3:r.hi===h);
  grp('台面 0 分',r=>r.pts===0); grp('台面有分',r=>r.pts>0);
  for(const k of [0,1,2]){ const a=rows.filter(r=>r.beat&&r.kind===k&&r.nBeat>1); if(a.length<30) continue;
    console.log(`   压上去时用哪张(${['同门','毙','超毙'][k]},可选 ≥2 张,n=${a.length}):最便宜 ${(100*a.filter(r=>r.used==='cheap').length/a.length).toFixed(0)}% 中间 ${(100*a.filter(r=>r.used==='mid').length/a.length).toFixed(0)}% 最大 ${(100*a.filter(r=>r.used==='top').length/a.length).toFixed(0)}%`+(a[0].ruleR!==undefined?`;规则「最便宜的稳赢张,没有就最便宜」对上 ${(100*a.filter(r=>r.ruleR).length/a.length).toFixed(0)}%`:'')); }
  process.exit(0);
}
const FILE=process.argv[2]||path.join(__dirname,'..','80fen-test.html'), N=+process.argv[3]||300, S0=+(process.env.SEED0||0);
const sr=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const cc={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};cc.globalThis=cc; vm.createContext(cc); vm.runInContext(sr,cc);
const E=cc.module.exports; if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV)); if(process.env.EG!=='1') E.AIP.egSearch=0;
const W=[];
const feats=(view,plays,leader)=>{
  const T=view.trump, hand=view.hand, seat=view.seat;
  const mem=E.makeMemory(view);
  const unseenHi=(su,top)=>{ let n=0; for(const k in mem.unseen){ const c=E.keyToCard(k); if(mem.unseen[k]>0&&E.effSuit(c,T)===su&&E.ordIdx(c,T)>top) n+=mem.unseen[k]; } return n; };
  const r=E.willMateFeat(T,plays,seat,hand,unseenHi,E.makeVoids(view.history.slice(0,view.history.length-plays.length),T),behindOf(plays,leader));
  if(r) delete r.card; return r;
};
const behindOf=(plays,leader)=>{ const b=[]; for(let j=plays.length+1;j<4;j++) b.push((leader+j)%4); return b; };
for(let seed=S0+1;seed<=S0+N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,D=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;D=s;}}
  const T=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) D=first;
  hands[D].push(...kitty); const buried=E.aiDiscard(hands[D],T); buried.forEach(x=>E.removeCard(hands[D],x));
  const history=[]; let leader=D;
  while(hands.some(h=>h.length)){ const plays=[];
    for(let i=0;i<4;i++){ const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump:T,declSeat:D,history:[...history,...plays],buriedKnown:seat===D?buried:[]};
      let cards; let f=null;
      if(i>0&&i<3){ const lead=E.classify(plays[0].cards,T);
        if(lead.type==='single'&&E.currentWinner(plays,T).seat%2===seat%2) f=feats(view,plays,leader); }
      if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,T); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,T); cards=E.aiChooseFollow(view,plays).cards; if(!E.isLegalFollow(hand,lead,cards,T)) cards=E.genFollow(hand,lead,T,E.rng(seed)); }
      if(f){ f.beat=E.currentWinner([...plays,{seat,cards}],T).seat===seat?1:0;
        if(f.beat&&cards.length===1){ const T2=T, cur=E.currentWinner(plays,T2), ccl=E.classify(plays.find(p=>p.seat===cur.seat).cards,T2);
          const bs=hand.filter(c=>E.currentWinner([...plays,{seat,cards:[c]}],T2).seat===seat).map(c=>E.ordIdx(c,T2)).sort((a,b)=>a-b), ix=E.ordIdx(cards[0],T2);
          f.used=ix===bs[0]?'cheap':ix===bs[bs.length-1]?'top':'mid'; f.nBeat=bs.length;
          const mem=E.makeMemory(view), su=E.effSuit(cards[0],T2); let mu=-1; for(const k in mem.unseen){ const c=E.keyToCard(k); if(mem.unseen[k]>0&&E.effSuit(c,T2)===su) mu=Math.max(mu,E.ordIdx(c,T2)); }
          const bsS=bs.filter(i=>true), safe=bsS.filter(i=>i>mu); f.ruleR=(safe.length?safe[0]:bsS[0])===ix?1:0; f.ruleC=bsS[0]===ix?1:0; }
        W.push(f); }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards}); }
    const res=E.resolveTrick(plays,T); history.push(...plays); leader=res.winner; }
}
if(process.env.DUMP) fs.writeFileSync(process.env.DUMP,JSON.stringify(W));
console.log(`${N} 副,${W.length} 个样本,压了 ${(100*W.filter(r=>r.beat).length/W.length).toFixed(0)}%`);
