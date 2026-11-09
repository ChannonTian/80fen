/* 跟牌打分各项的权重对不对(belief-plan ③,2026-10-25):用定点反事实回归 scorePlay 的拆项。
 *
 *   node test/fit-score.js collect [html] [种子数=100]     (SEED0=;DUMP=x.json;OV=)   收集
 *   node test/fit-score.js fit a.json b.json ...                                       拟合(奇数文件训练、偶数文件检验)
 *
 * 每个跟牌决策(单张领出、至少两个候选)取打分前 4 的候选,各用真 AI(搜索关)从真实牌打完整局,记本队得分 / 净升级。
 * 回归:局面内去均值后,结果 ≈ w · [期望分 ev, 牌权 tempo, −留手代价 fut, 跨台阶 lad, −规则加成 pen, 其余(打分之后的修正)]。
 * 现在的打分等于各项权重都是 1;拟合出来的相对权重偏离 1 的,就是那一项的常数标得不对。
 * 再在检验文件上比:按拟合权重选 vs AI 现在的选择,结果差多少。
 */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const mode=process.argv[2];
if(mode==='collect'){
  const FILE=process.argv[3]||path.join(__dirname,'..','80fen-test.html'), N=+process.argv[4]||100, S0=+(process.env.SEED0||0);
  const sr=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
  const cc={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};cc.globalThis=cc; vm.createContext(cc); vm.runInContext(sr,cc);
  const E=cc.module.exports; if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV)); E.AIP.egSearch=0;
  const cloneH=hs=>hs.map(h=>h.slice());
  function playOut(hands,history,plays,leader,T,D,buried,dp,seat,cards){
    hands=cloneH(hands); history=history.slice(); let ps=plays.map(p=>({seat:p.seat,cards:p.cards.slice()}));
    cards.forEach(x=>E.removeCard(hands[seat],x)); ps.push({seat,cards});
    let last=null, defPoints=dp;
    for(;;){ while(ps.length<4){ const s=(leader+ps.length)%4, hand=hands[s];
        const v={seat:s,hand,trump:T,declSeat:D,history:[...history,...ps],buriedKnown:s===D?buried:[]};
        let cs; if(!ps.length){ cs=E.aiChooseLead(v).cards; const chk=E.checkThrow(hands,s,cs,T); if(!chk.ok) cs=chk.forced; }
        else{ const lead=E.classify(ps[0].cards,T); cs=E.aiChooseFollow(v,ps).cards; if(!E.isLegalFollow(hand,lead,cs,T)) cs=E.genFollow(hand,lead,T,E.rng(1)); }
        cs.forEach(x=>E.removeCard(hand,x)); ps.push({seat:s,cards:cs}); }
      const res=E.resolveTrick(ps,T); if(res.winner%2!==D%2) defPoints+=E.countPoints(ps.flatMap(p=>p.cards));
      last={w:res.winner,size:ps[0].cards.length}; history.push(...ps); leader=res.winner; ps=[];
      if(!hands.some(h=>h.length)) break; }
    const sc=E.scoreRound({defPoints,kitty:buried,defWonLastTrick:last.w%2!==D%2,lastLeadSize:last.size});
    return {u:E.levelUtility(sc,seat%2,D%2), pts:seat%2===D%2?200-sc.total:sc.total};
  }
  const G=[];
  for(let seed=S0+1;seed<=S0+N;seed++){
    const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
    let best=null,D=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;D=s;}}
    const T=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) D=first;
    hands[D].push(...kitty); const buried=E.aiDiscard(hands[D],T); buried.forEach(x=>E.removeCard(hands[D],x));
    const history=[]; let leader=D, dp=0, tn=0;
    while(hands.some(h=>h.length)){ tn++; const plays=[];
      for(let i=0;i<4;i++){ const seat=(leader+i)%4, hand=hands[seat];
        const view={seat,hand,trump:T,declSeat:D,history:[...history,...plays],buriedKnown:seat===D?buried:[]};
        let cards;
        if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,T); if(!chk.ok) cards=chk.forced; }
        else{ const lead=E.classify(plays[0].cards,T); const q=E.aiChooseFollow(view,plays); cards=q.cards;
          if(lead.type==='single'&&hand.length>1&&(tn+i)%2===0){
            const cs=(q.cands||[]).filter(c=>c.parts).slice().sort((a,b)=>b.score-a.score);
            const seen=new Set(), top=[]; for(const c of cs){ const k=c.cards.map(x=>x.suit+x.rank).sort().join(); if(seen.has(k)) continue; seen.add(k); top.push(c); if(top.length>=4) break; }
            if(top.length>=2){
              const chosenK=cards.map(x=>x.suit+x.rank).sort().join();
              const g={n:hand.length,pos:i+1,c:[]};
              for(const c of top){ const o=playOut(hands,history,plays,leader,T,D,buried,dp,seat,c.cards); const pt=c.parts;
                const resid=c.score-(pt.ev+pt.tempo-pt.fut+pt.lad-pt.pen);
                g.c.push({ev:pt.ev,tempo:pt.tempo,fut:pt.fut,lad:pt.lad,pen:pt.pen,resid,score:c.score,p:pt.p,cat:pt.cat,u:o.u,pts:o.pts,
                  chosen:c.cards.map(x=>x.suit+x.rank).sort().join()===chosenK?1:0}); }
              G.push(g); } }
          if(!E.isLegalFollow(hand,lead,cards,T)) cards=E.genFollow(hand,lead,T,E.rng(seed)); }
        cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards}); }
      const res=E.resolveTrick(plays,T); if(res.winner%2!==D%2) dp+=E.countPoints(plays.flatMap(p=>p.cards)); history.push(...plays); leader=res.winner; }
  }
  if(process.env.DUMP) fs.writeFileSync(process.env.DUMP,JSON.stringify(G));
  console.log(`${N} 副,${G.length} 个决策`);
} else {
  const files=process.argv.slice(3); const tr=[],te=[];
  files.forEach((f,i)=>(i%2?te:tr).push(...JSON.parse(fs.readFileSync(f,'utf8'))));
  const names=['期望分 ev','牌权 tempo','−留手代价 fut','跨台阶 lad','−规则加成 pen','其余修正'];
  const xf=c=>[c.ev,c.tempo,-c.fut,c.lad,-c.pen,c.resid];
  const fitW=(G,ykey)=>{ const d=6; const A=Array.from({length:d},()=>new Array(d).fill(0)), b=new Array(d).fill(0);
    for(const g of G){ const xs=g.c.map(xf), ys=g.c.map(c=>c[ykey]); const mx=new Array(d).fill(0); let my=0;
      xs.forEach(x=>x.forEach((v,j)=>mx[j]+=v/xs.length)); ys.forEach(y=>my+=y/ys.length);
      for(let i=0;i<xs.length;i++){ const x=xs[i].map((v,j)=>v-mx[j]), y=ys[i]-my; for(let j=0;j<d;j++){ b[j]+=x[j]*y; for(let k=0;k<d;k++) A[j][k]+=x[j]*x[k]; } } }
    for(let j=0;j<d;j++) A[j][j]+=1e-3*(A[j][j]+1);
    const M=A.map((r,j)=>[...r,b[j]]); for(let j=0;j<d;j++){ let m=j; for(let k=j+1;k<d;k++) if(Math.abs(M[k][j])>Math.abs(M[m][j])) m=k; [M[j],M[m]]=[M[m],M[j]];
      for(let k=0;k<d;k++){ if(k===j) continue; const f=M[k][j]/M[j][j]; for(let l=j;l<=d;l++) M[k][l]-=f*M[j][l]; } }
    return M.map((r,j)=>r[d]/r[j]); };
  const m=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length), se=a=>{const mu=m(a);return Math.sqrt(a.reduce((x,y)=>x+(y-mu)**2,0)/Math.max(1,a.length-1)/Math.max(1,a.length));};
  for(const yk of ['pts','u']){
    const w=fitW(tr,yk); const s0=w[0];
    console.log(`\n== 结果 = ${yk==='pts'?'本队得分':'净升级'}(训练 ${tr.length} 个决策,检验 ${te.length})`);
    console.log('   拟合权重(以期望分那一项为 1 归一):'+names.map((n,j)=>`${n} ${(w[j]/s0).toFixed(2)}`).join(' | '));
    // 检验:按拟合权重选 vs AI 的选择
    const d=[]; let agree=0;
    for(const g of te){ const sc=g.c.map(c=>xf(c).reduce((a,v,j)=>a+v*w[j],0)); const k=sc.indexOf(Math.max(...sc));
      const ai=g.c.findIndex(c=>c.chosen); if(ai<0) continue; if(k===ai) agree++; d.push(g.c[k][yk]-g.c[ai][yk]); }
    console.log(`   检验:按拟合权重选 与 AI 选同一手 ${(100*agree/d.length).toFixed(0)}%;不同时结果差(拟合 − AI)平均 ${m(d).toFixed(3)} ±${se(d).toFixed(3)} / 每个决策`);
    const best=te.map(g=>{ const ai=g.c.find(c=>c.chosen); return ai?Math.max(...g.c.map(c=>c[yk]))-ai[yk]:null; }).filter(x=>x!==null);
    console.log(`   (天花板:事后最好的那手比 AI 多 ${m(best).toFixed(3)})`);
  }
}
