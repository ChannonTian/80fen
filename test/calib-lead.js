/* 领出侧「这一手领出去本队拿下这墩」:现 leadWinP vs leadWinBelief(抽样世界里走完本墩)vs 实际(2026-10-25)。
 *   node test/calib-lead.js [html] [种子数=200]   (SEED0=;DUMP=)
 * AI 领出时,取打分前 3 的单张候选 + AI 的选择(若是单张),各用 AI 打完这墩看本队拿没拿下。 */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const FILE=process.argv[2]||path.join(__dirname,'..','80fen-test.html'), N=+process.argv[3]||200, S0=+(process.env.SEED0||0);
const sr=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const cc={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};cc.globalThis=cc; vm.createContext(cc); vm.runInContext(sr,cc);
const E=cc.module.exports; E.AIP.egSearch=0;
const R=[];
const finish=(hands,history,seat,cards,T,D,buried)=>{ const hs=hands.map(h=>h.slice()); const ps=[{seat,cards}]; cards.forEach(x=>E.removeCard(hs[seat],x));
  for(let i=1;i<4;i++){ const s=(seat+i)%4, hand=hs[s]; const v={seat:s,hand,trump:T,declSeat:D,history:[...history,...ps],buriedKnown:s===D?buried:[]};
    const lead=E.classify(ps[0].cards,T); let cs=E.aiChooseFollow(v,ps).cards; if(!E.isLegalFollow(hand,lead,cs,T)) cs=E.genFollow(hand,lead,T,E.rng(1)); ps.push({seat:s,cards:cs}); }
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
      if(i===0){ const q=E.aiChooseLead(view); cards=q.cards;
        if(hand.length>1){ const L=E.leadCtx(view); const singles=(q.all||[]).filter(c=>c.cards.length===1).slice(0,3).map(c=>c.cards);
          if(cards.length===1&&!singles.some(c=>c[0]===cards[0])) singles.push(cards);
          for(const c of singles){ const cl=E.classify(c,T); const p0=E.leadWinP(L,cl,c); const p1=E.leadWinBelief(L,c); if(p1===null) continue;
            R.push({p0,p1,y:finish(hands,history,seat,c,T,D,buried),trump:cl.suit==='T'?1:0,n:hand.length,ai:c===cards?1:0}); } }
        const chk=E.checkThrow(hands,seat,cards,T); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,T); cards=E.aiChooseFollow(view,plays).cards; if(!E.isLegalFollow(hand,lead,cards,T)) cards=E.genFollow(hand,lead,T,E.rng(seed)); }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards}); }
    const res=E.resolveTrick(plays,T); history.push(...plays); leader=res.winner; }
}
if(process.env.DUMP) fs.writeFileSync(process.env.DUMP,JSON.stringify(R));
const ll=(p,y)=>{ p=Math.min(0.999,Math.max(0.001,p)); return -(y?Math.log(p):Math.log(1-p)); };
const m=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
console.log(`${N} 副,${R.length} 个领出单张候选;对数损失 现 leadWinP ${m(R.map(r=>ll(r.p0,r.y))).toFixed(4)}  抽样走完 ${m(R.map(r=>ll(r.p1,r.y))).toFixed(4)}`);
const g=(t,a)=>{ if(a.length<50) return; console.log(`  ${t.padEnd(18)} n=${String(a.length).padStart(5)}  现 ${(100*m(a.map(r=>r.p0))).toFixed(0).padStart(3)}%  新 ${(100*m(a.map(r=>r.p1))).toFixed(0).padStart(3)}%  实 ${(100*m(a.map(r=>r.y))).toFixed(0).padStart(3)}%   损失 ${m(a.map(r=>ll(r.p0,r.y))).toFixed(3)} → ${m(a.map(r=>ll(r.p1,r.y))).toFixed(3)}`); };
g('全部',R); g('AI 选的那手',R.filter(r=>r.ai)); g('副牌',R.filter(r=>!r.trump)); g('主牌',R.filter(r=>r.trump)); g('中盘',R.filter(r=>r.n>12)); g('收官',R.filter(r=>r.n<=12));
for(let b=0;b<10;b++) g(`新估 [${b/10},${(b+1)/10})`,R.filter(r=>r.p1>=b/10&&(b===9?r.p1<=1:r.p1<(b+1)/10)));
for(let b=0;b<10;b++) g(`现估 [${b/10},${(b+1)/10})`,R.filter(r=>r.p0>=b/10&&(b===9?r.p0<=1:r.p0<(b+1)/10)));
