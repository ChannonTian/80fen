/* 定点反事实回放:「抢下这一墩就跨过一条阶梯线,而 AI 选择了退缩」。
 *
 *   node test/cf-line.js <html> [种子数=400]
 *
 * 判据(全部同时成立才算命中):
 *   · 我是抓分方(闲家),领出是单张;
 *   · 此刻**对手**暂大 —— 也就是这一墩真的需要我去抢,不是队友已经拿着;
 *   · 台面上的分足以把闲家从线下推过某条阶梯线(0/40/80/120/160/200);
 *   · AI 实际出的那一手**没有**把牌权抢过来,而我手上**有**一张能抢过来的合法牌。
 *
 * 分叉:
 *   A 现状(AI 实际那一手)      B 最省的抢法(能压过去的最小一张)
 * 两条支路用同一套 AI 打完整局,比最终结果。
 *
 * 报两个口径:
 *   · 分数 —— 以 80 为零点的零和,和 ai-h2h / cf-ruff 对得上;
 *   · 净升级当量 —— 真正的目标函数(上台记 1 级,再按 scoreRound 的台阶加)。
 *     跨线这件事的价值大半是阶跃的,只看分数会低估它。
 *
 * 分层看「抢之前离那条线还差几分」—— 报障(#147 等)集中在差 5~15 分那一档,
 * 而 pointWeight 的高斯包峰值钉在 gap=live/2,恰好在这一档上是回落的。
 *
 * **对照组**(规矩:凡是「该做 X」的断言都要配一条「不该做 X」的):
 * 判据里其他条件全一样、只是抢下来**不跨任何线**的决策点,按 1/CTRL 抽样。
 * 如果对照组也一样好,那这条发现就跟阶梯线无关,只是「AI 整体太被动」——
 * 两回事,修法也完全不同。
 */
const fs=require('fs'),vm=require('vm');
const FILE=process.argv[2]||'80fen-test.html';
const b=[...fs.readFileSync(FILE,'utf8')
  .matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c;
vm.createContext(c);vm.runInContext(b[0],c);
const E=c.module.exports;
/* ⚠️ 量具必须在**生产配置**下量。这一把和另外三把 cf 一样,原来硬写着 egSearch=0(图快),
 * 于是「手上 ≤5 张」那些决策点量的是一条线上根本不走的代码路径 —— 详见
 * docs/notes/measurement.md「量具必须在生产配置下量」。默认改成开;EG=0 才关,
 * 只用来快速探路,**探路的数字不许当结论**。 */
if(process.env.EG==='0') E.AIP.egSearch=0;
if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV));

/* 从某个残局(含本墩已出的牌)接着打完,forced 指定某一家的这一手打什么 */
function playOut(st, forced){
  const hands=st.hands.map(h=>h.slice()), history=st.history.slice();
  let leader=st.leader, defPoints=st.defPoints, tricks=st.tricks;
  const {trump,declSeat,buried}=st, declTeam=declSeat%2;
  let lastWinner=st.lastWinner, lastLeadSize=st.lastLeadSize;
  let pending=st.plays?st.plays.slice():[];
  const rand=E.rng(st.seed^0x9e3779b9);
  let first=true;
  while(hands.some(h=>h.length)){
    const plays=first?pending:[];
    first=false;
    for(let i=plays.length;i<4;i++){
      const seat=(leader+i)%4;
      const view={seat,hand:hands[seat],trump,declSeat,history:[...history,...plays],
                  buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(forced&&forced.seat===seat&&!forced.used){
        cards=forced.cards; forced.used=true;
      }else if(i===0){
        cards=E.aiChooseLead(view).cards;
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok)cards=chk.forced;
      }else{
        const lead=E.classify(plays[0].cards,trump);
        cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hands[seat],lead,cards,trump))
          cards=E.genFollow(hands[seat],lead,trump,rand);
      }
      cards.forEach(x=>E.removeCard(hands[seat],x));
      plays.push({seat,cards});
    }
    history.push(...plays);
    lastLeadSize=plays[0].cards.length;
    const res=E.resolveTrick(plays,trump);
    leader=res.winner; lastWinner=res.winner; tricks++;
    if(res.winner%2!==declTeam) defPoints+=res.points;
    if(tricks>60) break;
  }
  const sc=E.scoreRound({defPoints,kitty:buried,
    defWonLastTrick:lastWinner%2!==declTeam,lastLeadSize});
  return {sc, declTeam};
}
// 分数口径:以 80 为零点的零和
const val=(r,team)=>r.declTeam===team?80-r.sc.total:r.sc.total-80;
// 级数口径:本队净升几级 − 对方净升几级(闲家上台本身记 1,和 levelUtility 一致)
function netLevels(r,team){
  const {sc,declTeam}=r;
  const defUp=sc.defendersWin?1+(sc.defenderLevelsUp||0):0;
  const decUp=sc.defendersWin?0:(sc.declarerLevelsUp||0);
  const iAmDecl=team===declTeam;
  return (iAmDecl?decUp:defUp)-(iAmDecl?defUp:decUp);
}

