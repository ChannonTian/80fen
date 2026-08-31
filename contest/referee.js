/* 比赛裁判器 —— 在 node 里完整复刻界面块的一整场对局。
 *
 * 界面块(html 4778~6201)才是唯一跑过完整流程的地方,但它绑在 DOM 和定时器上。
 * 这里把那条流水线抽成同步的纯逻辑:
 *
 *   一场 = 反复打局,直到某队级数打过 A
 *   一局 = 切牌定先 → 逐张发牌(边发边亮主) → 亮主窗口 → 定主
 *          → 低分造反(可能重发) → 拿底扣底 → 25 墩 → 结算 → advanceMatch
 *
 * 和界面块的三处**有意**的差异,都是为了比赛公平:
 *   1) 界面的亮主窗口只给人类,AI 发完最后一张就不再决策。这里给所有座位绕圈,
 *      直到一整圈没人动作(上限 4 圈)—— 否则"最后一张到手才够格亮"永远亮不出来。
 *   2) 界面 aiLowRebel 的循环是 `s=1;s<4`,**跳过座位 0**(那是人类的位置)。
 *      纯 AI 对局里座位 0 也得被问,否则南家永远不造反。
 *   3) 界面的亮主/造反掷骰子(rng 0.9 / 0.45+margin/40 / 0.7)决定 AI 要不要执行
 *      它自己的判断。比赛里这个决定权整个交给参赛者 —— 骰子留在裁判手上,
 *      亮主策略就考不出来了。
 *
 * 裁判只认**牌的 id**。参赛者返回什么形状的对象都无所谓,裁判按 id 去自己那份
 * 手牌里取真牌 —— 于是篡改牌面、伪造牌、返回冻结对象的副本,全都无害。
 */
'use strict';

// 每张非法牌的罚分。一局总共 200 分、80 分上台,所以:偶尔一张 bug 无所谓,
// 规则理解有系统性错误(比如拖拉机跟牌搞反、三成跟牌都错)一局就够输掉。
const RULES_PENALTY_PER_CARD=5;
/* 罚分的效果封顶在「这一局输光」。
 *
 * 不封顶的后果实测过:一个完全不合法的提交一场能被罚一万五千分,把闲家得分推到
 * 极端值,「每局净分」算出 +133 这种物理上不可能的数(牌面上一局总共 200 分,
 * 抠底翻倍另算),
 * 而且**污染跟它打过的所有人的平均分**。
 *
 * 第一版我封的是罚分本身(每队每局最多罚 200),没用 —— 两队各罚 200 仍能让
 * 结算值跑到 [-200, 400]。封在**结果**上才对:闲家最终得分夹回 [0, 200]。
 * 罚到这局输光就够了,再罚没有意义。 */
const ROUND_POINTS_TOTAL=200;

// ---------- 契约违规 ----------
class Violations {
  constructor(){
    this.by={};        // 按种类的**全量**计数
    this.list=[];      // 前 50 条明细,只为了看得见细节
    this.count=0; this.ms=0;
    this.penalties=0;  // 甩牌被罚 —— 规则内的结果,不是违规,单独数
    this.pts=0;        // 因出非法牌被罚掉的分 —— 名义值,不封顶
    this.applied=0;    // 其中**真正生效**的部分(每局封顶在「输光这一局」)
  }
  // 甩牌赌输了。它和"返回了不在手上的牌"完全是两回事:后者是 bug,
  // 前者是策略 —— 甩牌本来就是赌没人吃得下最小的那一组,基线自己也会赌输。
  // 混在违规里报,参赛者会以为自己写错了。
  penalty(){ this.penalties++; }
  // 出非法牌罚分。口径统一成一句话:**裁判替你出了几张牌,就罚几张 × 5 分**。
  // 罚的分记到对方队头上(见 playRound 结尾)。
  fine(n){ const p=RULES_PENALTY_PER_CARD*n; this.pts+=p; return p; }
  // 不涉及出牌、也不一定是 bug 的那些(比如亮主压不过别人 —— 牌是真有,只是不够大)。
  // 记下来给参赛者看,但不计违规数、不罚分。
  soft(kind){ this.by[kind]=(this.by[kind]||0)+1; }
  add(kind, detail){
    this.count++;
    this.by[kind]=(this.by[kind]||0)+1;
    if(this.list.length<50) this.list.push({kind,detail});
  }
  // 早先这里是从 list 里数的 —— onDeal 每局调 100 次,50 条明细瞬间被它占满,
  // 之后 discard/lead/follow 的违规只加 count 不进 list,summary 就看不见了。
  summary(){ return {...this.by}; }
}

