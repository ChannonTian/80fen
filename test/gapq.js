/* 普扫的自检:把 cf-scan / cf-scan-lead 的 RAW 输出按 **gap 分位数** 切成四桶。
 *
 *   node test/gapq.js <一把量具的 RAW 文件...> [-- <另一把的...>]
 *
 * gap = AI 自估「我出的这一手比替代那一手好多少分」。一把量反了的量具,
 * 这一层会是平的或反的;一把好量具应当**单调且陡**。
 *
 * ⚠️ **必须按分位数切,不能按固定切点。** 不同量具(甚至同一量具的不同口径)
 * 分数量纲不一样:`gap≥20` 在跟牌普扫里占 17%,在领出普扫里占 48% ——
 * 拿同一个 20 去横比,等于拿两把刻度不同的尺子量。
 * 详见 docs/notes/measurement.md「第五类量具:普扫」。
 */
const fs=require('fs');
const load=files=>{
  const rec=[];
  for(const f of files){
    const L=fs.readFileSync(f,'utf8').split('\n').find(x=>x.startsWith('RAW '));
    if(!L){ console.error('no RAW in '+f); continue; }
    rec.push(...JSON.parse(L.slice(4)).rec);
  }
  return rec;
};
const stat=a=>{
  const m=a.reduce((x,y)=>x+y,0)/a.length;
  const sd=Math.sqrt(a.reduce((x,y)=>x+(y-m)*(y-m),0)/a.length);
  const se=sd/Math.sqrt(a.length);
  return `${m>=0?'+':''}${m.toFixed(2)} ±${se.toFixed(2)} (t=${(m/se).toFixed(2)}) n=${a.length}`;
};
function show(rec,label){
  if(!rec.length){ console.log(`\n${label}  (没有数据)`); return; }
  const srt=[...rec].sort((a,b)=>a.gap-b.gap), n=srt.length;
  const cuts=[0,.25,.50,.75,1].map(x=>Math.round(x*n));
  console.log(`\n${label}  gap 四分位切点:${[.25,.5,.75].map(x=>srt[Math.round(x*n)].gap.toFixed(1)).join(' / ')}`);
  for(let i=0;i<4;i++){
    const g=srt.slice(cuts[i],cuts[i+1]);
    console.log(`  Q${i+1}(gap ${g[0].gap.toFixed(1)}~${g[g.length-1].gap.toFixed(1)})  ${stat(g.map(r=>r.dp))}`);
  }
}
/* 用 `--` 分组,可以一次横比两把量具 */
const groups=[[]];
for(const a of process.argv.slice(2)){ if(a==='--') groups.push([]); else groups[groups.length-1].push(a); }
groups.forEach((g,i)=>{ if(g.length) show(load(g), g.length===1?g[0]:`第 ${i+1} 组(${g.length} 份)`); });
