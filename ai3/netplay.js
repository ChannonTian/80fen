/* ai3/netplay.js —— 「网络接管若干座位 + 内核状态同步」的共用小模块(做法同 test/ai-h2h.js 的 PNET)。
 *   const NP=createNetPlayer('ai3/out/net-w2');
 *   NP.reset(hands,buried,trumpSuit0123or4,level,declSeat,seedForRng)   // 埋底后、第一手之前
 *   const cards=NP.cards(seat,hands)        // 网络在当前内核状态上选一手(argmax),映射成 seat 手里的牌对象
 *   NP.sync(cards,isLead)                   // 把这一手(已过 checkThrow / 合法性修正)喂回内核;内核不认的计 NP.nsync
 * hands:{id}[] 的 4 手牌(牌种 = id%54)。 */
'use strict';
const KERN=require('./kernel.js'), Net=require('./net.js'), NetPolicy=require('./policy.js');
function createNetPlayer(dir){
  const KST=KERN.newState(), P=new NetPolicy(Net.load(dir),KERN.makeRng(1)), KBUF=new Uint8Array(64);
  const NP={KERN,KST,P,nsync:0,nnet:0,
    reset(hands,buried,ts,level,decl,seed){
      KERN.reset(KST,hands.map(h=>h.map(c=>c.id%54)),buried.map(c=>c.id%54),ts,level,decl);
      if(seed!==undefined) P.rng=KERN.makeRng(seed);
    },
    cards(seat,hands){
      const i=P.choose(KST), p=KERN.pos[i], L=P.buf[p], used=new Set(), out=[];
      for(let k=0;k<L;k++){ const t=P.buf[p+1+k], c=hands[seat].find(x=>x.id%54===t&&!used.has(x.id)); used.add(c.id); out.push(c); }
      NP.nnet++; return out;
    },
    sync(cards,isLead){
      const ts=cards.map(c=>c.id%54).sort((a,b)=>a-b); KBUF[0]=ts.length; for(let k=0;k<ts.length;k++) KBUF[1+k]=ts[k];
      if(isLead){ if(KERN.playLead(KST,KBUF,0)!==0) NP.nsync++; } else KERN.playFollow(KST,KBUF,0);
    }};
  return NP;
}
module.exports=createNetPlayer;
