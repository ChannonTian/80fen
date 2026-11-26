/* ai3/replay-check.js —— 回放全部牌谱,统计不一致局。node ai3/replay-check.js [--dir=ai3/out/rec] */
'use strict';
const path=require('path'),fs=require('fs');
const {replayGame,readRecs,playInfo}=require('./replay.js');
const dir=(process.argv.find(x=>x.startsWith('--dir='))||'').slice(6)||path.join(__dirname,'out','rec');
let n=0,bad=[],byKind={},plays=0;
const D={games:0,engDec:0,engSame:0,engForced:0,netDec:0,netAgree:0,netForced:0,labelBad:0,netTeamSeen:{0:0,1:0}};  // DAgger 统计
for(const rec of readRecs(dir)){
  n++; plays+=rec.p.length;
  if(rec.dg!==undefined){ D.games++; D.netTeamSeen[rec.dg]++;
    for(const p of rec.p){ const q=playInfo(p), actual=q.act||q.cho;
      if(q.isNet){ D.netDec++; if(q.label.join()===actual.join()) D.netAgree++; if(q.act) D.netForced++; if(q.labelBad) D.labelBad++; }
      else { D.engDec++; if(q.label.join()===actual.join()) D.engSame++; else D.engForced++; } } }
  const r=replayGame(rec);
  if(!r.ok){ bad.push({s:rec.s,why:r.why}); byKind[r.kind||'other']=(byKind[r.kind||'other']||0)+1; }
}
console.log(`回放 ${n} 局 ${plays} 手;不一致 ${bad.length} 局(${(100*bad.length/Math.max(1,n)).toFixed(3)}%)`,JSON.stringify(byKind));
for(const b of bad.slice(0,15)) console.log(' ',b.s,b.why);
if(bad.length) fs.writeFileSync(path.join(__dirname,'out','replay-bad.json'),JSON.stringify(bad));
if(D.games){
  const f=x=>(100*x).toFixed(2)+'%';
  console.log(`DAgger ${D.games} 局(网络队 0:${D.netTeamSeen[0]} 1:${D.netTeamSeen[1]});引擎座位 ${D.engDec} 手,标签==实际出的 ${f(D.engSame/D.engDec)}(不同 ${D.engForced} = 被强制的甩牌);`
    +`网络座位 ${D.netDec} 手,标签==实际出的 ${f(D.netAgree/D.netDec)}(网络被强制修正 ${D.netForced} 手,标签本身被强制 ${D.labelBad} 手)`);
}
