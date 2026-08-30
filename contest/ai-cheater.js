/* 专门用来打裁判的提交 —— 每一条都在试一种越界。
 * 期望:整场照跑完、违规被逐条记下、对手的成绩不受任何影响。
 * 这不是参赛样板,是 contest/selftest.js 的测试夹具。
 */
'use strict';
module.exports = ({E, AI}) => {
  // ① 污染内建:如果 realm 没隔离开,裁判和对手会跟着炸。
  // 挑 push 而不是 slice —— 投毒 slice 会把这个夹具自己也毒死(它下面要用 slice
  // 切牌),于是 discard/lead/follow 全变成"抛异常",测不到各自那一类违规。
  try{ Array.prototype.push = function(){ throw new Error('投毒'); }; }catch(e){}
  // ② 改引擎常量:如果引擎不是裁判自己那份,合法性判定就被改写了
  try{ E.RULES.kittySize = 99; }catch(e){}

  let n=0;
  const fake = () => ({suit:'S', rank:14, id:9999});     // 根本不存在的牌
  return {
    name: '作弊者(测试夹具)',
    onDeal(view){
      try{ view.hand.push(fake()); }catch(e){}            // ③ 改冻结的 view
      return {suit:'S', strength:2};                      // ④ 无脑亮,多半不合法
    },
    onRebel(){ return true; },
    discard(view){ return view.hand.slice(0, 3); },        // ⑤ 只扣 3 张
    lead(view){
      if(++n % 3 === 0) throw new Error('故意抛');         // ⑥ 抛异常
      return [fake()];                                    // ⑦ 出不存在的牌
    },
    follow(view, plays){
      return view.hand.slice(0, plays[0].cards.length + 1); // ⑧ 张数故意多一张
    },
  };
};
