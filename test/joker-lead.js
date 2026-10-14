/* 中盘单领王值不值(2026-10-14,#17 / 产品方原则 7「王留到最后」)。
 *
 *   node test/joker-lead.js [html] [种子数=300]     (OV= 覆盖 AIP)
 *
 * 自对弈里 AI 领出单张王、手里还多于 MINC(默认 8)张时,对「领这张王」和启发式里最好的非王候选各用真 AI 打完(真实牌、搜索关),
 * 比较根方净升级 / 本队得分。差 < 0 = 领王更差。也按庄家 / 帮家 / 闲家、大王 / 小王、手里剩几张分层。
 */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const FILE=process.argv[2]||path.join(__dirname,'..','80fen-test.html'), N=+process.argv[3]||300, S0=+(process.env.SEED0||0), MINC=+(process.env.MINC||8);
const sr=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const cc={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};cc.globalThis=cc; vm.createContext(cc); vm.runInContext(sr,cc);
const E=cc.module.exports; if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV)); E.AIP.egSearch=0;
const cloneH=hs=>hs.map(h=>h.slice());
function playOut(hands,history,plays,leader,trump,declSeat,buried,defPoints){
  hands=cloneH(hands); history=history.slice(); plays=plays.map(p=>({seat:p.seat,cards:p.cards.slice()}));
  plays.forEach(p=>p.cards.forEach(x=>E.removeCard(hands[p.seat],x)));
  let last=null;
  for(;;){
    while(plays.length<4){ const seat=(leader+plays.length)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards; if(!plays.length){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,trump); cards=E.aiChooseFollow(view,plays).cards; if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,E.rng(1)); }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards}); }
    const res=E.resolveTrick(plays,trump); if(res.winner%2!==declSeat%2) defPoints+=res.points;
    last={winner:res.winner,size:plays[0].cards.length}; history.push(...plays); leader=res.winner; plays=[];
    if(!hands.some(h=>h.length)) break; }
  return {defPoints,lastWinner:last.winner,lastLeadSize:last.size};
}
const score=(r,buried,me,D)=>{ const sc=E.scoreRound({defPoints:r.defPoints,kitty:buried,defWonLastTrick:r.lastWinner%2!==D%2,lastLeadSize:r.lastLeadSize});
  return {u:E.levelUtility(sc,me%2,D%2), pts:me%2===D%2?200-sc.total:sc.total, last:r.lastWinner%2===me%2?1:0}; };
const rows=[];
for(let seed=S0+1;seed<=S0+N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,D=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;D=s;}}
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) D=first;
  hands[D].push(...kitty); const buried=E.aiDiscard(hands[D],trump); buried.forEach(x=>E.removeCard(hands[D],x));
  const history=[]; let leader=D, defPoints=0;
  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){ const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat:D,history:[...history,...plays],buriedKnown:seat===D?buried:[]};
      let cards;
      if(i===0){ const q=E.aiChooseLead(view); cards=q.cards;
        if(cards.length===1&&cards[0].suit==='X'&&hand.length>MINC){
          const alt=(q.all||[]).find(c=>!c.cards.some(x=>x.suit==='X'));
          if(alt){ const a=score(playOut(hands,history,[{seat,cards}],seat,trump,D,buried,defPoints),buried,seat,D);
            const b=score(playOut(hands,history,[{seat,cards:alt.cards}],seat,trump,D,buried,defPoints),buried,seat,D);
            rows.push({role:seat===D?'庄家':seat%2===D%2?'帮家':'闲家',big:cards[0].rank===16,n:hand.length,du:a.u-b.u,dp:a.pts-b.pts,dl:a.last-b.last,alt:alt.reason}); } }
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,trump); cards=E.aiChooseFollow(view,plays).cards; if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,E.rng(seed)); }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards}); }
    const res=E.resolveTrick(plays,trump); if(res.winner%2!==D%2) defPoints+=res.points; history.push(...plays); leader=res.winner;
  }
}
if(process.env.DUMP) fs.writeFileSync(process.env.DUMP,JSON.stringify(rows));
const m=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length), se=a=>{const mu=m(a);return Math.sqrt(a.reduce((x,y)=>x+(y-mu)**2,0)/Math.max(1,a.length-1)/Math.max(1,a.length));};
const line=(t,g)=>{ if(!g.length) return; console.log(`  ${t.padEnd(14)} n=${String(g.length).padStart(4)}  领王 − 最好的非王领出:级 ${m(g.map(r=>r.du)).toFixed(3)} ±${se(g.map(r=>r.du)).toFixed(3)}  本队分 ${m(g.map(r=>r.dp)).toFixed(1)} ±${se(g.map(r=>r.dp)).toFixed(1)}  末墩归本队 ${(100*m(g.map(r=>r.dl))).toFixed(0)}pp`); };
console.log(`${FILE} —— ${N} 副,中盘(>${MINC} 张)单领王 ${rows.length} 次(${(rows.length/N).toFixed(2)} 次/副)`);
line('全部',rows); for(const k of ['庄家','帮家','闲家']) line(k,rows.filter(r=>r.role===k)); line('大王',rows.filter(r=>r.big)); line('小王',rows.filter(r=>!r.big));
line('>16 张',rows.filter(r=>r.n>16)); line('13~16 张',rows.filter(r=>r.n>12&&r.n<=16)); line('9~12 张',rows.filter(r=>r.n<=12));
