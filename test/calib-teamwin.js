/* 「这一手之后本队拿下这墩」:现在的 pTeamWin vs 逐世界走完本墩的 teamWinBelief vs 实际(2026-10-25)。
 *   node test/calib-teamwin.js [html] [种子数=200]    (SEED0=;DUMP=)
 * 第 2 / 3 家、单张领出:取 AI 的选择 + 最省的压法 + 最小的不压(各自不同时),估计 vs 用 AI 打完这墩的实际。 */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const FILE=process.argv[2]||path.join(__dirname,'..','80fen-test.html'), N=+process.argv[3]||200, S0=+(process.env.SEED0||0);
const sr=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const cc={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};cc.globalThis=cc; vm.createContext(cc); vm.runInContext(sr,cc);
const E=cc.module.exports; E.AIP.egSearch=0;
const R=[];
const finishEV=(hands,history,plays,leader,seat,cards,T,D,buried)=>{
  const hs=hands.map(h=>h.slice()); const ps=[...plays,{seat,cards}]; cards.forEach(x=>E.removeCard(hs[seat],x));
  for(let i=ps.length;i<4;i++){ const s=(leader+i)%4, hand=hs[s];
    const v={seat:s,hand,trump:T,declSeat:D,history:[...history,...ps],buriedKnown:s===D?buried:[]};
    const lead=E.classify(ps[0].cards,T); let cs=E.aiChooseFollow(v,ps).cards; if(!E.isLegalFollow(hand,lead,cs,T)) cs=E.genFollow(hand,lead,T,E.rng(1));
    ps.push({seat:s,cards:cs}); }
  const w=E.resolveTrick(ps,T).winner, pts=E.countPoints(ps.flatMap(p=>p.cards)); return w%2===seat%2?pts:-pts; };
const finish=(hands,history,plays,leader,seat,cards,T,D,buried)=>{
  const hs=hands.map(h=>h.slice()); const ps=[...plays,{seat,cards}]; cards.forEach(x=>E.removeCard(hs[seat],x));
  for(let i=ps.length;i<4;i++){ const s=(leader+i)%4, hand=hs[s];
    const v={seat:s,hand,trump:T,declSeat:D,history:[...history,...ps],buriedKnown:s===D?buried:[]};
    const lead=E.classify(ps[0].cards,T); let cs=E.aiChooseFollow(v,ps).cards; if(!E.isLegalFollow(hand,lead,cs,T)) cs=E.genFollow(hand,lead,T,E.rng(1));
    ps.push({seat:s,cards:cs}); }
  return E.resolveTrick(ps,T).winner%2===seat%2?1:0; };
