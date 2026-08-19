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
const E=c.module.exports; E.AIP.egSearch=0;      // 收官搜索太慢,且它自带阶梯目标,会盖住要测的东西
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
const SKIP=+(process.env.SKIP||0);
const S0=+(process.env.SEED0||0);        // 种子偏移:分批并行跑互不重叠的样本
const LADDER=E.SCORE_LADDER.filter(L=>L>0);

/* 一副牌里可能有好几个命中点,它们不独立(同一手牌、同一批对手)。
 * 所以:命中点全都分叉、都进分层统计,但**总表的 SE 按种子聚类** ——
 * 先把一副里的差值求平均,再把每副当一个独立读数。 */
let nCase=0, nSeed=0, nCtrl=0;
const dPts=[], dLvl=[];            // 按种子聚类后的读数(跨线组)
const rec=[];                      // 逐命中点明细:{grp,gap,L,dp,dl}
const CTRL=+(process.env.CTRL||8); // 对照组抽样:每 CTRL 个取 1 个

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
      lastWinner=declSeat, lastLeadSize=1, seen=0;
  const seedPts=[], seedLvl=[];

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
        const iAmDef=seat%2!==declTeam;
        const cur=E.currentWinner(plays,trump);
        const oppAhead=cur.seat%2!==seat%2;
        if(iAmDef&&oppAhead&&lead.cards.length===1){
          const ptsTable=E.countPoints(plays.flatMap(p=>p.cards));
          // 台面这些分若归了闲家,会跨过哪条线?
          const L=LADDER.find(x=>defPoints<x&&defPoints+ptsTable>=x);
          const takesLead=cs=>
            E.currentWinner(plays.concat([{seat,cards:cs}]),trump).seat%2===seat%2;
          if(!takesLead(cards)){
            // 手上有没有一张能压过去的合法牌?取能压的里面最小的那张
            const winners=hands[seat]
              .filter(x=>E.isLegalFollow(hands[seat],lead,[x],trump)&&takesLead([x]))
              .sort((a2,b2)=>E.ordIdx(a2,trump)-E.ordIdx(b2,trump));
            // 跨线组全取;对照组(不跨线)按 1/CTRL 抽,否则它会淹没跨线组的算力
            const take=winners.length&&(L!=null?(seen++>=SKIP):(nCtrl++%CTRL===0));
            if(take){
              const st={hands,history,leader,declSeat,trump,buried,defPoints,tricks,
                        lastWinner,lastLeadSize,plays,seed};
              const rA=playOut(st,{seat,cards,used:false});
              const rB=playOut(st,{seat,cards:[winners[0]],used:false});
              const team=seat%2;
              const dp=val(rB,team)-val(rA,team), dl=netLevels(rB,team)-netLevels(rA,team);
              rec.push({grp:L!=null?'line':'ctrl', gap:L!=null?L-defPoints:null, L:L!=null?L:null,
                        dp, dl, ptsTable});
              if(L!=null){ seedPts.push(dp); seedLvl.push(dl); nCase++; }
            }
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
  return `${m>=0?'+':''}${m.toFixed(2)} ±${se.toFixed(2)} (t=${se?(m/se).toFixed(2):'—'}) 正/负/平 ${pos}/${neg}/${a.length-pos-neg}`;
};
const sel=(f,k)=>rec.filter(f).map(r=>r[k]);
console.log(`${FILE} —— ${N} 局(自 ${S0+1} 起):跨线组命中 ${nCase} 个(分布在 ${nSeed} 副),对照组 ${rec.filter(r=>r.grp==='ctrl').length} 个`);
if(!rec.length){ console.log('  (一个都没命中,判据可能太紧)'); process.exit(0); }
const show=(label,f)=>{
  console.log(`  ${label}`);
  console.log(`    分数      ${stat(sel(f,'dp'))}`);
  console.log(`    净升级当量 ${stat(sel(f,'dl'))}`);
};
show('【跨线组】抢下就跨线', r=>r.grp==='line');
show('【对照组】抢下不跨任何线', r=>r.grp==='ctrl');
console.log(`  跨线组按「离线还差几分」分层:`);
for(const [k,f] of [['① ≤5 分',r=>r.gap<=5],['② 6~15 分',r=>r.gap>5&&r.gap<=15],
                    ['③ >15 分',r=>r.gap>15]]){
  const g=r=>r.grp==='line'&&f(r);
  if(sel(g,'dp').length) console.log(`    ${k}  分数 ${stat(sel(g,'dp'))}\n            级数 ${stat(sel(g,'dl'))}`);
}
console.log(`  跨线组按跨的是哪条线:`);
[...new Set(rec.filter(r=>r.grp==='line').map(r=>r.L))].sort((a,b)=>a-b).forEach(L=>{
  const g=r=>r.grp==='line'&&r.L===L;
  console.log(`    ${L} 线   分数 ${stat(sel(g,'dp'))}\n            级数 ${stat(sel(g,'dl'))}`);
});
console.log(`  (总表按种子聚类,n=${nSeed}:分数 ${stat(dPts)} / 级数 ${stat(dLvl)})`);
if(process.env.RAW) console.log('RAW '+JSON.stringify({N,S0,nCase,nSeed,dPts,dLvl,rec}));
