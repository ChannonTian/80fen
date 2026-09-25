/* 牌权到底值多少分:同一副手牌,只换「下一墩谁领」,各打到底,看分差。
 *
 *   node test/measure-tempo.js <html> [种子数=100]        (OV= 覆盖 AIP;EVERY=2 每隔几墩取一个点;MINH=6;
 *                                                          DUMP=x.json 存下逐点记录)
 *   node test/measure-tempo.js --report a.json b.json …    (分批跑的合并出报告)
 *
 * 起因(产品方,2026-09-25):「第三家接钓主,打 9 末家可以打 10,打 Q 末家可以打 K……
 * 如果不打大牌是因为场上暂无分、出大牌末家也不太会贴分,只看这一墩的分值就很低,几乎总是打废牌;
 * 所以还是**牌权 lead to 下 n 墩的预期收益**,才有可能解。」
 *
 * 打分器里「牌权」这一项现在是**手估的**:
 *   · 旧口径(tempoModel=0)跟牌侧 = 0.35 ×(tempoValue + oppTempo 6),领出侧权重 1.0;
 *   · 新口径(tempoModel=1)= leadChainValue + oppChainValue。
 * 没有一个是量出来的。这里直接量:
 *
 *   自对弈打到某一墩结束,赢家 W 本来要领下一墩。把局面原样复制三份:
 *     ① W 领;② W 的下家(对手)领;③ W 的上家(对手)领。
 *   三份都用同一个 AI 打到底。分差 = ① − (② + ③)/2,从 W 这一队的角度记
 *   (W 是闲家:多拿的分;W 是庄家:少丢的分),分别截在「接下来 1 / 2 / 3 / 5 墩」和「打到底(含抠底)」。
 *   级数口径同样给出(整局闲家总分换成 W 这一队的级数)。
 *
 * 然后拿 W 自己视角下打分器的估计(tempoValue、leadChainValue、oppChainValue)对照:
 * 分箱看「估的」和「量的」对不对得上,以及按手里还剩几张、W 是庄是闲分层。
 *
 * 局限:续打用的是同一个 AI —— 量出来的是「这个 AI 拿到牌权能兑现多少」,
 * AI 兑现得越差,量出来越小;它是**下界**,不是牌权的真值。
 */
'use strict';
const fs=require('fs'),vm=require('vm');
const REPORT=process.argv[2]==='--report';
const FILE=REPORT?'(合并)':(process.argv[2]||'80fen-test.html');
const src=REPORT?'':[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c;
vm.createContext(c);if(!REPORT) vm.runInContext(src,c);
const E=c.module.exports;
if(!REPORT&&process.env.EG!=='1') E.AIP.egSearch=0;
if(!REPORT&&process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV));
const N=+process.argv[3]||100, S0=+(process.env.SEED0||0);
const EVERY=+(process.env.EVERY||2), MINH=+(process.env.MINH||6);
const KS=[1,2,3,5];

/* 从 (hands, history, leader) 打到底;返回每墩 {winner, points} 与最后一墩领出张数 */
function rollout(hands0,history0,leader,trump,declSeat,buried,rand){
  const hands=hands0.map(h=>h.slice()), history=history0.slice(), out=[]; let lastLeadSize=1;
  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,trump); cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand); }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    history.push(...plays); lastLeadSize=plays[0].cards.length;
    const res=E.resolveTrick(plays,trump); out.push({winner:res.winner,points:res.points}); leader=res.winner;
    if(out.length>60) break;
  }
  return {tricks:out,lastLeadSize};
}
/* 整局级数,从 team 的角度(正 = team 升级 / 对方没升) */
function levelsFor(team,declTeam,defPts,defLast,buried,lastLeadSize){
  const sc=E.scoreRound({defPoints:defPts,kitty:buried,defWonLastTrick:defLast,lastLeadSize});
  const declUp=sc.defendersWin?-(1+sc.defenderLevelsUp):sc.declarerLevelsUp;   // 庄家方视角
  return team===declTeam?declUp:-declUp;
}

