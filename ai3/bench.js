/* ai3/bench.js —— 单核测速。node ai3/bench.js [--games=20000] [--cap=256] [--seed=1]
 * ① 每手 enumLeads(mode1)/enumFollows 全枚举再均匀挑  ② 同①但 throwMode 0
 * ③ 不枚举:领出随机出一张单牌(未实现领出抽样),跟牌用 sampleFollow */
'use strict';
const K=require('./kernel.js');
const arg=(k,d)=>{ const a=process.argv.find(x=>x.startsWith('--'+k+'=')); return a?+a.slice(k.length+3):d; };
const G=arg('games',20000), CAP=arg('cap',256), SEED=arg('seed',1);
const BUF=new Uint8Array(1<<16), B2=new Uint8Array(64);
function run(mode){
  const st=K.newState(), rng=K.makeRng(SEED*7919);
  let plays=0, follows=0, over=0, cands=0;
  const t0=process.hrtime.bigint();
  for(let g=0;g<G;g++){
    K.dealRandom(st,rng);
    while(!K.done(st)){
      plays++;
      if(st.nPlays===0){
        if(mode===3){
          const b=st.cur*54; let x=(rng()*st.hn[st.cur])|0, t=0;
          for(;t<54;t++){ x-=st.hand[b+t]; if(x<0) break; }
          B2[0]=1; B2[1]=t; K.playLead(st,B2,0);
        } else {
          const n=K.enumLeads(st,BUF,mode===1?1:0); cands+=n;
          K.playLead(st,BUF,K.pos[(rng()*n)|0]);
        }
      } else {
        follows++;
        if(mode===3){ K.sampleFollow(st,rng,B2,0); K.playFollow(st,B2,0); }
        else{
          const c=K.enumFollows(st,BUF,CAP);
          if(c<0){ over++; K.sampleFollow(st,rng,B2,0); K.playFollow(st,B2,0); }
          else{ cands+=c; K.playFollow(st,BUF,K.pos[(rng()*c)|0]); }
        }
      }
    }
    K.score(st);
  }
  const sec=Number(process.hrtime.bigint()-t0)/1e9;
  console.log(`模式${mode}: ${(G/sec).toFixed(0)} 局/秒  ${(plays/sec).toFixed(0)} 手/秒  (${(plays/G).toFixed(1)} 手/局, 超cap ${(100*over/follows).toFixed(2)}% , ${sec.toFixed(1)}s, cap=${CAP})`);
}
for(const m of [1,2,3]) run(m);
