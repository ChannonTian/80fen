/* 从 80fen-test.html 的 AIP 块生成开关登记表。每版改完可重跑。
 *   node gen-switches.js > SWITCHES.md 的主体部分
 */
const fs=require('fs');
const src=fs.readFileSync(process.argv[2]||'80fen-test.html','utf8');
const m=src.match(/const AIP = \{[\s\S]*?\n\};/);
const lines=m[0].split('\n').slice(1,-1);
const rows=[]; let group=null;
for(let i=0;i<lines.length;i++){
  const L=lines[i];
  // 组注释:/* ... */ 的第一行
  const g=L.match(/^\s*\/\*\s*(.+?)(\*\/)?\s*$/);
  if(g&&!/^\s*\*/.test(L)){ group=g[1].replace(/\*\/$/,'').trim(); continue; }
  const p=L.match(/^\s{2}([a-zA-Z][A-Za-z0-9_]*)\s*:\s*([^,]+?),\s*(?:\/\/\s*(.*))?$/);
  if(p) rows.push({name:p[1],def:p[2].trim(),note:(p[3]||'').trim(),group});
}
console.log(`共 ${rows.length} 个参数\n`);
let cur=null;
for(const r of rows){
  if(r.group!==cur){ cur=r.group; console.log(`\n### ${cur||'(未分组)'}\n`);
    console.log('| 参数 | 默认 | 说明 |'); console.log('|---|---|---|'); }
  console.log(`| \`${r.name}\` | \`${r.def}\` | ${r.note.replace(/\|/g,'\\|')||'—'} |`);
}
