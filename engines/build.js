/* 历史版本 AI 引擎:从 git 历史里把某一版 build 的块①(引擎 + AI)原样抽出来,
 * 包成一个浏览器端按需加载的独立模块。只给测试版用(设置 →「AI 引擎版本」),
 * 正式版 index.html 不加载这里的任何东西。
 *
 *   node engines/build.js            按下面的 VERSIONS 表重新生成全部模块
 *
 * 为什么整块照搬而不是只抽 aiChooseLead 这几个函数:AI 内部的几十个辅助函数、
 * AIP 参数、甚至 classify 这些规则函数都跟着那一版走 —— 只抽入口,调用的却是
 * 当前版的辅助函数,那就不是那一版的 AI 了。整块包进一个函数作用域,互不串味。
 *
 * 规则仍以当前版为准:旧 AI 给出的牌不合现行规则时,牌桌那边已有兜底
 * (领出过 checkThrow、跟牌过 isLegalFollow,不合法就换成 genFollow 的合法出法)。
 *
 * 喂给旧 AI 的 view 由当前版的 viewFor 造,v0.5.7 起字段只增不减(新版多一个
 * decl,旧版不读它);抢亮上下文 ctx 与 aiDiscard 的参数三版逐字一致。
 * 新增一个版本:在 VERSIONS 里加一行(提交号取那一版**正式版** index.html 或测试版
 * 80fen-test.html 所在的提交),重跑本脚本,再在 80fen-test.html 的 ENGINE_VERSIONS 里登记。 */
'use strict';
const {execFileSync}=require('child_process');
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');

// 版本号 → 该版所在的提交与文件。v0.6.x 没有单独留下来(v0.5.8~v0.7.0 当年压成一个提交)
const VERSIONS=[
  {ver:'v0.5.7', commit:'9be4ad5', file:'index.html', note:'0.5 系列最后一版(0.6 之前)'},
  {ver:'v0.7.0', commit:'5c8c643', file:'index.html', note:'0.7 系列第一版(含 0.6.x 全部改动 + 收官蒙特卡洛)'},
];

function build(){
for(const v of VERSIONS){
  const html=execFileSync('git',['show',`${v.commit}:${v.file}`],{cwd:ROOT,encoding:'utf8',maxBuffer:64<<20});
  const tag=((html.match(/<div id="versionTag">(.*?)<\/div>/)||[])[1]||'');
  if(!tag.includes(v.ver)) throw new Error(`${v.commit}:${v.file} 的版本标记是「${tag}」,不是 ${v.ver}`);
  const block=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  const out=`/* 80分 ${v.ver} 的 AI 引擎(${v.note})。
 * 由 engines/build.js 从 ${v.commit}:${v.file} 的块① 原样生成,不要手改。 */
(function(){
var module={exports:{}};
${block}
var E=module.exports;
(window.__ENGINES=window.__ENGINES||{})[${JSON.stringify(v.ver)}]={ver:${JSON.stringify(v.ver)},
  aiChooseLead:E.aiChooseLead, aiChooseFollow:E.aiChooseFollow,
  aiDeclDecide:E.aiDeclDecide, scoreDeclOption:E.scoreDeclOption, aiDiscard:E.aiDiscard, AIP:E.AIP};
})();
`;
  const dst=path.join(__dirname,`${v.ver}.js`);
  fs.writeFileSync(dst,out);
  console.log(`${path.relative(ROOT,dst)}  ${(out.length/1024).toFixed(0)} KB  ← ${v.commit}:${v.file}`);
}
}
if(require.main===module) build();
module.exports={VERSIONS};
