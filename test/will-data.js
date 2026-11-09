/* 通用的「肯不肯压」样本(belief-plan,2026-10-25):单张领出的墩里,任何一家出牌时**本队暂时输着**、手里**真有**压得过当前最大那张的牌,
 * 他真压了没有。给 fit-will.js 拟合 willW(对手压我 / 队友压回来 / 第 3 家接 都是同一个问题)。
 *   node test/will-data.js [html] [种子数=300]    (SEED0=;DUMP=x.json;OV=)        */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const FILE=process.argv[2]||path.join(__dirname,'..','80fen-test.html'), N=+process.argv[3]||300, S0=+(process.env.SEED0||0);
const sr=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const cc={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};cc.globalThis=cc; vm.createContext(cc); vm.runInContext(sr,cc);
const E=cc.module.exports; if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV)); if(process.env.EG!=='1') E.AIP.egSearch=0;
const W=[];
const feats=(E,T,plays,seat,hand,leader)=>{
  const lead=E.classify(plays[0].cards,T); const cur=E.currentWinner(plays,T); const ccl=E.classify(plays.find(p=>p.seat===cur.seat).cards,T);
  const ls=lead.suit, hasLead=hand.some(c=>E.effSuit(c,T)===ls), tr=hand.filter(c=>E.effSuit(c,T)==='T');
  const curRuff=ccl.suit==='T'&&ls!=='T';
  let kind,beaters;
  if(curRuff){ kind=2; beaters=hasLead?[]:tr.filter(c=>E.ordIdx(c,T)>ccl.top); }
  else if(ls!=='T'&&!hasLead){ kind=1; beaters=tr; }
  else { kind=0; beaters=hand.filter(c=>E.effSuit(c,T)===ccl.suit&&E.ordIdx(c,T)>ccl.top); }
  if(!beaters.length) return null;
  let ch=beaters[0]; for(const c of beaters) if(E.ordIdx(c,T)<E.ordIdx(ch,T)) ch=c;
  const i=plays.length, behind=[]; for(let j=i+1;j<4;j++) behind.push((leader+j)%4);
  const pts=E.countPoints(plays.flatMap(p=>p.cards));
  return {kind,last:i===3?1:0,pts,cheapPts:E.cardPoints(ch),cheapBig:ch.suit==='X'||ch.rank===T.rank||(E.effSuit(ch,T)==='T'&&ch.rank===14)?1:0,
    nB:beaters.length,oppBehind:behind.some(z=>z%2!==seat%2)?1:0,mateBehind:behind.some(z=>z%2===seat%2)?1:0,n:hand.length};
};
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
      if(i>0){ const lead=E.classify(plays[0].cards,T);
        if(lead.type==='single'&&E.currentWinner(plays,T).seat%2!==seat%2) f=feats(E,T,plays,seat,hand,leader); }
      if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,T); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,T); cards=E.aiChooseFollow(view,plays).cards; if(!E.isLegalFollow(hand,lead,cards,T)) cards=E.genFollow(hand,lead,T,E.rng(seed)); }
      if(f){ f.beat=E.currentWinner([...plays,{seat,cards}],T).seat===seat?1:0; W.push(f); }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards}); }
    const res=E.resolveTrick(plays,T); history.push(...plays); leader=res.winner; }
}
if(process.env.DUMP) fs.writeFileSync(process.env.DUMP,JSON.stringify(W));
console.log(`${N} 副,${W.length} 个样本,压了 ${(100*W.filter(r=>r.beat).length/W.length).toFixed(0)}%`);
