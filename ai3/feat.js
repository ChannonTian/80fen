/* ai3/feat.js —— 演员(只看自己视角)/ 全知(评论家)/ 候选 特征。训练(featurize.js)和推理(net.js、h2h)共用这一份。
 * 全部写进 Uint8Array 行;标量量化成 round(x*250),每维的反量化系数在 SSCALE / CSCALE 里(网络输入 = 行 × 系数)。
 *
 * 规范化:
 *   · 座位相对自己:0 我、1 下家、2 对家、3 上家;
 *   · 花色置换:有主时主花色排第一,其余按 S,H,D,C;无主不置换。牌槽 54 = 4 门 × 12(非级牌序号,序号升序)
 *     + 4 个级牌槽(按规范花色,48..51)+ 小王 52 + 大王 53。
 * 演员特征只用:自己的手牌、出牌日志(含本墩)、自己是庄时的底。全知特征另存,和演员特征同下标。 */
'use strict';
const K=require('./kernel.js');

/* ---- 槽表 ---- */
const SLOTS=new Map();
function slotTab(ts,level){
  const key=ts*16+level; let t=SLOTS.get(key);
  if(t) return t;
  const order=ts<4?[ts,...[0,1,2,3].filter(s=>s!==ts)]:[0,1,2,3];
  const cs=[0,0,0,0]; for(let i=0;i<4;i++) cs[order[i]]=i;
  const slot=new Uint8Array(54), pts=new Uint8Array(54);
  for(let t0=0;t0<52;t0++){
    const s=(t0/13)|0, r=t0%13+2;
    slot[t0]= r===level ? 48+cs[s] : cs[s]*12+(r-2-(r>level?1:0));
  }
  slot[52]=52; slot[53]=53;
  for(let t0=0;t0<52;t0++){ const r=t0%13+2; pts[slot[t0]]= r===5?5:(r===10||r===13)?10:0; }
  t={slot,pts,cs}; SLOTS.set(key,t); return t;
}

/* ---- 布局 ---- */
const O_HAND=0, O_PLAYED=54, O_TRICK=270, O_UNSEEN=432, O_KITTY=486, O_VOID=540, O_PTS=560, O_SC=614;
const NSC=42, SD=O_SC+NSC;                       // 656
const OD=216;                                    // 全知:3×54 手牌 + 54 底
const CD=66;                                     // 候选
const SSCALE=new Float32Array(SD), CSCALE=new Float32Array(CD);
for(let i=0;i<SD;i++) SSCALE[i]=1;
for(let i=O_PTS;i<O_PTS+54;i++) SSCALE[i]=0.1;
for(let i=O_SC;i<SD;i++) SSCALE[i]=1/250;
for(let i=0;i<CD;i++) CSCALE[i]=1;
CSCALE[59]=1/250; CSCALE[60]=1/250; CSCALE[62]=1/240;
const q=x=>{ x=Math.round(x*250); return x<0?0:x>250?250:x; };

const VU=new Uint8Array(54), VV=new Uint8Array(20);
const DUMMY0=new Uint8Array(2);                  // 长度 0 的假候选:peekWinner 用它取「当前谁大」
const LOGP=new Int32Array(128);

