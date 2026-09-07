/* 两份 build 的陪练在**打级赛制**下配对对战(v0.7.15)。
 *
 *   BUILD_A=80fen-test.html BUILD_B=index.html node contest/vs-builds.js [种子数=50] [起始种子=0]
 *   BUILD_A=80fen-test.html BUILD_B=../80fen-contest/submissions/kimi-k3/index.js node contest/vs-builds.js 60
 *
 * `test/ai-h2h.js` 是单副、由最强的一手坐庄、没有亮主阶段;打级里主色有一半是闲家定的,
 * 关卡、造反、连庄都在这里。这把尺子量的是那一半。A、B 各自装进自己的 house realm
 * (各自的 build);裁判用 REF(默认 index.html)的引擎判合法性。
 *   OVA / OVB   按 JSON 覆盖 A / B 的 AIP(B 是参赛提交时 OVB 不生效)
 *   OUT=f.json  把每个种子的配对读数(级数差 / 每局净分 / 胜负)写出来,供跨次比对
 * 输出除了三个口径,还有「坐庄方守住率 × 分级/非分级 × 谁亮的主」的切片 ——
 * v0.7.15 那条「分级守住率掉 7 个点是亮主阶段的事」就是它给出的。
 * 用时:两边都开收官搜索时约 30 s/种子(两场)。 */
'use strict';
const path=require('path');
const ROOT=path.join(__dirname,'..');
process.chdir(ROOT);
const {load,createRealm}=require('./engine.js');
const {playMatch}=require('./referee.js');
const N=+process.argv[2]||50, S0=+process.argv[3]||0;
const BA=process.env.BUILD_A||'80fen-test.html', BB=process.env.BUILD_B||'index.html';
const REF=load(process.env.REF||'index.html');
const {mount}=require('./mount.js');
function put(build,tag,ov){ if(build.endsWith('.js')) return mount(build,tag,BB,true);
  const r=createRealm(build,tag); if(ov) Object.assign(r.AI.AIP,JSON.parse(ov)); return r.mount('contest/ai-baseline.js'); }
const A=put(BA,'A',process.env.OVA), B=put(BB,'B',process.env.OVB);
let lastDecl=null; const declLog=[];
for(const [ai,tag] of [[A,'A'],[B,'B']]){ const od=ai.onDeal.bind(ai), dc=ai.discard.bind(ai);
  ai.onDeal=v=>{const r=od(v); if(r) lastDecl={by:tag,strength:r.strength}; return r;};
  ai.discard=v=>{declLog.push(lastDecl); lastDecl=null; return dc(v);}; }
const byDecl={};
const FB={engine:REF.E,fallbackDiscard:(h,t)=>REF.AI.aiDiscard(h,t),fallbackLead:(h,t,rd)=>REF.AI.aiLead(h,t,rd)};
let winA=0,winB=0,draw=0,rounds=0,msA=0,msB=0,games=0; const pairL=[],pairP=[],pairW=[]; const hold={A:[0,0],B:[0,0]}; const byRank={};
const t0=Date.now();
for(let s=S0+1;s<=S0+N;s++){
  const dL=[],dP=[],dW=[];
  for(const aTeam of [0,1]){
    const aiOf=seat=>seat%2===aTeam?A:B;
    let r; try{ r=playMatch(s,aiOf,FB); }catch(e){ console.error('crash',s,aTeam,e.message); continue; }
    rounds+=r.rounds; games++; msA+=r.vio[aTeam].ms; msB+=r.vio[1-aTeam].ms;
    if(r.winnerTeam===aTeam){winA++;dW.push(1);} else if(r.winnerTeam===null){draw++;dW.push(0.5);} else {winB++;dW.push(0);}
    const dl=r.levels[aTeam]-r.levels[1-aTeam]; dL.push(dl);
    let sum=0; for(const h of r.history){ const aPts=(h.declTeam===aTeam)?200-h.total:h.total; sum+=aPts-(200-aPts);
      const who=h.declTeam===aTeam?'A':'B'; hold[who][0]++; if(!h.defendersWin) hold[who][1]++;
      const pt=[5,10,13].includes(h.trumpRank)?'pt':'np'; const k=who+':'+pt; byRank[k]=byRank[k]||[0,0]; byRank[k][0]++; if(!h.defendersWin) byRank[k][1]++; }
    r.history.forEach((h,i)=>{ const who=h.declTeam===aTeam?'A':'B'; const d=declLog[i]; const pt=[5,10,13].includes(h.trumpRank)?'pt':'np';
      const k=who+':'+pt+':by'+(d?(d.by===who?'Self':'Opp')+d.strength:'None'); byDecl[k]=byDecl[k]||[0,0]; byDecl[k][0]++; if(!h.defendersWin) byDecl[k][1]++; });
    declLog.length=0; lastDecl=null;
    dP.push(r.history.length?sum/r.history.length:0);
  }
  if(dL.length===2){pairL.push((dL[0]+dL[1])/2);pairP.push((dP[0]+dP[1])/2);pairW.push((dW[0]+dW[1])/2);}
  if(s%5===0) process.stderr.write(`\r ${s-S0}/${N} ${((Date.now()-t0)/1000/(s-S0)).toFixed(1)}s/seed `);
}
const st=a=>{const n=a.length,m=a.reduce((x,y)=>x+y,0)/n;const sd=Math.sqrt(a.reduce((x,y)=>x+(y-m)*(y-m),0)/n);return {n,m,se:sd/Math.sqrt(n)};};
const pL=st(pairL),pP=st(pairP),pW=st(pairW); const nz=pairP.filter(x=>x!==0).length, pos=pairP.filter(x=>x>0).length;
console.log(`\n${BA}${process.env.OVA||''} vs ${BB}${process.env.OVB||''}: ${N} seeds(from ${S0+1}) ${rounds} rounds ${((Date.now()-t0)/1000).toFixed(0)}s`);
console.log(`  wins A ${winA}:${winB} B (draw ${draw})  pairW ${(100*pW.m).toFixed(1)}% ±${(100*pW.se).toFixed(1)}`);
console.log(`  levels ${pL.m>=0?'+':''}${pL.m.toFixed(2)} ±${pL.se.toFixed(2)} (t=${(pL.m/pL.se).toFixed(2)})   pts/round ${(pP.m/2)>=0?'+':''}${(pP.m/2).toFixed(2)} ±${(pP.se/2).toFixed(2)} (t=${(pP.m/pP.se).toFixed(2)})  A better ${pos}/${nz}`);
console.log(`  AI time/match: A ${(msA/games/1000).toFixed(2)}s  B ${(msB/games/1000).toFixed(2)}s`);
console.log(`  declarer hold: A ${(100*hold.A[1]/hold.A[0]).toFixed(1)}% (${hold.A[0]})  B ${(100*hold.B[1]/hold.B[0]).toFixed(1)}% (${hold.B[0]})  | `+Object.keys(byRank).sort().map(k=>k+' '+(100*byRank[k][1]/byRank[k][0]).toFixed(1)+'%').join('  '));
console.log('  dealer hold by who declared: '+Object.keys(byDecl).sort().map(k=>k+' '+(100*byDecl[k][1]/byDecl[k][0]).toFixed(0)+'%('+byDecl[k][0]+')').join('  '));
if(process.env.OUT) require('fs').writeFileSync(process.env.OUT,JSON.stringify({pairL,pairP,pairW}));
