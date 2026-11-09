/* 「只有我露出断门」时各家断门的概率(2026-11-09,产品方问):自对弈里,某家(单张领出的副牌墩,第 2 / 3 / 4 家)这门断了、
 * 而在这之前桌上没有别人在这门露过断门 —— 这时另外三家(领出的、其余两家)真实断这门的比例,和 AI 抽样世界(makeBelief)估的比例。
 * 按「这门在我看来还有几张没出」X 分档、按那一家的角色(庄家 / 庄帮 / 闲家,相对于真实庄家)分。
 *   node test/void-odds.js [html] [种子数=300]   (SEED0=)  */
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
  const curDecl=best?{seat:D,suit:best.suit,strength:best.strength}:null;
  const history=[]; let leader=D;
  while(hands.some(h=>h.length)){ const plays=[];
    for(let i=0;i<4;i++){ const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump:T,declSeat:D,history:[...history,...plays],buriedKnown:seat===D?buried:[],curDecl};
      let cards;
      if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,T); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,T);
        if(lead.type==='single'&&lead.suit!=='T'&&!hand.some(x=>E.effSuit(x,T)===lead.suit)){
          const vd=E.makeVoids(history,T); const others=[0,1,2,3].filter(s=>s!==seat);
          if(!others.some(s=>vd[s][lead.suit])&&!plays.slice(1).some(p=>p.cards.some(x=>E.effSuit(x,T)!==lead.suit))){
            const mem=E.makeMemory(view); let X=0; for(const k in mem.unseen){ const c=E.keyToCard(k); if(mem.unseen[k]>0&&E.effSuit(c,T)===lead.suit) X+=mem.unseen[k]; }
            const B=E.makeBelief(view,plays,30);
            for(const s of others){ const role=s===D?'庄家':s%2===D%2?'庄帮':'闲家';
              const truth=!hands[s].some(x=>E.effSuit(x,T)===lead.suit)?1:0;
              const est=B?B.worlds.filter(w=>!(w.hands[s]||[]).some(x=>E.effSuit(x,T)===lead.suit)).length/B.worlds.length:null;
              R.push({X,role,rel:s===(seat+2)%4?'队友':'对手',meDecl:seat%2===D%2?1:0,isLeader:s===plays[0].seat?1:0,truth,est,n:hand.length}); } } }
        cards=E.aiChooseFollow(view,plays).cards; if(!E.isLegalFollow(hand,lead,cards,T)) cards=E.genFollow(hand,lead,T,E.rng(seed)); }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards}); }
    const res=E.resolveTrick(plays,T); history.push(...plays); leader=res.winner; }
}
const m=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
const g=(t,a)=>{ if(a.length<25) return; console.log(`  ${t.padEnd(30)} n=${String(a.length).padStart(5)}  实际断门 ${(100*m(a.map(r=>r.truth))).toFixed(0).padStart(3)}%   AI 估 ${(100*m(a.filter(r=>r.est!==null).map(r=>r.est))).toFixed(0).padStart(3)}%`); };
console.log(`${N} 副:「我断这门、之前没人在这门露过断门」的局面,其余三家这门真实断门的比例 vs AI 抽样估计`);
for(const md of [0,1]){ console.log(`我是${md?'庄家方':'闲家方'}(${md?'对手是闲家':'对手里有庄家'}):`);
  for(const [lo,hi,lab] of [[0,6,'这门在外 ≤6 张'],[7,10,'7~10 张'],[11,14,'11~14 张'],[15,99,'≥15 张']])
    for(const role of ['庄家','庄帮','闲家']) g(`${lab}·${role}`,R.filter(r=>r.meDecl===md&&r.X>=lo&&r.X<=hi&&r.role===role)); }
