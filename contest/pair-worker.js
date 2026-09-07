/* 联赛的一个工人:跑一对选手之间的全部对局,把结果回报给主进程。
 * 由 contest/league.js fork 出来,不单独用。
 *
 * 每个工人是独立进程,所以两位选手的屋子、裁判的引擎,在这个进程里各自新建一份 ——
 * 跨进程天然隔离,一个工人崩了不影响别的对。
 */
'use strict';
const {load}=require('./engine.js');
const {mount}=require('./mount.js');
const {playMatch}=require('./referee.js');

// 逐墩记录的文件名。选手 id 里可能有 / 之类的东西,统一换掉。
const playsName=(a,b)=>`${a}__${b}`.replace(/[^\w\u4e00-\u9fa5.-]+/g,'_')+'.ndjson.gz';

process.on('message', job=>{
  const {a, b, seeds, seed0, build, eg, gates, fullRebel, keepHands, keepPlays}=job;
  let A, B, REF, FB;
  try{
    REF=load(build);
    FB={engine:REF.E,
        fallbackDiscard:(h,t)=>REF.AI.aiDiscard(h,t),
        fallbackLead:(h,t,rd)=>REF.AI.aiLead(h,t,rd),
        logPlays:!!keepPlays};
    // 只在真的传了值时覆盖 —— playMatch 用 Object.assign 合默认值,
    // 塞个 undefined 进去会把默认的 gates/fullRebel 冲掉。
    if(gates) FB.gates=gates;
    if(fullRebel) FB.fullRebel=fullRebel;
    A=mount(a.path, 'A:'+a.id, build, eg);
    B=mount(b.path, 'B:'+b.id, build, eg);
  }catch(e){
    process.send({err:`加载失败: ${e.message}`, a:a.id, b:b.id});
    return;
  }

  const R={a:a.id, b:b.id, winA:0, winB:0, draw:0, rounds:0,
           pairL:[], pairP:[], pairW:[],
           vio:{a:{count:0,pts:0,applied:0,by:{},ms:0}, b:{count:0,pts:0,applied:0,by:{},ms:0}},
           log:[], plays:[], crashed:0};
  const acc=(dst,v)=>{ dst.count+=v.count; dst.pts+=v.pts; dst.applied+=v.applied; dst.ms+=v.ms;
    const s=v.summary(); for(const k in s) dst.by[k]=(dst.by[k]||0)+s[k]; };

  for(let s=seed0+1; s<=seed0+seeds; s++){
    const dL=[], dP=[], dW=[];
    for(const aTeam of [0,1]){
      let r;
      try{ r=playMatch(s, seat=>seat%2===aTeam?A:B, FB); }
      catch(e){ R.crashed++; continue; }
      R.rounds+=r.rounds;
      if(r.winnerTeam===aTeam){ R.winA++; dW.push(1); }
      else if(r.winnerTeam===null){ R.draw++; dW.push(0.5); }
      else { R.winB++; dW.push(0); }
      dL.push(r.levels[aTeam]-r.levels[1-aTeam]);
      let sum=0;
      for(const h of r.history){
        const aPts=(h.declTeam===aTeam)?200-h.total:h.total;
        sum+=aPts-(200-aPts);
      }
      dP.push(r.history.length?sum/r.history.length:0);
      acc(R.vio.a, r.vio[aTeam]); acc(R.vio.b, r.vio[1-aTeam]);
      /* 每局一行摘要 —— 排名和申诉都够用;逐墩记录量太大,不记。
       * aTeam 是 A 这次坐哪一队(0 或 1),同一个 seed 的两场就是阵营对调的那一对。 */
      if(keepHands) R.log.push({seed:s, aTeam,
        winner: r.winnerTeam===null ? null : (r.winnerTeam===aTeam?'a':'b'),
        levels: [r.levels[aTeam], r.levels[1-aTeam]],
        rounds: r.history});
      /* 逐墩记录走**另一条**通道:量是逐局记录的十几倍,而排名、赛报、复盘
       * 一个字节都用不上它 —— 混进 R.log 会把它们全部拖慢。 */
      if(keepPlays) R.plays.push({seed:s, aTeam,
        winner: r.winnerTeam===null ? null : (r.winnerTeam===aTeam?'a':'b'),
        levels: [r.levels[aTeam], r.levels[1-aTeam]],
        rounds: r.plays});
    }
    if(dL.length===2){ R.pairL.push((dL[0]+dL[1])/2);
                       R.pairP.push((dP[0]+dP[1])/2);
                       R.pairW.push((dW[0]+dW[1])/2); }
  }
  if(keepPlays && R.plays.length){
    const fs=require('fs'), zlib=require('zlib'), path=require('path');
    /* 工人自己落盘,不走 IPC —— 一对的逐墩记录 3 MB 上下,序列化再反序列化
     * 一遍纯属白花。先写 .part 再 rename:rename 在同一个文件系统上是原子的,
     * 进程半路被杀只会留下一个 .part,不会留下一个「看着完整、其实少一半」的
     * 记录文件骗过续跑。 */
    const txt=R.plays.map(m=>JSON.stringify({a:a.id, b:b.id, seed:m.seed, aTeam:m.aTeam,
      winner:m.winner, levels:m.levels, rounds:m.rounds})).join('\n')+'\n';
    const dst=path.join(keepPlays, playsName(a.id,b.id)), tmp=dst+'.part';
    fs.writeFileSync(tmp, zlib.gzipSync(Buffer.from(txt,'utf8'), {level:9}));
    fs.renameSync(tmp, dst);
    R.playsFile=path.basename(dst);
  }
  R.plays=undefined;
  process.send(R);
});

module.exports={playsName};
