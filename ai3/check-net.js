/* 自检 2 的 JS 一侧:node ai3/check-net.js --feat=ai3/out/feat --net=ai3/out/net-v1 (先跑 check-net.py) */
'use strict';
const fs=require('fs'),path=require('path'),F=require('./feat.js'),Net=require('./net.js');
const arg=(k,d)=>{ const a=process.argv.find(x=>x.startsWith('--'+k+'=')); return a?a.slice(k.length+3):d; };
const feat=arg('feat','ai3/out/feat'), dir=arg('net','ai3/out/net-v1');
const net=Net.load(dir), chk=JSON.parse(fs.readFileSync(path.join(dir,'check.json'),'utf8'));
let maxErr=0, maxRel=0, nd=0, nc=0;   // 通过口径:误差 ≤ 1e-4 × max(1,|分数|)(分数可到几百,float32 一个 ulp 就 3e-5)
const out=new Float32Array(2048);
for(const r of chk){
  if(r.S){      // 合并格式:特征字节随 check.json 带过来
    const S=Buffer.from(r.S,'base64'), C=Buffer.from(r.C,'base64');
    net.scores(new Uint8Array(S),new Uint8Array(C),r.n,out);
    for(let j=0;j<r.n;j++){ const e=Math.abs(out[j]-r.scores[j]); if(e>maxErr) maxErr=e; const rl=e/Math.max(1,Math.abs(r.scores[j])); if(rl>maxRel) maxRel=rl; nc++; }
    nd++; continue;
  }
  const p=path.join(feat,r.chunk);
  const M=fs.readFileSync(p+'.M.bin'); const m=new Int32Array(M.buffer,M.byteOffset,M.length>>2);
  const n=m[r.i*14+4], off=m[r.i*14+5];
  const fd=fs.openSync(p+'.S.bin','r'); const S=Buffer.alloc(F.SD); fs.readSync(fd,S,0,F.SD,r.i*F.SD); fs.closeSync(fd);
  const fc=fs.openSync(p+'.C.bin','r'); const C=Buffer.alloc(n*F.CD); fs.readSync(fc,C,0,n*F.CD,off*F.CD); fs.closeSync(fc);
  net.scores(new Uint8Array(S),new Uint8Array(C),n,out);
  for(let j=0;j<n;j++){ const e=Math.abs(out[j]-r.scores[j]); if(e>maxErr) maxErr=e; const rl=e/Math.max(1,Math.abs(r.scores[j])); if(rl>maxRel) maxRel=rl; nc++; }
  nd++;
}
console.log(`JS vs PyTorch:${nd} 个决策 ${nc} 个候选分数,最大绝对误差 ${maxErr.toExponential(2)},最大相对误差 ${maxRel.toExponential(2)}  ${maxRel<=1e-4?'通过':'失败'}`);
process.exit(maxRel<=1e-4?0:1);
