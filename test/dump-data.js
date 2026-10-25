/* 「这一家跟牌时会往这墩里放多少分」的样本(2026-10-25,替 laterPoints 里的 dumpPartner / dumpOpp 那些常数)。
 *   node test/dump-data.js [html] [种子数=300]   (SEED0=;DUMP=)
 * 单张领出、第 2~4 家、他**没有压过**当前最大的那一手:记他手里的分(本门有没有分牌、最大分牌、断门时副牌里的分)、
 * 本队是不是暂大、是不是末家、台面分,和他实际出了几分。 */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const FILE=process.argv[2]||path.join(__dirname,'..','80fen-test.html'), N=+process.argv[3]||300, S0=+(process.env.SEED0||0);
const sr=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const cc={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};cc.globalThis=cc; vm.createContext(cc); vm.runInContext(sr,cc);
const E=cc.module.exports; E.AIP.egSearch=0;
const R=[];
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
        if(lead.type==='single'&&cards.length===1&&E.currentWinner([...plays,{seat,cards}],T).seat!==seat){
          const ls=lead.suit, inS=hand.filter(c=>E.effSuit(c,T)===ls), cur=E.currentWinner(plays,T);
          const ptsIn=inS.filter(c=>E.cardPoints(c)>0), npIn=inS.filter(c=>E.cardPoints(c)===0);
          const side=hand.filter(c=>E.effSuit(c,T)!=='T'), sidePts=side.filter(c=>E.cardPoints(c)>0), sideNp=side.filter(c=>E.cardPoints(c)===0);
          R.push({mateWin:cur.seat%2===seat%2?1:0,last:i===3?1:0,tbl:E.countPoints(plays.flatMap(p=>p.cards)),has:inS.length?1:0,
            maxIn:ptsIn.length?Math.max(...ptsIn.map(E.cardPoints)):0,onlyPts:inS.length&&!npIn.length?1:0,nIn:inS.length,
            sideMax:sidePts.length?Math.max(...sidePts.map(E.cardPoints)):0,sideOnlyPts:!inS.length&&side.length&&!sideNp.length?1:0,
            trumpLead:ls==='T'?1:0,n:hand.length,pts:E.cardPoints(cards[0])}); } }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards}); }
    const res=E.resolveTrick(plays,T); history.push(...plays); leader=res.winner; }
}
if(process.env.DUMP) fs.writeFileSync(process.env.DUMP,JSON.stringify(R));
const m=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
console.log(`${N} 副,${R.length} 个不压的跟牌`);
const g=(t,f)=>{ const a=R.filter(f); if(a.length<40) return; console.log(`  ${t.padEnd(34)} n=${String(a.length).padStart(5)}  平均放 ${m(a.map(r=>r.pts)).toFixed(2)} 分   放了分的比例 ${(100*m(a.map(r=>r.pts>0?1:0))).toFixed(0)}%`); };
for(const mw of [1,0]) for(const has of [1,0]) for(const mp of [0,5,10]){ g(`${mw?'本队暂大':'对手暂大'}·${has?'有本门':'断门'}·${has?'本门最大分牌':'副牌最大分牌'} ${mp}`,r=>r.mateWin===mw&&r.has===has&&(has?r.maxIn:r.sideMax)===mp); }
g('对手暂大·本门只剩分牌',r=>!r.mateWin&&r.onlyPts); g('本队暂大·末家·有本门分牌',r=>r.mateWin&&r.last&&r.maxIn>0); g('本队暂大·非末家·有本门分牌',r=>r.mateWin&&!r.last&&r.maxIn>0);