// ---------- view 的构造:深拷贝 + 冻结 ----------
// 参赛者拿到的每一张牌都是新对象。他改也只改到自己那份副本,引擎的真牌碰不到。
const cpCard=c=>Object.freeze({suit:c.suit, rank:c.rank, id:c.id});
const cpCards=a=>Object.freeze(a.map(cpCard));
const cpPlays=a=>Object.freeze(a.map(p=>Object.freeze({seat:p.seat, cards:cpCards(p.cards)})));

function freezeView(v){
  for(const k in v){
    const x=v[k];
    if(Array.isArray(x)&&!Object.isFrozen(x)) Object.freeze(x);
  }
  return Object.freeze(v);
}

// ---------- 把参赛者的返回值换回真牌 ----------
// 返回 null 表示这一手不合契约(牌不在手上 / 重复 / 形状不对)。
function resolveCards(ret, hand, vio, kind){
  const cards = Array.isArray(ret) ? ret : (ret && Array.isArray(ret.cards) ? ret.cards : null);
  if(!cards || !cards.length){ vio.add(kind+':形状', String(ret&&ret.constructor&&ret.constructor.name)); return null; }
  const byId=new Map(hand.map(c=>[c.id,c]));
  const out=[], used=new Set();
  for(const c of cards){
    const id = c && typeof c==='object' ? c.id : c;      // 也接受裸 id
    if(!byId.has(id)){ vio.add(kind+':牌不在手上', String(id)); return null; }
    if(used.has(id)){ vio.add(kind+':重复出牌', String(id)); return null; }
    used.add(id); out.push(byId.get(id));
  }
  return out;
}

// 调用参赛者,计时并兜住抛异常
function callAI(fn, thisArg, args, vio, kind){
  const t0=process.hrtime.bigint();
  let ret=null;
  try{ ret=fn.apply(thisArg,args); }
  catch(e){ vio.add(kind+':抛异常', String(e&&e.message).slice(0,120)); ret=null; }
  vio.ms += Number(process.hrtime.bigint()-t0)/1e6;
  return ret;
}

