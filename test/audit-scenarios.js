/* 手写笔记 A / B 那八条送分情景,**先数频次**。
 *
 *   node test/audit-scenarios.js <html> [种子数=300]
 *
 * 规矩(负结果笔记教训 3):**触发次数先数。** 一条只触发 9 次的规则,
 * 分数打平不说明任何事。所以在做任何反事实定价之前,先回答两个问题:
 *   ① 这一类局面每局发生几次?
 *   ② 发生的时候,**当场**丢了多少分?
 * 发生次数少到可以忽略的,直接划掉;剩下的才值得做反事实。
 *
 * 探测用的全部是**行动方自己那一刻能算出来的东西**(他自己的 `makeMemory` /
 * `pVoidOf`),不是上帝视角 —— 问的是「AI 明明算得出来,却还是这么打了」。
 *
 * ⚠️ **每一条都带一道「本来有得选」的闸门。** 第一版没有,于是 A1 每局命中 5.52 次 ——
 * 其中绝大多数是「手上根本没有能赢的主牌,必须跟小」,那不是打错,是没得选。
 * **命中 ≠ 打错。** 只有「存在一个更好的合法出法而 AI 没选」才算一次可归因的失误。
 *
 * 「当场丢的分」= 这一墩最后被对手赢走时,墩里的分。它是**下界**:
 * 真实代价还要算牌权和后续,那要靠反事实(cf-*)补。
 *
 * ⚠️ 生产配置,不关 egSearch。
 */
const fs=require('fs'),vm=require('vm');
const FILE=process.argv[2]||'80fen-test.html';
const b=[...fs.readFileSync(FILE,'utf8')
  .matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c;
vm.createContext(c);vm.runInContext(b[0],c);
const E=c.module.exports;
if(process.env.EG==='0') E.AIP.egSearch=0;
if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV));

const N=+process.argv[3]||300;
const S0=+(process.env.SEED0||0);
const PV=+(process.env.PV||0.5);          // 「高概率断门」的门槛

/* 每一条:hit=命中几次, bad=其中结果确实坏的几次, pts=坏结果当场丢的分 */
const S={};
const bump=(k,bad,pts)=>{ const s=S[k]=S[k]||{hit:0,bad:0,pts:0};
  s.hit++; if(bad){ s.bad++; s.pts+=pts||0; } };
