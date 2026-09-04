/* 裁判器自测 —— 钉住比赛跑分器自己的不变量。
 *
 *   node contest/selftest.js [build=index.html]
 *
 * 引擎自测(html 块②)管的是规则判定;这里管的是**裁判复刻的那条流水线**:
 * 每墩恰好 4 手、手牌守恒、分数守恒、护栏对作弊真的兜得住。
 */
'use strict';
const {load, freshContext, createRealm, guestRealm}=require('./engine.js');
const {mount, isHouse}=require('./mount.js');
const {playMatch}=require('./referee.js');
const {makeBaseline}=require('./baseline.js');
const vm=require('vm');
const BUILD=process.argv[2]||'index.html';

let pass=0, fail=0;
const ok=(name, cond, note)=>{ cond?pass++:fail++;
  console.log(`  ${cond?'✓':'✗'} ${name}${note&&!cond?`  —— ${note}`:''}`); };

const REF=load(BUILD);
const FB={engine:REF.E,
  fallbackDiscard:(h,t)=>REF.AI.aiDiscard(h,t),
  fallbackLead:(h,t,rd)=>REF.AI.aiLead(h,t,rd)};
const mkBase=()=>{ const r=createRealm(BUILD,'base'); r.AI.AIP.egSearch=0;
                   return r.mount('contest/ai-baseline.js'); };

console.log(`\n裁判器自测 —— ${BUILD}\n`);

// ---------- 1. realm 隔离 ----------
console.log('realm 隔离');
{
  const a=freshContext(), b=freshContext();
  vm.runInContext('Array.prototype.push=function(){throw 0};module.exports=()=>{try{[].push(1);return 1}catch(e){return 0}}',a);
  vm.runInContext('module.exports=()=>{try{[].push(1);return 1}catch(e){return 0}}',b);
  ok('投毒者自己中毒', a.module.exports()===0);
  ok('另一参赛者不受影响', b.module.exports()===1);
  ok('裁判(宿主)不受影响', (()=>{try{[].push(1);return true}catch(e){return false}})());
  const x=createRealm(BUILD), y=createRealm(BUILD);
  x.AI.AIP.egSearch=12345;
  ok('两次 load 的 AIP 互不相干', y.AI.AIP.egSearch!==12345);
  ok('两次 load 的 RULES 是不同对象', x.E.RULES!==y.E.RULES);

  /* 白名单:只有包装我们 AI 的那两个走 house 屋子。
   * league.js 和 run.js 早先各写各的装载逻辑,run.js 那份把**所有**提交都装进
   * house 屋子 —— 同一份提交在联赛和单对详跑里跑出不同结果。现在都走 mount.js。 */
  ok('陪练在白名单里', isHouse('contest/ai-baseline.js') && isHouse('./contest/ai-baseline.js'));
  ok('发给参赛者的模板不在白名单里', !isHouse('contest/public/example/index.js'));
  ok('我们自己的测试夹具也不在白名单里', !isHouse('contest/ai-cheater.js'));
  // 空屋装出来的作弊者摸不到引擎 —— 摸到了它会把数字报回来
  const probe=mount('contest/ai-cheater.js','probe',BUILD,false);
  ok('mount() 给非白名单的是空屋', probe.peeked===0, `peeked=${probe.peeked}`);
  ok('mount() 给白名单的是 house 屋子', typeof mount('contest/ai-baseline.js','probe2',BUILD,false).onDeal==='function');
}

// ---------- 2. 一场基线自对局的结构不变量 ----------
console.log('\n对局流水线');
{
  const A=mkBase(), B=mkBase();
  const r=playMatch(7, s=>s%2===0?A:B, FB);
  ok('整场跑完并分出胜负', r.winnerTeam===0||r.winnerTeam===1, `winnerTeam=${r.winnerTeam}`);
  ok('赢家级数打过 A', r.levels[r.winnerTeam]>14, JSON.stringify(r.levels));
  ok('局数在合理范围(5~120)', r.rounds>=5&&r.rounds<=120, `${r.rounds} 局`);
  ok('基线零违规', r.vio[0].count===0&&r.vio[1].count===0,
     JSON.stringify([r.vio[0].summary(), r.vio[1].summary()]));
  const bad=r.history.filter(h=>h.total<0||h.total>200);
  ok('每局闲家得分都在 0~200', bad.length===0, JSON.stringify(bad.slice(0,2)));
  const jump=r.history.filter(h=>h.after[0]<h.before[0]||h.after[1]<h.before[1]);
  ok('级数只涨不跌', jump.length===0, JSON.stringify(jump.slice(0,2)));
  const gate=r.history.filter(h=>{
    for(const t of [0,1]) if(h.after[t]>h.before[t]){
      for(const g of [2,5,10,13]) if(g>h.before[t]&&g<h.after[t]) return true;   // 跨过关卡
    } return false; });
  ok('升级不跨过必打关卡', gate.length===0, JSON.stringify(gate.slice(0,2)));
}

