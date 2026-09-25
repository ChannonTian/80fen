/* 定点反事实普扫 ——**领出**那一半。
 *
 *   node test/cf-scan-lead.js <html> [种子数=400]
 *
 * cf-scan.js 扫的是跟牌。可策略真正住在领出里:六条手写笔记里的
 * 「领出/跟出分开估值」「价值随剩余牌变化」「主门无优势别反复钓主」
 * 说的全是领出。这一把照搬 cf-scan 的做法,只换决策点。
 *
 * 判据:AI 领出之后,存在一个**类别不同**的合法领出候选(否则这一手没得选)。
 *
 * 分叉:
 *   A 现状 —— aiChooseLead 真正领的那一手(**生产路径**)
 *   B 替代 —— 所有「类别与 A 不同」的候选里,coachScoreLead 打分最高的那一手
 *
 * 类别(按这一手想干什么):
 *   钓主   领主牌            甩    多组件一次甩出去
 *   领大   本门已是钢板       领分  不是钢板、且这一手带分
 *   领小   不是钢板、不带分
 * 「钓主」那一格再按「我主门有没有优势」拆开 —— 笔记第 6 条要验的正是它。
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
const PROB=+(process.env.PROB||10);    // 每 PROB 个合格决策点抽 1 个
const MAXH=+(process.env.MAXH||3);     // 每副最多抽几个(免得少数几副牌主导样本)

/* 这一手领出想干什么 */
function catOf(cl, mem, trump){
  if(cl.type==='throw') return '甩';
  if(cl.suit==='T') return '钓主';
  if(E.isBossPlay(cl,mem,trump)) return '领大';
  return E.countPoints(cl.cards)>0?'领分':'领小';
}
/* 把 aiChooseLead 那份候选表照抄一遍(不含甩子集 —— 那条会调 checkThrow,
 * 在这里只会引入噪声;甩整门保留) */
function leadCands(hand, trump, L){
  const bySuit={}; hand.forEach(c=>{(bySuit[E.effSuit(c,trump)]=bySuit[E.effSuit(c,trump)]||[]).push(c);});
  const out=[];
  for(const s in bySuit){
    for(const comp of E.decompose(bySuit[s],trump))
      out.push({cards:comp.cards,cl:{type:comp.type,len:comp.len,suit:s,top:comp.top,cards:comp.cards}});
    if(s!=='T'&&bySuit[s].length<=6){
      const cl=E.classify(bySuit[s],trump);
      if(cl&&cl.type==='throw') out.push({cards:bySuit[s],cl});
    }
  }
  return out;
}

