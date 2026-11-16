/* ai3/profile-net.js —— 四家都是网络的整局里,枚举 / 特征 / 前向 各占多少时间。node ai3/profile-net.js --net=<dir> --games=100 */
'use strict';
const K=require('./kernel.js'),F=require('./feat.js'),Net=require('./net.js');
const arg=(k,d)=>{ const a=process.argv.find(x=>x.startsWith('--'+k+'=')); return a?a.slice(k.length+3):d; };
const net=Net.load(arg('net','ai3/out/net-pilot')), G=+arg('games',100);
const rng=K.makeRng(5), st=K.newState(), buf=new Uint8Array(1<<16), S=new Uint8Array(F.SD), C=new Uint8Array(1024*F.CD), sc=new Float32Array(1024);
const hr=()=>process.hrtime.bigint(); let tE=0n,tF=0n,tN=0n,tP=0n,plays=0,dec=0,cands=0;
for(let g=0;g<G;g++){
  K.dealRandom(st,rng);
  while(!K.done(st)){
    plays++; const lead=st.nPlays===0; let t=hr(), n;
    if(lead){ n=K.enumLeads(st,buf,2); if(n<0) n=K.enumLeads(st,buf,0); }
    else { n=K.enumFollows(st,buf,256); if(n<0) n=K.enumFollowsReduced(st,buf,256,rng); }
    if(n>1024) n=1024;
    tE+=hr()-t; let b=0;
    if(n>1){ dec++; cands+=n;
      t=hr(); F.stateFeat(st,st.cur,S,0); const ctx=F.decisionCtx(st,st.cur); for(let i=0;i<n;i++) F.candFeat(ctx,buf,K.pos[i],C,i*F.CD); tF+=hr()-t;
      t=hr(); net.scores(S,C,n,sc); tN+=hr()-t; for(let i=1;i<n;i++) if(sc[i]>sc[b]) b=i; }
    t=hr(); if(lead) K.playLead(st,buf,K.pos[b]); else K.playFollow(st,buf,K.pos[b]); tP+=hr()-t;
  }
}
const tot=Number(tE+tF+tN+tP), ms=x=>(Number(x)/1e6/plays).toFixed(3);
console.log(`${G} 局 ${plays} 手(需要前向的 ${dec},平均候选 ${(cands/dec).toFixed(1)});总 ${(tot/1e9).toFixed(2)}s => ${(G/(tot/1e9)).toFixed(1)} 局/秒`);
console.log(`每手 ms:枚举 ${ms(tE)}(${(100*Number(tE)/tot).toFixed(0)}%) 特征 ${ms(tF)}(${(100*Number(tF)/tot).toFixed(0)}%) 前向 ${ms(tN)}(${(100*Number(tN)/tot).toFixed(0)}%) 落子 ${ms(tP)}(${(100*Number(tP)/tot).toFixed(0)}%)`);
