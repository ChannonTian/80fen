/* 联赛的一个工人:跑一对选手之间的全部对局,把结果回报给主进程。
 * 由 contest/league.js fork 出来,不单独用。
 *
 * 每个工人是独立进程,所以两位选手的屋子、裁判的引擎,在这个进程里各自新建一份 ——
 * 跨进程天然隔离,一个工人崩了不影响别的对。
 */
'use strict';
const {load, createRealm, guestRealm}=require('./engine.js');
const {playMatch}=require('./referee.js');

/* 自家安插的选手用**显式白名单** —— 只有这两个包装了我们的 AI,需要 house 屋子。
 * 早先按 `contest/` 前缀判,那会把 contest/public/example/(发给参赛者的模板)
 * 也判成自家、塞给它我们的引擎 —— 模板在我们这儿能跑、发出去就跑不了。
 * 除白名单外**一律空屋**,包括我们自己放在 contest/ 下的测试夹具。 */
const HOUSE=new Set(['contest/ai-baseline.js','contest/ai-norebel.js']);
const norm=p=>String(p).replace(/\\/g,'/').replace(/^\.\//,'');
const isHouse=p=>HOUSE.has(norm(p));

function mount(file, tag, build, eg){
  if(isHouse(file)){
    const r=createRealm(build, tag);
    if(!eg) r.AI.AIP.egSearch=0;
    return r.mount(file);
  }
  return guestRealm(tag).mount(file);
}

process.on('message', job=>{
  const {a, b, seeds, seed0, build, eg, gates, fullRebel, keepHands}=job;
  let A, B, REF, FB;
  try{
    REF=load(build);
    FB={engine:REF.E,
        fallbackDiscard:(h,t)=>REF.AI.aiDiscard(h,t),
        fallbackLead:(h,t,rd)=>REF.AI.aiLead(h,t,rd)};
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
           log:[], crashed:0};
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
      // 每局一行摘要 —— 排名和申诉都够用;完整手牌记录要加 --log-hands
      if(keepHands) R.log.push({seed:s, aTeam, rounds:r.history});
    }
    if(dL.length===2){ R.pairL.push((dL[0]+dL[1])/2);
                       R.pairP.push((dP[0]+dP[1])/2);
                       R.pairW.push((dW[0]+dW[1])/2); }
  }
  process.send(R);
});
