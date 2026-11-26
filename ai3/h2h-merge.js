/* ai3/h2h-merge.js —— 合并同一组的几批 h2h 日志(等批量):均值 = 各批均值的平均,SE = √ΣSE²/批数。
 *   node ai3/h2h-merge.js <日志...>   →  一行 JSON {n,pts,ptsSE,lv,lvSE,net,lead,fol,agree:{键:[命中,总]}}
 *   node ai3/h2h-merge.js --md 标签 <日志...>   →  一行可直接贴进 status 的文字
 *   node ai3/h2h-merge.js --seg 标签 <段 1 日志...> -- <段 2 日志...> [-- ...]  →  每段一行 + 合计一行(合计 = 各段均值的平均,SE = √ΣSE²/段数) */
'use strict';
const fs=require('fs');
let args=process.argv.slice(2), md=null;
if(args[0]==='--seg'){
  const lab=args[1], segs=[[]]; for(const x of args.slice(2)){ if(x==='--') segs.push([]); else segs[segs.length-1].push(x); }
  const R=segs.map(g=>JSON.parse(require('child_process').execFileSync(process.execPath,[__filename,...g]).toString()));
  const line=(t,r,extra)=>`- ${t}:${r.pts.toFixed(2)} ±${r.ptsSE.toFixed(2)} 分/局,${r.lv.toFixed(3)} ±${r.lvSE.toFixed(3)} 级/局(${r.n} 批)`+extra;
  const ag=r=>Object.keys(r.agree).length?`;一致率 `+Object.keys(r.agree).sort().map(k=>`${k} ${(100*r.agree[k][0]/r.agree[k][1]).toFixed(1)}%`).join(' '):'';
  R.forEach((r,i)=>console.log(line(`${lab} 第 ${i+1} 段`,r,(r.net?`,网络接管 ${r.net} 手`:'')+ag(r))));
  const k=R.length, t={n:R.reduce((s,r)=>s+r.n,0),pts:R.reduce((s,r)=>s+r.pts,0)/k,ptsSE:Math.sqrt(R.reduce((s,r)=>s+r.ptsSE**2,0))/k,
    lv:R.reduce((s,r)=>s+r.lv,0)/k,lvSE:Math.sqrt(R.reduce((s,r)=>s+r.lvSE**2,0))/k};
  console.log(line(`${lab} **${k} 段合计**`,t,'')); process.exit(0);
}
if(args[0]==='--md'){ md=args[1]; args=args.slice(2); }
const P=[],L=[]; let net=0,lead=0,fol=0; const agree={};
for(const f of args){
  const t=fs.readFileSync(f,'utf8');
  const m=t.match(/新版净胜 ([-+\d.]+) 分\/局\s+\(SE ([\d.]+)/), l=t.match(/新版净升 ([-+\d.]+) 级\/局\s+\(SE ([\d.]+)/);
  if(!m||!l) continue;
  P.push([+m[1],+m[2]]); L.push([+l[1],+l[2]]);
  const p=t.match(/网络接管 (\d+) 手\(领出 (\d+) \/ 跟牌 (\d+)/); if(p){ net+=+p[1]; lead+=+p[2]; fol+=+p[3]; }
  const a=t.match(/一致率[^\n]*\n?/); 
  for(const mm of t.matchAll(/(前半|后半)·(跟牌|领出) ([\d.]+)%\((\d+)\)/g)){ const k=mm[1]+'·'+mm[2], n=+mm[4]; const e=agree[k]||(agree[k]=[0,0]); e[0]+=+mm[3]/100*n; e[1]+=n; }
}
const mean=x=>x.reduce((s,y)=>s+y[0],0)/x.length, se=x=>Math.sqrt(x.reduce((s,y)=>s+y[1]**2,0))/x.length;
const r={n:P.length,pts:mean(P),ptsSE:se(P),lv:mean(L),lvSE:se(L),net,lead,fol,agree};
if(!md) console.log(JSON.stringify(r));
else console.log(`- ${md}:${r.pts.toFixed(2)} ±${r.ptsSE.toFixed(2)} 分/局,${r.lv.toFixed(3)} ±${r.lvSE.toFixed(3)} 级/局(${r.n} 批)`
  +(net?`,网络接管 ${net} 手(领出 ${lead}/跟牌 ${fol})`:'')
  +(Object.keys(agree).length?`;一致率 `+Object.keys(agree).sort().map(k=>`${k} ${(100*agree[k][0]/agree[k][1]).toFixed(1)}%`).join(' '):''));
