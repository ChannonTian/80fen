/* 收官搜索为什么好 / 不好:把误差拆开量(2026-10-14,产品方「根因是什么」)。
 *
 *   node test/eg-rootcause.js [html=80fen-test.html] [种子数=60] [张数=4,8,12]
 *
 * 自对弈走到「我领出、手里剩 n 张」的局面,取启发式的前 6 个领出候选,对每个候选算四个值(都是根方「净升几级」):
 *   真值   oracle   —— 真实牌、之后四家都用真正的 AI(搜索关)打完。这就是 ai-h2h 里那一手的实际价值。
 *   便宜推演·真牌 —— 真实牌、之后用搜索里的便宜推演策略(rolloutLead / rolloutFollow)打完:只含「推演策略」误差。
 *   搜索估计       —— endgameSearch 原样(抽样世界 + 便宜推演,n=12 时 20 个世界):推演误差 + 抽样误差 + 样本噪声。
 * 再看各种「挑法」的后悔值(真值最优 − 所挑那手的真值):启发式、搜索最高、搜索 + egMargin 0.03、搜索 + egZ 2、便宜推演·真牌最高。
 */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const FILE=process.argv[2]||path.join(__dirname,'..','80fen-test.html');
const N=+process.argv[3]||60, NS=(process.argv[4]||'4,8,12').split(',').map(Number);
const sr=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const cc={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};cc.globalThis=cc; vm.createContext(cc); vm.runInContext(sr,cc);
const E=cc.module.exports, A=E.AIP;
if(process.env.OV) Object.assign(A,JSON.parse(process.env.OV));
const EGON=A.egSearch; A.egSearch=0;
const cloneH=hs=>hs.map(h=>h.slice());
// 从「plays 已出、轮到 seat」继续,全用真 AI 打完;返回 {defPoints,lastWinner,lastLeadSize}
function playOutAI(hands,history,plays,leader,trump,declSeat,buried,defPoints){
  hands=cloneH(hands); history=history.slice(); plays=plays.map(p=>({seat:p.seat,cards:p.cards.slice()}));
  plays.forEach(p=>p.cards.forEach(x=>E.removeCard(hands[p.seat],x)));
  let last=null;
  for(;;){
    while(plays.length<4){
      const seat=(leader+plays.length)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(!plays.length){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,trump); cards=E.aiChooseFollow(view,plays).cards; if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,E.rng(1)); }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    const res=E.resolveTrick(plays,trump); if(res.winner%2!==declSeat%2) defPoints+=res.points;
    last={winner:res.winner,size:plays[0].cards.length}; history.push(...plays); leader=res.winner; plays=[];
    if(!hands.some(h=>h.length)) break;
  }
  return {defPoints,lastWinner:last.winner,lastLeadSize:last.size};
}
const util=(r,kitty,me,declSeat)=>E.levelUtility(E.scoreRound({defPoints:r.defPoints,kitty,defWonLastTrick:r.lastWinner%2!==declSeat%2,lastLeadSize:r.lastLeadSize}),me%2,declSeat%2);
const R={}; NS.forEach(n=>R[n]=[]);
const S0=+(process.env.SEED0||0);
for(let seed=S0+1;seed<=S0+N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) declSeat=first;
  hands[declSeat].push(...kitty); const buried=E.aiDiscard(hands[declSeat],trump); buried.forEach(x=>E.removeCard(hands[declSeat],x));
  const history=[]; let leader=declSeat, defPoints=0; const done=new Set();
  while(hands.some(h=>h.length)){
    const n=hands[leader].length;
    if(NS.includes(n)&&!done.has(n)){
      done.add(n);
      const seat=leader, view={seat,hand:hands[seat],trump,declSeat,history:history.slice(),buriedKnown:seat===declSeat?buried:[]};
      const q=E.aiChooseLead(view); const cands=(q.all||[]).slice(0,A.egMaxCands);
      if(cands.length>=2){
        const heurIdx=cands.findIndex(c=>c.cards===q.cards);
        const orc=cands.map(c=>util(playOutAI(hands,history,[{seat,cards:c.cards}],seat,trump,declSeat,buried,defPoints),buried,seat,declSeat));
        const mem=E.makeMemory(view);
        const cheap=cands.map(c=>{ const hs=cloneH(hands); c.cards.forEach(x=>E.removeCard(hs[seat],x));
          const r=E.rolloutToEnd({hands:hs,plays:[{seat,cards:c.cards}],leader:seat,defPoints,trump,declSeat,mem,rand:E.rng(seed*7+n)});
          return util(r,buried,seat,declSeat); });
        A.egSearch=EGON; const eg=E.endgameSearch(view,null,cands); A.egSearch=0;
        if(eg){
          const ests=eg.map(o=>o.u);
          const pickOv=z=>{ const s0=A.egZ; A.egZ=z; const t=E.egOverride(eg,eg[heurIdx]); A.egZ=s0; return t?eg.indexOf(t):heurIdx; };
          R[n].push({orc,cheap,ests,heur:heurIdx,ov0:pickOv(0),ov2:pickOv(2),samples:eg.samples});
        }
      }
    }
    const plays=[];
    for(let i=0;i<4;i++){ const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards; if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,trump); cards=E.aiChooseFollow(view,plays).cards; if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,E.rng(seed)); }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards}); }
    const res=E.resolveTrick(plays,trump); if(res.winner%2!==declSeat%2) defPoints+=res.points; history.push(...plays); leader=res.winner;
  }
}
if(process.env.DUMP) fs.writeFileSync(process.env.DUMP,JSON.stringify(R));
const am=a=>a.indexOf(Math.max(...a));
const corr=(x,y)=>{ const n=x.length,mx=x.reduce((a,b)=>a+b)/n,my=y.reduce((a,b)=>a+b)/n; let sxy=0,sx=0,sy=0; for(let i=0;i<n;i++){sxy+=(x[i]-mx)*(y[i]-my);sx+=(x[i]-mx)**2;sy+=(y[i]-my)**2;} return sx&&sy?sxy/Math.sqrt(sx*sy):NaN; };
console.log(`${FILE} —— ${N} 副自对弈,领出局面;后悔值 = 真值最优 − 所挑那手的真值(级,越小越好)`);
for(const n of NS){ const rs=R[n]; if(!rs.length) continue;
  const reg=f=>rs.reduce((a,r)=>a+Math.max(...r.orc)-r.orc[f(r)],0)/rs.length;
  // 候选之间的相对差:每个局面内去均值再算相关,只看「排序」好不好
  const cx=[],cy=[],ex=[],ey=[];
  for(const r of rs){ const mo=r.orc.reduce((a,b)=>a+b)/r.orc.length, mc=r.cheap.reduce((a,b)=>a+b)/r.cheap.length, me=r.ests.reduce((a,b)=>a+b)/r.ests.length;
    r.orc.forEach((v,i)=>{ cx.push(v-mo); cy.push(r.cheap[i]-mc); ex.push(v-mo); ey.push(r.ests[i]-me); }); }
  const spread=rs.reduce((a,r)=>a+Math.max(...r.orc)-Math.min(...r.orc),0)/rs.length;
  console.log(`\n剩 ${n} 张:${rs.length} 个局面,候选真值的平均极差 ${spread.toFixed(3)} 级,搜索平均 ${(rs.reduce((a,r)=>a+r.samples,0)/rs.length).toFixed(0)} 个世界`);
  console.log(`  后悔值  启发式 ${reg(r=>r.heur).toFixed(3)}   搜索最高 ${reg(r=>am(r.ests)).toFixed(3)}   搜索+0.03 门槛 ${reg(r=>r.ov0).toFixed(3)}   搜索+egZ2 ${reg(r=>r.ov2).toFixed(3)}   便宜推演·真牌最高 ${reg(r=>am(r.cheap)).toFixed(3)}   真值最优 0`);
  console.log(`  排序相关(局面内去均值)  便宜推演·真牌 vs 真值 ${corr(cx,cy).toFixed(2)}   搜索估计 vs 真值 ${corr(ex,ey).toFixed(2)}`);
  console.log(`  改判率  +0.03 门槛 ${(100*rs.filter(r=>r.ov0!==r.heur).length/rs.length).toFixed(0)}%   egZ2 ${(100*rs.filter(r=>r.ov2!==r.heur).length/rs.length).toFixed(0)}%`);
}
