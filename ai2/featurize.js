/* ai2/featurize.js —— 特征的唯一出处(数据导出和推理都用它;Node / 浏览器通用,无依赖)。
 *
 * 两层:
 *   rawFromState(sv,out)      局面 → 128 字节「原始记录」(gen-data 落盘的就是它;不含任何信息遮蔽,这是全明牌 oracle 网络)
 *   featuresFromRaw(raw,...)  原始记录 → 稀疏二值特征下标 + 稠密标量
 *
 * 规范化:
 *   · 座位相对庄家:相对座 0=庄家 1=庄家下家 2=庄家对家 3=庄家上家
 *   · 花色相对主:有主时主花色=相对花色 0,其余三门按 S,H,D,C 循环顺序排成 1..3;无主时相对花色=原花色
 *   · 牌型 71 种:先「主块」19 种 = 主花色 13 个点位 + 副花色级牌 4 种(按相对花色) + 大小王 2 种,
 *     再「副块」52 种 = 4 个相对花色 × 13 个点位(级牌点位恒空,级牌在主块里)
 *   · 每个牌型的张数 0/1/2 → 两张二值平面(≥1,==2),点数身份(5/10/K)靠牌型本身保留
 *   · 10 个组:相对座 0..3 的手牌、底牌、已出牌(前面各墩)、本墩相对座 0..3 已出的牌;每组 71×2=142 个二值特征
 *
 * 原始记录布局(Uint8Array(128)):
 *   [0..107]  108 张牌的位置,按牌型(54 种:花色 S,H,D,C 各 13 个点位 2..A,再小王、大王)各占 2 格,格内升序(张数交换对称)
 *             位置码:0..3=座位手牌 4=底牌 5=已出(前面各墩) 6..9=本墩该座位已出
 *   [108] 本墩领出座  [109] 下一个出牌座  [110] 本墩暂大座(255=本墩还没人出)  [111] 庄家座
 *   [112] 主花色(0..3 = S,H,D,C;4=无主)  [113] 级牌点数  [114] 闲家已得分/5  [115] 本墩已出几家
 *   [116] 标签 = 终局闲家总分/5(含抠底倍数)  [117] fork 号(0=在线对局)  [118] 已出手数  [119] 标志(bit0=这是偏离那一手)
 *   [120..123] 种子 uint32 小端
 */
'use strict';
const SUITS=['S','H','D','C'];
const NT=71, NG=10, NBIN_FEAT=NG*NT*2;   // 1420
const ND=50;                              // 稠密标量个数
const DIM=NBIN_FEAT+ND;
const NBINS=41;                           // 终局闲家总分 /5,≥200 并入最后一箱
const REC=128;

const typeIdx=c=>c.suit==='X'?52+(c.rank-15):SUITS.indexOf(c.suit)*13+(c.rank-2);
const typePts=t=>{ if(t>=52) return 0; const r=t%13+2; return r===5?5:(r===10||r===13)?10:0; };

/* ---- 局面(sim.stateView)→ 原始记录 ---- */
function rawFromState(sv, out){
  const raw=out||new Uint8Array(REC);
  const cnt=new Uint8Array(54*10);        // [type*10+loc]
  const add=(c,loc)=>{ cnt[typeIdx(c)*10+loc]++; };
  for(let s=0;s<4;s++) for(const c of sv.hands[s]) add(c,s);
  for(const c of sv.kitty) add(c,4);
  for(const p of sv.plays) for(const c of p.cards) add(c,6+p.seat);
  for(let t=0;t<54;t++){
    let tot=0; for(let l=0;l<10;l++) if(l!==5) tot+=cnt[t*10+l];
    if(tot>2) throw new Error('牌型 '+t+' 超过 2 张');
    cnt[t*10+5]=2-tot;
  }
  let k=0;
  for(let t=0;t<54;t++){
    const a=[];
    for(let l=0;l<10;l++) for(let i=0;i<cnt[t*10+l];i++) a.push(l);
    raw[k++]=a[0]; raw[k++]=a[1];
  }
  const np=sv.plays.length;
  raw[108]=np?sv.plays[0].seat:sv.leader;
  raw[109]=np?(sv.plays[0].seat+np)%4:sv.leader;
  raw[110]=np?sv.curWinner:255;
  raw[111]=sv.declSeat;
  raw[112]=sv.trump.suit?SUITS.indexOf(sv.trump.suit):4;
  raw[113]=sv.trump.rank;
  raw[114]=sv.defPoints/5;
  raw[115]=np;
  return raw;
}

