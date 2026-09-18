const fs=require('fs');
function load(fs_){const rec=[];for(const f of fs_){const L=fs.readFileSync(f,'utf8').split('\n').find(x=>x.startsWith('RAW '));rec.push(...JSON.parse(L.slice(4)).rec);}return rec;}
const stat=a=>{const m=a.reduce((x,y)=>x+y,0)/a.length;const sd=Math.sqrt(a.reduce((x,y)=>x+(y-m)*(y-m),0)/a.length);const se=sd/Math.sqrt(a.length);
  return `${m>=0?'+':''}${m.toFixed(2)} ±${se.toFixed(2)} (t=${(m/se).toFixed(2)}) n=${a.length}`;};
function q(rec,label){
  const srt=[...rec].sort((a,b)=>a.gap-b.gap);
  const n=srt.length;
  const cuts=[0,.25,.50,.75,1].map(x=>Math.round(x*n));
  console.log(`\n${label}  gap 四分位:${[.25,.5,.75].map(x=>srt[Math.round(x*n)].gap.toFixed(1)).join(' / ')}`);
  for(let i=0;i<4;i++){
    const g=srt.slice(cuts[i],cuts[i+1]);
    console.log(`  Q${i+1}(gap ${g[0].gap.toFixed(1)}~${g[g.length-1].gap.toFixed(1)})  ${stat(g.map(r=>r.dp))}`);
  }
}
const D=process.argv[2];
q(load([0,400,800,1200].map(s=>`${D}/scan/s${s}.txt`)),'跟牌普扫');
q(load([0,400,800,1200].map(s=>`${D}/scanl/s${s}.txt`)),'领出普扫');
