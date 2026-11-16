/* ai3/difftest.js —— 内核与现引擎(80fen-test.html 块①)逐位对拍。
 *   node ai3/difftest.js --games=2000 --seed0=1 --workers=8 [--cap=256] [--lc=0.05] [--fc=0.004] [--fr=0.005] [--fresh]
 * 断点续跑:每个 worker 把进度写到 ai3/out/diff-<seed0>-<games>-w<i>.json,重跑同样参数即接着跑(--fresh 重来)。
 * 判据全部来自现引擎;任何差异立刻打印可复现信息并计数。
 */
'use strict';
const fs=require('fs'), path=require('path'), cp=require('child_process');
const arg=(k,d)=>{ const a=process.argv.find(x=>x.startsWith('--'+k+'=')); return a?a.slice(k.length+3):d; };
const has=k=>process.argv.includes('--'+k);
const OUT=path.join(__dirname,'out');
fs.mkdirSync(OUT,{recursive:true});

const GAMES=+arg('games',1000), SEED0=+arg('seed0',1), WORKERS=+arg('workers',8);
const CAP=+arg('cap',256);
const P_LC=+arg('lc',0.05);       // 领出完备性抽样率(每次领出)
const P_FC=+arg('fc',0.004);      // 跟牌完备性(全 id 子集)抽样率(每次跟牌,且 C(n,k)<=30000)
const P_FR=+arg('fr',0.005);      // 跟牌大空间随机子集抽样率
const WID=arg('worker',null);
const FZ=+arg('fz',40);       // 每局附带的结构压测用例数

if(WID===null){
  /* ---------- 主进程:切片、起 worker、汇总 ---------- */
  const per=Math.ceil(GAMES/WORKERS), kids=[];
  const t0=Date.now();
  for(let i=0;i<WORKERS;i++){
    const g0=i*per, n=Math.min(per,GAMES-g0); if(n<=0) break;
    const args=[__filename,'--worker='+i,'--games='+n,'--seed0='+(SEED0+g0),'--cap='+CAP,'--fz='+FZ,'--lc='+P_LC,'--fc='+P_FC,'--fr='+P_FR,'--tag='+SEED0+'-'+GAMES];
    if(has('fresh')) args.push('--fresh');
    kids.push(new Promise(res=>{ const c=cp.spawn(process.execPath,args,{stdio:'inherit'}); c.on('exit',res); }));
  }
  Promise.all(kids).then(()=>{
    const tot={};
    for(let i=0;i<WORKERS;i++){
      const f=path.join(OUT,`diff-${SEED0}-${GAMES}-w${i}.json`); if(!fs.existsSync(f)) continue;
      const s=JSON.parse(fs.readFileSync(f,'utf8')).stats;
      for(const k in s) tot[k]=(tot[k]||0)+s[k];
    }
    const sec=((Date.now()-t0)/1000).toFixed(0);
    console.log('\n===== 汇总 ('+sec+'s 本次墙钟) ====='); console.log(JSON.stringify(tot,null,1));
    fs.writeFileSync(path.join(OUT,`diff-${SEED0}-${GAMES}-total.json`),JSON.stringify(tot,null,1));
    process.exit(tot.mismatch?1:0);
  });
  return;
}

/* ---------- worker ---------- */
const K=require('./kernel.js');
const E=require('../ai2/sim.js').loadEngine();
const DECKO=E.makeDeck();
const SUITC='SHDC', TYPE=['single','pair','tractor','throw'];
const myGames=+arg('games'), mySeed0=+arg('seed0');
const file=path.join(OUT,`diff-${arg('tag')}-w${WID}.json`);
let stats={games:0,plays:0,leads:0,follows:0,mismatch:0,
  leadCands:0,leadCandThrow:0,leadClassifyChecks:0,leadThrowOkChecks:0,
  randThrowTries:0,randThrowForced:0,
  leadCompleteHands:0,leadCompleteSubsets:0,leadCompleteThrowSubsets:0,leadCompleteNon:0,
  followCands:0,followCandChecks:0,followOverCap:0,followEnumHands:0,followKernelLegal:0,
  followCompleteHands:0,followCompleteSubsets:0,followRandHands:0,followRandSubsets:0,followRandLegalAgree:0,
  sampleFollowChecks:0,sampleInEnum:0,
  tricks:0,trickChecks:0,scoreChecks:0,descChecks:0,
  fuzzCases:0,fuzzDecomp:0,fuzzMultiOrd:0,fuzzTractor3:0,fuzzClassify:0,fuzzThrow:0,fuzzThrowForced:0,fuzzFollowComplete:0,fuzzFollowSubsets:0,fuzzFollowPred:0,fuzzTrick:0};