for(let seed=S0+1;seed<=S0+N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,D=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;D=s;}}
  const T=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) D=first;
  hands[D].push(...kitty); const buried=E.aiDiscard(hands[D],T); buried.forEach(x=>E.removeCard(hands[D],x));
  const history=[]; let leader=D;
  while(hands.some(h=>h.length)){ const plays=[];
    for(let i=0;i<4;i++){ const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump:T,declSeat:D,history:[...history,...plays],buriedKnown:seat===D?buried:[]};
      let cards;
      if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,T); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,T); cards=E.aiChooseFollow(view,plays).cards; if(!E.isLegalFollow(hand,lead,cards,T)) cards=E.genFollow(hand,lead,T,E.rng(seed));
        if((i===1||i===2)&&lead.type==='single'&&hand.length>1){
          const legal=hand.filter(x=>E.isLegalFollow(hand,lead,[x],T));
          const beatsOf=x=>E.currentWinner([...plays,{seat,cards:[x]}],T).seat===seat;
          const wins=legal.filter(beatsOf).sort((a,b)=>E.ordIdx(a,T)-E.ordIdx(b,T));
          const lows=legal.filter(x=>!beatsOf(x)).sort((a,b)=>E.cardPoints(a)-E.cardPoints(b)||E.ordIdx(a,T)-E.ordIdx(b,T));
          const cand=[]; const add=x=>{ if(x&&!cand.includes(x)) cand.push(x); };
          if(cards.length===1) add(cards[0]); add(wins[0]); add(lows[0]);
          const X=E.followCtx(view,plays); const B=E.makeBelief(view,plays,E.AIP.beliefM);
          for(const x of cand){ const bc=beatsOf(x);
            const p0=E.pTeamWin(X,[x],bc), p1=E.teamWinBelief(X,[x],B); if(p1===null) continue;
            const my=E.cardPoints(x), gain=X.ptsTable+my+E.laterPoints(X,true), loss=X.ptsTable+my+E.laterPoints(X,false);
            const ev0=p0*gain-(1-p0)*loss, t=E.trickEVBelief(X,[x],B), ev1=t?t.ev:null, evY=finishEV(hands,history,plays,leader,seat,[x],T,D,buried);
            R.push({dec:seed*1000+history.length*4+i,p0,p1,ev0,ev1,evY,y:finish(hands,history,plays,leader,seat,[x],T,D,buried),bc:bc?1:0,pos:i+1,ai:x===cards[0]?1:0,pw:X.partnerWinning?1:0,pts:E.countPoints(plays.flatMap(p=>p.cards)),n:hand.length}); } } }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards}); }
    const res=E.resolveTrick(plays,T); history.push(...plays); leader=res.winner; }
}
if(process.env.DUMP) fs.writeFileSync(process.env.DUMP,JSON.stringify(R));
const ll=(p,y)=>{ p=Math.min(0.999,Math.max(0.001,p)); return -(y?Math.log(p):Math.log(1-p)); };
const m=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
console.log(`${N} 副,${R.length} 个样本;对数损失 现 pTeamWin ${m(R.map(r=>ll(r.p0,r.y))).toFixed(4)}  逐世界走完 ${m(R.map(r=>ll(r.p1,r.y))).toFixed(4)}`);
const mse=k=>m(R.map(r=>(r[k]-r.evY)**2)); const varY=m(R.map(r=>(r.evY-m(R.map(q=>q.evY)))**2));
console.log(`本墩得失分 均方误差 现 ev ${mse('ev0').toFixed(1)}  信念 ev ${mse('ev1').toFixed(1)}  (实际方差 ${varY.toFixed(1)});平均 现 ${m(R.map(r=>r.ev0)).toFixed(2)} 新 ${m(R.map(r=>r.ev1)).toFixed(2)} 实 ${m(R.map(r=>r.evY)).toFixed(2)}`);
// 局面内:候选之间的差(这才是决策用的)
const byDec={}; R.forEach((r,i)=>{ (byDec[r.dec]=byDec[r.dec]||[]).push(r); });
let n2=0,c0=0,c1=0; for(const k in byDec){ const a=byDec[k]; if(a.length<2) continue; for(let i=0;i<a.length;i++) for(let j=i+1;j<a.length;j++){ const dy=a[i].evY-a[j].evY; if(dy===0) continue; n2++; if(Math.sign(a[i].ev0-a[j].ev0)===Math.sign(dy)) c0++; if(Math.sign(a[i].ev1-a[j].ev1)===Math.sign(dy)) c1++; } }
console.log(`同一决策里两个候选谁好(按本墩得失分):现 ev 排对 ${(100*c0/n2).toFixed(1)}%  信念 ev ${(100*c1/n2).toFixed(1)}%  (${n2} 对)`);
const g=(t,a)=>{ if(a.length<50) return; console.log(`  ${t.padEnd(24)} n=${String(a.length).padStart(5)}  现 ${(100*m(a.map(r=>r.p0))).toFixed(0).padStart(3)}%  新 ${(100*m(a.map(r=>r.p1))).toFixed(0).padStart(3)}%  实 ${(100*m(a.map(r=>r.y))).toFixed(0).padStart(3)}%   损失 ${m(a.map(r=>ll(r.p0,r.y))).toFixed(3)} → ${m(a.map(r=>ll(r.p1,r.y))).toFixed(3)}`); };
g('全部',R); g('压过当前最大',R.filter(r=>r.bc)); g('不压·对手暂大(靠队友)',R.filter(r=>!r.bc&&!r.pw)); g('不压·队友暂大',R.filter(r=>!r.bc&&r.pw));
g('第 2 家',R.filter(r=>r.pos===2)); g('第 3 家',R.filter(r=>r.pos===3)); g('台面有分',R.filter(r=>r.pts>0)); g('中盘',R.filter(r=>r.n>12)); g('收官',R.filter(r=>r.n<=12));
for(let b=0;b<10;b++) g(`新估 [${b/10},${(b+1)/10})`,R.filter(r=>r.p1>=b/10&&(b===9?r.p1<=1:r.p1<(b+1)/10)));
