/* 普扫的自检:把 cf-scan / cf-scan-lead 的 RAW 输出按 **gap 分位数** 切成四桶。
 *
 *   node test/gapq.js <一把量具的 RAW 文件...> [-- <另一把的...>]
 *
 * gap = AI 自估「我出的这一手比替代那一手好多少分」。一把量反了的量具,
 * 这一层会是平的或反的;一把好量具应当**单调且陡**。
 *
 * 主口径是 **Spearman ρ(gap 的秩 vs dp 的秩)**:它用上全部样本,
 * n=2600 时 SE≈0.02,比四分位表灵敏一个量级。
 * **四分位表只用来看形状,不要拿它的某一档当判据** —— 每档只有 n/4 个点,
 * SE≈0.9,三批独立种子量出来 Q1~Q3 的次序会翻来覆去(领出实测:
 * Q3 三批分别是 −2.07 / −2.02 / −0.80)。稳的只有 Q4。
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
/* Spearman ρ:把 gap 和 dp 各自换成秩再算 Pearson。
 * ρ<0 = 「AI 自估越有把握,换掉它就越吃亏」= 分数的幅度有意义。 */
function spearman(rec){
  const n=rec.length; if(n<3) return null;
  const rank=key=>{
    const idx=rec.map((r,i)=>i).sort((a,b)=>rec[a][key]-rec[b][key]);
    const rk=new Array(n);
    for(let i=0;i<n;){                      // 并列取平均秩
      let j=i; while(j+1<n&&rec[idx[j+1]][key]===rec[idx[i]][key]) j++;
      const avg=(i+j)/2+1;
      for(let k=i;k<=j;k++) rk[idx[k]]=avg;
      i=j+1;
    }
    return rk;
  };
  const a=rank('gap'), b=rank('dp');
  const ma=a.reduce((x,y)=>x+y,0)/n, mb=b.reduce((x,y)=>x+y,0)/n;
  let sab=0,sa=0,sb=0;
  for(let i=0;i<n;i++){ const da=a[i]-ma, db=b[i]-mb; sab+=da*db; sa+=da*da; sb+=db*db; }
  const rho=sab/Math.sqrt(sa*sb);
  return {rho, se:1/Math.sqrt(n-1), n};      // Fisher-z 近似,够用
}

function show(rec,label){
  if(!rec.length){ console.log(`\n${label}  (没有数据)`); return; }
  const srt=[...rec].sort((a,b)=>a.gap-b.gap), n=srt.length;
  const cuts=[0,.25,.50,.75,1].map(x=>Math.round(x*n));
  const sp=spearman(rec);
  console.log(`\n${label}`);
  console.log(`  **Spearman ρ(gap 秩 vs dp 秩)= ${sp.rho>=0?'+':''}${sp.rho.toFixed(3)} ±${sp.se.toFixed(3)} `
    +`(t=${(sp.rho/sp.se).toFixed(1)}, n=${sp.n})**  ← 主口径,越负越说明分数的幅度有意义`);
  console.log(`  四分位(只看形状,单档 SE≈${(1/Math.sqrt(n/4)*20).toFixed(1)},别拿单档当判据)`
    +`  切点:${[.25,.5,.75].map(x=>srt[Math.round(x*n)].gap.toFixed(1)).join(' / ')}`);
  for(let i=0;i<4;i++){
    const g=srt.slice(cuts[i],cuts[i+1]);
    console.log(`  Q${i+1}(gap ${g[0].gap.toFixed(1)}~${g[g.length-1].gap.toFixed(1)})  ${stat(g.map(r=>r.dp))}`);
  }
}
/* 用 `--` 分组,可以一次横比两把量具 */
const groups=[[]];
for(const a of process.argv.slice(2)){ if(a==='--') groups.push([]); else groups[groups.length-1].push(a); }
groups.forEach((g,i)=>{ if(g.length) show(load(g), g.length===1?g[0]:`第 ${i+1} 组(${g.length} 份)`); });
