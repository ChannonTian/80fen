/* 「我这手压下了,能不能活到墩末」(pSurvive)准不准 —— 路线 ③ 第二个小模型(2026-10-01)。
 * pSurvive 里有三个手调常数管「后手肯不肯盖 / 毙」:lastOverW0、trumpSealW(+Pts)、lastRuffWill。这里拿真实结果量它、给拟合出样本。
 *
 *   node test/calib-survive.js <html> [种子数=300]      (OV= 覆盖 AIP;POOL=… 对手一队用池子里的引擎;DUMP=x.json 存特征给 fit-survive.js)
 *
 * 自对弈里,我坐第 2 / 3 家、候选里有压下当前最大的单张时,取「最省的压法」和「最大的压法」两手(相同就一手),
 * 记 AI 估的存活率(pTeamWin,赢墩口径)与特征,再把这一手放上去、其余按 AI(或池子)打完这墩,看本队是否拿下。
 */
'use strict';
const fs=require('fs'),vm=require('vm');
const FILE=process.argv[2]||'80fen-test.html';
const loadAny=f=>{ if(f.endsWith('.js')){ const cx=vm.createContext({window:{}}); vm.runInContext(fs.readFileSync(f,'utf8'),cx); const a=cx.window.__ENGINES; return a[Object.keys(a)[0]]; }
  const sr=[...fs.readFileSync(f,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
  const cc={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};cc.globalThis=cc; vm.createContext(cc); vm.runInContext(sr,cc); return cc.module.exports; };
const E=loadAny(FILE); E.AIP.egSearch=0;
if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV));
const POOL=(process.env.POOL||'').split(',').filter(Boolean).map(loadAny); POOL.forEach(m=>{ if(m.AIP) m.AIP.egSearch=0; });
const N=+process.argv[3]||300;
let aiOf=()=>E;
const finishTrick=(hands,history,plays,leader,seat,cards,trump,declSeat,buried,rand)=>{
  const hs=hands.map(h=>h.slice()); const ps=[...plays,{seat,cards}]; cards.forEach(x=>E.removeCard(hs[seat],x));
  for(let i=ps.length;i<4;i++){ const s=(leader+i)%4, hand=hs[s];
    const v={seat:s,hand,trump,declSeat,history:[...history,...ps],buriedKnown:s===declSeat?buried:[]};
    const lead=E.classify(ps[0].cards,trump); let cs; try{ cs=aiOf(s).aiChooseFollow(v,ps).cards; }catch(e){ cs=null; }
    if(!cs||!E.isLegalFollow(hand,lead,cs,trump)) cs=E.genFollow(hand,lead,trump,rand);
    ps.push({seat:s,cards:cs}); }
  return E.resolveTrick(ps,trump).winner%2===seat%2; };
const R=[];
for(let seed=1;seed<=N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) declSeat=first;
  hands[declSeat].push(...kitty); const buried=E.aiDiscard(hands[declSeat],trump); buried.forEach(x=>E.removeCard(hands[declSeat],x));
  aiOf=s=>POOL.length&&s%2!==seed%2?POOL[seed%POOL.length]:E;
  const rand=E.rng(seed^0x9e3779b9); const history=[]; let leader=declSeat;
  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){ cards=aiOf(seat).aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{
        const lead=E.classify(plays[0].cards,trump); const q=aiOf(seat).aiChooseFollow(view,plays); cards=q.cards;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand);
        if((i===1||i===2)&&aiOf(seat)===E&&lead.type==='single'&&hand.length>1){
          const wins=hand.filter(x=>E.isLegalFollow(hand,lead,[x],trump)&&E.currentWinner([...plays,{seat,cards:[x]}],trump).seat===seat)
                         .sort((a,b)=>E.ordIdx(a,trump)-E.ordIdx(b,trump));
          const pick=wins.length?[...new Set([wins[0],wins[wins.length-1]])]:[];
          if(pick.length){
            const X=E.followCtx(view,plays);
            const opps=X.remainingOpp||[];
            for(const x of pick){
              const p0=E.pTeamWin(X,[x],true);
              const ruff=E.effSuit(x,trump)==='T'&&lead.suit!=='T';
              const tblAfter=E.countPoints(plays.flatMap(p=>p.cards))+E.cardPoints(x);
              const vMax=lead.suit==='T'?0:Math.max(0,...opps.map(s=>X.pVoidOf(s,lead.suit)));
              const lastOpp=opps.includes((leader+3)%4)?1:0;
              const boss=E.isBossPlay(E.classify([x],trump),X.mem,trump)?1:0;
              const y=finishTrick(hands,history,plays,leader,seat,[x],trump,declSeat,buried,E.rng(seed*11+history.length));
              R.push([p0,i===2?1:0,lead.suit==='T'?1:0,ruff?1:0,tblAfter,vMax,lastOpp,boss,E.cardPoints(x)>0?1:0,hand.length>8?1:0,opps.length,y?1:0]);
            }
          }
        }
      }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    history.push(...plays);
    leader=E.resolveTrick(plays,trump).winner;
  }
}
if(process.env.DUMP) fs.writeFileSync(process.env.DUMP,JSON.stringify(R));
const mm=(g,f)=>g.reduce((a,r)=>a+f(r),0)/Math.max(1,g.length);
console.log(`${FILE}${POOL.length?' POOL':''} —— ${N} 副;第 2 / 3 家压下的单张:${R.length} 个样本(估 = pTeamWin 赢墩口径,实 = 打完这墩本队拿下)`);
const row=(t,g)=>{ if(g.length<40) return; console.log(`  ${t.padEnd(26)} n=${String(g.length).padStart(6)}  估 ${(100*mm(g,r=>r[0])).toFixed(0).padStart(3)}%  实 ${(100*mm(g,r=>r[11])).toFixed(0).padStart(3)}%`); };
for(let b=0;b<10;b++) row(`估 [${b/10},${(b+1)/10})`,R.filter(r=>r[0]>=b/10&&(b===9?r[0]<=1:r[0]<(b+1)/10)));
row('第 2 家',R.filter(r=>!r[1])); row('第 3 家',R.filter(r=>r[1]));
row('主牌墩',R.filter(r=>r[2])); row('副牌墩 · 跟本门压',R.filter(r=>!r[2]&&!r[3])); row('副牌墩 · 毙',R.filter(r=>r[3]));
row('台面 0 分',R.filter(r=>r[4]===0)); row('台面有分',R.filter(r=>r[4]>0));
row('这张是钢板',R.filter(r=>r[7])); row('这张不是钢板',R.filter(r=>!r[7]));