// ---------- 一局 ----------
function playRound(st){
  const {E, M, aiOf, opt, vio} = st;
  const RULES=E.RULES;
  let redealCount=0, scrambleNext=st.scrambleNext;

  for(;;){                                   // 重发就从头再来一局
    const seed=st.nextSeed();
    const dealerKnown = M.dealer>=0 && !scrambleNext;
    scrambleNext=false;
    const first = dealerKnown ? M.dealer : E.cutForFirst(seed).first;
    const deal = E.dealRound(seed, first);
    const hands = deal.hands, kittyOrig = deal.kitty;

    // 无庄盘各家按自己队的级数抢亮,先按先拿牌者的级数起头,谁亮到就换成谁的
    let trumpRank = dealerKnown ? M.levels[M.dealer%2] : M.levels[first%2];
    const rankOf = s => dealerKnown ? trumpRank : M.levels[s%2];

    let decl=null, rebelHappened=false;
    const visCount=[0,0,0,0];
    const visHand=s=>hands[s].slice(0,visCount[s]);

    // 公共局面(亮主阶段能看到的一切)—— 每家都一样,不含任何人的手牌
    const pub=()=>({
      trumpRank, dealerKnown, dealer:M.dealer, firstTaker:first,
      curDecl: decl?Object.freeze({...decl}):null, rebelHappened,
      levels:Object.freeze(M.levels.slice()), played:Object.freeze(M.played.slice()),
      gates:Object.freeze(opt.gates.slice()), round:M.round,
      kittySize:RULES.kittySize,
    });

    // 一次亮主机会:合法就应用,返回是否真的动了
    const tryDecl=(seat)=>{
      const vis=visHand(seat);
      if(!vis.length) return false;
      const view=freezeView({phase:'deal', seat, myTeam:seat%2, hand:cpCards(vis),
        trump:null, declSeat:-1, history:Object.freeze([]), buriedKnown:Object.freeze([]),
        ...pub(), trumpRank:rankOf(seat)});
      const ai=aiOf(seat);
      if(typeof ai.onDeal!=='function') return false;
      const ret=callAI(ai.onDeal, ai, [view], vio[seat%2], 'onDeal');
      if(!ret) return false;
      const opt2={suit: ret.suit===undefined?null:ret.suit, strength: ret.strength|0};
      // 校验:必须是这手牌真拿得出的那几个选项之一
      const cands=[...E.declOptions(vis, rankOf(seat))];
      const jp=E.jokerPairOf(vis); if(jp) cands.push(jp);
      const match=cands.find(o=>o.suit===opt2.suit && o.strength===opt2.strength);
      if(!match){ vio[seat%2].add('onDeal:不是合法选项', JSON.stringify(opt2)); return false; }
      // 加固(单张→一对)走的是另一条路:canOverride 会因为 cur.seat===seat 而拒绝
      const isReinforce = E.canReinforce2(decl, seat, vis, rankOf(seat), rebelHappened)
                          && opt2.suit===decl.suit && opt2.strength===2;
      if(!isReinforce && !E.canOverride(decl, opt2, seat)){
        // 手上确实有这张牌,只是压不过现在的亮主 —— 判断失误,不是 bug,当作没亮。
        vio[seat%2].soft('onDeal:压不过当前亮主'); return false;
      }
      if(!dealerKnown) trumpRank=rankOf(seat);   // 无庄盘:级数跟着亮主者走
      decl={seat, suit:opt2.suit, strength:opt2.strength};
      if(opt2.strength>=3) rebelHappened=true;
      return true;
    };

    // 逐张发牌 100 张,每拿到一张就给那家一次机会
    for(let dealt=0; dealt<100; dealt++){
      const seat=(first+dealt)%4;
      visCount[seat]++;
      tryDecl(seat);
    }
    // 发完的亮主窗口:绕圈直到一整圈没人动作
    for(let lap=0; lap<4; lap++){
      let moved=false;
      for(let i=0;i<4;i++) if(tryDecl((first+i)%4)) moved=true;
      if(!moved) break;
    }

    // ---- 定主 ----
    const trump={suit: decl?decl.suit:null, rank:trumpRank};
    const declSeat=E.dealerAfterDecl({dealerKnown, dealer:M.dealer,
                                      declSeat: decl?decl.seat:-1, firstTaker:first});

    // ---- 低分/少主造反 ----
    if(opt.fullRebel!=='off'){
      let rebelBy=-1;
      for(let i=1;i<=4;i++){                       // 从庄家下家起问一圈,座位 0 也问
        const s=(declSeat+i)%4;
        if(s%2===declSeat%2) continue;             // 只有对方队伍能造反
        const r=E.canFullRebel(hands[s], trump);
        if(!r.ok) continue;
        const ai=aiOf(s);
        if(typeof ai.onRebel!=='function') continue;
        const view=freezeView({phase:'rebel', seat:s, myTeam:s%2, hand:cpCards(hands[s]),
          trump:Object.freeze({...trump}), declSeat, history:Object.freeze([]),
          buriedKnown:Object.freeze([]), ...pub(),
          rebelReason:Object.freeze({pts:r.pts, nT:r.nT, byPts:r.byPts, byTrump:r.byTrump})});
        if(callAI(ai.onRebel, ai, [view], vio[s%2], 'onRebel')===true){ rebelBy=s; break; }
      }
      if(rebelBy>=0 && redealCount<RULES.maxRedeal){
        redealCount++;
        scrambleNext=(opt.fullRebel==='scramble');
        st.redeals++;
        continue;                                   // 重发
      }
    }

    // ---- 拿底扣底 ----
    const pen=[0,0];                      // 两队各被罚掉多少分
    hands[declSeat].push(...kittyOrig);
    let buried=null;
    {
      const ai=aiOf(declSeat);
      const view=freezeView({phase:'discard', seat:declSeat, myTeam:declSeat%2,
        hand:cpCards(hands[declSeat]), trump:Object.freeze({...trump}), declSeat,
        history:Object.freeze([]), buriedKnown:Object.freeze([]), ...pub()});
      const ret=callAI(ai.discard, ai, [view], vio[declSeat%2], 'discard');
      buried=resolveCards(ret, hands[declSeat], vio[declSeat%2], 'discard');
      if(buried && buried.length!==RULES.kittySize){
        vio[declSeat%2].add('discard:张数不对', `${buried.length}≠${RULES.kittySize}`);
        buried=null;
      }
      if(!buried){
        buried=st.fallbackDiscard(hands[declSeat], trump);   // 兜底,局照打
        pen[declSeat%2]+=vio[declSeat%2].fine(RULES.kittySize);
      }
    }
    buried.forEach(c=>E.removeCard(hands[declSeat], c));

    // ---- 出牌 ----
    const declTeam=declSeat%2, history=[];
    let leader=declSeat, defPoints=0, lastWinner=declSeat, lastLeadSize=1, tricks=0;
    const rand=E.rng(seed^0x9e3779b9);      // 只给 genFollow 兜底用
    while(hands.some(h=>h.length)){
      const plays=[];
      for(let i=0;i<4;i++){
        const seat=(leader+i)%4, ai=aiOf(seat), team=seat%2;
        const view=freezeView({phase: i===0?'lead':'follow', seat, myTeam:team,
          hand:cpCards(hands[seat]), trump:Object.freeze({...trump}), declSeat,
          history:cpPlays([...history,...plays]),
          buriedKnown: seat===declSeat?cpCards(buried):Object.freeze([]),
          ...pub(), trickNo:tricks});
        let cards;
        if(i===0){
          const ret=callAI(ai.lead, ai, [view], vio[team], 'lead');
          cards=resolveCards(ret, hands[seat], vio[team], 'lead');
          if(!cards){
            cards=st.fallbackLead(hands[seat], trump, rand);
            pen[team]+=vio[team].fine(cards.length);
          }
          const chk=E.checkThrow(hands, seat, cards, trump);
          if(!chk.ok){ vio[team].penalty(); cards=chk.forced; }
        }else{
          const lead=E.classify(plays[0].cards, trump);
          const ret=callAI(ai.follow, ai, [view, cpPlays(plays)], vio[team], 'follow');
          cards=resolveCards(ret, hands[seat], vio[team], 'follow');
          if(!cards || !E.isLegalFollow(hands[seat], lead, cards, trump)){
            if(cards) vio[team].add('follow:不合法', '');
            cards=E.genFollow(hands[seat], lead, trump, rand);
            pen[team]+=vio[team].fine(cards.length);
          }
        }
        cards.forEach(c=>E.removeCard(hands[seat], c));
        plays.push({seat, cards});
      }
      history.push(...plays);
      lastLeadSize=plays[0].cards.length;
      const res=E.resolveTrick(plays, trump);
      leader=res.winner; lastWinner=res.winner; tricks++;
      if(res.winner%2!==declTeam) defPoints+=res.points;
      if(tricks>60) break;                    // 防死循环
    }

    /* 罚分记到对方队头上。80分里只有闲家有「分」这个量,所以映射成:
     *   庄家方犯规 → 罚分加进闲家的分
     *   闲家犯规   → 从闲家的分里扣(可以扣成负数,那就是庄家大胜)
     */
    const want=defPoints + pen[declTeam] - pen[1-declTeam];
    const penalized=Math.max(0, Math.min(ROUND_POINTS_TOTAL, want));
    /* 真正生效了多少分,回写给挨罚的那一队 —— 报表里要报实际生效的,
     * 不是名义的。两队同时大量犯规时这个归属是近似的,但那种局本来就是废局。 */
    const applied=penalized-defPoints;
    if(applied>0) vio[declTeam].applied+=applied;
    else if(applied<0) vio[1-declTeam].applied+=-applied;
    const sc=E.scoreRound({defPoints:penalized, kitty:buried,
      defWonLastTrick: lastWinner%2!==declTeam, lastLeadSize});
    return {sc, declSeat, declTeam, trump, redealCount, rawDefPoints:defPoints,
            penalty:[pen[0],pen[1]], penaltyApplied:applied,
            defWonLast: lastWinner%2!==declTeam, scrambleNext};
  }
}