let nHit=0, nSeed=0, nElig=0, cnt=0;
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
      if(i===0){
        const ch0=E.aiChooseLead(view);
        cards=ch0.cards;
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok)cards=chk.forced;

        // ---------- 判据 ----------
        if(hitsThisDeal<MAXH&&hands[seat].length>1){
          const hand=hands[seat];
          const L=E.leadCtx(view), mem=E.makeMemory(view);
          const clA=E.classify(cards,trump);
          const cA=clA?catOf(clA,mem,trump):null;
          let B=null,sB=-Infinity,clB=null;
          if(cA) for(const cand of leadCands(hand,trump,L)){
            if(cand.cards.length===cards.length
               &&cand.cards.every(x=>cards.some(y=>y.id===x.id))) continue;
            if(catOf(cand.cl,mem,trump)===cA) continue;
            const chk2=E.checkThrow(hands,seat,cand.cards,trump);
            if(!chk2.ok) continue;                 // 甩不成立的候选不算
            const sc=E.coachScoreLead(view,cand.cards);
            if(sc>sB){ sB=sc; B=cand.cards; clB=cand.cl; }
          }
          if(B){
            nElig++;
            if(cnt++%PROB===0){
              const st={hands,history,leader,declSeat,trump,buried,defPoints,tricks,
                        lastWinner,lastLeadSize,plays:[],seed};
              const rA=playOut(st,{seat,cards,used:false});
              const rB=playOut(st,{seat,cards:B,used:false});
              const team=seat%2;
              const nT=hand.filter(x=>E.effSuit(x,trump)==='T').length;
              rec.push({
                seed,
                a:cA, b:catOf(clB,mem,trump),
                dp:val(rB,team)-val(rA,team),
                dl:netLevels(rB,team)-netLevels(rA,team),
                decl:team===declTeam,            // 我是庄家方
                nT,                              // 手上主牌张数
                /* 「主门有没有优势」不在这里定死闸门 —— 只记原始数,
                 * 切法留到聚合时再挑,免得又把闸门和验收放进同一批数据。 */
                uT:(()=>{ let n=0; for(const k in mem.unseen)
                    if(mem.unseen[k]>0&&E.effSuit(E.keyToCard(k),trump)==='T') n+=mem.unseen[k];
                  return n; })(),                 // 还没露面的主牌张数
                voids:[...new Set(hand.map(x=>E.effSuit(x,trump)))].length,  // 还剩几门
                tr:tricks,
                phase:hand.length,
                gap:E.coachScoreLead(view,cards)-sB,
                /* AI 自己给这一手写的**理由**。领出的打分器分成十几条动机
                 * (钓主清场 / 小牌探路 / 走钢板 / 打队友断门 …),
                 * 按理由分层就能看出**哪一条动机定价错了** —— 比按类别分格细一层。 */
                rsn:(ch0.reason||'').replace(/[::].*$/,'').slice(0,24)
              });
              nHit++; hitsThisDeal++;
            }
          }
        }
      }
      else{
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
  if(hitsThisDeal) nSeed++;
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
console.log(`${FILE} —— ${N} 局(自 ${S0+1} 起):合格决策点 ${nElig} 个,抽了 ${nHit} 个(分布在 ${nSeed} 副)`);
if(!rec.length){ console.log('  (一个都没命中)'); process.exit(0); }
console.log(`  总表(所有格一起,应当接近 0 —— 若整体显著为正,先怀疑量具而不是 AI):`);
console.log(`    分数 ${stat(rec.map(r=>r.dp))}`);
console.log(`    级数 ${stat(rec.map(r=>r.dl))}`);
/* 按「AI 选了哪一类 → 换成哪一类」分格。dp 显著为正的格子 = 一条活的短板。 */
const cells={};
for(const r of rec){ const k=r.a+'→'+r.b; (cells[k]=cells[k]||[]).push(r); }
console.log('  按「AI 选的类 → 替代类」分格(按样本量排序,只列 n≥12 的):');
for(const k of Object.keys(cells).sort((x,y)=>cells[y].length-cells[x].length)){
  if(cells[k].length<12) continue;
  console.log(`    ${k.padEnd(8)} 分数 ${stat(cells[k].map(r=>r.dp))}`);
}
const layers=[
  /* 主门优势:我手上的主牌 vs 两个对手加起来大概还有多少(未见主牌的 2/3) */
  ['主门有优势 nT>2uT/3', r=>r.nT>r.uT*2/3], ['主门无优势', r=>r.nT<=r.uT*2/3],
  ['庄家方', r=>r.decl], ['闲家方', r=>!r.decl],
  ['手上还剩 ≥3 门', r=>r.voids>=3], ['手上剩 ≤2 门', r=>r.voids<=2],
  ['开局 手≥17', r=>r.phase>=17], ['中盘 手 9~16', r=>r.phase>=9&&r.phase<17],
  ['收官 手 ≤8', r=>r.phase<9],
  ['A 自估领先大 gap≥20', r=>r.gap>=20], ['A 自估领先小 gap<20', r=>r.gap<20],
];
console.log('  分层(横切所有格):');
for(const [k,f] of layers){ const a=sel(f,'dp'); if(a.length>=12) console.log(`    ${k.padEnd(16)} ${stat(a)}`); }
if(process.env.RAW) console.log('RAW '+JSON.stringify({N,S0,nHit,nElig,nSeed,rec}));
