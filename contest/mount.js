/* 把一个提交装进它该待的屋子。
 *
 * `league.js` 和 `run.js` 都从这里走 —— 早先各写各的,`run.js` 那份把**所有**提交
 * 都装进 house 屋子,于是单对详跑时参赛者能摸到我们的引擎,而联赛里摸不到。
 * 同一份提交在两条路上跑出不同结果,那排名就不可信了。
 *
 * 自家安插的选手用**显式白名单** —— 只有这两个包装了我们的 AI。
 * 早先按 `contest/` 前缀判,那会把 contest/public/example/(发给参赛者的模板)
 * 也判成自家、塞给它我们的引擎 —— 模板在我们这儿能跑、发出去就跑不了。
 * 除白名单外**一律空屋**,包括我们自己放在 contest/ 下的测试夹具。
 */
'use strict';
const {createRealm, guestRealm}=require('./engine.js');

const HOUSE=new Set(['contest/ai-baseline.js','contest/ai-norebel.js']);
const norm=p=>String(p).replace(/\\/g,'/').replace(/^\.\//,'');
const isHouse=p=>HOUSE.has(norm(p));

/* eg=true 才给陪练开收官蒙特卡洛。线上 index.html 的默认是 egSearch:1,
 * 所以正式跑分要开;关着快 4 倍,只适合调参时图快。
 * 注意这是在 mount **之前**设的,参赛者可以在自己的工厂里把它设回来 ——
 * 计算预算该由超时来管,不该由裁判禁用某个功能。 */
function mount(file, tag, build, eg){
  if(isHouse(file)){
    const r=createRealm(build, tag);
    if(!eg) r.AI.AIP.egSearch=0;
    return r.mount(file);
  }
  return guestRealm(tag).mount(file);
}

module.exports={mount, isHouse, HOUSE};