const N=+process.argv[3]||400;
const S0=+(process.env.SEED0||0);
const CTRL=+(process.env.CTRL||6);      // 对照组抽样:每 CTRL 个取 1 个

/* 手上还剩几个**副牌门的对子**(主牌不算 —— 主牌对子另有 trumpHold 那条线) */
function sidePairs(h, trump){
  const by={}; let n=0;
  for(const c of h){ if(E.effSuit(c,trump)==='T') continue; by[c.suit+'_'+c.rank]=(by[c.suit+'_'+c.rank]||0)+1; }
  for(const k in by) n+=Math.floor(by[k]/2);
  return n;
}

let nHit=0, nCtrl=0, nSeed=0;
const dPts=[], dLvl=[];
const rec=[];

for(let seed=S0+1;seed<=S0+N;seed++){
  const {first}=E.cutForFirst(seed);
  const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1;
  for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0];
    if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart};
  if(!best) declSeat=first;
  hands[declSeat].push(...kitty);
  const buried=E.aiDiscard(hands[declSeat],trump);
  buried.forEach(x=>E.removeCard(hands[declSeat],x));
  const declTeam=declSeat%2;
  const rand=E.rng(seed^0x9e3779b9);
  const history=[]; let leader=declSeat, defPoints=0, tricks=0,
      lastWinner=declSeat, lastLeadSize=1;
  const seedPts=[], seedLvl=[];
  /* 「本局第几次遇到」—— v0.7.5 那条教训的判据:定点反事实量到的优势,
   * 如果随「第几次」迅速衰减,说明它提取的是一份**一次性资源**,
   * 做成按墩生效的规则之后聚合为零。不先看这一层就动手,是第三次踩同一个坑。 */
  const nthOf=[0,0];

  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4;
      const view={seat,hand:hands[seat],trump,declSeat,history:[...history,...plays],
                  buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){ cards=E.aiChooseLead(view).cards;
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok)cards=chk.forced; }
      else{
        const lead=E.classify(plays[0].cards,trump);
        cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hands[seat],lead,cards,trump))
          cards=E.genFollow(hands[seat],lead,trump,rand);

        // ---------- 判据 ----------
        // 只看「领出一张、跟一张」这种最干净的决策点:候选就是手里每一张合法牌。
        if(lead.cards.length===1&&cards.length===1){
          const hand=hands[seat];
          const p0=sidePairs(hand,trump);
          const left=cs=>hand.filter(x=>!cs.some(y=>y.id===x.id));
          const broke=p0-sidePairs(left(cards),trump);     // >0 = 这一手把一个副花对子拆了
          // 保住全部副花对子的合法替代里,最便宜的那张
          const keeps=hand.filter(x=>E.isLegalFollow(hand,lead,[x],trump)
                                   &&sidePairs(left([x]),trump)===p0)
                          .sort((a2,b2)=>E.cheapKey(a2,trump)-E.cheapKey(b2,trump));
          const B=keeps[0];
          // 命中 = 拆了对子、而且有不拆的合法出法;对照 = 没拆对子,同样换成「最便宜的不拆牌」
          const take=B&&B.id!==cards[0].id&&(broke>0||(nCtrl++%CTRL===0));
          if(take){
            const st={hands,history,leader,declSeat,trump,buried,defPoints,tricks,
                      lastWinner,lastLeadSize,plays,seed};
            const rA=playOut(st,{seat,cards,used:false});
            const rB=playOut(st,{seat,cards:[B],used:false});
            const team=seat%2;
            const dp=val(rB,team)-val(rA,team), dl=netLevels(rB,team)-netLevels(rA,team);
            /* 分层要的两个量:
             *   · 这门在外还剩几张 —— 对子的「成型价值」只有在别人还可能领这门时才兑现
             *   · 拆的是不是带分的对子(5/10/K) */
            const su=E.effSuit(cards[0],trump);
            const rem=(()=>{ let n=0; const mem=E.makeMemory(view);
              for(const k in mem.unseen){ if(mem.unseen[k]>0&&E.effSuit(E.keyToCard(k),trump)===su) n+=mem.unseen[k]; }
              return n; })();
            const nth=broke>0?++nthOf[team]:0;
            /* 「第几次」是**有状态**的量,AI 算不出来。所以同时记几个**无状态**特征,
             * 回头看能不能用它们复现第 1 次 / 第 2 次那道坎 ——
             * 能复现就说明不必上跨手状态,换个闸门即可;不能,才是真要第 3 条。
             *   tr 已打了几墩(= history.length/4,view 里就有)
             *   np 此刻手上还有几个副花对子 */
            rec.push({grp:broke>0?'pair':'ctrl', dp, dl, rem, nth,
                      tr:tricks, np:p0,
                      pts:E.cardPoints(cards[0])>0, phase:hand.length});
            if(broke>0){ seedPts.push(dp); seedLvl.push(dl); nHit++; }
          }
        }
      }
      cards.forEach(x=>E.removeCard(hands[seat],x));
      plays.push({seat,cards});
    }
    history.push(...plays);
    lastLeadSize=plays[0].cards.length;
    const res=E.resolveTrick(plays,trump);
    leader=res.winner; lastWinner=res.winner; tricks++;
    if(res.winner%2!==declTeam) defPoints+=res.points;
    if(tricks>60) break;
  }
  if(seedPts.length){
    nSeed++;
    dPts.push(seedPts.reduce((a,x)=>a+x,0)/seedPts.length);
    dLvl.push(seedLvl.reduce((a,x)=>a+x,0)/seedLvl.length);
  }
}

