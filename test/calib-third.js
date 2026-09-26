/* 第 3 家「这墩守得住吗」的校准,按末家能怎么赢拆开(产品方,2026-09-26):
 * 「第三家依然对下家可能大过或毙掉的情形不够敏感,在第三家出小牌被抓。」
 *
 *   node test/calib-third.js <html> [种子数=300]        (OV= 覆盖 AIP)
 *
 * 每个第 3 家决策点,量 AI 选的那一手的 pTeamWin(本队赢下这墩的概率)与实际结果。
 * 只剩末家一个人没出,所以这就是「末家赢不赢得了」的校准。分层:
 *   · 领出门:主 / 副;
 *   · 本队暂大的是谁:我压过去了 / 队友暂大我没压;
 *   · 末家对这门:按真实手牌 —— 有这门且有更大的 / 有这门但没更大的 / 断门有主 / 断门没主;
 *     以及 AI 推断的末家断门概率 pVoid 分档;
 *   · 台面有没有分。
 * 实际输掉时,末家是怎么赢的:同门压过 / 毙牌。
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
const N=+process.argv[3]||300;
const R=[];
for(let seed=1;seed<=N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) declSeat=first;
  hands[declSeat].push(...kitty); const buried=E.aiDiscard(hands[declSeat],trump); buried.forEach(x=>E.removeCard(hands[declSeat],x));
  const rand=E.rng(seed^0x9e3779b9); const history=[]; let leader=declSeat;
  while(hands.some(h=>h.length)){
    const plays=[]; let rec=null;
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,trump); cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand);
        if(i===2&&lead.cards.length===1&&hand.length>1){
          const X=E.followCtx(view,plays), cl=E.classify(cards,trump);
          let beats=false; if(cl&&E.structMatches(cl,X.lead)){ if(cl.suit===X.cur.cl.suit) beats=cl.top>X.cur.cl.top; else if(cl.suit==='T') beats=true; }
          const teamAhead=beats||X.partnerWinning;
          if(teamAhead){
            const p=E.pTeamWin(X,cards,beats);
            const last=(seat+1)%4, ls=lead.suit;
            // 本队这墩的最大那张(压过去的我,或队友)
            const winCl=beats?cl:X.cur.cl;
            const lh=hands[last];
            const hasSuit=lh.some(x=>E.effSuit(x,trump)===ls);
            let lastKind;
            if(hasSuit) lastKind=lh.some(x=>E.effSuit(x,trump)===ls&&winCl.suit===ls&&E.ordIdx(x,trump)>winCl.top)?'末家同门有更大':'末家同门没更大';
            else lastKind=lh.some(x=>E.effSuit(x,trump)==='T')?(ls==='T'?'—':'末家断门、有主'):'末家断门、没主';
            const pv=ls==='T'?0:X.pVoidOf(last,ls);
            rec={p,seat,ls:ls==='T'?'主牌墩':'副牌墩',who:beats?(cl.suit==='T'&&ls!=='T'?'我毙了':'我压过去了'):'队友暂大我没压',
                 lastKind,pv,pts:X.ptsTable>0,myPts:E.countPoints(cards)};
          }
        }
      }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    history.push(...plays);
    const res=E.resolveTrick(plays,trump);
    if(rec){ rec.y=res.winner%2===rec.seat%2?1:0; rec.pts4=res.points;
      if(!rec.y){ const lp=plays[3]; rec.how=E.effSuit(lp.cards[0],trump)===E.classify(plays[0].cards,trump).suit?'同门压过':'毙牌'; }
      R.push(rec); }
    leader=res.winner;
  }
}
const row=(lbl,g)=>{ if(g.length<25) return; const m=f=>g.reduce((a,r)=>a+f(r),0)/g.length;
  const lost=g.filter(r=>!r.y);
  console.log(`${lbl.padEnd(34)} n=${String(g.length).padStart(5)}  估 ${(100*m(r=>r.p)).toFixed(0).padStart(3)}%  实 ${(100*m(r=>r.y)).toFixed(0).padStart(3)}%  差 ${(100*(m(r=>r.p)-m(r=>r.y))).toFixed(0).padStart(3)}  `
    +`丢墩时送 ${(lost.reduce((a,r)=>a+r.pts4,0)/Math.max(1,lost.length)).toFixed(1)} 分(毙 ${lost.filter(r=>r.how==='毙牌').length}/${lost.length})`); };
console.log(`${FILE}${process.env.OV?' OV='+process.env.OV:''} —— ${N} 副,第 3 家、单张墩、本队暂大(我压过去或队友暂大)`);
row('全部',R);
for(const ls of ['主牌墩','副牌墩']) for(const who of ['我压过去了','我毙了','队友暂大我没压']){
  const g=R.filter(r=>r.ls===ls&&r.who===who); if(g.length<25) continue;
  console.log(`\n【${ls} · ${who}】`); row('  小计',g);
  for(const k of ['末家同门有更大','末家同门没更大','末家断门、有主','末家断门、没主']) row('  '+k,g.filter(r=>r.lastKind===k));
  if(ls==='副牌墩') for(const [lo,hi] of [[0,0.1],[0.1,0.3],[0.3,0.6],[0.6,1.01]]) row(`  AI 推断末家断门 ${lo}~${hi}`,g.filter(r=>r.pv>=lo&&r.pv<hi));
  row('  台面有分',g.filter(r=>r.pts)); row('  台面 0 分',g.filter(r=>!r.pts));
}
console.log('\n分箱(全部):');
for(let b=0;b<10;b++){ const lo=b/10,hi=(b+1)/10; row(`  [${lo.toFixed(1)},${hi.toFixed(1)})`,R.filter(r=>r.p>=lo&&(b===9?r.p<=hi:r.p<hi))); }
