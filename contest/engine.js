/* 比赛用引擎包 —— 从 build 的 html 里**运行时抽取**块①,只暴露引擎那一半。
 *
 *   const {E, AI} = require('./engine.js').load('index.html');
 *
 * 为什么不拆成一份静态的 engine.js:拆出来的副本会和主线漂移,而 check-sync
 * 又得多钉一条不变量。运行时抽取是零维护的 —— html 改了它自动跟上。
 *
 * 块① 的 334~744 行(html 行号)是纯引擎,745 行起全是 AI。这里不按行切,
 * 按**符号白名单**切 —— E 是稳定契约,AI 是基线内部(用了就绑在这一版上)。
 *
 * createRealm() 才是比赛真正用的那个:它把**参赛者的代码本身**也放进同一个隔离
 * realm 里跑。只隔离引擎是不够的 —— 用宿主的 require() 加载提交,提交里一句
 * `Array.prototype.slice = ...` 就能把裁判打穿。(contest/selftest.js 钉着这一条。)
 */
const fs=require('fs'), vm=require('vm'), path=require('path');

// 引擎符号 —— 恰好是 html 里 ENGINE 字面量的前三行
const ENGINE_API=['RULES','makeDeck','cardPoints','countPoints','rng','dealRound',
  'cutForFirst','effSuit','ordIdx','decompose','classify','isLegalFollow','resolveTrick',
  'checkThrow','declarationOf','canOverride','declOptions','jokerPairOf','canReinforce2',
  'canFullRebel','dealerAfterDecl','scoreRound','advanceMatch','clampAtGate','countPairsIn',
  'maxTractorLen','structMatches','removeCard','aiLead','genFollow'];

/* 干净的 vm context:**不传宿主的内建对象**。
 * vm.createContext({}) 造出来的 realm 自带一套自己的 Object/Array/Math/JSON,
 * 于是参赛者改 Array.prototype 只能改到自己那一份,污染不到裁判和对手。
 * (test/ai-h2h.js 与 test/ai-scenarios.js 传的是宿主内建 —— 那是自己人跑自己人,
 *  无所谓;比赛里不行。)
 */
function freshContext(extra){
  const ctx=vm.createContext({});
  vm.runInContext('globalThis.module={exports:{}};globalThis.exports=module.exports;',ctx);
  if(extra) for(const k in extra) ctx[k]=extra[k];
  return ctx;
}

