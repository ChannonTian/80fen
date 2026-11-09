/* 真人牌谱里三类跟牌 / 留主问题的频次,AI 座位 vs 真人(2026-11-08,产品方):P1 对手暂大没压还送副牌分、P2 断门有主不毙、P3 主牌留到最后。
 *   node test/records-patterns.js <牌谱.jsonl>   (VER='v0\.7\.5' 只看某些版本)  */
// 真人牌谱里三类问题的频次:P1 本队输着 / 没把握时有别的牌还送副牌分;P2 断门有主不毙(且台面有分 / 对手暂大);P3 主牌留到最后
const fs=require('fs'),vm=require('vm');const sr=[...fs.readFileSync(require('path').join(__dirname,'..','80fen-test.html'),'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const cc={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};cc.globalThis=cc;vm.createContext(cc);vm.runInContext(sr,cc);const E=cc.module.exports;
const {isTestGame}=require('./records-filter.js');
const rs=fs.readFileSync(process.argv[2],'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(r=>r&&!isTestGame(r)&&r.initialHands&&r.tricks&&r.tricks.length);
const V=process.env.VER?new RegExp(process.env.VER):null;
const C={ai:{p1:0,p1lost:0,p1pts:0,p2:0,p2lost:0,p2dump:0,p2pts:0,fol:0,void:0,lastT:0,lastN:0,games:0},h:{p1:0,p1lost:0,p1pts:0,p2:0,p2lost:0,p2dump:0,p2pts:0,fol:0,void:0,lastT:0,lastN:0,games:0}};
for(const r of rs){ if(V&&!V.test(r.version)) continue; const T=r.trump; let uid=0;
  const hands=r.initialHands.map(h=>h.map(x=>({suit:x[0],rank:+x.slice(1),id:'c'+(uid++)}))); let ok=true;
  const nT=r.tricks.length;
  for(const [ti,t] of r.tricks.entries()){ const plays=[];
    for(const [j,p] of t.plays.entries()){ const h=hands[p.seat], before=h.slice(), cards=[];
      for(const x of p.cards){ const k=h.findIndex(y=>y.suit+y.rank===x); if(k<0){ok=false;break;} cards.push(h.splice(k,1)[0]); } if(!ok) break;
      const who=p.seat===r.human?((p.by||'h')==='h'&&!p.hint?'h':null):'ai';
      if(who&&j>0&&cards.length===1&&plays[0].cards.length===1&&before.length>1){ const o=C[who]; o.fol++;
        const lead=E.classify(plays[0].cards,T), cur=E.currentWinner(plays,T), oppWin=cur.seat%2!==p.seat%2;
        const legal=before.filter(x=>E.isLegalFollow(before,lead,[x],T));
        const c=cards[0], cPts=E.cardPoints(c), side=E.effSuit(c,T)!=='T';
        const beats=E.currentWinner([...plays,{seat:p.seat,cards}],T).seat===p.seat;
        // 这墩最后归谁
        const full=t.plays.map(q=>({seat:q.seat,cards:q.cards.map(x=>({suit:x[0],rank:+x.slice(1)}))})); const w=E.resolveTrick(full,T).winner, lost=w%2!==p.seat%2;
        // P1:对手暂大、我没压、出的是副牌分,而有不带分的合法牌
        if(oppWin&&!beats&&side&&cPts>0&&legal.some(x=>E.cardPoints(x)===0)){ o.p1++; if(lost){o.p1lost++; o.p1pts+=cPts;} }
        // P2:断门(这门没有)、手里有主、没毙(出的不是主)、对手暂大或台面有分
        const voidS=!before.some(x=>E.effSuit(x,T)===lead.suit)&&lead.suit!=='T', hasT=before.some(x=>E.effSuit(x,T)==='T');
        if(voidS&&hasT){ o.void++; const tbl=E.countPoints(plays.flatMap(q=>q.cards));
          if(E.effSuit(c,T)!=='T'&&(oppWin||tbl>0)){ o.p2++; if(lost) o.p2lost++; if(cPts>0){o.p2dump++; o.p2pts+=cPts;} } }
      }
      plays.push({seat:p.seat,cards}); }
    if(!ok) break;
    // P3:倒数第 3 墩开始时各家手里的主
    if(ti===nT-8&&nT>=20) for(let s=0;s<4;s++){ const who=s===r.human?'h':'ai'; const tr=hands[s].filter(x=>E.effSuit(x,T)==='T'); C[who].m8T=(C[who].m8T||0)+tr.length; C[who].m8B=(C[who].m8B||0)+tr.filter(x=>x.suit==='X'||x.rank===T.rank||x.rank===14).length; C[who].m8N=(C[who].m8N||0)+1; }
    // 最后 3 墩里打出的主(浪费:收官才用掉)/ 整局打出的主
    if(ti>=nT-3) for(const q of t.plays){ const who=q.seat===r.human?'h':'ai'; C[who].endT=(C[who].endT||0)+q.cards.filter(x=>E.effSuit({suit:x[0],rank:+x.slice(1)},T)==='T').length; }
    for(const q of t.plays){ const who=q.seat===r.human?'h':'ai'; C[who].allT=(C[who].allT||0)+q.cards.filter(x=>E.effSuit({suit:x[0],rank:+x.slice(1)},T)==='T').length; }
    if(ti===nT-3) for(let s=0;s<4;s++){ const who=s===r.human?'h':'ai'; C[who].lastT+=hands[s].filter(x=>E.effSuit(x,T)==='T').length; C[who].lastN++; }
  }
}
for(const w of ['ai','h']){ const o=C[w]; console.log(`${w==='ai'?'AI':'真人'}:单张跟牌 ${o.fol} 手`);
  console.log(`  P1 对手暂大、没压、送副牌分(有不带分的牌可出):${o.p1} 次(占跟牌 ${(100*o.p1/o.fol).toFixed(1)}%),其中墩归对手 ${o.p1lost}(${(100*o.p1lost/Math.max(1,o.p1)).toFixed(0)}%),送掉 ${o.p1pts} 分`);
  console.log(`  P2 断门有主不毙(对手暂大或台面有分):${o.p2} / 断门有主 ${o.void}(${(100*o.p2/Math.max(1,o.void)).toFixed(0)}%),墩归对手 ${(100*o.p2lost/Math.max(1,o.p2)).toFixed(0)}%,其中还垫了分 ${o.p2dump} 次、${o.p2pts} 分`);
  console.log(`  P3 倒数第 3 墩时手里平均主 ${(o.lastT/Math.max(1,o.lastN)).toFixed(2)} 张;剩 8 张时主 ${(o.m8T/Math.max(1,o.m8N)).toFixed(2)} 张、其中大主(王/级/主A)${(o.m8B/Math.max(1,o.m8N)).toFixed(2)};整局打出的主里最后 3 墩才打出 ${(100*o.endT/Math.max(1,o.allT)).toFixed(0)}%`); }