/* 演员特征。st:内核状态(只读 seat 的手牌 / 日志 / 庄家的底),seat = 要出牌的座位。out 从 off 起写 SD 字节(先清零)。 */
function stateFeat(st,seat,out,off){
  out.fill(0,off,off+SD);
  const ts=st.ts, level=st.tr, T=st.tbl, eff=T.eff, pts=T.pts;
  const tab=slotTab(ts,level), slot=tab.slot, cs=tab.cs;
  const h=st.hand, b=seat*54;
  for(let t=0;t<54;t++){ const c=h[b+t]; if(c) out[off+O_HAND+slot[t]]=c; }
  K.viewInfo(st,seat,VU,VV);
  let unseenPts=0;
  for(let t=0;t<54;t++){ const c=VU[t]; if(c>0){ out[off+O_UNSEEN+slot[t]]=c; unseenPts+=c*pts[t]; } }
  if(seat===st.declarer) for(let t=0;t<54;t++){ const c=st.kitty[t]; if(c) out[off+O_KITTY+slot[t]]=c; }
  // 断门(规范花色;主 = 4)
  for(let p=0;p<4;p++){ const rp=(p-seat)&3;
    for(let s=0;s<5;s++) if(VV[p*5+s]) out[off+O_VOID+rp*5+(s===4?4:cs[s])]=1; }   // 此处 s 已是有效花色:非主 0..3 对应真实花色
  // 日志:已完成墩的出牌(按相对座位)与本墩出牌
  const lg=st.log, np=st.nPlays, total=st.tricks*4+np;
  let p=0, i=0;
  while(p<st.logLen){
    const sd=lg[p], n=lg[p+1], rp=(sd-seat)&3;
    if(i<total-np){ for(let k=0;k<n;k++) out[off+O_PLAYED+rp*54+slot[lg[p+2+k]]]++; }
    else if(rp>0){ for(let k=0;k<n;k++) out[off+O_TRICK+(rp-1)*54+slot[lg[p+2+k]]]++; }
    p+=2+n; i++;
  }
  for(let s=0;s<54;s++) out[off+O_PTS+s]=tab.pts[s];
  // 标量
  let o=off+O_SC;
  out[o++]=ts===4?250:0;                                   // 0 无主
  out[o+((st.declarer-seat)&3)]=250; o+=4;                 // 1..4 庄的相对位置
  out[o+np]=250; o+=4;                                     // 5..8 我是本墩第几个出
  out[o++]=np?q(Math.min(st.leadN,12)/12):0;               // 9 领出张数
  { const kd=np?st.leadKind:4; out[o+kd]=250; o+=5; }      // 10..14 领出牌型(单 对 拖 甩 无)
  { if(np){ const es=st.leadSuit; out[o+(es===4?4:cs[es])]=250; } o+=5; }   // 15..19 领出有效花色(规范)
  let tp=0; for(let k=0;k<np;k++) for(let q2=0;q2<st.trickLen[k];q2++) tp+=pts[st.trickBuf[k*32+q2]];
  out[o++]=q(Math.min(tp,100)/100);                        // 20 本墩桌面分
  if(np){ const w=K.peekWinner(st,DUMMY0,0); out[o+((w-seat)&3)]=250; } o+=4;   // 21..24 当前谁大
  out[o++]=q(st.defPts/200);                               // 25 闲家已得分
  out[o++]=q(unseenPts/200);                               // 26 没见过的分
  out[o++]=q(st.tricks/25);                                // 27 已打墩数
  out[o++]=q(st.hn[seat]/25);                              // 28 手牌张数
  out[o+level-2]=250; o+=13;                               // 29..41 级数 one-hot
}
/* 全知特征:另三家手牌(相对座位 1..3)+ 埋的底 */
function omniFeat(st,seat,out,off){
  out.fill(0,off,off+OD);
  const slot=slotTab(st.ts,st.tr).slot, h=st.hand;
  for(let r=1;r<4;r++){ const b=((seat+r)&3)*54;
    for(let t=0;t<54;t++){ const c=h[b+t]; if(c) out[off+(r-1)*54+slot[t]]=c; } }
  for(let t=0;t<54;t++){ const c=st.kitty[t]; if(c) out[off+162+slot[t]]=c; }
}

/* 候选特征(一个决策里所有候选共用 ctx)。ctx = decisionCtx(st,seat) */
function decisionCtx(st,seat){
  K.viewInfo(st,seat,VU,VV);
  const tab=slotTab(st.ts,st.tr);
  return {st,seat,tab,unseen:Uint8Array.from(VU),isLead:st.nPlays===0};
}
const TMPA=[];
function candFeat(ctx,buf,pos,out,off){
  out.fill(0,off,off+CD);
  const st=ctx.st, T=st.tbl, eff=T.eff, ord=T.ord, pts=T.pts, slot=ctx.tab.slot, n=buf[pos];
  TMPA.length=0; let pp=0, maxo=0, allT=true, same=true;
  const e0=eff[buf[pos+1]];
  for(let i=0;i<n;i++){ const t=buf[pos+1+i]; TMPA.push(t); out[off+slot[t]]++; pp+=pts[t]; if(ord[t]>maxo) maxo=ord[t];
    if(eff[t]!==4) allT=false; if(eff[t]!==e0) same=false; }
  let type=4;
  if(ctx.isLead){
    const cl=K.util.classifyT(TMPA,st.ts,st.tr); type=cl?cl.kind:4;
  } else if(same && (e0===st.leadSuit||e0===4)){
    const lead=[]; for(let i=0;i<st.leadN;i++) lead.push(st.trickBuf[i]);
    type=K.util.structMatchesT(TMPA,lead,st.ts,st.tr)?st.leadKind:4;
  }
  out[off+54+type]=1;
  out[off+59]=Math.min(n,25)*10;
  out[off+60]=Math.min(Math.round(pp*2.5),250);
  out[off+61]=allT?1:0;
  out[off+62]=maxo*16;
  if(ctx.isLead){
    out[off+63]=1;
    // 领出「必大」:没见过的牌里没有同花色更大的(单:任一张;对:成对的)
    if(same&&(type===0||type===1)){
      const t=TMPA[0], u=ctx.unseen; let m=1;
      for(let c=0;c<54;c++){ if(eff[c]===e0&&ord[c]>ord[t]&&u[c]>=(type===1?2:1)){ m=0; break; } }
      out[off+65]=m;
    }
  } else {
    out[off+63]=K.peekWinner(st,buf,pos)===ctx.seat?1:0;
    out[off+64]=(allT&&st.leadSuit!==4)?1:0;
  }
}

module.exports={SD,OD,CD,SSCALE,CSCALE,slotTab,stateFeat,omniFeat,decisionCtx,candFeat,
  O:{HAND:O_HAND,PLAYED:O_PLAYED,TRICK:O_TRICK,UNSEEN:O_UNSEEN,KITTY:O_KITTY,VOID:O_VOID,PTS:O_PTS,SC:O_SC}};