// ---------- 3. 护栏:作弊者打不穿 ----------
console.log('\n护栏(对手是 contest/ai-cheater.js)');
{
  // 参赛者走**空屋**:一行我们的代码都不加载
  const cheat=guestRealm('cheat').mount('contest/ai-cheater.js');
  const base=mkBase();
  let r=null, threw=null;
  try{ r=playMatch(11, s=>s%2===0?cheat:base, FB); }catch(e){ threw=e; }
  ok('整场没有被作弊者搞崩', !threw, threw&&threw.message);
  if(r){
    ok('作弊者的违规被记下来了', r.vio[0].count>0, `count=${r.vio[0].count}`);
    ok('对手一条违规都没有', r.vio[1].count===0, JSON.stringify(r.vio[1].summary()));
    const kinds=Object.keys(r.vio[0].summary());
    for(const k of ['onDeal:不是合法选项','lead:抛异常',
                    'lead:牌不在手上','follow:不合法'])
      ok(`记到了「${k}」`, kinds.includes(k), `实际: ${kinds.join(' / ')}`);
    ok('整场照样分出胜负', r.winnerTeam===0||r.winnerTeam===1);
    ok('罚分记到了作弊者头上', r.vio[0].pts>0, `pts=${r.vio[0].pts}`);
    ok('对手一分没被罚', r.vio[1].pts===0, `pts=${r.vio[1].pts}`);
    // 罚分必须真的改变了结算,而不是只记个数
    const moved=r.history.filter(h=>h.total!==h.rawTotal);
    ok('罚分真的进了每局结算', moved.length>0,
       `${moved.length}/${r.history.length} 局的最终分与原始分不同`);
    const p=r.history.find(h=>h.penalty[0]>0);
    ok('罚分按「替出几张 × 5」算', !p||p.penalty[0]%5===0, p&&JSON.stringify(p.penalty));
  }
  ok('作弊者在空屋里摸不到我们的引擎', cheat.peeked===0, `peeked=${cheat.peeked}`);

  /* 扣底那条路径要它**坐上庄**才跑得到,而作弊者跟基线打是一局都上不了台的
   * (实测 8 局庄家全在对家那两个座位)。让它跟自己打 —— 那就必然有人坐庄。 */
  const cheat2=guestRealm('cheat2').mount('contest/ai-cheater.js');
  let r2=null; try{ r2=playMatch(13, s=>s%2===0?cheat:cheat2, FB); }catch(e){}
  ok('作弊者自己打自己也不崩', !!r2);
  if(r2){
    const kinds2=[...Object.keys(r2.vio[0].summary()), ...Object.keys(r2.vio[1].summary())];
    ok('记到了「discard:张数不对」', kinds2.includes('discard:张数不对'), kinds2.join(' / '));
    ok('扣底违规也罚了分', r2.vio[0].pts>0||r2.vio[1].pts>0);
  }
  ok('裁判的 kittySize 没被改掉', REF.E.RULES.kittySize===8, `=${REF.E.RULES.kittySize}`);
  ok('裁判的 Array.prototype.slice 完好', typeof [].slice==='function'&&[1,2].slice(1)[0]===2);
  // 作弊者投毒之后,新开一个基线仍然正常
  const fresh=mkBase();
  let ok2=true; try{ playMatch(12, ()=>fresh, FB); }catch(e){ ok2=false; }
  ok('投毒后新开的对局仍正常', ok2);
}

console.log(`\n通过 ${pass} 项,失败 ${fail} 项\n`);
process.exit(fail?1:0);
