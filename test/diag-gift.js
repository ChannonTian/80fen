/* 「首选本身白送分」(教练线 v0.7.36 记给 AI 线,ai-progress 第 10 项):
 * 跟牌时 AI 的首选带分、出完这墩当前归对手,而手里有合法又不带分(也不动主 / 不动更大的本门牌)的跟法。
 *
 *   node test/diag-gift.js <html> [种子数=300]       (OV= 覆盖 AIP;EG=1 开收官搜索)
 *
 * 按「第几家」「队友还没出(后面能救)/ 已出」「这一门我还剩几张分牌」分层;
 * 每个局面把首选和「不带分的替代」各自按 AI 把这一墩打完,记这墩最后归谁、本队得失分;
 * 再各自打到底,比本队整局得失分与级数(续打是同一个 AI,局限见 DESIGN §7.11)。
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
const N=+process.argv[3]||300;

// 不带分的替代:单张墩 —— 同门里比首选小的 0 分牌;断门时一张 0 分副牌(不拆主)
function zeroAlt(hand,lead,cards,T){
  if(lead.cards.length!==1||cards.length!==1) return null;
  const x=cards[0], inSuit=c=>E.effSuit(c,T)===lead.suit;
  // 与教练线 audit-coach-text 的 cheapZeroAlt 同口径:同门里不比首选大的 0 分牌;断门时 0 分、10 以下的副牌(不动 A/K/Q/J、不拆主)
  const pool=hand.filter(c=>c.id!==x.id&&E.cardPoints(c)===0&&(inSuit(x)?inSuit(c)&&E.ordIdx(c,T)<=E.ordIdx(x,T)
                                                                  :E.effSuit(c,T)!=='T'&&!inSuit(c)&&c.rank<=10));
  if(!pool.length) return null;
  pool.sort((a,b)=>E.ordIdx(a,T)-E.ordIdx(b,T));
  const alt=[pool[0]];
  return E.isLegalFollow(hand,lead,alt,T)?alt:null;
}
function play(hands0,history0,leader,plays0,seat,forced,trump,declSeat,buried,defSoFar,rand,log){
  const hands=hands0.map(h=>h.slice()), history=history0.slice();
  let def=defSoFar, lastW=leader, lastSize=1, first=true, plays=plays0.slice();
  while(true){
    for(let i=plays.length;i<4;i++){
      const s=(leader+i)%4, hand=hands[s];
      const view={seat:s,hand,trump,declSeat,history:[...history,...plays],buriedKnown:s===declSeat?buried:[]};
      let cards;
      if(first&&s===seat) cards=forced.map(x=>hand.find(y=>y.id===x.id));
      else if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,s,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,trump); cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand); }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat:s,cards});
    }
    history.push(...plays); lastSize=plays[0].cards.length;
    const res=E.resolveTrick(plays,trump);
    if(first&&log){ log.won=res.winner%2===seat%2; log.pts=(log.won?1:-1)*res.points; }
    first=false; leader=res.winner; lastW=res.winner; if(res.winner%2!==declSeat%2) def+=res.points;
    plays=[]; if(!hands.some(h=>h.length)) break;
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
  const rand=E.rng(seed^0x9e3779b9); const history=[]; let leader=declSeat, def=0;
  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards, reason='';
      if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{
        const lead=E.classify(plays[0].cards,trump); const q=E.aiChooseFollow(view,plays); cards=q.cards; reason=q.reason||'';
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand);
        const after=E.currentWinner([...plays,{seat,cards}],trump);
        const alt=E.countPoints(cards)>0&&after.seat%2!==seat%2&&hand.length>1?zeroAlt(hand,lead,cards,trump):null;
        if(alt){
          const team=seat%2, sign=team===declSeat%2?-1:1, lvSign=team===declSeat%2?1:-1;
          const partnerLater=i<2&&true, rr=()=>E.rng(seed*13+history.length);
          const la={}, lb={};
          const a=play(hands,history,leader,plays,seat,cards,trump,declSeat,buried,def,rr(),la);
          const b=play(hands,history,leader,plays,seat,alt,trump,declSeat,buried,def,rr(),lb);
          const suitPts=hand.filter(x=>E.effSuit(x,trump)===E.effSuit(cards[0],trump)&&E.cardPoints(x)>0).length;
          R.push({pos:`第${i+1}家${i<2?'(队友在后)':i===2?'(末家是对手)':'(末家)'}`,void:E.effSuit(cards[0],trump)!==lead.suit,
            reason:reason.replace(/\(.*$/,'').slice(0,24),pts:E.countPoints(cards),suitPts,
            ex:`领 ${plays.map(p=>p.cards.map(E.cardName||(x=>x.suit+x.rank)).join('')).join(' ')} → 出 ${cards.map(x=>x.suit+x.rank).join('')}(替代 ${alt.map(x=>x.suit+x.rank).join('')});手里 ${hand.map(x=>x.suit+x.rank).join(' ')};理由 ${reason.slice(0,30)}`,
            wa:la.won,pa:la.pts,wb:lb.won,pb:lb.pts,dPts:sign*(a.total-b.total),dLv:lvSign*(a.declUp-b.declUp)});
        }
      }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    history.push(...plays);
    const res=E.resolveTrick(plays,trump); leader=res.winner; if(res.winner%2!==declSeat%2) def+=res.points;
  }
}
const mm=(g,f)=>g.reduce((a,r)=>a+f(r),0)/Math.max(1,g.length);
const se=(g,f)=>{const m=mm(g,f);return Math.sqrt(g.reduce((a,r)=>a+(f(r)-m)**2,0)/Math.max(1,g.length-1)/Math.max(1,g.length));};
console.log(`${FILE}${process.env.OV?' OV='+process.env.OV:''} —— ${N} 副;跟牌首选带分、出完当前归对手、手里有不带分的替代:${R.length} 次(${(R.length/N).toFixed(2)} 次/局)`);
console.log('(本队视角;「整局」= 首选 − 替代,正 = 首选好)');
const show=(t,g)=>{ if(g.length<8) return;
  console.log(`  ${t.padEnd(22)} n=${String(g.length).padStart(4)}  这墩本队拿下 首选 ${(100*mm(g,r=>r.wa)).toFixed(0)}% / 替代 ${(100*mm(g,r=>r.wb)).toFixed(0)}%  这墩得失 ${mm(g,r=>r.pa).toFixed(1)} / ${mm(g,r=>r.pb).toFixed(1)}   整局 ${mm(g,r=>r.dPts).toFixed(1)} ±${se(g,r=>r.dPts).toFixed(1)} 分、${mm(g,r=>r.dLv).toFixed(3)} ±${se(g,r=>r.dLv).toFixed(3)} 级`); };
show('全部',R);
for(const p of [...new Set(R.map(r=>r.pos))].sort()) show(p,R.filter(r=>r.pos===p));
show('断门垫分',R.filter(r=>r.void)); show('跟本门',R.filter(r=>!r.void));
show('这门只剩这一张分牌',R.filter(r=>r.suitPts===1)); show('这门还有别的分牌',R.filter(r=>r.suitPts>1));
if(process.env.EX) R.filter(r=>r.pos.startsWith(process.env.EX)).slice(0,6).forEach(r=>console.log('   例:'+r.ex));
const rs={}; R.forEach(r=>rs[r.reason]=(rs[r.reason]||0)+1);
console.log('首选的理由:'+Object.entries(rs).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>`${v} ${k}`).join(' | '));
