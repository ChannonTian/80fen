/* 「谁握着某张关键牌」—— AI 现在的估计准不准、出牌历史里还剩多少信息没用上(2026-10-24,产品方:
 * 「探索其他玩家拥有某些可能影响本墩、或未来墩的特定牌的概率」)。
 *
 *   node test/belief-calib.js [html] [种子数=200]     (SEED0= 起始;DUMP=x.json 存样本给拟合)
 *
 * 自对弈(搜索关),每个 AI 决策点、对另外三家各自、对每门(含主)「在外最大的那张」(副牌门 = 最大点数;主 = 在外最大主):
 *   估计 = 引擎的底层口径:在外均匀发牌(urn),这家握 ≥1 张的概率 1 − (1 − 份额)^张数;硬断门 → 0
 *   真值 = 他手里真有没有
 * 再用出牌历史里的几类信号(他出过这门几张、有机会领这门却没领、这门他跟小没争、他毙过 / 垫过、谁做庄……)拟合一个 logistic,
 * 看对数损失能降多少 —— 降得越多,说明「谁有什么」这件事上还有越多信息没被用上。
 */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const FILE=process.argv[2]||path.join(__dirname,'..','80fen-test.html'), N=+process.argv[3]||200, S0=+(process.env.SEED0||0);
const sr=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const cc={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};cc.globalThis=cc; vm.createContext(cc); vm.runInContext(sr,cc);
const E=cc.module.exports; if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV)); E.AIP.egSearch=0;
const rows=[];
// 历史扫描:每家每门的信号
function signals(history,T,D){
  const sig=[0,1,2,3].map(()=>({}));
  const g=(s,su)=>sig[s][su]=sig[s][su]||{played:0,duck:0,ruff:0,disc:0,lead:0,wonHigh:0};
  for(let i=0;i+3<history.length;i+=4){
    const tr=history.slice(i,i+4); const lead=E.classify(tr[0].cards,T); if(!lead) continue; const su=lead.suit;
    g(tr[0].seat,su).lead++;
    for(let j=0;j<4;j++){ const p=tr[j]; const o=g(p.seat,su);
      const inSuit=p.cards.filter(c=>E.effSuit(c,T)===su).length; o.played+=inSuit;
      if(j>0&&inSuit<p.cards.length){ if(p.cards.some(c=>E.effSuit(c,T)==='T')&&su!=='T') g(p.seat,su).ruff++; else g(p.seat,su).disc++; }
      if(j>0&&inSuit===p.cards.length&&lead.type==='single'){
        const before=tr.slice(0,j); const cur=E.currentWinner(before,T); const pts=E.countPoints(tr.flatMap(q=>q.cards));
        const oppWin=cur.seat%2!==p.seat%2;
        const beats=E.currentWinner([...before,p],T).seat===p.seat;
        if(oppWin&&!beats&&pts>0) o.duck++;            // 对手暂大、台面有分,他跟了本门却没压 —— 多半压不住
        if(beats&&j===3) o.wonHigh++;
      } } }
  return sig;
}
for(let seed=S0+1;seed<=S0+N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,D=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;D=s;}}
  const T=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) D=first;
  hands[D].push(...kitty); const buried=E.aiDiscard(hands[D],T); buried.forEach(x=>E.removeCard(hands[D],x));
  const history=[]; let leader=D, tn=0;
  while(hands.some(h=>h.length)){
    tn++; const plays=[];
    for(let i=0;i<4;i++){ const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump:T,declSeat:D,history:[...history,...plays],buriedKnown:seat===D?buried:[]};
      // 只在每墩领出前采样(局面里每家手牌数相同),每墩采一个座位,控制样本相关性
      if(i===0&&hand.length>1&&tn%2===1){
        const mem=E.makeMemory(view); const reads=E.makeReads(view.history,T); const sig=signals(view.history,T,D);
        let unseenTotal=0; for(const k in mem.unseen) unseenTotal+=Math.max(0,mem.unseen[k]);
        const skip=E.leadSkipSignals?E.leadSkipSignals(view.history,T):null;
        // 约束一致的抽样估计:和收官搜索同一个 sampleWorld(硬断门、上界、亮主钉牌、底牌模型),抽 M 个世界数频率
        const M=+(process.env.M||60); let worlds=[];
        { const unseen=[]; let uid=0; for(const k in mem.unseen){ const c=E.keyToCard(k); for(let q=0;q<mem.unseen[k];q++) unseen.push({suit:c.suit,rank:c.rank,id:'u'+(uid++)}); }
          const seats=[0,1,2,3].filter(z=>z!==seat); const sizes={}; seats.forEach(z=>sizes[z]=hands[z].length);
          const kittySize=seat===D?0:8; const voids=E.makeVoids(view.history,T);
          const ctx={unseen,sizes,seats,voids,trump:T,kittySize,capOf:(z,su)=>E.maxHoldIn(reads,mem,z,su,T),known:[],pVoidOf:null};
          const rand=E.rng(seed*131+tn); for(let q=0;q<M;q++){ const w=E.sampleWorld(ctx,rand); if(w) worlds.push(w); } }
        for(const su of ['S','H','D','C','T']){ if(su===T.suit) continue;
          // 这门在外最大那张
          let top=null,topIdx=-1,copies=0,inSuit=0;
          for(const k in mem.unseen){ const n=mem.unseen[k]; if(n<=0) continue; const c=E.keyToCard(k); if(E.effSuit(c,T)!==su) continue; inSuit+=n;
            const ix=E.ordIdx(c,T); if(ix>topIdx){ topIdx=ix; top=c; copies=n; } }
          if(!top) continue;
          for(const s of [0,1,2,3]){ if(s===seat) continue;
            const hs=hands[s].length; // 领出前每家同样多
            const share=hs/Math.max(1,unseenTotal);
            const hard=reads.hard[s]&&reads.hard[s][su]?1:0;
            const m=E.maxHoldIn(reads,mem,s,su,T);
            const urn=hard?0:1-Math.pow(1-share,copies);
            const truth=hands[s].some(c=>c.suit===top.suit&&c.rank===top.rank)?1:0;
            const samp=worlds.length?(worlds.filter(w=>w.hands[s].some(c=>c.suit===top.suit&&c.rank===top.rank)).length+0.5)/(worlds.length+1):urn;
            const g=(sig[s][su])||{played:0,duck:0,ruff:0,disc:0,lead:0,wonHigh:0};
            rows.push({su:su==='T'?'T':'side',urn,samp,truth,hard,cap0:m===0?1:0,hs,inSuit,unseenTotal,copies,
              played:g.played,duck:g.duck,ruff:g.ruff,disc:g.disc,lead:g.lead,wonHigh:g.wonHigh,
              skip:skip&&skip[s]&&skip[s][su]?1:0,decl:s===D?1:0,partner:s%2===seat%2?1:0,meDecl:seat===D?1:0,
              joker:top.suit==='X'?1:0});
          }
        }
      }
      let cards; if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,T); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,T); cards=E.aiChooseFollow(view,plays).cards; if(!E.isLegalFollow(hand,lead,cards,T)) cards=E.genFollow(hand,lead,T,E.rng(seed)); }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards}); }
    const res=E.resolveTrick(plays,T); history.push(...plays); leader=res.winner;
  }
}
if(process.env.DUMP) fs.writeFileSync(process.env.DUMP,JSON.stringify(rows));
console.log(`${N} 副,样本 ${rows.length}`);
