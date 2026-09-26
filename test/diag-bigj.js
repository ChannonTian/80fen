/* 中盘单领大王:谁在领、为什么、换一手会不会更好(产品方反馈里一直没降,0.38~0.41 次/局)。
 *
 *   node test/diag-bigj.js <html> [种子数=400]        (OV= 覆盖 AIP;ALT=2 比较前几名候选)
 *
 * 自对弈(收官搜索关)里,每当 AI 在中盘(出牌前手里 >8 张)选择**单领大王**:
 *   · 记领出者角色(庄家 / 帮家 / 闲家)、理由、这手的打分分量、排第二的候选是什么、分差;
 *   · 反事实:同一局面分别用「大王」和「第二候选」领出,其余全部由同一个 AI 打到底,
 *     比较领出方这一队的整局得失分(闲家多拿 / 庄家少丢,含抠底)与级数。
 * 局限:续打是同一个 AI(DESIGN §7.11 的教训)—— 差值是「这个 AI 会怎么接着打」下的差值。
 */
'use strict';
const fs=require('fs'),vm=require('vm');
const FILE=process.argv[2]||'80fen-test.html';
const src=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c;
vm.createContext(c);vm.runInContext(src,c);
const E=c.module.exports;
E.AIP.egSearch=0;
if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV));
const N=+process.argv[3]||400;
const nm=x=>x.suit==='X'?(x.rank===16?'大王':'小王'):x.suit+({11:'J',12:'Q',13:'K',14:'A'}[x.rank]||x.rank);
const isBJ=cs=>cs.length===1&&cs[0].suit==='X'&&cs[0].rank===16;

/* 从 (hands, history, leader) 打到底;第一墩领出强制为 firstLead(可为 null)。返回闲家总分(含抠底)与级数(庄家方视角) */
function finish(hands0,history0,leader,trump,declSeat,buried,defSoFar,firstLead,rand){
  const hands=hands0.map(h=>h.slice()), history=history0.slice(); let def=defSoFar, lastW=leader, lastSize=1, first=true;
  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){ cards=first&&firstLead?firstLead.map(x=>hand.find(y=>y.id===x.id)):E.aiChooseLead(view).cards;
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,trump); cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand); }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    first=false; history.push(...plays); lastSize=plays[0].cards.length;
    const res=E.resolveTrick(plays,trump); leader=res.winner; lastW=res.winner;
    if(res.winner%2!==declSeat%2) def+=res.points;
  }
  const sc=E.scoreRound({defPoints:def,kitty:buried,defWonLastTrick:lastW%2!==declSeat%2,lastLeadSize:lastSize});
  const declUp=sc.defendersWin?-(1+sc.defenderLevelsUp):sc.declarerLevelsUp;
  return {total:sc.total,declUp};
}

const R=[], ALLR=[];
for(let seed=1;seed<=N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) declSeat=first;
  hands[declSeat].push(...kitty); const buried=E.aiDiscard(hands[declSeat],trump); buried.forEach(x=>E.removeCard(hands[declSeat],x));
  const rand=E.rng(seed^0x9e3779b9); const history=[]; let leader=declSeat, def=0;
  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){
        const r=E.aiChooseLead(view); cards=r.cards;
        if(hand.length>8&&isBJ(cards)){
          const cands=(r.cands||[]).slice().sort((a,b)=>b.score-a.score);
          const alt=cands.find(q=>!isBJ(q.cards));
          if(alt&&process.env.ALL==='1'){
            /* ALL=1:前 K 名候选(默认 8)逐一打到底,按类别看有没有明显更好的领法 */
            const K=+(process.env.K||8), team=seat%2, sign=team===declSeat%2?-1:1, lvSign=team===declSeat%2?1:-1;
            const rs=E.rng(seed*7+history.length);
            const base=finish(hands,history,seat,trump,declSeat,buried,def,cards,E.rng(seed*7+history.length));
            const cls=q=>{ const cl=E.classify(q.cards,trump); if(!cl) return '其他';
              if(cl.suit==='T') return q.cards.some(x=>x.suit==='X')?'王':(E.isBossPlay(cl,E.makeMemory(view),trump)?'钢板主':(cl.type==='single'?'小主单张':'主对/拖拉机'));
              return (E.isBossPlay(cl,E.makeMemory(view),trump)?'副牌钢板':'副牌非钢板')+(cl.type==='single'?'单张':'对/拖拉机'); };
            const out=[];
            for(const q of cands.filter(q=>!isBJ(q.cards)).slice(0,K)){
              const r2=finish(hands,history,seat,trump,declSeat,buried,def,q.cards,E.rng(seed*7+history.length));
              out.push({cls:cls(q),dPts:sign*(r2.total-base.total),dLv:lvSign*(r2.declUp-base.declUp)});
            }
            void rs;
            ALLR.push({role:seat===declSeat?'庄家':seat%2===declSeat%2?'帮家':'闲家',out});
          }
          if(alt&&process.env.ALL!=='1'){
            const team=seat%2, sign=team===declSeat%2?-1:1;       // 从领出方看:闲家总分 × sign
            const rb=finish(hands,history,seat,trump,declSeat,buried,def,cards,E.rng(seed*7+history.length));
            const ra=finish(hands,history,seat,trump,declSeat,buried,def,alt.cards,E.rng(seed*7+history.length));
            const lvSign=team===declSeat%2?1:-1;
            const role=seat===declSeat?'庄家':seat%2===declSeat%2?'帮家':'闲家';
            const L=E.leadCtx(view);
            const nT=hand.filter(x=>E.effSuit(x,trump)==='T').length, nBJ=hand.filter(x=>x.suit==='X'&&x.rank===16).length;
            R.push({role,reason:r.reason||'',alt:alt.cards.map(nm).join(' '),altReason:alt.reason||'',
              gap:(cands[0]?cands[0].score:0)-alt.score, n:hand.length, nT, pair:nBJ>=2,
              dPts:sign*(ra.total-rb.total), dLv:lvSign*(ra.declUp-rb.declUp),
              altTrump:alt.cards.every(x=>E.effSuit(x,trump)==='T'), kp:role==='庄家'?E.countPoints(buried):null,
              dt:c.drawTrumpValue?c.drawTrumpValue(L):null});
          }
        }
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,trump); cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand); }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    history.push(...plays);
    const res=E.resolveTrick(plays,trump); leader=res.winner; if(res.winner%2!==declSeat%2) def+=res.points;
  }
}
const m=(g,f)=>g.reduce((a,r)=>a+f(r),0)/Math.max(1,g.length);
const se=(g,f)=>{ const mu=m(g,f); return Math.sqrt(g.reduce((a,r)=>a+(f(r)-mu)**2,0)/Math.max(1,g.length-1)/Math.max(1,g.length)); };
const row=(lbl,g)=>{ if(!g.length) return;
  console.log(`${lbl.padEnd(30)} n=${String(g.length).padStart(4)}(${(g.length/N).toFixed(2)} 次/局)  换成第二候选:分 ${m(g,r=>r.dPts).toFixed(1).padStart(5)} ±${se(g,r=>r.dPts).toFixed(1)}  级 ${m(g,r=>r.dLv).toFixed(3).padStart(6)} ±${se(g,r=>r.dLv).toFixed(3)}  分差(打分) ${m(g,r=>r.gap).toFixed(1)}`); };