let next=0;
if(!has('fresh') && fs.existsSync(file)){
  const j=JSON.parse(fs.readFileSync(file,'utf8'));
  if(j.seed0===mySeed0 && j.games===myGames){ stats=Object.assign(stats,j.stats); next=j.next; }
}
const save=()=>fs.writeFileSync(file,JSON.stringify({seed0:mySeed0,games:myGames,next,stats}));

const trumpOf=(ts,tr)=>({suit:ts<4?SUITC[ts]:null,rank:tr});
let ctx='';
const bad=(what,info)=>{ stats.mismatch++; if(stats.mismatch<=30) console.log(`[MISMATCH w${WID}] ${ctx} ${what} ${info===undefined?'':JSON.stringify(info)}`); };

/* 牌种多重集(升序数组) -> 规范 id 的牌对象(按 id 升序) */
function canon(types){
  const seen={}, ids=[];
  for(let i=0;i<types.length;i++){ const t=types[i]; ids.push(seen[t]?t+54:t); seen[t]=1; }
  ids.sort((a,b)=>a-b);
  return ids.map(i=>DECKO[i]);
}
function engHand(st,p){
  const h=[]; const b=p*54;
  for(let t=0;t<54;t++) if(st.hand[b+t]) h.push(DECKO[t]);
  for(let t=0;t<54;t++) if(st.hand[b+t]===2) h.push(DECKO[t+54]);
  return h;
}
const handTypes=(st,p)=>{ const a=[]; for(let t=0;t<54;t++) for(let c=0;c<st.hand[p*54+t];c++) a.push(t); return a; };
const key=a=>Array.from(a).sort((x,y)=>x-y).join(',');
const typesOf=cards=>cards.map(c=>c.id%54);
const effOfT=(T,s)=>s;

function engNeed(cl){
  if(cl.type==='pair') return 1;
  if(cl.type==='tractor') return cl.len;
  if(cl.type==='throw') return cl.comps.reduce((a,c)=>a+(c.type==='pair'?1:c.type==='tractor'?c.len:0),0);
  return 0;
}
function sameCl(cl,ke){
  if(!cl||!ke) return false;
  const es=cl.suit==='T'?4:SUITC.indexOf(cl.suit);
  return TYPE[ke.kind]===cl.type && ke.suit===es && ke.top===cl.top && (cl.type!=='tractor'||ke.len===cl.len);
}
function checkDesc(st,cl){
  stats.descChecks++;
  const es=cl.suit==='T'?4:SUITC.indexOf(cl.suit);
  const kk=TYPE[st.leadKind];
  if(kk!==cl.type||st.leadSuit!==es||st.leadTop!==cl.top||st.leadNeed!==engNeed(cl)||st.leadN!==cl.cards.length||(cl.type==='tractor'&&st.leadLen!==cl.len))
    bad('leadDescriptor',{kern:[kk,st.leadSuit,st.leadTop,st.leadNeed,st.leadLen,st.leadN],eng:[cl.type,es,cl.top,engNeed(cl),cl.len,cl.cards.length]});
}
function* multisets(tl,i,cur){          // tl:[[t,c],...] 的非空多重集
  if(i===tl.length){ if(cur.length) yield cur.slice(); return; }
  const [t,c]=tl[i];
  for(let k=0;k<=c;k++){ for(let q=0;q<k;q++) cur.push(t); yield* multisets(tl,i+1,cur); for(let q=0;q<k;q++) cur.pop(); }
}
function* multisetsAll(tl,i,cur){ yield* multisets(tl,i,cur); }

const BUF=new Uint8Array(1<<16), BUF2=new Uint8Array(256);

