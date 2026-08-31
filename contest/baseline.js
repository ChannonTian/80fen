/* 基线 AI —— 把现版(v0.7.13)的 AI 忠实包装成参赛接口。
 *
 * 它同时是三样东西:
 *   · 排名的标尺(所有人对它打同一批种子)
 *   · 参赛者的起点(想改进而不是从零写的,直接 fork 这个文件)
 *   · 参赛接口的参考实现
 *
 * 有两处它**没有策略**,是明摆着的可超越点:
 *   1) onRebel —— 界面块里"要不要低分造反"是掷骰子决定的(rand()<0.7),
 *      AI 层从来没有为这件事写过判断。这里只好照抄"够格就反"。
 *   2) onDeal 的执行 —— 界面块在 aiDeclDecide 说 pass 之后还要过一次骰子
 *      (rand() < min(0.95, 0.45+margin/40)),贴着门槛时有一半的时候不亮。
 *      比赛把这个决定权整个交给参赛者,所以这里去掉骰子:说 pass 就亮。
 *      于是基线比产品里的 AI 更爱亮主 —— 这是"考亮主"的必然代价,对所有人一致。
 */
'use strict';

// 参赛者拿到的 view 是冻结的。基线 AI 内部(leadCtx/followCtx)会往 view 上挂字段,
// 冻结对象上的写在非严格模式下静默失败 —— 于是先浅拷一层可写的再传进去。
const thaw = v => Object.assign({}, v);

function makeBaseline(AI, tag){
  return {
    name: tag || '基线 v0.7.13',

    onDeal(view){
      const ctx={
        vis:view.hand, seat:view.seat, trumpRank:view.trumpRank,
        curDecl:view.curDecl, dealerKnown:view.dealerKnown, dealer:view.dealer,
        firstTaker:view.firstTaker, gates:view.gates, levels:view.levels,
      };
      // 加固:当初亮单张是信心不足先试一手,现在牌拿多了信心够不够把它锁死?
      if(AI.canReinforce2(view.curDecl, view.seat, view.hand, view.trumpRank, view.rebelHappened)){
        const asPair  = AI.scoreDeclOption(ctx,{suit:view.curDecl.suit, strength:2}).score;
        const asSingle= AI.scoreDeclOption(ctx,{suit:view.curDecl.suit, strength:1, hasPair:true}).score;
        if(asPair>asSingle) return {suit:view.curDecl.suit, strength:2};
      }
      const d=AI.aiDeclDecide(ctx);
      return (d && d.pass) ? d.opt : null;
    },

    // 见文件头:AI 层对这件事没有判断
    onRebel(view){ return true; },

    discard(view){
      /* gateAhead 修好了。这个开关(AIP.gateDamp,"对手面临必打关卡 → 损失封顶")
       * 在产品里是**死的** —— 全项目只有 aiDiscard 里一处读取,零处传入,
       * 因为界面块调的是 aiDiscard(hand, trump) 两个参数。打级赛制把关卡信息
       * 放进了 view,这里第一次真的传上。 */
      const opp=1-view.myTeam;
      const gateAhead = view.gates.includes(view.levels[opp]);
      return AI.aiDiscard(view.hand.slice(), view.trump, {gateAhead});
    },

    lead(view){ return AI.aiChooseLead(thaw(view)); },
    follow(view, plays){ return AI.aiChooseFollow(thaw(view), plays); },
  };
}

module.exports={makeBaseline};