console.log(`${FILE}${process.env.OV?' OV='+process.env.OV:''} —— ${N} 副;中盘单领大王 vs 同一局面的第二候选(正 = 换掉大王更好)`);
row('全部',R);
for(const k of ['庄家','帮家','闲家']) row('  '+k,R.filter(r=>r.role===k));
row('  手握大王对',R.filter(r=>r.pair)); row('  单张大王',R.filter(r=>!r.pair));
row('  第二候选是主',R.filter(r=>r.altTrump)); row('  第二候选是副',R.filter(r=>!r.altTrump));
for(const [lo,hi] of [[17,25],[9,16]]) row(`  手里 ${lo}~${hi} 张`,R.filter(r=>r.n>=lo&&r.n<=hi));
for(const [lo,hi,l] of [[-99,-8,'drawTrump < −8(主不占优)'],[-8,8,'drawTrump −8~8'],[8,99,'drawTrump > 8']]) row('  '+l,R.filter(r=>r.dt!==null&&r.dt>=lo&&r.dt<hi));
const cnt=(f)=>{ const o={}; for(const r of R){ const k=f(r); o[k]=(o[k]||0)+1; } return Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,8); };
console.log('\n领大王的理由:'); for(const [k,v] of cnt(r=>r.reason.replace(/[0-9.]+/g,'#').slice(0,30))) console.log(`   ${v}  ${k}`);
console.log('第二候选的理由:'); for(const [k,v] of cnt(r=>r.altReason.replace(/[0-9.]+/g,'#').slice(0,30))) console.log(`   ${v}  ${k}`);

if(process.env.ALL==='1'){
  console.log(`\n—— ALL:每个单领大王的局面,把前 ${process.env.K||8} 名其他候选逐一打到底(正 = 比大王好)——`);
  console.log(`局面数 ${ALLR.length}(${(ALLR.length/N).toFixed(2)} 次/局)`);
  const best=ALLR.map(r=>r.out.length?Math.max(...r.out.map(o=>o.dPts)):0);
  const med=ALLR.map(r=>{ const v=r.out.map(o=>o.dPts).sort((a,b)=>a-b); return v.length?v[Math.floor(v.length/2)]:0; });
  const mm=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
  console.log(`大王是所有候选里最好(或并列)的比例 ${(100*mm(ALLR.map(r=>r.out.every(o=>o.dPts<=0)?1:0))).toFixed(0)}%;`
    +`最好的另一手比大王多 ${mm(best).toFixed(1)} 分(有挑选偏差,只作上界)、候选中位数 ${mm(med).toFixed(1)} 分`);
  const by={};
  for(const r of ALLR) for(const o of r.out){ (by[o.cls]=by[o.cls]||[]).push(o); }
  console.log('按候选类别(每类所有出现过的候选,相对大王):');
  for(const [k,g] of Object.entries(by).sort((a,b)=>b[1].length-a[1].length)){
    const mu=mm(g.map(o=>o.dPts)), sd=Math.sqrt(g.reduce((a,o)=>a+(o.dPts-mu)**2,0)/Math.max(1,g.length-1)/g.length);
    console.log(`   ${k.padEnd(12)} n=${String(g.length).padStart(5)}  分 ${mu.toFixed(1).padStart(5)} ±${sd.toFixed(1)}  级 ${mm(g.map(o=>o.dLv)).toFixed(3)}`); }
  for(const role of ['庄家','帮家','闲家']){ const g=ALLR.filter(r=>r.role===role); if(!g.length) continue;
    console.log(`   ${role}:${g.length} 个局面,大王最好 ${(100*mm(g.map(r=>r.out.every(o=>o.dPts<=0)?1:0))).toFixed(0)}%,候选中位数 ${mm(g.map(r=>{ const v=r.out.map(o=>o.dPts).sort((a,b)=>a-b); return v.length?v[Math.floor(v.length/2)]:0; })).toFixed(1)} 分`); }
}
