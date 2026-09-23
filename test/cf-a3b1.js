/* 定点反事实:§7.9 探测表里的 **A3** 和 **B1**,各自值多少级。
 *
 *   node test/cf-a3b1.js <html> [种子数=400]
 *
 * 起因(2026-09-23):第二赛季之后产品方说「实际对弈没感到提升,昏招送分还在」。
 * audit-scenarios 400 副的读数里,这两条坏结果占比最高:
 *   A3 队友高概率断门会毙,我却不贴分   0.41 次/局,81% 队友确实拿下了
 *   B1 对手高概率断门,却领这门送分     0.65 次/局,74% 被对手拿走
 * 「坏结果占比」不是损失 —— 贴了分可能被第三家盖毙,不领这门也许只能领更糟的。
 * 真实代价要把另一条支路打完整局,用**级数**比。判据与 audit-scenarios 逐字相同
 * (同一个 pVoid 门槛、同一道「本来有得选」的闸门),只多一条:一张对一张
 * (领出单张、我跟单张)—— 否则「贴哪张」没有干净的定义。
 *
 * A3 支路(我坐第 2 家、领出方暂大、队友坐末手且高概率断这门,AI 没贴分):
 *   A 现状   AI 实际出的那张
 *   B 贴分   合法的带分单张里,coachScoreFollow 打分最高的那张(AI 自己心目中最该贴的)
 *   B5       同上,但只许贴 5(贴 10/K 太贵的那一半,单独看)
 * B1 支路(我领出、这一手带分、这门某个对手高概率断门,我手上还有别的门):
 *   A 现状   AI 实际领的那一手
 *   B 换门   别的门(含主)里 coachScoreLead 最高的那一手
 *   C 不带分 不带分的候选里 coachScoreLead 最高的那一手(同门小牌也算)
 * 报 dp(分)和 **dl(净升级当量,主口径)**。dl>0 = 支路比 AI 好。
 *
 * **判据(2026-09-23,看数据之前写死):** 只有【全部】那一格的级数差 t≥2.5,
 * 才动手改启发式;分层读数只用来决定**怎么改**,不用来决定**改不改**。
 *
 * ⚠️ 生产配置,不关 egSearch。EG=0 只用来探路,探路的数字不许当结论。
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
const val=(r,team)=>r.declTeam===team?80-r.sc.total:r.sc.total-80;
function netLevels(r,team){
  const {sc,declTeam}=r;
  const defUp=sc.defendersWin?1+(sc.defenderLevelsUp||0):0;
  const decUp=sc.defendersWin?0:(sc.declarerLevelsUp||0);
  const iAmDecl=team===declTeam;
  return (iAmDecl?decUp:defUp)-(iAmDecl?defUp:decUp);
}

const N=+process.argv[3]||400;
const S0=+(process.env.SEED0||0);
const PV=+(process.env.PV||0.5);
const MAXH=+(process.env.MAXH||2);        // 每副每条最多取几个点,别让一副牌占太多样本

const A3=[], B1=[];
const comps=(hand,trump)=>{
  const by={}; hand.forEach(c=>{(by[E.effSuit(c,trump)]=by[E.effSuit(c,trump)]||[]).push(c);});
  const out=[]; for(const su in by) for(const cp of E.decompose(by[su],trump)) out.push({su,cards:cp.cards});
  return out;
};

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
  let hA3=0, hB1=0;

  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4;
      const hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],
                  buriedKnown:seat===declSeat?buried:[]};
      const team=seat%2, partnerSeat=(seat+2)%4;
      const snap=()=>({hands,history,leader,declSeat,trump,buried,defPoints,tricks,
                       lastWinner,lastLeadSize,plays,seed});
      const run=(cs)=>{const r=playOut(snap(),{seat,cards:cs,used:false});
                       return {p:val(r,team), l:netLevels(r,team)};};
      let cards;
      if(i===0){
        cards=E.aiChooseLead(view).cards;
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok)cards=chk.forced;
        // ---------- B1 ----------
        const su=E.effSuit(cards[0],trump), myPts=E.countPoints(cards);
        if(hB1<MAXH&&su!=='T'&&myPts>0&&hand.some(x=>E.effSuit(x,trump)!==su)){
          const mem=E.makeMemory(view), reads=E.makeReads(view.history,trump);
          const pVoidOf=E.makeVoidProb(reads,mem,trump,hand.length);
          const pv=Math.max(...[0,1,2,3].filter(s=>s%2!==team).map(s=>pVoidOf(s,su)));
          if(pv>PV){
            const cs=comps(hand,trump).map(c=>({...c,sc:E.coachScoreLead(view,c.cards),
                                                 pts:E.countPoints(c.cards)}))
                                     .sort((a,b)=>b.sc-a.sc);
            const Bc=cs.find(c=>c.su!==su), Cc=cs.find(c=>c.pts===0);
            const rA=run(cards), rB=Bc?run(Bc.cards):null, rC=Cc?run(Cc.cards):null;
            B1.push({pv, pts:myPts, n:hand.length, decl:team===declTeam, len:cards.length,
              dpB:rB?rB.p-rA.p:null, dlB:rB?rB.l-rA.l:null,
              dpC:rC?rC.p-rA.p:null, dlC:rC?rC.l-rA.l:null, cSame:Cc?Cc.su===su:null});
            hB1++;
          }
        }
      }else{
        const lead=E.classify(plays[0].cards,trump);
        cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand);
        // ---------- A3 ----------
        const cur=E.currentWinner(plays,trump);
        if(hA3<MAXH&&i===1&&lead.cards.length===1&&cards.length===1&&lead.suit!=='T'
           &&cur.seat%2!==team&&E.countPoints(cards)===0){
          const mem=E.makeMemory(view), reads=E.makeReads(view.history,trump);
          const pVoidOf=E.makeVoidProb(reads,mem,trump,hand.length);
          const pv=pVoidOf(partnerSeat,lead.suit);
          const dumps=hand.filter(x=>E.cardPoints(x)>0&&E.isLegalFollow(hand,lead,[x],trump));
          if(pv>PV&&dumps.length){
            const sc=dumps.map(x=>({x,s:E.coachScoreFollow(view,plays,[x])})).sort((a,b)=>b.s-a.s);
            const B=sc[0].x, B5=(sc.find(o=>E.cardPoints(o.x)===5)||{}).x;
            const pv3=pVoidOf((seat+1)%4,lead.suit);   // 第三家(对手)也断这门 → 可能盖毙
            const rA=run(cards), rB=run([B]), rB5=B5?run([B5]):null;
            A3.push({pv, pv3, bPts:E.cardPoints(B), n:hand.length, decl:team===declTeam,
              bIsTrump:E.effSuit(B,trump)==='T', bSameSuit:E.effSuit(B,trump)===lead.suit,
              dpB:rB.p-rA.p, dlB:rB.l-rA.l,
              dpB5:rB5?rB5.p-rA.p:null, dlB5:rB5?rB5.l-rA.l:null});
            hA3++;
          }
        }
      }
      cards.forEach(x=>E.removeCard(hand,x));
      plays.push({seat,cards});
    }
    history.push(...plays);
    lastLeadSize=plays[0].cards.length;
    const res=E.resolveTrick(plays,trump);
    leader=res.winner; lastWinner=res.winner; tricks++;
    if(res.winner%2!==declTeam) defPoints+=res.points;
    if(tricks>60) break;
  }
}

function erf(x){const t=1/(1+0.3275911*x);
  return 1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x);}
const stat=a=>{
  a=a.filter(x=>x!==null&&x!==undefined);
  if(!a.length) return 'n=0';
  const m=a.reduce((x,y)=>x+y,0)/a.length;
  const sd=Math.sqrt(a.reduce((x,y)=>x+(y-m)*(y-m),0)/a.length);
  const se=sd/Math.sqrt(a.length);
  const p=a.filter(x=>x>0).length,n=a.filter(x=>x<0).length,nz=p+n;
  const z=nz?(p-n)/Math.sqrt(nz):0;
  const pv=nz?2*(1-0.5*(1+erf(Math.abs(z)/Math.SQRT2))):1;
  return `${m>=0?'+':''}${m.toFixed(2)} ±${se.toFixed(2)} (t=${se?(m/se).toFixed(1):'—'}) ${p}/${n} 符号p=${pv.toFixed(3)} n=${a.length}`;
};
console.log(`${FILE} —— ${N} 局(自 ${S0+1} 起),pVoid>${PV}:A3 命中 ${A3.length},B1 命中 ${B1.length}`);
const show=(lbl,g,rows)=>{ if(g.length<10){ console.log(`  ${lbl}  n=${g.length}(太少,不报)`); return; }
  console.log(`  ${lbl}  n=${g.length}`);
  for(const [name,kp,kl] of rows){
    console.log(`    ${name}  分 ${stat(g.map(r=>r[kp]))}`);
    console.log(`    ${' '.repeat(name.length)}  级 ${stat(g.map(r=>r[kl]))}`);
  }
};
const RA3=[['B 贴分 −A','dpB','dlB'],['B5 贴5 −A','dpB5','dlB5']];
console.log('\nA3 队友高概率断门会毙,我(第 2 家)却不贴分');
show('【全部】',A3,RA3);
show('【贴的是 10/K】',A3.filter(r=>r.bPts>=10),RA3.slice(0,1));
show('【第三家也高概率断门(可能盖毙)】',A3.filter(r=>r.pv3>PV),RA3);
show('【第三家不太可能断门】',A3.filter(r=>r.pv3<=PV),RA3);
show('【我坐庄方】',A3.filter(r=>r.decl),RA3);
show('【我是闲家】',A3.filter(r=>!r.decl),RA3);
const RB1=[['B 换门   −A','dpB','dlB'],['C 不带分 −A','dpC','dlC']];
console.log('\nB1 对手高概率断门,却领这门送分');
show('【全部】',B1,RB1);
show('【领单张】',B1.filter(r=>r.len===1),RB1);
show('【pVoid ≥ 0.8】',B1.filter(r=>r.pv>=0.8),RB1);
show('【领的这手 ≥10 分】',B1.filter(r=>r.pts>=10),RB1);
show('【我坐庄方】',B1.filter(r=>r.decl),RB1);
show('【我是闲家】',B1.filter(r=>!r.decl),RB1);
if(process.env.RAW) console.log('RAW '+JSON.stringify({N,S0,A3,B1}));
