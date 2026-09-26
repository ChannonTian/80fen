/* 80分 v0.7.0 的 AI 引擎(0.7 系列第一版(含 0.6.x 全部改动 + 收官蒙特卡洛))。
 * 由 engines/build.js 从 5c8c643:index.html 的块① 原样生成,不要手改。 */
(function(){
var module={exports:{}};

/* ============================================================
 * 80分 游戏引擎 —— 纯函数,不碰 DOM。
 * trump = {suit:'S'|'H'|'D'|'C'|null, rank}。suit 为 null 表示无主。
 * ============================================================ */

const RULES = {
  levelStart: 2,
  handSize: 25,
  kittySize: 8,
  // 抠底倍数 = 最后一墩每人出牌数 × 2
  kittyMultiplier: (lastLeadSize)=>2*(lastLeadSize||1),
  offsuitRankTractor: true,     // 主AA+副常主对可连(常驻)
  strictTractorFollow: true,    // 领出拖拉机、手中有同长(或更长可拆)拖拉机必须跟
  partialTractorFollow: true,   // 【可调】领出长拖拉机、手中只有更短拖拉机时必须跟出短的(默认开)
  pointRebelThreshold: 15,      // 【可调】手牌分数 ≤ 此值可完全造反(5的倍数,≤30;0=关闭)
  trumpRebelThreshold: 3,       // 【可调】手牌主牌张数 ≤ 此值也可完全造反(-1=关闭)
  maxRedeal: 3,                 // 同一局最多连续重新发牌次数(防止一直重发)
};

const SUITS = ['S','H','D','C'];

function makeDeck(){                      // 两副牌 108 张,id 唯一
  const cards=[]; let id=0;
  for(let copy=0;copy<2;copy++){
    for(const s of SUITS) for(let r=2;r<=14;r++) cards.push({suit:s,rank:r,id:id++});
    cards.push({suit:'X',rank:15,id:id++});   // 小王
    cards.push({suit:'X',rank:16,id:id++});   // 大王
  }
  return cards;
}

function cardPoints(c){ return c.rank===5?5 : (c.rank===10||c.rank===13)?10 : 0; }
function countPoints(cards){ return cards.reduce((a,c)=>a+cardPoints(c),0); }

function rng(seed){ let a=seed>>>0; return function(){ a|=0; a=(a+0x6D2B79F5)|0;
  let t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t;
  return ((t^(t>>>14))>>>0)/4294967296; }; }

function shuffle(arr, rand){ const a=arr.slice();
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(rand()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a; }

// 切牌定先:各抽一张按自然大小(无级数,A>K>…>2,王最大;平手按黑桃>红桃>梅花>方块)
function cutForFirst(seed){
  const deck=shuffle(makeDeck(), rng(seed*7+3));
  const cuts=[0,1,2,3].map(s=>deck[s]);
  const sv={S:3,H:2,C:1,D:0,X:4};
  let first=0;
  for(let s=1;s<4;s++){
    const a=cuts[s],b=cuts[first];
    if(a.rank>b.rank||(a.rank===b.rank&&sv[a.suit]>sv[b.suit])) first=s;
  }
  return {cuts, first};
}

// firstTaker 先拿牌,逆时针轮流;前 100 张为手牌,后 8 张为底
function dealRound(seed, firstTaker=0){
  const deck=shuffle(makeDeck(), rng(seed));
  const hands=[[],[],[],[]];
  for(let i=0;i<100;i++) hands[(firstTaker+i)%4].push(deck[i]);
  return {hands, kitty:deck.slice(100), deck};
}

// ---- 主牌与大小序 ----
function effSuit(c, trump){
  if(c.suit==='X' || c.rank===trump.rank) return 'T';
  if(trump.suit && c.suit===trump.suit) return 'T';
  return c.suit;
}

function natOrder(trumpRank){ const r=[]; for(let x=2;x<=14;x++) if(x!==trumpRank) r.push(x); return r; }

// 有主:0..11 主花色散牌,12 副常主,13 正常主,14 小王,15 大王。
// 相邻可连:主A+副常、副常+正常、正常+小王、小王+大王;异花副常同级不连。
// 无主:13 常主(各花色同级),14 小王,15 大王。
function ordIdx(c, trump){
  if(c.rank===16) return 15;
  if(c.rank===15) return 14;
  if(c.rank===trump.rank){
    if(!trump.suit) return 13;
    return c.suit===trump.suit?13:12;
  }
  return natOrder(trump.rank).indexOf(c.rank);
}

// ---- 牌型判定 ----
function pairKey(c){ return c.suit+':'+c.rank; }

function decompose(cards, trump){
  const by={};
  for(const c of cards)(by[pairKey(c)]=by[pairKey(c)]||[]).push(c);
  const pairs=[], singles=[];
  for(const k in by){
    const arr=by[k];
    if(arr.length>=2) pairs.push([arr[0],arr[1]]);
    if(arr.length%2===1) singles.push(arr[arr.length-1]);
  }
  pairs.sort((a,b)=>ordIdx(a[0],trump)-ordIdx(b[0],trump));
  const comps=[]; let run=[];
  const flush=()=>{
    if(!run.length) return;
    if(run.length>=2) comps.push({type:'tractor',len:run.length,cards:run.flat(),
                                  top:ordIdx(run[run.length-1][0],trump)});
    else comps.push({type:'pair',cards:run[0],top:ordIdx(run[0][0],trump)});
    run=[];
  };
  for(const p of pairs){
    if(run.length && ordIdx(p[0],trump)===ordIdx(run[run.length-1][0],trump)+1) run.push(p);
    else { flush(); run=[p]; }
  }
  flush();
  for(const s of singles) comps.push({type:'single',cards:[s],top:ordIdx(s,trump)});
  return comps;
}

function classify(cards, trump){
  if(!cards||!cards.length) return null;
  const es=effSuit(cards[0],trump);
  if(!cards.every(c=>effSuit(c,trump)===es)) return null;
  if(cards.length===1) return {type:'single',suit:es,top:ordIdx(cards[0],trump),cards};
  const comps=decompose(cards,trump);
  if(comps.length===1){ const c=comps[0]; return {type:c.type,len:c.len,suit:es,top:c.top,cards}; }
  return {type:'throw',suit:es,cards,comps,top:Math.max(...comps.map(c=>c.top))};
}

// ---- 跟牌合法性(门内有对必对) ----
function countPairsIn(cards){
  const by={}; for(const c of cards) by[pairKey(c)]=(by[pairKey(c)]||0)+1;
  return Object.values(by).reduce((a,n)=>a+Math.floor(n/2),0);
}
function maxTractorLen(cards, trump){
  return Math.max(0,...decompose(cards,trump).filter(c=>c.type==='tractor').map(c=>c.len));
}
function pairsInLead(lead){
  if(lead.type==='pair') return 1;
  if(lead.type==='tractor') return lead.len;
  if(lead.type==='throw') return lead.comps.reduce((a,c)=>a+(c.type==='pair'?1:c.type==='tractor'?c.len:0),0);
  return 0;
}

function isLegalFollow(hand, lead, chosen, trump){
  const n=lead.cards.length;
  if(chosen.length!==n) return false;
  const ids=new Set(hand.map(c=>c.id));
  const seen=new Set();
  for(const c of chosen){ if(!ids.has(c.id)||seen.has(c.id)) return false; seen.add(c.id); }
  const suitInHand=hand.filter(c=>effSuit(c,trump)===lead.suit);
  const chosenInSuit=chosen.filter(c=>effSuit(c,trump)===lead.suit);
  if(chosenInSuit.length!==Math.min(n,suitInHand.length)) return false;
  const need=pairsInLead(lead);
  if(need>0){
    const must=Math.min(need,countPairsIn(suitInHand));
    if(countPairsIn(chosenInSuit)<must) return false;
  }
  if(RULES.strictTractorFollow && lead.type==='tractor'){
    const m=maxTractorLen(suitInHand,trump);
    const cm=maxTractorLen(chosenInSuit,trump);
    if(m>=lead.len && cm<lead.len) return false;                    // 有长必跟(可拆子拖拉机)
    if(RULES.partialTractorFollow && m>=2 && m<lead.len && cm<m) return false; // 【可调】短拖也必须跟
  }
  return true;
}

// ---- 一墩胜负 ----
function structSig(comps){ return comps.map(c=>c.type+(c.len||'')).sort().join(','); }
function structMatches(cand, lead){
  const a=cand.type==='throw'?cand.comps:[cand];
  const b=lead.type==='throw'?lead.comps:[lead];
  return structSig(a)===structSig(b);
}

function resolveTrick(plays, trump){
  const lead=classify(plays[0].cards,trump);
  let winIdx=0, best=lead;
  for(let i=1;i<plays.length;i++){
    const cl=classify(plays[i].cards,trump);
    if(!cl || !structMatches(cl,lead)) continue;
    if(cl.suit===best.suit){ if(cl.top>best.top){winIdx=i;best=cl;} }
    else if(cl.suit==='T'){ winIdx=i; best=cl; }
  }
  return {winner:plays[winIdx].seat,
          points:countPoints(plays.flatMap(p=>p.cards)),
          winningPlay:best};
}

// ---- 甩牌校验(失败仅强制出小,不罚分) ----
function canBeatComp(suitCards, comp, trump){
  if(comp.type==='single') return suitCards.some(c=>ordIdx(c,trump)>comp.top);
  const comps=decompose(suitCards,trump);
  if(comp.type==='pair')
    return comps.some(c=>(c.type==='pair'||c.type==='tractor')&&c.top>comp.top);
  return comps.some(c=>c.type==='tractor'&&c.len>=comp.len&&c.top>comp.top);
}
function checkThrow(hands, seat, cards, trump){
  const lead=classify(cards,trump);
  if(!lead||lead.type!=='throw') return {ok:true};
  for(const comp of lead.comps){
    for(let p=0;p<4;p++){
      if(p===seat) continue;
      const sc=hands[p].filter(c=>effSuit(c,trump)===lead.suit);
      if(canBeatComp(sc,comp,trump)){
        const lowest=lead.comps.reduce((a,c)=>c.top<a.top?c:a);
        return {ok:false, forced:lowest.cards};
      }
    }
  }
  return {ok:true};
}

// ---- 亮主/反主/造反/加固 ----
// strength: 1=单张常主,2=一对常主,3=小王对,4=大王对(王对→无主)。
function declarationOf(cards, trumpRank){
  if(cards.length===1 && cards[0].rank===trumpRank) return {suit:cards[0].suit,strength:1};
  if(cards.length===2 && pairKey(cards[0])===pairKey(cards[1])){
    if(cards[0].rank===trumpRank) return {suit:cards[0].suit,strength:2};
    if(cards[0].rank===15) return {suit:null,strength:3};
    if(cards[0].rank===16) return {suit:null,strength:4};
  }
  return null;
}
// 反主:强度必须更高。**同一个人不能反自己** —— 他想加强只有「加固」这一条路
// (同花色单张→一对,见 canReinforce2);改花色、或用王对把自己的主反成无将,
// 都不是加固而是自己打乱自己。旧版这里只比 strength、不看座位,而 aiDeclDecide
// 拿它当唯一的合法性闸门,于是 AI 真的会反自己(实测:自己亮♠单张后,
// 改亮♥对 / 小王对 / 大王对三种都返回 true),对应的惩罚却只有 −9 分,压不住无将的抢摊红利。
function canOverride(cur, next, seat){
  if(!cur) return true;
  if(next.strength<=cur.strength) return false;
  if(seat!==undefined && cur.seat===seat) return false;
  return true;
}
// 有对并非必亮对 —— 亮单与亮对是两个不同的选择,都要交给打分:
//   亮单:不暴露这一对,更容易被别家一对常主反掉,但保留了「加固」这条后路;
//   亮对:除大小王对外无人能反,但把一对牌明明白白摊给对手看。
// 实战里,对该门作主信心不足却想试一手、或扰乱对手的动机大过手牌本身好坏时,会选亮单。
function declOptions(hand, trumpRank){
  const opts=[];
  for(const s of SUITS){
    const n=hand.filter(c=>c.suit===s&&c.rank===trumpRank).length;
    if(n>=2){ opts.push({suit:s,strength:2}); opts.push({suit:s,strength:1,hasPair:true}); }
    else if(n===1) opts.push({suit:s,strength:1});
  }
  return opts.sort((a,b)=>b.strength-a.strength);
}
function jokerPairOf(hand){
  const bj=hand.filter(c=>c.rank===16).length, sj=hand.filter(c=>c.rank===15).length;
  if(bj>=2) return {suit:null,strength:4};
  if(sj>=2) return {suit:null,strength:3};
  return null;
}
// 定主后谁坐庄。庄定盘:庄家恒不变 —— 亮主/反主/王对造反都只改主色,不易庄不拿底;
// 无庄盘(首局、或完全造反后的抢庄盘):最终亮主者坐庄,无人亮主则先拿牌者坐庄。
function dealerAfterDecl({dealerKnown, dealer, declSeat, firstTaker}){
  if(dealerKnown) return dealer;
  return declSeat>=0?declSeat:firstTaker;
}

// 加固:仅亮主者本人、单张→一对、且必须先于任何造反(王对/低分造反)
function canReinforce2(decl, seat, hand, trumpRank, rebelHappened){
  if(!decl||decl.seat!==seat||decl.strength!==1||rebelHappened||decl.suit===null) return false;
  return hand.filter(c=>c.suit===decl.suit&&c.rank===trumpRank).length>=2;
}

// 完全造反资格:手牌分数 ≤ pointRebelThreshold,或主牌张数 ≤ trumpRebelThreshold
function canFullRebel(hand, trump){
  const p=RULES.pointRebelThreshold, t=RULES.trumpRebelThreshold;
  const pts=countPoints(hand);
  const nT=hand.filter(c=>effSuit(c,trump)==='T').length;
  const byPts=p>0&&pts<=p, byTrump=t>=0&&nT<=t;
  return {ok:byPts||byTrump, pts, nT, byPts, byTrump};
}

// ---- 本局结算 ----
function scoreRound({defPoints, kitty, defWonLastTrick, lastLeadSize}){
  const kittyPts=countPoints(kitty);
  const mult=RULES.kittyMultiplier(lastLeadSize);
  const total=defPoints + (defWonLastTrick ? kittyPts*mult : 0);
  if(total<80){
    return {defendersWin:false, total, kittyPts, mult, declarerLevelsUp: total===0?3 : total<40?2 : 1};
  }
  return {defendersWin:true, total, kittyPts, mult, defenderLevelsUp: Math.floor((total-80)/40)};
}

// ---- 整场推进:升级与庄家轮换 ----
// 庄家方守住 → 升级、前庄对家连庄;闲家上台 → 闲家升级、前庄下家坐庄。
// 任一队级数打过 A(>14)整场获胜。
// 必打关卡有两层,旧版只做了第一层:
//   1) **不可跳级**:升级途中跨过关卡就停在关卡上(打3升3级本应到6,5是关卡则停在5)。
//   2) **必须打过**:过这一关的条件是本队在该级**坐过庄**。
// 第二层原来是缺的,而且缺得不显眼:旧注释写「落点正好等于关卡不算跳过 ——
// 那本来就要在该级打一局」,这句话对庄家成立、对闲家不成立 ——
// 一局打的是**庄家方**的级数,所以一支队停在 2 上当闲家、上台升一级,
// 是从没打过这一关就过去了(实战报障:闲家本级 2,抢到 150 分直接打 3)。
function clampAtGate(from, to, gates){
  if(!gates||!gates.length||to<=from) return {level:to, gate:null};
  const hit=gates.filter(g=>g>from&&g<to).sort((a,b)=>a-b)[0];
  return hit===undefined?{level:to, gate:null}:{level:hit, gate:hit};
}

/* played[team] = 该队已经**坐庄打过**的最高级数(没有则 -1)。
 * 传 null / 不传 = 只做第一层(不可跳级),用于旧调用方与消融。
 * 返回值里带上更新后的 played,调用方存回去即可 —— 引擎自己不留状态。 */
function advanceMatch(levels, declSeat, sc, gates, played){
  const declTeam=declSeat%2;
  const L=levels.slice();
  // 本局是庄家方按**自己的**级数在打,这一局本身就是他们「打过」这一级的证据
  const pl=played?played.slice():null;
  if(pl) pl[declTeam]=Math.max(pl[declTeam],L[declTeam]);
  let dealer, up, team;
  if(!sc.defendersWin){ team=declTeam; up=sc.declarerLevelsUp; dealer=(declSeat+2)%4; }
  else { team=1-declTeam; up=sc.defenderLevelsUp; dealer=(declSeat+1)%4; }
  const c=clampAtGate(L[team], L[team]+up, gates);
  let level=c.level, gateStopped=c.gate, gateHeld=null;
  // 停在关卡上、却没在这一级坐过庄 → 原地不动。
  // 不会卡死:升级的这一方下一局必坐庄(守住是对家连庄、上台是自己坐庄),
  // 也就是下一局一定会补上这一关。
  if(gates&&gates.length&&pl&&up>0&&gates.includes(L[team])&&pl[team]<L[team]){
    level=L[team]; gateStopped=null; gateHeld=L[team];
  }
  L[team]=level;
  const matchOver=L[0]>14||L[1]>14;
  return {levels:L, dealer, matchOver, winnerTeam:matchOver?(L[0]>14?0:1):null,
          gateStopped,        // 非 null = 跳级被关卡拦下,停在关卡上
          gateHeld,           // 非 null = 卡在这一关上,因为本队还没坐庄打过它
          played:pl};
}

/* ---- 随机合法 AI(M3 换启发式) ---- */
function removeCard(hand,c){ const i=hand.findIndex(x=>x.id===c.id); hand.splice(i,1); }
function pickRandom(arr,k,rand){ return shuffle(arr,rand).slice(0,k); }

function aiLead(hand, trump, rand){
  if(rand()<0.3){
    const bySuit={};
    hand.forEach(c=>{(bySuit[effSuit(c,trump)]=bySuit[effSuit(c,trump)]||[]).push(c);});
    const pairs=[];
    for(const s in bySuit) decompose(bySuit[s],trump).forEach(c=>{
      if(c.type==='pair') pairs.push(c.cards);
      if(c.type==='tractor') for(let i=0;i<c.len;i++) pairs.push(c.cards.slice(i*2,i*2+2));
    });
    if(pairs.length) return pairs[Math.floor(rand()*pairs.length)];
  }
  return [hand[Math.floor(rand()*hand.length)]];
}

function bruteFollow(hand, lead, trump, rand){
  const n=lead.cards.length;
  for(let t=0;t<300;t++){
    const c=pickRandom(hand,n,rand);
    if(isLegalFollow(hand,lead,c,trump)) return c;
  }
  return hand.slice(0,n);
}

function genFollow(hand, lead, trump, rand){
  const n=lead.cards.length;
  const inSuit=hand.filter(c=>effSuit(c,trump)===lead.suit);
  const rest=hand.filter(c=>effSuit(c,trump)!==lead.suit);
  let chosen=[];
  if(inSuit.length<=n){
    chosen=[...inSuit, ...pickRandom(rest,n-inSuit.length,rand)];
  }else{
    const comps=decompose(inSuit,trump);
    if(RULES.strictTractorFollow && lead.type==='tractor'){
      const full=comps.find(c=>c.type==='tractor'&&c.len>=lead.len);
      if(full) chosen=full.cards.slice(0,lead.len*2);
      else if(RULES.partialTractorFollow){
        const part=comps.filter(c=>c.type==='tractor').sort((a,b)=>b.len-a.len)[0];
        if(part) chosen=part.cards.slice();
      }
    }
    const targetPairs=Math.min(pairsInLead(lead),countPairsIn(inSuit));
    if(targetPairs>0){
      const used=new Set(chosen.map(c=>c.id));
      const pairUnits=[];
      comps.forEach(c=>{
        if(c.type==='pair') pairUnits.push(c.cards);
        if(c.type==='tractor') for(let i=0;i<c.len;i++) pairUnits.push(c.cards.slice(i*2,i*2+2));
      });
      let have=Math.floor(chosen.length/2);
      for(const u of pairUnits){
        if(have>=targetPairs||chosen.length+2>n) break;
        if(u.some(c=>used.has(c.id))) continue;
        u.forEach(c=>used.add(c.id));
        chosen.push(...u); have++;
      }
    }
    const used2=new Set(chosen.map(c=>c.id));
    chosen.push(...pickRandom(inSuit.filter(c=>!used2.has(c.id)),n-chosen.length,rand));
  }
  return isLegalFollow(hand,lead,chosen,trump)?chosen:bruteFollow(hand,lead,trump,rand);
}

/* ============================================================
 * v3 公共标尺 —— 三个阶段(亮主/扣底/出牌)共用的基础量。
 * 一切分值都尽量折算成「分」(5/10/K 的那个分),这样期望收益与
 * 机会成本能直接相减,而不是靠一堆不同量纲的魔法数打架。
 * ============================================================ */

const AIP = {                 // v3 可调参数,全部集中在这里便于调参
  voidValue: 68,              // 完全断门的战略价值(折算成分;扫参在 62~100 区间是平的,取低端)
  voidChainCredit: 0.55,      // 靠稳赢牌保住牌权再断门的折价(笔记里的「视为50%」)
  buryTrumpBlock: 400,        // 主牌埋底的硬性阻力
  buryAceBlock: 200,          // 副花色 A 埋底的硬性阻力(见 faceValue;旧版是 +30,会被断门收益压过)
  /* 对子/拖拉机被压的概率单独按组合算(见 pBeaterIn)。pairUrn=0 退回旧的单张公式。 */
  pairUrn: 1,
  tractorTighten: 0.6,        // 拖拉机还要求连着,在 p^need 之上再收一道
  /* 「在外还有更大的对子」的概率低于这个值,就把自己的对子当钢板(见 pPairAbove)。
   * 0 = 退回旧版那个「只要还有两张没见就算对手有对」的布尔判据。
   *
   * **扫参的坡顶在 0.25~0.35(样本外 0.30 → +1.48 分/局, t=2.0),这里故意不取。**
   * isBossPlay 的语义是「钢板」,护底 / 甩牌 / 领出三处都拿它当**确定性**用;
   * 0.30 会把「对手有对的概率 26%」、也就是只有 74% 胜率的对子标成钢板 ——
   * 那是 endKittyWeight 那次的同款错误:让一个数值去买它语义上不该买的东西。
   * 0.15 的口径是「≥85% 才叫钢板」,实测 +0.17(SE 0.46),无害。
   * 那 1.5 分的正确取法是把 pPairAbove 当**连续概率**接进打分,而不是放宽布尔阈值。 */
  pairBossMaxP: 0.15,
  kittyMult: 2,               // 抠底倍数的估计值(按最后一墩单张算)
  kittyPointBias: 0.8,        // 闲家倒推底分时的折扣(庄家倾向不埋分)
  jokerPairHold: 7,           // 王对的**成对溢价**(单张的压制价值已在 trumpHold 里,别算两遍)
  jokerPairDecl: 5,           // 庄家方护底的额外溢价
  trumpHoldBase: 2.5,         // 一张主牌的留手底价
  trumpHoldTop: 14,           // 「在外已无更大」时额外的留手价值(相对刻度,见 trumpHold)
  gateDamp: 0.6,              // 对手面临必打关卡时,丢分损失的封顶折减
  /* 钢板领出的基础分(v4:原 56 里有一截其实是「拿住牌权」,
   * 已改由 leadTempo 按手上剩余待兑现单元算出来,基础分相应下调)。
   * v0.6.0 重标定:非钢板那一支在 v0.5.8 换成真实期望分之后,两支的量纲第一次可比,
   * 40 就显得偏高了。坐标扫参(配对差,400 种子 × 交换阵营):
   *     46 → −0.83 ±0.36    40 → 基准    34 → **+0.41 ±0.38**    28 → +0.04    22 → +0.30
   * 取 34。注意它仍然不是「真实的分」—— 见 AI-DESIGN §7 那一行,
   * 要彻底摆正得把钢板支也拆成 p·Gain −(1−p)·Loss。 */
  bossBase: 34,
  /* ========== v0.6.1 ========== */
  /* 「领一轮主牌,队友也被迫跟出一张」的代价 —— 把 v0.6.0 查出来的那条先验
   * 从 drawTrumpValue 的符号偏差里拿出来,写成显式项。
   * **默认 0 —— 配对对照 −0.19 ±0.80,没挣到分。**
   * 它不是错的(丢最后一墩 29.3% → 28.8% 略好),只是显式化之后
   * 强度、形状、豁免条件三样都得重新标定,而这一轮标定没跑出正收益。
   * 代码和判据留着:它比藏在符号里清楚得多,下一次连 leadWeakTrump 一起动时从这里接。 */
  trumpLeadPrior: 0,
  dtNegDamp: 0.5,             // 先验显式化之后,dt 负半边保留多少(它现在只表达「主牌不占优」)
  /* 钢板领出也走统一期望分口径,让 bossBase 退休。
   * **默认 0 —— 能做到打平,做不到更好,而那个常数没能真的消失。**
   * 扫参(配对差,相对 v0.6.0):
   *     bossShapeBonus  6 → −1.14      14 → −0.28      **22 → −0.04**(丢最后一墩 27.3%)
   *     22 + futLeadCashDamp .15 + leadTempoWeight 1.4 → −0.00
   * 也就是说:统一之后要靠一个 22 分的常数才能回到原位 —— 那不过是 bossBase 换了个名字。
   * 说明这个常数**扛着 EV 模型没表达出来的真东西**(多半是「保住牌权把整串钢板依次兑现」
   * 这件事的复利,leadTempo 的贴现和只算了一层)。真正的解法是把 tempo 做成多墩推演,
   * 不是把常数搬家。想在线上 A/B:`leadEV2:1, bossShapeBonus:22` 这一档是打平的,
   * 而且「庄家丢最后一墩」比默认档好 2 个百分点。 */
  leadEV2: 0,
  futLeadCashDamp: 0.35,      // 副牌钢板领出时机会成本的折扣:它的未来价值本来就是「以后领出去收分」
  bossShapeBonus: 22,         // 配套 leadEV2=1 时的取值(扫参最优);leadEV2=0 时不生效

  /* ========== v0.7.0:收官蒙特卡洛(endgameSearch) ========== */
  egSearch: 1,                // 总开关
  egMaxCards: 5,              // 剩几张牌起用搜索(状态空间要足够小)
  /* 每次决策抽多少个世界。扫参(配对差,相对 eg 关闭,350 种子 × 交换阵营):
   *     30 样本 → +1.21 ±0.52     **60 样本 → +1.46 ±0.52**
   *     60 样本 + 从 6 张起搜 → +1.17 ±0.62(更贵却更差,状态空间大了样本就不够用)
   * 取 60/5 张。约 400ms/局,界面无感(本来就有 1~3 秒思考延迟)。 */
  egSamples: 60,
  egMinSamples: 20,           // 抽不满这么多就退回启发式(约束太紧,样本不可信)
  egRetries: 24,              // 单个世界的重试次数
  egMaxCands: 6,              // 候选多于这个数就不搜(预算)
  /* 搜索结果与启发式打分的融合方式。
   * 目标函数是「我方净升几级」,量纲和分制完全不同,不能直接相加 ——
   * 用它**排序**,只有当最优候选比启发式选中的那个高出 egMargin 级时才改判。
   * 这样保留启发式在样本噪声区的判断,只在搜索有明确意见时接管。 */
  egMargin: 0.03,
  /* 阶梯是阶跃的 —— 台阶内部要有梯度,搜索才不是瞎的。
   * 一级台阶 40 分,0.008×40 = 0.32 级:阶梯仍然主导,但同一级里分多的胜出。 */
  egPointsEps: 0.008,
  bossSize: 8,                // 每多一张的加成(对子/拖拉机更难被压)
  leadTrumpPenalty: 26,       // 未到收官时领出主牌钢板的折扣
  drawTrumpUnit: 6,           // 吊主:我方每比对手多一张主牌值多少分
  drawTrumpCap: 30,           // 吊主项的上下限
  leadWeakTrump: 14,          // 领出压不住场的主牌(非钢板)的固定折扣
  /* 调王/调主(v4.7,见 tiaoWangValue)。tiaoWang=0 即整条关闭,便于消融。 */
  tiaoWang: 1,
  tiaoDrawUnit: 7,            // 每逼出对手一张主牌值多少分(按下界算,最多记 2 张)
  tiaoNoEdge: 0.3,            // 我方主牌不占优时,「逼消耗」只剩这个折扣(可能是替对手清场)
  tiaoHandoff: 1.0,           // 牌权过渡给队友这一项的权重
  tiaoNoPartnerT: 0.4,        // 队友主门下界为 0(不确定他还有主)时的折扣
  /* 副色小牌探路的罚分(v4.7)。豁免:队友多半握 A / 队友已断门(送毙) / 这门分已打光。 */
  probePenalty: 12,
  probePairScale: 0.5,        // 对子探路的罚分折扣(对子难被跟死,危险小一档)
  probeSafeBonus: 6,          // 推断出队友握 A 时,这门的小牌/分牌是贴分,该出
  leadTrumpEVScale: 0.45,     // 领出主牌时,这一墩能收到的分按副牌口径打的折(主牌人人攥着不放)
  feedRuff: 1.0,              // 送毙(主打队友断门)的权重;设 0 即整条关闭,便于消融
  feedRuffMinP: 0.35,         // 队友断门概率低于这个值就不当成送毙机会
  pwGain: 0.5,                // 比分敏感度对「现在兑现 vs 留着压制」的调节幅度
  grabBonus: 85,              // 无庄盘抢庄红利(有主)
  grabBonusNT: 58,            // 无庄盘抢庄红利(无将,主牌只有12张压不住场)
  declSingleOption: 8,        // 有对却只亮单张:不暴露 + 保留加固权的价值(信心越足越不值钱)
  declOverrideCost: 45,       // 亮的单张被别家一对常主反掉的代价
  rebelThresholdAdd: 12,      // 造反(相对首亮)的额外门槛:打乱一个已成立的主色有摩擦成本
  ntReluctance: 0.5,          // 亮无将的基础不情愿(暴露一对王 + 无将局毙牌手段极少)
  ntDefenderEdge: 0.25,       // 无将对闲家有利、对庄家方不利(拆掉长将牌碾压机)
  ruffSatTrump: 12,           // 毙牌能力饱和点(有主局,人均9张的约1.35倍)
  ruffSatNT: 5,               // 毙牌能力饱和点(无将局,人均3张)
  /* v0.5.8 ①:视野前移。旧值 4 + 1/6 在底分 13 时算出 hz=6.2 —— 前 19 墩护底价值恒为零,
   * 等到剩 6 张才突然从 0 跳到 24。新值 5 + 0.25 在同样底分下 hz=8.25,接上中盘尾段。 */
  endHorizon: 5,              // 剩几张牌起算「最后一墩争夺」(底分越大越提前,见 endHorizonOf)
  endHorizonMax: 12,          // 提前量的上限
  endHorizonPerPt: 0.25,      // 每 1 分底分,把「最后一墩争夺」提前多少张牌
  /* 护底价值占「底牌那笔翻倍分」的比例。
   * 量纲上它应该 ≤1(守最后一墩这个期权不可能比它保护的那笔分更值钱),
   * 但 v4.4 试过把它压回 0.95 并封顶在 stake 上:**每局 −2.1 分,
   * 庄家丢掉最后一墩 22% → 44%**,上一版的收益全赔回去。
   * 也就是说这个「量纲错误的」大数值,买到的正是收官阶段那条硬约束。
   * 结论:数值留着,但**别指望它同时管中盘** —— 调王那类问题另开一条路解决
   * (takeOverScope 只在非收官阶段生效)。 */
  endKittyWeight: 5.0,
  reserveMarginal: 1,         // 1=护底代价按边际算(还有第二手钢板就不该全额计价)×reserveHold;0=旧的全额
  ruffStruct1: 0.85,          // 对手断门时,毙掉我一张副牌单张的把握
  ruffStruct2: 0.45,          // 毙掉一个副牌对子(要一对主)的把握
  ruffStruct3: 0.25,          // 毙掉三张以上的一手副牌(要同结构的主)的把握
  sideReserveDamp: 0.6,       // 副牌护底的折扣:它还要求倒数第二墩就握着牌权
  endPhaseKPerPt: 0.045,      // 收官留手折扣随底分的抬升(底分 0 → 0.15,底分 20 → ≈1.05)
  endPhaseKCap: 1.1,          // 抬升上限
  tempoWeight: 0.35,          // 牌权价值在跟牌打分里的权重
  leadTempoWeight: 1.0,       // 牌权价值在领出打分里的权重。比跟牌侧(0.35)高得多,
                              //   因为领出就是「要不要保住牌权」这个决策本身;
                              //   0.35 时实测只改变 2.1% 的领出决策 —— 形同虚设。
  tempoCap: 40,               // 牌权价值上限(贴现和自己会收敛,这个只当兜底)
  tempoDecay: 0.80,           // 待兑现单元按价值降序的贴现率:下一墩权重最高,往后递减
  oppTempo: 6,                // 牌权落到对手手里的估计代价
  fragileBonus: 0.18,         // 每多一张,组合被拆的风险溢价(飞机大炮该早兑现)
  dumpPartner: 0.85,          // 队友把本门分贴过来的比例
  dumpOpp: 0.85,              // 后手对手能掏出多少本门分
  handShare: 4,               // 「某家握有这门未见牌的几分之一」的兜底值(领出时用;跟牌用实际手牌数动态算)
  pNoPartnerLeft: 0.02,       // 队友已出过牌、对手暂大时,这墩还能翻盘的概率
  /* 「对手暂大、队友还没出牌时,本队还能把这墩夺回来」的概率。
   * 这两个数是**整个跟牌评分里唯一一处已知失准、却仍然取当前值**的地方,原因见下。
   *
   * 校准实测(200 局,模型给的 p vs. 实际赢下的频率):
   *   对手暂大    模型 0.255   实际 0.183   高估 0.072
   *   队友暂大    模型 0.692   实际 0.782   低估 0.089
   *   over/ruff  模型 0.727   实际 0.696   基本准
   * 也就是说 0.32 作为**概率**是偏高的:我不去争的时候,本队实际只有 18% 能把这墩夺回来。
   *
   * 但把它往任何一边动都掉分:0.32→+8.7、0.22→+7.0、0.14→+7.6 分每局;
   * 换成按记牌算(pPartnerTakes,均值 0.41)更差:0.35 采信 →+5.7、0.6 采信 →+6.3。
   *
   * 结论:**它已经不是一个概率,是一个被调过的权重。** scorePlay 里的 gain / loss
   * (laterPoints、my、futureValue 的分牌负债项)都是围着这个 0.32 标定出来的,
   * 单独把这一个输入改准,等于打破了其余各项吸收掉的偏差。
   * 要真正修好,得把跟牌侧的 EV 整体重标定,而不是换掉一个输入 —— 那是下一轮的事。
   */
  pPartnerPrior: 0.32,
  pPartnerCalc: 0,            // 记牌证据相对先验的采信比例;0 = 完全用先验(实测最优)
  blockWin: 1,                // 1=生成「盖住末家分牌」的吃法候选;0=只用最省的吃法(消融用)
  /* 「接过队友」的开放范围:0=关 | 1=将牌墩与断门毙分 | 2=全开 | 3/4=单支消融(见 takeOverScoped)。
   * **默认 0 —— 这是一条实测为负的改动,代码留着是因为它对应的局面确实存在。**
   * 动机是需求列表那两条:队友调王没人接、队友副花 K 暂大而我断门不毙,末家一张 A/10 全收走。
   * 候选生成本身没问题(旧版整组吃/毙候选被 `if(!partnerWinning)` 挡在门外,一张都不生成),
   * 但配对对照里各档都掉分:全开 −1.0、限将牌墩 −0.5、限断门毙分 −0.3、
   * 再收紧确定性门槛到 0.5 才回到 −0.05。原因大概率是 certainty 本身系统性低估队友
   * (校准表:模型 0.692 / 实际 0.782,见 AI-DESIGN §5.1),于是这条闸门开得太频。
   * 要真正吃下这块收益,得先把 certainty 重标定,而不是在它上面再加一层。 */
  takeOverScope: 4,
  takeOverMaxCertainty: 0.85, // 队友暂大且确定性低于此值时,才生成「接过来」的候选(v4.3)
  /* 压自家队友的固定分差。**v4.4 起是负数,也就是一份加成。**
   * 理由不是「打分算出来该接」—— 打分器认为中盘这类局面接过来差 1.6 分,是个近乎平局。
   * 理由是**自对弈量不了这件事**:两边都是同一个 AI,它从不像人那样带着意图去调王,
   * 所以「队友调了王、我该不该接」这个配合问题在自对弈里根本不会被出题。
   * 实测这一档是**纯中性**(+0.04 分/局, SE 0.11, 200 副配对),既然不要钱,
   * 就按「给人当队友」的口径来定:−4 能把「三家能接却没接」从 34 例压到 15 例,
   * 再往下(−8)只到 13,收益饱和。 */
  overPartner: -4,
  /* 「队友暂大但我断门且台面有分」这一条是**规则**,不是权重:给一份足够大的加成,
   * 让它在正常局面下直接胜出,只有极端情况(比如手上只剩护底那一张主)才可能被压过。
   * 判据是 curBoss —— 队友那张确实是本门最大、且没有已知的后手断门,才可以不毙。 */
  ruffPartnerBonus: -25,
  ruffPartnerMinPts: 5,       // 台面分下限:一分没有的空气墩不值得动主
  takeOverMinPts: 5,          // 断门毙分那一支的桌面分下限
  partnerHoldAfter: 0.72,     // 队友压回来之后,身后还有对手时守得住的比例

  /* ==========================================================================
   * v0.5.8 —— 九条实战反馈的根因修复。全部带开关,默认全开,可逐条消融。
   * 每一条旁边标的是它对应的反馈序号,详见 CHANGELOG v0.5.8。
   * ========================================================================== */

  /* 第 0 波:支配性错误。这四条只会删掉「被支配的选项」,不改任何权衡口径。 */
  trumpNoPremium: 1,          // ⑦① controlPremium 只对副牌生效(0=退回旧行为)
  trumpTopPremium: 1,         // ⑦① 主牌梯子顶端(大小王/正副常主)的控制溢价(0=关闭)
  cashPointW: 0.8,            // ⑨  稳拿这墩时,一张分值折合几级牌序(0=关闭,不兑现主分牌)
                              //     trumpHoldTop 14 摊在约 12 级上 ≈ 1.2 分/级 → 10 分 ≈ 8 级
  dumpTrumpDiscount: 0.5,     // ⑧  贴分排序里主牌上的分打几折(1=退回旧行为)
                              //     副色的 5 该排在主 5 前面,但主 10 仍排在副色 5 前面
  grabPartnerKeep: 0.08,      // ⑤  无庄盘、庄位已在本队时,抢庄红利还剩几成
                              //     (同队之内谁坐庄确实有差别,但那是个位数,不是 85;1=退回旧行为)

  /* 第 1 波:补上只写了一半的规则。 */
  ruffOppRule: 1,             // ③  对手暂大时的「断门有分必毙」(0=关闭,退回纯打分)
  ruffOppBonus: -25,          // ③  与 ruffPartnerBonus 同量级 —— 它们本来就是同一条规则的两半
  ruffOppMinPts: 5,           // ③  台面分下限
  takeOverEndTrump: 1,        // ②  收官阶段对将牌墩放开「接过队友」(0=退回旧行为)
  tiaoUseExp: 1,              // ②  调主的判据改用**期望**张数而非硬下界(0=退回旧行为)
                              //     旧口径下 95.1% 的调主发生在 end 阶段 —— 那是信息约束,不是战术判断
  /* ② 「逼出对手的主」解锁了多少我方副牌钢板的价值。
   * **默认 0 —— 插桩证明这一项形同虚设,按 §6 的规矩不该带着上线。**
   * 想法是对的(吊主保护的正是那些随时可能被毙的副牌钢板),但这样写量太小:
   * 插桩 200 局,unlock 的均值只有 0.05(drawOut 5.5、handoff 2.0),
   * 400 局自对弈里开与不开的调主次数是 557 vs 559 —— 没有改变任何一次选择。
   * 原因是中盘的副牌钢板本来就少(均值 0.8~1.1 个单元),而 u.val 本身只有个位数。
   * 要真做,得算「对手主牌减少 k 张之后,这门钢板的存活概率上升多少」,
   * 也就是 reserveHold 要能接受一个 trAvail 参数,而不是在外面乘个比例。 */
  tiaoUnlock: 0,
  /* ② drawTrumpValue(**打分项**)也改成一家比一家。
   * **默认 0 —— 实测否掉。** 偏差本身是真的(旧式子拿我一家的主牌数去减两个对手合计的),
   * 但 drawTrumpUnit 6 / drawTrumpCap 30 是围着这个偏差标定出来的:
   * 只修偏差不重标定,正半边突然放大,AI 变得过度吊主 ——
   * 配对对照 1800 副 **−0.85 ±0.97 分/局,庄家丢最后一墩 26.2% → 37.8%**。
   * 判据那一侧的修正走 tiaoEdgeVsOne(见 trumpEdgeCount),那里只用符号、不用量纲。 */
  drawTrumpVsOne: 0,
  /* ② 调主的「我方主牌占不占优」判据用一家比一家。
   * **默认 0 —— 诊断对,药方不对,实测否掉。**
   * 打开它之后调主从 174 次涨到 475 次(mid 占比 9.8% → 18.9%),但症状**变坏**:
   * 小主领出的将牌墩里「末家用分牌赢」从 4.5% 涨到 8.3%,「领出方输掉」55.4% → 58.6%,
   * 配对对照 1800 副也只有 +0.11 ±0.96(等于没动)。
   * **调主打得更频繁 ≠ 打得更对。** 真正的病根见 tiaoWangValue 顶上那段注释。 */
  tiaoEdgeVsOne: 0,
  /* ② 调王里那条「逼对手吐主」的收益。**默认 0 —— v0.6.0 起改由 pTeam 表达。**
   * 领出一张小主,两个对手各跟一张他们最小的主,大主一张不掉 ——
   * 这条收益大半是虚的。实测关掉它之后:小主领出的将牌墩里
   * **队友接走 25.2% → 30.3%**、领出方输掉 54.1% → 52.7%。 */
  tiaoDrawOut: 0,
  /* ② 队友救回来的概率到多少才算「这是一次调主」。**只影响理由字符串,不影响出牌。**
   * partnerRescueP 的典型值是 share(≈1/3) × leadRescueDamp(0.7) ≈ 0.23,
   * 所以门槛取 0.20;取 0.30 的话教练面板几乎标不出调主,可行为本身是在调的。 */
  tiaoLabelP: 0.20,

  /* 第 2 波:拆掉两处补丁堆。 */
  leadEV: 1,                  // ④⑥ 非钢板领出走统一期望分口径(0=退回三条手写常数式)
  /* ② v0.6.0:领出侧的牌权概率改问「本队赢不赢得下这墩」。
   * 这是调王的病根 —— 旧口径把「队友压过去」和「对手压过去」都算成失败。 */
  leadTeamP: 1,               // 0 = 退回旧的 pSurvive 口径
  leadRescueDamp: 0.7,        // 队友「压回来」的折扣(他要压的是对手那张,不是我这张)
  leadShapeBonus: 4,          // ④⑥ 牌型可打性:拖拉机/对子难被跟死,同 p 下更该打。
                              //     这是 p 表达不了的那一小截,不是原来那个 20/16 的基础分
  endNearGamma: 0.5,          // ①③ 护底曲线的幂(1=旧的线性,视野入口几乎不给分)
  /* ①③ 护底封顶 = kp×kittyMult 的几倍(0=不封顶,退回 endKittyWeight 那条式子)。
   *
   * **默认 0 —— 这一条是被实测否掉的,量纲论证输给了数字。**
   *
   * 我原来的理由是量纲:护底 flat 项峰值 133,而它保护的那笔分只有 kp×kittyMult≈27,
   * 「守最后一墩这个期权不可能比它保护的那笔分更值钱」,所以该封在 1.0。
   * 先撞见的是单元测试:收官 4 张、王对+两张输牌、底估 13.7 时,
   * cap 1.0/1.5/2.0 都会把王对领出去(错),2.5 才攥得住 —— 因为钢板领出那一支的
   * 基础分 bossBase 40 + size×8 = 56 本身就是个比真实 stake 还大的**标定常数**。
   * 接着配对对照(800 副,同桌新旧对局,共同种子逐局相减):
   *
   *     cap 2.5 → 净胜 2.67 分/局,庄家丢最后一墩 28.8%
   *     cap 0   → 净胜 3.38 分/局,庄家丢最后一墩 23.5%    配对差 +0.71 ±0.39
   *
   * 也就是 endKittyWeight 上面那句「这个量纲错误的大数值,买到的正是收官阶段那条硬约束」
   * 是对的。真正让护底「提前就存在」的是 endNearGamma 和 endHorizon 前移这两条
   * (见下面的实测表),不是封顶。开关留着:等 bossBase 重标定之后应该一起再试一次。 */
  endKittyCap: 0,
  /* ①③ 边际护底的下限。**同样被实测否掉,默认 0(即旧行为)。**
   * 动机是 reserveMarginal 的 `max(0, p(最好)−p(次好))`:手上有大王(0.95)+小王对(0.90)时
   * 这个系数只有 0.05,护底几乎归零 —— 「牌越好护底越弱」。加了下限之后配对差 −0.47 ±0.48,
   * 方向为负。开关留着:那个局面确实存在,但补法不对 ——
   * 下限是个常数,而真正该算的是「两手护底被同时耗光」的联合概率。 */
  reserveFloor: 0,

  /* ========== v0.6.0:最后一墩的口径 ========== */
  kittyMultDyn: 1,            // 抠底倍数按 reserveUnit 的张数估,不再是常数 2(0=退回常数)
  kittyMultMaxSize: 3,        // 估计时最多按几张算(拖拉机 ×8 已经很极端,别外推更远)
  ladderKitty: 1,             // 阶梯目标的「当前总分」含那笔待翻倍的底分(0=退回旧行为)
  guardPw: 1,                 // 护底项也过 pointWeight,与当墩 ev 用同一把尺子(0=退回旧行为)
};

// 全局牌力序:主牌恒高于任何副牌。
// 修的是「无分墩最后一手拿低将牌当废牌垫掉」——根因是 ordIdx 在各门内
// 独立编号,主花色的 3 和副花色的 3 数值相近,排序时被当成等价废牌。
function globalIdx(c, trump){ return effSuit(c,trump)==='T' ? 100+ordIdx(c,trump) : ordIdx(c,trump); }

// 中间平缓、两头陡峭、单调递增,g(0)=0 g(0.5)=0.5 g(1)=1。
// 笔记里无将折扣要的就是这条曲线:将牌从 0→3 张和从 7→10 张时收益变化剧烈,
// 中间区间(4~6 张)则钝感。
function easeEnds(t){ t=Math.max(0,Math.min(1,t)); return 0.5-Math.asin(1-2*t)/Math.PI; }
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

// 某门(副花色)里我手上从最大往下能连着「稳赢」的张数。
// 有 A 则 A 稳赢;A 出完 K 变最大,于是 K 也算进链条,以此类推。
// 这条链决定了「牌权易手之前我还能撒掉几张」。
function bossChain(suitCards, trump, mem){
  const sorted=suitCards.slice().sort((a,b)=>ordIdx(b,trump)-ordIdx(a,trump));
  const held={};
  sorted.forEach(c=>{ held[pairKey(c)]=(held[pairKey(c)]||0)+1; });
  // 在外(别家手里)比我某张牌更大的牌,若已被我全部持有则该牌仍是稳赢
  let n=0;
  for(const c of sorted){
    const idx=ordIdx(c,trump);
    let bigger=0;
    for(const k in mem.unseen){
      if(mem.unseen[k]<=0) continue;
      const u=keyToCard(k);
      if(effSuit(u,trump)!==effSuit(c,trump)) continue;
      if(ordIdx(u,trump)>idx) bigger+=mem.unseen[k];
    }
    if(bigger>0) break;
    n++;
  }
  return n;
}

// 庄家方赢下最后一墩的概率(决定分牌该不该扣底)。
// 主要看主牌厚度与是否握有大怪 —— 能压到最后的才敢把分埋进底。
function pWinLastTrick(hand, trump){
  const nT=hand.filter(c=>effSuit(c,trump)==='T').length;
  const bj=hand.filter(c=>c.rank===16).length, sj=hand.filter(c=>c.rank===15).length;
  const avg=trump.suit?9:3;                       // 无将时主牌总数只有12张
  let p=easeEnds(clamp(nT/(avg*2),0,1));          // 主牌厚度
  p+=bj>=2?0.22:bj?0.10:0;                        // 大王对≈锁死最后一墩
  p+=sj>=2?0.10:sj?0.04:0;
  return clamp(p,0.05,0.95);
}

/* ============================================================
 * 阶段二:扣底适合度评分(v3)
 *
 *   Bury(c) = −Face(c) + Void(c) + PointΔ(c)
 *
 * Face  牌面价值(留着能赢墩拿分的能力),越大越不该埋
 * Void  该牌对「牌权易手前断门」的边际贡献 × 无将折扣
 * PointΔ 分牌专用:持有丢分风险 − 扣底丢分风险(正=埋更划算)
 *
 * 断门是集合性质(埋掉一门的最后一张才算断),所以不是一次性排序,
 * 而是贪心逐张选:每选一张就重算剩余各门的断门增益。
 * ============================================================ */

// 牌面价值:留在手里能赢墩/拿分的能力
function faceValue(c, groups, trump){
  const s=effSuit(c,trump);
  if(s==='T') return AIP.buryTrumpBlock+ordIdx(c,trump)*6;   // 绝不埋主
  const g=groups[s]||[];
  const same=g.filter(x=>pairKey(x)===pairKey(c)).length;
  let v=ordIdx(c,trump)*2.2;
  if(same>=2) v+=18;                                  // 别拆对
  /* 副花色 A:硬性阻力,不是「+30 分再和断门收益比大小」。
   * 实战反馈 + 实测:旧版在手握副 A 的局里有 19.3% 把它埋了。
   * 判据很简单 —— A 赢不下一墩,只可能是有人在这门断门并毙掉它;
   * 开局各家 25 张、一门 12~13 张,天然断门的概率很低,
   * 也就是说这张 A 赢一墩几乎是确定的,而底里埋一张牌换来的是「可能」造出一个断门。
   * 拿一个确定的墩去换一个可能的断门,不划算 —— 没有人扣 A。 */
  if(c.rank===14) v+=AIP.buryAceBlock;
  else if(c.rank===13){
    v+=14;
    if(g.some(x=>x.rank===14)) v+=10;                 // 手握 A 时 K 是撒牌的第二张
  }
  return v;
}

// 埋掉 suit 门的第 k 张之后,该门的断门概率
function voidProb(remaining, chain){
  if(remaining<=0) return 1;
  if(remaining<=chain) return AIP.voidChainCredit;     // 靠稳赢牌撒完再断
  return 0;
}

// 埋底 v3:断门贡献 + 牌面价值 + 分牌丢分风险对比 + 无将折扣 + 必打关卡
function aiDiscard(hand, trump, opt){
  opt=opt||{};
  const n=RULES.kittySize;
  const mem=opt.mem||makeMemory({hand,history:[],buriedKnown:[]});
  const nT=hand.filter(c=>effSuit(c,trump)==='T').length;
  // 无将/少主时断门价值大打折扣:毙牌选择少,断门换不来多少墩。
  // 分母是「再多的主牌也换不来更多毙牌机会」的饱和点,取人均主牌数的约 1.35 倍:
  //   有主局主牌 36 张、人均 9  → 饱和在 12
  //   无将局主牌总共 12 张、人均 3 → 饱和在 5(单家不可能到 12,那是全场总数)
  const nTsat=trump.suit?AIP.ruffSatTrump:AIP.ruffSatNT;
  const voidDiscount=easeEnds(clamp(nT/nTsat,0,1));
  const pLast=pWinLastTrick(hand,trump);
  const gateDamp=opt.gateAhead?AIP.gateDamp:1;        // 对手面临必打关卡 → 损失封顶

  const rest=hand.slice();
  const picked=[];
  for(let step=0;step<n;step++){
    const groups={};
    rest.forEach(c=>{const s=effSuit(c,trump);(groups[s]=groups[s]||[]).push(c);});
    const nSide=rest.filter(c=>effSuit(c,trump)!=='T').length;
    const remain=n-step;                                // 连这一张在内还要埋几张
    const chains={}, share={};
    for(const s in groups){
      if(s==='T'){ chains[s]=0; share[s]=0; continue; }
      chains[s]=bossChain(groups[s],trump,mem);
      // 断门是集合性质:整门埋完才兑现。若只在「埋掉最后一张」时给分,
      // 这个台阶对贪心是不可见的 —— 它永远走不到那一步,于是 voidValue 形同虚设。
      // 所以把整门的断门价值**摊到需要埋的那几张上**,让梯度露出来。
      const len=groups[s].length, ch=chains[s];
      if(len<=remain) share[s]=AIP.voidValue*voidDiscount/len;                    // 整门埋掉=天绝
      else if(len-ch>0&&len-ch<=remain)
        share[s]=AIP.voidChainCredit*AIP.voidValue*voidDiscount/(len-ch);         // 埋到只剩稳赢牌
      else share[s]=0;                                                            // 这门这轮断不掉
    }
    let best=null;
    for(const c of rest){
      const s=effSuit(c,trump);
      const gain=s==='T'?0:share[s];
      // 分牌:比较「持有丢分」与「扣底丢分」两种风险
      let ptDelta=0;
      const pts=cardPoints(c);
      if(pts){
        // 「门长于平均」要按**埋完之后**的手牌算,不是按现在这 33 张:
        //   门长 —— 扣掉这门还会被埋走的那一份;
        //   基准 —— 埋完剩 25 张,其中 nT 张是主,副牌人均门长 = (25−nT)/3。
        const willBury=nSide>0?remain*((groups[s]||[]).length/nSide):0;
        const lenFinal=Math.max(0,(groups[s]||[]).length-willBury);
        const bench=Math.max(1,(25-nT)/3);
        const pHold=clamp(0.50-0.035*(lenFinal-bench),0.15,0.65);
        const riskHold=pts*pHold;
        const riskBury=pts*AIP.kittyMult*(1-pLast)*gateDamp;   // 底牌翻倍,但只在丢掉最后一墩时兑现
        // 扣底阶段还没开打,reserveUnit 无从谈起,这里保持常数 2
        ptDelta=riskHold-riskBury;
      }
      const score=-faceValue(c,groups,trump)+gain+ptDelta;
      if(!best||score>best.score) best={c,score};
    }
    picked.push(best.c);
    rest.splice(rest.findIndex(x=>x.id===best.c.id),1);
  }
  return picked;
}

/* ============================================================
 * 阶段一:亮主/造反评分(v3)
 *
 *   V(opt) = 100·Grab + 60·SuitFit + 25·Level + 20·Dealer
 *          + 30·Rebel + 18·Gate − 12·Reveal
 *   亮 ⇔ V ≥ θ(v),θ 随已见牌数 v 递减(等下去的信息价值在缩水)
 *
 * 每发到一张牌重算一次:v 越大,SuitFit 的外推越可信、观望价值越低。
 * ============================================================ */

// 已见 v 张里有 seen 张符合条件,外推我最终 25 张手牌里的期望张数。
// 用超几何期望而不是线性外推 —— 后者在 v 小时会疯掉(第1张就是主 ⇒ 25张全是主),
// 这条式子天然带收缩:v 小则结果贴近先验均值,v 大则贴近实际观测。
function projectLen(seen, v, total){
  total=total||36;
  if(v<=0) return total*25/108;
  return seen+(25-v)*(total-seen)/(108-v);
}

// 若以 opt 为主,我手上算作主牌的可见张数
function trumpCountUnder(vis, opt, trumpRank){
  return vis.filter(c=>c.suit==='X'||c.rank===trumpRank
                    ||(opt.suit&&c.suit===opt.suit)).length;
}

// 副牌面质量(无将局特别看重):A/K/对子的密度
function sideQuality(vis, opt, trumpRank){
  const side=vis.filter(c=>c.suit!=='X'&&c.rank!==trumpRank&&c.suit!==opt.suit);
  if(!side.length) return 0;
  const cnt={};
  side.forEach(c=>{cnt[pairKey(c)]=(cnt[pairKey(c)]||0)+1;});
  let q=0;
  side.forEach(c=>{ if(c.rank===14) q+=1; else if(c.rank===13) q+=0.6; });
  for(const k in cnt) if(cnt[k]>=2) q+=0.8;
  return clamp(q/(side.length*0.42)-1,-1,1);
}

// D: {vis, seat, trumpRank, curDecl, dealerKnown, dealer, firstTaker, gates, levels}
// 别家凑出一对常主(从而反掉我亮的单张)的粗略概率。
// 某一门的两张级牌都落进同一家 25 张手里 ≈ (25/108)(24/107) ≈ 0.052,两个对手则约 0.104;
// 对「两张都还没见过」的每一门独立累计。
function pPairOverride(vis, trumpRank){
  let f=0;
  for(const s of SUITS){
    const seen=vis.filter(c=>c.suit===s&&c.rank===trumpRank).length;
    if(seen===0) f++;
  }
  return clamp(1-Math.pow(1-0.104,f),0,0.8);
}

/* 手牌契合度那一段单独拆出来(v4)。
 * 它回答的是纯粹的「以这个花色(或无将)为主时,我这手牌有多强」——
 * 不含抢庄红利、暴露代价、谁已亮主这些与主色无关的项。
 * 拆出来是为了给造反做**基线**:造反的正确判据不是「新主够不够好」,
 * 而是「比现在这个主好多少」。v3 从头到尾没有算过现状,于是会出现
 * 「手握长♠、却因为摸到小王对去反无将」这种没有逻辑的行为。
 */
function declHandQuality(D, opt){
  const v=D.vis.length, why=[];
  const iAmDefender=D.dealerKnown&&D.dealer>=0&&D.dealer%2!==D.seat%2;
  let fit;
  if(opt.suit){
    const L=projectLen(trumpCountUnder(D.vis,opt,D.trumpRank),v,36);
    fit=clamp((L-9)/5,-1,1);                        // 有主局主牌总数36张,人均9
    if(fit>0.25) why.push(`预计${L.toFixed(0)}张主`);
  }else{
    // 无将:主牌总共只有 12 张(4王+8级牌)。这时候「期望长度」不是好尺子 ——
    // 关键是这 12 张里**最大的那几张**在不在我手上:握大王对 + 两张级牌(4/12)
    // 和握四张级牌无王(4/12)在张数上完全等价,实战里天差地别。
    // 所以无将的 fit 用**牌力占比**:大王 1.0、小王 0.75、级牌 0.4,除以全场总和归一。
    const reluctance=AIP.ntReluctance*(D.dealerKnown?1:0.3);
    fit=0.6*ntTrumpShare(D.vis,D.trumpRank)*2-0.6
       +0.6*sideQuality(D.vis,opt,D.trumpRank)-reluctance
       +(iAmDefender?AIP.ntDefenderEdge:-AIP.ntDefenderEdge*0.6);
    fit=clamp(fit,-1,1);
    if(fit>0) why.push('无将且大牌集中在我手上');
  }
  let s=60*fit;
  // 级数为 5/10/K:那 8 张级牌本身就是 40 或 80 分。
  //    关键在稀释度 —— 有主局它们被摊薄在 36 张主牌里,谁主花色长谁通吃;
  //    无将局主牌总共 12 张,其中 8 张是分,即「主牌里三分之二是分」,
  //    且常主压死一切副牌,每张≈一墩稳赢外加 5~10 分。
  //    对闲家更是如此:改无将等于拆掉庄家那台长将牌碾压机,把分牌拉回可争夺状态,
  //    庄家没了长主也更难保住最后一墩,抠底对闲家开了口子。所以不减半,反而要加。
  if([5,10,13].includes(D.trumpRank)){
    let lv=opt.suit?1:1.35;
    if(!opt.suit&&iAmDefender) lv+=0.35;
    s+=25*lv; why.push(opt.suit?'级数带分':'无将局主牌里大半是分');
  }
  return {q:s, fit, why};
}

// 无将局那 12 张主牌里,我手上占了多少「牌力」(而不是多少张)
function ntTrumpShare(vis, trumpRank){
  const w=c=>c.rank===16?1.0:c.rank===15?0.75:c.rank===trumpRank?0.4:0;
  const total=2*1.0+2*0.75+8*0.4;                 // 全场:2大王 + 2小王 + 8张级牌
  return clamp(vis.reduce((a,c)=>a+w(c),0)/total,0,1);
}

function scoreDeclOption(D, opt){
  const v=D.vis.length;
  const iAmDefender=D.dealerKnown&&D.dealer>=0&&D.dealer%2!==D.seat%2;
  const hq=declHandQuality(D,opt);
  const fit=hq.fit, why=hq.why.slice();
  let s=hq.q;
  // 1. 无庄开局:亮主=坐庄=拿底8张(外加自己定主色),抢摊抢反是默认策略。
  //    无将的红利略低一档 —— 无庄盘坐庄的价值有一半来自长将牌压场,
  //    而无将局主牌总共才 12 张,谁也压不了场。但红利仍在,不该被排除。
  /* v0.5.8 ⑤:**庄位已经在本队手上时,这份红利已经到手了,不能再算一遍。**
   *
   * 「打2 造反自己对门」的根因就在这一行。无庄盘里最终亮主者坐庄拿底,
   * 而 grabBonus(85)只加在候选上、不进 base(base 只取 declHandQuality),
   * 于是从**自己队友**手里把庄抢过来,账面上白赚 85 分;
   * 「队友已亮」的罚分只有 −30,无庄盘门槛又只有 10−10·prog(+12)≈12~22。
   *
   * 实测(♠2♠2 + 长♠,队友已亮 ♦):
   *   无庄开局、队友已亮 → 增量 +91.7 / 门槛 17.2 → 造反自己对门
   *   同一手牌、庄已定   → 增量  −7.3 / 门槛 35.4 → 正确地不动
   * 而且 base 用的是**我自己**在队友主色下的契合度,队友主色我越短基线越负、
   * 增量越大 —— AI 恰好在「队友有长门而我没有」时最想反队友,正好反了。
   *
   * 队友已亮时只保留 grabPartnerKeep 这一小截:同队之内谁坐庄确实有差别
   * (我手更适合坐庄时值一点),但那是个位数,不是 85。grabPartnerKeep=1 退回旧行为。 */
  if(!D.dealerKnown){
    const partnerHasIt=D.curDecl&&D.curDecl.seat%2===D.seat%2&&D.curDecl.seat!==D.seat;
    const raw=opt.suit?AIP.grabBonus:AIP.grabBonusNT;
    s+=partnerHasIt?raw*AIP.grabPartnerKeep:raw;
    why.push(partnerHasIt?'庄位已在本队':'无庄抢摊');
  }
  // 2~3. 手牌契合度 + 级数,已在 declHandQuality 里算好(拆出去是为了给造反做基线)
  // 4. 庄家归属
  if(D.dealerKnown){
    if(D.dealer===D.seat) s+=20*0.5;
    else if(D.dealer%2===D.seat%2){                 // 队友坐庄:让他先亮,除非我这门极强
      if(fit<0.6){ s+=20*(-0.7); why.push('队友坐庄,先观望'); }
    }else{ s+=20*0.3; why.push('对手坐庄'); }
  }
  // 5. 谁已亮主(只影响造反)
  if(D.curDecl){
    const prog=v/25;
    if(D.curDecl.seat===D.seat) s+=30*(-0.3);
    else if(D.curDecl.seat%2===D.seat%2){ s+=30*(-1.0); why.push('队友已亮,不必打乱'); }
    else{ s+=30*(0.4+0.6*prog); why.push('对手已亮,越晚越该反'); }
  }
  // 6. 必打关卡:对手坐庄且下一级无法跳过 → 扰乱对手预期优势的权重上升
  if(D.gates&&D.gates.length&&D.dealerKnown&&D.dealer%2!==D.seat%2){
    const oppLv=D.levels?D.levels[D.dealer%2]:null;
    if(oppLv!==null&&D.gates.includes(oppLv)){ s+=18; why.push('对手卡关,损失有限'); }
  }
  // 7. 暴露手牌信息的代价:王对造反等于把一对王亮给对手针对
  s-=12*(opt.strength>=3?1:opt.strength===2?0.4:0.2);
  // 8. 手上有对却只亮单张:省下暴露、留着「加固」这条后路,但要担被别家一对常主反掉的风险。
  //    信心越足(fit 越高)越不愿意冒这个险 —— 于是自然形成
  //    「信心不足想试一手 → 亮单」「手牌够好 → 亮对(或先亮单再加固)」。
  if(opt.hasPair&&opt.strength===1){
    // 「留后路」这件事只在心里没底时才值钱:信心越足,那条后路越用不上
    s+=AIP.declSingleOption*(1-Math.max(0,fit));
    // 被一对常主反掉不只是丢了主色 —— 无庄盘还连庄位和那 8 张底一起丢
    s-=pPairOverride(D.vis,D.trumpRank)*AIP.declOverrideCost
        *(D.dealerKnown?1:1.5)*Math.max(0,fit);
    why.push('先亮单张试探,留加固后手');
  }
  return {score:s, reason:why.join('、')||'手牌一般'};
}

// θ(v):亮的门槛。无庄盘门槛低(抢庄红利大);有庄盘早期高、越晚越低
function declThreshold(D){
  const prog=D.vis.length/25;
  return D.dealerKnown ? 34-22*prog : 10-10*prog;
}

// 返回最优亮主/造反选择,或 null 表示这一张不动
function aiDeclDecide(D){
  const cands=[...declOptions(D.vis,D.trumpRank)];
  const jp=jokerPairOf(D.vis); if(jp) cands.push(jp);
  const legal=cands.filter(o=>canOverride(D.curDecl,o,D.seat));
  if(!legal.length) return null;
  /* 造反用**增量**判据(v4)。
   * v3 是绝对门槛 `V(opt) ≥ θ`,而 V(opt) 只回答「以 opt 为主时我这手牌好不好」。
   * 造反要回答的是另一个问题:「换成这个主,比现在这个主好多少」。
   * v3 从头到尾没有算过现状,于是会出现「手握长♠、却因为摸到小王对去反无将」。
   * 基线只取与主色有关的那一段(declHandQuality),抢庄红利 / 暴露代价 / 谁已亮主
   * 这些本来就是造反的边际成本收益,留在增量侧。
   */
  const base=D.curDecl
    ? declHandQuality(D,{suit:D.curDecl.suit,strength:D.curDecl.strength}).q : 0;
  const scored=legal.map(o=>{
    const r=scoreDeclOption(D,o);
    return {opt:o, score:r.score-base, reason:r.reason,
            baseline:base, absolute:r.score};
  }).sort((a,b)=>b.score-a.score);
  // 造反的门槛比首亮高一档:打乱一个已经成立的主色,本身有摩擦成本
  const th=declThreshold(D)+(D.curDecl?AIP.rebelThresholdAdd:0);
  const top=scored[0];
  return {...top, threshold:th, pass:top.score>=th, cands:scored.slice(0,3)};
}

// 缺门推断(硬):从出牌历史看谁在哪门没跟牌(每4手为一墩,首手为领出)
function makeVoids(history, trump){
  const voids=[{},{},{},{}];
  for(let i=0;i<history.length;i+=4){
    const trick=history.slice(i,i+4);
    const lead=classify(trick[0].cards,trump);
    if(!lead) continue;
    for(let j=1;j<trick.length;j++){
      if(trick[j].cards.some(c=>effSuit(c,trump)!==lead.suit))
        voids[trick[j].seat][lead.suit]=true;
    }
  }
  return voids;
}

// cheapSort 的排序键,单门内比较用:越小越「便宜」
// 注意:这把尺子同时是**对手模型**的一部分(makeReads 用它反推「他手上没有比 X 更便宜的牌」)。
// 主牌的溢价不修,对手模型就会一直假设别人先打大王再打主A,maxHoldIn 的演绎跟着跑偏。
function cheapKey(c, trump){ return globalIdx(c,trump)+(cardPoints(c)?8:0)+controlPremium(c,trump); }

/* ============================================================
 * 缺门推断(软):从**出牌方式**反推。
 *
 * 前提:一个理智的人跟牌时,若既没有压制意图、也没有贴分动机,会出本门最便宜的牌。
 * 于是「他出了 X」就等于「他手上没有比 X 更便宜的本门牌」—— 这是硬演绎,不是概率。
 * 再与记牌一交叉,就得到他在这门最多还能有几张;上界为 0 即断门。
 *
 * 例:东领出副 A,西跟了一张 Q(既没压过、也不是贴分时机)。
 *    ⇒ 西手上没有比 Q 更便宜的这门牌。若我恰好握着 K、K、10、10,
 *      那么「不比 Q 便宜」的牌几乎都在我手里,西的上界掉到 1~2 张,断门概率陡增。
 *
 * 两个前提缺一不可,所以只在「他那队当时不是暂大」且「他这手没有压过当时最大」时采信 ——
 * 队友暂大时最优解是贴分(出最大的分牌)而不是出最小,这条演绎就不成立。
 *
 * 局限(必须挂在门口):它假设对手用和 AI 同一套「最便宜」排序。
 * 遇到刻意骗牌的人(故意出高牌制造断门假象)会被带沟里。
 * ============================================================ */
// 贴分序的排序键,与 dumpSort 一致:分大的排前,同分值挑小的
function dumpKey(c, trump){ return -cardPoints(c)*100+globalIdx(c,trump); }

function makeReads(history, trump){
  // 两种「他会先出什么」的序,对应两种局面,各自留一条下界
  const fCheap=[{},{},{},{}];     // 他那队不是暂大 → 出最便宜的
  const fDump =[{},{},{},{}];     // 他那队暂大   → 贴最大的分
  const hard=[{},{},{},{}];
  for(let i=0;i+3<history.length;i+=4){
    const trick=history.slice(i,i+4);
    const lead=classify(trick[0].cards,trump);
    if(!lead) continue;
    let best=lead, bestSeat=trick[0].seat;
    for(let j=1;j<trick.length;j++){
      const p=trick[j], cl=classify(p.cards,trump);
      if(p.cards.some(c=>effSuit(c,trump)!==lead.suit)){
        hard[p.seat][lead.suit]=true;                 // 没跟本门 = 硬缺门
      }else if(lead.cards.length===1){
        // 只在领出单张时采信:多张牌的跟法受「有对必对/拖拉机必跟」的义务约束,
        // 他出什么未必是他想出什么,这条演绎会失真。
        const beats=cl&&structMatches(cl,best)&&
          ((cl.suit===best.suit&&cl.top>best.top)||(cl.suit==='T'&&best.suit!=='T'));
        if(!beats){
          const partnerWinning=bestSeat%2===p.seat%2;
          const tgt=partnerWinning?fDump:fCheap;
          const key=partnerWinning?dumpKey:cheapKey;
          const k=Math.min(...p.cards.map(c=>key(c,trump)));
          const cur=tgt[p.seat][lead.suit];
          tgt[p.seat][lead.suit]=cur!==undefined?Math.max(cur,k):k;
        }
      }
      if(cl&&structMatches(cl,lead)){
        if(cl.suit===best.suit){ if(cl.top>best.top){best=cl;bestSeat=p.seat;} }
        else if(cl.suit==='T'){ best=cl; bestSeat=p.seat; }
      }
    }
  }
  return {fCheap,fDump,hard};
}

// 结合两条演绎下界与记牌,算他在这门最多还能有几张。
// 任一条下界排除掉的牌都不可能在他手上 —— 两条是「且」的关系,越多轮次上界收得越紧。
function maxHoldIn(reads, mem, seat, suitEff, trump){
  const fc=reads.fCheap[seat]?reads.fCheap[seat][suitEff]:undefined;
  const fd=reads.fDump[seat] ?reads.fDump[seat][suitEff] :undefined;
  let n=0;
  for(const k in mem.unseen){
    const cnt=mem.unseen[k]; if(cnt<=0) continue;
    const c=keyToCard(k);
    if(effSuit(c,trump)!==suitEff) continue;
    if(fc!==undefined && cheapKey(c,trump)<fc) continue;
    if(fd!==undefined && dumpKey(c,trump) <fd) continue;
    n+=cnt;
  }
  return n;
}

// 某家在某门缺门的概率。硬缺门=1;上界为0=1;否则按他手上牌占未见牌的比例衰减。
function makeVoidProb(reads, mem, trump, handLeft){
  let unseenTotal=0;
  for(const k in mem.unseen) unseenTotal+=Math.max(0,mem.unseen[k]);
  const share=clamp(handLeft/Math.max(1,unseenTotal),0.02,0.6);
  const cache={};                       // 同一次决策里会被反复问,记忆化
  return (seat, suitEff)=>{
    if(suitEff==='T') return 0;
    if(reads.hard[seat]&&reads.hard[seat][suitEff]) return 1;
    const ck=seat+':'+suitEff;
    if(cache[ck]!==undefined) return cache[ck];
    const m=maxHoldIn(reads,mem,seat,suitEff,trump);
    return cache[ck]=(m===0?1:clamp(Math.pow(1-share,m),0,0.97));
  };
}

/* 持有区间:上界 + **下界**(v4.7)。
 *
 * 设计文档 §7 把「对手建模只到缺门级」列为第二大短板,原话是
 * 「维护每家×每门的持有区间而非单个概率:下界由『必须跟牌却没跟』给出,
 *  上界由演绎给出」。上界一直有(maxHoldIn),下界一直没做 ——
 * 而调王的收益判断恰恰只要下界:**对手手上还有没有主牌可跟**。
 *
 * 下界几乎是白捡的,因为升级里有一条很强的约束:
 * **每家手牌数在任何时刻都相同**(每墩每家出一样多张)。于是
 *     下界(座, 门) ≥ 手牌数 − Σ_{其他门} 上界(座, 其他门)
 * 三门都被演绎压到很低时,剩下的牌只能在第四门里 —— 这是硬演绎,不是概率。
 *
 * handSize 传本家手牌数即可(领出时四家相同;跟牌时已出过牌的那几家少一张,
 * 少算一张的方向是保守的,不会高估下界)。
 */
function makeHoldRange(reads, mem, trump, handSize){
  const suits=['T','S','H','D','C'].filter(s=>s==='T'||s!==trump.suit);
  const cache={};
  return (seat, suitEff)=>{
    const ck=seat+':'+suitEff;
    if(cache[ck]) return cache[ck];
    const hi=s=>(reads.hard[seat]&&reads.hard[seat][s])?0
                :Math.min(handSize,maxHoldIn(reads,mem,seat,s,trump));
    let others=0;
    for(const s of suits) if(s!==suitEff) others+=hi(s);
    const lo=Math.max(0,handSize-others);
    return cache[ck]={lo,hi:hi(suitEff)};
  };
}

/* ============================================================
 * M3 启发式 AI:记牌 + 规则评估。
 * 返回 {cards, reason, score} —— reason 供教练模式复用。
 * view = {seat, hand, trump, history:[{seat,cards}...], buriedKnown}
 * ============================================================ */
function keyToCard(k){ const i=k.indexOf(':'); return {suit:k.slice(0,i),rank:+k.slice(i+1)}; }

// 记牌:已见 = 自己手牌 + 全部出牌历史 + (庄家还知道底牌)
function makeMemory(view){
  const seen={};
  const add=c=>{ const k=pairKey(c); seen[k]=(seen[k]||0)+1; };
  view.hand.forEach(add);
  (view.history||[]).forEach(p=>p.cards.forEach(add));
  (view.buriedKnown||[]).forEach(add);
  const unseen={};
  makeDeck().slice(0,54).forEach(c=>{ const k=pairKey(c); unseen[k]=2-(seen[k]||0); });
  return {unseen};
}
function maxUnseenIdx(mem, suitEff, trump){
  let m=-1;
  for(const k in mem.unseen){
    if(mem.unseen[k]<=0) continue;
    const c=keyToCard(k);
    if(effSuit(c,trump)!==suitEff) continue;
    m=Math.max(m,ordIdx(c,trump));
  }
  return m;
}
function unseenPairAbove(mem, suitEff, idx, trump){
  for(const k in mem.unseen){
    if(mem.unseen[k]<2) continue;
    const c=keyToCard(k);
    if(effSuit(c,trump)===suitEff && ordIdx(c,trump)>idx) return true;
  }
  return false;
}
/* 「在外还有更大的对子」不是一个布尔问题(v4.6)。
 * 同点数的两张牌可能分在两家手里,那就凑不成对 —— 而旧版的 unseenPairAbove
 * 只要看到「这个点数还有两张没见」就判定对手有对,等于按 100% 估一件小概率的事,
 * 于是 AI 系统性低估自己的对子,该领的对子不敢领。
 *
 * 两张同点数落在**同一家**的概率(三家各 h 张、未见共 U 张):
 *     p = 3 · h(h−1) / (U(U−1))
 * 开局 h=25、U=83 → 0.26;收官 h=5、U=23 → 0.12。
 * 所谓「理论最大对子」正是这件事:它跟单张最大牌是两套账,而且随着这门越打越薄,
 * 剩下的同点两张越不可能还在一家手上。
 *
 * h 由 U 反推(未见 = 三家手牌 + 8 张底),庄家知道底牌时会略微低估 h,方向是保守的。 */
function pPairAbove(mem, suitEff, idx, trump){
  let U=0;
  for(const k in mem.unseen) U+=Math.max(0,mem.unseen[k]);
  const h=Math.max(1,(U-RULES.kittySize)/3);
  const pTogether=U>1?clamp(3*h*(h-1)/(U*(U-1)),0,1):0;
  let pNone=1;
  for(const k in mem.unseen){
    if(mem.unseen[k]<2) continue;
    const c=keyToCard(k);
    if(effSuit(c,trump)!==suitEff||ordIdx(c,trump)<=idx) continue;
    pNone*=1-pTogether;                 // 每个更高点数各自独立地「凑成对」
  }
  return 1-pNone;
}
// 该牌型是否已是本门在外最大(“钢板”)
function isBossPlay(cl, mem, trump){
  if(cl.type==='single') return cl.top>=maxUnseenIdx(mem,cl.suit,trump);
  if(!unseenPairAbove(mem,cl.suit,cl.top,trump)) return true;   // 严格意义上已无更大的对
  // 严格意义上还有,但可能根本凑不成对 —— 概率低于阈值就当钢板
  return pPairAbove(mem,cl.suit,cl.top,trump)<AIP.pairBossMaxP;
}

// 跟小:挑最小且无分的。两处修正 ——
// (a) 用 globalIdx 而非 ordIdx,低主牌不再被误判成废牌;
// (b) 加「控门溢价」:A/K 虽然不是分牌却是撒牌的本钱。手持 A,K,10 被对手领 A 压死时,
//     旧版会当成「A 最便宜」把 A 丢掉,新版会出 10、留 A+K 以后一起撒。
/* v0.5.8 ①：控门溢价**只对副牌成立**。
 *
 * 它按自然点数判 A/K/Q,而这个溢价的语义是「撒牌的本钱」—— 只在副花色里说得通。
 * 主牌也走同一条键,于是主♠打2 时的「便宜序」被彻底打乱:
 *
 *   主J 108 < 副常主 112 < 主Q 113 < 小王 114 < 大王 115 < 主K 130 < 主A 141
 *
 * 也就是 AI 认为**大小王比主K/主A 更便宜**、副常主比主Q 更便宜。实测断门毙牌:
 * 手持「主A+大王」出大王、「主K+小王」出小王、「主Q+副常主」出副常主。
 * 这一条同时是「毙牌消耗大牌」和「收官前保底手段就没了」两条反馈的根因 ——
 * 中盘每一次断门,AI 都在优先烧掉自己最后的护底牌。
 * 开关 AIP.trumpNoPremium=0 可退回旧行为做消融。 */
/* 主牌那一侧要的不是「A/K/Q 溢价」,而是**梯子顶端的控制溢价**。
 * globalIdx 只是序号:大小王只比主K 高 4~5 个序号,可它们的控制价值差着量级 ——
 * 这正是 trumpHold 当年从「绝对刻度」改成「相对刻度」的同一个道理。
 * 没有这一截,分牌那个 +8 就足以让 AI 拿小王去换一张主K。
 * 取值刻意小(≤14),只保证顶端四张不会被当成便宜牌,不干扰下面的正常序。
 * trumpTopPremium=0 即关闭。 */
const trumpTop=(c,trump)=>!AIP.trumpTopPremium?0
  :c.rank===16?14:c.rank===15?10
  :(c.rank===trump.rank?(c.suit===trump.suit?6:4):0);
const controlPremium=(c,trump)=>
  (AIP.trumpNoPremium&&trump&&effSuit(c,trump)==='T')?trumpTop(c,trump)
  :(c.rank===14?30:c.rank===13?12:c.rank===12?4:0);
/* v0.5.8 ⑨:必赢时「最省」的定义要反过来 —— 稳拿这一墩时,手上的主分牌该趁机兑现,
 * 留在手里迟早要出,拖到没牌权时更可能白送给对手。cashPointW 是「一张分值折合几级牌序」,
 * 取 0.8:trumpHoldTop 14 摊在约 12 级上 ≈ 1.2 分/级,10 分 ≈ 8 级。 */
const ptPenalty=(c,certain)=>certain&&AIP.cashPointW
  ? -cardPoints(c)*AIP.cashPointW      // 稳拿这墩:分越大越该现在出
  : (cardPoints(c)?8:0);               // 否则维持旧口径,一律回避分牌
const cheapSort=(cards,trump,certain)=>cards.slice().sort((a,b)=>
  (globalIdx(a,trump)+ptPenalty(a,certain)+controlPremium(a,trump))
 -(globalIdx(b,trump)+ptPenalty(b,certain)+controlPremium(b,trump)));
/* 贴分:先塞大分,同分值挑最小的牌;同样主牌垫后。
 * v0.5.8 ⑧(附带):旧版注释写着「同样主牌垫后」,但代码里主副之分只是**同分值时**的
 * 次序键 —— 分值优先级更高。于是断门贴分时,若手上唯一的分牌是主牌,它会把主牌贴出去
 * (正式版 400 局里 219 次)。主牌上的分要打个折再参与排序:副色的 5 应当排在主 5 前面,
 * 但主 10 仍然排在副色 5 前面。dumpTrumpDiscount=1 即退回旧行为。 */
const dumpPts=(c,trump)=>cardPoints(c)*
  (trump&&effSuit(c,trump)==='T'?AIP.dumpTrumpDiscount:1);
const dumpSort=(cards,trump)=>cards.slice().sort((a,b)=>
  (dumpPts(b,trump)-dumpPts(a,trump))||(globalIdx(a,trump)-globalIdx(b,trump)));
// 垫牌排序:优先垫短门(造缺)、不拆对、不垫分、不垫A/K、绝不垫主
const discardSort=(cards,trump)=>{
  const groups={};
  cards.forEach(c=>{const s=effSuit(c,trump);(groups[s]=groups[s]||[]).push(c);});
  const v=c=>{
    const s=effSuit(c,trump);
    // 主牌一律排最后:同样不是分牌时,将牌价值大概率高于任何副花色牌
    if(s==='T') return 500+ordIdx(c,trump)*4;
    const g=groups[s];
    const isPair=g.filter(x=>pairKey(x)===pairKey(c)).length>=2;
    return ordIdx(c,trump)+(cardPoints(c)?30:0)+(isPair?14:0)
          +controlPremium(c)+(g.length<=2?-5:0);
  };
  return cards.slice().sort((a,b)=>v(a)-v(b));
};

// 构造性跟牌:满足全部义务,自由部分按策略挑。
// strat: cheap=跟小 / dump=贴分 / discard=垫牌(死保不出分、不出主)。seed 为预选结构。
function buildFollow(hand, lead, trump, strat, seed, certain){
  const n=lead.cards.length;
  const inSuit=hand.filter(c=>effSuit(c,trump)===lead.suit);
  const rest=hand.filter(c=>effSuit(c,trump)!==lead.suit);
  let chosen=(seed||[]).slice();
  const used=new Set(chosen.map(c=>c.id));
  const fillSort=strat==='dump'?dumpSort:strat==='discard'?discardSort
                :(cs,tr)=>cheapSort(cs,tr,certain);
  if(inSuit.length<=n){
    inSuit.forEach(c=>{ if(!used.has(c.id)){chosen.push(c);used.add(c.id);} });
    const restSort=strat==='dump'?dumpSort(rest,trump):discardSort(rest,trump);  // 垫牌讲究:造缺不拆对
    for(const c of restSort){ if(chosen.length>=n)break;
      if(!used.has(c.id)){chosen.push(c);used.add(c.id);} }
  }else{
    const comps=decompose(inSuit,trump);
    if(RULES.strictTractorFollow && lead.type==='tractor' && !chosen.length){
      const full=comps.find(c=>c.type==='tractor'&&c.len>=lead.len);
      if(full) full.cards.slice(0,lead.len*2).forEach(c=>{chosen.push(c);used.add(c.id);});
      else if(RULES.partialTractorFollow){
        const part=comps.filter(c=>c.type==='tractor').sort((a,b)=>b.len-a.len)[0];
        if(part) part.cards.forEach(c=>{chosen.push(c);used.add(c.id);});
      }
    }
    const targetPairs=Math.min(pairsInLead(lead),countPairsIn(inSuit));
    let have=Math.floor(chosen.length/2);
    if(targetPairs>have){
      const units=[];
      comps.forEach(c=>{
        if(c.type==='pair') units.push(c.cards);
        if(c.type==='tractor') for(let i=0;i<c.len;i++) units.push(c.cards.slice(i*2,i*2+2));
      });
      const uval=u=>(strat==='dump'||(certain&&strat==='cheap'&&AIP.cashPointW))
        ? -countPoints(u)*10+globalIdx(u[0],trump)      // 稳拿这墩时,成对的分也该趁机兑现
        : globalIdx(u[0],trump)+(countPoints(u)?(strat==='discard'?40:16):0);
      units.sort((a,b)=>uval(a)-uval(b));
      for(const u of units){
        if(have>=targetPairs||chosen.length+2>n) break;
        if(u.some(c=>used.has(c.id))) continue;
        u.forEach(c=>{chosen.push(c);used.add(c.id);}); have++;
      }
    }
    for(const c of fillSort(inSuit.filter(c=>!used.has(c.id)),trump)){
      if(chosen.length>=n) break;
      chosen.push(c); used.add(c.id);
    }
  }
  return isLegalFollow(hand,lead,chosen,trump)?chosen:null;
}

// 当前墩暂时的赢家
function currentWinner(plays, trump){
  const lead=classify(plays[0].cards,trump);
  let win=0,best=lead;
  for(let i=1;i<plays.length;i++){
    const cl=classify(plays[i].cards,trump);
    if(!cl||!structMatches(cl,lead)) continue;
    if(cl.suit===best.suit){ if(cl.top>best.top){win=i;best=cl;} }
    else if(cl.suit==='T'){ win=i;best=cl; }
  }
  return {seat:plays[win].seat, cl:best};
}

// 甩牌被同张数将牌整体压制:结构要对上(甩几个组件就得拿几个同型的主牌组件)。
// 引擎的 resolveTrick/structMatches 一直支持这么打,只是旧版 AI 从不生成这个候选,
// 于是甩牌抢分几乎无人拦得住 —— 这是单点损失最大的一个漏洞。
function ruffThrow(hand, lead, trump, certain){
  const trumps=hand.filter(c=>effSuit(c,trump)==='T');
  if(trumps.length<lead.cards.length) return null;
  const need=lead.comps.slice().sort((a,b)=>(b.len||1)-(a.len||1));  // 先满足最难凑的
  const pool=decompose(trumps,trump);
  const used=new Set(); const pick=[];
  for(const comp of need){
    let got=null;
    if(comp.type==='tractor'){
      const t=pool.filter(c=>c.type==='tractor'&&c.len>=comp.len&&!c.cards.some(x=>used.has(x.id)))
                  .sort((a,b)=>a.top-b.top)[0];
      if(t) got=t.cards.slice((t.len-comp.len)*2);
    }else if(comp.type==='pair'){
      const units=[];
      pool.forEach(c=>{
        if(c.type==='pair') units.push(c.cards);
        if(c.type==='tractor') for(let i=0;i<c.len;i++) units.push(c.cards.slice(i*2,i*2+2));
      });
      got=units.filter(u=>!u.some(x=>used.has(x.id)))
               .sort((a,b)=>ordIdx(a[0],trump)-ordIdx(b[0],trump))[0]||null;
    }else{
      const c=cheapSort(trumps.filter(x=>!used.has(x.id)),trump,certain)[0];
      if(c) got=[c];
    }
    if(!got) return null;
    got.forEach(c=>used.add(c.id)); pick.push(...got);
  }
  if(pick.length!==lead.cards.length) return null;
  const cl=classify(pick,trump);
  if(!cl||!structMatches(cl,lead)) return null;
  return isLegalFollow(hand,lead,pick,trump)?pick:null;
}

/* 「盖住末家分牌」的吃法(v4.1)。
 *
 * `minWinFollow` 给的是**最省的吃法** —— 压过当前最大就收手。对第三家(领出者的对家)
 * 来说这常常不够:压过当前最大 ≠ 压过末家可能掏出的那张分牌。
 * 实战里第三家的职责之一,就是**无论如何别让末家用一张 10 / K 直接把这墩连分带走**:
 * 外面还有 K,就得打 A 以上;外面只剩 10,打 J 以上就够。
 *
 * v3/v4.0 从来不生成这个候选 —— 于是「压过了、但压得不够高」是一个 AI 根本没法表达的选择。
 * 实测 200 局:第三家有 209 次机会该盖没盖,其中 119 次没盖,12 次被末家用分牌拿走,
 * 送出去 160 分。数字看着不大,但那是 AI 打 AI —— 双方都不掏那张 K,错误互相抵消了;
 * 对面换成会打的人,这个漏洞的代价要高得多。
 */
function blockWinFollow(hand, lead, trump, curBest, mem, certain){
  if(lead.type!=='single'||curBest.suit!==lead.suit) return null;
  const inSuit=hand.filter(c=>effSuit(c,trump)===lead.suit);
  if(!inSuit.length) return null;
  let topPt=-1;                                   // 在外这门最大的那张分牌
  for(const k in mem.unseen){
    const n=mem.unseen[k]; if(n<=0) continue;
    const c=keyToCard(k);
    if(effSuit(c,trump)!==lead.suit||!cardPoints(c)) continue;
    topPt=Math.max(topPt,ordIdx(c,trump));
  }
  if(topPt<=curBest.top) return null;             // 在外没有能翻盘的分牌,最省的吃法就够了
  const c=cheapSort(inSuit.filter(x=>ordIdx(x,trump)>topPt),trump,certain)[0];
  if(!c) return null;                             // 盖不住
  return buildFollow(hand,lead,trump,'cheap',[c],certain);
}

// 最省的吃法(本门压过,或断门时用主敲脱);吃不动返回 null
/* v0.5.8 ⑨:certain = 「这一手打出去必定拿下这墩」(目前只在末家成立)。
 * 稳拿的时候,「最省的吃法」不该是最小的那张,而是**手上最实惠的那张** ——
 * 主牌里的 5/10/K 现在兑现就是本队的分,留在手里迟早要出,
 * 拖到没牌权时更可能白送给对手。实测旧版:末家断门毙牌,
 * 手持「主7/主10/主K」出主7、手持「主10/主J」出主J,10 分白白留在手里。 */
function minWinFollow(hand, lead, trump, curBest, certain){
  if(lead.type==='throw'){
    // 只有当前还没被主牌压过时才轮得到我毙
    return curBest&&curBest.suit==='T' ? null : ruffThrow(hand,lead,trump,certain);
  }
  const n=lead.cards.length;
  const inSuit=hand.filter(c=>effSuit(c,trump)===lead.suit);
  const pairUnitsOf=cards=>{
    const us=[];
    decompose(cards,trump).forEach(c=>{
      if(c.type==='pair') us.push(c.cards);
      if(c.type==='tractor') for(let i=0;i<c.len;i++) us.push(c.cards.slice(i*2,i*2+2));
    });
    return us;
  };
  let seed=null;
  if(inSuit.length>=n){
    if(curBest.suit!==lead.suit) return null;   // 已被主吃,本门压不了
    if(lead.type==='single'){
      const c=cheapSort(inSuit.filter(x=>ordIdx(x,trump)>curBest.top),trump,certain)[0];
      if(c) seed=[c];
    }else if(lead.type==='pair'){
      seed=pairUnitsOf(inSuit).filter(u=>ordIdx(u[0],trump)>curBest.top)
        .sort((a,b)=>ordIdx(a[0],trump)-ordIdx(b[0],trump))[0]||null;
    }else{
      const tr=decompose(inSuit,trump)
        .filter(c=>c.type==='tractor'&&c.len>=lead.len&&c.top>curBest.top)
        .sort((a,b)=>a.top-b.top)[0];
      if(tr) seed=tr.cards.slice((tr.len-lead.len)*2);
    }
  }else if(inSuit.length===0 && lead.suit!=='T'){
    const trumps=hand.filter(c=>effSuit(c,trump)==='T');
    if(trumps.length<n) return null;
    const mustBeat=curBest.suit==='T'?curBest.top:-1;
    if(lead.type==='single'){
      const c=cheapSort(trumps.filter(x=>ordIdx(x,trump)>mustBeat),trump,certain)[0];
      if(c) seed=[c];
    }else if(lead.type==='pair'){
      seed=pairUnitsOf(trumps).filter(u=>ordIdx(u[0],trump)>mustBeat)
        .sort((a,b)=>ordIdx(a[0],trump)-ordIdx(b[0],trump))[0]||null;
    }else{
      const tr=decompose(trumps,trump)
        .filter(c=>c.type==='tractor'&&c.len>=lead.len&&c.top>mustBeat)
        .sort((a,b)=>a.top-b.top)[0];
      if(tr) seed=tr.cards.slice((tr.len-lead.len)*2);
    }
  }
  if(!seed) return null;
  return buildFollow(hand,lead,trump,'cheap',seed,certain);
}

/* ============================================================
 * 阶段三:出牌评分(v3)—— 从「能不能赢这墩」改成「这一墩净赚多少分」
 *
 *   Score(x) = k_cat · [ pWin·Gain − (1−pWin)·Loss ] − Future(x)
 *
 * pWin   本队最终赢下这墩的概率
 * Gain   赢下时到手的分 = 台面分 + 我出的分 + 后手预期加分
 * Loss   输掉时送出的分(同上口径)
 * Future 这手牌留到以后的期望收益(机会成本)—— 直出王对之所以是坏棋,
 *        就是因为它的 Future 极高而当墩 Gain 往往只有 0
 * ============================================================ */

// 局面阶段:开局大牌该留、收官大牌该兑现
function phaseOf(handLen){ return handLen>=17?'open':handLen>=8?'mid':'end'; }
const PHASE_K={open:1.0, mid:0.7, end:0.15};

// 某门在外还剩多少分(用于估计一张 A/K 未来还能捞多少)
function unseenPointsIn(mem, suitEff, trump){
  let p=0;
  for(const k in mem.unseen){
    if(mem.unseen[k]<=0) continue;
    const c=keyToCard(k);
    if(effSuit(c,trump)!==suitEff) continue;
    p+=cardPoints(c)*mem.unseen[k];
  }
  return p;
}

/* ---- 底牌估分与最后一墩 ----
 * 底牌分数由赢下最后一墩的一方以 分值×最后墩张数×2 拿走,所以临近收官时
 * 最后一墩的价值可能远超一张牌的常规价值 —— 而 PHASE_K.end 是个固定折扣,
 * 偏偏在这时候把留牌价值抹平了。
 * 庄家直接知道底牌;闲家可以倒推:未见牌 = 三家手牌 + 8 张底,
 * 于是底牌里的分 ≈ 未见分 × 8/(3k+8),k 为各家剩余张数。牌越少这个估计越准。
 */
function kittyPointsEst(X){
  if(X.buriedKnown&&X.buriedKnown.length) return countPoints(X.buriedKnown);
  // v4:闲家的倒推不该是「未见分均匀摊到 8 张底」—— 那等于假设庄家随机埋底。
  // 庄家的埋牌行为本身就是信息:他**绝不埋主**(faceValue 里 buryTrumpBlock=400),
  // 所以底牌只可能来自副牌,在外的主牌要从分母里剔掉,否则系统性低估底分;
  // 他又**倾向不埋分**(PointΔ 多数为负),所以分的密度还要往下打一折。
  let unseenPts=0, unseenCnt=0;
  for(const k in X.mem.unseen){
    const n=X.mem.unseen[k]; if(n<=0) continue;
    const c=keyToCard(k);
    if(effSuit(c,X.trump)==='T') continue;
    unseenCnt+=n; unseenPts+=cardPoints(c)*n;
  }
  if(unseenCnt<=0) return 0;
  return unseenPts*Math.min(1,RULES.kittySize/unseenCnt)*AIP.kittyPointBias;
}

/* ---- 底分驱动的收官口径(v4)----
 * v3 把收官写成常数 PHASE_K.end = 0.15,偏偏在底牌翻倍最该被在意的时候,
 * 把留手价值几乎抹平了;补丁那条 flat 项的触发条件又是「end 阶段 且 剩 ≤4 张 且 这手是钢板」
 * 三条同时成立 —— 等到那时候,该留的控制牌早就打光了。
 * 实测(200 局自对弈):庄家 39% 的局丢掉最后一墩,平均埋底 11.6 分,
 * 每局白送闲家 9.3 分(已含 ×2)—— 比 v3.1 相对 v3.0 的全部收益还大。
 * 所以「收官从第几张牌算起」和「收官该留多少手」都应该由**底分**决定,而不是常数。
 */
function kittyPts(X){ return X._kp!==undefined?X._kp:(X._kp=kittyPointsEst(X)); }

/* 抠底倍数(v0.6.0)—— 以前是常数 2,现在按**最后一墩会出几张**估。
 *
 * 引擎的口径是 `RULES.kittyMultiplier = 2 × 最后一墩每人出牌数`:单张 ×2、对子 ×4、
 * 拖拉机 ×8。AI 侧一直写死 `AIP.kittyMult = 2`,也就是永远假设最后一墩是单张。
 * 实测 12.0% 的局最后一墩不是单张 —— 但更要紧的是,**这件事是可控的**:
 * 谁赢下倒数第二墩,谁就决定最后一墩出几张。手上留一个钢板**对子**去守最后一墩,
 * 抠底就从 ×2 变 ×4;旧口径里「留一对」和「留一张」拿到的护底价值完全相同,
 * AI 因此从来不会为了翻倍去保一对。
 *
 * 估法:看 reserveUnit(最可能撑到最后一墩的那一手)的张数 —— 它就是我打算用来
 * 守最后一墩的牌。手牌不够长时封回去(剩 1 张不可能出一对)。
 * 对手赢下最后一墩时倍数由**他**决定,这里估不了,退回 2 是保守的。
 */
function kittyMultOf(X){
  if(!AIP.kittyMultDyn) return AIP.kittyMult;
  if(X._km!==undefined) return X._km;
  const ru=X.hand&&X.hand.length?reserveUnit(X):null;
  const size=ru?Math.min(ru.size,X.hand.length):1;
  return X._km=2*clamp(size,1,AIP.kittyMultMaxSize);
}
// 底分越大,「最后一墩争夺」越该提前开始规划
function endHorizonOf(X){
  return clamp(AIP.endHorizon+kittyPts(X)*AIP.endHorizonPerPt,AIP.endHorizon,AIP.endHorizonMax);
}
// 收官的留手折扣:底分 0 → 0.15(该兑现就兑现);底分 20 → ≈1.05(比中盘更该留控制牌)
function phaseK(X){
  if(X.phase!=='end') return PHASE_K[X.phase];
  return clamp(PHASE_K.end+kittyPts(X)*AIP.endPhaseKPerPt,PHASE_K.end,AIP.endPhaseKCap);
}

/* 一张主牌的留手价值(v4)。
 * v3 写的是 `2.5 + ordIdx × 0.5`(级牌固定 7、单王固定 8/6)—— 按**牌面序号**线性give。
 * 问题是 ordIdx 是绝对刻度:一对主 A(ordIdx≈24)算出来 14.5、王对 18,
 * 「全场第三大的主」和「全场第十大的主」在这条线性式子里差得很近。
 * 于是 AI 会为了护住王对,先把主 A、主 K 撒光,再在没牌权时被迫打王对 ——
 * 「过早打大王对、把自己消耗完」有一半根源在这里。
 * 正确的刻度是**相对刻度**:在外还有几张压得住它。全场最大的那张,不管它 ordIdx 多少,
 * 留手价值都该顶格;在外还有一半主牌压得住它,价值就该腰斩。
 */
function trumpHold(c, X){
  const {mem,trump}=X;
  if(!mem||!mem.unseen) return AIP.trumpHoldBase;
  const idx=ordIdx(c,trump);
  let higher=0,total=0;
  for(const k in mem.unseen){
    const n=mem.unseen[k]; if(n<=0) continue;
    const u=keyToCard(k);
    if(effSuit(u,trump)!=='T') continue;
    total+=n;
    if(ordIdx(u,trump)>idx) higher+=n;
  }
  return AIP.trumpHoldBase+AIP.trumpHoldTop*(1-(total>0?higher/total:0));
}

// 机会成本:这手牌留着以后打的期望价值(折算成分)
function futureValue(cards, X){
  const trump=X.trump, ph=phaseK(X);
  let v=0, flat=0;        // flat 部分不随 phase 折算
  // 收官:留住最大的一手 = 守住(或抢下)翻倍的底分。
  // 这一项恰恰只在收官视野内成立,所以不能再乘 phaseK 那个衰减系数。
  const hz=endHorizonOf(X);
  if(X.hand&&X.hand.length<=hz){
    const kp=kittyPts(X);
    // 「保底手」只需要一手 —— 手上三个钢板单元,留一个守最后一墩就够,
    // 另外两个该在收官前兑现掉。v3 把这份护底价值发给**每一个**钢板单元,
    // 于是它们互相锁死,谁也不肯先出,最后被对手用小牌一张张耗光。
    const ru=kp>0?reserveUnit(X):null;
    if(ru&&cards.some(c=>ru.ids.has(c.id))){
      /* 代价是**边际**的,不是全额的。
       * 手上如果还有第二手钢板,打掉大王还剩小王,护底能力并没有归零 ——
       * 旧版按「失去全部护底能力」计价,于是两手钢板互相把对方钉死,
       * 谁都不肯先出,连拦一个带分的将牌墩都不肯。
       * 再乘上 reserveHold:这手到底能不能撑到最后一墩本来就是个概率,
       * 它算出来了(reserveUnit 就是按它排序的),却一直没乘进价值里 ——
       * 副牌单张护底和大王护底拿的是同一份加值,显然不对。 */
      /* 越接近最后一墩,这一手「全场最大」越等价于底牌那笔翻倍的分。
       *
       * v4.4 修的是**曲线**,不是权重。原来 near 是线性的
       * `1-(len-1)/hz`,在收官视野的入口几乎等于 0,只有到最后一两墩才接近 1 ——
       * 也就是「该开始留手的时候一分不给,留不留已成定局的时候才给满」。
       * v0.5.1 我把权重从 0.55 抬到 5.0 去补这条曲线,补出了一个量纲错误:
       * 底估 16 分时 flat = 16×2×0.85×5 ≈ 136,而整个打分器的典型量级是个位数 ——
       * 它不再是权重,是一条硬约束,收官阶段这张牌的任何用途都被一票否决,
       * 包括拦住末家把一个将牌墩连分带牌权拿走(将牌门有 50 分,人均 12.5)。
       *
       * 现在两条都摆正:
       *   · 曲线用 gamma<1 的幂,视野一进入就给到大半,而不是到最后才给;
       *   · 天花板锁在**它保护的那笔分**上 —— 守最后一墩这个期权,
       *     再值钱也不可能超过底牌那笔翻倍的分本身。 */
      /* v0.5.8 ①③ —— 这一项旧版是一条**阶跃函数**,同一个数值制造了两条方向相反的反馈。
       *
       * 实测(底分≈13)一张大王的 futureValue 随剩余张数:
       *     剩12/9/7 张 → 11.5(护底 0)   ← 前 19 墩护底价值恒为零
       *     剩 6 张 → 34.9(护底 24.1)    ← 视野一开就是断崖
       *     剩 3 张 → 97.7   剩 1 张 → 139.0
       * 而它保护的那笔分只有 kp×kittyMult = 26.6 —— 峰值是被保护对象的 5 倍,
       * 整个打分器的典型量级却是个位数到二十几。于是:
       *   · 中盘一分不给 → 「底里超过10分却提前没了保底手段」(反馈①);
       *     叠上 controlPremium 那个 bug(大小王被当便宜主牌先烧),保底牌中盘就没了。
       *   · 收官一票否决 → 「断门有分却不毙」(反馈③):实测收官 5 张、对手♦K(10分)
       *     暂大、我♦断门手持大王,AI 选择不毙(毙 −35.2 vs 跟小 −3.1)。
       *
       * near 上面那段注释说 v4.4 已经改成「gamma<1 的幂 + 天花板锁在它保护的那笔分上」——
       * 代码里两条都没有,正式版 v0.5.2 也一样(合并时丢了,或者方案没落地)。现在补上:
       *   ① 凹曲线:视野一进入就给到大半,而不是到最后一两墩才给满;
       *   ② 封顶在 kp×kittyMult:守最后一墩这个期权,再值钱也不可能超过它保护的那笔分;
       *   ③ 视野前移:endHorizon 5 + 每分 0.25 张(旧:4 + 1/6),底分 13 时从 8 张起算,
       *      刚好接上中盘尾段,消掉 0→24 那个断崖;
       *   ④ reserveMarginal 加下限:旧版 `v *= max(0, p(最好) − p(次好))`,
       *      手上有大王(0.95)和小王对(0.90)时这个系数是 **0.05**,护底直接归零、
       *      两手全被兑现掉 —— 「别让两手钢板互相钉死」的动机对,实现却让**牌越好护底越弱**。
       *      现在下限锁在 reserveFloor:再有后备,也总得有一手真的留到最后。
       * 全部可退回:endNearGamma=1 / endKittyCap=0 / reserveFloor=0。 */
      const raw=Math.max(0,1-(X.hand.length-1)/Math.max(1,hz));
      const near=AIP.endNearGamma&&AIP.endNearGamma!==1?Math.pow(raw,AIP.endNearGamma):raw;
      const km=kittyMultOf(X);                          // v0.6.0:按最后一墩会出几张估,不再是常数 2
      let v=AIP.endKittyCap>0
        ? kp*km*AIP.endKittyCap*near                     // 曲线决定爬多快,天花板锁在 stake
        : kp*km*near*AIP.endKittyWeight;                 // 旧口径:无封顶
      if(AIP.reserveMarginal){
        const gone=new Set(cards.map(c=>c.id));
        const fallback=bossUnits(X).filter(u=>![...u.ids].some(id=>gone.has(id)))
                      .map(u=>reserveHold(u,X)).sort((a,b)=>b-a)[0]||0;
        v*=Math.max(AIP.reserveFloor,reserveHold(ru,X)-fallback);
      }
      /* v0.6.0:护底项也要过阶梯权重。
       * `scorePlay` 是 `ev*(X.pw) + tempo − futureValue(...)` —— ev 乘了 pw、
       * futureValue 没乘,于是「拿下当前这一墩」和「留守最后一墩」这两只手臂
       * 用的是**两把不同的尺子**。它们比的是同一种东西(把局面推过哪条阶梯线),
       * 该用同一个权重。guardPw=0 退回旧行为。 */
      flat+=AIP.guardPw?v*(X.pw||1):v;
    }
  }
  const jokers=cards.filter(c=>c.suit==='X');
  const bj=jokers.filter(c=>c.rank===16).length, sj=jokers.filter(c=>c.rank===15).length;
  // 王对:全场最大的压制力,留到收官能护住翻倍的底。
  // v4 注意:每张王的「在外已无更大」价值已经由下面的 trumpHold 记过一遍了,
  // 这里**只记成对的额外溢价**(对子能压对子、能整体吃拖拉机),否则同一份价值算两遍 ——
  // 实测那样会让王对的 Future 膨胀到 60+,收官该兑现的时候也兑现不出来。
  if(bj>=2) v+=AIP.jokerPairHold+(X.isDecl?AIP.jokerPairDecl:0);
  if(sj>=2) v+=(AIP.jokerPairHold+(X.isDecl?AIP.jokerPairDecl:0))*0.7;
  for(const c of cards){
    if(effSuit(c,trump)==='T'){
      // 主牌稀缺:毙牌权本身值钱,拿低主去毙一墩空气是亏的
      v+=trumpHold(c,X);
    }else{
      const rem=unseenPointsIn(X.mem,effSuit(c,trump),trump);
      if(c.rank===14) v+=6+0.26*rem;                    // 副A:以后还能捞这门的分
      else if(c.rank===13){
        v+=2+0.10*rem;
        if(cards.length===1&&X.hand&&X.hand.some(h=>h.suit===c.suit&&h.rank===14))
          v+=8;                                          // 手握 A 时留 K:以后 A+K 一起撒
      }
      // 分牌留在手里是负债:迟早要出,拖到没牌权时更可能白送给对手。
      // 这条让「队友只有六七成把握时到底贴不贴」不至于一味保守。
      // 只在跟牌时成立 —— 领出分牌是主动送分,不该因为「反正迟早要出」被鼓励。
      if(!X.leading) v-=cardPoints(c)*0.30;
    }
  }
  return v*ph+flat;
}

// 在外(别家手里)这门还剩多少张、其中多少张压得住 cl
function unseenBeats(mem, cl, trump){
  let higher=0, total=0, pairRanks=0;
  for(const k in mem.unseen){
    const n=mem.unseen[k]; if(n<=0) continue;
    const c=keyToCard(k);
    if(effSuit(c,trump)!==cl.suit) continue;
    total+=n;
    // 对子/拖拉机要压住得成对,单张只要更大就行
    if(ordIdx(c,trump)>cl.top && (cl.type==='single'||n>=2)) higher+=n;
    if(ordIdx(c,trump)>cl.top && n>=2) pairRanks++;
  }
  return {higher,total,pairRanks};
}

/* 「他手上有没有压得住这一手的牌」—— 单张和对子是两个完全不同的组合问题(v4.8)。
 *
 * 单张:从这门在外的 total 张里他摸走 k 张,只要有一张更大就行 → 1−(1−higher/total)^k
 * 对子:得**同一个点数的两张都在他一个人手上**。在外还剩两张的点数有 m 个,
 *       指定一个点数两张都落到他手上的概率是 k(k−1)/(total(total−1)) ——
 *       同一个坛子,但比单张低一个数量级。
 *
 * 旧版把这两件事按同一个公式算(higher 里把对子的两张都记成能压),
 * 等于按 100% 估「这两张在同一家手里」。举例:这门在外 6 张、其中两个点数各剩两张、
 * 对手约摸 1.5 张 —— 旧版算出 0.81,实际是 0.05。系统性高估「我的对子会被压」,
 * AI 因此既不敢出对子、也不敢把对子算成钢板。这就是 v0.5.5 里
 * pPairAbove 只当布尔阈值用、没接进打分的那一半。
 * 拖拉机还得连着,更难,按 need 再收一道。
 */
function pBeaterIn(cl, b, k){
  const {higher,total,pairRanks}=b;
  if(total<=0||k<=0) return 0;
  if(!AIP.pairUrn||!cl||cl.type==='single') return 1-Math.pow(1-higher/total,k);
  const need=cl.type==='tractor'?(cl.len||2):1;
  if(!pairRanks||pairRanks<need||total<2||k<2) return 0;
  const q=k*(k-1)/(total*(total-1));
  let p=1-Math.pow(1-q,pairRanks);
  if(need>1) p=Math.pow(p,need)*AIP.tractorTighten;
  return clamp(p,0,1);
}

// 一手牌摆上台面后,还能活到墩末(不被指定的几个对手压掉)的概率。
// 这是 v3 替换掉 v2 里 0.9/0.35 那几个魔法系数的地方 —— 概率直接从记牌算:
// 「在外还剩几张能压我」+「他可能缺门来毙」。「队友暂大不是稳大」由此量化。
function pSurvive(X, cl, seats){
  if(!seats||!seats.length) return 0.99;
  const {mem,trump}=X;
  const leadSuit=X.lead?X.lead.suit:cl.suit;
  const iRuffed=cl.suit==='T'&&leadSuit!=='T';        // 我这手是毙牌
  const beats=unseenBeats(mem,cl,trump);             // 在外能压住我这手的牌
  const {higher,total}=beats;
  const lsTotal=leadSuit==='T'?0:unseenBeats(mem,{suit:leadSuit,top:-1,type:'single'},trump).total;
  const trAvail=unseenBeats(mem,{suit:'T',top:-1,type:'single'},trump).total;
  // 他手上这门大约几张 = 这门在外的张数 × 他占未见牌的比例。
  // 这个比例不是常数:开局未见 3×25+8=83 张、他占 25/83≈1/3.3;
  // 收官未见 3×5+8=23 张、他占 5/23≈1/4.6。用实际手牌数算,别拍一个 3。
  const denom=X.shareDenom||AIP.handShare;
  const k=total>0?Math.max(1,total/denom):0;
  const pHas=pBeaterIn(cl,beats,k);
  let p=1;
  for(const s of seats){
    const knownVoid=leadSuit!=='T'&&X.voids[s]&&X.voids[s][leadSuit];
    // 他在「领出的那一门」断门的概率 —— 毙牌与被毙都以这个为前提。
    // 优先用从出牌方式反推出来的概率(makeReads),没有推断时退回按门厚薄的粗估。
    const pVoidLead=leadSuit==='T'?0
      :(knownVoid?1
        :(X.pVoidOf?X.pVoidOf(s,leadSuit):Math.exp(-lsTotal/6)*0.5));
    let pBeat;
    if(iRuffed){
      // 我已经毙了。他要盖过我,得先在领出门也断门,再拿出更大的主牌 ——
      // 旧版漏了「他也得断门」这个前提,把毙牌的存活率算得极低,于是 AI 几乎从不毙。
      pBeat=pVoidLead*pHas*(X.ptsTable>0?0.90:0.50);   // 空气墩未必值得他花主牌
    }else if(knownVoid){
      pBeat=(X.ptsTable>0?0.80:0.35)*(trAvail>0?0.85:0);   // 已知缺门 → 只可能被毙
    }else{
      pBeat=(1-pVoidLead)*pHas
           +pVoidLead*(X.ptsTable>0?0.80:0.35)*(trAvail>0?0.85:0);
    }
    p*=1-clamp(pBeat,0,0.97);
  }
  return clamp(p,0.02,0.99);
}

/* 对手暂大、队友还没出牌时,队友把它压回来的概率(v4.1)。
 *
 * v3/v4.0 这里是两个魔法常数 0.32 / 0.02 —— 而这恰恰是「下家该不该直接贴分」的决策点:
 * 若我(第二家)推断出末家的队友握着这门的绝对大牌,正确打法是**直接把分贴上去**,
 * 让中间两家去比大小、由队友末手收走。一个拍死的 0.32 表达不了这件事,
 * 于是 AI 永远在「跟小保守」和「盲目贴分」之间摇摆。
 *
 * 改成和 pSurvive 同一套记牌口径:队友在这门大约有几张、其中几张压得住当前最大,
 * 加上他可能断门来毙;再乘上他之后还有没有对手要过。
 */
function pPartnerTakes(X){
  if(!X.partnerRemaining) return AIP.pNoPartnerLeft;   // 队友已出过牌,只能指望对手内讧
  const {mem,trump}=X;
  const leadSuit=X.lead?X.lead.suit:X.cur.cl.suit;
  const beats=unseenBeats(mem,X.cur.cl,trump);
  const {total}=beats;
  const denom=X.shareDenom||AIP.handShare;
  const k=total>0?Math.max(1,total/denom):0;
  const pHas=pBeaterIn(X.cur.cl,beats,k);                // 队友手上压得住的密度
  const pVoid=leadSuit==='T'?0
    :(X.partnerSeat!==undefined&&X.pVoidOf?X.pVoidOf(X.partnerSeat,leadSuit):0.12);
  const trAvail=unseenBeats(mem,{suit:'T',top:-1,type:'single'},trump).total;
  const pRuff=(X.ptsTable>0?0.80:0.35)*(trAvail>0?0.85:0);
  const take=(1-pVoid)*pHas+pVoid*pRuff;
  // 队友之后还有对手要过 → 他压回来了也未必守得住
  const after=X.oppAfterPartner?AIP.partnerHoldAfter:1;
  // 往 v3 那个常数 0.32 收缩。`take` 算的是「队友手上有没有压得住的牌」,
  // 不等于「他一定会把它打出来并守住」—— 实测直接用 take 会让 AI 过度把责任推给队友、
  // 该争的墩也不争了(每局 −3.6 分)。所以只把它当**证据**用:证据越偏离先验,才越往那边挪。
  return clamp(AIP.pPartnerPrior+AIP.pPartnerCalc*(take*after-AIP.pPartnerPrior),0.02,0.95);
}

// 我出这手之后,本队最终赢下这墩的概率
function pTeamWin(X, cards, beatsCur){
  const cl=classify(cards,X.trump);
  if(!beatsCur){
    // 对手暂大:只能指望后手的队友把它压回来
    if(!X.partnerWinning) return pPartnerTakes(X);
    return X.certainty;                                    // 队友暂大:活到墩末的概率
  }
  if(X.isLast) return 1;
  if(!cl) return 0.5;
  return pSurvive(X,cl,X.remainingOpp);
}

// 从出牌历史还原本局比分:闲家已抓多少分,场上还剩多少分没定归属
function roundScore(view){
  const h=view.history||[], trump=view.trump;
  let def=0, taken=0;
  for(let i=0;i+3<h.length;i+=4){
    const res=resolveTrick(h.slice(i,i+4),trump);
    taken+=res.points;
    if(view.declSeat>=0 && res.winner%2!==view.declSeat%2) def+=res.points;
  }
  return {def, live:Math.max(0,200-taken)};
}

/* 阶梯目标里的「当前总分」必须含**那笔待翻倍的底分**(v0.6.0)。
 *
 * `roundScore` 只统计已经打完的墩,`def` 里从头到尾没有底牌 —— 可底牌那笔分
 * 是按 `分值 × 最后一墩每人出牌数 × 2` 结算给赢下最后一墩的一方的,
 * 它往往比场上任何一墩都大。实测:**56.9% 的局,底分×倍数单独就足以跨过 80 线。**
 * 也就是说超过一半的局面里,AI 的阶梯目标算的是一个缺了大头的分数,
 * `pointWeight` 于是在错误的位置上找「哪条线最敏感」。
 *
 * 补法:按期望把它折进 `def`。闲家赢下最后一墩的概率,收官前没有更好的估计,
 * 就用先验 0.5;进了收官视野之后用「我这手护底牌撑得到最后一墩的概率」来偏。
 * 这只改**阶梯目标落在哪里**,不改任何一笔真实收益的计价。
 */
function kittyProjection(X){
  if(!AIP.ladderKitty) return 0;
  const kp=kittyPts(X);
  if(kp<=0) return 0;
  const km=kittyMultOf(X);
  const iAmDef=!X.isDecl;
  let pDef=0.5;
  const ru=X.hand&&X.hand.length?reserveUnit(X):null;
  if(ru){
    const hold=reserveHold(ru,X);
    pDef=iAmDef?clamp(0.5+0.5*(hold-0.5),0,1):clamp(0.5-0.5*(hold-0.5),0,1);
  }
  return kp*km*pDef;
}

// 局末目标不是「攻守 80 分」这一根线,而是一排阶梯,且随局面动态改变现实目标。
// 引擎的结算口径就是阶梯的来历(scoreRound / advanceMatch):
//   闲家 0 分   → 庄家升 3 级        闲家 120 分 → 闲家升 1 级
//   闲家 <40    → 庄家升 2 级        闲家 160 分 → 闲家升 2 级
//   闲家 <80    → 庄家升 1 级        闲家 200 分 → 闲家升 3 级
//   闲家 ≥80    → 闲家上台(升 0 级)
// 所以真正的临界点是 0/40/80/120/160/200 一整排。抢到 40 分免被跳 2 级、
// 或抢 120 分多升一级,都可能在某个局面下取代「够 80」成为现实目标。
const SCORE_LADDER=[0,40,80,120,160,200];

// 此刻一分值多少 = 它把局面推过某条临界线的边际概率。
// 对每条临界线放一个高斯包,取上包络 —— 离哪条线近就为哪条线拼。
// 这个权重只乘期望收益、不乘机会成本,于是它调的正是「现在兑现 vs. 留着压制」的天平。
function pointWeight(def, live){
  if(live<=0) return 1;
  const sigma=Math.max(8,live*0.30);
  let best=0;
  for(const L of SCORE_LADDER){
    const gap=L-def;                       // 闲家还差多少分到这条线
    if(gap<0||gap>live) continue;          // 已越过、或本局无论如何够不着
    // gap 落在「还剩的分」的可达中段时最敏感;贴着 0 或贴着 live 都已基本注定
    best=Math.max(best,Math.exp(-Math.pow(gap-live/2,2)/(2*sigma*sigma)));
  }
  return 1+AIP.pwGain*(best-0.6);          // 以典型局面为 1,只在胜负敏感区上下浮动
}

// 后手还会往这一墩里加多少分。
// 旧版是四个拍死的常数,于是「第三家跟小、末家对手用一张 10 极低代价拿走这墩」
// 这种亏永远算不出来。改为按记牌估:这门在外还剩多少分,大致三家均分,
// 谁还没出牌、他缺不缺这门,决定他掏得出多少。
function laterPoints(X, weWin){
  const ls=X.lead?X.lead.suit:null;
  const share=ls?unseenPointsIn(X.mem,ls,X.trump)/3:0;   // 每家在这门大约握着多少分
  let add=0;
  if(X.partnerRemaining) add+=weWin?Math.min(10,share*AIP.dumpPartner):Math.min(3,share*0.15);
  for(const s of X.remainingOpp){
    const known=ls&&X.voids[s]&&X.voids[s][ls];
    add+=weWin?Math.min(3,share*0.25)
              :Math.min(10,share*AIP.dumpOpp*(known?1.3:1));  // 末家能便宜掏出一张10时,这里就是10
  }
  return add;
}

// ---- 跟牌共享上下文(AI 与教练同一标尺) ----
function followCtx(view, plays){
  const trump=view.trump;
  const lead=classify(plays[0].cards,trump);
  const cur=currentWinner(plays,trump);
  const partnerWinning=cur.seat%2===view.seat%2;
  const isLast=plays.length===3;
  const ptsTable=countPoints(plays.flatMap(p=>p.cards));
  const mem=makeMemory(view);
  const voids=makeVoids(view.history||[],trump);
  const leader=plays[0].seat;
  const remaining=[];                       // 我之后还没出牌的座位
  for(let i=plays.length+1;i<4;i++) remaining.push((leader+i)%4);
  const remainingOpp=remaining.filter(s=>s%2!==view.seat%2);
  const partnerSeat=(view.seat+2)%4;
  const partnerRemaining=remaining.includes(partnerSeat);
  // 队友之后还有没有对手要出牌(决定他压回来了守不守得住)
  const oppAfterPartner=partnerRemaining&&
    remaining.slice(remaining.indexOf(partnerSeat)+1).some(s=>s%2!==view.seat%2);
  // 后手对手在本门缺门 → 即使钢板也可能被敲脱("毙上家放下家")
  const oppRuffRisk=lead.suit!=='T'&&remainingOpp.some(s=>voids[s][lead.suit]);
  const curBoss=isBossPlay(cur.cl,mem,trump)&&!oppRuffRisk;
  const isDecl=view.declSeat!==undefined&&view.declSeat>=0&&view.declSeat%2===view.seat%2;
  const reads=makeReads(view.history||[],trump);
  const pVoidOf=makeVoidProb(reads,mem,trump,view.hand.length);
  const oppVoidP=s=>Math.max(...[0,1,2,3].filter(p=>p%2!==view.seat%2).map(p=>pVoidOf(p,s)),0);
  let unseenTotal=0;
  for(const uk in mem.unseen) unseenTotal+=Math.max(0,mem.unseen[uk]);
  const shareDenom=clamp(unseenTotal/Math.max(1,view.hand.length),2,8);
  const X={shareDenom,trump,lead,cur,partnerWinning,isLast,ptsTable,mem,voids,hand:view.hand,
           remainingOpp,partnerRemaining,partnerSeat,oppAfterPartner,oppRuffRisk,curBoss,isDecl,reads,pVoidOf,oppVoidP,
           buriedKnown:view.buriedKnown,phase:phaseOf(view.hand.length)};
  // 队友「暂大」不是「稳大」:确定性由记牌算出,不再是拍脑袋的常数
  X.certainty=isLast?1:pSurvive(X,cur.cl,remainingOpp);
  const rs=roundScore(view); X.def=rs.def; X.live=rs.live;
  X.pw=pointWeight(rs.def+kittyProjection(X),rs.live);
  return X;
}

/* ---- 牌权价值 ----
 * 低主毙牌真正的决策点不是「这墩值几分」,而是「牌权归我 vs. 牌权给暂大的那家」哪个好。
 * 牌权归我 = 下一手能立刻兑现手上的优势;牌权给对手 = 他去兑现他的优势,我还可能被逼贴分。
 * 优势手随墩数推移更可能被拆散(飞机大炮、连对尤其如此,带分的更该早点兑现),
 * 所以待兑现单元的价值要按「还能完整存活多久」打折。
 */
// 手上「拿到牌权就能立刻兑现」的单元清单,每个决策只算一次
function bossUnits(X){
  if(X._bu) return X._bu;
  const trump=X.trump, bySuit={};
  (X.hand||[]).forEach(c=>{(bySuit[effSuit(c,trump)]=bySuit[effSuit(c,trump)]||[]).push(c);});
  const out=[];
  for(const s in bySuit){
    for(const comp of decompose(bySuit[s],trump)){
      const cl={type:comp.type,len:comp.len,suit:s,top:comp.top};
      if(!isBossPlay(cl,X.mem,trump)) continue;
      const rem=unseenPointsIn(X.mem,s,trump), size=comp.cards.length;
      let val=Math.min(10,rem*0.33)*Math.min(1,size*0.6)+size*1.2;
      // 组合越大越怕被拆:对子/拖拉机等不起,单张无所谓
      if(comp.type!=='single') val*=1+AIP.fragileBonus*(size-1);
      out.push({ids:new Set(comp.cards.map(c=>c.id)), val, suit:s, top:comp.top, size});
    }
  }
  return X._bu=out;
}
/* 保底手(v4)。
 * 底牌由赢下最后一墩的一方以 分值×最后墩张数×2 拿走 —— 实测庄家 39% 的局丢掉最后一墩,
 * 每局白送闲家 9.3 分。守住它只需要**一手**牌,不是每一手大牌都要留。
 * 所以护底价值只发给「最可能撑到最后一墩」的那一个单元:
 * 主牌钢板 > 副牌钢板(副牌随时可能被毙),同类里取最大的一手。
 */
/* 一个钢板单元能撑到最后一墩的概率(v4.2)。
 *
 * 「钢板」只说明本门在外已无更大,不说明它保得住 —— 保底靠的是**别人毙不掉**:
 *
 *   副牌单张   最不可能独大到最后:任何一个对手在这门断门,一张主就毙掉了
 *   副牌对子   好一档:毙它需要**一对**主牌,张数结构得对得上
 *   副牌多张   更难毙(要凑出同结构的一手主),但它有另一个前提 ——
 *              必须在倒数第二墩就握着牌权,否则领不出来,优势等于零
 *   主牌大小王 / 主色级数牌 / 主牌对子   才是常规的护底选择
 *
 * v4.0 那版排序键是 `(主?1e6:0) + top*100 + size`,在副牌里 top 压过 size,
 * 等于**优先挑副牌单张去护底** —— 恰好挑中了最不可能守住的那一类。
 */
function reserveHold(u, X){
  const {mem,trump}=X;
  if(u.suit==='T'){
    // 主牌:只可能被更大的主牌压掉
    const {higher,total}=unseenBeats(mem,{suit:'T',top:u.top,type:u.size>1?'pair':'single'},trump);
    return 0.95*(total>0?1-higher/total:1);
  }
  // 副牌:毙牌要张数结构对得上,组合越大越难凑
  const q=u.size>=3?AIP.ruffStruct3:u.size===2?AIP.ruffStruct2:AIP.ruffStruct1;
  const pv=X.oppVoidP?X.oppVoidP(u.suit):0.3;
  const trAvail=unseenBeats(mem,{suit:'T',top:-1,type:'single'},trump).total;
  if(trAvail<=0) return 0.9;                       // 主牌出尽,副牌钢板才真的是钢板
  // 两个对手各有一次机会毙掉它;再打一个折,表示「副牌护底还得先拿到倒数第二墩的牌权」
  return Math.pow(1-pv*q,2)*AIP.sideReserveDamp;
}
function reserveUnit(X){
  if(X._ru!==undefined) return X._ru;
  const us=bossUnits(X);
  if(!us.length) return X._ru=null;
  return X._ru=us.slice().sort((a,b)=>reserveHold(b,X)-reserveHold(a,X))[0];
}

// 只算**打完这一手之后**还剩的待兑现单元 —— 否则和 futureValue 里
// 「这张 A 留着还能捞多少分」重复计价,同一份价值被算两遍。
/* 牌权值多少 = 拿到牌权之后,还能兑现哪些牌(v4.2 改成**贴现和**)。
 *
 * 旧版是把所有待兑现单元的价值直接相加再截顶。但牌权只保证**下一墩**由我领出:
 * 最好的那一手能立刻兑现,第二好的要等我再拿一次牌权,以此类推,越往后越不确定。
 * 所以按价值降序排,乘一条几何贴现 —— 「下一轮权重最高,往后递减」。
 * 这条曲线自己会收敛,不再需要 tempoCap 那个硬截顶把好手一律压平。
 */
function tempoValue(X, exclude){
  const drop=exclude||[];
  const vals=bossUnits(X).filter(u=>!drop.some(c=>u.ids.has(c.id)))
                         .map(u=>u.val).sort((a,b)=>b-a);
  let v=0, w=1;
  for(const val of vals){ v+=val*w; w*=AIP.tempoDecay; }
  return Math.min(v,AIP.tempoCap);
}


// 统一的期望分打分器:先定性(cat),再算这一墩的净期望分,最后扣机会成本
const CAT_K={ruff:1.06, over:1.0, dump:1.0, cheap:1.0, discard:1.0};
function scorePlay(X, cards, cat, beatsCur){
  const my=countPoints(cards);
  const p=pTeamWin(X,cards,beatsCur);
  const gain=X.ptsTable+my+laterPoints(X,true);
  const loss=X.ptsTable+my+laterPoints(X,false);
  const ev=p*gain-(1-p)*loss;
  // 牌权:本队赢下这墩,下一手由我方领出(我或队友),手上的优势才有机会兑现。
  // 输掉则牌权落到对手,他去兑现他的 —— 我方看不见对手手牌,用一个保守的固定值代表。
  const tempo=(p*tempoValue(X,cards)-(1-p)*AIP.oppTempo)*AIP.tempoWeight;
  return (CAT_K[cat]||1)*ev*(X.pw||1)+tempo-futureValue(cards,X);
}
// 兼容旧接口(教练/测试仍在用)
function scoreWinPlay(X,cards){ return scorePlay(X,cards,
  classify(cards,X.trump)&&classify(cards,X.trump).suit==='T'&&X.lead.suit!=='T'?'ruff':'over',true); }
function scoreDumpPlay(X,cards){ return scorePlay(X,cards,'dump',false); }
function scoreCheapPlay(X,cards){ return scorePlay(X,cards,'cheap',false); }

/* 「接过队友」这条候选开在哪些局面(v4.3)。
 * 全开(scope=2)实测掉分:多数时候队友本来就守得住,白烧一张大牌。
 * 真正吃亏的是两类有明确因果的局面,只在这两类里开:
 *   1) 将牌墩 —— 队友调王(领出小主找支援),标的本来就是牌权,
 *      没人接的话末家对手一张 10/K 连分带牌权全拿走;
 *   2) 桌上有分 + 我在领出门断门 —— 队友那张副花 K 只是"暂大",
 *      末家掏出 A 就整份送出去,这时我手上的主牌是该花的。
 */
function takeOverScoped(X, view){
  if(!AIP.takeOverScope) return false;
  /* v0.5.8 ②:收官阶段对**将牌墩**放开。
   *
   * 旧注释说「调王本来就是中盘战术,收官阶段没有『调』这回事」。插桩打脸:
   * 400 局里 AI 自己领出的调主共 193 次,**92.7% 发生在 end 阶段**,mid 只有 7.3%,
   * open 一次都没有。原因是 tiaoWangValue 的前提是「对手主门持有**下界** > 0」,
   * 而下界来自 makeHoldRange 的「手牌数 − 其他门上界之和」—— 这个约束只有在
   * 别的门都被演绎压低之后才为正,也就是牌快打完的时候。
   * 于是 AI 有九成的调主打在队友被代码禁止响应的阶段,「调王没人接」是必然的。
   *
   * 当初关掉收官档的理由是「那一档的不接是护底锁造成的」—— 那是 futureValue 里
   * 护底 flat 项没封顶的问题(见 ⑥),不该由这道闸门代偿。护底项修好之后,
   * 该不该接自然由打分决定:真的只剩一手护底牌时,封顶后的 26 分仍然压得住。
   * takeOverEndTrump=0 即退回旧行为。 */
  if(X.phase==='end') return !!(AIP.takeOverEndTrump&&X.lead.suit==='T');
  if(AIP.takeOverScope===2) return true;
  const voidRuff=X.ptsTable>=AIP.takeOverMinPts
                 && !view.hand.some(c=>effSuit(c,X.trump)===X.lead.suit);
  if(AIP.takeOverScope===3) return voidRuff;       // 只留断门毙分(消融用)
  if(AIP.takeOverScope===4) return X.lead.suit==='T';  // 只留将牌墩(消融用)
  return X.lead.suit==='T' || voidRuff;
}

// 跟牌决策
function aiChooseFollow(view, plays){
  const X=followCtx(view,plays);
  const {trump,lead}=X;
  const cands=[];
  /* 同一手牌可能被两条不同的理由生成(比如「接过队友」和「跟分」常常就是同一张)。
   * 旧版遇到重复直接丢掉后来的那个 —— 于是先入的那条(可能带着罚分)会顶替掉
   * 本该以另一套口径打分的同一手牌,凭空改变了它的分数。改成留分高的那一条。 */
  const push=(cards,cat,beats,reason,penalty)=>{
    if(!cards) return;
    const score=scorePlay(X,cards,cat,beats)-(penalty||0);
    const dup=cands.find(c=>c.cards.length===cards.length
        &&c.cards.every((x,i)=>x.id===cards[i].id));
    if(dup){ if(score>dup.score){ dup.score=score; dup.cat=cat; dup.reason=reason; } return; }
    cands.push({cards,cat,score,reason});
  };
  /* v0.5.8:「我这一手打出去必定拿下这墩」—— 目前只有末家成立。
   * 它同时决定两件事:取牌时该不该顺手兑现分牌(cheapSort 的 certain),
   * 以及某些规则加成该不该生效(末家毙自己队友已锁定的墩是纯浪费)。 */
  const certain=X.isLast&&!X.partnerWinning;
  // 1. 跟大/毙牌 —— 最省的吃法
  if(!X.partnerWinning){
    const win=minWinFollow(view.hand,lead,trump,X.cur.cl,certain);
    if(win){
      const cl=classify(win,trump);
      const isRuff=cl&&cl.suit==='T'&&lead.suit!=='T';
      /* v0.5.8 ③:「对手暂大 + 我在领出门断门 + 台面有分 + 我有主」
       * 和 1c-0(队友暂大那一半)是**同一条规则**,只是当初只写了队友那一半。
       * 实测 400 局:队友那一半从 0% 提到 86.2%,而对手这一半仍停在 70.4% ——
       * 三成的机会被 futureValue 的留手价值压掉了。这里补上同等的规则级加成。
       * 已经被更大的主毙过(cur 是主而我这手也是主但压不过)的局面进不到这里:
       * minWinFollow 那时就返回 null。 */
      const voidRuffOpp=AIP.ruffOppRule&&isRuff&&X.ptsTable>=AIP.ruffOppMinPts;
      push(win,isRuff?'ruff':'over',true,
        X.isLast?(isRuff?'最后一手,毙掉收分':'最后一手,稳吃这墩')
                :(voidRuffOpp?'这门我断门、台面有分而对手暂大 —— 毙下来'
                 :(X.oppRuffRisk?'尝试吃,但后手或被毙':(isRuff?'断门毙牌抢分':'能吃住,争这墩'))),
        voidRuffOpp?AIP.ruffOppBonus:0);
    }
    /* 1b. 吃得**够高** —— 压过在外最大的那张分牌,而不只是压过当前最大。
     * 「最省的吃法」在中间两家常常不够:压过当前最大 ≠ 压过末家可能掏出的那张分牌。
     * 外有 K 就得打 A 以上,外只剩 10 打 J 以上就够。
     *
     * **不按座位设硬规则。** 一度写成「只发给队友已出过牌的那一家」,理由是
     * 「第二家烧 A 是越位」—— 这个理由站不住:第二家先出 A / 级数主也可以是**拿牌权**,
     * 最好的结果是四家贴分或三家被迫送分,退一步至少换来往后几墩的领出权。
     * 该由打分去权衡的事情,不该用位置规则砍掉候选。所以只要不是末手就都生成,
     * 剩下的交给 scorePlay:多花一张大牌 vs. 少送一墩分 vs. 拿到牌权。
     */
    if(AIP.blockWin&&!X.isLast&&X.remainingOpp.length)
      push(blockWinFollow(view.hand,lead,trump,X.cur.cl,X.mem),'over',true,
           '吃到在外最大分牌之上,封死末家用分牌拿墩');
  }
  /* 1c. 队友只是**暂大**时,也要能接过来(v4.3)。
   *
   * 旧版这一整组「吃/毙」候选包在 `if(!partnerWinning)` 里 —— 队友暂大就一张都不生成,
   * AI 只能在 贴分 / 跟小 / 垫牌 里挑。于是两类实战常见的亏损根本算不出来:
   *
   *   · 队友领出小主(调王),我手上有大主却只会跟小 —— 牌权没人接,
   *     末家对手一张 10/K 就把这墩连分带牌权拿走。
   *   · 队友出副花 K 暂大,我这门断门、手上有主,却因为"队友大着"不毙,
   *     末家对手掏出 A,桌上的分整份送出去。
   *
   * 不是"队友大就一定要压"——那会白白烧大牌。只是把候选**生成出来**,
   * 让 scorePlay 用同一把尺子去比:接过来的存活率是 pSurvive(我这张),
   * 让队友扛的存活率是 X.certainty(记牌算出来的),分、牌权、机会成本都已经在式子里。
   * 唯一的额外项是 overPartner —— 压自家队友本身有信息与配合上的代价,给一个固定罚分。
   * certainty 已经很高(队友基本稳赢)时不生成,省掉这份计算。
   */
  /* 1c-0. 队友暂大、我在领出门断门、台面有分 —— **默认就该毙**(v4.5)。
   *
   * 这不是一个打分问题,是一条规则。放着不毙唯一说得通的理由,是同时确定两件事:
   *   ① 队友那张就是本门在外最大(再没人压得住),并且
   *   ② 后手对手没人在这门断门(不会被毙掉)。
   * 这两条正好是 followCtx 里已经算好的 `curBoss`
   * (= isBossPlay(队友那张) && !oppRuffRisk)。**但凡这个合取不成立,就毙。**
   * 而且实战里还要防着下家断门用主色分牌来毙 —— 那是更该早毙的理由,不是不毙的理由。
   *
   * 实测(250 局):这类局面 398 次、台面共 4380 分,旧版只毙了 49.5%、覆盖 47.1% 的分。
   * 一半的分就这么摆在桌上不动。 */
  /* v0.5.8 ⑧:补上 `!X.isLast`。
   * 我是末家时,「队友暂大」= 队友**已经赢下这墩**(后面没人出牌了),
   * 而 curBoss 仍可能是 false(队友出 K、A 还没露面),于是这条规则照常触发、
   * 给毙牌一个 +25 的硬加成 —— AI 毙掉自己队友已经拿下的墩,纯浪费一张主。
   * 实测 400 局:这类局面 163 次,旧版毙了 51.5%(v0.5.2 是 0%)。
   * 这正是「修好一条、冒出另一条」的样本:合取式漏了一个前提。 */
  else if(!X.isLast&&!X.curBoss&&X.ptsTable>=AIP.ruffPartnerMinPts
          &&lead.suit!=='T'
          &&!view.hand.some(c=>effSuit(c,trump)===lead.suit)
          &&view.hand.some(c=>effSuit(c,trump)==='T')){
    const win=minWinFollow(view.hand,lead,trump,X.cur.cl);
    if(win) push(win,'ruff',true,
      '这门我断门、台面有分,而队友那张并非稳赢 —— 毙下来',AIP.ruffPartnerBonus);
    if(AIP.blockWin)
      push(blockWinFollow(view.hand,lead,trump,X.cur.cl,X.mem),'ruff',true,
        '毙到在外最大分牌之上,防末家用更大的主抢回去',AIP.ruffPartnerBonus);
  }
  else if(!X.isLast&&X.remainingOpp.length&&X.certainty<AIP.takeOverMaxCertainty
          &&takeOverScoped(X,view)){
    const win=minWinFollow(view.hand,lead,trump,X.cur.cl);
    if(win){
      const cl=classify(win,trump);
      const isRuff=cl&&cl.suit==='T'&&lead.suit!=='T';
      push(win,isRuff?'ruff':'over',true,
        isRuff?'队友只是暂大,后手对手能压 —— 断门毙下来':'队友只是暂大,后手对手能压 —— 接过牌权',
        AIP.overPartner);
    }
    if(AIP.blockWin)
      push(blockWinFollow(view.hand,lead,trump,X.cur.cl,X.mem),'over',true,
           '压到在外最大分牌之上,别让末家用分牌把队友这墩掀掉',AIP.overPartner);
  }
  // 2. 贴分 —— 队友大就送分,但确定性不够时收敛
  const dump=buildFollow(view.hand,lead,trump,'dump',null);
  push(dump,'dump',false,X.partnerWinning
    ?(X.certainty>0.8?'队友稳赢,贴分':'队友只是暂大,试贴分')
    :'跟分(躲不掉的分先出)');
  // 3. 跟小 —— 保留实力
  push(buildFollow(view.hand,lead,trump,'cheap',null),'cheap',false,'跟小,保留实力');
  // 4. 垫牌 —— 断门时死保不出分、不出主
  push(buildFollow(view.hand,lead,trump,'discard',null),'discard',false,'垫废牌,不送分也不拆主');
  cands.sort((a,b)=>b.score-a.score);
  const ctx={partnerWinning:X.partnerWinning,isLast:X.isLast,ptsTable:X.ptsTable,
             curSeat:X.cur.seat,curBoss:X.curBoss,leadSuit:lead.suit,phase:X.phase};
  if(cands.length){
    let best=cands[0];
    const eg=endgameSearch(view,plays,cands.slice(0,AIP.egMaxCands));
    if(eg){
      const cur=eg.find(o=>o.cards===best.cards);
      const top=eg.slice().sort((a,b)=>b.u-a.u)[0];
      if(top&&cur&&top.cards!==cur.cards&&top.u-cur.u>AIP.egMargin){
        const c=cands.find(x=>x.cards===top.cards);
        if(c) best={...c,reason:'收官推演:'+c.reason+`(${eg.samples}样本,净升 ${top.u.toFixed(2)} 级)`};
      }else if(cur) best={...best,reason:best.reason+`(收官推演确认,净升 ${cur.u.toFixed(2)} 级)`};
    }
    return {...best,cands,ctx};
  }
  return {cards:genFollow(view.hand,lead,trump,rng(view.seat+1)),reason:'兜底',score:0,cands:[],ctx};
}

// 教练用:给任意一手(合法)跟牌打分,与 aiChooseFollow 同一套标尺
function coachScoreFollow(view, plays, cards){
  const X=followCtx(view,plays);
  const cl=classify(cards,X.trump);
  let wouldWin=false;
  if(cl&&structMatches(cl,X.lead)){
    if(cl.suit===X.cur.cl.suit) wouldWin=cl.top>X.cur.cl.top;
    else if(cl.suit==='T') wouldWin=true;
  }
  let cat='cheap';
  if(wouldWin) cat=(cl&&cl.suit==='T'&&X.lead.suit!=='T')?'ruff':'over';
  else if(countPoints(cards)) cat='dump';
  else if(cards.some(c=>effSuit(c,X.trump)!==X.lead.suit)) cat='discard';
  let s=scorePlay(X,cards,cat,wouldWin);
  if(X.partnerWinning&&wouldWin) s-=5;          // 压过自己队友略减分
  return s;
}

// ---- 领出共享上下文与评分(AI 与教练同一标尺) ----
function leadCtx(view){
  const trump=view.trump;
  const mem=makeMemory(view);
  const voids=makeVoids(view.history||[],trump);
  const myTeam=view.seat%2;
  const reads=makeReads(view.history||[],trump);
  const pVoidOf=makeVoidProb(reads,mem,trump,view.hand.length);
  const holdRange=makeHoldRange(reads,mem,trump,view.hand.length);
  const partnerAce=partnerAceRead(view.history||[],trump,view.seat);
  // 从布尔改成概率:「对手可能缺这门」现在是个数,降权也就按比例来
  const oppVoidP=s=>Math.max(...[0,1,2,3].filter(p=>p%2!==myTeam).map(p=>pVoidOf(p,s)),0);
  const oppVoid=s=>oppVoidP(s)>0.5;
  const partnerVoidP=s=>pVoidOf((view.seat+2)%4,s);
  const partnerVoid=s=>partnerVoidP(s)>0.5;
  const nTrump=view.hand.filter(c=>effSuit(c,trump)==='T').length;
  let unseenTot=0; for(const uk in mem.unseen) unseenTot+=Math.max(0,mem.unseen[uk]);
  const isDecl=view.declSeat!==undefined&&view.declSeat>=0&&view.declSeat%2===myTeam;
  const rs=roundScore(view);
  const L0={trump,mem,voids,oppVoid,partnerVoid,oppVoidP,partnerVoidP,reads,pVoidOf,
          seat:view.seat,holdRange,partnerAce,
          nTrump,isDecl,hand:view.hand,buriedKnown:view.buriedKnown,
          phase:phaseOf(view.hand.length),leading:true,
          def:rs.def,live:rs.live,
          isLast:false,partnerRemaining:true,
          /* v0.5.8:旧版这里硬编码 [1,3] —— 座位 1 或 3 领出时,
           * 「剩余对手」里装的是自己和队友。领出侧原先没有函数读它,
           * 所以一直没暴露;leadWinP 要用 pSurvive,必须先修好。 */
          remainingOpp:[0,1,2,3].filter(x=>x%2!==view.seat%2),
          /* pSurvive 要用:「某一家大约占未见牌的几分之一」。
           * 开局未见 83 张、每家 25 → 3.3;收官未见 23 张、每家 5 → 4.6。 */
          shareDenom:clamp(unseenTot/Math.max(1,view.hand.length),2,8),
          ptsTable:0,partnerWinning:false,certainty:0.5,oppRuffRisk:false};
  // 阶梯目标要含那笔待翻倍的底分 —— kittyProjection 要用 L0 的 hand/mem,所以放在构造之后
  L0.pw=pointWeight(rs.def+kittyProjection(L0),rs.live);
  return L0;
}

// 领出一手稳赢的副牌,这一墩能收多少分的期望
// ≈ 队友送分的期望 + 对手被迫漏分的期望,再乘上「不被毙掉」的概率
function leadPointsEV(L, cl, cards){
  const {trump,mem}=L;
  const rem=unseenPointsIn(mem,cl.suit,trump);
  const pPartnerVoid=L.partnerVoidP?L.partnerVoidP(cl.suit):(L.partnerVoid(cl.suit)?0.9:0.12);
  const size=cards.length;
  // 这门在外的分,大约 1/3 在队友手里;队友不缺门才送得出来
  const fromPartner=rem*0.33*(1-pPartnerVoid)*Math.min(1,size*0.8);
  const fromOpp=rem*0.33*0.35*Math.min(1,size*0.8);   // 对手只在被迫时漏
  // 主牌是所有人都攥着不放的一门:领出主牌时,队友不会把主 K 贴上来(他要留着毙牌),
  // 对手也只会跟最小的主。副牌那套「1/3 在队友手里、他会送过来」的估计在主牌上明显偏高,
  // 不打这个折的话,「领出一张大怪」会因为主门在外分多而拿到虚高的收益。
  return (fromPartner+fromOpp)*(cl.suit==='T'?AIP.leadTrumpEVScale:1);
}

/* 「队友多半握着这门的 A」(v4.7)。
 * 依据:队友**领出 K**、而这门的 A 当时还没露面,他还赢下了这一墩 ——
 * 一个理智的人不会把 K 顶到一张在外的 A 上去,除非那张 A 就在他自己手里。
 * 推断成立之后,我再出这门的小牌甚至分牌就不是「探路」而是**贴分**:
 * 牌权本来就会回到队友手上。
 */
function partnerAceRead(history, trump, seat){
  const out={}, partner=(seat+2)%4;
  for(let i=0;i+3<history.length;i+=4){
    const trick=history.slice(i,i+4);
    const lead=classify(trick[0].cards,trump);
    if(!lead||lead.suit==='T'||lead.type!=='single') continue;
    if(trick[0].seat!==partner||trick[0].cards[0].rank!==13) continue;
    // 这一墩之前,这门的 A 露过面吗?露过就没什么可推的了
    const seenA=history.slice(0,i).some(p=>p.cards.some(c=>
      effSuit(c,trump)===lead.suit&&c.rank===14));
    if(seenA) continue;
    if(resolveTrick(trick,trump).winner===partner) out[lead.suit]=true;
  }
  return out;
}

/* ============================================================
 * 调王 / 调主 —— v0.5.9 的诊断:**这个函数把两件不同的事写成了一件。**
 *
 * 沪语里的「调王」是:用小将牌**寻求队友支持接过牌权**,或者**让度牌权给对手领出**。
 * 而这个函数的主项 `drawOut` 算的是「逼对手消耗主牌」—— 那是**吊主**,是另一回事,
 * 而且它要用**大主**才成立:领出一张小主,两个对手各跟一张他们**最小的**主,
 * 大主一张不掉。我用一张小主换他们两张小主,没有任何优势被兑现。
 * `tiaoDrawUnit = 7` 每逼出一张的收益,大半是虚的。
 *
 * v0.5.9 沿着旧思路试了三条,全部记在这里,免得下次再走一遍:
 *
 *   ① `tiaoUseExp` 用期望张数代替硬下界 —— **保留**。旧版的 `holdRange(p,'T').lo`
 *      只有在别的门都被演绎压低后才为正,也就是牌快打完的时候;插桩 400 局,
 *      调主 95.1% 发生在 end 阶段,而设计文档写的是「调主是中盘战术」。
 *      「对手还有没有主可跟」在中盘是统计事实,不是演绎。改完 mid 占比 9.8% → 14.3%,
 *      症状指标基本不动(领出方输掉 55.4% → 54.1%)。这一条是**信息口径**的修正,不是药。
 *   ② `tiaoEdgeVsOne` 修「一家比两家」的偏差 —— **否掉**(见 AIP 注释)。
 *      诊断没错(edge 均值 −18.8,tiaoNoEdge 永久生效),但把闸门打开只是让调主
 *      从 174 次涨到 475 次,**末家用分牌赢反而从 4.5% 涨到 8.3%**。
 *   ③ `tiaoUnlock` 把收益接到「解锁我方副牌钢板」上 —— **否掉**,量太小,形同虚设。
 *
 * **下一步该怎么改(还没做,见 AI-DESIGN §7):**
 * 病根在 `leadWinP`。它用 `pSurvive(这一手, 两个对手)` 算「我这张活不活得下来」,
 * 于是**队友把它压过去和对手把它压过去被算成同一件事**。可对调王来说,
 * 队友接过去正是**目的**,不是失败。所以领出侧的牌权概率应该是
 *     pTeam = P(两个对手都压不过) + P(有对手压过) × P(队友再压回来)
 * 用它去乘 `leadTempo`、去收 `leadWeakTrump×(1−p)` 的罚分,
 * 「小主换牌权」的价值就自然出来了 —— 判据是**队友有没有更大的主**,
 * 而不是「能逼对手吐几张」。到那时 `drawOut` 这一项应该整个删掉,
 * 让吊主(要大主)和调王(要队友)彻底分家。
 * ============================================================ */

/* 调王 / 调主(v4.7)—— 设计文档 §7 欠了两版的那条。
 *
 * 它一直做不了,是因为判据要的是「对手手上**还有没有**主牌」,而模型只有上界没有下界。
 * makeHoldRange 补上下界之后就能算了:
 *
 *   逼消耗 —— 对手在主门的**下界**之和 > 0,说明他们**必须**跟主。
 *             每逼出一张,我方的主牌优势就兑现一分;没有优势时逼出来是替对手清场,
 *             所以乘上 drawTrumpValue 的符号。
 *   过牌权 —— 队友还有主(下界>0)、且在外压得住这张的大主更可能在他那边时,
 *             这一墩多半由队友收走,牌权就此过渡到他手上,他的副色好牌可以出手。
 *
 * 代价那一侧不用另算:低主的 futureValue、leadWeakTrump 折扣、以及
 * LEAD_PWIN.single 的牌权项都已经在打分里,这里只补收益。
 * 带开关 AIP.tiaoWang,便于单组件消融。
 */
/* 各家在某门的**期望张数**,再用演绎出来的区间夹一下(v0.5.9)。
 *
 * 这是 tiaoWangValue 从「收官专用」变回「中盘战术」的关键。旧版用的是硬下界
 * `holdRange(p,'T').lo = max(0, 手牌数 − Σ其他门上界)` —— 它只有在**别的门都被演绎压低**
 * 之后才为正,也就是牌快打完的时候。插桩 400 局:调主领出 451 次,**95.1% 在 end 阶段**,
 * mid 只有 22 次,open 一次都没有。设计文档里写着「调主是中盘战术」,
 * 而实现要的那个信息只有收官才有 —— 意图和约束从一开始就对不上。
 *
 * 「对手手上还有没有主可跟」在中盘是一件**统计事实**,不是一条演绎。用期望张数:
 *     E[他在这门的张数] = 这门在外的张数 × (他的手牌数 / 未见总数)
 * 再 clamp 进 [lo, hi] —— 硬演绎仍然收紧它,只是不再是唯一的信息来源。
 */
function expHoldIn(L, seat, suitEff){
  const {mem,trump}=L;
  let unseenTot=0, inSuit=0;
  for(const k in mem.unseen){
    const n=mem.unseen[k]; if(n<=0) continue;
    unseenTot+=n;
    if(effSuit(keyToCard(k),trump)===suitEff) inSuit+=n;
  }
  if(unseenTot<=0) return 0;
  const hl=(L.hand||[]).length;
  const raw=inSuit*Math.min(1,hl/unseenTot);
  if(!L.holdRange) return raw;
  const {lo,hi}=L.holdRange(seat,suitEff);
  return clamp(raw,lo,hi);
}

function tiaoWangValue(L, cl, cards){
  if(!AIP.tiaoWang||cl.suit!=='T'||cl.type!=='single') return 0;
  if(cards.some(c=>c.suit==='X')) return 0;          // 不拿大小王去调,那是自废武功
  if(!L.holdRange||L.seat===undefined) return 0;
  const opps=[0,1,2,3].filter(p=>p%2!==L.seat%2);
  const oppHi=opps.reduce((a,p)=>a+L.holdRange(p,'T').hi,0);
  if(oppHi<=0) return 0;                              // 对手主已断:调过去只是白送牌权
  const partner=(L.seat+2)%4;
  // v0.5.9:逼消耗改用期望张数(tiaoUseExp=0 退回旧的硬下界口径)
  const oppLo=opps.reduce((a,p)=>a+L.holdRange(p,'T').lo,0);
  const oppN=AIP.tiaoUseExp?opps.reduce((a,p)=>a+expHoldIn(L,p,'T'),0):oppLo;
  const ptN =AIP.tiaoUseExp?expHoldIn(L,partner,'T'):L.holdRange(partner,'T').lo;
  // v0.5.9:判据用 trumpEdgeCount(一家比一家),不是 drawTrumpValue(一家比两家、恒为负)
  const edge=AIP.tiaoEdgeVsOne?trumpEdgeCount(L):drawTrumpValue(L);
  // 每家最多被逼出一张(这一墩每人只出一张),所以封顶在 2
  /* v0.6.0:`drawOut` 是**吊主**的逻辑,不是调王的。领出一张小主,两个对手各跟一张
   * 他们**最小的**主,大主一张不掉 —— 我用一张小主换他们两张小主,没有优势被兑现。
   * 真正该驱动调王的是「队友接不接得住」,那件事现在由 leadWinP 的 pTeam 表达。
   * tiaoDrawOut=0 即整项关掉,让吊主(要大主、走 drawTrumpValue)和调王(要队友)分家。 */
  const drawOut=AIP.tiaoDrawOut
    ? Math.min(oppN,2)*AIP.tiaoDrawUnit*(edge>0?1:AIP.tiaoNoEdge) : 0;
  /* 逼出主牌到底解锁了什么(v0.5.9)。
   * 旧版 tiaoDrawUnit 是个常数 7,不看「我有什么东西在等着对手的主被抽干」。
   * 吊主真正保护的是**我手上的副牌钢板** —— 它们现在随时可能被毙,
   * 对手主牌越少,它们越接近真钢板。bossUnits / reserveHold 都是现成的:
   * reserveHold 对副牌算的正是「不被毙掉」的概率,1−它就是这一手现在的被毙风险。
   * 抽掉 drawn/(oppN) 这个比例的主,风险按同比例下降。 */
  let unlock=0;
  if(AIP.tiaoUnlock&&oppN>0){
    const drawn=Math.min(oppN,2)/oppN;
    for(const u of bossUnits(L)){
      if(u.suit==='T') continue;
      unlock+=u.val*(1-reserveHold(u,L))*drawn;
    }
    unlock*=AIP.tiaoUnlock*(edge>0?1:AIP.tiaoNoEdge);
  }
  // 牌权过渡:在外压得住这张的主,有多大比例可能在队友那边
  const {higher}=unseenBeats(L.mem,{suit:'T',top:cl.top,type:'single'},L.trump);
  const share=ptN+oppN>0?ptN/(ptN+oppN):0;
  const handoff=higher>0?(ptN>=1?1:AIP.tiaoNoPartnerT)*share*AIP.oppTempo*AIP.tiaoHandoff:0;
  return AIP.tiaoWang*(drawOut+unlock+handoff);
}

/* 领出的牌权项(v4)。
 * v3 里 tempoValue / bossUnits 只在 scorePlay(跟牌)里用,scoreLeadPlay 完全没有这一项 ——
 * 可领出恰恰是牌权最该计价的地方:领出赢下 = 保住牌权继续兑现手上的钢板单元,
 * 领出输掉 = 把牌权交给对手,他去兑现他的,我还可能被逼贴分。
 * 这就是「不考虑牌权」那条观察的直接来源。
 * 和跟牌侧同一个口径:只算**打完这一手之后还剩**的单元,避免和 futureValue 重复计价。
 */
function leadTempo(L, cards, pWin){
  return (pWin*tempoValue(L,cards)-(1-pWin)*AIP.oppTempo)*AIP.leadTempoWeight;
}
// 领出这一手能拿下这墩的粗估概率(只用于给 Tempo 加权,不参与收益计算)
const LEAD_PWIN={throwBoss:0.95, boss:0.95, tractor:0.60, pair:0.45, single:0.25};

/* 吊主(v4)。
 * v3 里「领出主牌」和「领出副牌小牌」走同一条兜底分支,主牌只比副牌低一个常数 6,
 * 而低主的 futureValue 才 2.5~5 —— 实测 1529 次将牌领出里 562 次(37%)是低将牌,
 * 理由字符串全是「小牌探路」。一次这样的领出 = 白烧一张主 + 主动交出牌权,收益为零。
 * 这就是「用将牌消耗对手没有实际收益、不考虑牌权」那条观察的直接来源。
 *
 * 吊主的真正判据只有一条:**我的主牌能不能耗过两个对手手上的主牌**。
 *   对手预估剩余主牌 = 在外主牌总数 × (两个对手的手牌数 / 未见牌总数)
 *   edge = 我的主牌数 − 对手预估
 * edge > 0 才该吊,edge < 0 时领出主牌应当是负分。
 * 这同时替换掉 v3 里写死的 `score:46 主力雄厚,吊主清场` —— 那个常数无条件压过所有
 * 其他候选,而且根本不看对手还剩几张主。
 */
function drawTrumpValue(L){
  if(L._dt!==undefined) return L._dt;
  const {mem,trump}=L;
  let unseenTotal=0, unseenTrump=0;
  for(const k in mem.unseen){
    const n=mem.unseen[k]; if(n<=0) continue;
    unseenTotal+=n;
    if(effSuit(keyToCard(k),trump)==='T') unseenTrump+=n;
  }
  if(unseenTotal<=0) return L._dt=0;
  const hl=(L.hand||[]).length;
  /* v0.5.9:**这条比的是一家对两家。**
   *
   * 旧式子 `oppTrump = 在外主牌 × (2×手牌数 / 未见总数)` 估的是**两个对手合计**的主牌,
   * 却拿它去减 `L.nTrump`(我**一家**的)。插桩 200 局:edge 的均值是
   * **开局 −18.7、中盘 −18.8、收官 −6.4** —— 几乎恒为负。后果有两层:
   *   ① `tiaoNoEdge`(0.3)在 ~100% 的局面下生效,调主的收益被永久打三折;
   *   ② scoreLeadEV 的主牌支里 `Math.min(0,dt)` 是个 −19 的固定罚分,
   *      任何非钢板主牌领出先扣掉 19 分再谈。
   * 于是「调主」在中盘永远打不过别的候选,95% 的调主只能发生在 edge 回升到 −6 的收官段。
   *
   * 吊主本来就是**队的**问题:领一轮主,我出一张、队友出一张、两个对手各出一张 ——
   * 两边各消耗两张,谁先见底谁吃亏。所以正确的比较是
   *     我方(我 + 队友期望) − 对手方(两家期望)
   * 而队友的期望和一个对手的期望相等、正好抵消,化简就是
   *     我的主牌数 − **单家**期望主牌数
   * 也就是把那个 2 去掉。drawTrumpVsOne=0 退回旧行为。 */
  const share=AIP.drawTrumpVsOne?hl/unseenTotal:2*hl/unseenTotal;
  const oppTrump=unseenTrump*Math.min(1,share);
  return L._dt=clamp(AIP.drawTrumpUnit*(L.nTrump-oppTrump),-AIP.drawTrumpCap,AIP.drawTrumpCap);
}

/* 「我方主牌占不占优」这个**判据**(v0.5.9)。
 *
 * 和上面那个 drawTrumpValue 分开,是因为它们回答的是两个不同的问题:
 *   · drawTrumpValue 是一个**打分项**,它的量纲(drawTrumpUnit 6、cap 30)是围着
 *     那条「一家比两家」的偏差标定出来的 —— 直接把偏差修掉,正半边会突然放大,
 *     AI 变得过度吊主。实测:把 drawTrumpVsOne 打开影响打分项,
 *     配对对照 −0.85 分/局,庄家丢最后一墩 26.2% → 37.8%。**数值在补偿偏差,不能只修一半。**
 *   · 而 tiaoWangValue 里要的只是一个**符号**:我方主牌到底占不占优。
 *     那里必须比对,否则 edge 恒为负(实测均值 −18.8),tiaoNoEdge 永久生效。
 *
 * 所以判据单独算:领一轮主,我出一张、队友出一张、两个对手各出一张,两边各消耗两张。
 * 队友的期望和一个对手的期望抵消,化简就是 `我的主牌数 − 单家期望主牌数`。
 * 打分项那边的偏差留到 drawTrumpUnit 重标定时一起动(见 AI-DESIGN §7)。
 */
function trumpEdgeCount(L){
  if(L._tec!==undefined) return L._tec;
  const {mem,trump}=L;
  let unseenTotal=0, unseenTrump=0;
  for(const k in mem.unseen){
    const n=mem.unseen[k]; if(n<=0) continue;
    unseenTotal+=n;
    if(effSuit(keyToCard(k),trump)==='T') unseenTrump+=n;
  }
  if(unseenTotal<=0) return L._tec=0;
  const hl=(L.hand||[]).length;
  return L._tec=L.nTrump-unseenTrump*Math.min(1,hl/unseenTotal);
}

/* 送毙(v4)—— 主打队友的断门。
 * v3 里全部的队内配合只有兜底分支的一句 `+8 队友缺这门,给他机会`,
 * 在一堆 20~60 分的候选里等于没有,而且它只是给已有候选加分,不是一类独立策略。
 * 现在按期望收益算:
 *   队友确实缺这门(pPartnerVoid)× 对手不缺这门(否则是送给对手毙)
 *   × ( 这一墩能收到的分 + 牌权回到我方的价值 )
 * 两个概率都来自 makeVoidProb / maxHoldIn 的软推断,不是新造的假设。
 * 带开关 AIP.feedRuff,便于单组件消融(设计文档 §6 的教训:先确认参数真的在起作用)。
 */
function feedRuffValue(L, cl, cards){
  if(!AIP.feedRuff||cl.suit==='T'||countPoints(cards)>0) return 0;
  const pv=L.partnerVoidP?L.partnerVoidP(cl.suit):0;
  if(pv<AIP.feedRuffMinP) return 0;
  // 队友手上还得有主牌可毙 —— 在外一张主都没有时这条不成立
  const trAvail=unseenBeats(L.mem,{suit:'T',top:-1,type:'single'},L.trump).total;
  if(trAvail<=0) return 0;
  const oppNotVoid=1-(L.oppVoidP?L.oppVoidP(cl.suit):0);
  const rem=unseenPointsIn(L.mem,cl.suit,L.trump);
  const gain=Math.min(12,rem*0.33)+AIP.oppTempo;    // 这墩的分 + 牌权留在我方
  return AIP.feedRuff*pv*oppNotVoid*gain;
}

/* ============================================================
 * v0.5.8 ④⑥ —— 非钢板领出的统一期望分口径
 *
 * 旧版的 scoreLeadCore 其实是**两套完全不同的评分器**:
 *   · 钢板 / 甩牌 → leadPointsEV + pWin + tempo + futureValue,一套真的期望分模型;
 *   · 其余全部   → 一条手写常数式,唯一的牌力项是**负的一次项**:
 *         对子  20 − top×0.5 − pts×4 − …
 *         单张  16 − top×0.8 − pts×6 − …
 *
 * 后果一(反馈④):手上 ♣J♣J 和 ♣8♣8,打分 6.7 vs 8.2,差的 1.5 分**全部**来自
 * −top×0.5。打分器里根本没有「一对J 大概率压得住场、还能把对方的一对10 逼出来」
 * 这件事的位置 —— leadPointsEV 只在钢板分支被调用,LEAD_PWIN 又是按**牌型**
 * 写死的常数(pair 一律 0.45,不管是一对3 还是一对A)。
 *
 * 后果二(反馈⑥):非钢板候选之间只按「谁更小」排序,于是
 * probePenalty / tiaoWangValue / feedRuffValue / probeSafeBonus 全是往这条式子里
 * 加加减减的常数,彼此没有共同量纲 —— 这就是「按下一个冒出另一个」在领出侧的发源地。
 *
 * 现在改成和跟牌侧同一个式子:
 *     Score = p·Gain − (1−p)·Loss + Tempo − Future
 * p 由记牌直接算(pSurvive/pBeaterIn 是现成的,跟牌侧一直在用)。
 * p 一算出来,几个补丁就可以退休:
 *   · 小牌探路的 p 天然低 → 自动降权,probePenalty 不再需要;
 *   · 一对J 的 p 高于一对8 → 反馈④自动修好,−top×k 不再需要;
 *   · LEAD_PWIN 那张按牌型写死的常数表也不再需要(tempo 改用算出来的 p 加权)。
 * tiaoWangValue / feedRuffValue 保留:它们表达的是 EV 模型看不见的东西
 * (逼对手消耗主牌、把牌权交给队友去毙),不是这条式子的替代品。
 * ============================================================ */

// 这一手领出后,本队守住这墩的概率。复用跟牌侧的 pSurvive:
// 它已经把「在外有几张压得住」「谁可能缺门来毙」都算进去了。
function leadWinP(L, cl, cards){
  const LS=Object.create(L);
  LS.ptsTable=countPoints(cards)+(unseenPointsIn(L.mem,cl.suit,L.trump)>0?5:0);
  LS.lead=null;                       // pSurvive 会退回用 cl.suit 当领出门,正确
  const mine=pSurvive(LS,cl,L.remainingOpp);
  if(!AIP.leadTeamP) return mine;
  /* v0.6.0 —— 领出侧的牌权概率问的应该是「**本队**赢不赢得下这墩」,
   * 而不是「**我这张**活不活得下来」。
   *
   * 这是「调王没人接」的真正病根,而且它在领出侧、不在跟牌侧:
   * `pSurvive(这一手, 两个对手)` 把**队友把它压过去**和**对手把它压过去**
   * 算成同一件事 —— 都叫「没活下来」。可调王的**目的**就是让队友接过去。
   * 于是「小主换牌权」在打分器里永远算不出正值,只能靠 tiaoWangValue 里那个
   * 虚的 drawOut(逼对手吐主)去凑,而领一张小主根本吐不出对手的大主(他跟最小的)。
   *
   *     pTeam = P(两个对手都压不过) + P(有对手压过) × P(队友再压回来)
   *
   * 判据由此变成**队友有没有更大的牌**,这正是调王该问的问题。 */
  return clamp(mine+(1-mine)*partnerRescueP(L,cl),0.02,0.99);
}

/* 「对手压过去了,队友还能不能压回来」(v0.6.0)。
 * 和跟牌侧的 pPartnerTakes 同一个问题、同一套坛子口径,只是领出时还没有台面信息:
 * 在外压得住我这一手的牌有多少张,其中多大比例按期望落在队友手上。
 * 再收一道 leadRescueDamp —— 队友要压过的是**对手打出的那张**(通常比我这张大),
 * 而且他未必肯为一墩空气花大牌。 */
function partnerRescueP(L, cl){
  if(L.seat===undefined) return 0;
  const b=unseenBeats(L.mem,cl,L.trump);
  if(b.higher<=0) return 0;                     // 在外已无更大 —— 本来就赢了,不需要救
  const partner=(L.seat+2)%4;
  const opps=[0,1,2,3].filter(p=>p%2!==L.seat%2);
  const ptN=expHoldIn(L,partner,cl.suit);
  const oppN=opps.reduce((a,p)=>a+expHoldIn(L,p,cl.suit),0);
  if(ptN+oppN<=0) return 0;
  const share=ptN/(ptN+oppN);
  // 副牌:队友也可能是**毙**回来的,不必本门有大牌
  let ruff=0;
  if(cl.suit!=='T'&&L.partnerVoidP){
    const trAvail=unseenBeats(L.mem,{suit:'T',top:-1,type:'single'},L.trump).total;
    if(trAvail>0) ruff=L.partnerVoidP(cl.suit)*0.7;
  }
  return clamp((share+ruff-share*ruff)*AIP.leadRescueDamp,0,0.9);
}

// 这一墩输掉时送出去多少分:我出的分 + 赢的那个对手顺手掏出的分 + 队友被迫漏的分
function leadLossPoints(L, cl, cards){
  const share=unseenPointsIn(L.mem,cl.suit,L.trump)/3;
  const scale=cl.suit==='T'?AIP.leadTrumpEVScale:1;   // 主门人人攥着不放,同一个折
  return (Math.min(10,share*AIP.dumpOpp)+Math.min(3,share*0.15))*scale;
}

/* ============================================================
 * v0.6.1 —— 「不要主动领主牌」这条先验,从符号偏差里拿出来写明白
 *
 * v0.6.0 的实测结论是:`drawTrumpValue` 那个「一家比两家」的负偏差(均值 −18.8),
 * 实际扮演的是**一条强烈反对主动领主牌的先验**;把比较改对并重标定,三档全部掉分,
 * 庄家丢最后一墩从 28% 跳到 35%。也就是说先验是对的,只是藏错了地方。
 *
 * 藏在符号里有三个坏处:它的强度跟着一个**估错的量**走;它同时污染了吊主的正半边
 * (真该吊主时也被压住);而且没人看得出打分器里到底是什么在反对领主牌。
 *
 * 摊开来说,领一轮主牌的真实代价有两截:
 *   · **我这张**的留手价值 —— 已经在 `futureValue` 的 `trumpHold` 里,不重复算;
 *   · **队友被迫也跟出一张主** —— 这一截从来没人算过。领主牌逼四家各出一张:
 *     张数上两边打平,但我方那两张本来是留着毙牌和护底的,
 *     对手那两张往往是他们最小的(他们没有义务吐大牌)。所以这一轮**我方净亏一张主的期权**。
 * 代价按「队友手上还有主的概率」加权 —— 他要是主已断,这一截就不存在。
 * ============================================================ */
function trumpLeadPrior(L, cards){
  if(!AIP.trumpLeadPrior) return 0;
  const partner=(L.seat+2)%4;
  const ptN=L.seat===undefined?1:expHoldIn(L,partner,'T');
  const pHas=clamp(ptN,0,1);                       // 期望 ≥1 张就当他肯定还有主
  /* 我方主牌占优时这条代价要让路 —— 「逼队友也吐一张主」只在主牌稀缺时才是损失,
   * 主牌碾压的时候把双方一起清空恰恰是目的(那就是吊主)。
   * 所以按 dt 从满额线性退到 0:dt ≤ 0 全额,dt 顶到 drawTrumpCap 则完全豁免。 */
  const dt=drawTrumpValue(L);
  const scarce=clamp(1-dt/AIP.drawTrumpCap,0,1);
  /* 还要乘上「此刻攥着主牌到底值不值钱」。这条先验的全部理由是
   * 「我方那两张主本来留着毙牌和护底」—— 收官阶段底里没分时,那两件事都不存在了,
   * 攥着主牌毫无意义,该兑现就兑现。`phaseK` 正好是这个量:
   * 开局 1.0、中盘 0.7、收官则由底分决定(底分 0 → 0.15,底分 20 → ≈1.05)。 */
  const worth=phaseK(L);
  // 张数上封顶在 2:再长的一手,队友本来也躲不掉要跟,边际代价饱和
  return AIP.trumpLeadPrior*pHas*Math.min(cards.length,2)*scarce*worth;
}

function scoreLeadEV(L, cl, cards, pre){
  const {pts,ruffP,fut}=pre;
  const p=leadWinP(L,cl,cards);
  const gain=pts+leadPointsEV(L,cl,cards);
  const loss=pts+leadLossPoints(L,cl,cards);
  let s=(p*gain-(1-p)*loss)*(L.pw||1)-fut, reason;
  // 牌型本身的可打性:拖拉机/对子难被跟死,同样的 p 下更该打 —— 这一点 p 表达不了
  if(cl.type==='tractor') s+=AIP.leadShapeBonus*(cards.length-1);
  else if(cl.type==='pair') s+=AIP.leadShapeBonus;
  if(cl.type==='tractor') reason=p>0.6?'拖拉机难跟,压一手':'拖拉机,但在外还有更大的';
  else if(cl.type==='pair') reason=p>0.6?'这一对多半压得住,先收一墩':(pts?'分对慎出':'出对子');
  else reason=p>0.6?'这张多半压得住':'小牌探路';
  if(cl.suit==='T'){
    /* 吊主的正半边在旧口径里是被**故意砍掉**的:「对所有主牌领出一律加正的 edge 奖励
     * 反而掉分(unit 0→+2.0、4→0.0、8→−2.8)」。那个结论成立的前提是,
     * 在那条手写常数式里 edge 是一个**跨候选的常数偏移**,把低主领出也一起抬了上去。
     * 换成 EV 口径之后它不再是常数:按 p 加权,压得住场的主拖拉机拿到大部分奖励,
     * 一张孤零零的小主 p 很低、几乎拿不到 —— 该分开的两件事这才真的分开了。
     * 同理,leadWeakTrump 那个「白烧一张主」的罚分本来就该按**输掉的概率**收。 */
    const dt=drawTrumpValue(L);
    /* v0.6.1:`Math.min(0,dt)` 这一截就是那条被藏起来的先验。改成显式项之后,
     * 负半边只保留「主牌确实不占优」这一层判断,强度交给 trumpLeadPrior。
     * trumpLeadPrior=0 即退回 v0.6.0 的行为(纯靠 min(0,dt) + leadWeakTrump)。 */
    // dt 的负半边同样只在「攥着主牌还值钱」时才该扣满 —— 同一个理由
    const dtNeg=Math.min(0,dt)*(AIP.trumpLeadPrior?AIP.dtNegDamp*phaseK(L):1);
    s+=dtNeg+p*Math.max(0,dt)-AIP.leadWeakTrump*(1-p)-trumpLeadPrior(L,cards);
    if(dt>8&&p>0.5&&cards.every(c=>c.suit!=='X')) reason='主牌多于对手,吊主清场';
    // 调王/调主:EV 模型看不见「把牌权过渡给队友」的那一小截额外价值
    const tw=tiaoWangValue(L,cl,cards);
    s+=tw;
    /* v0.6.0:理由字符串跟着**判据**走,不再跟着 tw 的大小走。
     * 现在「这是不是一次调主」的判据是:这张压不住场(p_mine 低),
     * 但本队仍有相当把握拿下这墩 —— 也就是 pTeam 里**队友救回来**的那一截占了大头。
     * 旧版用 `tw > leadWeakTrump/2` 当判据,而 tw 的大头是 drawOut(逼对手吐主),
     * 关掉 drawOut 之后调主的理由字符串会整个消失,可行为本身反而更对了。 */
    const rescue=AIP.leadTeamP?partnerRescueP(L,cl):0;
    if(cl.type==='single'&&rescue>=AIP.tiaoLabelP&&p<0.75&&cards.every(c=>c.suit!=='X'))
      reason='调主:小主换牌权,交给队友接';
    else if(tw>AIP.leadWeakTrump*0.5) reason='调主:小主换牌权,逼对手出大牌';
    else if(p<0.4&&!(dt>8&&p>0.5)) reason='小主领出压不住场,吊不出对手的大主';
  }else{
    const fr=feedRuffValue(L,cl,cards);
    if(fr>0){ s+=fr; reason='主打队友的断门,让他毙下这墩'; }
    else if(L.partnerAce&&L.partnerAce[cl.suit]&&p<0.6){
      s+=AIP.probeSafeBonus; reason='队友多半握着这门的 A —— 这是贴分,不是探路'; }
    else if(p<0.4&&unseenPointsIn(L.mem,cl.suit,L.trump)===0) reason='这门的分已经打光,交牌权代价小';
  }
  if(ruffP>0.25&&cl.suit!=='T'&&p>0.6){ reason='压得住,但对手可能缺门来毙'; }
  return {score:s,reason,pWin:p};
}

function scoreLeadPlay(L, cl, cards){
  const r=scoreLeadCore(L,cl,cards);
  if(r.pWin===undefined) return r;
  return {score:r.score+leadTempo(L,cards,r.pWin), reason:r.reason};
}

function scoreLeadCore(L, cl, cards){
  const {trump,mem}=L;
  if(!cl) return {score:-20,reason:'不成牌型'};
  const comps=cl.type==='throw'?cl.comps:[cl];
  const allBoss=comps.every(c=>isBossPlay({type:c.type,len:c.len,suit:cl.suit,top:c.top},mem,trump));
  const pts=countPoints(cards), size=cards.length;
  const ruffP=cl.suit!=='T'?L.oppVoidP(cl.suit):0;   // 对手缺这门的概率
  const ruffable=ruffP>0.5;
  const fut=futureValue(cards,L);              // 机会成本:这手留着以后值多少
  if(cl.type==='throw'){
    if(allBoss&&!ruffable)
      return {score:68+size*3+leadPointsEV(L,cl,cards)*1.4*(L.pw||1)-fut*0.35,
              reason:'整门都是最大,甩牌施压',pWin:LEAD_PWIN.throwBoss};
    return {score:5-pts*4,reason:'甩牌有风险'};
  }
  if(allBoss&&AIP.leadEV2){
    /* v0.6.1 —— 钢板领出也走统一期望分口径,`bossBase` / `bossSize` 就此退休。
     *
     * v0.5.8 把非钢板换成了真实的期望分,钢板这一支却还是
     * `40 + size×8 + ev×1.4 − fut×k`,一个**比真实 stake 还大的标定常数**。
     * v0.5.8 想给护底 flat 项封顶在它保护的那笔分上,一封就输给这个常数;
     * v0.6.0 把它从 40 扫到 34 挣了 0.41 分,但那只是把它调小,没让它变成「真实的分」。
     *
     * 现在两支合并:`p·Gain − (1−p)·Loss + Tempo − Future`。
     * 「拿住牌权继续兑现手上的钢板」这件事本来就由 `leadTempo` 按贴现和算出来了 ——
     * 那正是 v4 从 56 里拆出来的那一截。剩下的只需要两条钢板专属的修正:
     *   · 副牌钢板的机会成本折 `futLeadCashDamp` —— 它的「未来价值」本来就是
     *     「以后领出去收分」,现在领出就是在兑现它,不该重复扣一遍;
     *     主牌钢板不同,出掉是真的丧失压制力,照全额扣。
     *   · 一点结构溢价 `bossShapeBonus` —— 整手压得住这件事本身有额外确定性,
     *     而 p 已经贴到 0.95 上下,再高也表达不出来。
     * `ruffP > 0.25` 那条特例罚分也删掉:`leadWinP` 里 `pSurvive` 的
     * `pVoidLead × 0.8 × 0.85` 算的就是被毙的概率,不需要再补一刀。 */
    const pre2={pts,ruffP,fut:fut*(cl.suit==='T'?1:AIP.futLeadCashDamp)};
    const r=scoreLeadEV(L,cl,cards,pre2);
    r.score+=AIP.bossShapeBonus;
    if(!/调主|吊主|清场|不占优/.test(r.reason))
      r.reason=cl.suit==='T'?(L.phase==='end'?'收官清主':'主牌钢板,压制力兑现')
                            :'本门在外已无更大,先收一墩';
    return r;
  }
  if(allBoss){
    // 稳赢的一手:收益 = 这墩能收的分 + 拿住牌权的战略值,成本 = 机会成本。
    // 副牌钢板的机会成本只算 0.35 —— 它的「未来价值」本来就是「以后领出去收分」,
    // 现在领出就是在兑现它,不该重复扣一遍;主牌钢板不同,出掉是真的丧失压制力。
    const ev=leadPointsEV(L,cl,cards);
    let s=(AIP.bossBase)+size*(AIP.bossSize)+ev*1.4*(L.pw||1)-fut*(cl.suit==='T'?1:0.35), reason='本门在外已无更大,先收一墩';
    if(cl.suit==='T'){
      // 大主牌/王对是全场压制力,开局中盘直出等于自废武功。
      // 「有多不可替代」交给 Future 去表达(王对 18~30,普通主牌 2.5~8),
      // 这里只留一个统一的基础折扣,避免把「清主」这种好棋也一并否掉。
      s-=L.phase==='end'?4:AIP.leadTrumpPenalty;
      reason=L.phase==='end'?'收官清主':'大主牌留作后手,压制到收官';
      // 吊主的奖励只给非王的主牌:用王去吊,吊出来的主牌数量一样,却把全场最后的控制权
      // 提前花掉了(「大怪留后手」)。负半边照扣 —— 主牌不占优时,连王带主都不该主动动。
      const dt=drawTrumpValue(L);
      s+=cards.every(c=>c.suit!=='X')?dt:Math.min(0,dt);
      if(dt>8&&cards.every(c=>c.suit!=='X')) reason='主牌多于对手,吊主清场(大怪留后手)';
      else if(dt<-8) reason='主牌不占优,先不动主';
    }
    if(ruffP>0.25){ s-=(35+(pts?10:0))*ruffP; reason='虽是钢板,但对手可能缺门来毙'; }
    return {score:s,reason,pWin:cl.suit==='T'?0.97:LEAD_PWIN.boss*(1-ruffP)};
  }
  // 非钢板的主牌领出压不住场,对手用最小的主跟掉 —— 吊不出他的大主,只烧掉自己的。
  // 所以这里**只取 drawTrumpValue 的负半边**:没有主牌优势要罚,有优势也不奖励
  // (奖励留给钢板那一支,只有压得住的主牌才真的能把对手的主逼出来)。
  // 实测:对所有主牌领出一律加正的 edge 奖励反而掉分(unit 0→+2.0、4→0.0、8→−2.8),
  // 因为那是一个跨候选的常数偏移,把低主领出也一起抬了上去,正是要修的毛病。
  const dtc=cl.suit==='T'?Math.min(0,drawTrumpValue(L))-AIP.leadWeakTrump:0;
  // v0.5.8 ④⑥:非钢板走统一 EV 口径(见 scoreLeadEV)。旧的三条手写常数式留在下面,
  // AIP.leadEV=0 即回退,便于单组件消融。
  if(AIP.leadEV) return scoreLeadEV(L,cl,cards,{pts,size,ruffP,ruffable,fut,dtc});
  if(cl.type==='tractor')
    return {score:30+size*4-(ruffable?10:0)-fut+dtc,reason:'拖拉机难跟,压一手',pWin:LEAD_PWIN.tractor};
  if(cl.type==='pair'){
    // 对子的「探路」比单张危险小(对子难被跟死),但同样受豁免条件约束
    const safePair=cl.suit!=='T'&&((L.partnerAce&&L.partnerAce[cl.suit])
                   ||unseenPointsIn(L.mem,cl.suit,L.trump)===0);
    return {score:20-cl.top*0.5-pts*4-(ruffable?8:0)-fut+dtc
                  -(cl.suit!=='T'&&!safePair?AIP.probePenalty*AIP.probePairScale:0),
            reason:pts?'分对慎出,无保护先探路':'出对子探路',
            pWin:LEAD_PWIN.pair};
  }
  let s=16-cl.top*0.8-pts*6-(ruffable&&pts?8:0)-fut, reason='小牌探路';
  if(cl.suit==='T'){
    // 低主领出有两种完全不同的情形,旧版混为一谈、一律重罚:
    //   · 对手主已断 / 我方主不占优 → 确实是白烧一张主再把牌权送出去
    //   · 对手还必须跟主、我方主占优 → 这是**调王**,用极小的消耗逼对手出大牌、
    //     或者把牌权过渡给队友。判据见 tiaoWangValue(要下界,所以以前做不了)。
    const tw=tiaoWangValue(L,cl,cards);
    s+=Math.min(0,drawTrumpValue(L))-AIP.leadWeakTrump+tw;
    reason=tw>AIP.leadWeakTrump*0.5?'调主:小主换牌权,逼对手出大牌'
          :'小主领出压不住场,吊不出对手的大主';
  }else{
    /* 副色小牌「探路」通常是坏棋:把牌权无消耗地交出去,还可能连分一起送。
     * 只有几种情形下它不是探路,而是有明确目的的一手 —— 其余一律降到兜底,
     * 让调主之类的候选先出线。 */
    const fr=feedRuffValue(L,cl,cards);
    const partnerHasAce=L.partnerAce&&L.partnerAce[cl.suit];
    const noPts=unseenPointsIn(L.mem,cl.suit,L.trump)===0;
    if(fr>0){ s+=fr; reason='主打队友的断门,让他毙下这墩'; }
    else if(partnerHasAce){ s+=AIP.probeSafeBonus; reason='队友多半握着这门的 A —— 这是贴分,不是探路'; }
    else if(noPts){ reason='这门的分已经打光,交牌权代价小'; }
    else { s-=AIP.probePenalty; reason='副色小牌探路(下策:白交牌权)'; }
  }
  return {score:s,reason,pWin:LEAD_PWIN.single};
}

/* ============================================================
 * v0.7.0 —— 收官蒙特卡洛(`endgameSearch`)
 *
 * 设计文档 §7 第一行「无跨墩规划」。v0.5.8~v0.6.1 连撞三次
 * 「结构改对了反而掉分」(护底封顶、drawTrumpValue 的符号、bossBase),
 * 追到底都是同一件事:**打分器只算一墩**,而护底、吊主、钢板串问的都是
 * 「这一手在往后几墩里还能换来什么」。那几个量纲错误的大常数,
 * 就是模型用来顶替这块缺失的补丁 —— 所以先做推演,再回头拆常数。
 *
 * 为什么从收官做起:剩 5 张时状态空间已经很小,而底牌翻倍让最后几墩的
 * 单墩价值远高于中盘 —— 算力回报率最高的一段。
 *
 * 三件事和启发式那一套彻底不同:
 *
 * ① **目标函数是阶梯本身,不是期望分。** 每个样本推演到局末,直接按引擎的
 *    `scoreRound` 结算,再折成「我方净升几级」。用户那条式子
 *    `[底分×抠底倍数×P(守住) + 当前分 − 目标分] vs [本墩得分×P(拿下) + 当前分 − 目标分]`
 *    在这里是**自动成立**的:抠底倍数由推演里最后一墩实际出几张决定,
 *    守住概率由样本频率给出,目标分由 scoreRound 的 0/40/80/120/160/200 台阶给出。
 *    不需要 pointWeight 那个高斯包络去近似跨线概率。
 * ② **抽样受记牌约束。** 未见牌按「每家手牌数相同 + 硬缺门 + maxHoldIn 上界」
 *    分配到三家和底牌;分不动就重抽(有次数上限,抽不出就退回启发式)。
 * ③ **推演策略必须便宜。** 用不起 aiChooseFollow(它每次都要重建记牌)。
 *    rollout 用 minWinFollow / buildFollow 这一层构造式候选 ——
 *    它们只需要 hand/lead/trump,而且天然合法。
 *
 * 预算:候选数 × 样本数 有硬上限,超时直接退回启发式打分。
 * 开关 AIP.egSearch=0 整块关闭。
 * ============================================================ */

// 便宜的推演策略:够用就行,不追求最优 —— 样本量比单样本质量更值钱
function rolloutLead(hand, trump, mem){
  const bySuit={};
  hand.forEach(c=>{(bySuit[effSuit(c,trump)]=bySuit[effSuit(c,trump)]||[]).push(c);});
  let best=null, bestKey=-1e9;
  for(const su in bySuit){
    for(const comp of decompose(bySuit[su],trump)){
      const cl={type:comp.type,len:comp.len,suit:su,top:comp.top};
      const boss=isBossPlay(cl,mem,trump);
      // 钢板先收(带分的更先);否则出最小的、不带分的
      const k=(boss?100:0)+(boss?countPoints(comp.cards)*2+comp.cards.length*3:-comp.top-countPoints(comp.cards)*4)
             -(su==='T'&&!boss?20:0);
      if(k>bestKey){ bestKey=k; best=comp.cards; }
    }
  }
  return best||[hand[0]];
}
function rolloutFollow(hand, lead, trump, plays, seat){
  const cur=currentWinner(plays,trump);
  const partnerWinning=cur.seat%2===seat%2;
  const isLast=plays.length===3;
  const pts=countPoints(plays.flatMap(p=>p.cards));
  if(!partnerWinning){
    // 台面有分、或这是能一锤定音的最后一手 → 吃;否则跟小
    const win=(pts>0||isLast)?minWinFollow(hand,lead,trump,cur.cl,isLast):null;
    if(win) return win;
    return buildFollow(hand,lead,trump,'cheap',null)||buildFollow(hand,lead,trump,'discard',null);
  }
  /* 队友暂大:末家(他已经赢定)就贴分,否则跟小。
   * 这里**不能**调 makeMemory 去判钢板 —— 那是一次 108 张的重建,
   * 而这个函数在每个样本的每一墩都会被调到,实测占了搜索开销的大半。
   * 推演策略便宜比精确重要:样本量能买回来的东西比单样本质量多。 */
  const strat=isLast?'dump':'cheap';
  return buildFollow(hand,lead,trump,strat,null)||buildFollow(hand,lead,trump,'cheap',null);
}

/* 按约束抽一副「其余三家 + 底牌」的可能牌。
 * 约束:各家张数(已出过牌的那几家少一张)、硬缺门、maxHoldIn 的上界。
 * 用「最受限的牌先安排」的贪心 + 有界重试,抽不出就返回 null。 */
function sampleWorld(ctx, rand){
  const {unseen,sizes,seats,voids,trump,kittySize,capOf}=ctx;
  for(let attempt=0;attempt<AIP.egRetries;attempt++){
    const pool=shuffle(unseen,rand);
    const hands={}, cnt={}, used={};
    seats.forEach(s=>{hands[s]=[];cnt[s]={};});
    let kitty=[], ok=true;
    // 先把「能去的地方最少」的牌安排掉
    const order=pool.slice().sort((a,b)=>
      seats.filter(s=>!voids[s][effSuit(a,trump)]).length
     -seats.filter(s=>!voids[s][effSuit(b,trump)]).length);
    for(const c of order){
      const su=effSuit(c,trump);
      const cand=seats.filter(s=>hands[s].length<sizes[s]&&!voids[s][su]
                   &&(cnt[s][su]||0)<capOf(s,su));
      if(!cand.length){
        if(kitty.length<kittySize){ kitty.push(c); continue; }
        ok=false; break;
      }
      // 按剩余空位加权,避免最后一家被塞满
      let tot=0; const w=cand.map(s=>{const x=sizes[s]-hands[s].length; tot+=x; return x;});
      let r=rand()*tot, pick=cand[0];
      for(let i=0;i<cand.length;i++){ r-=w[i]; if(r<=0){ pick=cand[i]; break; } }
      hands[pick].push(c); cnt[pick][su]=(cnt[pick][su]||0)+1;
    }
    if(!ok) continue;
    if(seats.some(s=>hands[s].length!==sizes[s])) continue;
    return {hands,kitty};
  }
  return null;
}

/* 从当前局面推演到局末,返回本局闲家总分与最后一墩信息 */
function rolloutToEnd(st){
  const {trump,declSeat}=st;
  const hands=st.hands.map(h=>h.slice());
  let plays=st.plays.map(p=>({seat:p.seat,cards:p.cards.slice()}));
  let leader=st.leader, defPoints=st.defPoints, lastWinner=-1, lastLeadSize=1;
  let guard=0;
  while(hands.some(h=>h.length)||plays.length){
    if(plays.length===0){
      const cards=rolloutLead(hands[leader],trump,st.mem);
      cards.forEach(c=>removeCard(hands[leader],c));
      plays.push({seat:leader,cards});
    }
    while(plays.length<4){
      const seat=(plays[0].seat+plays.length)%4;
      const lead=classify(plays[0].cards,trump);
      let cards=rolloutFollow(hands[seat],lead,trump,plays,seat);
      if(!cards||!isLegalFollow(hands[seat],lead,cards,trump))
        cards=genFollow(hands[seat],lead,trump,st.rand);
      cards.forEach(c=>removeCard(hands[seat],c));
      plays.push({seat,cards});
    }
    lastLeadSize=plays[0].cards.length;
    const res=resolveTrick(plays,trump);
    if(res.winner%2!==declSeat%2) defPoints+=res.points;
    lastWinner=res.winner; leader=res.winner; plays=[];
    if(++guard>30) break;
  }
  return {defPoints,lastWinner,lastLeadSize};
}

/* 折成「我方净升几级」—— 这就是真正的目标函数,阶梯与抠底倍数都在 scoreRound 里。
 *
 * 但**纯阶梯是一个阶跃函数**:两个候选差 5 分,多数样本落在同一级台阶上,
 * u 完全相同 —— 搜索在台阶内部是瞎的。所以再掺一点点连续项打破平局:
 * 一级台阶 40 分,`egPointsEps × 40` 要明显小于 1,阶梯才仍然主导,
 * 同时台阶内部有梯度可循。这正是「以阶梯为目标、以分数为次序」的写法。
 */
function levelUtility(sc, myTeam, declTeam){
  const gain=sc.defendersWin
    ? (declTeam===myTeam?0:1+(sc.defenderLevelsUp||0))
    : (declTeam===myTeam?(sc.declarerLevelsUp||0):0);
  const lose=sc.defendersWin&&declTeam===myTeam?1:0;      // 丢庄
  const myPts=declTeam===myTeam?(200-sc.total):sc.total;  // 本队这一局拿到的分
  return gain-lose+AIP.egPointsEps*myPts;
}

/* 对一组候选做收官搜索。返回 [{cards, u}] 或 null(条件不满足/预算不够) */
function endgameSearch(view, plays, cands){
  if(!AIP.egSearch) return null;
  const trump=view.trump;
  const n=view.hand.length;
  if(n<1||n>AIP.egMaxCards) return null;
  if(view.declSeat===undefined||view.declSeat<0) return null;
  if(cands.length<2||cands.length>AIP.egMaxCands) return null;   // 只有一个候选,没什么可搜的
  const mem=makeMemory(view);
  const unseen=[];
  let uid=0;
  for(const k in mem.unseen){
    const c=keyToCard(k);
    for(let i=0;i<mem.unseen[k];i++) unseen.push({suit:c.suit,rank:c.rank,id:'e'+(uid++)});
  }
  const seats=[0,1,2,3].filter(s=>s!==view.seat);
  const played=new Set((plays||[]).map(p=>p.seat));
  const sizes={}; seats.forEach(s=>{ sizes[s]=n-(played.has(s)?1:0); });
  const kittySize=view.buriedKnown&&view.buriedKnown.length?0:RULES.kittySize;
  if(unseen.length!==seats.reduce((a,s)=>a+sizes[s],0)+kittySize) return null;
  const voids=makeVoids(view.history||[],trump);
  const reads=makeReads(view.history||[],trump);
  const capOf=(s,su)=>maxHoldIn(reads,mem,s,su,trump);
  const rand=rng((view.history||[]).length*7919+view.seat*31+n*17+1);
  const ctx={unseen,sizes,seats,voids,trump,kittySize,capOf};
  const myTeam=view.seat%2, declTeam=view.declSeat%2;
  const rs=roundScore(view);
  const worlds=[];
  for(let i=0;i<AIP.egSamples;i++){
    const w=sampleWorld(ctx,rand);
    if(w) worlds.push(w);
  }
  if(worlds.length<AIP.egMinSamples) return null;
  const out=cands.map(c=>({cards:c.cards,u:0}));
  for(const w of worlds){
    const kitty=view.buriedKnown&&view.buriedKnown.length?view.buriedKnown:w.kitty;
    for(const o of out){
      const hands=[[],[],[],[]];
      seats.forEach(s=>{hands[s]=w.hands[s].slice();});
      hands[view.seat]=view.hand.filter(x=>!o.cards.some(y=>y.id===x.id));
      const p2=(plays||[]).map(p=>({seat:p.seat,cards:p.cards.slice()}));
      p2.push({seat:view.seat,cards:o.cards});
      let leader=p2[0].seat, defPoints=rs.def, pl=p2;
      if(p2.length===4){
        const res=resolveTrick(p2,trump);
        if(res.winner%2!==declTeam) defPoints+=res.points;
        leader=res.winner; pl=[];
        if(!hands.some(h=>h.length)){
          const sc=scoreRound({defPoints,kitty,defWonLastTrick:res.winner%2!==declTeam,
                               lastLeadSize:p2[0].cards.length});
          o.u+=levelUtility(sc,myTeam,declTeam); continue;
        }
      }
      const r=rolloutToEnd({hands,plays:pl,leader,defPoints,trump,declSeat:view.declSeat,mem,rand});
      const sc=scoreRound({defPoints:r.defPoints,kitty,
        defWonLastTrick:r.lastWinner>=0?r.lastWinner%2!==declTeam:false,
        lastLeadSize:r.lastLeadSize});
      o.u+=levelUtility(sc,myTeam,declTeam);
    }
  }
  out.forEach(o=>{o.u/=worlds.length;});
  out.samples=worlds.length;
  return out;
}

// 领出决策
function aiChooseLead(view){
  const L=leadCtx(view);
  const {trump}=L;
  const bySuit={};
  view.hand.forEach(c=>{(bySuit[effSuit(c,trump)]=bySuit[effSuit(c,trump)]||[]).push(c);});
  const cands=[];
  for(const s in bySuit){
    const comps=decompose(bySuit[s],trump);
    for(const comp of comps){
      const cl={type:comp.type,len:comp.len,suit:s,top:comp.top,cards:comp.cards};
      const r=scoreLeadPlay(L,cl,comp.cards);
      cands.push({cards:comp.cards,score:r.score,reason:r.reason});
    }
    // 甩牌候选:整门多组件且全是钢板(引擎 checkThrow 仍会最终把关)
    if(s!=='T'&&comps.length>=2&&bySuit[s].length<=6){
      const cl=classify(bySuit[s],trump);
      if(cl&&cl.type==='throw'){
        const r=scoreLeadPlay(L,cl,bySuit[s]);
        if(r.score>40) cands.push({cards:bySuit[s],score:r.score,reason:r.reason});
      }
    }
  }
  // v3 这里还硬塞过一颗 `score:46 主力雄厚,吊主清场` 的候选。常数 46 无条件压过其他所有
  // 候选,且不看对手还剩几张主 —— 现在吊主的收益由 drawTrumpValue 在正常评分里算出来,
  // 所有主牌组件都能参与竞争,不需要这颗特例。
  cands.sort((a,b)=>b.score-a.score);
  let best=cands[0]||{cards:[view.hand[0]],reason:'兜底',score:0};
  /* v0.7.0:收官交给搜索。只用它**排序**(目标函数是「净升几级」,和分制不同量纲),
   * 而且要比启发式选中的那个高出 egMargin 级才改判 —— 样本噪声区里仍然听启发式的。 */
  const eg=endgameSearch(view,null,cands.slice(0,AIP.egMaxCands));
  if(eg){
    const cur=eg.find(o=>o.cards===best.cards);
    const top=eg.slice().sort((a,b)=>b.u-a.u)[0];
    if(top&&cur&&top.cards!==cur.cards&&top.u-cur.u>AIP.egMargin){
      const c=cands.find(x=>x.cards===top.cards);
      if(c) best={...c,reason:'收官推演:'+c.reason+`(${eg.samples}样本,净升 ${top.u.toFixed(2)} 级)`};
    }else if(cur) best={...best,reason:best.reason+`(收官推演确认,净升 ${cur.u.toFixed(2)} 级)`};
  }
  return {...best,cands:cands.slice(0,3)};
}

// 教练用:给任意一手领出打分
function coachScoreLead(view, cards){
  return scoreLeadPlay(leadCtx(view),classify(cards,view.trump),cards).score;
}

// 全 AI 无头模拟一整局(测试用;简化亮主为一轮制)
// smartSeats:使用启发式 AI 的座位,其余用随机 AI
function simulateRound(seed, smartSeats=[0,1,2,3]){
  const {first}=cutForFirst(seed);
  const {hands,kitty}=dealRound(seed,first);
  let best=null, declSeat=-1;
  for(let s=0;s<4;s++){
    const o=declOptions(hands[s],RULES.levelStart)[0];
    if(o && (!best||o.strength>best.strength)){ best=o; declSeat=s; }
  }
  const rand=rng(seed^0x9e3779b9);
  let trump;
  if(!best){ trump={suit:null,rank:RULES.levelStart}; declSeat=first; }
  else{
    trump={suit:best.suit,rank:RULES.levelStart};
    for(let s=0;s<4;s++){
      if(s!==declSeat && jokerPairOf(hands[s]) && rand()<0.3){
        trump={suit:null,rank:RULES.levelStart}; declSeat=s; break;  // 无庄盘:造反者坐庄
      }
    }
  }
  hands[declSeat].push(...kitty);
  const buried=aiDiscard(hands[declSeat],trump);
  buried.forEach(c=>removeCard(hands[declSeat],c));
  const declTeam=declSeat%2;
  const smart=new Set(smartSeats);
  const history=[];
  let leader=declSeat, defPoints=0, lastWinner=declSeat, lastLeadSize=1, tricks=0;
  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4;
      const view={seat,hand:hands[seat],trump,declSeat,history:[...history,...plays],
                  buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){
        cards=smart.has(seat)?aiChooseLead(view).cards:aiLead(hands[seat],trump,rand);
        const chk=checkThrow(hands,seat,cards,trump);
        if(!chk.ok) cards=chk.forced;
      }else{
        const lead=classify(plays[0].cards,trump);
        cards=smart.has(seat)?aiChooseFollow(view,plays).cards
                             :genFollow(hands[seat],lead,trump,rand);
        if(!isLegalFollow(hands[seat],lead,cards,trump))
          throw new Error('AI 出牌不合法 seed='+seed+' seat='+seat);
      }
      cards.forEach(c=>removeCard(hands[seat],c));
      plays.push({seat,cards});
    }
    history.push(...plays);
    lastLeadSize=plays[0].cards.length;
    const res=resolveTrick(plays,trump);
    leader=res.winner; lastWinner=res.winner; tricks++;
    if(res.winner%2!==declTeam) defPoints+=res.points;
    if(tricks>100) throw new Error('死循环 seed='+seed);
  }
  return {...scoreRound({defPoints,kitty:buried,defWonLastTrick:lastWinner%2!==declTeam,lastLeadSize}),
          defPoints, tricks, declSeat, noTrump:!trump.suit};
}

/* 引擎公开面 —— 浏览器 #test 与 node 无头测试共用同一份,避免两边漂移 */
const ENGINE={RULES,makeDeck,cardPoints,countPoints,rng,dealRound,
  cutForFirst,effSuit,ordIdx,decompose,classify,isLegalFollow,resolveTrick,checkThrow,declarationOf,
  canOverride,declOptions,jokerPairOf,canReinforce2,canFullRebel,dealerAfterDecl,scoreRound,advanceMatch,clampAtGate,countPairsIn,maxTractorLen,
  structMatches,removeCard,aiLead,genFollow,aiDiscard,simulateRound,bruteFollow,
  makeMemory,maxUnseenIdx,unseenPairAbove,pPairAbove,pBeaterIn,keyToCard,isBossPlay,buildFollow,currentWinner,minWinFollow,
  aiChooseFollow,aiChooseLead,coachScoreFollow,coachScoreLead,makeVoids,followCtx,leadCtx,scoreLeadPlay,
  AIP,globalIdx,easeEnds,bossChain,pWinLastTrick,faceValue,voidProb,
  scoreDeclOption,declThreshold,aiDeclDecide,projectLen,trumpCountUnder,sideQuality,pPairOverride,
  phaseOf,futureValue,pTeamWin,laterPoints,scorePlay,unseenPointsIn,leadPointsEV,pSurvive,unseenBeats,roundScore,pointWeight,ruffThrow,SCORE_LADDER,makeReads,maxHoldIn,makeVoidProb,cheapKey,dumpKey,kittyPointsEst,tempoValue,
  bossUnits,feedRuffValue,reserveHold,reserveUnit,
  makeHoldRange,partnerAceRead,tiaoWangValue,
  endgameSearch,sampleWorld,rolloutToEnd,rolloutLead,rolloutFollow,levelUtility,trumpLeadPrior};
if(typeof module!=='undefined') module.exports=ENGINE;

var E=module.exports;
(window.__ENGINES=window.__ENGINES||{})["v0.7.0"]={ver:"v0.7.0",
  aiChooseLead:E.aiChooseLead, aiChooseFollow:E.aiChooseFollow,
  aiDeclDecide:E.aiDeclDecide, scoreDeclOption:E.scoreDeclOption, aiDiscard:E.aiDiscard, AIP:E.AIP};
})();
