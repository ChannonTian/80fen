/* ai3/kernel.js —— 「80分 / 升级」上海规则的打牌阶段快速内核。
 * 纯 JS、无依赖、TypedArray。规则以 80fen-test.html 889~1162 行为准,
 * 与现引擎逐位一致由 ai3/difftest.js 保证。表示法与口径见 ai3/README.md。
 *
 * 牌种 t=0..53:suitIdx*13+(rank-2),花色序 S,H,D,C;52 小王,53 大王。
 * 手牌 = 54 长计数数组(0..2)。候选 = 扁平缓冲 [len,t1..tlen,len,...](牌种升序),
 * 候选起点写进 K80.pos[i]。模块内用了全局 scratch,非可重入(单线程顺序调用即可)。
 */
(function(root, factory){
  if(typeof module==='object' && module.exports) module.exports=factory();
  else root.K80=factory();
})(typeof self!=='undefined'?self:this, function(){
'use strict';

/* ================= 主牌表 ================= */
const TB=new Array(65).fill(null);
function tbl(ts,tr){
  const k=ts*13+tr-2; let T=TB[k];
  if(!T) T=TB[k]=buildTbl(ts,tr);
  return T;
}
function buildTbl(ts,tr){
  const eff=new Uint8Array(54), ord=new Uint8Array(54), pts=new Uint8Array(54);
  for(let t=0;t<54;t++){
    if(t>=52){ eff[t]=4; ord[t]=t===52?14:15; continue; }
    const s=(t/13)|0, r=t%13+2;
    pts[t]=r===5?5:(r===10||r===13)?10:0;
    if(r===tr){ eff[t]=4; ord[t]=(ts===4||s===ts)?13:12; }
    else{
      ord[t]=r-2-(r>tr?1:0);
      eff[t]=s===ts?4:s;
    }
  }
  const sl=[],slT=[],sn=new Uint8Array(5);
  for(let s=0;s<5;s++){
    const L=[]; for(let t=0;t<54;t++) if(eff[t]===s) L.push(t);
    slT.push(Uint8Array.from(L));
    L.sort((a,b)=>ord[a]-ord[b]||a-b);
    sl.push(Uint8Array.from(L)); sn[s]=L.length;
  }
  return {ts,tr,eff,ord,pts,sl,slT,sn};
}
const PTS=tbl(4,2).pts;           // 分值与主无关

/* ================= 状态 ================= */
function newState(){
  return {
    hand:new Uint8Array(216), hn:new Uint8Array(4), kitty:new Uint8Array(54),
    tbl:tbl(4,2), ts:4, tr:2, declarer:0, leader:0, cur:0, nPlays:0,
    trickSeat:new Uint8Array(4), trickLen:new Uint8Array(4), trickBuf:new Uint8Array(128),
    defPts:0, tricks:0, lastLeadSize:1, lastWinner:0, kittyPts:0, trickPts:0,
    leadSuit:0, leadN:0, leadKind:0, leadLen:0, leadNeed:0, leadTop:0, leadNRuns:0,
    leadRuns:new Uint8Array(16),
    log:new Uint8Array(512), logLen:0,
    res:{total:0,mult:0,kittyPts:0,defendersWin:false,ups:0,declarerWins:false}
  };
}
function setTrump(st,ts,tr){ st.ts=ts; st.tr=tr; st.tbl=tbl(ts,tr); }
function copy(d,s){
  d.hand.set(s.hand); d.hn.set(s.hn); d.kitty.set(s.kitty);
  d.tbl=s.tbl; d.ts=s.ts; d.tr=s.tr; d.declarer=s.declarer; d.leader=s.leader; d.cur=s.cur; d.nPlays=s.nPlays;
  d.trickSeat.set(s.trickSeat); d.trickLen.set(s.trickLen); d.trickBuf.set(s.trickBuf);
  d.defPts=s.defPts; d.tricks=s.tricks; d.lastLeadSize=s.lastLeadSize; d.lastWinner=s.lastWinner;
  d.kittyPts=s.kittyPts; d.trickPts=s.trickPts;
  d.leadSuit=s.leadSuit; d.leadN=s.leadN; d.leadKind=s.leadKind; d.leadLen=s.leadLen;
  d.leadNeed=s.leadNeed; d.leadTop=s.leadTop; d.leadNRuns=s.leadNRuns; d.leadRuns.set(s.leadRuns);
  d.log.set(s.log); d.logLen=s.logLen;
  return d;
}
/* hands:4 个牌种数组;kitty:被埋的 8 张牌种数组 */
function reset(st,hands,kitty,ts,tr,declarer){
  setTrump(st,ts,tr); st.declarer=declarer; st.leader=declarer; st.cur=declarer; st.nPlays=0;
  st.hand.fill(0); st.kitty.fill(0); st.kittyPts=0;
  for(let p=0;p<4;p++){ const h=hands[p]; st.hn[p]=h.length; for(let i=0;i<h.length;i++) st.hand[p*54+h[i]]++; }
  for(let i=0;i<kitty.length;i++){ st.kitty[kitty[i]]++; st.kittyPts+=PTS[kitty[i]]; }
  st.defPts=0; st.tricks=0; st.lastLeadSize=1; st.lastWinner=declarer; st.trickPts=0;
  st.leadSuit=0; st.leadN=0; st.leadKind=0; st.leadLen=0; st.leadNeed=0; st.leadTop=0; st.leadNRuns=0;
  st.logLen=0;
  return st;
}
function makeRng(seed){ let a=seed>>>0; return function(){ a|=0; a=(a+0x6D2B79F5)|0;
  let t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t;
  return ((t^(t>>>14))>>>0)/4294967296; }; }

const DECK=new Uint8Array(108), HB=[[],[],[],[]];
/* mode 0:正常洗牌;1:按「对子单元」洗牌(手里对子 / 拖拉机多,压测用);
 * 2:同 1,且把级牌四门 + 主花色级牌邻张 + 王放到最前(同序号多对、分层压测)。 */
function dealRandom(st,rng,ts,tr,declarer,mode){
  if(ts===undefined) ts=(rng()*5)|0;
  if(tr===undefined) tr=2+((rng()*13)|0);
  if(declarer===undefined) declarer=(rng()*4)|0;
  if(!mode){
    for(let i=0;i<108;i++) DECK[i]=i%54;
    for(let i=107;i>0;i--){ const j=(rng()*(i+1))|0; const x=DECK[i]; DECK[i]=DECK[j]; DECK[j]=x; }
  } else {
    const U=UNITS; for(let i=0;i<54;i++) U[i]=i;
    let front=0;
    if(mode===2){
      const want=[]; for(let s=0;s<4;s++) want.push(s*13+tr-2);
      if(ts<4){ if(tr>2) want.push(ts*13+tr-3); if(tr<14) want.push(ts*13+tr-1); }
      want.push(52,53);
      for(const t of want){ const j=U.indexOf(t,front); if(j>=0){ U[j]=U[front]; U[front]=t; front++; } }
    }
    for(let i=53;i>front;i--){ const j=front+((rng()*(i-front+1))|0); const x=U[i]; U[i]=U[j]; U[j]=x; }
    for(let i=0;i<54;i++){ DECK[2*i]=U[i]; DECK[2*i+1]=U[i]; }
  }
  const seats=[declarer,(declarer+1)&3,(declarer+2)&3,(declarer+3)&3];
  for(let i=0;i<4;i++){ const h=HB[seats[i]]; h.length=0; for(let k=0;k<25;k++) h.push(DECK[i*25+k]); }
  const dh=HB[declarer]; for(let k=100;k<108;k++) dh.push(DECK[k]);
  for(let i=32;i>24;i--){ const j=(rng()*(i+1))|0; const x=dh[i]; dh[i]=dh[j]; dh[j]=x; }
  const kit=dh.splice(25,8);
  return reset(st,HB,kit,ts,tr,declarer);
}
const UNITS=new Uint8Array(54);

/* ================= 分解 ================= */
const PC=new Uint8Array(16), PT=new Uint8Array(64), SG=new Uint8Array(32);
const SC=new Uint8Array(54), SC2=new Uint8Array(54);
function mkDec(){ return {nc:0,ncards:0,kind:new Uint8Array(40),len:new Uint8Array(40),top:new Uint8Array(40),
  off:new Uint8Array(40),cn:new Uint8Array(40),cards:new Uint8Array(64)}; }
const DEC=mkDec(), DEC2=mkDec(), DEC3=mkDec();
/* 把计数数组 a[b..b+54) 里有效花色 s 的牌分解成组件。分层语义同现引擎:
 * 同序号的第 i 对(牌种升序)落第 i 层,逐层扫连对。组件顺序:第 0 层(序号升序)、第 1 层…、再单张。
 * kind:0 单 1 对 2 拖拉机;len=对数;top=ordIdx;cards 为牌种(对子写两次)。 */
function decomp(a,b,s,T,D){
  const sl=T.sl[s], n=T.sn[s], ord=T.ord;
  PC.fill(0);
  let ns=0, maxL=0;
  for(let i=0;i<n;i++){
    const t=sl[i], c=a[b+t];
    if(c===2){ const o=ord[t], L=PC[o]++; PT[L*16+o]=t; if(L+1>maxL) maxL=L+1; }
    else if(c===1) SG[ns++]=t;
  }
  let nc=0, cp=0;
  for(let L=0;L<maxL;L++){
    let o=0;
    while(o<16){
      if(PC[o]>L){
        let e=o; while(e+1<16 && PC[e+1]>L) e++;
        const len=e-o+1;
        D.kind[nc]=len>1?2:1; D.len[nc]=len; D.top[nc]=e; D.off[nc]=cp; D.cn[nc]=2*len;
        for(let q=o;q<=e;q++){ const t=PT[L*16+q]; D.cards[cp++]=t; D.cards[cp++]=t; }
        nc++; o=e+1;
      } else o++;
    }
  }
  for(let i=0;i<ns;i++){ const t=SG[i];
    D.kind[nc]=0; D.len[nc]=1; D.top[nc]=ord[t]; D.off[nc]=cp; D.cn[nc]=1; D.cards[cp++]=t; nc++; }
  D.nc=nc; D.ncards=cp;
}
/* 有效花色 s 里最长拖拉机(对数),0 = 没有 */
function maxTractor(a,b,s,T){
  const sl=T.sl[s], n=T.sn[s], ord=T.ord;
  PC.fill(0); let maxL=0;
  for(let i=0;i<n;i++){ const t=sl[i]; if(a[b+t]===2){ const L=++PC[ord[t]]; if(L>maxL) maxL=L; } }
  let best=0;
  for(let L=0;L<maxL;L++){
    let run=0;
    for(let o=0;o<16;o++){ if(PC[o]>L){ run++; if(run>1&&run>best) best=run; } else run=0; }
  }
  return best;
}
/* 一串牌(a[off..off+n))的连对段长度,降序写进 out;返回段数。 */
const RUNTMP=new Uint8Array(16);
function runsOf(a,off,n,T,out){
  if(n===1) return 0;
  if(n===2) { if(a[off]===a[off+1]){ out[0]=1; return 1; } return 0; }
  const ord=T.ord; PC.fill(0); let maxL=0;
  for(let i=0;i<n;i++) SC[a[off+i]]++;
  for(let i=0;i<n;i++){ const t=a[off+i]; if(SC[t]===2){ SC[t]=0; const L=++PC[ord[t]]; if(L>maxL) maxL=L; } }
  for(let i=0;i<n;i++) SC[a[off+i]]=0;
  let nr=0;
  for(let L=0;L<maxL;L++){
    let run=0;
    for(let o=0;o<16;o++){
      if(PC[o]>L) run++;
      else if(run){ out[nr++]=run; run=0; }
    }
    if(run) out[nr++]=run;
  }
  // 降序(段数很少,插入排序)
  for(let i=1;i<nr;i++){ const v=out[i]; let j=i-1; while(j>=0&&out[j]<v){ out[j+1]=out[j]; j--; } out[j+1]=v; }
  return nr;
}

/* 设置领出描述(来自实际领出的牌)。要求同一有效花色。 */
function describeLead(st,a,off,n){
  const T=st.tbl, ord=T.ord;
  st.leadN=n; st.leadSuit=T.eff[a[off]];
  let top=0; for(let i=0;i<n;i++){ const o=ord[a[off+i]]; if(o>top) top=o; }
  st.leadTop=top;
  const nr=runsOf(a,off,n,T,st.leadRuns);
  st.leadNRuns=nr;
  let need=0; for(let i=0;i<nr;i++) need+=st.leadRuns[i];
  st.leadNeed=need;
  const ncomp=nr+(n-2*need);
  if(ncomp>=2){ st.leadKind=3; st.leadLen=0; }
  else if(n===1){ st.leadKind=0; st.leadLen=0; }
  else if(need===1){ st.leadKind=1; st.leadLen=0; }
  else { st.leadKind=2; st.leadLen=need; }
}

/* ================= 甩牌校验 ================= */
const SM_MAX=new Int8Array(4), SM_PAIR=new Int8Array(4), SM_TR=new Int8Array(64), SPC=new Uint8Array(16);
/* 座位 p 在有效花色 s 里:最大牌序 / 最大对序 / 各长度 (>=L) 拖拉机的最大 top */
function summ(st,p,s){ TBL_CUR=st.tbl; summA(st.hand,p*54,p,s); }
function summA(h,b,p,s){
  const T=TBL_CUR, sl=T.sl[s], n=T.sn[s], ord=T.ord;
  let mx=-1, mp=-1, maxL=0; SPC.fill(0);
  for(let i=0;i<n;i++){ const t=sl[i], c=h[b+t];
    if(c){ const o=ord[t]; if(o>mx) mx=o;
      if(c===2){ if(o>mp) mp=o; const L=++SPC[o]; if(L>maxL) maxL=L; } } }
  SM_MAX[p]=mx; SM_PAIR[p]=mp;
  const q=p*16; for(let l=0;l<16;l++) SM_TR[q+l]=-1;
  for(let L=0;L<maxL;L++){
    let run=0;
    for(let o=0;o<16;o++){
      if(SPC[o]>L){ run++; for(let l=2;l<=run;l++) if(o>SM_TR[q+l]) SM_TR[q+l]=o; } else run=0;
    }
  }
}
let TBL_CUR=null;

/* 座位 seat 的视角:没见过的牌(108 − 自己手牌 − 已打出 − 自己是庄时的底)与各家各有效花色的「已知断门」。
 * 断门 = 该门被领出时,这家出的该门牌数不足张数(只能是出完了)。outUnseen: Uint8Array(54);outVoid: Uint8Array(20)(座位*5+有效花色)。
 * 只读自己的手牌、出牌日志和(庄家的)底,不读别家手牌。 */
function viewInfo(st,seat,outUnseen,outVoid){
  const T=st.tbl, eff=T.eff, h=st.hand, b=seat*54, lg=st.log;
  for(let t=0;t<54;t++) outUnseen[t]=2-h[b+t]-(seat===st.declarer?st.kitty[t]:0);
  outVoid.fill(0);
  let p=0, i=0, ls=0;
  while(p<st.logLen){
    const sd=lg[p], n=lg[p+1];
    for(let k=0;k<n;k++) outUnseen[lg[p+2+k]]--;
    if((i&3)===0) ls=eff[lg[p+2]];
    else { let c=0; for(let k=0;k<n;k++) if(eff[lg[p+2+k]]===ls) c++; if(c<n) outVoid[sd*5+ls]=1; }
    p+=2+n; i++;
  }
}
const VU=new Uint8Array(54), VV=new Uint8Array(20), VPH=new Uint8Array(54);
/* 甩牌模式 2:假想对手 = 该门全部没见过的牌;另三家都已知断这门则没有对手 */
function summPhantom(st,seat,s){
  const T=st.tbl; TBL_CUR=T;
  let opp=false;
  for(let p=0;p<4;p++) if(p!==seat && !VV[p*5+s]) opp=true;
  const ph=(seat+1)&3;
  for(let p=0;p<4;p++){ if(p===seat) continue;
    if(p===ph && opp){ summA(VPH,0,p,s); }
    else { SM_MAX[p]=-1; SM_PAIR[p]=-1; for(let l=0;l<16;l++) SM_TR[p*16+l]=-1; }
  }
}
function beaten(kind,len,top,seat){
  for(let p=0;p<4;p++){
    if(p===seat) continue;
    if(kind===0){ if(SM_MAX[p]>top) return true; }
    else if(kind===1){ if(SM_PAIR[p]>top) return true; }
    else if(SM_TR[p*16+len]>top) return true;
  }
  return false;
}
/* 对 DEC 里的甩牌做校验。需先 summ 过其他三家。返回 -1 = 通过,否则 = 被强制出的组件下标 */
function forcedComp(D,seat){
  let low=-1;
  for(let i=0;i<D.nc;i++){
    if(!beaten(D.kind[i],D.len[i],D.top[i],seat)) continue;
    if(low<0 || D.cn[i]<D.cn[low] || (D.cn[i]===D.cn[low] && D.top[i]<D.top[low])) low=i;
  }
  return low;
}

/* ================= 出牌推进 ================= */
function logPlay(st,seat,a,off,n){
  let p=st.logLen; st.log[p++]=seat; st.log[p++]=n;
  for(let i=0;i<n;i++) st.log[p++]=a[off+i];
  st.logLen=p;
}
function putPlay(st,seat,a,off,n){
  const h=st.hand, b=seat*54, i=st.nPlays, q=i*32;
  for(let k=0;k<n;k++){ const t=a[off+k]; h[b+t]--; st.trickBuf[q+k]=t; }
  st.hn[seat]-=n; st.trickSeat[i]=seat; st.trickLen[i]=n;
  logPlay(st,seat,a,off,n);
  st.nPlays=i+1;
}
const FB=new Uint8Array(32);
/* 领出。cards = buf[pos]=len,后接牌种。允许任意同一有效花色的非空牌集;
 * 多组件时走 checkThrow,不过改出 forced。返回 0=原样,1=被强制改出,-1=非法(不改状态) */
function playLead(st,buf,pos){
  const seat=st.cur, n=buf[pos], T=st.tbl, eff=T.eff, h=st.hand, b=seat*54;
  if(n<1||st.nPlays!==0) return -1;
  const s=eff[buf[pos+1]];
  for(let i=0;i<n;i++){ if(eff[buf[pos+1+i]]!==s) return -1; }
  for(let i=0;i<n;i++) SC[buf[pos+1+i]]++;
  let bad=false;
  for(let i=0;i<n;i++){ const t=buf[pos+1+i]; if(SC[t]>h[b+t]) bad=true; }
  let forced=0, a=buf, off=pos+1, m=n;
  if(!bad && n>=2){
    decomp(SC,0,s,T,DEC);
    if(DEC.nc>=2){
      for(let p=0;p<4;p++) if(p!==seat) summ(st,p,s);
      const f=forcedComp(DEC,seat);
      if(f>=0){ m=DEC.cn[f]; for(let i=0;i<m;i++) FB[i]=DEC.cards[DEC.off[f]+i]; a=FB; off=0; forced=1; }
    }
  }
  for(let i=0;i<n;i++) SC[buf[pos+1+i]]=0;
  if(bad) return -1;
  describeLead(st,a,off,m);
  putPlay(st,seat,a,off,m);
  st.cur=(seat+1)&3;
  return forced;
}
function isLegalFollow(st,seat,buf,pos){
  const n=buf[pos], T=st.tbl, eff=T.eff, h=st.hand, b=seat*54, s=st.leadSuit;
  if(n!==st.leadN) return false;
  let ok=true, inS=0;
  for(let i=0;i<n;i++){ const t=buf[pos+1+i]; if(++SC[t]>h[b+t]) ok=false; if(eff[t]===s) inS++; }
  let res=false;
  if(ok){
    const sl=T.sl[s], sn=T.sn[s];
    let k=0, pairsS=0;
    for(let i=0;i<sn;i++){ const c=h[b+sl[i]]; k+=c; if(c===2) pairsS++; }
    if(inS===(n<k?n:k)){
      res=true;
      const need=st.leadNeed;
      if(need>0){
        const must=need<pairsS?need:pairsS;
        if(must>0){ let cp=0; for(let i=0;i<sn;i++) if(SC[sl[i]]===2) cp++; if(cp<must) res=false; }
      }
      if(res && st.leadKind===2){
        const m=maxTractor(h,b,s,T), L=st.leadLen;
        if(m>=2){
          const cm=maxTractor(SC,0,s,T);
          if(m>=L ? cm<L : cm<m) res=false;
        }
      }
    }
  }
  for(let i=0;i<n;i++) SC[buf[pos+1+i]]=0;
  return res;
}
/* 跟牌。不检查合法性(合法性请用 isLegalFollow / 枚举);超 4 家时结算一墩。返回 1=本墩已结算 */
function playFollow(st,buf,pos){
  const seat=st.cur;
  putPlay(st,seat,buf,pos+1,buf[pos]);
  if(st.nPlays===4){ resolveTrick(st); return 1; }
  st.cur=(seat+1)&3; return 0;
}
const CR=new Uint8Array(16), CAPA=new Uint8Array(16);
function fitR(i,nn,nc){
  if(i===nn) return true;
  const need=CRN[i];
  for(let j=0;j<nc;j++){
    if(CAPA[j]<need) continue;
    CAPA[j]-=need;
    if(fitR(i+1,nn,nc)) { CAPA[j]+=need; return true; }
    CAPA[j]+=need;
  }
  return false;
}
let CRN=null;
/* 结算 st 里已有的 4 手:赢家/分数。更新 leader/cur/defPts/... 并清空本墩。 */
function resolveTrick(st){
  const T=st.tbl, eff=T.eff, ord=T.ord, tb=st.trickBuf, n=st.leadN;
  let win=0, bestSuit=st.leadSuit, bestTop=st.leadTop, pts=0;
  const pt=T.pts;
  for(let k=0;k<n;k++) pts+=pt[tb[k]];
  const nr=st.leadNRuns;
  for(let i=1;i<4;i++){
    const q=i*32;
    if(st.trickLen[i]!==n) { continue; }
    const s=eff[tb[q]];
    let same=true, top=ord[tb[q]];
    for(let k=0;k<n;k++){ const t=tb[q+k]; pts+=pt[t]; if(eff[t]!==s) same=false; const o=ord[t]; if(o>top) top=o; }
    if(!same) continue;
    if(s!==bestSuit && s!==4) continue;
    if(nr>0){
      const cn=runsOf(tb,q,n,T,CR);
      for(let k=0;k<cn;k++) CAPA[k]=CR[k];
      CRN=st.leadRuns;
      if(!fitR(0,nr,cn)) continue;
    }
    if(s===bestSuit){ if(top>bestTop){ win=i; bestTop=top; } }
    else { win=i; bestSuit=4; bestTop=top; }
  }
  const w=st.trickSeat[win];
  st.trickPts=pts;
  if(((w^st.declarer)&1)===1) st.defPts+=pts;
  st.lastLeadSize=n; st.lastWinner=w; st.leader=w; st.cur=w; st.tricks++; st.nPlays=0;
  return w;
}
/* 假设当前座位把 buf[pos..](len,牌种…)跟在本墩已有的出牌后面,此刻本墩暂时最大的是谁(座位号)。不改状态
 * (只写本墩尚未使用的下一个槽)。要求 nPlays>=1 且领出描述已设;逻辑与 resolveTrick 一致,只是不要求 4 手到齐。 */
function peekWinner(st,buf,pos){
  const i0=st.nPlays, q0=i0*32, n0=buf[pos];
  for(let k=0;k<n0;k++) st.trickBuf[q0+k]=buf[pos+1+k];
  st.trickLen[i0]=n0; st.trickSeat[i0]=st.cur;
  const T=st.tbl, eff=T.eff, ord=T.ord, tb=st.trickBuf, n=st.leadN, nr=st.leadNRuns;
  let win=0, bestSuit=st.leadSuit, bestTop=st.leadTop;
  for(let i=1;i<=i0;i++){
    const q=i*32;
    if(st.trickLen[i]!==n) continue;
    const s=eff[tb[q]];
    let same=true, top=ord[tb[q]];
    for(let k=0;k<n;k++){ const t=tb[q+k]; if(eff[t]!==s) same=false; const o=ord[t]; if(o>top) top=o; }
    if(!same) continue;
    if(s!==bestSuit && s!==4) continue;
    if(nr>0){
      const cn=runsOf(tb,q,n,T,CR);
      for(let k=0;k<cn;k++) CAPA[k]=CR[k];
      CRN=st.leadRuns;
      if(!fitR(0,nr,cn)) continue;
    }
    if(s===bestSuit){ if(top>bestTop){ win=i; bestTop=top; } }
    else { win=i; bestSuit=4; bestTop=top; }
  }
  return st.trickSeat[win];
}
const done=st=>st.nPlays===0 && (st.hn[0]+st.hn[1]+st.hn[2]+st.hn[3])===0;
function score(st){
  const r=st.res, mult=2*(st.lastLeadSize||1);
  const defWon=((st.lastWinner^st.declarer)&1)===1;
  const total=st.defPts+(defWon?st.kittyPts*mult:0);
  r.total=total; r.mult=mult; r.kittyPts=st.kittyPts;
  r.defendersWin=total>=80; r.declarerWins=total<80;
  r.ups = total<80 ? (total===0?3:total<40?2:1) : Math.floor((total-80)/40);
  return r;
}

/* ================= 候选枚举 ================= */
const POS=new Int32Array(8192);
let OB=null, OP=0, OC=0, OVER=0;
function emit(arr,n){
  if(OC>=POS.length || OP+n+1>OB.length){ OVER=1; return; }
  POS[OC++]=OP; OB[OP++]=n;
  for(let i=0;i<n;i++) OB[OP++]=arr[i];
}
function emitSorted(arr,n){
  for(let i=1;i<n;i++){ const v=arr[i]; let j=i-1; while(j>=0&&arr[j]>v){ arr[j+1]=arr[j]; j--; } arr[j+1]=v; }
  emit(arr,n);
}
const EPC=new Uint8Array(16), EPT=new Uint8Array(64), TS=new Uint8Array(32), TMP=new Uint8Array(64), UI=new Uint8Array(40);
function tracDfs(o,d){
  const c=EPC[o];
  for(let L=0;L<c;L++){
    TS[d]=EPT[L*16+o];
    if(d>=1){ for(let i=0;i<=d;i++){ TMP[2*i]=TS[i]; TMP[2*i+1]=TS[i]; } emitSorted(TMP,2*(d+1)); }
    if(o<15 && EPC[o+1]>0) tracDfs(o+1,d+1);
  }
}
function enumLeads(st,buf,throwMode){
  const seat=st.cur, T=st.tbl, h=st.hand, b=seat*54, ord=T.ord;
  OB=buf; OP=0; OC=0; OVER=0;
  if(throwMode===2) viewInfo(st,seat,VU,VV);
  for(let s=0;s<5;s++){
    const sl=T.sl[s], sn=T.sn[s];
    EPC.fill(0); let any=false, anyPair=false, risky=false;
    for(let i=0;i<sn;i++){
      const t=sl[i], c=h[b+t];
      if(!c) continue;
      any=true;
      TMP[0]=t; emit(TMP,1);
      if(c===2){ TMP[0]=t; TMP[1]=t; emit(TMP,2); anyPair=true;
        const o=ord[t], L=EPC[o]++; EPT[L*16+o]=t; if(L>0) risky=true; }
    }
    if(!any) continue;
    if(anyPair){
      for(let o=0;o<15;o++) if(EPC[o]>0 && EPC[o+1]>0){
        // 从 o 起点出发的所有连续子段(起点 o,长度>=2)
        tracStart(o);
      }
    }
    if(throwMode && !(sn<2)){
      decomp(h,b,s,T,DEC2);
      if(DEC2.nc>=2){
        if(throwMode===2){
          for(let t=0;t<54;t++) VPH[t]=T.eff[t]===s?VU[t]:0;
          summPhantom(st,seat,s);
        } else for(let p=0;p<4;p++) if(p!==seat) summ(st,p,s);
        let nu=0;
        for(let i=0;i<DEC2.nc;i++) if(!beaten(DEC2.kind[i],DEC2.len[i],DEC2.top[i],seat)) UI[nu++]=i;
        if(nu>=2){
          if(nu<=6){
            for(let mask=3;mask<(1<<nu);mask++){
              if((mask&(mask-1))===0) continue;
              unionEmit(mask,0,0,nu,seat,s,T,risky);
            }
          } else {
            unionEmit((1<<nu)-1,0,0,nu,seat,s,T,risky,true);
            for(let i=0;i<nu;i++) for(let j=i+1;j<nu;j++) unionEmit((1<<i)|(1<<j),0,0,nu,seat,s,T,risky,true);
          }
        }
      }
    }
  }
  return OVER?-1:OC;
}
function tracStart(o){ // 以序号 o 为起点,在 o..o+k 上枚举每种选法(k>=1)
  const c=EPC[o];
  for(let L=0;L<c;L++){ TS[0]=EPT[L*16+o]; if(o<15 && EPC[o+1]>0) tracDfs(o+1,1); }
}
function unionEmit(mask,_a,_b,nu,seat,s,T,risky,wide){
  let n=0;
  for(let i=0;i<nu;i++) if(mask&(1<<i)){ const c=UI[i]; for(let k=0;k<DEC2.cn[c];k++) TMP[n++]=DEC2.cards[DEC2.off[c]+k]; }
  if(risky){
    // 同序号多对:合并后分解可能和整手分解不同,完整复核
    for(let i=0;i<n;i++) SC2[TMP[i]]++;
    decomp(SC2,0,s,T,DEC3);
    let okk=DEC3.nc>=2;
    if(okk) for(let i=0;i<DEC3.nc;i++) if(beaten(DEC3.kind[i],DEC3.len[i],DEC3.top[i],seat)){ okk=false; break; }
    for(let i=0;i<n;i++) SC2[TMP[i]]=0;
    if(!okk) return;
  }
  emitSorted(TMP,n);
}

/* 跟牌枚举 */
let CAP=0, ABORT=0, NODES=0, LN=0, R=0, FS=0;
const LT=new Uint8Array(64), LL=new Uint8Array(64), LH=new Uint8Array(64);
const SLO=new Int16Array(65), SHI=new Int16Array(65), PS=new Int16Array(65);
const STK=new Uint8Array(32), CH=new Uint8Array(54);
let FN=0, FT=null;
function fdfs(i,m,pn,sp){
  if(ABORT) return;
  if(m===0){
    if(SLO[i]>0||pn>0) return;
    if(R>=2 && maxTractor(CH,0,FS,FT)<R) return;
    if(OC>=CAP){ ABORT=1; return; }
    if(OC>=POS.length || OP+FN+1>OB.length){ ABORT=1; return; }
    POS[OC++]=OP; OB[OP++]=FN; for(let k=0;k<FN;k++) OB[OP++]=STK[k];
    return;
  }
  if(i>=LN) return;
  if(++NODES>20000){ ABORT=1; return; }
  if(m>SHI[i]||m<SLO[i]) return;
  if(pn>0 && (PS[i]<pn || 2*pn>m)) return;
  const t=LT[i], hi=LH[i]<m?LH[i]:m;
  for(let c=LL[i];c<=hi;c++){
    if(c){ STK[sp]=t; if(c===2) STK[sp+1]=t; CH[t]=c; }
    fdfs(i+1,m-c,c===2?pn-1:pn,sp+c);
    if(ABORT){ CH[t]=0; return; }
  }
  CH[t]=0;
}
/* 枚举当前座位所有合法跟法。个数 > cap 返回 -1。 */
function enumFollows(st,buf,cap){
  const seat=st.cur, T=st.tbl, h=st.hand, b=seat*54, s=st.leadSuit, n=st.leadN, eff=T.eff;
  if(cap>POS.length-1) cap=POS.length-1;
  OB=buf; OP=0; OC=0;
  const sl=T.sl[s], sn=T.sn[s];
  let k=0, pairsS=0;
  for(let i=0;i<sn;i++){ const c=h[b+sl[i]]; k+=c; if(c===2) pairsS++; }
  if(n===1){
    if(k>0){ for(let i=0;i<sn;i++){ const t=sl[i]; if(h[b+t]){ if(OC>=cap) return -1; POS[OC++]=OP; OB[OP++]=1; OB[OP++]=t; } } }
    else { for(let t=0;t<54;t++) if(h[b+t]){ if(OC>=cap) return -1; POS[OC++]=OP; OB[OP++]=1; OB[OP++]=t; } }
    return OC;
  }
  if(k>0 && k<=n && n===k){ // 全出本门
    POS[OC++]=OP; OB[OP++]=n;
    const slT=T.slT[s]; for(let i=0;i<slT.length;i++){ const t=slT[i], c=h[b+t]; for(let q=0;q<c;q++) OB[OP++]=t; }
    return 1;
  }
  CAP=cap; ABORT=0; NODES=0; FN=n; FS=s; FT=T; R=0;
  let LNn=0, need=0, mustP=0;
  if(k>n){
    const slT=T.slT[s];
    for(let i=0;i<slT.length;i++){ const t=slT[i], c=h[b+t]; if(c){ LT[LNn]=t; LL[LNn]=0; LH[LNn]=c; LNn++; } }
    need=st.leadNeed; mustP=need<pairsS?need:pairsS;
    if(st.leadKind===2){
      const m=maxTractor(h,b,s,T), L=st.leadLen;
      R= m>=L ? L : (m>=2 ? m : 0);
    }
  } else {
    for(let t=0;t<54;t++){ const c=h[b+t]; if(c){ LT[LNn]=t; if(eff[t]===s){ LL[LNn]=c; } else LL[LNn]=0; LH[LNn]=c; LNn++; } }
  }
  LN=LNn;
  SLO[LN]=0; SHI[LN]=0; PS[LN]=0;
  for(let i=LN-1;i>=0;i--){ SLO[i]=SLO[i+1]+LL[i]; SHI[i]=SHI[i+1]+LH[i]; PS[i]=PS[i+1]+(LH[i]===2?1:0); }
  fdfs(0,n,mustP,0);
  for(let i=0;i<LN;i++) CH[LT[i]]=0;
  return ABORT?-1:OC;
}
/* 随机一手合法跟法,写进 buf[pos..],返回占用长度 n+1 */
const POOL=new Uint8Array(32), SEL=new Uint8Array(54);
function sampleFollow(st,rng,buf,pos){
  const seat=st.cur, T=st.tbl, h=st.hand, b=seat*54, s=st.leadSuit, n=st.leadN, eff=T.eff, ord=T.ord;
  const sl=T.sl[s], sn=T.sn[s];
  let k=0, pairsS=0;
  for(let i=0;i<sn;i++){ const c=h[b+sl[i]]; k+=c; if(c===2) pairsS++; }
  SEL.fill(0);
  let used=0;
  if(k<=n){
    for(let i=0;i<sn;i++){ const t=sl[i]; SEL[t]=h[b+t]; }
    used=k;
  } else {
    const mustP=Math.min(st.leadNeed,pairsS);
    let r=0;
    if(st.leadKind===2){ const m=maxTractor(h,b,s,T), L=st.leadLen; r= m>=L?L:(m>=2?m:0); }
    let pairsHave=0;
    if(r>=2){
      EPC.fill(0);
      for(let i=0;i<sn;i++){ const t=sl[i]; if(h[b+t]===2){ const o=ord[t], L=EPC[o]++; EPT[L*16+o]=t; } }
      let ns=0;
      for(let o=0;o+r<=16;o++){ let ok=true; for(let q=0;q<r;q++) if(!EPC[o+q]){ ok=false; break; } if(ok) UI[ns++]=o; }
      if(ns){ const o0=UI[(rng()*ns)|0];
        for(let q=0;q<r;q++){ const o=o0+q, t=EPT[((rng()*EPC[o])|0)*16+o]; SEL[t]=2; } pairsHave=r; used=2*r; }
    }
    while(pairsHave<mustP){
      let cntP=0; for(let i=0;i<sn;i++){ const t=sl[i]; if(h[b+t]===2&&SEL[t]===0) cntP++; }
      let x=(rng()*cntP)|0;
      for(let i=0;i<sn;i++){ const t=sl[i]; if(h[b+t]===2&&SEL[t]===0){ if(x--===0){ SEL[t]=2; break; } } }
      pairsHave++; used+=2;
    }
  }
  // 补足:从可用牌里随机抽
  let rem=n-used;
  if(rem>0){
    let np=0;
    for(let t=0;t<54;t++){
      const c=h[b+t]-SEL[t];
      if(c<=0) continue;
      if(k>n && eff[t]!==s) continue;
      if(k<=n && eff[t]===s) continue;
      for(let q=0;q<c;q++) POOL[np++]=t;
    }
    for(let i=0;i<rem;i++){ const j=i+((rng()*(np-i))|0); const x=POOL[i]; POOL[i]=POOL[j]; POOL[j]=x; SEL[POOL[i]]++; }
  }
  let w=pos+1;
  for(let t=0;t<54;t++){ const c=SEL[t]; if(c){ buf[w++]=t; if(c===2) buf[w++]=t; } }
  buf[pos]=n;
  return n+1;
}

/* ---- 跟牌候选的降级(全枚举超 cap / 预算时用)----
 * 门内必出的部分(本门全出;或必出的拖拉机 / 对子)照规则穷举,太多就抽样;自由张取几族(贪心最小垫法及邻近变体、
 * 每门「从小到大」「整门垫空」、断门时能毙的主牌组合)并去重;再用 sampleFollow 随机补到约 128 个。每个候选都过 isLegalFollow。
 * 返回候选数(>=1);候选写进 buf / K80.pos,与 enumFollows 同格式。 */
const RTB=new Uint8Array(64), RTB2=new Uint8Array(64), RMC=new Uint8Array(54);
function enumFollowsReduced(st,buf,cap,rng){
  const seat=st.cur, T=st.tbl, h=st.hand, b=seat*54, s=st.leadSuit, n=st.leadN, eff=T.eff, ord=T.ord, pt=T.pts;
  if(cap>POS.length-1) cap=POS.length-1;
  const target=Math.min(cap,128);
  OB=buf; OP=0; OC=0;
  const seen=new Set();
  const add=(c)=>{
    if(OC>=cap) return false;
    let m=0, key='';
    for(let t=0;t<54;t++){ const x=c[t]; if(x){ m+=x; key+=t+(x===2?'x':','); } }
    if(m!==n||seen.has(key)) return false;
    let w=1; for(let t=0;t<54;t++){ const x=c[t]; for(let q=0;q<x;q++) RTB[w++]=t; }
    RTB[0]=n;
    if(!isLegalFollow(st,seat,RTB,0)) return false;
    if(OP+n+1>OB.length) return false;
    seen.add(key);
    POS[OC++]=OP; OB[OP++]=n; for(let i=0;i<n;i++) OB[OP++]=RTB[1+i];
    return true;
  };
  const sl=T.sl[s], sn=T.sn[s];
  let k=0, pairsS=0;
  for(let i=0;i<sn;i++){ const c=h[b+sl[i]]; k+=c; if(c===2) pairsS++; }
  const shuf=(arr)=>{ for(let i=arr.length-1;i>0;i--){ const j=(rng()*(i+1))|0; const x=arr[i]; arr[i]=arr[j]; arr[j]=x; } return arr; };
  const key1=(a,c)=>(pt[a]-pt[c])||((eff[a]===4?1:0)-(eff[c]===4?1:0))||(ord[a]-ord[c])||(a-c);   // 分值小、非主、序号小
  const key3=(a,c)=>(pt[c]-pt[a])||((eff[a]===4?1:0)-(eff[c]===4?1:0))||(ord[a]-ord[c])||(a-c);
  const key2=(a,c)=>((eff[a]===4?1:0)-(eff[c]===4?1:0))||(ord[a]-ord[c])||(pt[a]-pt[c])||(a-c);
  /* 自由张:在池 P(计数)里取 f 张,与必出部分 M 合并后 add */
  const C=new Uint8Array(54);
  const withM=(M,pick)=>{ C.set(M); for(let i=0;i<pick.length;i++) C[pick[i]]++; const r=add(C); return r; };
  const fills=(M,P,f,rich)=>{
    if(f===0){ withM(M,[]); return; }
    const types=[]; for(let t=0;t<54;t++) if(P[t]) types.push(t);
    const expand=(cmp)=>{ const L=types.slice().sort(cmp), X=[]; for(const t of L) for(let q=0;q<P[t];q++) X.push(t); return X; };
    for(const cmp of [key1,key2,key3]){
      const X=expand(cmp);
      withM(M,X.slice(0,f));
      if(rich){
        for(let j=0;j<f;j++) for(let r=0;r<3;r++){
          const e=f+r; if(e>=X.length) break;
          const pk=X.slice(0,f); pk[j]=X[e]; withM(M,pk);
        }
      }
    }
    if(rich){
      const bySuit={}; for(const t of types){ (bySuit[eff[t]]=bySuit[eff[t]]||[]).push(t); }
      for(const g in bySuit){
        const L=bySuit[g].slice().sort((x,y)=>(ord[x]-ord[y])||(x-y)), X=[];
        for(const t of L) for(let q=0;q<P[t];q++) X.push(t);
        if(X.length>=f) withM(M,X.slice(0,f));
        else if(X.length>0){                                  // 整门垫空,其余按贪心补
          const rest=P.slice(); for(const t of X) rest[t]--;
          const tl=[]; for(let t=0;t<54;t++) if(rest[t]) tl.push(t);
          tl.sort(key1); const Y=[]; for(const t of tl) for(let q=0;q<rest[t];q++) Y.push(t);
          withM(M,X.concat(Y.slice(0,f-X.length)));
        }
      }
      /* 分门取小:每门各取若干张「分少、序号小」的牌,门间张数的各种组合(超 80 个随机抽) */
      const gl=[]; for(const g in bySuit){
        const L=bySuit[g].slice().sort(key1), X=[]; for(const t of L) for(let q=0;q<P[t];q++) X.push(t); gl.push(X); }
      if(gl.length>=2){
        const combos=[], cnt=new Array(gl.length).fill(0);
        const dfs=(gi,left)=>{
          if(combos.length>=3000) return;
          if(gi===gl.length-1){ if(left<=gl[gi].length){ cnt[gi]=left; combos.push(cnt.slice()); } return; }
          for(let c=0;c<=Math.min(left,gl[gi].length);c++){ cnt[gi]=c; dfs(gi+1,left-c); }
        };
        dfs(0,f);
        let pick=combos; if(combos.length>80) pick=shuf(combos.slice()).slice(0,80);
        for(const cb of pick){ const sel=[]; for(let i=0;i<gl.length;i++) for(let q=0;q<cb[i];q++) sel.push(gl[i][q]); withM(M,sel); }
      }
    }
  };
  const zero=new Uint8Array(54);
  if(k<=n){
    const M=new Uint8Array(54), P=new Uint8Array(54);
    for(let t=0;t<54;t++){ if(eff[t]===s) M[t]=h[b+t]; else P[t]=h[b+t]; }
    fills(M,P,n-k,true);
    if(k===0){
      /* 断门:能毙的主牌组合(structMatches 领出的) */
      const tp=new Uint8Array(54); let tn=0; for(let t=0;t<54;t++) if(eff[t]===4){ tp[t]=h[b+t]; tn+=tp[t]; }
      if(tn>=n){
        const runs=[]; for(let i=0;i<st.leadNRuns;i++) runs.push(st.leadRuns[i]);
        const found=[];
        const construct=(mode)=>{   // mode 0 最小 1 最大 2 随机
          const rem=tp.slice(), pick=new Uint8Array(54);
          for(const r of runs){
            const starts=[];
            for(let o=0;o+r<=16;o++){ let ok=true; for(let q=0;q<r;q++){ if(!ocnt(rem,o+q,2)){ ok=false; break; } } if(ok) starts.push(o); }
            if(!starts.length) return null;
            const o0=mode===0?starts[0]:mode===1?starts[starts.length-1]:starts[(rng()*starts.length)|0];
            for(let q=0;q<r;q++){ const ts=typesAtOrd(rem,o0+q,2); const t=mode===2?ts[(rng()*ts.length)|0]:ts[0]; rem[t]-=2; pick[t]+=2; }
          }
          let need=n-2*runs.reduce((x,y)=>x+y,0);
          const sg=[]; for(let t=0;t<54;t++) for(let q=0;q<rem[t];q++) sg.push(t);
          sg.sort((x,y)=>(ord[x]-ord[y])||(x-y));
          if(mode===1) sg.reverse(); else if(mode===2) shuf(sg);
          if(sg.length<need) return null;
          for(let i=0;i<need;i++) pick[sg[i]]++;
          return pick;
        };
        const ocnt=(rem,o,c)=>{ for(let t=0;t<54;t++) if(eff[t]===4&&ord[t]===o&&rem[t]>=c) return true; return false; };
        const typesAtOrd=(rem,o,c)=>{ const r=[]; for(let t=0;t<54;t++) if(eff[t]===4&&ord[t]===o&&rem[t]>=c) r.push(t); return r; };
        const okStruct=(pick)=>{ for(let t=0;t<54;t++) if(pick[t]>tp[t]) return false;
          const q=[]; for(let t=0;t<54;t++) for(let c=0;c<pick[t];c++) q.push(t);
          if(!runs.length) return true;
          const cn=runsOf(Uint8Array.from(q),0,q.length,T,CR);
          for(let i=0;i<cn;i++) CAPA[i]=CR[i];
          CRN=st.leadRuns; return fitR(0,runs.length,cn); };
        const seenR=new Set();
        for(let it=0;it<48;it++){
          const pk=construct(it<2?it:2); if(!pk) { if(it<2) continue; else break; }
          if(!okStruct(pk)) continue;
          const kk=pk.join(''); if(seenR.has(kk)) continue; seenR.add(kk); found.push(pk);
        }
        const sc=(pk)=>{ let v=0; for(let t=0;t<54;t++) v+=pk[t]*(ord[t]*4+pt[t]); return v; };
        found.sort((x,y)=>sc(x)-sc(y));
        const keep=found.length>32?found.slice(0,16).concat(found.slice(-16)):found;
        for(const pk of keep){ C.set(pk); add(C); }
      }
    }
  } else {
    /* k>n:全在本门;必出的拖拉机 / 对子穷举(超 48 抽样),其余自由张按贪心族取 */
    const need=st.leadNeed, mustP=need<pairsS?need:pairsS;
    let R=0; if(st.leadKind===2){ const m=maxTractor(h,b,s,T), L=st.leadLen; R=m>=L?L:(m>=2?m:0); }
    const pairT=[]; // 本门所有对子牌种,按序号
    for(let i=0;i<sn;i++){ const t=sl[i]; if(h[b+t]===2) pairT.push(t); }
    let Ms=[new Uint8Array(54)];
    if(R>=2){
      const byOrd=[]; for(let o=0;o<16;o++) byOrd.push([]);
      for(const t of pairT) byOrd[ord[t]].push(t);
      const out=[];
      const dfs=(o,left,cur)=>{
        if(left===0){ out.push(cur.slice()); return; }
        if(o>=16||!byOrd[o].length) return;
        for(const t of byOrd[o]){ cur.push(t); dfs(o+1,left-1,cur); cur.pop(); }
      };
      for(let o0=0;o0+R<=16;o0++) dfs(o0,R,[]);
      let sel=out; if(sel.length>40) sel=shuf(out.slice()).slice(0,40);
      Ms=sel.map(ts=>{ const m=new Uint8Array(54); for(const t of ts) m[t]=2; return m; });
    }
    const extra=mustP-(R>=2?R:0);
    if(extra>0){
      const Ms2=[];
      for(const m0 of Ms){
        const avail=pairT.filter(t=>m0[t]===0);
        if(avail.length<extra) continue;
        const combos=[];
        const dfs=(i,left,cur)=>{ if(combos.length>=400) return; if(left===0){ combos.push(cur.slice()); return; }
          for(let j=i;j<=avail.length-left;j++){ cur.push(avail[j]); dfs(j+1,left-1,cur); cur.pop(); } };
        dfs(0,extra,[]);
        let pickc=combos;
        if(combos.length>12){ pickc=[combos[0],combos[combos.length-1]].concat(shuf(combos.slice(1,-1)).slice(0,10)); }
        for(const cb of pickc){ const m=m0.slice(); for(const t of cb) m[t]=2; Ms2.push(m); }
      }
      Ms=Ms2;
    }
    if(Ms.length>60) Ms=Ms.slice(0,2).concat(shuf(Ms.slice(2)).slice(0,58));
    const f=n-2*mustP;
    let first=true;
    for(const M of Ms){
      const P=new Uint8Array(54); for(let t=0;t<54;t++) P[t]=eff[t]===s?h[b+t]-M[t]:0;
      fills(M,P,f,first||Ms.length<=6); first=false;
      if(OC>=target) break;
    }
  }
  /* 随机补足 */
  for(let tries=0; OC<target && tries<4*target; tries++){
    sampleFollow(st,rng,RTB2,0);
    C.fill(0); for(let i=0;i<n;i++) C[RTB2[1+i]]++;
    add(C);
  }
  if(OC===0){ sampleFollow(st,rng,RTB2,0); POS[OC++]=OP; for(let i=0;i<=n;i++) OB[OP++]=RTB2[i]; }
  return OC;
}

/* ================= 无状态辅助(给向量 / 对拍用) ================= */
function typesToCnt(arr,cnt){ for(let i=0;i<arr.length;i++) cnt[arr[i]]++; }
function effSuitT(t,ts,tr){ return tbl(ts,tr).eff[t]; }
function ordIdxT(t,ts,tr){ return tbl(ts,tr).ord[t]; }
/* 把牌种数组分解成 [{kind,len,top,cards:[...]}] ;要求同一有效花色 */
function decomposeT(types,ts,tr,s){
  const T=tbl(ts,tr); const cnt=new Uint8Array(54); typesToCnt(types,cnt);
  if(s===undefined) s=T.eff[types[0]];
  decomp(cnt,0,s,T,DEC);
  const out=[];
  for(let i=0;i<DEC.nc;i++) out.push({kind:DEC.kind[i],len:DEC.len[i],top:DEC.top[i],
    cards:Array.from(DEC.cards.subarray(DEC.off[i],DEC.off[i]+DEC.cn[i]))});
  return out;
}
/* classify:null=空或混门;否则 {kind:0单1对2拖拉机3甩,len,suit,top,comps} */
function classifyT(types,ts,tr){
  if(!types.length) return null;
  const T=tbl(ts,tr), s=T.eff[types[0]];
  for(let i=0;i<types.length;i++) if(T.eff[types[i]]!==s) return null;
  const comps=decomposeT(types,ts,tr,s);
  if(types.length===1) return {kind:0,len:undefined,suit:s,top:T.ord[types[0]],comps};
  if(comps.length===1){ const c=comps[0]; return {kind:c.kind,len:c.kind===2?c.len:undefined,suit:s,top:c.top,comps}; }
  let top=0; for(const c of comps) if(c.top>top) top=c.top;
  return {kind:3,len:undefined,suit:s,top,comps};
}
const SX=newState();
function loadHands(handsT,ts,tr){
  setTrump(SX,ts,tr); SX.hand.fill(0);
  for(let p=0;p<handsT.length;p++){ const h=handsT[p]; SX.hn[p]=h.length; for(const t of h){ SX.hand[p*54+t]++; if(SX.hand[p*54+t]>2) throw new Error('count>2'); } }
  return SX;
}
const UB=new Uint8Array(64);
function packBuf(types){ UB[0]=types.length; for(let i=0;i<types.length;i++) UB[1+i]=types[i]; return 0; }
function isLegalFollowT(handT,leadT,chosenT,ts,tr){
  const st=loadHands([handT],ts,tr);
  const lb=new Uint8Array(64); lb[0]=leadT.length; leadT.forEach((t,i)=>lb[1+i]=t);
  describeLead(st,lb,1,leadT.length);
  packBuf(chosenT); return isLegalFollow(st,0,UB,0);
}
function structMatchesT(candT,leadT,ts,tr){
  if(candT.length!==leadT.length) return false;
  const T=tbl(ts,tr); const nr=runsOf(Uint8Array.from(leadT),0,leadT.length,T,CRN2);
  const need=Array.from(CRN2.subarray(0,nr));
  const cn=runsOf(Uint8Array.from(candT),0,candT.length,T,CR);
  for(let k=0;k<cn;k++) CAPA[k]=CR[k];
  CRN=need; return fitR(0,nr,cn);
}
const CRN2=new Uint8Array(16);
/* plays:[{seat,types}] 按出牌顺序;返回 {winner,points} */
function resolveTrickT(plays,ts,tr){
  const st=loadHands([[],[],[],[]],ts,tr);
  st.declarer=0; st.defPts=0; st.nPlays=0;
  const lb=Uint8Array.from(plays[0].types);
  describeLead(st,lb,0,lb.length);
  for(let i=0;i<4;i++){ st.trickSeat[i]=plays[i].seat; st.trickLen[i]=plays[i].types.length;
    for(let k=0;k<plays[i].types.length;k++) st.trickBuf[i*32+k]=plays[i].types[k]; }
  // resolveTrick 里点数求和只加领出和长度匹配的候选;这里单独算全部 4 手
  const w=resolveTrick(st);
  let pts=0; for(const p of plays) for(const t of p.types) pts+=PTS[t];
  return {winner:w,points:pts};
}
function checkThrowT(handsT,seat,cardsT,ts,tr){
  const T=tbl(ts,tr), cl=classifyT(cardsT,ts,tr);
  if(!cl||cl.kind!==3) return {ok:true};
  const st=loadHands(handsT,ts,tr);
  for(let p=0;p<4;p++) if(p!==seat) summ(st,p,cl.suit);
  const cnt=new Uint8Array(54); typesToCnt(cardsT,cnt);
  decomp(cnt,0,cl.suit,T,DEC);
  const f=forcedComp(DEC,seat);
  if(f<0) return {ok:true};
  return {ok:false,forced:Array.from(DEC.cards.subarray(DEC.off[f],DEC.off[f]+DEC.cn[f]))};
}
function countPairsInT(types){
  const cnt=new Uint8Array(54); typesToCnt(types,cnt); let n=0; for(let t=0;t<54;t++) if(cnt[t]===2) n++; return n;
}
function maxTractorLenT(types,ts,tr){
  const T=tbl(ts,tr); const cnt=new Uint8Array(54); typesToCnt(types,cnt);
  // 引擎对给定牌整体 decompose(不分花色);这里按有效花色分别取最大
  let best=0; for(let s=0;s<5;s++){ const m=maxTractor(cnt,0,s,T); if(m>best) best=m; } return best;
}
function scoreRoundT(defPoints,kittyPts,defWonLast,lastLeadSize){
  const mult=2*(lastLeadSize||1);
  const total=defPoints+(defWonLast?kittyPts*mult:0);
  if(total<80) return {defendersWin:false,total,kittyPts,mult,declarerLevelsUp:total===0?3:total<40?2:1};
  return {defendersWin:true,total,kittyPts,mult,defenderLevelsUp:Math.floor((total-80)/40)};
}

return {tbl,newState,setTrump,copy,reset,dealRandom,makeRng,
  decomp,maxTractor,runsOf,describeLead,
  playLead,playFollow,isLegalFollow,resolveTrick,done,score,
  enumLeads,enumFollows,enumFollowsReduced,sampleFollow,viewInfo,peekWinner,pos:POS,PTS,
  util:{effSuitT,ordIdxT,decomposeT,classifyT,isLegalFollowT,structMatchesT,resolveTrickT,checkThrowT,
        countPairsInT,maxTractorLenT,scoreRoundT,loadHands}};
});
