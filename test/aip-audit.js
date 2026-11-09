/* AIP 参数体检(2026-10-24):多少是开关、拟合系数、带测量依据的数值、没依据的数值。  node test/aip-audit.js [html] */
const fs=require("fs");const src=fs.readFileSync(process.argv[2]||require('path').join(__dirname,'..','80fen-test.html'),"utf8");
const i=src.indexOf("const AIP = {"); let j=src.indexOf("\n};",i); const blk=src.slice(i,j);
const lines=blk.split("\n").slice(1); const rows=[]; let comment="";
for(const l of lines){ const t=l.trim();
  if(!t) continue;
  if(t.startsWith("/*")||t.startsWith("*")||t.startsWith("//")){ comment+=t+" "; continue; }
  const m=t.match(/^(\w+):\s*(\[[^\]]*\]|[^,]+),?\s*(\/\/.*)?$/); if(!m){ comment=""; continue; }
  const c=(comment+" "+(m[3]||"")); comment="";
  const v=m[2].trim(); rows.push({k:m[1],v,isSw:/^[01]$/.test(v),isArr:v.startsWith("["),c,
    ev:/拟合|fit-|校准|calib|实测|量出|量到|量过|扫参|扫过|配对|反事实|t=|±|自对弈|局:|种子|复量|对照/.test(c)});
}
const num=rows.filter(r=>!r.isSw&&!r.isArr);
console.log("AIP 条目",rows.length,"| 0/1 开关",rows.filter(r=>r.isSw).length,"| 拟合数组",rows.filter(r=>r.isArr).length,"| 其他数值",num.length,"—— 注释带测量依据",num.filter(r=>r.ev).length,"、不带",num.filter(r=>!r.ev).length);
console.log("\n不带测量依据的数值参数:"); for(const r of num.filter(r=>!r.ev)) console.log(`  ${r.k}=${r.v}   ${r.c.replace(/\s+/g," ").slice(0,90)}`);
