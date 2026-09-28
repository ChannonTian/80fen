/* 从自对弈里捞「队友钓小主、我坐第 3 家、手握主 A + 主 K」的真实局面,冻成场景用(场景 2b / 2b′)。
 *
 *   node test/find-tiao.js <html> [种子数=3000]      (KIND=2b | 2b1;BIG=n 放宽 2b:在外王/级牌 ≤n 张;SEED0= 起始种子;OUT=x.json 存下局面)
 *
 * 2b  :王和级数牌都已出完,在外能压过主 K 的只剩另一张主 A(我这张 A 已是钢板,另一张 K 在不在外都算)。
 * 2b1 :在外还有 ≥2 张王、另一张主 A 和主 K 都在外(产品方 2026-09-28 的设想)。
 * 领出者的队友(第 3 家)一满足条件,就让领出者用最小的非王主钓主(模拟人,同 diag-kvsa);收官搜索关。每副最多记一个。
 * 每个局面记下完整的出牌历史(牌数天然自洽)、AI 的选择,以及强制出 A / 出 K 各自打到底的本队得失。
 */
'use strict';
const fs=require('fs'),vm=require('vm');
const FILE=process.argv[2]||'80fen-test.html';
const src=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c;
vm.createContext(c);vm.runInContext(src,c);
const E=c.module.exports;
E.AIP.egSearch=0;
const N=+process.argv[3]||3000, S0=+(process.env.SEED0||0), KIND=process.env.KIND||'2b';

function run(hands0,history0,leader,plays0,forced,trump,declSeat,buried,defSoFar,rand){
  const hands=hands0.map(h=>h.slice()), history=history0.slice();
  let def=defSoFar, lastW=leader, lastSize=1, t=0, plays=plays0.slice();
  while(true){
    for(let i=plays.length;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(t===0&&i===2) cards=[hand.find(y=>y.id===forced.id)];
      else if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,trump); cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand); }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    history.push(...plays); lastSize=plays[0].cards.length;
    const res=E.resolveTrick(plays,trump);
    leader=res.winner; lastW=res.winner; if(res.winner%2!==declSeat%2) def+=res.points;
    plays=[]; t++;
    if(!hands.some(h=>h.length)) break;
  }
  const sc=E.scoreRound({defPoints:def,kitty:buried,defWonLastTrick:lastW%2!==declSeat%2,lastLeadSize:lastSize});
  return {total:sc.total,declUp:sc.defendersWin?-(1+sc.defenderLevelsUp):sc.declarerLevelsUp};
}

const R=[];
for(let seed=S0+1;seed<=S0+N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best||!trump.suit) continue;
  hands[declSeat].push(...kitty); const buried=E.aiDiscard(hands[declSeat],trump); buried.forEach(x=>E.removeCard(hands[declSeat],x));
  const rand=E.rng(seed^0x9e3779b9); const history=[]; let leader=declSeat, def=0, forced=0, got=false;
  const isA=x=>x.suit===trump.suit&&x.rank===14, isK=x=>x.suit===trump.suit&&x.rank===13;
  const bigger=x=>x.suit==='X'||x.rank===trump.rank;                 // 王、级数牌:压得过主 A
  while(hands.some(h=>h.length)){
    const plays=[]; let forcedLead=false;
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){
        cards=E.aiChooseLead(view).cards;
        const pp=(seat+2)%4, ph=hands[pp];
        const pUnseen=[0,1,2,3].filter(s=>s!==pp).flatMap(s=>hands[s]).concat(pp===declSeat?[]:buried);
        const want=ph.some(isA)&&ph.some(isK)&&pUnseen.some(isA)&&(pp+1)%4%2!==pp%2&&(KIND==='2b'
          ?pUnseen.filter(bigger).length<=+(process.env.BIG||0)
          :pUnseen.filter(x=>x.suit==='X').length>=2&&pUnseen.some(isK));
        if(!got&&want&&hand.length>2){
          const low=hand.filter(x=>E.effSuit(x,trump)==='T'&&x.suit!=='X'&&x.rank!==trump.rank&&x.rank<10)
                        .sort((a,b)=>E.ordIdx(a,trump)-E.ordIdx(b,trump))[0];
          if(low){ cards=[low]; forced++; forcedLead=true; }
        }
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced;
      }else{
        const lead=E.classify(plays[0].cards,trump); const r=E.aiChooseFollow(view,plays); cards=r.cards;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand);
        if(i===2&&forcedLead&&!got&&lead.type==='single'){
          const myA=hand.find(isA), myK=hand.find(isK);
          const unseen=[0,1,2,3].filter(s=>s!==seat).flatMap(s=>hands[s]).concat(seat===declSeat?[]:buried);
          const cur=E.currentWinner(plays,trump);
          const outBig=unseen.filter(bigger).length, outJ=unseen.filter(x=>x.suit==='X').length;
          const outA=unseen.some(isA), outK=unseen.some(isK);
          const ok=myA&&myK&&outA&&cur.seat===plays[0].seat;
          const lastOpp=((seat+1)%4)%2!==seat%2;
          const hit=KIND==='2b'?(ok&&lastOpp&&outBig<=+(process.env.BIG||0)):(ok&&lastOpp&&outJ>=2&&outK);
          if(hit){
            got=true;
            const team=seat%2, sign=team===declSeat%2?-1:1, lvSign=team===declSeat%2?1:-1;
            const rr=()=>E.rng(seed*31+history.length);
            const vA=run(hands,history,leader,plays,myA,trump,declSeat,buried,def,rr());
            const vK=run(hands,history,leader,plays,myK,trump,declSeat,buried,def,rr());
            const last=(seat+1)%4;
            R.push({seed,seat,declSeat,trump,history:history.map(p=>({seat:p.seat,cards:p.cards})),plays:plays.slice(),
              hand:hand.slice(),reason:r.reason,
              aiIs:cards[0].id===myA.id?'A':cards[0].id===myK.id?'K':'别的',
              lastHasA:hands[last].some(isA),kittyA:buried.some(isA),
              dPts:sign*(vA.total-vK.total), dLv:lvSign*(vA.declUp-vK.declUp),
              nHand:hand.length,defSoFar:def,outBig});
          }
        }
      }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    history.push(...plays);
    const res=E.resolveTrick(plays,trump); leader=res.winner; if(res.winner%2!==declSeat%2) def+=res.points;
  }
}
if(process.env.OUT) fs.writeFileSync(process.env.OUT,JSON.stringify(R));
const mm=(g,f)=>g.reduce((a,r)=>a+f(r),0)/Math.max(1,g.length);
console.log(`${FILE} KIND=${KIND} —— ${N} 副:${R.length} 个局面`);
const ai={}; R.forEach(r=>ai[r.aiIs]=(ai[r.aiIs]||0)+1);
console.log('AI 实际出:'+Object.entries(ai).map(([k,v])=>`${k} ${v}`).join('  ')+`   出 A − 出 K:分 ${mm(R,r=>r.dPts).toFixed(1)}  级 ${mm(R,r=>r.dLv).toFixed(2)}`);
for(const r of R) console.log(`  seed ${r.seed} 座${r.seat} 庄${r.declSeat} 主${r.trump.suit} 手${r.nHand} 在外王/级牌${r.outBig} AI 出${r.aiIs}(${r.reason})  末家有A ${r.lastHasA}  A−K ${r.dPts} 分 ${r.dLv} 级`);