let recs=[];
if(REPORT) for(const f of process.argv.slice(3)) recs.push(...JSON.parse(fs.readFileSync(f,'utf8')));
for(let seed=S0+1;!REPORT&&seed<=S0+N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) declSeat=first;
  hands[declSeat].push(...kitty); const buried=E.aiDiscard(hands[declSeat],trump); buried.forEach(x=>E.removeCard(hands[declSeat],x));
  const declTeam=declSeat%2;
  const rand=E.rng(seed^0x9e3779b9); const history=[]; let leader=declSeat, defSoFar=0, tno=0;
  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,trump); cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand); }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    history.push(...plays);
    const res=E.resolveTrick(plays,trump); leader=res.winner; tno++;
    if(res.winner%2!==declTeam) defSoFar+=res.points;
    const left=hands[0].length;
    if(left<MINH||tno%EVERY) continue;
    // ---------- 分叉:W 领 / W 下家领 / W 上家领 ----------
    const W=res.winner, team=W%2, sign=team===declTeam?-1:1;          // 从 W 这一队看:闲家分 × sign
    const br=[W,(W+1)%4,(W+3)%4].map(ld=>{
      const r=rollout(hands,history,ld,trump,declSeat,buried,E.rng(seed*131+tno));
      const def=r.tricks.map(t=>t.winner%2!==declTeam?t.points:0);
      const cum=KS.map(k=>def.slice(0,k).reduce((a,b)=>a+b,0));
      const lastW=r.tricks.length?r.tricks[r.tricks.length-1].winner:W;
      const defLast=lastW%2!==declTeam;
      const kit=defLast?E.countPoints(buried)*E.RULES.kittyMultiplier(r.lastLeadSize):0;
      const all=def.reduce((a,b)=>a+b,0)+kit;
      const lv=levelsFor(team,declTeam,defSoFar+all-kit,defLast,buried,r.lastLeadSize);
      return {cum,all,lv,won1:r.tricks[0]&&r.tricks[0].winner%2===team};
    });
    const dK=KS.map((k,j)=>sign*(br[0].cum[j]-(br[1].cum[j]+br[2].cum[j])/2));
    const dAll=sign*(br[0].all-(br[1].all+br[2].all)/2);
    const dLv=br[0].lv-(br[1].lv+br[2].lv)/2;
    // ---------- W 视角下打分器怎么估 ----------
    const viewW={seat:W,hand:hands[W],trump,declSeat,history:history.slice(),buriedKnown:W===declSeat?buried:[]};
    const L=E.leadCtx(viewW);
    const tv=c.tempoValue(L,[]), lcv=c.leadChainValue(L,[]), ocv=c.oppChainValue(L);
    // 真实手牌特征(只用来分层,不是 AI 能看到的)
    const nT=s=>hands[s].filter(x=>E.effSuit(x,trump)==='T').length;
    let outPts=0; for(let s=0;s<4;s++) outPts+=E.countPoints(hands[s]);
    recs.push({left,decl:team===declTeam,dK,dAll,dLv,tv,lcv,ocv,
      trDiff:nT(W)+nT((W+2)%4)-nT((W+1)%4)-nT((W+3)%4),outPts,
      keep1:br[0].won1?1:0});
  }
}

if(process.env.DUMP) fs.writeFileSync(process.env.DUMP,JSON.stringify(recs));
// ---------- 报告 ----------
const mean=(g,f)=>g.reduce((s,r)=>s+f(r),0)/Math.max(1,g.length);
const se=(g,f)=>{ const m=mean(g,f); return Math.sqrt(g.reduce((s,r)=>s+(f(r)-m)**2,0)/Math.max(1,g.length-1)/Math.max(1,g.length)); };
const row=(lbl,g)=>{ if(!g.length) return;
  console.log(`${lbl.padEnd(22)} n=${String(g.length).padStart(5)}  `
    +KS.map((k,j)=>`${k}墩 ${mean(g,r=>r.dK[j]).toFixed(1).padStart(5)}`).join('  ')
    +`  到底 ${mean(g,r=>r.dAll).toFixed(1).padStart(5)}±${se(g,r=>r.dAll).toFixed(1)}`
    +`  级 ${mean(g,r=>r.dLv).toFixed(3).padStart(6)}`
    +`  | 估:旧跟牌 ${mean(g,r=>0.35*(r.tv+6)).toFixed(1)} 旧领出 ${mean(g,r=>r.tv+6).toFixed(1)} 新 ${mean(g,r=>r.lcv+r.ocv).toFixed(1)}`); };
