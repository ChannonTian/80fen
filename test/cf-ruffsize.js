/* 定点反事实:**毙牌毙得太小** —— 手上有更大的主,却挑了一张小主去毙。
 *
 *   node test/cf-ruffsize.js <html> [种子数=400]
 *
 * 这是 audit-scenarios 排在第一位的那一条(A2b):400 副生产配置下
 * **每局 2.38 次**、其中 55% 这一墩最后被对手赢走,当场 12.68 分/局。
 * 但当场分**不是可归因损失** —— 不毙的话那些分多半照样丢。
 * 真实代价必须把另一条支路打完整局再比,而且用**级数**口径。
 *
 * 产品方的描述(2026-09-21):
 *   「后手 AI 打出了原本可以在那一墩作为更好选择的牌,**且后手并没有足够的实质价值**」
 * 也就是说:省下来的那张大主,后面并没有真的用上 —— 那这次省就是纯亏。
 * 这一点只有打完整局才看得出来,正是反事实该干的活。
 *
 * ⚠️ **第一版的判据是错的,量到的 0 不作数。**
 *
 * 第一版只要求「我毙了、而且手上还有更大的主」—— 2669 个命中里
 * 「手上更大的主平均还有 6.8 张」,绝大多数是**怎么挑都无所谓**的局面。
 * 产品方说的是一个**有结构**的情形:
 *
 *   > 毙的那张**低于已知未出的带分主**(主 5 / 主 10 / 主 K),
 *   > 于是后手对手一张带分主**连分带牌权**一起端走。
 *
 * 那一小撮被淹在一大堆无所谓的局面里,信号稀释成 0。**分层没分对,等于没量。**
 *
 * 判据(现在):
 *   · 领出非主、领一张,我跟一张**主牌**(= 毙),且**我不是末手**;
 *   · 在外**还有带分的主牌**(未见的 主5/主10/主K),**而且它压得过我这一张**;
 *   · 我手上有牌能压过那张带分主(否则没得选)。
 *
 * 支路(都打完整局):
 *   A 现状      AI 实际毙的那张
 *   G 毙过分主  能压过**在外最大那张带分主**的最小一张 —— 这正是 `ruffGuardFollow` 的口径
 *   C 最大的主  手上最大的那张主
 *   D 不毙      最便宜的合法垫牌
 *
 * 另记**省下来的那张大主后来怎么样了**(产品方第二问):
 * 它是赢了墩、还是撞死在更大/同大的主上、还是根本没出手。
 * `futureValue` 给它记了一笔未来价值,这笔账到底兑不兑现,从来没量过。
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
const MAXH=+(process.env.MAXH||3);

let nHit=0,nSeed=0; const rec=[];

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
  let hitsThisDeal=0;

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
        if(lead.cards.length===1&&cards.length===1&&i<3&&lead.suit!=='T'
           &&E.effSuit(cards[0],trump)==='T'&&hitsThisDeal<MAXH){
          const hand=hands[seat];
          const X=E.followCtx(view,plays);
          const topOf=x=>(E.classify([x],trump)||{top:-1}).top;
          const myTop=topOf(cards[0]);
          const trumps=hand.filter(x=>E.effSuit(x,trump)==='T').sort((a2,b2)=>topOf(a2)-topOf(b2));
          /* 在外还没露面的**带分主**里最大的那张(从我自己的记牌算,不是上帝视角) */
          let ptTop=-1, ptCnt=0;
          for(const k in X.mem.unseen){
            if(X.mem.unseen[k]<=0) continue;
            const card=E.keyToCard(k);
            if(E.effSuit(card,trump)!=='T'||E.cardPoints(card)<=0) continue;
            ptCnt+=X.mem.unseen[k];
            const t=topOf(card); if(t>ptTop) ptTop=t;
          }
          // 命中 = 我这张毙牌**压不过**在外最大的带分主,而我手上有牌压得过
          const guard=trumps.find(x=>topOf(x)>ptTop);
          if(ptTop>myTop&&guard){
            const bigger=trumps.filter(x=>topOf(x)>myTop);
            const safe=guard;                    // G:压过在外最大带分主的最小一张
            const Cc=trumps[trumps.length-1];
            const D=hand.filter(x=>E.effSuit(x,trump)!=='T'
                                 &&E.isLegalFollow(hand,lead,[x],trump))
                        .sort((a2,b2)=>E.cheapKey(a2,trump)-E.cheapKey(b2,trump))[0]||null;
            const st={hands,history,leader,declSeat,trump,buried,defPoints,tricks,
                      lastWinner,lastLeadSize,plays,seed};
            const team=seat%2;
            const run=cs=>{const r=playOut(st,{seat,cards:cs,used:false});
                           return {p:val(r,team), l:netLevels(r,team)};};
            const rA=run(cards), rC=run([Cc]), rS=run([safe]), rD=D?run([D]):null;
            rec.push({
              seat:i, pts:X.ptsTable||0, nBig:bigger.length,
              ptCnt,                               // 在外还有几张带分主
              gap:ptTop-myTop,                     // 我这张离那张带分主差多远
              guardIsA:guard.id===cards[0].id,

              dpC:rC.p-rA.p, dlC:rC.l-rA.l,
              dpS:rS.p-rA.p, dlS:rS.l-rA.l,
              dpD:rD?rD.p-rA.p:null, dlD:rD?rD.l-rA.l:null,
              phase:hand.length, decl:team===declTeam
            });
            nHit++; hitsThisDeal++;
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
  if(hitsThisDeal) nSeed++;
}

