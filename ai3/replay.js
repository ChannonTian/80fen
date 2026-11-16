/* ai3/replay.js —— 用内核回放一局牌谱(gen-records.js 的一行),逐手核对。
 *   const r=replayGame(rec, onDecision?)  → {ok, why}
 * onDecision(st, playIdx, play, isLead) 在每手出牌「之前」调用(st 是真实全局状态,调用方只许读自己该看的那部分)。
 * 核对项:轮到的座位;领出被强制时内核强制出的牌与引擎一致;跟牌合法;每墩赢家(= 下一墩领出者);末局:闲家分 / 末墩 / 张数 / 总分 / 胜负 / 升级数。 */
'use strict';
const K=require('./kernel.js');
const BUF=new Uint8Array(64), ST=K.newState();
const same=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
function replayGame(rec,onDecision){
  const st=ST; K.reset(st,rec.h,rec.k,rec.ts,rec.lv,rec.dc);
  const P=rec.p;
  for(let i=0;i<P.length;i++){
    const [seat,want,act]=P[i];
    if(st.cur!==seat) return {ok:false,why:`座位 第${i}手 内核${st.cur} 牌谱${seat}`};
    const isLead=st.nPlays===0;
    if(onDecision) onDecision(st,i,P[i],isLead);
    if(isLead){
      BUF[0]=want.length; for(let k=0;k<want.length;k++) BUF[1+k]=want[k];
      const lp=st.logLen;
      const r=K.playLead(st,BUF,0);
      if(r<0) return {ok:false,why:`领出非法 第${i}手`};
      if(r===1){
        const n=st.log[lp+1], got=Array.from(st.log.subarray(lp+2,lp+2+n)).sort((x,y)=>x-y);
        if(!act) return {ok:false,why:`强制不符(引擎未强制) 第${i}手`,kind:'forced'};
        if(!same(got,act)) return {ok:false,why:`强制出的牌不同 第${i}手`,kind:'forced'};
      } else if(act) return {ok:false,why:`强制不符(内核未强制) 第${i}手`,kind:'forced'};
    } else {
      const a=act||want;
      BUF[0]=a.length; for(let k=0;k<a.length;k++) BUF[1+k]=a[k];
      if(!K.isLegalFollow(st,seat,BUF,0)) return {ok:false,why:`跟牌不合法 第${i}手`,kind:'illegal'};
      K.playFollow(st,BUF,0);
    }
  }
  if(!K.done(st)) return {ok:false,why:'没打完'};
  const sc=K.score(st);
  if(st.defPts!==rec.dp) return {ok:false,why:`闲家墩分 ${st.defPts}≠${rec.dp}`};
  if(((st.lastWinner^st.declarer)&1)!==rec.wl) return {ok:false,why:'末墩赢家'};
  if(st.lastLeadSize!==rec.ll) return {ok:false,why:'末墩张数'};
  if(sc.total!==rec.tot) return {ok:false,why:`总分 ${sc.total}≠${rec.tot}`};
  if((sc.defendersWin?1:0)!==rec.win) return {ok:false,why:'胜负'};
  if(sc.ups!==(rec.win?rec.du:rec.cu)) return {ok:false,why:`升级数 ${sc.ups}≠${rec.win?rec.du:rec.cu}`};
  return {ok:true};
}
const fs=require('fs'),zlib=require('zlib'),path=require('path');
function* readRecs(dir){
  for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.jsonl.gz')).sort()){
    const txt=zlib.gunzipSync(fs.readFileSync(path.join(dir,f))).toString('utf8');
    for(const ln of txt.split('\n')) if(ln) yield JSON.parse(ln);
  }
}
module.exports={replayGame,readRecs};
