/* 「这门最大的在谁手里」的估计准不准(11-09,产品方情形 A:对手两家都领过这门、却没出过大牌 → 大牌多半在我队友手里):
 * 自对弈,第 2 家跟单张副牌领出的那一刻,这门**在外最大的那张**(我手里没有、还没出过):真实在队友手里的比例 vs 抽样世界估的比例,
 * 按「对手在这门领过几次(都没领出这张)」分档。OV= 打开推断开关(leadInferHist / followInfer / holdTopSignal …)比估计有没有变准。
 *   node test/top-odds.js [html] [种子数=300]   (SEED0=、OV=) */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const FILE=process.argv[2]||path.join(__dirname,'..','80fen-test.html'), N=+process.argv[3]||300, S0=+(process.env.SEED0||0);
const sr=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const cc={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};cc.globalThis=cc; vm.createContext(cc); vm.runInContext(sr,cc);
const E=cc.module.exports; E.AIP.egSearch=0; const OVS=JSON.parse(process.env.OVS||'[{}]');   // 几组推断开关,同一批局面各估一次(打法不变)
const R=[];
for(let seed=S0+1;seed<=S0+N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,D=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;D=s;}}
  const T=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) D=first;
  hands[D].push(...kitty); const buried=E.aiDiscard(hands[D],T); buried.forEach(x=>E.removeCard(hands[D],x));
  const curDecl=best?{seat:D,suit:best.suit,strength:best.strength}:null;
  const history=[]; let leader=D;
  while(hands.some(h=>h.length)){ const plays=[];
    for(let i=0;i<4;i++){ const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump:T,declSeat:D,history:[...history,...plays],buriedKnown:seat===D?buried:[],curDecl};
      let cards;
      if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,T); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,T);
        if(i===1&&lead.type==='single'&&lead.suit!=='T'){
          const su=lead.suit, mem=E.makeMemory(view); let top=-1, topK=null;
          for(const k in mem.unseen){ if(mem.unseen[k]<=0) continue; const c=E.keyToCard(k); if(E.effSuit(c,T)!==su) continue; const o=E.ordIdx(c,T); if(o>top){top=o;topK=c;} }
          if(topK&&!hand.some(x=>E.effSuit(x,T)===su&&E.ordIdx(x,T)>=top)){
            const mate=(seat+2)%4, opp=[(seat+1)%4,(seat+3)%4];
            // 对手在这门领过几次(历史里的单张领出,不含本墩)
            let oppLed=0; for(let t=0;t+3<history.length;t+=4){ const L=history[t]; if(opp.includes(L.seat)&&L.cards.length===1&&E.effSuit(L.cards[0],T)===su) oppLed++; }
            const has=q=>hands[q].some(x=>E.effSuit(x,T)===su&&E.ordIdx(x,T)===top);
            const est=OVS.map(ov=>{ const save={...E.AIP}; Object.assign(E.AIP,ov); const B=E.makeBelief(view,plays,30); Object.assign(E.AIP,save);
              return B?B.worlds.filter(w=>(w.hands[mate]||[]).some(x=>E.effSuit(x,T)===su&&E.ordIdx(x,T)===top)).length/B.worlds.length:0.5; });
            R.push({oppLed,leaderOpp:plays[0].seat!==mate?1:0,truth:has(mate)?1:0,est,meDecl:seat%2===D%2?1:0}); } }
        cards=E.aiChooseFollow(view,plays).cards; if(!E.isLegalFollow(hand,lead,cards,T)) cards=E.genFollow(hand,lead,T,E.rng(seed)); }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards}); }
    const res=E.resolveTrick(plays,T); history.push(...plays); leader=res.winner; }
}
const m=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
const ll=(a,k)=>-m(a.map(r=>{const p=Math.min(0.98,Math.max(0.02,r.est[k]));return r.truth?Math.log(p):Math.log(1-p);}));
console.log(`${N} 副,第 2 家跟单张副牌:这门在外最大的那张在队友手里 —— 实际比例 vs 抽样估计(各组开关:估 / 对数损失)`);
OVS.forEach((ov,k)=>console.log(`  [${k}] ${JSON.stringify(ov)}`));
const row=(lab,a)=>{ if(a.length<20) return; console.log(`  ${lab.padEnd(22)} n=${String(a.length).padStart(5)}  实 ${(100*m(a.map(r=>r.truth))).toFixed(0).padStart(3)}%  `+OVS.map((o,k)=>`[${k}] 估 ${(100*m(a.map(r=>r.est[k]))).toFixed(0).padStart(3)}% ${ll(a,k).toFixed(4)}`).join('  ')); };
for(const [lab,f] of [['对手没领过这门',r=>r.oppLed===0],['对手领过 1 次',r=>r.oppLed===1],['对手领过 ≥2 次',r=>r.oppLed>=2]])
  for(const md of [0,1]) row(`${lab}·${md?'我庄方':'我闲方'}`,R.filter(r=>f(r)&&r.meDecl===md));
row('全部',R);
