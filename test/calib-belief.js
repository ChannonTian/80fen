/* 信念服务对照(belief-plan ①,2026-10-24):「我这张压下去,能不能活到墩末」—— 现在的 pSurvive vs 约束抽样版 pSurviveBelief vs 实际。
 *
 *   node test/calib-belief.js [html] [种子数=300]      (SEED0=;M= 世界数;DUMP=x.json)
 *
 * 自对弈(搜索关)。第 2 / 3 家、单张领出、候选里有压过当前最大的单张时,取「最省的」和「最大的」压法,
 * 记两种估计和实际(把这一手放上去、其余按 AI 打完这墩,我这张是否赢墩)。意愿常数两边相同,差别只在「谁手里有什么」。
 * 同时记 makeBelief 的用时。
 */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const FILE=process.argv[2]||path.join(__dirname,'..','80fen-test.html'), N=+process.argv[3]||300, S0=+(process.env.SEED0||0), M=+(process.env.M||60);
const sr=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const cc={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};cc.globalThis=cc; vm.createContext(cc); vm.runInContext(sr,cc);
const E=cc.module.exports; if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV)); E.AIP.egSearch=0;
const WILL=process.env.WILL?JSON.parse(process.env.WILL):null;
const R=[], W=[]; let tB=0, nB=0;
const finish=(hands,history,plays,leader,seat,cards,T,D,buried)=>{
  const hs=hands.map(h=>h.slice()); const ps=[...plays,{seat,cards}]; cards.forEach(x=>E.removeCard(hs[seat],x));
  for(let i=ps.length;i<4;i++){ const s=(leader+i)%4, hand=hs[s];
    const v={seat:s,hand,trump:T,declSeat:D,history:[...history,...ps],buriedKnown:s===D?buried:[]};
    const lead=E.classify(ps[0].cards,T); let cs=E.aiChooseFollow(v,ps).cards; if(!E.isLegalFollow(hand,lead,cs,T)) cs=E.genFollow(hand,lead,T,E.rng(1));
    ps.push({seat:s,cards:cs}); }
  const w=E.resolveTrick(ps,T).winner; return {team:w%2===seat%2?1:0, mine:w===seat?1:0, winner:w, ps}; };