/* ---- 牌型规范化表 canon[tsi][L][t] = 0..70 ---- */
const _canon={};
function canonTable(tsi,L,perm){
  const key=tsi+'|'+L+'|'+(perm?perm.join(''):'');
  if(_canon[key]) return _canon[key];
  const tab=new Uint8Array(54);
  for(let t=0;t<54;t++){
    if(t>=52){ tab[t]=17+(t-52); continue; }
    const s=(t/13)|0, r=t%13+2;
    const trumpSuit=tsi<4&&s===tsi;
    let k=tsi<4?(s-tsi+4)%4:s;
    if(perm&&!trumpSuit) k=perm[k];
    if(trumpSuit) tab[t]=r-2;
    else if(r===L) tab[t]=13+k;
    else tab[t]=19+k*13+(r-2);
  }
  return (_canon[key]=tab);
}

/* ---- 原始记录 → 特征。idx:Int32Array(≥300) 写入激活的二值特征下标;dense:Float32Array(ND)。返回激活个数 ---- */
function featuresFromRaw(raw, idx, dense, perm){
  const decl=raw[111], tsi=raw[112], L=raw[113];
  const tab=canonTable(tsi,L,perm);
  const gcnt=new Uint8Array(NG*NT);
  const hsz=[0,0,0,0];
  let ptsDef=0, ptsDecl=0, ptsKit=0, ptsTrick=0;
  const lead=raw[108], np=raw[115];
  let leadClass=0;                         // 0 无;1 主;2+k 副花色 k
  for(let t=0;t<54;t++){
    const ct=tab[t], pt=typePts(t);
    for(let j=0;j<2;j++){
      const loc=raw[t*2+j];
      let g;
      if(loc<4){ const rs=(loc-decl+4)%4; g=rs; hsz[rs]++; if(loc%2===decl%2) ptsDecl+=pt; else ptsDef+=pt; }
      else if(loc===4){ g=4; ptsKit+=pt; }
      else if(loc===5){ g=5; }
      else { const s=loc-6; g=6+(s-decl+4)%4; ptsTrick+=pt;
        if(s===lead&&leadClass===0) leadClass=ct<19?1:2+((ct-19)/13|0); }
      gcnt[g*NT+ct]++;
    }
  }
  let n=0;
  for(let g=0;g<NG;g++) for(let c=0;c<NT;c++){
    const v=gcnt[g*NT+c]; if(!v) continue;
    const b=(g*NT+c)*2; idx[n++]=b; if(v>1) idx[n++]=b+1;
  }
  dense.fill(0);
  const rel=s=>(s-decl+4)%4;
  const defPts=raw[114]*5;
  dense[0]=defPts/100; dense[1]=ptsDef/100; dense[2]=ptsDecl/100; dense[3]=ptsKit/40; dense[4]=ptsTrick/40;
  dense[5]=(ptsDef+ptsDecl+ptsKit)/200;
  dense[6]=(hsz[0]+hsz[1]+hsz[2]+hsz[3])/100;
  for(let i=0;i<4;i++) dense[7+i]=hsz[i]/25;
  dense[11]=tsi===4?1:0;
  dense[12+rel(raw[109])]=1;
  dense[16+rel(lead)]=1;
  if(raw[110]===255) dense[24]=1; else { dense[20+rel(raw[110])]=1; dense[48]=raw[110]%2!==decl%2?1:0; }
  dense[25+leadClass]=1;                    // 25..30
  dense[31+np]=1;                           // 31..34
  dense[35+(L-2)]=1;                        // 35..47
  dense[49]=(80-defPts)/100;                // 离上台线还差多少
  return n;
}

const labelOf=total=>Math.min(NBINS-1,Math.round(total/5));

const API={SUITS,NT,NG,NBIN_FEAT,ND,DIM,NBINS,REC,typeIdx,typePts,rawFromState,featuresFromRaw,canonTable,labelOf};
if(typeof module!=='undefined'&&module.exports) module.exports=API; else { const r=typeof window!=='undefined'?window:globalThis; r.AI2=r.AI2||{}; r.AI2.featurize=API; }
