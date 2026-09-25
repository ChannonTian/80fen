/* 队友钓主、我坐第 3 家:接不接(产品方,2026-09-25)。
 *
 *   node test/audit-third.js <html> [种子数=300]      (OV= 覆盖 AIP,EG=1 开收官搜索)
 *
 * 「作为第三家出牌的队友,接的时候如果打 9 那末家可以打 10,如果打 Q 那末家可以打 K,
 *  打 4 末家可以打 5。这个如果不考虑,当然送分概率就出来了。」
 *
 * 局面:队友领出一张非王单张主,第 2 家(对手)跟了、没有压过队友 —— 队友暂大;
 *       我坐第 3 家,末家(对手)还没出。中盘(手里 >8 张)。
 * 分两类:我**压过**队友(接)/ 没压(跟小、贴分……)。各自的结局:
 *   这墩归谁、末家是不是用一张主分牌(主 5 / 10 / K)赢走的、这墩多少分,
 *   以及**接下来 3 墩**两队各拿了多少分 —— 牌权的后果。
 * 另记:我手里有没有「压过在外最大主分牌」的牌(有 = 本可以把末家的主分牌封死)。
 * FORCE=1 模拟人的钓主(见下)—— 自对弈里这个局面很少,而且 AI 自己钓的主往往不小,量不出人遇到的情形。
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
const N=+process.argv[3]||300, S0=+(process.env.SEED0||0);
const G={};
const add=(k,o)=>{ const g=G[k]=G[k]||{n:0,lost:0,byPt:0,pts:0,ptsLost:0,next:0}; g.n++;
  if(o.lost){ g.lost++; g.ptsLost+=o.pts; if(o.byPt) g.byPt++; } g.pts+=o.pts; g.next+=o.next; };
const why={};
for(let seed=S0+1;seed<=S0+N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) declSeat=first;
  hands[declSeat].push(...kitty); const buried=E.aiDiscard(hands[declSeat],trump); buried.forEach(x=>E.removeCard(hands[declSeat],x));
  const rand=E.rng(seed^0x9e3779b9); const history=[]; let leader=declSeat;
  const tricks=[]; const marks=[]; let forced=0;
  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards, reason='';
      if(i===0){ cards=E.aiChooseLead(view).cards;
        /* FORCE=1:模拟**人**的钓主 —— 自对弈里领小主的是 AI 自己,它只在形势合适时才钓,
         * 钓的那张也往往不小;人拿一张真正的小主去交牌权,第 3 家的 AI 队友怎么接才是要看的。
         * 中盘、手里有一张比在外某张主分牌还小的非王主时,强制用最小的那张领出(每副最多 FORCE_MAX 次)。 */
        if(process.env.FORCE==='1'&&hand.length>8&&forced<(+process.env.FORCE_MAX||3)){
          const mem=E.makeMemory(view);
          let topPt=-1; for(const k in mem.unseen){ if(mem.unseen[k]<=0) continue; const u=E.keyToCard(k);
            if(E.effSuit(u,trump)==='T'&&E.cardPoints(u)>0) topPt=Math.max(topPt,E.ordIdx(u,trump)); }
          const low=hand.filter(x=>E.effSuit(x,trump)==='T'&&x.suit!=='X'&&E.ordIdx(x,trump)<topPt)
                        .sort((a,b)=>E.ordIdx(a,trump)-E.ordIdx(b,trump))[0];
          if(low){ cards=[low]; forced++; }
        }
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,trump); const r=E.aiChooseFollow(view,plays); cards=r.cards; reason=r.reason;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand);
        if(i===2&&hand.length>8&&lead.suit==='T'&&lead.cards.length===1&&plays[0].cards[0].suit!=='X'){
          const cur=E.currentWinner(plays,trump);
          if(cur.seat===plays[0].seat){                          // 队友(领出者)暂大
            const mem=E.makeMemory(view);
            let topPt=-1; for(const k in mem.unseen){ if(mem.unseen[k]<=0) continue; const u=E.keyToCard(k);
              if(E.effSuit(u,trump)==='T'&&E.cardPoints(u)>0) topPt=Math.max(topPt,E.ordIdx(u,trump)); }
            const canSeal=topPt>=0&&hand.some(x=>E.effSuit(x,trump)==='T'&&E.ordIdx(x,trump)>topPt);
            const mine=E.classify(cards,trump);
            const took=mine&&mine.suit==='T'&&mine.top>cur.cl.top;
            marks.push({ti:tricks.length,seat,took,canSeal,ptOut:topPt>=0,reason});
          }
        }
      }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    history.push(...plays);
    const res=E.resolveTrick(plays,trump);
    const wp=plays.find(p=>p.seat===res.winner);
    tricks.push({winner:res.winner,points:res.points,byPt:wp.cards.some(x=>E.effSuit(x,trump)==='T'&&E.cardPoints(x)>0)});
    leader=res.winner;
  }
  for(const m of marks){
    const t=tricks[m.ti]; const team=m.seat%2;
    let next=0; for(let j=m.ti+1;j<=m.ti+3&&j<tricks.length;j++) next+=(tricks[j].winner%2===team?1:-1)*tricks[j].points;
    const o={lost:t.winner%2!==team,byPt:t.byPt,pts:t.points,next};
    const k1=`${m.took?'接(压过队友)':'没接'}`;
    add(k1,o);
    if(m.ptOut) add(`${k1} · 在外还有主分牌 · 我${m.canSeal?'有':'没有'}能封死它的主`,o);
    if(!m.took){ const r=String(m.reason).replace(/[0-9.]+/g,'#').slice(0,30); why[r]=(why[r]||0)+1; }
  }
}
console.log(`${FILE}${process.env.OV?' OV='+process.env.OV:''}${process.env.FORCE==='1'?' 【模拟人钓主】':''} —— ${N} 副:队友钓主(非王单张)、对手第 2 家没压、我坐第 3 家、中盘`);
console.log('类别'.padEnd(36)+'次/局  这墩丢了  丢墩里被末家主分牌拿走  这墩均分  丢的分/局  之后 3 墩净分(我方−对方)');
for(const k of Object.keys(G).sort()){ const g=G[k];
  console.log(`${k.padEnd(34)} ${(g.n/N).toFixed(2).padStart(5)}  ${(100*g.lost/g.n).toFixed(0).padStart(5)}%  ${(g.lost?100*g.byPt/g.lost:0).toFixed(0).padStart(10)}%  `
   +`${(g.pts/g.n).toFixed(1).padStart(8)}  ${(g.ptsLost/N).toFixed(2).padStart(8)}  ${(g.next/g.n).toFixed(1).padStart(10)}`); }
console.log('没接的理由:'); Object.entries(why).sort((a,b)=>b[1]-a[1]).slice(0,6).forEach(([k,v])=>console.log(`  ${String(v).padStart(4)}  ${k}`));
