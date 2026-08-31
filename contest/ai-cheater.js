/* 专门用来打裁判的提交 —— 每一条都在试一种越界。
 * 期望:整场照跑完、违规逐条记下、按张数罚分、对手的成绩不受任何影响。
 * 这不是参赛样板,是 contest/selftest.js 的测试夹具。
 *
 * 注意它的工厂**不收任何参数** —— 参赛者的屋子里什么都没有,
 * 引擎、规则、AI 全得自己写。这个夹具索性一样都不写,专心捣乱。
 */
'use strict';
module.exports = () => {
  // ① 污染内建:如果屋子没隔开,裁判和对手会跟着炸。
  //    挑 push 而不是 slice —— 投毒 slice 会把这个夹具自己也毒死。
  try{ Array.prototype.push = function(){ throw new Error('投毒'); }; }catch(e){}
  // ② 试着摸我们的引擎:空屋里这两条都该摸空
  let peeked=0;
  try{ if(globalThis.module && globalThis.module.exports)
         peeked=Object.keys(globalThis.module.exports).length; }catch(e){}
  try{ if(typeof require==='function') require('fs'); peeked+=1000; }catch(e){}

  let n=0, d=0;
  const fake = () => ({suit:'S', rank:14, id:9999});     // 根本不存在的牌
  return {
    name: '作弊者(测试夹具)',
    peeked,                                              // selftest 会读这个数
    onDeal(view){
      try{ view.hand.push(fake()); }catch(e){}            // ③ 改冻结的 view
      // 一半时候乱亮(测「不合法选项」),一半时候老实亮 —— 得真坐上庄,
      // 扣底那条路径才跑得到,否则 discard 的越界永远测不着。
      if((++d) % 2) return {suit:'S', strength:2};        // ④ 无脑亮,多半不合法
      const c=view.hand.find(x=>x.suit!=='X' && x.rank===view.trumpRank);
      return c ? {suit:c.suit, strength:1} : null;
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
