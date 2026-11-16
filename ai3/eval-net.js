/* ai3/eval-net.js —— 自检 3(网络 vs 随机策略)与速度。
 *   node ai3/eval-net.js --net=ai3/out/net-v1 --games=2000 [--speed=300]
 * 自检 3:内核里网络坐 0、2 号座位(对家),1、3 随机策略;随机主 / 级 / 庄;网络方必须大胜。
 * 速度:四家都是网络,单核 局/秒、手/秒(含特征与前向)。 */
'use strict';
const K=require('./kernel.js'), Net=require('./net.js'), NetPolicy=require('./policy.js');
const arg=(k,d)=>{ const a=process.argv.find(x=>x.startsWith('--'+k+'=')); return a?a.slice(k.length+3):d; };
const net=Net.load(arg('net','ai3/out/net-v1')), G=+arg('games',2000), SG=+arg('speed',300);
const rng=K.makeRng(4242), st=K.newState(), P=new NetPolicy(net,K.makeRng(7)), RB=new Uint8Array(1<<16), B2=new Uint8Array(64);
function randomPlay(st){
  if(st.nPlays===0){ const n=K.enumLeads(st,RB,0); K.playLead(st,RB,K.pos[(rng()*n)|0]); }
  else { K.sampleFollow(st,rng,B2,0); K.playFollow(st,B2,0); }
}
function netPlay(st){ const i=P.choose(st); if(st.nPlays===0) K.playLead(st,P.buf,K.pos[i]); else K.playFollow(st,P.buf,K.pos[i]); }
// ---- 自检 3 ----
let netPts=0, wins=0, nDef=0, defPtsAsDef=0, winDef=0, nDecl=0, defPtsAsDecl=0, winDecl=0, netUps=0, oppUps=0;
for(let g=0;g<G;g++){
  K.dealRandom(st,rng);
  const netTeam=(g&1);                       // 交替:网络方坐 0/2(队 0)或 1/3(队 1)—— 但座位决定谁是庄,所以两种都测
  while(!K.done(st)){ ((st.cur&1)===netTeam?netPlay:randomPlay)(st); }
  const r=K.score(st), declTeam=st.declarer&1, netIsDecl=declTeam===netTeam;
  const net_=netIsDecl?200-r.total:r.total;                 // 网络方本局拿到的分
  netPts+=net_; if(netIsDecl?r.declarerWins:r.defendersWin) wins++;
  if(netIsDecl){ nDecl++; defPtsAsDecl+=r.total; if(r.declarerWins) winDecl++; if(r.declarerWins) netUps+=r.ups; else oppUps+=1+r.ups; }
  else { nDef++; defPtsAsDef+=r.total; if(r.defendersWin) winDef++; if(r.defendersWin) netUps+=1+r.ups; else oppUps+=r.ups; }
}
console.log(`自检 3(网络 2 家 vs 随机 2 家,${G} 局):网络方平均得分 ${(netPts/G).toFixed(1)}/200,胜率 ${(100*wins/G).toFixed(1)}%`);
console.log(`  网络坐闲 ${nDef} 局:平均闲家分 ${(defPtsAsDef/nDef).toFixed(1)},闲家胜 ${(100*winDef/nDef).toFixed(1)}%;`
 +`网络坐庄 ${nDecl} 局:平均闲家分(对手)${(defPtsAsDecl/nDecl).toFixed(1)},庄家胜 ${(100*winDecl/nDecl).toFixed(1)}%;净升级 网络 ${(netUps/G).toFixed(2)} 对手 ${(oppUps/G).toFixed(2)} /局`);
// ---- 速度 ----
let plays=0; const t0=process.hrtime.bigint();
for(let g=0;g<SG;g++){ K.dealRandom(st,rng); while(!K.done(st)){ netPlay(st); plays++; } K.score(st); }
const sec=Number(process.hrtime.bigint()-t0)/1e9;
console.log(`速度(四家都是网络,单核):${(SG/sec).toFixed(2)} 局/秒  ${(plays/sec).toFixed(0)} 手/秒  (${(plays/SG).toFixed(1)} 手/局,${(1000*sec/plays).toFixed(2)} ms/手)  降级/超cap ${(100*P.stat.over/(P.stat.lead+P.stat.follow)).toFixed(2)}%`);
