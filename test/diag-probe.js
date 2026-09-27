/* 探路进对手断门:换别的领法会不会更好(产品方反馈里一直在;行为审计 ③ 约 2.2 次/局、带分的 0.6 次/局)。
 *
 *   node test/diag-probe.js <html> [种子数=800]        (OV= 覆盖 AIP;K=8 比较前几名候选;EG=1 开收官搜索;
 *                                                     SEED0= 起始种子;DUMP=x.json 存下逐局面记录)
 *   node test/diag-probe.js --report a.json b.json …   (分批跑的合并出报告)
 *
 * 自对弈里,AI 领出一手**副牌非钢板**、而两个对手里至少一家**真的断这门**(按真实手牌)时记一个局面(出牌前手里 >2 张)。
 * 把同一局面下 AI 候选里的其他前 K 名领法逐一换上去,同一个 AI 打到底,和实际那一手比(正 = 换掉更好):
 * 按候选类别、AI 当时推断的对手断门概率(≥0.5 = 它知道)、领出的牌带不带分、中盘 / 收官分层。
 * 局限:续打是同一个 AI(DESIGN §7.11)。
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
const N=REPORT?0:(+process.argv[3]||800), K=+(process.env.K||8), S0=+(process.env.SEED0||0);

function finish(hands0,history0,leader,trump,declSeat,buried,defSoFar,firstLead,rand){
  const hands=hands0.map(h=>h.slice()), history=history0.slice(); let def=defSoFar, lastW=leader, lastSize=1, first=true;
  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){ cards=first?firstLead.map(x=>hand.find(y=>y.id===x.id)):E.aiChooseLead(view).cards;
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
  return {total:sc.total,declUp:sc.defendersWin?-(1+sc.defenderLevelsUp):sc.declarerLevelsUp};
}

const R=[];
if(REPORT) for(const f of process.argv.slice(3)) R.push(...JSON.parse(fs.readFileSync(f,'utf8')));
for(let seed=S0+1;seed<=S0+N;seed++){
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
        const cl=E.classify(cards,trump);
        if(hand.length>2&&cl&&cl.type!=='throw'&&cl.suit!=='T'){
          const mem=E.makeMemory(view);
          const opps=[(seat+1)%4,(seat+3)%4];
          const trueVoid=opps.some(o=>!hands[o].some(x=>E.effSuit(x,trump)===cl.suit)&&hands[o].some(x=>E.effSuit(x,trump)==='T'));
          if(trueVoid&&!E.isBossPlay(cl,mem,trump)){
            const L=E.leadCtx(view), pv=L.oppVoidP(cl.suit);
            const team=seat%2, sign=team===declSeat%2?-1:1, lvSign=team===declSeat%2?1:-1;
            const rng=()=>E.rng(seed*7+history.length);
            const base=finish(hands,history,seat,trump,declSeat,buried,def,cards,rng());
            const cls=q=>{ const k=E.classify(q.cards,trump); if(!k) return '其他'; if(k.type==='throw') return '甩牌';
              if(k.suit==='T') return q.cards.some(x=>x.suit==='X')?'王':(E.isBossPlay(k,mem,trump)?'钢板主':(k.type==='single'?'小主单张':'主对/拖拉机'));
              const sv=opps.some(o=>!hands[o].some(x=>E.effSuit(x,trump)===k.suit)&&hands[o].some(x=>E.effSuit(x,trump)==='T'));
              return (E.isBossPlay(k,mem,trump)?'副牌钢板':'副牌非钢板')+(sv?'(也进断门)':'(对手不断)'); };
            const out=[];
            const same=q=>q.cards.length===cards.length&&q.cards.every(x=>cards.some(y=>y.id===x.id));
            for(const q of (r.cands||[]).slice().sort((a,b)=>b.score-a.score).filter(q=>!same(q)).slice(0,K)){
              const r2=finish(hands,history,seat,trump,declSeat,buried,def,q.cards,rng());
              out.push({cls:cls(q),dPts:sign*(r2.total-base.total),dLv:lvSign*(r2.declUp-base.declUp)});
            }
            R.push({out,knew:pv>=0.5,pts:E.countPoints(cards)>0,mid:hand.length>8,
                    role:seat===declSeat?'庄家':seat%2===declSeat%2?'帮家':'闲家',reason:String(r.reason||'').slice(0,24)});
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
if(process.env.DUMP) fs.writeFileSync(process.env.DUMP,JSON.stringify(R));
const mm=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
const sd=a=>{ const mu=mm(a); return Math.sqrt(a.reduce((x,y)=>x+(y-mu)**2,0)/Math.max(1,a.length-1)/Math.max(1,a.length)); };
console.log(REPORT?`合并 ${process.argv.length-3} 个文件:${R.length} 个局面`:`${FILE}${process.env.OV?' OV='+process.env.OV:''} —— ${N} 副;AI 领副牌非钢板、对手真断这门(有主):${R.length} 个局面(${(R.length/N).toFixed(2)} 次/局)`);
const report=(title,g)=>{ if(g.length<20) return;
  const bestAlt=g.map(r=>r.out.length?Math.max(...r.out.map(o=>o.dPts)):0);
  console.log(`\n【${title}】${g.length} 个局面;实际那一手是所有候选里最好的 ${(100*mm(g.map(r=>r.out.every(o=>o.dPts<=0)?1:0))).toFixed(0)}%;最好的另一手平均多 ${mm(bestAlt).toFixed(1)} 分(有挑选偏差)`);
  const by={}; for(const r of g) for(const o of r.out) (by[o.cls]=by[o.cls]||[]).push(o);
  for(const [k,a] of Object.entries(by).sort((x,y)=>y[1].length-x[1].length)){ if(a.length<15) continue;
    const p=a.map(o=>o.dPts), l=a.map(o=>o.dLv);
    console.log(`   ${k.padEnd(16)} n=${String(a.length).padStart(5)}  分 ${mm(p).toFixed(1).padStart(5)} ±${sd(p).toFixed(1)}  级 ${mm(l).toFixed(3).padStart(6)} ±${sd(l).toFixed(3)}`); } };
report('全部',R);
report('AI 推断到了(对手断门 ≥0.5)',R.filter(r=>r.knew));
report('AI 没推断到',R.filter(r=>!r.knew));
report('领出的牌带分',R.filter(r=>r.pts));
report('中盘(>8 张)',R.filter(r=>r.mid)); report('收官(3~8 张)',R.filter(r=>!r.mid));
const rs={}; for(const r of R) rs[r.reason]=(rs[r.reason]||0)+1;
console.log('\n实际那一手的理由:'); for(const [k,v] of Object.entries(rs).sort((a,b)=>b[1]-a[1]).slice(0,8)) console.log(`   ${v}  ${k}`);
