/* 小主的两类墩,单独拎出来看结局(产品方,2026-09-25):
 *   「主牌通常也就 50 分、6 张分牌,按所有打主牌的墩来测当然看不出多少。
 *    把所有领出 <n 的主牌、非末家毙牌 <n 的主牌这些情况从牌谱里找出来,也许会很不一样。」
 *
 *   node test/audit-lowtrump.js <html> [种子数=300]        (OV= 覆盖 AIP,EG=1 开收官搜索)
 *
 * 两类:
 *   L 领出一张非王的小主(单张)
 *   R 非末家、副牌墩里用一张主去毙(单张)
 * 每类按出的那张主分档:
 *   · 低于在外某张**主分牌**(主 5 / 10 / K,含级数牌是分牌时)—— 后手可以用主分牌连分带牌权拿走
 *   · 不低于在外任何主分牌
 * 以及按它在主牌里的位置(ordIdx)分三档。结局:
 *   丢墩率(这墩归了对手)、每次被拿走的分、其中**对手用主分牌赢下**的比例。
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
const B={};    // key → {n, lost, ptsLost, byPtTrump}
const add=(k,lost,pts,byPt)=>{ const b=B[k]=B[k]||{n:0,lost:0,pts:0,byPt:0}; b.n++; if(lost){ b.lost++; b.pts+=pts; if(byPt) b.byPt++; } };

for(let seed=S0+1;seed<=S0+N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) declSeat=first;
  hands[declSeat].push(...kitty); const buried=E.aiDiscard(hands[declSeat],trump); buried.forEach(x=>E.removeCard(hands[declSeat],x));
  const rand=E.rng(seed^0x9e3779b9); const history=[]; let leader=declSeat;
  while(hands.some(h=>h.length)){
    const plays=[], watch=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,trump); cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand); }
      if(cards.length===1&&E.effSuit(cards[0],trump)==='T'&&cards[0].suit!=='X'&&hand.length>8){
        const lead=i===0?null:E.classify(plays[0].cards,trump);
        const kind=i===0?'L 领出小主':(lead.suit!=='T'&&i<3?'R 非末家毙牌':null);
        if(kind){
          const mem=E.makeMemory(view), idx=E.ordIdx(cards[0],trump);
          // 在外还有比它大的主分牌吗
          let ptAbove=false;
          for(const k in mem.unseen){ if(mem.unseen[k]<=0) continue; const u=E.keyToCard(k);
            if(E.effSuit(u,trump)==='T'&&E.cardPoints(u)>0&&E.ordIdx(u,trump)>idx){ ptAbove=true; break; } }
          const band=idx<=4?'低(序号 0~4)':idx<=9?'中(5~9)':'高(10+,含级数牌)';
          watch.push({kind,seat,ptAbove,band,decl:seat%2===declSeat%2});
        }
      }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    history.push(...plays);
    const res=E.resolveTrick(plays,trump);
    const wp=plays.find(p=>p.seat===res.winner);
    const byPt=wp&&wp.cards.some(x=>E.effSuit(x,trump)==='T'&&E.cardPoints(x)>0);
    for(const w of watch){
      const lost=res.winner%2!==w.seat%2;
      add(`${w.kind} · ${w.ptAbove?'在外有更大的主分牌':'在外没有更大的主分牌'}`,lost,res.points,byPt);
      add(`${w.kind} · ${w.band}`,lost,res.points,byPt);
      add(`${w.kind} · ${w.decl?'庄家方':'闲家'} · ${w.ptAbove?'在外有更大的主分牌':'没有'}`,lost,res.points,byPt);
    }
    leader=res.winner;
  }
}
console.log(`${FILE}${process.env.OV?' OV='+process.env.OV:''} —— ${N} 副(中盘:出牌前手里 >8 张)`);
console.log('类别'.padEnd(40)+'次/局   丢墩率   丢墩时被拿走的分   其中对手用主分牌赢下');
for(const k of Object.keys(B).sort()){ const b=B[k];
  console.log(`${k.padEnd(38)} ${(b.n/N).toFixed(2).padStart(5)}   ${(100*b.lost/b.n).toFixed(0).padStart(4)}%   `
    +`${(b.lost?b.pts/b.lost:0).toFixed(1).padStart(8)} 分/次(${(b.pts/N).toFixed(2)} 分/局)   ${(b.lost?100*b.byPt/b.lost:0).toFixed(0).padStart(4)}%`); }