function playGame(g){
  const seed=mySeed0+g;
  const rng=K.makeRng(seed*2654435761>>>0);
  const st=K.newState();
  { const r0=rng(); K.dealRandom(st,rng,undefined,undefined,undefined,r0<0.5?0:r0<0.8?1:2); }
  const ts=st.ts, tr=st.tr, trump=trumpOf(ts,tr);
  const eh=[0,1,2,3].map(p=>engHand(st,p));
  let engLeader=st.declarer, engDef=0, engLastWinner=st.declarer, engLastSize=1;
  const kitCards=[]; for(let t=0;t<54;t++) for(let c=0;c<st.kitty[t];c++) kitCards.push(DECKO[c?t+54:t]);
  // kitty 规范化:同牌种两张用 t, t+54
  { kitCards.length=0; for(let t=0;t<54;t++){ if(st.kitty[t]>=1) kitCards.push(DECKO[t]); if(st.kitty[t]===2) kitCards.push(DECKO[t+54]); } }
  let trickNo=0, plays=[], leadCl=null, leadCards=null;
  let step=0;
  while(!K.done(st)){
    const seat=st.cur; step++;
    ctx=`seed=${seed} ts=${ts} tr=${tr} decl=${st.declarer} trick=${trickNo} seat=${seat} step=${step}`;
    if(st.nPlays===0){
      /* ===== 领出 ===== */
      if(seat!==engLeader) bad('leaderSeat',{kern:seat,eng:engLeader});
      stats.leads++;
      const n=K.enumLeads(st,BUF,1);
      if(n<0){ bad('enumLeadsOverflow'); return false; }
      const pos=K.pos;
      stats.leadCands+=n;
      const ht=[0,1,2,3].map(p=>handTypes(st,p));
      for(let i=0;i<n;i++){
        const o=pos[i], len=BUF[o], types=Array.from(BUF.subarray(o+1,o+1+len));
        const cards=canon(types);
        const cl=E.classify(cards,trump);
        const ke=K.util.classifyT(types,ts,tr);
        stats.leadClassifyChecks++;
        if(!sameCl(cl,ke)) bad('leadClassify',{types,eng:cl&&{type:cl.type,suit:cl.suit,top:cl.top,len:cl.len},kern:ke&&{kind:ke.kind,suit:ke.suit,top:ke.top,len:ke.len}});
        if(cl&&cl.type==='throw'){
          stats.leadCandThrow++; stats.leadThrowOkChecks++;
          const chk=E.checkThrow(eh,seat,cards,trump);
          if(!chk.ok) bad('leadThrowNotOk',{types,forced:typesOf(chk.forced)});
        }
      }
      // 完备性(抽样)
      if(rng()<P_LC){
        const elig=[]; const b=seat*54;
        for(let s=0;s<5;s++){ let k=0; const T=K.tbl(ts,tr); for(let t=0;t<54;t++) if(T.eff[t]===s) k+=st.hand[b+t]; if(k>0&&k<=12) elig.push(s); }
        if(elig.length){
          const s=elig[(rng()*elig.length)|0], T=K.tbl(ts,tr);
          const tl=[]; for(let t=0;t<54;t++) if(T.eff[t]===s&&st.hand[seat*54+t]) tl.push([t,st.hand[seat*54+t]]);
          const engNon=new Set(); let nsub=0, nthr=0;
          for(const sub of multisets(tl,0,[])){
            nsub++;
            const cards=canon(sub), cl=E.classify(cards,trump);
            if(cl.type!=='throw') engNon.add(key(sub));
            else{
              nthr++;
              const chk=E.checkThrow(eh,seat,cards,trump);
              const kc=K.util.checkThrowT(ht,seat,sub,ts,tr);
              if(chk.ok!==kc.ok || (!chk.ok && key(typesOf(chk.forced))!==key(kc.forced))) bad('throwCheck',{sub,eng:chk.ok?'ok':typesOf(chk.forced),kern:kc.ok?'ok':kc.forced});
            }
          }
          const kn=new Set();
          for(let i=0;i<n;i++){ const o=pos[i], len=BUF[o], ty=Array.from(BUF.subarray(o+1,o+1+len));
            if(T.eff[ty[0]]!==s) continue; const ke=K.util.classifyT(ty,ts,tr); if(ke.kind!==3) kn.add(key(ty)); }
          let ok=kn.size===engNon.size; if(ok) for(const x of kn) if(!engNon.has(x)){ ok=false; break; }
          if(!ok){ const a=[...engNon].filter(x=>!kn.has(x)), b2=[...kn].filter(x=>!engNon.has(x));
            bad('leadComplete',{suit:s,missingInKernel:a.slice(0,5),extraInKernel:b2.slice(0,5)}); }
          stats.leadCompleteHands++; stats.leadCompleteSubsets+=nsub; stats.leadCompleteThrowSubsets+=nthr; stats.leadCompleteNon+=engNon.size;
        }
      }
      // 选择:15% 随机甩牌尝试,其余枚举里均匀
      let leadTypes, tryThrow=false;
      if(rng()<0.15){
        const elig=[]; const T=K.tbl(ts,tr);
        for(let s=0;s<5;s++){ const L=[]; for(let t=0;t<54;t++) if(T.eff[t]===s) for(let c=0;c<st.hand[seat*54+t];c++) L.push(t); if(L.length>=2) elig.push(L); }
        if(elig.length){
          const L=elig[(rng()*elig.length)|0].slice();
          const m=2+((rng()*Math.min(L.length-1,8))|0);
          for(let i=0;i<m;i++){ const j=i+((rng()*(L.length-i))|0); const x=L[i]; L[i]=L[j]; L[j]=x; }
          leadTypes=L.slice(0,m).sort((a,b)=>a-b); tryThrow=true;
        }
      }
      if(!leadTypes){ const o=pos[(rng()*n)|0], len=BUF[o]; leadTypes=Array.from(BUF.subarray(o+1,o+1+len)); }
      // 现引擎的做法
      const cards=canon(leadTypes);
      let engPlayed=cards;
      { const chk=E.checkThrow(eh,seat,cards,trump); if(!chk.ok) engPlayed=chk.forced; }
      BUF2[0]=leadTypes.length; leadTypes.forEach((t,i)=>BUF2[1+i]=t);
      const fl=K.playLead(st,BUF2,0);
      if(fl<0){ bad('playLeadRejected',{leadTypes}); return false; }
      if(tryThrow){ stats.randThrowTries++; if(fl===1) stats.randThrowForced++; }
      const kp=Array.from(st.trickBuf.subarray(0,st.trickLen[0]));
      if(key(kp)!==key(typesOf(engPlayed))) bad('playedLead',{tried:leadTypes,kern:kp,eng:typesOf(engPlayed)});
      engPlayed=canon(kp);
      leadCards=engPlayed; leadCl=E.classify(leadCards,trump);
      checkDesc(st,leadCl);
      plays=[{seat,cards:leadCards}];
      eh[seat]=engHand(st,seat);
    }else{
      /* ===== 跟牌 ===== */
      stats.follows++;
      const hand=eh[seat], n=st.leadN;
      const c=K.enumFollows(st,BUF,CAP);
      let pick;
      const kset=new Set();
      if(c<0){ stats.followOverCap++; }
      else{
        stats.followEnumHands++; stats.followCands+=c;
        for(let i=0;i<c;i++){
          const o=K.pos[i], len=BUF[o], types=Array.from(BUF.subarray(o+1,o+1+len));
          kset.add(key(types));
          const ok=E.isLegalFollow(hand,leadCl,canon(types),trump);
          stats.followCandChecks++;
          if(!ok) bad('followCandIllegalInEngine',{types,lead:typesOf(leadCards)});
          // 内核自己的谓词也要认(每一手)
          if(!K.isLegalFollow(st,seat,BUF,o)) bad('followCandIllegalInKernel',{types});
          else stats.followKernelLegal++;
        }
        // 完备性:C(手牌,n)<=3 万时穷举全部 id 子集
        const hn=hand.length;
        let C=1; for(let i=0;i<n;i++) C=C*(hn-i)/(i+1);
        if(C<=30000 && rng()<P_FC){
          const have=new Set(); let nsub=0;
          const idx=[]; for(let i=0;i<n;i++) idx.push(i);
          while(true){
            nsub++;
            const sub=idx.map(i=>hand[i]);
            if(E.isLegalFollow(hand,leadCl,sub,trump)) have.add(key(typesOf(sub)));
            let i=n-1; while(i>=0&&idx[i]===hn-n+i) i--;
            if(i<0) break;
            idx[i]++; for(let j=i+1;j<n;j++) idx[j]=idx[j-1]+1;
          }
          let ok=have.size===kset.size; if(ok) for(const x of have) if(!kset.has(x)){ ok=false; break; }
          if(!ok){ const a=[...have].filter(x=>!kset.has(x)), b2=[...kset].filter(x=>!have.has(x));
            bad('followComplete',{lead:typesOf(leadCards),hand:handTypes(st,seat),missingInKernel:a.slice(0,5),extraInKernel:b2.slice(0,5),engN:have.size,kN:kset.size}); }
          stats.followCompleteHands++; stats.followCompleteSubsets+=nsub;
        }
      }
      // 大空间:随机子集 + 对合法手的扰动,两边谓词比一致
      if(rng()<P_FR){
        stats.followRandHands++;
        const hn=hand.length;
        for(let it=0;it<2000;it++){
          let sub;
          if(it&1){ // 扰动:取一手内核采样的合法跟法,换掉一张
            K.sampleFollow(st,rng,BUF2,0);
            const used=new Set(); const ty=Array.from(BUF2.subarray(1,1+n));
            const ids=[]; const seen={};
            for(const t of ty){ ids.push(seen[t]?t+54:t); seen[t]=1; }
            sub=ids.map(i=>hand.find(c2=>c2.id===i));
            const r=(rng()*n)|0; let nw; let tries=0;
            do{ nw=hand[(rng()*hn)|0]; tries++; }while(sub.includes(nw)&&tries<20);
            if(!sub.includes(nw)) sub[r]=nw;
          }else{
            const pool=hand.slice(); for(let i=0;i<n;i++){ const j=i+((rng()*(pool.length-i))|0); const x=pool[i]; pool[i]=pool[j]; pool[j]=x; }
            sub=pool.slice(0,n);
          }
          const ty=sub.map(c2=>c2.id%54).sort((a,b)=>a-b);
          const eg=E.isLegalFollow(hand,leadCl,sub,trump);
          BUF2[0]=n; ty.forEach((t,i)=>BUF2[1+i]=t);
          const kg=K.isLegalFollow(st,seat,BUF2,0);
          stats.followRandSubsets++; if(eg) stats.followRandLegalAgree++;
          if(eg!==kg) bad('followPredicate',{lead:typesOf(leadCards),hand:handTypes(st,seat),sub:ty,eng:eg,kern:kg});
        }
      }
      // 选择
      const useSample = c<0 || rng()<0.1;
      if(useSample){
        K.sampleFollow(st,rng,BUF2,0);
        const ty=Array.from(BUF2.subarray(1,1+n));
        stats.sampleFollowChecks++;
        if(!E.isLegalFollow(hand,leadCl,canon(ty),trump)) bad('sampleFollowIllegal',{ty,lead:typesOf(leadCards)});
        if(c>=0){ if(kset.has(key(ty))) stats.sampleInEnum++; else bad('sampleNotInEnum',{ty}); }
        pick=BUF2; var ppos=0;
      }else{
        pick=BUF; ppos=K.pos[(rng()*c)|0];
      }
      const types=Array.from(pick.subarray(ppos+1,ppos+1+pick[ppos]));
      const cards=canon(types);
      plays.push({seat,cards});
      const r=K.playFollow(st,pick,ppos);
      eh[seat]=engHand(st,seat);
      if(r===1){
        /* ===== 一墩结算 ===== */
        const res=E.resolveTrick(plays,trump);
        stats.tricks++; stats.trickChecks++;
        if(res.winner!==st.lastWinner) bad('trickWinner',{eng:res.winner,kern:st.lastWinner,plays:plays.map(p=>[p.seat,typesOf(p.cards)])});
        if(res.points!==st.trickPts) bad('trickPoints',{eng:res.points,kern:st.trickPts});
        if(res.winner%2!==st.declarer%2) engDef+=res.points;
        engLeader=res.winner; engLastWinner=res.winner; engLastSize=plays[0].cards.length;
        trickNo++; plays=[];
        if(st.defPts!==engDef) bad('defPts',{eng:engDef,kern:st.defPts});
      }
    }
    stats.plays++;
  }
  /* ===== 局末 ===== */
  const sc=E.scoreRound({defPoints:engDef,kitty:kitCards,defWonLastTrick:engLastWinner%2!==st.declarer%2,lastLeadSize:engLastSize});
  const ks=K.score(st);
  stats.scoreChecks++;
  const eUps=sc.defendersWin?sc.defenderLevelsUp:sc.declarerLevelsUp;
  if(sc.total!==ks.total||sc.mult!==ks.mult||sc.kittyPts!==ks.kittyPts||sc.defendersWin!==ks.defendersWin||eUps!==ks.ups)
    bad('score',{eng:[sc.total,sc.mult,sc.kittyPts,sc.defendersWin,eUps],kern:[ks.total,ks.mult,ks.kittyPts,ks.defendersWin,ks.ups]});
  return true;
}


