/* 把 human-fit.js --export 的权重写进 80fen-test.html 的 HF_W 块。
 *   node test/human-fit-embed.js <weights.json> [80fen-test.html]
 * 三套:sets[0] 全部局;sets[1] 偶数 fold 训练(AIP.hfSet=1,给奇数 fold 的局用);sets[2] 奇数 fold 训练(hfSet=2,给偶数 fold 的局用)。
 * 权重四舍五入到 3 位小数(分/原始特征单位);名字顺序必须和 HF_*_F 一致,这里查。 */
'use strict';
const fs=require('fs');
const W=JSON.parse(fs.readFileSync(process.argv[2],'utf8')), file=process.argv[3]||'80fen-test.html';
let s=fs.readFileSync(file,'utf8');
const a=s.indexOf('/*HF_W_BEGIN*/'), b=s.indexOf('/*HF_W_END*/');
if(a<0||b<0) throw new Error('找不到 HF_W 标记');
const r=x=>Math.round(x*1000)/1000;
const body='\n/* 生成的,别手改:test/human-fit.js --export → test/human-fit-embed.js。names 与 HF_*_F 同序。 */\nconst HF_W={\n'+
 ['lead','follow'].map(k=>`  ${k}:{names:${JSON.stringify(W[k].names)},\n    sets:[\n${W[k].sets.map(v=>'      '+JSON.stringify(v.map(r))).join(',\n')}\n    ]}`).join(',\n')+
 '\n};\n';
s=s.slice(0,a+'/*HF_W_BEGIN*/'.length)+body+s.slice(b);
fs.writeFileSync(file,s);
console.log('已写入 '+file);