// ---------- 一场 ----------
function playMatch(matchSeed, aiOf, o){
  const opt=Object.assign({gates:[2,5,10,13], fullRebel:'scramble',
                           maxRounds:200, engine:null}, o);
  const E=opt.engine;
  const M={levels:[E.RULES.levelStart, E.RULES.levelStart], dealer:-1, round:0,
           played:[-1,-1], past:[]};
  const vio=[new Violations(), new Violations()];
  let counter=0;
  const st={E, M, aiOf, opt, vio, redeals:0, scrambleNext:false,
            nextSeed:()=>((matchSeed*100003 + (counter++)*7919)>>>0),
            fallbackDiscard:opt.fallbackDiscard, fallbackLead:opt.fallbackLead};

  const rounds=[];
  let winnerTeam=null;
  while(M.round<opt.maxRounds){
    const r=playRound(st);
    st.scrambleNext=r.scrambleNext;
    const before=M.levels.slice();
    const adv=E.advanceMatch(M.levels, r.declSeat, r.sc,
                             opt.gates&&opt.gates.length?opt.gates:null, M.played);
    M.levels=adv.levels; M.dealer=adv.dealer; M.round++;
    if(adv.played) M.played=adv.played;
    rounds.push({no:M.round, declSeat:r.declSeat, declTeam:r.declTeam,
                 total:r.sc.total, rawTotal:r.rawDefPoints, penalty:r.penalty,
                 defendersWin:r.sc.defendersWin,
                 before, after:adv.levels.slice(), redeals:r.redealCount});
    if(adv.matchOver){ winnerTeam=adv.winnerTeam; break; }
  }
  // 打满上限还没分出胜负:按级数高者算,仍平则算平
  if(winnerTeam===null)
    winnerTeam = M.levels[0]>M.levels[1] ? 0 : M.levels[1]>M.levels[0] ? 1 : null;

  return {winnerTeam, levels:M.levels.slice(), rounds:M.round, redeals:st.redeals,
          history:rounds, vio};
}

module.exports={playMatch, playRound, Violations, resolveCards, cpCards};