/* ===== 结构压测:单门随机牌型(多对子、同序号多对、长拖拉机),不走整局 ===== */
function fuzzCase(rng){
  const ts=(rng()*5)|0, tr=2+((rng()*13)|0), trump=trumpOf(ts,tr), T=K.tbl(ts,tr);
  let s; do{ s=(rng()*5)|0; }while(T.sn[s]<4);
  const sl=T.sl[s], sn=T.sn[s];
  ctx=`FUZZ ts=${ts} tr=${tr} suit=${s}`;
  const H=[0,1,2,3].map(()=>new Uint8Array(54));
  const q=0.1+rng()*0.5;
  for(let i=0;i<sn;i++){
    if(rng()<q){ const len=1+((rng()*5)|0); for(let k=0;k<len&&i<sn;k++,i++) H[0][sl[i]]=rng()<0.85?2:1; i--; }
    else if(rng()<0.25) H[0][sl[i]]=1;
  }
  const q1=0.1+rng()*0.6;
  for(let i=0;i<sn;i++){
    if(rng()<q1){ const len=1+((rng()*5)|0); for(let k=0;k<len&&i<sn;k++,i++){ const t=sl[i]; if(H[0][t]===0&&rng()<0.9) H[1][t]=2; else if(H[0][t]===1&&rng()<0.7) H[1][t]=1; } i--; }
  }
  for(let i=0;i<sn;i++){ const t=sl[i]; let rem=2-H[0][t]-H[1][t];
    while(rem-->0){ if(rng()<0.92) H[1+((rng()*3)|0)][t]++; } }
  // 跟牌座位 1:再塞几张别门的牌(填充)
  const fill=(rng()*5)|0;
  for(let i=0;i<fill;i++){ const t=(rng()*54)|0; if(T.eff[t]!==s && H[1][t]<2) H[1][t]++; }
  for(let p=2;p<4;p++){ const nf=(rng()*16)|0;
    for(let i=0;i<nf;i++){ const t=(rng()*54)|0; if(T.eff[t]===s) continue; const used=H[0][t]+H[1][t]+H[2][t]+H[3][t];
      const add=Math.min(2-used,1+(rng()<0.6?1:0)); if(add>0) H[p][t]+=add; } }
  const tot=H.map(h=>h.reduce((a,b)=>a+b,0));
  const toT=h=>{ const a=[]; for(let t=0;t<54;t++) for(let c=0;c<h[t];c++) a.push(t); return a; };
  const toE=h=>{ const a=[]; for(let t=0;t<54;t++) if(h[t]) a.push(DECKO[t]); for(let t=0;t<54;t++) if(h[t]===2) a.push(DECKO[t+54]); return a; };
  const HT=H.map(toT), HE=H.map(toE);
  stats.fuzzCases++;
  // a) decompose / maxTractorLen / classify
  if(HT[0].length){
    const hs=HT[0].filter(t=>T.eff[t]===s);
    const ed=E.decompose(toE(H[0].map((c,t)=>T.eff[t]===s?c:0)),trump);
    const kd=K.util.decomposeT(hs,ts,tr,s);
    stats.fuzzDecomp++;
    const en=ed.filter(c=>c.type!=='single'), kn=kd.filter(c=>c.kind!==0);
    let ok=en.length===kn.length;
    if(ok) for(let i=0;i<en.length;i++){ const a=en[i], b=kn[i];
      if(a.type!==TYPE[b.kind]||a.top!==b.top||(a.type==='tractor'&&a.len!==b.len)||typesOf(a.cards).join()!==b.cards.join()){ ok=false; break; } }
    const es=ed.filter(c=>c.type==='single').map(c=>c.cards[0].id%54).sort((a,b)=>a-b).join(), ks=kd.filter(c=>c.kind===0).map(c=>c.cards[0]).sort((a,b)=>a-b).join();
    if(!ok||es!==ks) bad('fuzzDecompose',{hand:hs,eng:ed.map(c=>[c.type,c.top,typesOf(c.cards)]),kern:kd});
    const eM=E.maxTractorLen(toE(H[0].map((c,t)=>T.eff[t]===s?c:0)),trump), kM=K.util.maxTractorLenT(hs,ts,tr);
    if(eM!==kM) bad('fuzzMaxTractor',{hand:hs,eng:eM,kern:kM});
    if(kd.some(c=>c.kind===2&&c.len>=3)) stats.fuzzTractor3++;
    const pc={}; for(const t of hs) if(H[0][t]===2){ pc[T.ord[t]]=(pc[T.ord[t]]||0)+0.5; }
    if(Object.values(pc).some(x=>x>=1)) stats.fuzzMultiOrd++;
    if(E.countPairsIn(toE(H[0]))!==K.util.countPairsInT(HT[0])) bad('fuzzCountPairs',{hand:HT[0]});
  }
  // 领出牌:hand0 的随机子多重集
  const pickSub=(arr,m,pp)=>{ const out=[], pool=arr.slice();
    for(let i=0;i<pool.length-1&&out.length<m;i++) if(pool[i]===pool[i+1]&&rng()<pp){ out.push(pool[i],pool[i]); pool.splice(i,2); i--; }
    while(out.length<m&&pool.length){ const j=(rng()*pool.length)|0; out.push(pool[j]); pool.splice(j,1); }
    return out.sort((a,b)=>a-b); };
  let lead=[];
  { const hs=HT[0].filter(t=>T.eff[t]===s); const m=1+((rng()*Math.min(7,hs.length))|0);
    const r=rng();
    if(r<0.4){ // 取自己一段拖拉机(或子段)再补
      const comps=K.util.decomposeT(hs,ts,tr,s).filter(c=>c.kind===2);
      if(comps.length){ const c=comps[(rng()*comps.length)|0]; const L=2+((rng()*(c.len-1))|0); const st0=(rng()*(c.len-L+1))|0;
        lead=c.cards.slice(2*st0,2*(st0+L)); const rest=hs.slice(); for(const t of lead) rest.splice(rest.indexOf(t),1);
        const extra=rng()<0.3?((rng()*3)|0):0; lead=lead.concat(pickSub(rest,extra,0.5)).sort((a,b)=>a-b); }
    }
    if(!lead.length) lead=pickSub(hs,m,r<0.7?0.6:0); }
  if(!lead.length) return;
  const lcards=canon(lead), lcl=E.classify(lcards,trump), lke=K.util.classifyT(lead,ts,tr);
  stats.fuzzClassify++;
  if(!sameCl(lcl,lke)) bad('fuzzClassify',{lead,eng:lcl&&[lcl.type,lcl.suit,lcl.top,lcl.len],kern:lke&&[lke.kind,lke.suit,lke.top,lke.len]});
  // b) checkThrow(4 家只有这一门 + 填充)
  { const ce=E.checkThrow(HE,0,lcards,trump), ck=K.util.checkThrowT(HT,0,lead,ts,tr);
    stats.fuzzThrow++; if(lcl.type==='throw'&&!ce.ok) stats.fuzzThrowForced++;
    if(ce.ok!==ck.ok||(!ce.ok&&key(typesOf(ce.forced))!==key(ck.forced))) bad('fuzzThrow',{lead,hands:HT,eng:ce.ok?'ok':typesOf(ce.forced),kern:ck.ok?'ok':ck.forced}); }
  // c) 座位 1 跟牌:谓词 + 完备性
  const n=lead.length;
  { const st=K.newState(); K.setTrump(st,ts,tr);
    for(let p=0;p<4;p++){ st.hand.set(H[p],p*54); st.hn[p]=tot[p]; }
    const lb=Uint8Array.from(lead); K.describeLead(st,lb,0,n); st.cur=1; st.nPlays=1;
    const hand=HE[1], hn=hand.length;
    let C=1; for(let i=0;i<n;i++) C=C*(hn-i)/(i+1);
    if(C<=30000 && hn>=n){
      const have=new Set(); const idx=[]; for(let i=0;i<n;i++) idx.push(i);
      let nsub=0;
      while(true){ nsub++; const sub=idx.map(i=>hand[i]);
        if(E.isLegalFollow(hand,lcl,sub,trump)) have.add(key(typesOf(sub)));
        let i=n-1; while(i>=0&&idx[i]===hn-n+i) i--; if(i<0) break;
        idx[i]++; for(let j=i+1;j<n;j++) idx[j]=idx[j-1]+1; }
      const c=K.enumFollows(st,BUF,100000);
      const kset=new Set(); if(c>=0) for(let i=0;i<c;i++){ const o=K.pos[i]; kset.add(key(BUF.subarray(o+1,o+1+BUF[o]))); }
      stats.fuzzFollowComplete++; stats.fuzzFollowSubsets+=nsub;
      let ok=c>=0&&have.size===kset.size; if(ok) for(const x of have) if(!kset.has(x)){ ok=false; break; }
      if(!ok) bad('fuzzFollowComplete',{lead,hand:HT[1],engN:have.size,kN:kset.size,c,
        missing:[...have].filter(x=>!kset.has(x)).slice(0,4),extra:[...kset].filter(x=>!have.has(x)).slice(0,4)});
    }
    for(let it=0;it<60;it++){
      const pool=hand.slice(); for(let i=0;i<Math.min(n,pool.length);i++){ const j=i+((rng()*(pool.length-i))|0); const x=pool[i]; pool[i]=pool[j]; pool[j]=x; }
      const sub=pool.slice(0,n); if(sub.length<n) break;
      const ty=sub.map(c2=>c2.id%54).sort((a,b)=>a-b);
      const eg=E.isLegalFollow(hand,lcl,sub,trump); BUF2[0]=n; ty.forEach((t,i)=>BUF2[1+i]=t);
      stats.fuzzFollowPred++;
      if(eg!==K.isLegalFollow(st,1,BUF2,0)) bad('fuzzPredicate',{lead,hand:HT[1],sub:ty,eng:eg});
    }
    // d) 一墩:其余三家随机同长度子集(不要求合法)
    for(let rep=0;rep<8;rep++){
      const plays=[{seat:0,cards:lcards}], pt=[{seat:0,types:lead}];
      for(let p=1;p<4;p++){
        if(HT[p].length<n){ break; }
        let ty; const rr=rng();
        if(rr<0.7){ const inS=HT[p].filter(t=>T.eff[t]===s); ty=inS.length>=n?pickSub(inS,n,rng()<0.5?0.7:0):pickSub(HT[p],n,0.5); }
        else if(rr<0.85){ const tc=HT[p].filter(t=>T.eff[t]===4); ty=tc.length>=n?pickSub(tc,n,0.7):pickSub(HT[p],n,0.3); }
        else ty=pickSub(HT[p],n,0);
        plays.push({seat:p,cards:canon(ty)}); pt.push({seat:p,types:ty});
      }
      if(plays.length<4) break;
      const er=E.resolveTrick(plays,trump), kr=K.util.resolveTrickT(pt,ts,tr);
      stats.fuzzTrick++;
      if(er.winner!==kr.winner||er.points!==kr.points) bad('fuzzTrick',{plays:pt,eng:[er.winner,er.points],kern:[kr.winner,kr.points]});
    }
  }
}

let lastSave=Date.now();
const tStart=Date.now();
for(;next<myGames;next++){
  playGame(next); stats.games++;
  { const fr=K.makeRng((mySeed0+next)*40503+7); for(let i=0;i<FZ;i++) fuzzCase(fr); }
  if(Date.now()-lastSave>15000){ save(); lastSave=Date.now(); console.log(`[w${WID}] ${stats.games}/${myGames} games, mismatch=${stats.mismatch}, ${((Date.now()-tStart)/1000).toFixed(0)}s`); }
}
next=myGames; save();
console.log(`[w${WID}] done ${stats.games} games, mismatch=${stats.mismatch}`);
