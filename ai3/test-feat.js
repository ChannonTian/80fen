/* ai3/test-feat.js —— 特征自检:① 花色置换不变(规范化对);② 演员特征 / 候选集不随别家手牌变化(不偷看)。
 *   node ai3/test-feat.js [--dir=ai3/out/rec] [--games=60] */
'use strict';
const path=require('path');
const K=require('./kernel.js'), F=require('./feat.js'), {replayGame,readRecs}=require('./replay.js');
const dir=(process.argv.find(x=>x.startsWith('--dir='))||'').slice(6)||path.join(__dirname,'out','rec');
const G=+((process.argv.find(x=>x.startsWith('--games='))||'--games=60').slice(8));
const BUF=new Uint8Array(1<<16);
const rng=K.makeRng(99);
function rows(rec,mutate){
  const out=[];
  const r=replayGame(rec,(st,pi,play,isLead)=>{
    if(mutate) mutate(st);
    const seat=st.cur; let n;
    if(isLead){ n=K.enumLeads(st,BUF,2); } else { n=K.enumFollows(st,BUF,256); if(n<0) n=-1; }
    const S=new Uint8Array(F.SD); F.stateFeat(st,seat,S,0);
    let cs=null;
    if(n>=0){ const ctx=F.decisionCtx(st,seat); cs=[];
      for(let i=0;i<n;i++){ const c=new Uint8Array(F.CD); F.candFeat(ctx,BUF,K.pos[i],c,0); cs.push(Buffer.from(c).toString('hex')); }
      cs.sort(); }
    out.push({S:Buffer.from(S).toString('hex'),cs});
  });
  return r.ok?out:null;
}
function permute(rec,perm){        // perm: 真实花色 s -> 新花色 perm[s](0..3);王不动
  const m=t=>t>=52?t:perm[(t/13)|0]*13+t%13;
  const o=JSON.parse(JSON.stringify(rec));
  o.h=rec.h.map(h=>h.map(m).sort((a,b)=>a-b)); o.k=rec.k.map(m).sort((a,b)=>a-b);
  o.ts=rec.ts<4?perm[rec.ts]:4;
  o.p=rec.p.map(([s,w,a,e,c])=>[s,w.map(m).sort((x,y)=>x-y),a?a.map(m).sort((x,y)=>x-y):null,e,c]);
  return o;
}
let n=0,bad=0,skipped=0,dec=0;
for(const rec of readRecs(dir)){
  if(n>=G) break; n++;
  const base=rows(rec); if(!base){ skipped++; continue; }
  // ① 花色置换
  // 规范化只保证「把主花色换个位置、其余三门保持相对顺序」不变(无主不置换,故跳过无主)
  let perm=null;
  if(rec.ts<4){ const np=(rng()*4)|0; const oldO=[0,1,2,3].filter(x=>x!==rec.ts), newO=[0,1,2,3].filter(x=>x!==np);
    perm=[0,0,0,0]; perm[rec.ts]=np; for(let i=0;i<3;i++) perm[oldO[i]]=newO[i]; }
  const pr=perm?rows(permute(rec,perm)):null;
  if(!pr){ skipped++; }
  else {
    // 有主时:主花色固定(规范化第一),其余三门任意置换后特征必须完全相同;无主时:四门任意置换也相同
    // (置换会改变「有效花色序」之外的并列次序,这里只比特征)
    for(let i=0;i<base.length;i++){ dec++;
      if(base[i].S!==pr[i].S){ bad++; console.log('置换后演员特征不同 seed',rec.s,'手',i); break; }
      if(base[i].cs&&pr[i].cs&&base[i].cs.join('|')!==pr[i].cs.join('|')){ bad++; console.log('置换后候选特征不同 seed',rec.s,'手',i); break; }
    }
  }
  // ② 别家手牌乱换(同张数、同没见过的池子)
  const mut=st=>{
    const seat=st.cur, pool=[];
    for(let p=0;p<4;p++) if(p!==seat) for(let t=0;t<54;t++) for(let c=0;c<st.hand[p*54+t];c++) pool.push(t);
    for(let i=pool.length-1;i>0;i--){ const j=(rng()*(i+1))|0; const x=pool[i]; pool[i]=pool[j]; pool[j]=x; }
    let o=0; for(let p=0;p<4;p++){ if(p===seat) continue; const hn=st.hn[p]; st.hand.fill(0,p*54,p*54+54); for(let q=0;q<hn;q++) st.hand[p*54+pool[o++]]++; }
    if(seat!==st.declarer) st.kitty.fill(0);
  };
  // 乱换会破坏回放的合法性,只在回调里取特征,不继续用被改的状态:先复制一个状态做特征
  const outA=[],outB=[];
  replayGame(rec,(st,pi,play,isLead)=>{
    const seat=st.cur; const S=new Uint8Array(F.SD); F.stateFeat(st,seat,S,0);
    const n1=isLead?K.enumLeads(st,BUF,2):K.enumFollows(st,BUF,256);
    const k1=[]; for(let i=0;i<n1;i++) k1.push(Array.from(BUF.subarray(K.pos[i],K.pos[i]+1+BUF[K.pos[i]])).join());
    const keep=Uint8Array.from(st.hand), kk=Uint8Array.from(st.kitty);
    mut(st);
    const S2=new Uint8Array(F.SD); F.stateFeat(st,seat,S2,0);
    const n2=isLead?K.enumLeads(st,BUF,2):-2;
    if(isLead){ const k2=[]; for(let i=0;i<n2;i++) k2.push(Array.from(BUF.subarray(K.pos[i],K.pos[i]+1+BUF[K.pos[i]])).join());
      if(k1.join('|')!==k2.join('|')){ bad++; console.log('领出候选随别家手牌变化 seed',rec.s,pi); } }
    if(Buffer.compare(S,S2)!==0){ bad++; console.log('演员特征随别家手牌变化 seed',rec.s,pi); }
    st.hand.set(keep); st.kitty.set(kk);
  });
}
console.log(`检查 ${n} 局(跳过 ${skipped}),置换对比 ${dec} 个决策;失败 ${bad}`);
process.exit(bad?1:0);
