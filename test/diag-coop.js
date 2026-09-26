/* 庄家钓主、帮家坐第 3 家:接权还是让庄家继续领(任务 #14,DESIGN §7.13 / notes/ai-progress.md)。
 *
 *   node test/diag-coop.js <html> [种子数=600]        (OV= 覆盖 AIP)
 *
 * 产品方描述的配合链:庄家钓主 → 帮家抢权 → 打庄家断门、庄家毙下收割 → 牌权交回庄家。
 * 在 AI 庄家中盘领单张主、帮家(第 3 家,手里 ≥2 张主)出牌的那一刻,分三支各用同一个 AI 打到底:
 *   跟小   —— 手里压不过当前最大的最小一张主(压不过就出最小的)
 *   便宜接 —— 刚好压过当前最大的那张
 *   顶大接 —— 手里最大的主
 * 比较庄家方整局少丢的分与级数;按「当前最大是庄家还是第 2 家」「帮家手里有没有庄家真断门的副牌(可送毙)」分层。
 * 局限同其他反事实:续打是同一个 AI。
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
const N=+process.argv[3]||600;

/* 这一墩已出 plays(领出者 = leader),第 3 家强制出 forced,其余全由 AI 打到底 */
function finish(hands0,history0,plays0,leader,forced,trump,declSeat,buried,defSoFar,rand){
  const hands=hands0.map(h=>h.slice()), history=history0.slice(); let def=defSoFar, lastW=leader, lastSize=1;
  let plays=plays0.slice(), start=plays0.length, first=true;
  while(hands.some(h=>h.length)||plays.length){
    for(let i=start;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(first&&i===start) cards=[hand.find(y=>y.id===forced.id)];
      else if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,trump); cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand); }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    first=false; start=0; history.push(...plays); lastSize=plays[0].cards.length;
    const res=E.resolveTrick(plays,trump); leader=res.winner; lastW=res.winner;
    if(res.winner%2!==declSeat%2) def+=res.points;
    plays=[];
    if(!hands.some(h=>h.length)) break;
  }
  const sc=E.scoreRound({defPoints:def,kitty:buried,defWonLastTrick:lastW%2!==declSeat%2,lastLeadSize:lastSize});
  return {total:sc.total,declUp:sc.defendersWin?-(1+sc.defenderLevelsUp):sc.declarerLevelsUp};
}

const R=[];
for(let seed=1;seed<=N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) declSeat=first;
  hands[declSeat].push(...kitty); const buried=E.aiDiscard(hands[declSeat],trump); buried.forEach(x=>E.removeCard(hands[declSeat],x));
  const partner=(declSeat+2)%4;
  const rand=E.rng(seed^0x9e3779b9); const history=[]; let leader=declSeat, def=0;
  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{
        const lead=E.classify(plays[0].cards,trump); cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand);
        if(i===2&&seat===partner&&leader===declSeat&&hand.length>8&&lead.suit==='T'&&lead.type==='single'){
          const myT=hand.filter(x=>E.effSuit(x,trump)==='T').sort((a,b)=>E.ordIdx(a,trump)-E.ordIdx(b,trump));
          if(myT.length>=2){
            const cur=E.currentWinner(plays,trump);
            const under=myT.filter(x=>E.ordIdx(x,trump)<=cur.cl.top), over=myT.filter(x=>E.ordIdx(x,trump)>cur.cl.top);
            const opts={}; opts['跟小']=under.length?under[0]:myT[0];
            if(over.length){ opts['便宜接']=over[0]; opts['顶大接']=over[over.length-1]; }
            const dVoid=['S','H','D','C'].filter(su=>su!==trump.suit&&!hands[declSeat].some(x=>E.effSuit(x,trump)===su)
                            &&hand.some(x=>E.effSuit(x,trump)===su));
            const vals={}, seen={};
            for(const [k,card] of Object.entries(opts)){
              if(seen[card.id]){ vals[k]=vals[seen[card.id]]; continue; } seen[card.id]=k;
              const r=finish(hands,history,plays,leader,card,trump,declSeat,buried,def,E.rng(seed*13+history.length));
              vals[k]={pts:-r.total,lv:r.declUp};
            }
            const chosen=Object.entries(opts).find(([k,cd])=>cd.id===cards[0].id);
            R.push({vals,ai:chosen?chosen[0]:'其他',curDecl:cur.seat===declSeat,feed:dVoid.length>0,canOver:over.length>0});
          }
        }
      }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    history.push(...plays);
    const res=E.resolveTrick(plays,trump); leader=res.winner; if(res.winner%2!==declSeat%2) def+=res.points;
  }
}
const mm=(g,f)=>g.reduce((a,r)=>a+f(r),0)/Math.max(1,g.length);
const se=(g,f)=>{ const mu=mm(g,f); return Math.sqrt(g.reduce((a,r)=>a+(f(r)-mu)**2,0)/Math.max(1,g.length-1)/Math.max(1,g.length)); };
console.log(`${FILE}${process.env.OV?' OV='+process.env.OV:''} —— ${N} 副;AI 庄家中盘钓主(单张主),帮家坐第 3 家、手里 ≥2 张主`);
console.log('(数值 = 相对「跟小」的庄家方整局收益:分 = 少丢的闲家分,级 = 庄家方级数)\n');
const show=(lbl,g)=>{ g=g.filter(r=>r.canOver); if(g.length<15) return;
  const ai={}; g.forEach(r=>ai[r.ai]=(ai[r.ai]||0)+1);
  console.log(`${lbl.padEnd(34)} n=${String(g.length).padStart(4)}  AI 选:${Object.entries(ai).map(([k,v])=>k+' '+Math.round(100*v/g.length)+'%').join(' ')}`);
  for(const k of ['便宜接','顶大接']){ const d=r=>r.vals[k].pts-r.vals['跟小'].pts, dl=r=>r.vals[k].lv-r.vals['跟小'].lv;
    console.log(`     ${k} vs 跟小:分 ${mm(g,d).toFixed(1).padStart(5)} ±${se(g,d).toFixed(1)}   级 ${mm(g,dl).toFixed(3).padStart(6)} ±${se(g,dl).toFixed(3)}`); }
};
show('全部',R);
show('当前最大是庄家(帮家要压过队友)',R.filter(r=>r.curDecl));
show('当前最大是第 2 家(对手压过了庄家)',R.filter(r=>!r.curDecl));
show('帮家有庄家真断门的副牌(可送毙)',R.filter(r=>r.feed));
show('帮家没有可送毙的副牌',R.filter(r=>!r.feed));
show('庄家暂大 · 可送毙',R.filter(r=>r.curDecl&&r.feed));
show('庄家暂大 · 不可送毙',R.filter(r=>r.curDecl&&!r.feed));
