/* 「分牌命运」数据(2026-11-09,产品方:留着的分牌是在找更高概率得利的机会 —— 单一概率 + 阈值管不住):
 * 自对弈里,每次跟单张领出的牌(第 2 / 3 / 4 家)时,手里每一张**没出的副牌分牌**(5 / 10 / K)记一条:
 * 那一刻能看到的特征(抽样世界里各家断这门、谁握着比它大的牌……) + 它最后被打出去的那一墩归哪一方。
 * 用来拟合「留着的这张分,最后归本队的概率」,和「现在贴上去」的期望比,替掉 followFix 位 1 的固定阈值。
 *   node test/fate-data.js [html] [种子数=200] > out.jsonl    (SEED0=、OV=、M=抽样世界数 默认 30) */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const FILE=process.argv[2]||path.join(__dirname,'..','80fen-test.html'), N=+process.argv[3]||200, S0=+(process.env.SEED0||0), M=+(process.env.M||30);
const sr=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const cc={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};cc.globalThis=cc; vm.createContext(cc); vm.runInContext(sr,cc);
const E=cc.module.exports; E.AIP.egSearch=0; if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV));
if(typeof E.fateFeat!=='function') throw new Error('引擎没有导出 fateFeat');
for(let seed=S0+1;seed<=S0+N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,D=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;D=s;}}
  const T=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) D=first;
  hands[D].push(...kitty); const buried=E.aiDiscard(hands[D],T); buried.forEach(x=>E.removeCard(hands[D],x));
  const curDecl=best?{seat:D,suit:best.suit,strength:best.strength}:null;
  const history=[]; let leader=D; const pend=new Map();   // card.id → [记录]
  while(hands.some(h=>h.length)){ const plays=[];
    for(let i=0;i<4;i++){ const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump:T,declSeat:D,history:[...history,...plays],buriedKnown:seat===D?buried:[],curDecl};
      let cards;
      if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,T); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,T);
        cards=E.aiChooseFollow(view,plays).cards; if(!E.isLegalFollow(hand,lead,cards,T)) cards=E.genFollow(hand,lead,T,E.rng(seed));
        if(lead.type==='single'){
          const kept=hand.filter(x=>E.cardPoints(x)>0&&E.effSuit(x,T)!=='T'&&!cards.some(y=>y.id===x.id));
          if(kept.length){ const B=E.makeBelief(view,plays,M);
            const oppWin=E.currentWinner(plays,T).seat%2!==seat%2?1:0;
            for(const c of kept){ const f=E.fateFeat(view,c,B);
              const r={seed,seat,decl:seat%2===D%2?1:0,pos:i,oppWin,pts:E.cardPoints(c),...f};
              if(!pend.has(c.id)) pend.set(c.id,[]); pend.get(c.id).push(r); } } } }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards}); }
    const res=E.resolveTrick(plays,T);
    for(const p of plays) for(const c of p.cards){ const rs=pend.get(c.id); if(!rs) continue;
      for(const r of rs){ r.y=res.winner%2===r.seat%2?1:0; r.left=hands[r.seat].length; process.stdout.write(JSON.stringify(r)+'\n'); } pend.delete(c.id); }
    history.push(...plays); leader=res.winner; }
}
