/* ai3/test-kernel2.js —— 内核新增两项的自检:enumLeads throwMode 2、enumFollowsReduced。
 *   node ai3/test-kernel2.js [--games=3000] */
'use strict';
const K=require('./kernel.js');
const G=+((process.argv.find(x=>x.startsWith('--games='))||'--games=3000').slice(8));
const BUF=new Uint8Array(1<<16), B2=new Uint8Array(1<<16), B3=new Uint8Array(64);
const rng=K.makeRng(777), st=K.newState(), sc=K.newState();
const candKey=(buf,pos)=>Array.from(buf.subarray(pos+1,pos+1+buf[pos])).join(',');
let bad=0; const st_={};
const S=(k,v=1)=>st_[k]=(st_[k]||0)+v;
function hands4(st){ const o=[]; for(let p=0;p<4;p++){ const a=[]; for(let t=0;t<54;t++) for(let c=0;c<st.hand[p*54+t];c++) a.push(t); o.push(a); } return o; }
for(let g=0;g<G;g++){
  K.dealRandom(st,rng,undefined,undefined,undefined,g%3);
  while(!K.done(st)){
    if(st.nPlays===0){
      const seat=st.cur;
      const n0=K.enumLeads(st,BUF,0), n2=K.enumLeads(st,BUF,2);
      const set2=[]; for(let i=0;i<n2;i++) set2.push(candKey(BUF,K.pos[i]));
      S('leads'); S('leadCands2',n2);
      // 1) 每个候选都必须在真实局面下「甩牌成功」(playLead 返回 0)
      const nthrow=[];
      for(let i=0;i<n2;i++){
        K.copy(sc,st); const r=K.playLead(sc,BUF,K.pos[i]);
        if(r!==0){ bad++; console.log('mode2 候选甩牌失败 g',g,candKey(BUF,K.pos[i]),r); }
        const L=BUF[K.pos[i]], T=st.tbl; const cl=K.util.classifyT(Array.from(BUF.subarray(K.pos[i]+1,K.pos[i]+1+L)),st.ts,st.tr);
        if(cl&&cl.kind===3) S('throwCands2');
      }
      // 2) 不偷看:把另三家的手牌在「没见过的牌」里重新随机分配后结果必须逐位相同
      const H=hands4(st); const pool=[]; for(let p=0;p<4;p++) if(p!==seat) pool.push(...H[p]);
      if(pool.length>=3){
        for(let i=pool.length-1;i>0;i--){ const j=(rng()*(i+1))|0; const x=pool[i]; pool[i]=pool[j]; pool[j]=x; }
        K.copy(sc,st); let o=0;
        for(let p=0;p<4;p++){ if(p===seat) continue; sc.hand.fill(0,p*54,p*54+54); for(let q=0;q<st.hn[p];q++) sc.hand[p*54+pool[o++]]++; }
        const m2=K.enumLeads(sc,B2,2);
        let same=m2===n2; if(same) for(let i=0;i<n2;i++) if(candKey(B2,K.pos[i])!==set2[i]){ same=false; break; }
        S('peekTests'); if(!same){ bad++; console.log('mode2 随别家手牌变化 g',g); }
      }
      // 3) 与 mode 0 / mode 1 的关系:非甩牌部分相同;mode2 的甩牌 ⊆ mode1 的甩牌(mode1 的 |U|≤6 时)
      const n1=K.enumLeads(st,B2,1); const s1=new Set(); for(let i=0;i<n1;i++) s1.add(candKey(B2,K.pos[i]));
      const s0=new Set(); K.enumLeads(st,B2,0); for(let i=0;i<K.enumLeads(st,B2,0);i++) s0.add(candKey(B2,K.pos[i]));
      for(const k of set2) if(!s1.has(k)&&!s0.has(k)){ S('mode2NotInMode1'); }
      for(const k of s0) if(!set2.includes(k)){ bad++; console.log('mode2 缺 mode0 候选',k); }
      K.enumLeads(st,BUF,2);
      // 出一个候选继续
      K.playLead(st,BUF,K.pos[(rng()*n2)|0]);
    } else {
      const seat=st.cur;
      const nf=K.enumFollows(st,BUF,256);
      const full=new Set(); if(nf>0) for(let i=0;i<nf;i++) full.add(candKey(BUF,K.pos[i]));
      const t0=process.hrtime.bigint();
      const nr=K.enumFollowsReduced(st,B2,256,rng);
      S('redNs',Number(process.hrtime.bigint()-t0)); S('redCalls');
      S('redCands',nr);
      const red=new Set();
      for(let i=0;i<nr;i++){
        const k=candKey(B2,K.pos[i]); if(red.has(k)){ bad++; console.log('降级候选重复',k); } red.add(k);
        B3.set(B2.subarray(K.pos[i],K.pos[i]+1+B2[K.pos[i]]));
        if(!K.isLegalFollow(st,seat,B3,0)){ bad++; console.log('降级候选不合法',k); }
        if(nf>0&&!full.has(k)){ bad++; console.log('降级候选不在全枚举里',k); }
      }
      if(nf<0){ S('overCap'); S('overCapRed',nr); if(nr<1) bad++; }
      else { S('fullHands'); S('fullSize',nf); S('redOfFull',red.size/nf); if(red.size===nf) S('redEqFull'); }
      // 继续:出一个降级候选(检验 reduced 出的牌能推进)
      const pk=K.pos[(rng()*nr)|0];
      const pw=K.peekWinner(st,B2,pk);
      const last=st.nPlays===3;
      K.playFollow(st,B2,pk);
      if(last){ S('peekChecks'); if(pw!==st.lastWinner){ bad++; console.log('peekWinner 与 resolveTrick 不符',pw,st.lastWinner); } }
    }
  }
}
console.log(JSON.stringify(st_));
console.log(`降级:调用 ${st_.redCalls},每次 ${(st_.redNs/st_.redCalls/1000).toFixed(1)}µs,平均候选 ${(st_.redCands/st_.redCalls).toFixed(1)};超cap ${st_.overCap||0} 次(平均 ${((st_.overCapRed||0)/(st_.overCap||1)).toFixed(1)} 个);全枚举≤cap 时降级集占全集平均 ${(100*st_.redOfFull/(st_.fullHands||1)).toFixed(1)}%`);
console.log(bad?`失败 ${bad}`:'全部通过');
process.exit(bad?1:0);
