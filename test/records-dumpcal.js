/* AI 送副牌分 / 断门垫分时,它估的「这手之后本队拿下」准不准(2026-11-09,产品方问):真人牌谱,AI 座位,单张领出,出的是副牌分牌且没压。
 * 按估计分档,对比实际;另按「后面还有队友吗、队友是真人吗、是不是断门垫」拆。
 *   node test/records-dumpcal.js <牌谱.jsonl>   */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const sr=[...fs.readFileSync(path.join(__dirname,'..','80fen-test.html'),'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const cc={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};cc.globalThis=cc; vm.createContext(cc); vm.runInContext(sr,cc);
const E=cc.module.exports; E.AIP.egSearch=0;
const {isTestGame}=require('./records-filter.js');
const rs=fs.readFileSync(process.argv[2],'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(r=>r&&!isTestGame(r)&&r.initialHands&&r.tricks&&r.tricks.length);
const R=[];
for(const r of rs){ const T=r.trump, D=r.declSeat; let uid=0; const hands=r.initialHands.map(h=>h.map(x=>({suit:x[0],rank:+x.slice(1),id:'c'+(uid++)})));
  const buried=(r.buried||[]).map(x=>({suit:x[0],rank:+x.slice(1),id:'b'+(uid++)})); const history=[]; let ok=true;
  for(const t of r.tricks){ const plays=[];
    for(const [j,p] of t.plays.entries()){ const h=hands[p.seat], before=h.slice(), cards=[];
      for(const x of p.cards){ const k=h.findIndex(y=>y.suit+y.rank===x); if(k<0){ok=false;break;} cards.push(h.splice(k,1)[0]); } if(!ok) break;
      if(j>0&&p.seat!==r.human&&cards.length===1&&plays[0].cards.length===1&&before.length>1){ const lead=E.classify(plays[0].cards,T), cur=E.currentWinner(plays,T), c=cards[0];
        if(cur.seat%2!==p.seat%2&&E.effSuit(c,T)!=='T'&&E.cardPoints(c)>0&&E.currentWinner([...plays,{seat:p.seat,cards}],T).seat!==p.seat){
          const view={seat:p.seat,hand:before,trump:T,declSeat:D,history:history.concat(plays),buriedKnown:p.seat===D?buried:[],decl:Array.isArray(r.decl)?r.decl[r.decl.length-1]:r.decl,humanSeat:r.human};
          const X=E.followCtx(view,plays), est=E.pTeamWin(X,cards,false);
          const full=t.plays.map(q=>({seat:q.seat,cards:q.cards.map(x=>({suit:x[0],rank:+x.slice(1)}))})), won=E.resolveTrick(full,T).winner%2===p.seat%2?1:0;
          const mateBehind=t.plays.slice(j+1).some(q=>q.seat===(p.seat+2)%4), mateHum=(p.seat+2)%4===r.human;
          R.push({est,won,pts:E.cardPoints(c),voidS:!before.some(x=>E.effSuit(x,T)===lead.suit)?1:0,mateBehind:mateBehind?1:0,mateHum:mateHum?1:0}); } }
      plays.push({seat:p.seat,cards}); } if(!ok) break; history.push(...plays); } }
const m=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
const g=(t,a)=>{ if(a.length<8) return; console.log(`  ${t.padEnd(26)} n=${String(a.length).padStart(4)}  估 ${(100*m(a.map(r=>r.est))).toFixed(0).padStart(3)}%  实 ${(100*m(a.map(r=>r.won))).toFixed(0).padStart(3)}%   送出的分 ${a.filter(r=>!r.won).reduce((x,r)=>x+r.pts,0)} / 收回 ${a.filter(r=>r.won).reduce((x,r)=>x+r.pts,0)}`); };
console.log(`真人牌谱:AI 对手暂大时出副牌分牌、没压 —— ${R.length} 手`);
g('全部',R);
for(const [lo,hi] of [[0,0.2],[0.2,0.4],[0.4,0.5],[0.5,0.6],[0.6,0.7],[0.7,1.01]]) g(`估 ${lo}~${hi}`,R.filter(r=>r.est>=lo&&r.est<hi));
g('后面没有队友',R.filter(r=>!r.mateBehind)); g('后面有队友·AI',R.filter(r=>r.mateBehind&&!r.mateHum)); g('后面有队友·真人',R.filter(r=>r.mateBehind&&r.mateHum));
g('断门垫',R.filter(r=>r.voidS)); g('跟本门',R.filter(r=>!r.voidS));
