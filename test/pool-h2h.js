/* 把分批跑的 ai-h2h 结果按逆方差合并(配对口径的分 / 级各自合并)。
 *
 *   node test/pool-h2h.js <目录> <前缀> [前缀…]
 *
 * 读 <目录>/<前缀>-*.txt(ai-h2h.js 的输出),每批取「新版净胜 x 分/局 (SE s)」与「新版净升 x 级/局 (SE s)」,
 * 权重 1/SE²。单批不下结论(DESIGN §7.13 的教训:2800 种子 t=2.75,复验 3150 个新种子几乎是零)。
 * 注意 OVN 把开关**关掉**做对照时,「新版」是关掉的那一边,符号要反过来读。
 */
'use strict';
const fs=require('fs'),path=require('path');
const dir=process.argv[2]||'.';
for(const g of process.argv.slice(3)){
  const files=fs.readdirSync(dir).filter(f=>f.startsWith(g+'-')&&f.endsWith('.txt'));
  let wp=0,sp=0,wl=0,sl=0,n=0;
  for(const f of files){ const t=fs.readFileSync(path.join(dir,f),'utf8');
    const a=t.match(/新版净胜 (-?[\d.]+) 分\/局\s+\(SE ([\d.]+)/), b=t.match(/新版净升 ([+-]?[\d.]+) 级\/局\s+\(SE ([\d.]+)/);
    if(!a||!b) continue; n++;
    const w1=1/(+a[2])**2, w2=1/(+b[2])**2; wp+=w1; sp+=w1*a[1]; wl+=w2; sl+=w2*b[1]; }
  if(!n){ console.log(`${g}: 没有读到结果`); continue; }
  console.log(`${g}: ${n} 批  分 ${(sp/wp).toFixed(2)} ±${(1/Math.sqrt(wp)).toFixed(2)} (t=${((sp/wp)*Math.sqrt(wp)).toFixed(2)})`
    +`  级 ${(sl/wl).toFixed(4)} ±${(1/Math.sqrt(wl)).toFixed(4)} (t=${((sl/wl)*Math.sqrt(wl)).toFixed(2)})`);
}
