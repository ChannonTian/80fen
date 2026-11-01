/* 领出模型(信念第 4 步 b,10-31):单张领出时领的是哪一类(8 类:主 / 副 × 大(A / 级 / 王) / 分牌 / J·Q / 小),
 * 对领出那家**领之前的手牌**做多项 logistic。用来给抽样世界加权:「在这个世界里,他会不会领这一类」。
 *   node test/lead-data.js [html] [种子数=300]          自对弈(AI 领出)   SEED0=;DUMP=x.json
 *   node test/lead-data.js --records <牌谱>... DUMP=     真人领出(by=h、不照提示、不是重打)
 *   node test/lead-data.js --fit a.json ...            两折对数损失 + 系数(按 who 分开拟:ai / human) */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const CL=['主·大','主·分','主·JQ','主·小','副·大','副·分','副·JQ','副·小'];
const load=f=>{ const sr=[...fs.readFileSync(f,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
  const cc={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};cc.globalThis=cc; vm.createContext(cc); vm.runInContext(sr,cc); return cc.module.exports; };
const args=process.argv.slice(2);
if(args[0]==='--fit'){
  const rows=args.slice(1).flatMap(f=>JSON.parse(fs.readFileSync(f,'utf8'))), K=8;
  // 条件 logit:只在他手里有的那几类之间归一(r.a = 有哪几类的位掩码)
  function P(W,r){ const z=W.map(w=>w.reduce((a,v,j)=>a+v*r.f[j],0)); let mx=-1e9; for(let k=0;k<K;k++) if(r.a>>k&1) mx=Math.max(mx,z[k]);
    const e=z.map((v,k)=>r.a>>k&1?Math.exp(v-mx):0), S=e.reduce((a,b)=>a+b,0); return e.map(v=>v/S); }
  const fitW=rs=>{ const d=rs[0].f.length; const W=Array.from({length:K},()=>new Array(d).fill(0)); let lr=0.5;
    for(let it=0;it<1500;it++){ const G=Array.from({length:K},()=>new Array(d).fill(0));
      for(const r of rs){ const q=P(W,r);
        for(let k=0;k<K;k++){ const g=q[k]-(r.y===k?1:0); if(!g) continue; for(let j=0;j<d;j++) G[k][j]+=g*r.f[j]; } }
      for(let k=0;k<K;k++) for(let j=0;j<d;j++) W[k][j]-=lr*(G[k][j]/rs.length+1e-3*W[k][j]); }
    return W; };
  const fit=rs=>fitW(rs);
  const m=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
  for(const who of ['ai','human']){ const rs=rows.filter(r=>r.who===who); if(rs.length<100) continue;
    const fr=new Array(K).fill(0); rs.forEach(r=>fr[r.y]++); const base=m(rs.map(r=>{ let S=0; for(let k=0;k<K;k++) if(r.a>>k&1) S+=fr[k]; return -Math.log(Math.max(1e-3,fr[r.y]/S)); }));
    const A=rs.filter((r,i)=>i%2===0), B=rs.filter((r,i)=>i%2===1), WA=fit(A), WB=fit(B);
    const cv=m([...B.map(r=>-Math.log(Math.max(1e-4,P(WA,r)[r.y]))),...A.map(r=>-Math.log(Math.max(1e-4,P(WB,r)[r.y])))]);
    const W=fit(rs);
    console.log(`${who}: ${rs.length} 个单张领出;各类 ${CL.map((c,k)=>`${c} ${(100*fr[k]/rs.length).toFixed(0)}%`).join(' ')}`);
    console.log(`  对数损失 只用比例 ${base.toFixed(4)} → 模型(两折)${cv.toFixed(4)}`);
    console.log(`  leadModel${who==='ai'?'AI':'Human'}: `+JSON.stringify(W.map(w=>w.map(v=>+v.toFixed(3)))));
    // 主·小 那一类:模型按手里大主多少分档的校准
    for(const [t,f]of [['手里大主 0',r=>r.f[2]===0],['大主 1~2',r=>r.f[2]>0&&r.f[2]<=2/3],['大主 ≥3',r=>r.f[2]>2/3]]){
      const a=rs.filter(f); if(a.length<30) continue;
      console.log(`  ${t.padEnd(10)} n=${String(a.length).padStart(5)}  领主·小 模型 ${(100*m(a.map(r=>P(W,r)[3]))).toFixed(0)}% 实 ${(100*m(a.map(r=>r.y===3?1:0))).toFixed(0)}%   领主·大 模型 ${(100*m(a.map(r=>P(W,r)[0]))).toFixed(0)}% 实 ${(100*m(a.map(r=>r.y===0?1:0))).toFixed(0)}%`); }
  }
  process.exit(0);
}
const R=[];
if(args[0]==='--records'){
  const {isTestGame}=require('./records-filter.js'); const E=load(path.join(__dirname,'..','80fen-test.html')); const seen=new Set();
  for(const f of args.slice(1)) for(const l of fs.readFileSync(f,'utf8').split('\n')){ if(!l.trim()) continue; let r; try{ r=JSON.parse(l); }catch(e){ continue; }
    if(seen.has(r.id)||!r.tricks||!r.tricks.length||!r.initialHands||isTestGame(r)||r.replay) continue; seen.add(r.id);
    const T=r.trump, D=r.declSeat; let uid=0, ok=true;
    const hands=r.initialHands.map(h=>h.map(x=>({suit:x[0],rank:+x.slice(1),id:'c'+(uid++)})));
    for(const t of r.tricks){ for(const p of t.plays){ const h=hands[p.seat];
        if(p===t.plays[0]&&p.cards.length===1&&h.length>1){ const human=p.seat===r.human&&(p.by||'h')==='h'&&!p.hint;
          const c={suit:p.cards[0][0],rank:+p.cards[0].slice(1)};
          if(human||p.seat!==r.human) R.push({who:human?'human':'ai',f:E.leadHandFeat(h,T,p.seat%2===D%2),a:E.leadAvail(h,T),y:E.leadClass8(c,T)}); }
        for(const x of p.cards){ const k=h.findIndex(y=>y.suit+y.rank===x); if(k<0){ ok=false; break; } h.splice(k,1); } if(!ok) break; } if(!ok) break; }
  }
}else{
  const FILE=args[0]||path.join(__dirname,'..','80fen-test.html'), N=+args[1]||300, S0=+(process.env.SEED0||0);
  const E=load(FILE); if(process.env.EG!=='1') E.AIP.egSearch=0;
  for(let seed=S0+1;seed<=S0+N;seed++){
    const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
    let best=null,D=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;D=s;}}
    const T=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) D=first;
    hands[D].push(...kitty); const buried=E.aiDiscard(hands[D],T); buried.forEach(x=>E.removeCard(hands[D],x));
    const history=[]; let leader=D;
    while(hands.some(h=>h.length)){ const plays=[];
      for(let i=0;i<4;i++){ const seat=(leader+i)%4, hand=hands[seat];
        const view={seat,hand,trump:T,declSeat:D,history:[...history,...plays],buriedKnown:seat===D?buried:[]};
        let cards;
        if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,T); if(!chk.ok) cards=chk.forced;
          if(cards.length===1&&hand.length>1) R.push({who:'ai',f:E.leadHandFeat(hand,T,seat%2===D%2),a:E.leadAvail(hand,T),y:E.leadClass8(cards[0],T)}); }
        else{ const lead=E.classify(plays[0].cards,T); cards=E.aiChooseFollow(view,plays).cards; if(!E.isLegalFollow(hand,lead,cards,T)) cards=E.genFollow(hand,lead,T,E.rng(seed)); }
        cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards}); }
      const res=E.resolveTrick(plays,T); history.push(...plays); leader=res.winner; }
  }
}
if(process.env.DUMP) fs.writeFileSync(process.env.DUMP,JSON.stringify(R));
console.log(`${R.length} 个单张领出(ai ${R.filter(r=>r.who==='ai').length}、真人 ${R.filter(r=>r.who==='human').length})`);
