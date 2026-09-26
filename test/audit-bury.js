/* 埋底与最后一墩:庄家埋底时估的「我方拿下最后一墩」的概率准不准,埋了多少分,最后丢了多少。
 *
 *   node test/audit-bury.js <html> [种子数=300]        (OV= 覆盖 AIP,EG=1 开收官搜索)
 *
 * 起因(产品方,2026-09-25):「庄家对(守住最后一墩的)概率没信心时几乎必定保守拆开、
 * 或埋底时干脆 0 分,否则底分倍数打穿很不划算。」aiDiscard 里把分埋进底的代价是
 * `分 × 2 ×(1 − pWinLastTrick)`,pWinLastTrick 只看主牌张数和王 —— 先量它准不准。
 *
 * 报:按 pWinLastTrick 分箱的实际守住率;按埋底分数分档的丢底率与每局被抠走的分;
 * 以及「庄家本人 / 帮家」谁赢的最后一墩。
 */
'use strict';
const fs=require('fs'),vm=require('vm');
const FILE=process.argv[2]||'80fen-test.html';
const src=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c;
vm.createContext(c);vm.runInContext(src,c);
const E=c.module.exports;
if(process.env.EG!=='1') E.AIP.egSearch=0;
if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV));
const N=+process.argv[3]||300, S0=+(process.env.SEED0||0);
const recs=[];
for(let seed=S0+1;seed<=S0+N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) declSeat=first;
  hands[declSeat].push(...kitty);
  const pLast=c.pWinLastTrick(hands[declSeat],trump);
  const buried=E.aiDiscard(hands[declSeat],trump); buried.forEach(x=>E.removeCard(hands[declSeat],x));
  const kitPts=E.countPoints(buried), kitInPts=E.countPoints(kitty);
  const rand=E.rng(seed^0x9e3779b9); const history=[]; let leader=declSeat, last=null, lastSize=1;
  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,trump); cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand); }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    history.push(...plays); lastSize=plays[0].cards.length;
    const res=E.resolveTrick(plays,trump); leader=res.winner; last=res.winner;
  }
  const held=last%2===declSeat%2;
  recs.push({pLast,kitPts,kitInPts,held,byDecl:last===declSeat,lost:held?0:kitPts*E.RULES.kittyMultiplier(lastSize)});
}
const m=(g,f)=>g.reduce((s,r)=>s+f(r),0)/Math.max(1,g.length);
console.log(`${FILE}${process.env.OV?' OV='+process.env.OV:''} —— ${N} 副`);
console.log(`庄家方守住最后一墩 ${(100*m(recs,r=>r.held)).toFixed(1)}%(其中庄家本人 ${(100*m(recs,r=>r.byDecl)).toFixed(1)}%);`
  +`平均埋 ${m(recs,r=>r.kitPts).toFixed(1)} 分(原底 ${m(recs,r=>r.kitInPts).toFixed(1)} 分);每局被抠走 ${m(recs,r=>r.lost).toFixed(2)} 分`);
console.log('\n—— pWinLastTrick 校准(埋底时的估计 vs 实际守住率)——');
for(let b=0;b<10;b++){ const lo=b/10,hi=(b+1)/10; const g=recs.filter(r=>r.pLast>=lo&&(b===9?r.pLast<=hi:r.pLast<hi)); if(g.length<10) continue;
  console.log(`  [${lo.toFixed(1)},${hi.toFixed(1)})  n=${String(g.length).padStart(4)}  估 ${(100*m(g,r=>r.pLast)).toFixed(0).padStart(3)}%  实际 ${(100*m(g,r=>r.held)).toFixed(0).padStart(3)}%  埋 ${m(g,r=>r.kitPts).toFixed(1).padStart(5)} 分  被抠 ${m(g,r=>r.lost).toFixed(2).padStart(5)} 分/局`); }
console.log('\n—— 按埋底分数 ——');
for(const [lo,hi] of [[0,0],[5,10],[15,20],[25,200]]){ const g=recs.filter(r=>r.kitPts>=lo&&r.kitPts<=hi); if(!g.length) continue;
  console.log(`  埋 ${String(lo).padStart(2)}~${String(hi).padEnd(3)} 分  n=${String(g.length).padStart(4)}(${(100*g.length/recs.length).toFixed(0)}%)  估守住 ${(100*m(g,r=>r.pLast)).toFixed(0)}%  实际 ${(100*m(g,r=>r.held)).toFixed(0)}%  被抠 ${m(g,r=>r.lost).toFixed(2)} 分/局`); }
