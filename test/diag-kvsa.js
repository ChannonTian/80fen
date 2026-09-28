/* 接钓主:出 K 还是出 A(产品方,2026-09-28):
 * 「外面还剩两大王、两小王,以及一 A、一 K 不在自己手里,手里有一 K,这时候应该会不出 K。」
 *   末家有 A → 出 K 被 A 收走;末家无 A 有小王 → 被小王收走、小王提前兑现;
 *   只有末家只剩这一张 K 必须跟时,出 K 才是赚的 —— 概率极低。
 *
 *   node test/diag-kvsa.js <html> [种子数=3000]        (OV= 覆盖 AIP;JOK=最少在外几张王,默认 1)
 *
 * 自对弈(收官搜索关)里,中盘时让领出者用最小的非王主钓主(模拟人,同 audit-third 的 FORCE),
 * 我坐第 3 家、手里有主 A 和主 K(非级数牌)、另一张主 A 和主 K 都在外、在外还有 ≥JOK 张王、末家是对手时记一个局面。
 * 记 AI 实际出的是 K / A / 别的;再分别强制出 K、出 A,同一个 AI 打到底比较本队整局得失分与级数。
 * 另按末家实际手牌分 ①~⑥(同产品方的拆法)看出 K 的这一墩结果。
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
const N=+process.argv[3]||3000, JOK=+(process.env.JOK||1), S0=+(process.env.SEED0||0);

function run(hands0,history0,leader,plays0,forced,trump,declSeat,buried,defSoFar,rand,log){
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
    if(log&&t===0){ log.winner=res.winner; log.points=res.points; log.last=plays[3].cards; }
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
  const rand=E.rng(seed^0x9e3779b9); const history=[]; let leader=declSeat, def=0, forced=0;
  const isA=x=>x.suit===trump.suit&&x.rank===14, isK=x=>x.suit===trump.suit&&x.rank===13;
  while(hands.some(h=>h.length)){
    const plays=[]; let forcedLead=false;
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){
        cards=E.aiChooseLead(view).cards;
        if(hand.length>8&&forced<3){
          const low=hand.filter(x=>E.effSuit(x,trump)==='T'&&x.suit!=='X'&&x.rank!==trump.rank&&x.rank<10)
                        .sort((a,b)=>E.ordIdx(a,trump)-E.ordIdx(b,trump))[0];
          if(low){ cards=[low]; forced++; forcedLead=true; }
        }
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced;
      }else{
        const lead=E.classify(plays[0].cards,trump); const r=E.aiChooseFollow(view,plays); cards=r.cards;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand);
        if(i===2&&forcedLead&&hand.length>8){
          const myA=hand.find(isA), myK=hand.find(isK);
          const last=(seat+1)%4, others=[0,1,2,3].filter(s=>s!==seat);
          const outA=others.some(s=>hands[s].some(isA))||buried.some(isA);
          const outK=others.some(s=>hands[s].some(isK))||buried.some(isK);
          const jok=others.reduce((n,s)=>n+hands[s].filter(x=>x.suit==='X').length,0)+buried.filter(x=>x.suit==='X').length;
          const cur=E.currentWinner(plays,trump);
          if(myA&&myK&&outA&&outK&&jok>=JOK&&cur.seat===plays[0].seat){
            const lh=hands[last], team=seat%2, sign=team===declSeat%2?-1:1, lvSign=team===declSeat%2?1:-1;
            const lA=lh.some(isA), lK=lh.some(isK), lJ=lh.some(x=>x.suit==='X');
            const lT=lh.filter(x=>E.effSuit(x,trump)==='T').length;
            const cat=lA&&lK?'① 末家 A、K 都有':lA?'② 末家有 A、没 K':lJ?(lK?'③ 末家没 A、有王、有 K':'④ 末家没 A、有王、没 K')
                     :(lK?(lT===1?'⑤′ 末家只剩这一张主 K':'⑤ 末家没 A 没王、有 K'):'⑥ 末家 A、王、K 都没有');
            const rng=()=>E.rng(seed*31+history.length);
            const logK={}, logA={};
            const vK=run(hands,history,leader,plays,myK,trump,declSeat,buried,def,rng(),logK);
            const vA=run(hands,history,leader,plays,myA,trump,declSeat,buried,def,rng(),logA);
            R.push({cat,ai:cards[0].id===myK.id?'K':cards[0].id===myA.id?'A':'别的',
              dPts:sign*(vA.total-vK.total), dLv:lvSign*(vA.declUp-vK.declUp),
              kWon:logK.winner%2===team, kPts:(logK.winner%2===team?1:-1)*logK.points,
              aWon:logA.winner%2===team, aPts:(logA.winner%2===team?1:-1)*logA.points});
          }
        }
      }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    history.push(...plays);
    const res=E.resolveTrick(plays,trump); leader=res.winner; if(res.winner%2!==declSeat%2) def+=res.points;
  }
}
if(process.env.DUMP) fs.writeFileSync(process.env.DUMP,JSON.stringify(R));
const mm=(g,f)=>g.reduce((a,r)=>a+f(r),0)/Math.max(1,g.length);
const se=(g,f)=>{ const mu=mm(g,f); return Math.sqrt(g.reduce((a,r)=>a+(f(r)-mu)**2,0)/Math.max(1,g.length-1)/Math.max(1,g.length)); };
console.log(`${FILE}${process.env.OV?' OV='+process.env.OV:''} —— ${N} 副;队友钓小主、我第 3 家握主 A+主 K、另一张 A/K 在外、在外 ≥${JOK} 张王:${R.length} 个局面`);
const ai={}; R.forEach(r=>ai[r.ai]=(ai[r.ai]||0)+1);
console.log('AI 实际出:'+Object.entries(ai).map(([k,v])=>`${k} ${(100*v/R.length).toFixed(0)}%`).join('  '));
console.log(`出 A 相对出 K(正 = 出 A 好):整局分 ${mm(R,r=>r.dPts).toFixed(1)} ±${se(R,r=>r.dPts).toFixed(1)}  级 ${mm(R,r=>r.dLv).toFixed(3)} ±${se(R,r=>r.dLv).toFixed(3)}`);
console.log('\n按末家实际手牌:                       占比   出K这墩本队拿下  出K这墩得分  出A这墩本队拿下  出A这墩得分   整局 出A−出K');
const cats=[...new Set(R.map(r=>r.cat))].sort();
for(const k of cats){ const g=R.filter(r=>r.cat===k);
  console.log(`  ${k.padEnd(20)} ${(100*g.length/R.length).toFixed(0).padStart(4)}%   ${(100*mm(g,r=>r.kWon)).toFixed(0).padStart(5)}%   ${mm(g,r=>r.kPts).toFixed(1).padStart(8)}   ${(100*mm(g,r=>r.aWon)).toFixed(0).padStart(5)}%   ${mm(g,r=>r.aPts).toFixed(1).padStart(8)}   ${mm(g,r=>r.dPts).toFixed(1).padStart(6)} 分`); }
