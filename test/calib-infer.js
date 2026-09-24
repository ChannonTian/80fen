/* 推断校准:AI 对「别人手里有什么」的概率估计,和真实手牌对得上吗?
 *
 *   node test/calib-infer.js <html> [种子数=200]
 *
 * 起因(DESIGN §7.13 阶段 3):要把队友、对手的**出牌选择**当成信号并入记牌。
 * 在改任何出牌之前,先要一把尺子回答「推断准不准」—— 而这件事**不必靠输赢来量**:
 * 自对弈里每一刻的真实手牌都知道,推断出来的概率可以直接和真值比。
 * 这把尺子比整局对照灵敏得多,也能先于任何出牌改动独立验收。
 *
 * 现在量的是 `pVoidOf(家, 门)`:「他这门已经没有了」的概率。每个决策点,出手那一家
 * 对另外三家 × 三门副牌各问一次(主门 pVoidOf 恒为 0,不量)。
 *
 * 报三样:
 *   · Brier 分数(越小越好)与对数损失;
 *   · 分箱校准表 —— 「说 30% 的时候,真的有 30% 吗」;
 *   · 对照组:只用硬信息(见过他垫 / 毙这门 → 1,否则按「这门在外张数 × 他的手牌占比」
 *     推一个超几何的断门概率)。推断要比对照组好,才说明软推断在干活。
 *
 * 分层:**被推断的那一家是什么角色** —— 庄家 / 帮家(庄的队友)/ 庄上家 / 庄下家。
 * 庄家换过 8 张底,多半做出了断门;推断里没有这条先验的话,庄家那一格会系统性偏低。
 * 以及**谁在推断**(队友 / 对手)和阶段(手里还剩几张)。
 *
 * 生产配置默认关收官搜索(EG=1 打开)—— 这里量的是记牌,不是出牌;出牌只是用来把局面推进下去。
 */
'use strict';
const fs=require('fs'),vm=require('vm');
const FILE=process.argv[2]||'80fen-test.html';
const src=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c;
vm.createContext(c);vm.runInContext(src,c);
const E=c.module.exports;
if(process.env.EG!=='1') E.AIP.egSearch=0;
if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV));
const N=+process.argv[3]||200, S0=+(process.env.SEED0||0);

const ROLE=['庄家','庄下家','帮家','庄上家'];      // (目标座位 − 庄家座位) mod 4
const recs=[];                                   // {p, base, y, role, rel, n, hard}

/* 对照组:只用硬断门 + 超几何。他这门在外还有 u 张、未见牌共 U 张、他手里 h 张:
 * P(一张都没有) = C(U−u, h) / C(U, h)。这就是「什么推断都不做」时的断门概率。 */
function hyperVoid(U,u,h){
  if(u<=0) return 1; if(h<=0) return 1; if(U-u<h) return 0;
  let p=1; for(let i=0;i<h;i++) p*=(U-u-i)/(U-i);
  return p;
}

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
  const rand=E.rng(seed^0x9e3779b9);
  const history=[]; let leader=declSeat;
  const sides=['S','H','D','C'].filter(s=>s!==trump.suit);

  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],
                  buriedKnown:seat===declSeat?buried:[]};
      // ---------- 量:出手这一家对另外三家的断门推断 ----------
      const mem=E.makeMemory(view), reads=E.makeReads(view.history,trump);
      const pVoidOf=E.makeVoidProb(reads,mem,trump,hand.length,{declSeat,me:seat});
      let U=0; const uIn={};
      for(const k in mem.unseen){ const n=mem.unseen[k]; if(n<=0) continue;
        U+=n; const su=E.effSuit(E.keyToCard(k),trump); uIn[su]=(uIn[su]||0)+n; }
      for(let d=1;d<4;d++){
        const t=(seat+d)%4;
        const h=hands[t].length;                 // 张数是公开信息
        for(const su of sides){
          const y=hands[t].some(x=>E.effSuit(x,trump)===su)?0:1;
          const p=pVoidOf(t,su);
          const hardV=!!(reads.hard[t]&&reads.hard[t][su]);
          const base=hardV?1:hyperVoid(U,uIn[su]||0,h);
          recs.push({p,base,y,role:ROLE[(t-declSeat+4)%4],rel:(t%2===seat%2)?'队友':'对手',
                     n:hand.length,hard:hardV,obs:seat===declSeat?'庄家推断':'非庄家推断'});
        }
      }
      // ---------- 推进局面 ----------
      let cards;
      if(i===0){ cards=E.aiChooseLead(view).cards;
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,trump);
        cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand); }
      cards.forEach(x=>E.removeCard(hand,x));
      plays.push({seat,cards});
    }
    history.push(...plays);
    leader=E.resolveTrick(plays,trump).winner;
  }
}

