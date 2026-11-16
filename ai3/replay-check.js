/* ai3/replay-check.js —— 回放全部牌谱,统计不一致局。node ai3/replay-check.js [--dir=ai3/out/rec] */
'use strict';
const path=require('path'),fs=require('fs');
const {replayGame,readRecs}=require('./replay.js');
const dir=(process.argv.find(x=>x.startsWith('--dir='))||'').slice(6)||path.join(__dirname,'out','rec');
let n=0,bad=[],byKind={},plays=0;
for(const rec of readRecs(dir)){
  n++; plays+=rec.p.length;
  const r=replayGame(rec);
  if(!r.ok){ bad.push({s:rec.s,why:r.why}); byKind[r.kind||'other']=(byKind[r.kind||'other']||0)+1; }
}
console.log(`回放 ${n} 局 ${plays} 手;不一致 ${bad.length} 局(${(100*bad.length/Math.max(1,n)).toFixed(3)}%)`,JSON.stringify(byKind));
for(const b of bad.slice(0,15)) console.log(' ',b.s,b.why);
fs.writeFileSync(path.join(__dirname,'out','replay-bad.json'),JSON.stringify(bad));