function erf(x){const t=1/(1+0.3275911*x);
  return 1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x);}
const stat=a=>{a=a.filter(x=>x!==null&&x!==undefined); if(!a.length) return 'n=0';
  const m=a.reduce((x,y)=>x+y,0)/a.length;
  const sd=Math.sqrt(a.reduce((x,y)=>x+(y-m)*(y-m),0)/a.length), se=sd/Math.sqrt(a.length);
  const p=a.filter(x=>x>0).length,n=a.filter(x=>x<0).length,nz=p+n;
  const z=nz?(p-n)/Math.sqrt(nz):0, pv=nz?2*(1-0.5*(1+erf(Math.abs(z)/Math.SQRT2))):1;
  return `${m>=0?'+':''}${m.toFixed(3)} ±${se.toFixed(3)} (t=${se?(m/se).toFixed(1):'—'}) ${p}/${n} 符号p=${pv.toFixed(4)} n=${a.length}`;};
console.log(`${FILE} —— ${N} 局(自 ${S0+1} 起):毙牌、且毙得低于在外最大带分主、且手上压得过它 —— 命中 ${nHit}(${nSeed} 副)`);
if(!rec.length){ console.log('  (没命中)'); process.exit(0); }
console.log(`  其中 AI 挑的恰好是「最小的安全主」的:${rec.filter(r=>r.safeIsA).length}/${rec.length}`);
const show=(lbl,f)=>{const g=rec.filter(f); if(g.length<20) return;
  console.log(`  ${lbl}  n=${g.length}`);
  for(const [k,dp,dl] of [['G 毙过分主  ','dpS','dlS'],['C 最大的主   ','dpC','dlC'],['D 不  毙    ','dpD','dlD']]){
    console.log(`    ${k} − A  级 ${stat(g.map(r=>r[dl]))}`);
    console.log(`                分 ${stat(g.map(r=>r[dp]))}`);}};
show('【全部】', ()=>true);
show('【第 2 家】', r=>r.seat===1);
show('【第 3 家】', r=>r.seat===2);
show('【台面 ≥10 分】', r=>r.pts>=10);
show('【台面 0 分】', r=>r.pts===0);
if(process.env.RAW) console.log('RAW '+JSON.stringify({N,S0,nHit,nSeed,rec}));