const eps=1e-6, cl=p=>Math.min(1-eps,Math.max(eps,p));
function score(g,key){
  const n=g.length; if(!n) return null;
  let b=0,l=0; for(const r of g){ const p=r[key]; b+=(p-r.y)**2; l-=r.y?Math.log(cl(p)):Math.log(cl(1-p)); }
  return {brier:b/n, ll:l/n};
}
const fmt=(g)=>{ const a=score(g,'p'), o=score(g,'base'); const yr=g.reduce((s,r)=>s+r.y,0)/g.length;
  const mp=g.reduce((s,r)=>s+r.p,0)/g.length;
  return `n=${String(g.length).padStart(6)}  真断门率 ${(100*yr).toFixed(1).padStart(5)}%  推断均值 ${(100*mp).toFixed(1).padStart(5)}%`
    +`  Brier ${a.brier.toFixed(4)}(对照 ${o.brier.toFixed(4)})  对数损失 ${a.ll.toFixed(3)}(对照 ${o.ll.toFixed(3)})`; };

// 硬信息那一部分(见过他垫 / 毙)推断恒为 1 且恒对,会把分数拉得很好看 —— 单独剔掉看软推断
const soft=recs.filter(r=>!r.hard);
console.log(`${FILE} —— ${N} 副(自 ${S0+1} 起),${recs.length} 个「某家断某门」的问答,其中硬信息 ${recs.length-soft.length}`);
console.log(`\n全部(含硬信息)  ${fmt(recs)}`);
console.log(`只看软推断       ${fmt(soft)}`);
console.log('\n—— 软推断,按被推断的那一家的角色 ——');
for(const r of ROLE) console.log(`  ${r.padEnd(4)}  ${fmt(soft.filter(x=>x.role===r))}`);
console.log('\n—— 软推断,按谁在推断 ——');
for(const k of ['队友','对手']) console.log(`  推断${k}  ${fmt(soft.filter(x=>x.rel===k))}`);
for(const k of ['庄家推断','非庄家推断']) console.log(`  ${k}  ${fmt(soft.filter(x=>x.obs===k))}`);
console.log('\n—— 软推断,按阶段(推断方手里还剩几张)——');
for(const [lo,hi] of [[19,25],[13,18],[9,12],[1,8]])
  console.log(`  ${String(lo).padStart(2)}~${String(hi).padEnd(2)}张  ${fmt(soft.filter(x=>x.n>=lo&&x.n<=hi))}`);
console.log('\n—— 分箱校准(软推断):说 p 的时候,真的断门了多少 ——');
console.log('   区间          n     推断均值   真断门率   对照在同一批上的均值');
for(let b=0;b<10;b++){
  const lo=b/10, hi=(b+1)/10;
  const g=soft.filter(r=>r.p>=lo&&(b===9?r.p<=hi:r.p<hi)); if(!g.length) continue;
  const m=x=>g.reduce((s,r)=>s+r[x],0)/g.length;
  console.log(`  [${lo.toFixed(1)},${hi.toFixed(1)})  ${String(g.length).padStart(7)}   ${(100*m('p')).toFixed(1).padStart(6)}%   ${(100*m('y')).toFixed(1).padStart(6)}%   ${(100*m('base')).toFixed(1).padStart(6)}%`);
}
console.log('\n—— 庄家那一格的分箱(换过 8 张底的那一家)——');
{ const gg=soft.filter(r=>r.role==='庄家');
  for(let b=0;b<10;b++){ const lo=b/10,hi=(b+1)/10;
    const g=gg.filter(r=>r.p>=lo&&(b===9?r.p<=hi:r.p<hi)); if(g.length<30) continue;
    const m=x=>g.reduce((s,r)=>s+r[x],0)/g.length;
    console.log(`  [${lo.toFixed(1)},${hi.toFixed(1)})  ${String(g.length).padStart(7)}   推断 ${(100*m('p')).toFixed(1).padStart(5)}%   真 ${(100*m('y')).toFixed(1).padStart(5)}%`); } }
