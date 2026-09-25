/* 从 80fen-test.html 的 AIP 块生成开关登记表。每版改完可重跑。
 *   node gen-switches.js > SWITCHES.md 的主体部分
 */
const fs=require('fs');
const src=fs.readFileSync(process.argv[2]||'80fen-test.html','utf8');
const m=src.match(/const AIP = \{[\s\S]*?\n\};/);
const lines=m[0].split('\n').slice(1,-1);
const rows=[]; let group=null, block=null;
/* 说明:同一行的 // 注释优先;没有的话,取**紧挨在上方**那段 /* … *\/ 注释的第一句
 * (很多参数的说明写在上方的多行注释里,只抓行尾注释会让一半的表格是空的)。 */
const firstSentence=t=>{ t=t.replace(/\*\/\s*$/,'').replace(/^\s*\/?\*+\s?/,'').trim();
  const m2=t.match(/^(.+?[。;])/); return (m2?m2[1]:t).slice(0,90); };
for(let i=0;i<lines.length;i++){
  const L=lines[i];
  // 组注释:/* ... */ 的第一行
  const g=L.match(/^\s*\/\*\s*(.+?)(\*\/)?\s*$/);
  if(g&&!/^\s*\*/.test(L)){ group=g[1].replace(/\*\/$/,'').trim(); block=firstSentence(g[1]); continue; }
  const p=L.match(/^\s{2}([a-zA-Z][A-Za-z0-9_]*)\s*:\s*([^,]+?),\s*(?:\/\/\s*(.*))?$/);
  if(p){ rows.push({name:p[1],def:p[2].trim(),note:(p[3]||'').trim()||(block?'(见上方注释)'+block:''),group}); block=null; }
  else if(!/^\s*(\*|\/\/)/.test(L)&&L.trim()) block=null;
}
/* 「读取于」:每个参数被哪些函数读(`AIP.名字` 出现在哪个顶层函数体里)。
 * 只看引擎块(第一个 <script>),AIP 定义本身不算。顶层函数 = 行首的 `function 名字(`,
 * 一个函数的范围从它那一行到下一个顶层函数之前 —— 这个项目的写法一律如此。
 * 没有任何函数读的参数标成死旋钮:改它不会有任何效果。 */
const eng=(src.match(/<script>([\s\S]*?)<\/script>/)||[])[1]||src;
const aipStart=eng.indexOf('const AIP = {'), aipEnd=eng.indexOf('\n};',aipStart);
const engLines=eng.split('\n');
const fnAt=[]; let off=0;
for(let i=0;i<engLines.length;i++){
  const f=engLines[i].match(/^function\s+([A-Za-z_$][\w$]*)\s*\(/);
  if(f) fnAt.push({line:i,name:f[1]});
}
const lineOf=idx=>{ let n=0; for(let i=0;i<idx;i++) if(eng.charCodeAt(i)===10) n++; return n; };
const readers=name=>{
  const re=new RegExp('AIP\\.'+name+'(?![\\w$])','g'); const set=new Set(); let m2;
  while((m2=re.exec(eng))){
    if(m2.index>aipStart&&m2.index<aipEnd) continue;
    const ln=lineOf(m2.index); let fn=null;
    for(const f of fnAt){ if(f.line<=ln) fn=f.name; else break; }
    set.add(fn||'(顶层)');
  }
  return [...set];
};
console.log(`共 ${rows.length} 个参数\n`);
let cur=null;
for(const r of rows){
  if(r.group!==cur){ cur=r.group; console.log(`\n### ${cur||'(未分组)'}\n`);
    console.log('| 参数 | 默认 | 说明 | 读取于 |'); console.log('|---|---|---|---|'); }
  const rd=readers(r.name);
  const rdTxt=rd.length?rd.map(x=>'`'+x+'`').join(' '):'⚠️ 无人读取';
  console.log(`| \`${r.name}\` | \`${r.def}\` | ${r.note.replace(/\|/g,'\\|')||'—'} | ${rdTxt} |`);
}
