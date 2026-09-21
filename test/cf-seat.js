/* 定点反事实:**非末手、桌上有分、我有多张能压过去** —— 到底该出哪张?
 *
 *   node test/cf-seat.js <html> [种子数=400]
 *
 * 起因(2026-09-21,产品方提的):
 *   「用最省的牌吃」的前提是**确定吃得住**。可我坐第 2 / 3 家时,身后还有对手 ——
 *   最省的那张压过了当前最大,却可能被后面的人再压回去:**牌白花了,分照样丢**。
 *   非末手真正该比的是:
 *     · 我方有一家能**吃住**的、最省的那一张 → 拿到这 ≥10 分,对**本局结果**的贡献
 *     · vs 两家都最省、放弃这 ≥10 分,对**本局结果**的贡献
 *   「对本局结果的贡献」= **级数**,不是分数。
 *
 * 判据(全部成立才算命中):
 *   · 领出一张、我跟一张,且**我不是末手**(i<3);
 *   · 此刻**对手**暂大(真的需要有人去争);
 *   · 台面分 ≥ PTS(默认 10 —— 一张 10 或 K 已经在桌上);
 *   · 我手上**至少两张**合法牌能压过当前最大(否则没得选)。
 *
 * 四条支路,都用同一套 AI 打完整局:
 *   A 现状      AI 实际出的那一张(生产路径)
 *   B 最省的压  能压过去的里面最便宜的一张
 *   C 最大的压  能压过去的里面最大的一张(最可能真的吃住)
 *   D 不争      最便宜的合法不压牌(把这墩让掉)
 *
 * 报 dp(分)和 **dl(净升级当量,主口径)**。
 * 关键对照是 **C − A**:若显著为正,说明 AI 在「该用大牌坐实」的局面上花得太省。
 *
 * ⚠️ 生产配置:不关 egSearch。EG=0 才关,只用来快速探路,探路的数字不许当结论。
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
const PTS=+(process.env.PTS||10);      // 台面分门槛
const MAXH=+(process.env.MAXH||3);

let nHit=0, nSeed=0;
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
        if(lead.cards.length===1&&cards.length===1&&i<3&&hitsThisDeal<MAXH){
          const hand=hands[seat];
          const X=E.followCtx(view,plays);
          if(!X.partnerWinning&&(X.ptsTable||0)>=PTS){
            // 能压过当前最大的合法单张
            const wins=hand.filter(x=>{
              if(!E.isLegalFollow(hand,lead,[x],trump)) return false;
              const cl=E.classify([x],trump);
              if(!cl||!E.structMatches(cl,X.lead)) return false;
              if(cl.suit===X.cur.cl.suit) return cl.top>X.cur.cl.top;
              return cl.suit==='T';                     // 毙(领出非主时)
            });
            if(wins.length>=2){
              const byCheap=[...wins].sort((a2,b2)=>E.cheapKey(a2,trump)-E.cheapKey(b2,trump));
              const B=byCheap[0], Cc=byCheap[byCheap.length-1];
              const loses=hand.filter(x=>E.isLegalFollow(hand,lead,[x],trump)
                                       &&!wins.some(w=>w.id===x.id))
                              .sort((a2,b2)=>E.cheapKey(a2,trump)-E.cheapKey(b2,trump));
              const D=loses[0]||null;
              const st={hands,history,leader,declSeat,trump,buried,defPoints,tricks,
                        lastWinner,lastLeadSize,plays,seed};
              const team=seat%2;
              const run=cs=>{const r=playOut(st,{seat,cards:cs,used:false});
                             return {p:val(r,team), l:netLevels(r,team)};};
              const rA=run(cards), rB=run([B]), rC=run([Cc]), rD=D?run([D]):null;
              rec.push({
                seat:i,                         // 1=第2家, 2=第3家
                pts:X.ptsTable||0,
                nWin:wins.length,
                aIsCheap:B.id===cards[0].id,    // AI 选的就是最省的那张?
                aIsTop:Cc.id===cards[0].id,
                aWins:wins.some(w=>w.id===cards[0].id),  // AI 到底压不压
                dpB:rB.p-rA.p, dlB:rB.l-rA.l,
                dpC:rC.p-rA.p, dlC:rC.l-rA.l,
                dpD:rD?rD.p-rA.p:null, dlD:rD?rD.l-rA.l:null,
                phase:hand.length, decl:team===declTeam
              });
              nHit++; hitsThisDeal++;
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
  if(hitsThisDeal) nSeed++;
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
console.log(`${FILE} —— ${N} 局(自 ${S0+1} 起,台面≥${PTS} 分):命中 ${nHit} 个(${nSeed} 副)`);
if(!rec.length){ console.log('  (一个都没命中)'); process.exit(0); }
console.log(`  AI 实际选择:压 ${rec.filter(r=>r.aWins).length}/${rec.length},`
  +`其中挑最省的 ${rec.filter(r=>r.aIsCheap).length}、挑最大的 ${rec.filter(r=>r.aIsTop).length}`);
const show=(lbl,f)=>{
  const g=rec.filter(f); if(g.length<15) return;
  console.log(`  ${lbl}  n=${g.length}`);
  console.log(`    B 最省的压 − A   分 ${stat(g.map(r=>r.dpB))}`);
  console.log(`                     级 ${stat(g.map(r=>r.dlB))}`);
  console.log(`    C 最大的压 − A   分 ${stat(g.map(r=>r.dpC))}`);
  console.log(`                     级 ${stat(g.map(r=>r.dlC))}   ← 关键对照`);
  console.log(`    D 不 争   − A   分 ${stat(g.map(r=>r.dpD))}`);
  console.log(`                     级 ${stat(g.map(r=>r.dlD))}`);
};
show('【全部】', ()=>true);
show('【第 2 家】(两家未出、队友坐末手)', r=>r.seat===1);
show('【第 3 家】(只剩末手的对手)', r=>r.seat===2);
show('【台面 ≥20 分】', r=>r.pts>=20);
if(process.env.RAW) console.log('RAW '+JSON.stringify({N,S0,nHit,nSeed,rec}));
