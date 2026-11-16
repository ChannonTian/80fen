/* ai3/policy.js —— 用网络在内核状态上选一手。eval-net.js 与 test/ai-h2h.js(PNET=)共用。
 *   const P=new NetPolicy(net,rng);  const i=P.choose(st);   // st:内核状态,轮到 st.cur
 *   选中的候选在 P.buf / K.pos[i](len,牌种…),交给 K.playLead / K.playFollow。 */
'use strict';
const K=require('./kernel.js'), F=require('./feat.js');
const NCMAX=1024;
class NetPolicy{
  constructor(net,rng){
    this.net=net; this.rng=rng||K.makeRng(1);
    this.buf=new Uint8Array(1<<16); this.S=new Uint8Array(F.SD); this.C=new Uint8Array(NCMAX*F.CD); this.sc=new Float32Array(NCMAX);
    this.stat={lead:0,follow:0,over:0,trunc:0};
  }
  /* 返回候选下标(K.pos[i] 是它在 this.buf 里的起点);返回前已把候选集定好 */
  candidates(st){
    const lead=st.nPlays===0; let n;
    if(lead){ n=K.enumLeads(st,this.buf,2); if(n<0){ n=K.enumLeads(st,this.buf,0); this.stat.over++; } this.stat.lead++; }
    else { n=K.enumFollows(st,this.buf,256); if(n<0){ n=K.enumFollowsReduced(st,this.buf,256,this.rng); this.stat.over++; } this.stat.follow++; }
    if(n>NCMAX){   // 随机留 NCMAX 个(与 featurize 同口径:留随机子集)
      const P=K.pos; for(let i=n-1;i>0&&i>=n-NCMAX;i--){ const j=(this.rng()*(i+1))|0; const x=P[i]; P[i]=P[j]; P[j]=x; }
      for(let i=0;i<NCMAX;i++) P[i]=P[n-NCMAX+i]; n=NCMAX; this.stat.trunc++;
    }
    return n;
  }
  choose(st){
    const n=this.candidates(st); this.lastN=n;
    if(n<=1) return 0;
    const seat=st.cur;
    F.stateFeat(st,seat,this.S,0);
    const ctx=F.decisionCtx(st,seat), K_=K.pos, C=this.C;
    for(let i=0;i<n;i++) F.candFeat(ctx,this.buf,K_[i],C,i*F.CD);
    this.net.scores(this.S,C,n,this.sc);
    let b=0; for(let i=1;i<n;i++) if(this.sc[i]>this.sc[b]) b=i;
    return b;
  }
}
module.exports=NetPolicy;
