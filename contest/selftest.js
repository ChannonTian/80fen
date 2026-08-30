/* 裁判器自测 —— 钉住比赛跑分器自己的不变量。
 *
 *   node contest/selftest.js [build=index.html]
 *
 * 引擎自测(html 块②)管的是规则判定;这里管的是**裁判复刻的那条流水线**:
 * 每墩恰好 4 手、手牌守恒、分数守恒、护栏对作弊真的兜得住。
 */
'use strict';
const {load, freshContext, createRealm}=require('./engine.js');
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
  // 关键:提交本身也在 realm 里加载 —— 用宿主 require 的话下面这几条会全红
  const cheat=(()=>{ const r=createRealm(BUILD,'cheat'); r.AI.AIP.egSearch=0;
    return r.mount('contest/ai-cheater.js'); })();
  const base=mkBase();
  let r=null, threw=null;
  try{ r=playMatch(11, s=>s%2===0?cheat:base, FB); }catch(e){ threw=e; }
  ok('整场没有被作弊者搞崩', !threw, threw&&threw.message);
  if(r){
    ok('作弊者的违规被记下来了', r.vio[0].count>0, `count=${r.vio[0].count}`);
    ok('对手一条违规都没有', r.vio[1].count===0, JSON.stringify(r.vio[1].summary()));
    const kinds=Object.keys(r.vio[0].summary());
    for(const k of ['onDeal:不是合法选项','discard:张数不对','lead:抛异常',
                    'lead:牌不在手上','follow:不合法'])
      ok(`记到了「${k}」`, kinds.includes(k), `实际: ${kinds.join(' / ')}`);
    ok('整场照样分出胜负', r.winnerTeam===0||r.winnerTeam===1);
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
