/* 队友(人)钓主、我坐第 3 家:每一张能出的主,打分拆开 + 末家真的应一次。
 *
 *   node test/diag-third.js <html> [种子数=300]        (OV= 覆盖 AIP)
 *
 * 起因(产品方,2026-09-26):「钓主时队友还是不太接牌,原因是什么?」
 * audit-third 只看 AI 选了什么、结果如何;这里把**没选的**也算出来:
 *   · 每张候选的打分分量:这墩赢率估计 p、这墩得失 ev、牌权项 tempo(含送毙 feed)、留手代价 fv;
 *   · 末家对**这一张**真的怎么应(同一个 AI,原样局面)→ 这墩实际归谁、多少分。
 * 候选按类别归并:
 *   不接     —— 手里最小的主(不压当前最大)
 *   便宜接   —— 刚好压过当前最大的那张
 *   封分接   —— 压过在外所有主分牌的最小那张(trumpSealW 说的那张)
 *   顶大接   —— 手里最大的主
 * FORCE 同 audit-third:中盘时领出者手里有小主,就强制用最小那张领出(模拟人的钓主)。
 */
'use strict';
const fs=require('fs'),vm=require('vm');
const FILE=process.argv[2]||'80fen-test.html';
const src=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c;
vm.createContext(c);vm.runInContext(src,c);
const E=c.module.exports, A=E.AIP;
A.egSearch=0;
if(process.env.OV) Object.assign(A,JSON.parse(process.env.OV));
const N=+process.argv[3]||300;
const G={}, WHY={};
const bump=(k,o)=>{ const g=G[k]=G[k]||{n:0,chosen:0,p:0,won:0,pts:0,ev:0,tempo:0,feed:0,fv:0,score:0,gap:0};
  g.n++; for(const f of ['chosen','p','won','pts','ev','tempo','feed','fv','score','gap']) g[f]+=o[f]||0; };