for(let seed=S0+1;seed<=S0+N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,D=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;D=s;}}
  const T=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) D=first;
  hands[D].push(...kitty); const buried=E.aiDiscard(hands[D],T); buried.forEach(x=>E.removeCard(hands[D],x));
  const history=[]; let leader=D;
  while(hands.some(h=>h.length)){ const plays=[];
    for(let i=0;i<4;i++){ const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump:T,declSeat:D,history:[...history,...plays],buriedKnown:seat===D?buried:[]};
      let cards;
      if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,T); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,T); cards=E.aiChooseFollow(view,plays).cards; if(!E.isLegalFollow(hand,lead,cards,T)) cards=E.genFollow(hand,lead,T,E.rng(seed));
        if((i===1||i===2)&&lead.type==='single'&&hand.length>1){
          const wins=hand.filter(x=>E.isLegalFollow(hand,lead,[x],T)&&E.currentWinner([...plays,{seat,cards:[x]}],T).seat===seat).sort((a,b)=>E.ordIdx(a,T)-E.ordIdx(b,T));
          const pick=wins.length?[...new Set([wins[0],wins[wins.length-1]])]:[];
          if(pick.length){
            const X=E.followCtx(view,plays);
            const t0=process.hrtime.bigint(); const B=E.makeBelief(view,plays,M); tB+=Number(process.hrtime.bigint()-t0)/1e6; nB++;
            for(const x of pick){ const cl=E.classify([x],T); cl.cards=[x];
              const p0=E.pSurvive(X,cl,X.remainingOpp), p1=E.pSurviveBelief(X,cl,X.remainingOpp,B);
              let p2=null; if(WILL){ E.AIP.willW=WILL; p2=E.pSurviveBelief(X,cl,X.remainingOpp,B); E.AIP.willW=null; }
              if(p1===null) continue;
              const f=finish(hands,history,plays,leader,seat,[x],T,D,buried);
              // 能力上限:后手对手里有人「拿得出」压我 / 毙我的牌就算被压(意愿 = 1)—— 把信念和意愿拆开
              const sv=E.AIP.lastRuffWill; E.AIP.lastRuffWill=0;
              const cap=(()=>{ let a=0; for(const w of B.worlds){ let ok=1; for(const s of X.remainingOpp){ const H=w.hands[s]; if(!H) continue;
                  const ls=lead.suit, hasLead=H.some(c=>E.effSuit(c,T)===ls), tr=H.filter(c=>E.effSuit(c,T)==='T');
                  const iR=cl.suit==='T'&&ls!=='T';
                  if(iR){ if(!hasLead&&tr.some(c=>E.ordIdx(c,T)>cl.top)) ok=0; }
                  else if(ls!=='T'&&!hasLead){ if(tr.length) ok=0; }
                  else if(H.some(c=>E.effSuit(c,T)===cl.suit&&E.ordIdx(c,T)>cl.top)) ok=0; }
                a+=ok; } return a/B.worlds.length; })();
              E.AIP.lastRuffWill=sv;
              // 真实牌的能力:后手对手真的拿得出吗
              const capTrue=(()=>{ let ok=1; for(const s of X.remainingOpp){ const H=hands[s]; const ls=lead.suit, hasLead=H.some(c=>E.effSuit(c,T)===ls), tr=H.filter(c=>E.effSuit(c,T)==='T');
                  const iR=cl.suit==='T'&&ls!=='T';
                  if(iR){ if(!hasLead&&tr.some(c=>E.ordIdx(c,T)>cl.top)) ok=0; }
                  else if(ls!=='T'&&!hasLead){ if(tr.length) ok=0; }
                  else if(H.some(c=>E.effSuit(c,T)===cl.suit&&E.ordIdx(c,T)>cl.top)) ok=0; } return ok; })();
              const y=f.team;
              // 意愿:每个后手对手真拿得出时,他真的压 / 毙了吗(按他实际赢没赢这墩)
              const tblAfter=E.countPoints(plays.flatMap(p=>p.cards))+E.cardPoints(x);
              for(const s of X.remainingOpp){ const H=hands[s]; const ls=lead.suit, hasLead=H.some(c=>E.effSuit(c,T)===ls), tr=H.filter(c=>E.effSuit(c,T)==='T');
                const iR=cl.suit==='T'&&ls!=='T'; let beaters=[];
                if(iR){ if(!hasLead) beaters=tr.filter(c=>E.ordIdx(c,T)>cl.top); }
                else if(ls!=='T'&&!hasLead) beaters=tr;
                else beaters=H.filter(c=>E.effSuit(c,T)===cl.suit&&E.ordIdx(c,T)>cl.top);
                if(!beaters.length) continue;
                const cheapest=beaters.sort((a,b)=>E.ordIdx(a,T)-E.ordIdx(b,T))[0];
                const sp=f.ps.find(q=>q.seat===s); const beat=f.winner===s?1:0;
                W.push({kind:iR?'超毙':(ls!=='T'&&!hasLead?'毙':'同门压'),last:s===X.remainingOpp[X.remainingOpp.length-1]&&X.remaining[X.remaining.length-1]===s?1:0,
                  pts:tblAfter,cheapPts:E.cardPoints(cheapest),cheapBig:cheapest.suit==='X'||cheapest.rank===T.rank||(E.effSuit(cheapest,T)==='T'&&cheapest.rank===14)?1:0,
                  nB:beaters.length,n:hand.length,beat,partnerAfter:X.remaining.some(z=>z%2===seat%2&&X.remaining.indexOf(z)>X.remaining.indexOf(s))?1:0}); }
              R.push({p0,p1,p2,cap,capTrue,y,mine:f.mine,pos:i+1,ruff:E.effSuit(x,T)==='T'&&lead.suit!=='T'?1:0,trumpLead:lead.suit==='T'?1:0,pts:E.countPoints(plays.flatMap(p=>p.cards)),n:hand.length}); } } } }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards}); }
    const res=E.resolveTrick(plays,T); history.push(...plays); leader=res.winner; }
}
if(process.env.DUMP) fs.writeFileSync(process.env.DUMP,JSON.stringify(R));
if(process.env.DUMPW) fs.writeFileSync(process.env.DUMPW,JSON.stringify(W));
const ll=(p,y)=>{ p=Math.min(0.999,Math.max(0.001,p)); return -(y?Math.log(p):Math.log(1-p)); };
const m=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
console.log(`${N} 副,${R.length} 个样本;makeBelief(${M} 个世界)平均 ${(tB/Math.max(1,nB)).toFixed(1)} ms/次`);
console.log(`对数损失(实 = 本队拿下这墩)  现 pSurvive ${m(R.map(r=>ll(r.p0,r.y))).toFixed(4)}   信念版 ${m(R.map(r=>ll(r.p1,r.y))).toFixed(4)}   能力上限(信念) ${m(R.map(r=>ll(r.cap,r.y))).toFixed(4)}`);
const g=(t,a)=>{ if(a.length<40) return; console.log(`  ${t.padEnd(22)} n=${String(a.length).padStart(5)}  现 ${(100*m(a.map(r=>r.p0))).toFixed(0).padStart(3)}%  信念 ${(100*m(a.map(r=>r.p1))).toFixed(0).padStart(3)}%  能力(信念) ${(100*m(a.map(r=>r.cap))).toFixed(0).padStart(3)}%  能力(真牌) ${(100*m(a.map(r=>r.capTrue))).toFixed(0).padStart(3)}%  实 ${(100*m(a.map(r=>r.y))).toFixed(0).padStart(3)}%   损失 ${m(a.map(r=>ll(r.p0,r.y))).toFixed(3)} → ${m(a.map(r=>ll(r.p1,r.y))).toFixed(3)}`); };
g('全部',R); g('第 2 家',R.filter(r=>r.pos===2)); g('第 3 家',R.filter(r=>r.pos===3)); g('毙牌',R.filter(r=>r.ruff)); g('跟本门压',R.filter(r=>!r.ruff&&!r.trumpLead)); g('主牌墩',R.filter(r=>r.trumpLead));
g('台面有分',R.filter(r=>r.pts>0)); g('台面 0 分',R.filter(r=>r.pts===0)); g('中盘 >12 张',R.filter(r=>r.n>12)); g('收官 ≤12 张',R.filter(r=>r.n<=12));
for(let b=0;b<10;b++) g(`现估 [${b/10},${(b+1)/10})`,R.filter(r=>r.p0>=b/10&&(b===9?r.p0<=1:r.p0<(b+1)/10)));
