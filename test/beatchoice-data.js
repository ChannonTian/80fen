/* 压上去用哪张(信念第 4 步 c,11-01):推演里压牌一律用「最便宜那张」。真人领小主(钓主)、AI 第 2 家小压时估 85% 实际常丢 ——
 * 第 3 家压上去时用的是大主(级牌 / A / 王),不是刚好压得过的那张,第 4 家就盖不过了。
 * 条件 logit:在他所有压得过当前最大的单张里选哪一张。每张候选的特征都从他自己看得到的东西算。
 * 样本:单张领出、第 2 / 3 家(后面还有人)、真压了、压得过的 ≥2 张。
 *   node test/beatchoice-data.js [html] [种子数=300]   (SEED0=;DUMP=)
 *   node test/beatchoice-data.js --fit a.json ...      */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const names=['最便宜那张','在外比它大的张数/3','在外没有比它大的','王','级牌','A','带分','带分×台面0分','主×副牌领出(毙)','在外比它大的/3×保','在外比它大的/3×台面分/10','在外比它大的/3×主领','王或级牌×主领'];
if(process.argv[2]==='--fit'){
  const rows=process.argv.slice(3).flatMap(f=>JSON.parse(fs.readFileSync(f,'utf8')));
  const P=(w,r)=>{ const z=r.c.map(f=>f.reduce((a,v,j)=>a+v*w[j],0)), mx=Math.max(...z), e=z.map(v=>Math.exp(v-mx)), S=e.reduce((a,b)=>a+b,0); return e.map(v=>v/S); };
  const fit=rs=>{ const d=rs[0].c[0].length; const w=new Array(d).fill(0);
    for(let it=0;it<40;it++){ const g=new Array(d).fill(0), H=Array.from({length:d},()=>new Array(d).fill(0));
      for(const r of rs){ const p=P(w,r), mu=new Array(d).fill(0); r.c.forEach((f,k)=>{ for(let j=0;j<d;j++) mu[j]+=p[k]*f[j]; });
        for(let j=0;j<d;j++) g[j]+=mu[j]-r.c[r.y][j];
        r.c.forEach((f,k)=>{ for(let j=0;j<d;j++) for(let l=0;l<d;l++) H[j][l]+=p[k]*(f[j]-mu[j])*(f[l]-mu[l]); }); }
      for(let j=0;j<d;j++){ g[j]+=1e-2*w[j]; H[j][j]+=1e-2; }
      const A=H.map((row,j)=>[...row,g[j]]);
      for(let j=0;j<d;j++){ let q=j; for(let k=j+1;k<d;k++) if(Math.abs(A[k][j])>Math.abs(A[q][j])) q=k; [A[j],A[q]]=[A[q],A[j]];
        for(let k=0;k<d;k++){ if(k===j) continue; const f=A[k][j]/A[j][j]; for(let l=j;l<=d;l++) A[k][l]-=f*A[j][l]; } }
      let mx=0; for(let j=0;j<d;j++){ const st=A[j][d]/A[j][j]; w[j]-=st; mx=Math.max(mx,Math.abs(st)); } if(mx<1e-8) break; }
    return w; };
  const m=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
  const A=rows.filter((r,i)=>i%2===0), B=rows.filter((r,i)=>i%2===1), wA=fit(A), wB=fit(B), w=fit(rows);
  const nll=(ww,rs)=>rs.map(r=>-Math.log(Math.max(1e-4,P(ww,r)[r.y])));
  const cheapNll=rs=>rs.map(r=>r.y===0?0:Infinity);
  console.log(`${rows.length} 个样本(平均 ${m(rows.map(r=>r.c.length)).toFixed(1)} 张可选);对数损失 均匀 ${m(rows.map(r=>Math.log(r.c.length))).toFixed(4)} → 模型(两折)${m([...nll(wA,B),...nll(wB,A)]).toFixed(4)};「最便宜那张」对上 ${(100*m(rows.map(r=>r.y===0?1:0))).toFixed(0)}%`);
  console.log('beatChoiceW: ['+w.map(v=>+v.toFixed(4)).join(',')+']');
  console.log('   '+names.map((n,j)=>`${n} ${w[j].toFixed(2)}`).join(' | '));
  // 校准:选中那张「在外比它大的」张数,模型期望 vs 实际
  const grp=(t,f)=>{ const a=rows.filter(f); if(a.length<30) return;
    const ex=m(a.map(r=>{ const p=P(w,r); return r.c.reduce((s,c,k)=>s+p[k]*c[1]*3,0); })), ac=m(a.map(r=>r.c[r.y][1]*3)), ch=m(a.map(r=>r.c[0][1]*3));
    const ps=m(a.map(r=>{ const p=P(w,r); return r.c.reduce((s,c,k)=>s+p[k]*c[2],0); })), as=m(a.map(r=>r.c[r.y][2]));
    console.log(`   ${t.padEnd(22)} n=${String(a.length).padStart(5)}  选中那张上面在外 模型 ${ex.toFixed(2)} 实 ${ac.toFixed(2)}(最便宜那张 ${ch.toFixed(2)})  稳赢 模型 ${(100*ps).toFixed(0)}% 实 ${(100*as).toFixed(0)}%`); };
  grp('全部',r=>true); grp('主领(同门)',r=>r.trumpLead); grp('副牌领·同门',r=>!r.trumpLead&&!r.ruff); grp('毙',r=>r.ruff); grp('保(本队暂大)',r=>r.mate); grp('抢(对手暂大)',r=>!r.mate);
  grp('第 2 家',r=>r.pos===2); grp('第 3 家',r=>r.pos===3);
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
          const mem=E.makeMemory(view), uh=(su,top)=>{ let n=0; for(const k in mem.unseen){ const u=E.keyToCard(k); if(mem.unseen[k]>0&&E.effSuit(u,T)===su&&E.ordIdx(u,T)>top) n+=mem.unseen[k]; } return n; };
          const cur=E.currentWinner(plays,T);
          // beatChoiceCands 约定 unseenHi 含他自己手里的(引擎里 mateCtx.cnt 就是这样),它自己再减掉 —— 这里把手里的加回去
          const uh2=(su,top)=>uh(su,top)+hand.filter(d=>E.effSuit(d,T)===su&&E.ordIdx(d,T)>top).length;
          const c=E.beatChoiceCands(T,plays,seat,hand,uh2,cur.seat%2===seat%2);
          if(c&&c.cands.length>=2){ const y=c.cands.findIndex(x=>x.id===cards[0].id);
            if(y>=0) W.push({c:c.feats,y,mate:cur.seat%2===seat%2?1:0,pos:i+1,trumpLead:lead.suit==='T'?1:0,ruff:lead.suit!=='T'&&E.effSuit(cards[0],T)==='T'?1:0}); } } }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards}); }
    const res=E.resolveTrick(plays,T); history.push(...plays); leader=res.winner; }
}
if(process.env.DUMP) fs.writeFileSync(process.env.DUMP,JSON.stringify(W));
console.log(`${N} 副,${W.length} 个样本`);
