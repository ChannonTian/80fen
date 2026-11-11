/* 并行生成:把 [seed0+1, seed0+total] 切成每块 chunk 个种子,开 workers 个子进程轮流领块;已有 .meta.json 的块跳过(可断点续跑)。
 *   node ai2/gen-par.js --seed0=0 --total=20000 --chunk=100 --workers=4 --k=3 --out=<目录> */
'use strict';
const {spawn}=require('child_process'),fs=require('fs'),path=require('path');
const a={seed0:0,total:1000,chunk:100,workers:4,k:3,out:'ai2-data'};
for(const x of process.argv.slice(2)){ const m=x.match(/^--(\w+)=(.*)$/); if(m) a[m[1]]=isNaN(+m[2])?m[2]:+m[2]; }
const jobs=[]; for(let s=a.seed0;s<a.seed0+a.total;s+=a.chunk){
  const n=Math.min(a.chunk,a.seed0+a.total-s);
  if(!fs.existsSync(path.join(a.out,`s${s}_${n}.meta.json`))) jobs.push([s,n]); }
let running=0, done=0; const t0=Date.now();
function next(){
  while(running<a.workers&&jobs.length){
    const [s,n]=jobs.shift(); running++;
    const p=spawn('node',[path.join(__dirname,'gen-data.js'),`--seed0=${s}`,`--n=${n}`,`--k=${a.k}`,`--out=${a.out}`],{stdio:['ignore','ignore','inherit']});
    p.on('exit',()=>{ running--; done++; if(done%5===0) console.log(`${done} 块完成, ${((Date.now()-t0)/1000).toFixed(0)}s`); next(); });
  }
}
next();
