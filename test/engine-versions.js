/* 历史版本 AI 引擎(engines/*.js)的冒烟 + 对打验收。
 *
 *   node test/engine-versions.js [种子数=4] [每场局数=3]
 *
 * ① 每个模块在一个只有 `window` 的空 realm 里加载(浏览器里就是这么装的),
 *    导出的 AI 入口一个不少;
 * ② 和 80fen-test.html 当前版在打级赛制下对打(contest 裁判,交换阵营配对),
 *    数出旧 AI 出过几张**现行规则**下不合法的牌 —— 牌桌上这些由兜底换成合法出法,
 *    这里只要求个位数、别是系统性不合法;顺带报每手用时和级数差,供参考。
 * 收官蒙特卡洛关掉(egSearch=0)只是为了快;浏览器里各版按各自默认值跑。 */
'use strict';
const fs=require('fs'), vm=require('vm'), path=require('path');
const ROOT=path.join(__dirname,'..'); process.chdir(ROOT);
const {createRealm}=require('../contest/engine.js');
const {playMatch}=require('../contest/referee.js');
const {makeBaseline}=require('../contest/baseline.js');
const {VERSIONS}=require('../engines/build.js');
const N=+process.argv[2]||4, R=+process.argv[3]||3;

const CUR=createRealm('80fen-test.html','cur'); CUR.AI.AIP.egSearch=0;
const E=CUR.E;
const FB={engine:E,maxRounds:R,fallbackDiscard:(h,t)=>CUR.AI.aiDiscard(h,t),fallbackLead:(h,t,rd)=>CUR.AI.aiLead(h,t,rd)};
const cur=makeBaseline(CUR.AI,'当前');
let bad=0;
for(const v of VERSIONS){
  const f=path.join('engines',`${v.ver}.js`);
  const ctx=vm.createContext({window:{}});
  vm.runInContext(fs.readFileSync(f,'utf8'),ctx,{filename:f});
  const m=ctx.window.__ENGINES&&ctx.window.__ENGINES[v.ver];
  const need=['aiChooseLead','aiChooseFollow','aiDeclDecide','scoreDeclOption','aiDiscard'];
  const miss=m?need.filter(k=>typeof m[k]!=='function'):need;
  if(miss.length){ console.log(`✗ ${f} 缺 ${miss.join(',')}`); bad++; continue; }
  if(m.AIP&&'egSearch' in m.AIP) m.AIP.egSearch=0;
  // 加固判定 canReinforce2 是规则,用当前版的
  const old=makeBaseline({...m, canReinforce2:CUR.AI.canReinforce2}, v.ver);
  let illegal=0, decisions=0, rounds=0, dl=0, ms=0;
  for(let s=1;s<=N;s++) for(const oldTeam of [0,1]){
    const r=playMatch(s, seat=>seat%2===oldTeam?old:cur, FB);
    const vo=r.vio[oldTeam];
    illegal+=vo.count; ms+=vo.ms; rounds+=r.rounds;
    dl+=r.levels[oldTeam]-r.levels[1-oldTeam];
    if(vo.count&&illegal===vo.count) console.log('   首条不合法明细:',JSON.stringify(vo.list[0]).slice(0,200));
  }
  const ok=illegal<=rounds;   // 平均每局不到一次
  if(!ok) bad++;
  console.log(`${ok?'✓':'✗'} ${v.ver}  ${N*2} 场 ${rounds} 局:旧 AI 不合法出牌 ${illegal} 次;`+
              `级数差(旧−当前)合计 ${dl>=0?'+':''}${dl};旧 AI 用时 ${(ms/rounds/1000).toFixed(2)} s/局`);
}
process.exit(bad?1:0);