// 抽出 html 的第 n 个 <script> 块并在独立 realm 里跑,返回 module.exports
function runBlock(file, n, extra){
  const src=fs.readFileSync(file,'utf8');
  const blocks=[...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  if(!blocks[n]) throw new Error(`${file} 里没有第 ${n+1} 个 <script> 块`);
  const ctx=freshContext(extra);
  vm.runInContext(blocks[n],ctx,{filename:`${path.basename(file)}#block${n+1}`});
  return {exports:ctx.module.exports, ctx};
}

/* load(file) → {E, AI, RULES}
 *   E   —— 引擎子集(白名单),给参赛者和裁判共用
 *   AI  —— 整块导出,只给裁判包基线用,不发给参赛者
 */
function load(file){
  const {exports:full}=runBlock(file,0);
  const E={};
  for(const k of ENGINE_API){
    if(!(k in full)) throw new Error(`引擎缺符号 ${k} —— ${file} 的块① 变了?`);
    E[k]=full[k];
  }
  Object.freeze(E);
  return {E, AI:full, RULES:full.RULES};
}

/* ---------- 参赛者的屋子:空的 ----------
 *
 * 关键:这里**一行我们的代码都不加载**。
 *
 * 早先参赛者和陪练共用 createRealm,那个 realm 里跑过块①,于是 ctx 的全局
 * `module.exports` 上挂着整个 ENGINE —— 参赛者写一行 globalThis.module.exports
 * 就能把引擎连同 101 个 AI 内部函数整个读出来,「自己照规则书写引擎」这条就废了。
 *
 * 参赛者拿到的是:一间只有 JS 内建的屋子,加一个只能读磁盘上 .js 的极简 require。
 * 没有 fs、没有 process、没有网络、没有 npm。他要的一切自己写。
 */
function guestRealm(tag){
  const con={};
  for(const m of ['log','warn','error','info','debug'])
    con[m]=(...a)=>console[m](`[${tag||'guest'}]`, ...a);
  const ctx=freshContext({console:con});
  // 全局 module 是给加载器用的中转,清空它 —— 别让它变成一个信息通道
  vm.runInContext('globalThis.module={exports:{}};globalThis.exports=module.exports;',ctx);

  const cache=new Map();
  function req(fromDir, spec){
    let f=path.resolve(fromDir, spec);
    if(!f.endsWith('.js')){
      // 支持 require('./foo') 与 require('<目录>') → <目录>/index.js
      if(fs.existsSync(f) && fs.statSync(f).isDirectory()) f=path.join(f,'index.js');
      else f+='.js';
    }
    if(cache.has(f)) return cache.get(f).exports;
    const code=fs.readFileSync(f,'utf8');
    const mod={exports:{}};
    cache.set(f,mod);
    const wrap=vm.runInContext(
      `(function(module, exports, require, __filename, __dirname){\n${code}\n})`,
      ctx, {filename:f});
    wrap(mod, mod.exports, s=>req(path.dirname(f), s), f, path.dirname(f));
    return mod.exports;
  }

  // 提交可以是一个 .js,也可以是一个目录(入口 index.js)—— 他们要装下自己的引擎
  function mount(entry){
    const mod=req(process.cwd(), entry);
    const ai = typeof mod==='function' ? mod()
             : (mod && typeof mod.create==='function' ? mod.create() : mod);
    return ai;
  }
  return {ctx, require:req, mount};
}

/* ---------- 我们自己那份陪练的屋子 ----------
 *
 * realm 里没有 node 的 require,所以自带一个极简的 CommonJS 加载器:
 * 只认磁盘上的 .js,源码同样在 realm 里跑。于是参赛者 require 进来的东西
 * (比如 fork 出去的 baseline.js)也在隔离里,不会绕过护栏。
 *
 * 里面**没有** require('fs') / require('child_process') / process —— 提交拿不到
 * 文件系统和进程。这不是安全沙箱(vm 从来不是),是把"不小心"和"顺手作弊"挡住;
 * 真要防恶意代码得上子进程 + 权限,见 AI-API.md §4 对边界的说明。
 */
function createRealm(buildFile, tag){
  const con={};
  for(const m of ['log','warn','error','info','debug'])
    con[m]=(...a)=>console[m](`[${tag||'realm'}]`, ...a);
  const ctx=freshContext({console:con});

  const src=fs.readFileSync(buildFile,'utf8');
  const blocks=[...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  vm.runInContext(blocks[0],ctx,{filename:`${path.basename(buildFile)}#block1`});
  const full=ctx.module.exports;

  const E={};
  for(const k of ENGINE_API){
    if(!(k in full)) throw new Error(`引擎缺符号 ${k} —— ${buildFile} 的块① 变了?`);
    E[k]=full[k];
  }
  Object.freeze(E);

  const cache=new Map();
  function realmRequire(fromDir, spec){
    let f=path.resolve(fromDir, spec);
    if(!f.endsWith('.js')) f+='.js';
    if(cache.has(f)) return cache.get(f).exports;
    const code=fs.readFileSync(f,'utf8');
    const mod={exports:{}};
    cache.set(f,mod);                     // 先入缓存,容忍循环依赖
    const wrap=vm.runInContext(
      `(function(module, exports, require, __filename, __dirname){\n${code}\n})`,
      ctx, {filename:f});
    wrap(mod, mod.exports, s=>realmRequire(path.dirname(f), s), f, path.dirname(f));
    return mod.exports;
  }

  // 加载一份提交,返回它导出的 AI 对象
  function mount(file){
    const mod=realmRequire(process.cwd(), file);
    const factory = typeof mod==='function' ? mod
                  : (mod && typeof mod.create==='function' ? mod.create : null);
    return factory ? factory({E, AI:full}) : mod;
  }

  return {E, AI:full, ctx, require:realmRequire, mount};
}

module.exports={load, runBlock, freshContext, createRealm, guestRealm, ENGINE_API};