const sit={};
for(let seed=1;seed<=N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) declSeat=first;
  hands[declSeat].push(...kitty); const buried=E.aiDiscard(hands[declSeat],trump); buried.forEach(x=>E.removeCard(hands[declSeat],x));
  const rand=E.rng(seed^0x9e3779b9); const history=[]; let leader=declSeat, forced=0;
  const topPtOf=mem=>{ let t=-1; for(const k in mem.unseen){ if(mem.unseen[k]<=0) continue; const u=E.keyToCard(k);
    if(E.effSuit(u,trump)==='T'&&E.cardPoints(u)>0) t=Math.max(t,E.ordIdx(u,trump)); } return t; };
  while(hands.some(h=>h.length)){
    const plays=[]; let isForced=false;
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){ cards=E.aiChooseLead(view).cards;
        if(hand.length>8&&forced<3){
          const tp=topPtOf(E.makeMemory(view));
          const low=hand.filter(x=>E.effSuit(x,trump)==='T'&&x.suit!=='X'&&E.ordIdx(x,trump)<tp)
                        .sort((a,b)=>E.ordIdx(a,trump)-E.ordIdx(b,trump))[0];
          if(low){ cards=[low]; forced++; isForced=true; }
        }
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{
        const lead=E.classify(plays[0].cards,trump); const r=E.aiChooseFollow(view,plays); cards=r.cards; var RR=r;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand);
        if(i===2&&isForced&&lead.suit==='T'){
          const myT=hand.filter(x=>E.effSuit(x,trump)==='T');
          if(myT.length>=2){
            const cur=E.currentWinner(plays,trump), partnerAhead=cur.seat===plays[0].seat;
            const X=E.followCtx(view,plays);
            if(A.tiaoAccept&&plays[0].cards[0].suit!=='X'&&!E.isBossPlay(lead,X.mem,trump)) X.tempoW=A.leadTempoWeight;
            const tp=topPtOf(X.mem);
            const byIdx=myT.slice().sort((a,b)=>E.ordIdx(a,trump)-E.ordIdx(b,trump));
            const beat=byIdx.filter(x=>E.ordIdx(x,trump)>cur.cl.top);
            const kinds={};
            kinds['不接']=byIdx[0];
            if(beat.length){ kinds['便宜接']=beat[0]; kinds['顶大接']=beat[beat.length-1];
              const seal=beat.find(x=>E.ordIdx(x,trump)>tp); if(seal) kinds['封分接']=seal; }
            const chosenId=cards[0]&&cards[0].id;
            const k0=`${partnerAhead?'队友暂大':'第2家压过了队友'} · 台面${X.ptsTable>0?'有分':'0分'}`;
            sit[k0]=(sit[k0]||0)+1;
            const rows={};
            for(const [kind,card] of Object.entries(kinds)){
              if(rows[card.id]) continue;
              const cc=[card], beats=E.ordIdx(card,trump)>cur.cl.top;
              const p=E.pTeamWin(X,cc,beats);
              const gain=X.ptsTable+E.countPoints(cc)+c.laterPoints(X,true), loss=X.ptsTable+E.countPoints(cc)+c.laterPoints(X,false);
              const ev=p*gain-(1-p)*loss;
              const t0=(p*c.tempoValue(X,cc)-(1-p)*A.oppTempo)*(X.tempoW||A.tempoWeight);
              const feed=A.feedTempo&&beats?A.feedTempo*p*c.feedTempoValue(X,cc):0;
              const fv=c.futureValue(cc,X);
              const score=E.scorePlay?E.scorePlay(X,cc,'over',beats):c.scorePlay(X,cc,'over',beats);
              // 末家真的应一次
              const h2=hand.filter(x=>x.id!==card.id);
              const pl2=[...plays,{seat,cards:cc}]; const s4=(seat+1)%4;
              const v4={seat:s4,hand:hands[s4],trump,declSeat,history:[...history,...pl2],buriedKnown:s4===declSeat?buried:[]};
              let c4=E.aiChooseFollow(v4,pl2).cards; if(!E.isLegalFollow(hands[s4],lead,c4,trump)) c4=E.genFollow(hands[s4],lead,trump,rand);
              const res=E.resolveTrick([...pl2,{seat:s4,cards:c4}],trump);
              rows[card.id]={kind,p,ev,tempo:t0,feed,fv,score,won:res.winner%2===seat%2?1:0,pts:(res.winner%2===seat%2?1:-1)*res.points,chosen:card.id===chosenId?1:0};
              void h2;
            }
            const bestScore=Math.max(...Object.values(rows).map(r=>r.score));
            for(const r of Object.values(rows)) bump(`${k0} · ${r.kind}`,{...r,gap:bestScore-r.score});
            const ch=rows[chosenId]; if(ch){ const top=(RR.cands||[]).slice().sort((a,b)=>b.score-a.score)[0];
              const k=`${k0} · 选了${ch.kind} · ${String(RR.reason).replace(/[0-9.]+/g,'#').slice(0,26)} · 候选分 ${top?top.score.toFixed(0):'?'} vs 重算 ${ch.score.toFixed(0)}`;
              if(ch.kind==='封分接'&&X.ptsTable>0) WHY[k]=(WHY[k]||0)+1; }
            if(!rows[chosenId]){ const k=`${k0} · (选了别的)`; WHY[k]=(WHY[k]||0)+1; }
          }
        }
      }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    history.push(...plays); leader=E.resolveTrick(plays,trump).winner;
  }
}
console.log(`${FILE}${process.env.OV?' OV='+process.env.OV:''} —— ${N} 副,模拟人钓主(中盘最小的非王主)、我坐第 3 家、手里 ≥2 张主`);
console.log('局面分布:',JSON.stringify(sit)); for(const k of Object.keys(WHY).sort((a,b)=>WHY[b]-WHY[a]).slice(0,15)) console.log('  ',WHY[k],k);
console.log('\n类别'.padEnd(26)+'   n   被选   估p   实赢   实得分  | ev    牌权  送毙  留手fv  总分  离最高');
for(const k of Object.keys(G).sort()){ const g=G[k], m=f=>g[f]/g.n;
  console.log(`${k.padEnd(24)} ${String(g.n).padStart(4)}  ${(100*m('chosen')).toFixed(0).padStart(4)}%  ${(100*m('p')).toFixed(0).padStart(3)}%  ${(100*m('won')).toFixed(0).padStart(3)}%  ${m('pts').toFixed(1).padStart(6)}  | `
    +`${m('ev').toFixed(1).padStart(5)} ${m('tempo').toFixed(1).padStart(5)} ${m('feed').toFixed(1).padStart(5)} ${m('fv').toFixed(1).padStart(6)} ${m('score').toFixed(1).padStart(6)} ${m('gap').toFixed(1).padStart(6)}`); }