/* 本墩结束后才知道结果,所以先挂起,墩末再结算 */
let pending=[];
const later=(k,fn)=>pending.push({k,fn});

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
  const history=[]; let leader=declSeat, defPoints=0, tricks=0, lastWinner=declSeat;

  while(hands.some(h=>h.length)){
    const plays=[]; pending=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4;
      const hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],
                  buriedKnown:seat===declSeat?buried:[]};
      let cards;
      const mem=E.makeMemory(view);
      const reads=E.makeReads(view.history,trump);
      const pVoidOf=E.makeVoidProb(reads,mem,trump,hand.length);
      const myTeam=seat%2, partnerSeat=(seat+2)%4;
      // 我之后还没出牌的座位
      const remaining=[]; for(let j=i+1;j<4;j++) remaining.push((leader+j)%4);
      const remOpp=remaining.filter(s=>s%2!==myTeam);
      const partnerLeft=remaining.includes(partnerSeat);

      if(i===0){
        cards=E.aiChooseLead(view).cards;
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok)cards=chk.forced;
        const su=E.effSuit(cards[0],trump);
        const myPts=E.countPoints(cards);

        /* B1 对手高概率断这门,我却领这门、而且这一手带分 */
        if(su!=='T'&&myPts>0){
          const pv=Math.max(...remOpp.concat([0,1,2,3].filter(s=>s%2!==myTeam))
                            .map(s=>pVoidOf(s,su)));
          // 闸门:我手上还有别的门可以领
          const otherSuit=hand.some(x=>E.effSuit(x,trump)!==su);
          if(pv>PV&&otherSuit) later('B1 对手高概率断门,却领这门送分',
                          w=>[w%2!==myTeam, myPts]);
        }
        /* B2 队友高概率断某副门,我手上有那门,却领了别的门 */
        {
          const suits=[...new Set(hand.map(x=>E.effSuit(x,trump)))].filter(s=>s!=='T');
          const cash=suits.filter(s=>s!==su&&pVoidOf(partnerSeat,s)>PV);
          if(cash.length) later('B2 队友高概率断门,却不领那门兑现', w=>[w%2!==myTeam,0]);
        }
        /* B3 主门不占优却吊主(我的主牌数 ≤ 未见主牌的 1/3) */
        if(su==='T'){
          let uT=0; for(const k in mem.unseen)
            if(mem.unseen[k]>0&&E.effSuit(E.keyToCard(k),trump)==='T') uT+=mem.unseen[k];
          const nT=hand.filter(x=>E.effSuit(x,trump)==='T').length;
          if(nT<=uT/3) later('B3 主门不占优却吊主', w=>[w%2!==myTeam,0]);
        }
      }else{
        const lead=E.classify(plays[0].cards,trump);
        cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hand,lead,cards,trump))
          cards=E.genFollow(hand,lead,trump,rand);
        const cur=E.currentWinner(plays,trump);
        const oppNowWinning=cur.seat%2!==myTeam;
        const myPts=E.countPoints(cards);
        const su=E.effSuit(cards[0],trump);
        const isRuff=su==='T'&&lead.suit!=='T';
        const iWin=(()=>{const cl=E.classify(cards,trump);
          if(!cl||!E.structMatches(cl,lead)) return false;
          if(cl.suit===cur.cl.suit) return cl.top>cur.cl.top;
          return cl.suit==='T';})();

        /* A1 主牌墩、我非末手、未见主牌里还有带分的,我却出小主没拿下 */
        if(lead.suit==='T'&&i<3&&!iWin){
          let ptTrump=0; for(const k in mem.unseen)
            if(mem.unseen[k]>0&&E.effSuit(E.keyToCard(k),trump)==='T'
               &&E.cardPoints(E.keyToCard(k))>0) ptTrump+=mem.unseen[k];
          // 闸门:我手上**有**一张现在就能赢下这墩的牌,却没用
          const couldWin=hand.some(x=>{
            if(!E.isLegalFollow(hand,lead,[x],trump)) return false;
            const cl=E.classify([x],trump);
            return cl&&E.structMatches(cl,lead)&&cl.suit===cur.cl.suit&&cl.top>cur.cl.top;});
          if(ptTrump>0&&couldWin) later('A1 吊主墩:明明有能赢的主却出小主',
                              (w,p)=>[w%2!==myTeam&&p>0, p]);
        }
        /* A2a 后手对手高概率断这门(会来毙),我却往上贴分 */
        if(myPts>0&&!iWin&&remOpp.length){
          const pv=Math.max(...remOpp.map(s=>pVoidOf(s,lead.suit)),0);
          // 闸门:我本来有不带分的合法牌可出
          const hasClean=hand.some(x=>!cards.some(y=>y.id===x.id)
            &&E.cardPoints(x)===0&&E.isLegalFollow(hand,lead,[x],trump));
          if(pv>PV&&hasClean) later('A2a 后手对手高概率断门,却往上贴分',
                          w=>[w%2!==myTeam, myPts]);
        }
        /* A2b 我用小主去毙,而后手对手也高概率断这门(可能盖毙) */
        if(isRuff&&remOpp.length){
          const pv=Math.max(...remOpp.map(s=>pVoidOf(s,lead.suit)),0);
          // 闸门:我手上**有**更大的主牌可以用来毙
          const myCl=E.classify(cards,trump);
          const myTop=myCl?myCl.top:Infinity;   // 多张不成型时不判,直接放过
          const hasBigger=hand.some(x=>E.effSuit(x,trump)==='T'
            &&!cards.some(y=>y.id===x.id)
            &&(E.classify([x],trump)||{top:-1}).top>myTop);
          if(pv>PV&&hasBigger) later('A2b 明明有更大的主,却用小主去毙',
                          (w,p)=>[w%2!==myTeam, p]);
        }
        /* A3 队友高概率断这门(他会毙),我手上有分却没贴 */
        if(partnerLeft&&oppNowWinning&&myPts===0&&lead.suit!=='T'){
          const pv=pVoidOf(partnerSeat,lead.suit);
          const hasPts=hand.some(x=>E.cardPoints(x)>0
                                 &&E.isLegalFollow(hand,lead,[x],trump));
          if(pv>PV&&hasPts) later('A3 队友高概率断门会毙,我却不贴分',
                                  w=>[w%2===myTeam, 0]);   // 「坏」=队友确实拿下了(本该贴)
        }
      }
      cards.forEach(x=>E.removeCard(hand,x));
      plays.push({seat,cards});
    }
    history.push(...plays);
    const res=E.resolveTrick(plays,trump);
    for(const {k,fn} of pending){ const [bad,pts]=fn(res.winner,res.points); bump(k,bad,pts); }
    leader=res.winner; lastWinner=res.winner; tricks++;
    if(res.winner%2!==declTeam) defPoints+=res.points;
    if(tricks>60) break;
  }
}

console.log(`${FILE} —— ${N} 局(自 ${S0+1} 起),「高概率断门」门槛 pVoid>${PV}`);
console.log('（「坏结果」的定义写在每一行后面；当场分是下界，不含牌权和后续）\n');
const rows=Object.keys(S).sort((a,b)=>S[b].pts-S[a].pts);
console.log('情景'.padEnd(34)+'命中/局   坏结果占比   当场丢分/局');
for(const k of rows){ const s=S[k];
  console.log(k.padEnd(34)
    +(s.hit/N).toFixed(2).padStart(6)
    +`   ${s.hit?(100*s.bad/s.hit).toFixed(0):'—'}% (${s.bad}/${s.hit})`.padEnd(18)
    +(s.pts/N).toFixed(2).padStart(8));
}
