/* 压上去用哪张(信念第 4 步 c,11-01):推演里压牌一律用「最便宜的那张」,实际自对弈里同门压上去只有 39% 是最便宜的。
 * 样本:单张领出、第 2 / 3 家(后面还有人)真压了,而且「最便宜的那张」在他看来还可能被压、手里另有一张在他看来稳赢的(在外没有更大的)。
 * 标签 = 他用了稳赢的那一档(≥ 最便宜的稳赢张)。保(本队暂大)和抢(对手暂大)两类都收。
 *   node test/beatcard-data.js [html] [种子数=300]   (SEED0=;DUMP=)
 *   node test/beatcard-data.js --fit a.json ...      */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const names=['1','保(本队暂大)','毙','超毙','台面分/10','台面0分','稳赢张是王/级牌','稳赢张是主A/副A','最便宜那张上面在外张数/3','后面对手已知断这门','收官≤12张','稳赢张带分','最便宜带分'];
const feat=r=>[1,r.mate,r.kind===1?1:0,r.kind===2?1:0,Math.min(r.pts,40)/10,r.pts===0?1:0,r.safeJL,r.safeA,Math.min(r.above,6)/3,r.vB,r.n<=12?1:0,r.safePts>0?1:0,r.cheapPts>0?1:0];
if(process.argv[2]==='--fit'){
  const rows=process.argv.slice(3).flatMap(f=>JSON.parse(fs.readFileSync(f,'utf8')));
  const sig=z=>1/(1+Math.exp(-z)), ll=(p,y)=>{ p=Math.min(0.999,Math.max(0.001,p)); return -(y?Math.log(p):Math.log(1-p)); }, m=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
  const fit=rs=>{ const X=rs.map(feat), Y=rs.map(r=>r.safe), d=X[0].length; const w=new Array(d).fill(0);
    for(let it=0;it<60;it++){ const g=new Array(d).fill(0), H=Array.from({length:d},()=>new Array(d).fill(0));
      for(let i=0;i<X.length;i++){ const x=X[i]; let z=0; for(let j=0;j<d;j++) z+=w[j]*x[j]; const p=sig(z), e=p-Y[i], s=p*(1-p);
        for(let j=0;j<d;j++){ g[j]+=e*x[j]; for(let k=0;k<d;k++) H[j][k]+=s*x[j]*x[k]; } }
      for(let j=0;j<d;j++){ g[j]+=1e-2*w[j]; H[j][j]+=1e-2; }
      const A=H.map((row,j)=>[...row,g[j]]);
      for(let j=0;j<d;j++){ let q=j; for(let k=j+1;k<d;k++) if(Math.abs(A[k][j])>Math.abs(A[q][j])) q=k; [A[j],A[q]]=[A[q],A[j]];
        for(let k=0;k<d;k++){ if(k===j) continue; const f=A[k][j]/A[j][j]; for(let l=j;l<=d;l++) A[k][l]-=f*A[j][l]; } }
      let mx=0; for(let j=0;j<d;j++){ const st=A[j][d]/A[j][j]; w[j]-=st; mx=Math.max(mx,Math.abs(st)); } if(mx<1e-8) break; }
    return w; };
  const pr=(w,r)=>sig(feat(r).reduce((a,v,j)=>a+v*w[j],0));
  const A=rows.filter((r,i)=>i%2===0), Bh=rows.filter((r,i)=>i%2===1), wA=fit(A), wB=fit(Bh), w=fit(rows), base=m(rows.map(r=>r.safe));
  const cv=m([...Bh.map(r=>ll(pr(wA,r),r.safe)),...A.map(r=>ll(pr(wB,r),r.safe))]);
  console.log(`${rows.length} 个样本,用稳赢张 ${(100*base).toFixed(0)}%;对数损失 只用比例 ${m(rows.map(r=>ll(base,r.safe))).toFixed(4)} → 模型(两折)${cv.toFixed(4)}`);
  console.log('beatSafeW: ['+w.map(v=>+v.toFixed(4)).join(',')+']');
  console.log('   '+names.map((n,j)=>`${n} ${w[j].toFixed(2)}`).join(' | '));
  const grp=(t,f)=>{ const a=rows.filter(f); if(a.length<30) return; console.log(`   ${t.padEnd(24)} n=${String(a.length).padStart(5)} 模型 ${(100*m(a.map(r=>pr(w,r)))).toFixed(0)}% 实 ${(100*m(a.map(r=>r.safe))).toFixed(0)}%`); };
  for(const mt of [1,0]) for(const k of [0,1,2]) grp(`${mt?'保':'抢'}·${['同门','毙','超毙'][k]}`,r=>r.mate===mt&&r.kind===k);
  grp('台面 0 分',r=>r.pts===0); grp('台面有分',r=>r.pts>0); grp('稳赢张是王/级牌',r=>r.safeJL); grp('稳赢张不是王/级牌',r=>!r.safeJL);
  process.exit(0);
}
const FILE=process.argv[2]||path.join(__dirname,'..','80fen-test.html'), N=+process.argv[3]||300, S0=+(process.env.SEED0||0);
const sr=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const cc={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};cc.globalThis=cc; vm.createContext(cc); vm.runInContext(sr,cc);
const E=cc.module.exports; if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV)); if(process.env.EG!=='1') E.AIP.egSearch=0;
const W=[];
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
      if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,T); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,T); cards=E.aiChooseFollow(view,plays).cards; if(!E.isLegalFollow(hand,lead,cards,T)) cards=E.genFollow(hand,lead,T,E.rng(seed));
        if((i===1||i===2)&&lead.type==='single'&&cards.length===1&&E.currentWinner([...plays,{seat,cards}],T).seat===seat){
          const mem=E.makeMemory(view);
          const above=c=>{ const su=E.effSuit(c,T), ix=E.ordIdx(c,T); let n=0; for(const k in mem.unseen){ const u=E.keyToCard(k); if(mem.unseen[k]>0&&E.effSuit(u,T)===su&&E.ordIdx(u,T)>ix) n+=mem.unseen[k]; } return n; };
          const bs=hand.filter(c=>E.isLegalFollow(hand,lead,[c],T)&&E.currentWinner([...plays,{seat,cards:[c]}],T).seat===seat).sort((a,b)=>E.ordIdx(a,T)-E.ordIdx(b,T));
          const cheap=bs[0], safe=bs.find(c=>above(c)===0);
          if(bs.length>=2&&safe&&above(cheap)>0){
            const cur=E.currentWinner(plays,T), ccl=E.classify(plays.find(p=>p.seat===cur.seat).cards,T), ls=lead.suit;
            const kind=ccl.suit==='T'&&ls!=='T'?2:(ls!=='T'&&E.effSuit(cheap,T)==='T'?1:0);
            const behind=[]; for(let j=i+1;j<4;j++) behind.push((leader+j)%4);
            const vd=E.makeVoids(history,T);
            W.push({mate:cur.seat%2===seat%2?1:0,kind,pts:E.countPoints(plays.flatMap(p=>p.cards)),
              safeJL:safe.suit==='X'||safe.rank===T.rank?1:0,safeA:safe.rank===14&&safe.suit!=='X'?1:0,above:above(cheap),
              vB:behind.some(z=>z%2!==seat%2&&vd[z][ls])?1:0,n:hand.length,safePts:E.cardPoints(safe),cheapPts:E.cardPoints(cheap),
              safe:E.ordIdx(cards[0],T)>=E.ordIdx(safe,T)&&E.effSuit(cards[0],T)===E.effSuit(safe,T)?1:0});
          } } }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards}); }
    const res=E.resolveTrick(plays,T); history.push(...plays); leader=res.winner; }
}
if(process.env.DUMP) fs.writeFileSync(process.env.DUMP,JSON.stringify(W));
console.log(`${N} 副,${W.length} 个样本,用稳赢张 ${(100*W.filter(r=>r.safe).length/W.length).toFixed(0)}%`);