console.log(REPORT?`合并 ${process.argv.length-3} 个文件`:`${FILE}${process.env.OV?' OV='+process.env.OV:''} —— ${N} 副(自 ${S0+1} 起),每 ${EVERY} 墩取一点,手里 ≥${MINH} 张`);
console.log('「牌权值」= 我方领下一墩 − 对手领下一墩,接下来 k 墩 / 打到底(含抠底)从我方看多得(少丢)的分;');
console.log('右边是打分器对同一个量的估计(旧跟牌侧 = 0.35×(tempoValue+6),旧领出侧 = tempoValue+6,新 = leadChainValue+oppChainValue)\n');
row('全部',recs);
row('我方坐庄',recs.filter(r=>r.decl)); row('我方是闲家',recs.filter(r=>!r.decl));
console.log('\n—— 按手里还剩几张 ——');
for(const [lo,hi] of [[19,25],[15,18],[11,14],[6,10]]) row(`${lo}~${hi} 张`,recs.filter(r=>r.left>=lo&&r.left<=hi));
console.log('\n—— 按两队主牌张数差(真实手牌,我方 − 对方)——');
for(const [lo,hi] of [[-99,-4],[-3,-1],[0,0],[1,3],[4,99]]) row(`主差 ${lo}~${hi}`,recs.filter(r=>r.trDiff>=lo&&r.trDiff<=hi));
console.log('\n—— 按在外分数(四家手里合计)——');
for(const [lo,hi] of [[0,30],[35,60],[65,200]]) row(`在外 ${lo}~${hi} 分`,recs.filter(r=>r.outPts>=lo&&r.outPts<=hi));
console.log('\n—— 校准:按打分器估计分箱(新口径 leadChainValue+oppChainValue)——');
for(const [lo,hi] of [[0,4],[4,8],[8,12],[12,18],[18,99]]) row(`估 ${lo}~${hi}`,recs.filter(r=>r.lcv+r.ocv>=lo&&r.lcv+r.ocv<hi));
console.log('\n—— 校准:按旧口径 tempoValue 分箱 ——');
for(const [lo,hi] of [[0,4],[4,8],[8,14],[14,99]]) row(`tempoValue ${lo}~${hi}`,recs.filter(r=>r.tv>=lo&&r.tv<hi));
// 相关系数
const corr=(f,g2)=>{ const mx=mean(recs,f),my=mean(recs,g2); let sxy=0,sx=0,sy=0;
  for(const r of recs){ const a=f(r)-mx,b=g2(r)-my; sxy+=a*b; sx+=a*a; sy+=b*b; } return sxy/Math.sqrt(sx*sy||1); };
console.log(`\n与「到底」分差的相关:tempoValue ${corr(r=>r.tv,r=>r.dAll).toFixed(3)}  新口径 ${corr(r=>r.lcv+r.ocv,r=>r.dAll).toFixed(3)}`
  +`  主牌差(真) ${corr(r=>r.trDiff,r=>r.dAll).toFixed(3)}  手里张数 ${corr(r=>r.left,r=>r.dAll).toFixed(3)}`);
console.log(`「到底」分差与级数差的相关 ${corr(r=>r.dAll,r=>r.dLv).toFixed(3)}`);
console.log(`我方领的那一份里,下一墩我方自己拿下的比例 ${(100*mean(recs,r=>r.keep1)).toFixed(0)}%`);