const stat=a=>{
  if(!a.length) return 'n=0';
  const m=a.reduce((x,y)=>x+y,0)/a.length;
  const sd=Math.sqrt(a.reduce((x,y)=>x+(y-m)*(y-m),0)/a.length);
  const se=sd/Math.sqrt(a.length);
  const pos=a.filter(x=>x>0).length, neg=a.filter(x=>x<0).length;
  return `${m>=0?'+':''}${m.toFixed(2)} ±${se.toFixed(2)} (t=${se?(m/se).toFixed(2):'—'}) 正/负/平 ${pos}/${neg}/${a.length-pos-neg} n=${a.length}`;
};
const sel=(f,k)=>rec.filter(f).map(r=>r[k]);
console.log(`${FILE} —— ${N} 局(自 ${S0+1} 起):拆对组命中 ${nHit} 个(分布在 ${nSeed} 副),对照组 ${rec.filter(r=>r.grp==='ctrl').length} 个`);
if(!rec.length){ console.log('  (一个都没命中,判据可能太紧)'); process.exit(0); }
const show=(label,f)=>{
  console.log(`  ${label}`);
  console.log(`    分数      ${stat(sel(f,'dp'))}`);
  console.log(`    净升级当量 ${stat(sel(f,'dl'))}`);
};
show('【拆对组】AI 拆了一个副花对子,改成不拆的最便宜牌', r=>r.grp==='pair');
show('【对照组】没拆对子,同样换成最便宜的不拆牌', r=>r.grp==='ctrl');
console.log('  拆对组按「这门在外还剩几张」分层(剩得越多,对子越可能用得上):');
for(const [k,f] of [['① 剩 ≥8 张',r=>r.rem>=8],['② 剩 4~7 张',r=>r.rem>=4&&r.rem<8],
                    ['③ 剩 ≤3 张',r=>r.rem<4]]){
  const g=r=>r.grp==='pair'&&f(r);
  if(sel(g,'dp').length) console.log(`    ${k}  分数 ${stat(sel(g,'dp'))}`);
}
console.log('  拆对组按阶段(手牌张数):');
for(const [k,f] of [['开局 ≥17',r=>r.phase>=17],['中盘 9~16',r=>r.phase>=9&&r.phase<17],
                    ['收官 ≤8',r=>r.phase<9]]){
  const g=r=>r.grp==='pair'&&f(r);
  if(sel(g,'dp').length) console.log(`    ${k}  分数 ${stat(sel(g,'dp'))}`);
}
console.log('  拆对组按「本局第几次遇到」分层(衰减得快 = 一份一次性资源,做成规则会聚合为零):');
for(const k of [1,2,3]){
  const g=r=>r.grp==='pair'&&(k<3?r.nth===k:r.nth>=3);
  if(sel(g,'dp').length) console.log(`    第 ${k<3?k:'3+'} 次  分数 ${stat(sel(g,'dp'))}`);
}
console.log('  拆对组按「拆的是不是带分的对子」:');
for(const [k,f] of [['带分(5/10/K)',r=>r.pts],['不带分',r=>!r.pts]]){
  const g=r=>r.grp==='pair'&&f(r);
  if(sel(g,'dp').length) console.log(`    ${k}  分数 ${stat(sel(g,'dp'))}`);
}
console.log(`  (总表按种子聚类,n=${nSeed}:分数 ${stat(dPts)} / 级数 ${stat(dLvl)})`);
if(process.env.RAW) console.log('RAW '+JSON.stringify({N,S0,nHit,nSeed,dPts,dLvl,rec}));
