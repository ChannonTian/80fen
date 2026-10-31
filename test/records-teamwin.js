/* 真人牌谱上的「这一手之后本队拿下这墩」校准(2026-10-25):AI 第 2 / 3 家、单张领出时实际出的那一手 ——
 * 现 pTeamWin vs teamWinBelief vs teamWinBelief + 真人修正(willHuman),实 = 这墩真实结果(后手有真人)。
 *   node test/records-teamwin.js <牌谱>...      */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const {isTestGame}=require('./records-filter.js');
const files=process.argv.slice(2);
const sr=[...fs.readFileSync(path.join(__dirname,'..','80fen-test.html'),'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const cc={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};cc.globalThis=cc; vm.createContext(cc); vm.runInContext(sr,cc); const E=cc.module.exports; E.AIP.egSearch=0;
const code=x=>x.suit+x.rank; const R=[]; const seen=new Set();
const HUM=[-0.36,0.86,-0.73];
for(const f of files) for(const l of fs.readFileSync(f,'utf8').split('\n')){ if(!l.trim()) continue; let r; try{ r=JSON.parse(l); }catch(e){ continue; }
  if(seen.has(r.id)||!r.tricks||!r.tricks.length||isTestGame(r)) continue; seen.add(r.id);
  const T=r.trump; let uid=0; const D=r.declSeat;
  const hands=r.initialHands.map(h=>h.map(x=>({suit:x[0],rank:+x.slice(1),id:'c'+(uid++)})));
  const buried=(r.buried||[]).map(x=>({suit:x[0],rank:+x.slice(1),id:'b'+(uid++)}));
  const history=[]; let ok=true;
  for(const t of r.tricks){ const plays=[]; const pend=[];
    for(const p of t.plays){ const h=hands[p.seat], before=h.slice(), cards=[];
      for(const x of p.cards){ const k=h.findIndex(y=>code(y)===x); if(k<0){ ok=false; break; } cards.push(h.splice(k,1)[0]); } if(!ok) break;
      if(p.seat!==r.human&&(plays.length===1||plays.length===2)&&cards.length===1&&before.length>1){
        const lead=E.classify(plays[0].cards,T);
        if(lead.type==='single'){ const view={seat:p.seat,hand:before,trump:T,declSeat:D,history:history.concat(plays),buriedKnown:p.seat===D?buried:[],decl:r.decl,humanSeat:r.human};
          const X=E.followCtx(view,plays); const bc=E.currentWinner([...plays,{seat:p.seat,cards}],T).seat===p.seat;
          const p0=E.pTeamWin(X,cards,bc); const B=E.makeBelief(view,plays,30);
          const v0={...view}; delete v0.humanSeat; const X1=E.followCtx(v0,plays); const p1=E.teamWinBelief(X1,cards,B);
          E.AIP.willHuman=HUM; const p2=E.teamWinBelief(X,cards,B); E.AIP.willHuman=null;
          const humBehind=t.plays.slice(plays.length+1).some(q=>q.seat===r.human);
          const my=E.cardPoints(cards[0]), gain=X.ptsTable+my+E.laterPoints(X,true), loss=X.ptsTable+my+E.laterPoints(X,false);
          E.AIP.willHuman=HUM; const tv=E.trickEVBelief(X,cards,B); E.AIP.willHuman=null;
          const ev0=p2*gain-(1-p2)*loss, ev1=tv?tv.ev:null;
          const humPos=humBehind?'后':plays[0].seat===r.human?'领':'前', humMate=(r.human%2)===(p.seat%2)?1:0;
          if(p1!==null) pend.push({p0,p1,p2,ev0,ev1,seat:p.seat,bc:bc?1:0,humBehind:humBehind?1:0,humPos,humMate,pos:plays.length+1,decl:p.seat%2===D%2?1:0,left:before.length,leadHum:plays[0].seat===r.human?1:0,lc:plays[0].cards[0],trump:T}); } }
      plays.push({seat:p.seat,cards}); }
    if(!ok||plays.length<4) break;
    const w=E.resolveTrick(plays,T).winner, tp=E.countPoints(plays.flatMap(q=>q.cards)); for(const o of pend) R.push({...o,y:w%2===o.seat%2?1:0,evY:w%2===o.seat%2?tp:-tp});
    history.push(...plays); }
}
const ll=(p,y)=>{ p=Math.min(0.999,Math.max(0.001,p)); return -(y?Math.log(p):Math.log(1-p)); };
const m=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
const g=(t,a)=>{ if(!a.length) return; console.log(`  ${t.padEnd(22)} n=${String(a.length).padStart(4)}  现 ${(100*m(a.map(r=>r.p0))).toFixed(0)}% 新 ${(100*m(a.map(r=>r.p1))).toFixed(0)}% 新+真人 ${(100*m(a.map(r=>r.p2))).toFixed(0)}% 实 ${(100*m(a.map(r=>r.y))).toFixed(0)}%   损失 ${m(a.map(r=>ll(r.p0,r.y))).toFixed(3)} / ${m(a.map(r=>ll(r.p1,r.y))).toFixed(3)} / ${m(a.map(r=>ll(r.p2,r.y))).toFixed(3)}`); };
console.log(`真人牌谱:AI 第 2 / 3 家单张 ${R.length} 手(损失:现 / 新 / 新+真人修正)`);
g('全部',R); g('后手有真人',R.filter(r=>r.humBehind)); g('后手没有真人',R.filter(r=>!r.humBehind)); g('压过当前最大',R.filter(r=>r.bc)); g('不压',R.filter(r=>!r.bc));
g('后手有真人·压',R.filter(r=>r.humBehind&&r.bc)); g('后手有真人·不压',R.filter(r=>r.humBehind&&!r.bc));
const mse=(a,k)=>m(a.filter(r=>r[k]!==null).map(r=>(r[k]-r.evY)**2));
const ge=(t,a)=>console.log(`  ${t.padEnd(14)} n=${String(a.length).padStart(4)} 本墩得失分均方误差 旧式(p×得−(1−p)×失,laterPoints 常数)${mse(a,'ev0').toFixed(1)} → 逐世界走完 + 放分模型 ${mse(a,'ev1').toFixed(1)}   平均 旧 ${m(a.map(r=>r.ev0)).toFixed(2)} 新 ${m(a.filter(r=>r.ev1!==null).map(r=>r.ev1)).toFixed(2)} 实 ${m(a.map(r=>r.evY)).toFixed(2)}`);
ge('全部',R); ge('后手有真人',R.filter(r=>r.humBehind)); ge('后手没有真人',R.filter(r=>!r.humBehind));
// 偏乐观拆开看(10-31):真人坐哪 × 是不是队友、AI 第几家、AI 是不是庄家方、剩几张
console.log('\n按真人位置 / 阵营拆(本队拿下 估 vs 实、本墩得失分 估 vs 实):');
const gb=(t,a)=>{ if(!a.length) return; console.log(`  ${t.padEnd(18)} n=${String(a.length).padStart(4)}  拿下 估 ${(100*m(a.map(r=>r.p2))).toFixed(0)}% 实 ${(100*m(a.map(r=>r.y))).toFixed(0)}%   得失分 估 ${m(a.filter(r=>r.ev1!==null).map(r=>r.ev1)).toFixed(2)} 实 ${m(a.map(r=>r.evY)).toFixed(2)}`); };
for(const hp of ['领','前','后']) for(const hm of [1,0]) gb(`真人${hp}·${hm?'队友':'对手'}`,R.filter(r=>r.humPos===hp&&r.humMate===hm));
for(const ps of [2,3]) gb(`AI 第 ${ps} 家`,R.filter(r=>r.pos===ps));
gb('AI 庄家方',R.filter(r=>r.decl)); gb('AI 闲家方',R.filter(r=>!r.decl));
gb('剩 >16 张',R.filter(r=>r.left>16)); gb('剩 9~16 张',R.filter(r=>r.left>8&&r.left<=16)); gb('剩 ≤8 张',R.filter(r=>r.left<=8));
// AI 第 2 家、领出的是对手:真人领 vs AI 领,按领的那张分
const lk=r=>{ const c=r.lc, T=r.trump, t=E.effSuit(c,r.trump)==='T', pt=E.cardPoints(c);
  return (t?'主':'副')+'·'+(c.suit==='X'||c.rank===T.rank||c.rank===14?'大(A/级/王)':pt?'分牌':c.rank>=11?'J/Q':'小'); };
console.log('\nAI 第 2 家、对手领出单张:按领的那张(真人领 | AI 领):');
const P2=R.filter(r=>r.pos===2), ks=[...new Set(P2.map(lk))].sort();
const f=a=>a.length?`n=${String(a.length).padStart(3)} 拿下 估 ${(100*m(a.map(r=>r.p2))).toFixed(0)}% 实 ${(100*m(a.map(r=>r.y))).toFixed(0)}% 得失 估 ${m(a.filter(r=>r.ev1!==null).map(r=>r.ev1)).toFixed(1)} 实 ${m(a.map(r=>r.evY)).toFixed(1)}`:'—';
for(const k of ks){ const a=P2.filter(r=>lk(r)===k); console.log(`  ${k.padEnd(10)} 真人领 ${f(a.filter(r=>r.leadHum))}  |  AI 领 ${f(a.filter(r=>!r.leadHum))}`); }
