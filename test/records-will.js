/* 真人牌谱里的「意愿」样本(belief-plan ④,2026-10-25):AI 在第 2 / 3 家压下当前最大的单张后,后手对手**手里真有**压得住 / 毙得了 / 超毙得了的牌时,
 * 他真的压了吗(他赢下这墩)。分「后手是真人」和「后手是 AI」,和 calib-belief(自对弈)同一套特征 —— 给 fit-will.js 拟合真人那一份。
 *   node test/records-will.js <牌谱>... [--out=w.json]      */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const {isTestGame}=require('./records-filter.js');
const args=process.argv.slice(2), files=args.filter(a=>!a.startsWith('--'));
const OUT=(args.find(a=>a.startsWith('--out='))||'').slice(6);
const sr=[...fs.readFileSync(path.join(__dirname,'..','80fen-test.html'),'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const cc={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};cc.globalThis=cc; vm.createContext(cc); vm.runInContext(sr,cc); const E=cc.module.exports;
const code=x=>x.suit+x.rank;
const recs=[]; const seen=new Set();
for(const f of files) for(const l of fs.readFileSync(f,'utf8').split('\n')){ if(!l.trim()) continue; try{ const r=JSON.parse(l); if(seen.has(r.id)) continue; seen.add(r.id); if(r.tricks&&r.tricks.length&&!r.replay&&!isTestGame(r)) recs.push(r); }catch(e){} }
const W=[];
for(const r of recs){
  const T=r.trump; let uid=0;
  const hands=r.initialHands.map(h=>h.map(x=>({suit:x[0],rank:+x.slice(1),id:'c'+(uid++)})));
  let ok=true;
  for(const t of r.tricks){
    const pre=hands.map(h=>h.slice()); const plays=[];
    for(const p of t.plays){ const h=hands[p.seat], cards=[];
      for(const x of p.cards){ const k=h.findIndex(y=>code(y)===x); if(k<0){ ok=false; break; } cards.push(h.splice(k,1)[0]); }
      if(!ok) break; plays.push({seat:p.seat,cards,by:p.by}); }
    if(!ok||plays.length<4) break;
    const lead=E.classify(plays[0].cards,T); if(!lead||lead.type!=='single') continue;
    const winner=E.resolveTrick(plays,T).winner;
    for(const i of [1,2]){ const x=plays[i]; if(x.seat===r.human&&x.by==='h') continue;    // 压牌的那家是 AI
      const before=plays.slice(0,i); if(E.currentWinner([...before,x],T).seat!==x.seat) continue;
      const cl=E.classify(x.cards,T); const myN=pre[x.seat].length;
      const tblAfter=E.countPoints(plays.slice(0,i+1).flatMap(p=>p.cards));
      const rem=plays.slice(i+1).map(p=>p.seat); const lastSeat=rem[rem.length-1];
      for(let j=i+1;j<4;j++){ const s=plays[j].seat; if(s%2===x.seat%2) continue;
        // 他出牌之前:台面上我的那张还是最大才算(前面的对手已经压过了就不算他的机会)
        if(E.currentWinner(plays.slice(0,j),T).seat!==x.seat) continue;
        const H=pre[s]; const ls=lead.suit, hasLead=H.some(c=>E.effSuit(c,T)===ls), tr=H.filter(c=>E.effSuit(c,T)==='T');
        const iR=cl.suit==='T'&&ls!=='T'; let beaters,kind;
        if(iR){ kind='超毙'; beaters=hasLead?[]:tr.filter(c=>E.ordIdx(c,T)>cl.top); }
        else if(ls!=='T'&&!hasLead){ kind='毙'; beaters=tr; }
        else { kind='同门压'; beaters=H.filter(c=>E.effSuit(c,T)===cl.suit&&E.ordIdx(c,T)>cl.top); }
        if(!beaters.length) continue;
        const ch=beaters.sort((a,b)=>E.ordIdx(a,T)-E.ordIdx(b,T))[0];
        const human=s===r.human&&plays[j].by==='h';
        const beat=E.currentWinner(plays.slice(0,j+1),T).seat===s?1:0;
        W.push({kind,last:s===lastSeat?1:0,pts:tblAfter,cheapPts:E.cardPoints(ch),cheapBig:ch.suit==='X'||ch.rank===T.rank||(E.effSuit(ch,T)==='T'&&ch.rank===14)?1:0,
          nB:beaters.length,n:myN,beat,partnerAfter:rem.slice(rem.indexOf(s)+1).some(z=>z%2===x.seat%2)?1:0,human:human?1:0});
      } }
  }
}
// --all:和 will-data.js 同口径 —— 单张领出的墩里,任何一家出牌时本队暂时输着、手里真有压得过当前最大的牌
if(args.includes('--all')){ W.length=0;
  for(const r of recs){ const T=r.trump; let uid=0; const hands=r.initialHands.map(h=>h.map(x=>({suit:x[0],rank:+x.slice(1),id:'c'+(uid++)}))); let ok=true;
    for(const t of r.tricks){ const pre=hands.map(h=>h.slice()); const plays=[];
      for(const p of t.plays){ const h=hands[p.seat], cards=[]; for(const x of p.cards){ const k=h.findIndex(y=>code(y)===x); if(k<0){ ok=false; break; } cards.push(h.splice(k,1)[0]); } if(!ok) break; plays.push({seat:p.seat,cards,by:p.by}); }
      if(!ok||plays.length<4) break;
      const lead=E.classify(plays[0].cards,T); if(!lead||lead.type!=='single') continue;
      for(let j=1;j<4;j++){ const s=plays[j].seat, before=plays.slice(0,j); const cur=E.currentWinner(before,T); if(cur.seat%2===s%2) continue;
        const H=pre[s]; const ccl=E.classify(before.find(p=>p.seat===cur.seat).cards,T);
        const ls=lead.suit, hasLead=H.some(c=>E.effSuit(c,T)===ls), tr=H.filter(c=>E.effSuit(c,T)==='T'); const curRuff=ccl.suit==='T'&&ls!=='T';
        let kind,beaters; if(curRuff){ kind=2; beaters=hasLead?[]:tr.filter(c=>E.ordIdx(c,T)>ccl.top); } else if(ls!=='T'&&!hasLead){ kind=1; beaters=tr; } else { kind=0; beaters=H.filter(c=>E.effSuit(c,T)===ccl.suit&&E.ordIdx(c,T)>ccl.top); }
        if(!beaters.length) continue; let ch=beaters[0]; for(const c of beaters) if(E.ordIdx(c,T)<E.ordIdx(ch,T)) ch=c;
        const behind=plays.slice(j+1).map(p=>p.seat); const pts=E.countPoints(before.flatMap(p=>p.cards));
        W.push({kind,last:j===3?1:0,pts,cheapPts:E.cardPoints(ch),cheapBig:ch.suit==='X'||ch.rank===T.rank||(E.effSuit(ch,T)==='T'&&ch.rank===14)?1:0,nB:beaters.length,
          oppBehind:behind.some(z=>z%2!==s%2)?1:0,mateBehind:behind.some(z=>z%2===s%2)?1:0,n:H.length,
          beat:E.currentWinner(plays.slice(0,j+1),T).seat===s?1:0,human:s===r.human&&plays[j].by==='h'?1:0}); } } }
  const m=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
  const K=['同门','毙','超毙'];
  console.log(`[--all] 样本 ${W.length}(真人 ${W.filter(r=>r.human).length}、AI ${W.filter(r=>!r.human).length})`);
  for(const k of [0,1,2]) for(const l of [0,1]) for(const pz of [0,1]){ const f=r=>r.kind===k&&r.last===l&&(r.pts>0?1:0)===pz; const h=W.filter(r=>r.human&&f(r)), a=W.filter(r=>!r.human&&f(r));
    console.log(`  ${(K[k]+'·'+(l?'末家':'非末家')+'·'+(pz?'有分':'0分')).padEnd(14)} 真人 n=${String(h.length).padStart(4)} ${h.length?(100*m(h.map(r=>r.beat))).toFixed(0)+'%':'-'}   AI n=${String(a.length).padStart(4)} ${a.length?(100*m(a.map(r=>r.beat))).toFixed(0)+'%':'-'}`); }
}
if(OUT) fs.writeFileSync(OUT,JSON.stringify(W));
const m=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
console.log(`${recs.length} 局;样本 ${W.length}(后手是真人 ${W.filter(r=>r.human).length}、是 AI ${W.filter(r=>!r.human).length})`);
const g=(t,f)=>{ const h=W.filter(r=>r.human&&f(r)), a=W.filter(r=>!r.human&&f(r));
  console.log(`  ${t.padEnd(22)} 真人 n=${String(h.length).padStart(4)} 压了 ${h.length?(100*m(h.map(r=>r.beat))).toFixed(0):'-'}%   AI n=${String(a.length).padStart(4)} 压了 ${a.length?(100*m(a.map(r=>r.beat))).toFixed(0):'-'}%`); };
for(const k of ['同门压','毙','超毙']){ g(k,r=>r.kind===k); g(k+'·末家·有分',r=>r.kind===k&&r.last&&r.pts>0); g(k+'·末家·0分',r=>r.kind===k&&r.last&&r.pts===0);
  g(k+'·非末家·有分',r=>r.kind===k&&!r.last&&r.pts>0); g(k+'·非末家·0分',r=>r.kind===k&&!r.last&&r.pts===0); g(k+'·最便宜是大牌',r=>r.kind===k&&r.cheapBig); }
