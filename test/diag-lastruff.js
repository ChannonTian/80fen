/* 末家、队友暂大、我断门:用主分牌毙掉队友的墩拿牌权,接着领什么(产品方,2026-09-27):
 * 「最后一家出牌,队友暂大,用主分毙掉后拿到牌权,但用了副花小牌探路送掉了分和牌权,
 *  没有选择更有可能控制局面的打法比如小主钓主。这种情况对级数和分数有影响吗?」
 *
 *   node test/diag-lastruff.js <html> [种子数=1000]        (OV= 覆盖 AIP)
 *
 * 自对弈(收官搜索默认关,EG=1 打开;出牌前手里 >2 张,按中盘 / 收官分层)里,末家在副牌墩、队友暂大、自己断门时,AI 选了带分的主去毙 → 记一个局面。
 * 分三支,各用同一个 AI 打到底,比较这一队的整局得失分(闲家多拿 / 庄家少丢,含抠底)与级数:
 *   A 实际      —— 毙,然后下一墩由 AI 自己领;
 *   B 不毙      —— 垫一张副牌(AI 候选里分最高的非主那一手;没有就垫最小的副牌),牌权留给队友;
 *   C 毙 + 钓主 —— 毙,下一墩强制领手里最小的一张非王主(没有主就不算)。
 * 另记 A 支里毙完之后领的是什么、那一墩的结果。续打是同一个 AI(局限见 DESIGN §7.11)。
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
const N=+process.argv[3]||1000;

/* 从一墩打到一半的局面续打:plays0 已出,forced 依次指定「第几手」的出牌({trick:0|1, pos, cards}),其余 AI。 */
function run(hands0,history0,leader,plays0,forced,trump,declSeat,buried,defSoFar,rand,log){
  const hands=hands0.map(h=>h.slice()), history=history0.slice();
  let def=defSoFar, lastW=leader, lastSize=1, t=0, plays=plays0.slice();
  while(true){
    for(let i=plays.length;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      const f=forced.find(q=>q.trick===t&&q.pos===i);
      let cards;
      if(f) cards=f.cards.map(x=>hand.find(y=>y.id===x.id));
      else if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,trump); cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand); }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    history.push(...plays); lastSize=plays[0].cards.length;
    const res=E.resolveTrick(plays,trump);
    if(log&&t===1) log.next={cards:plays[0].cards,winner:res.winner,points:res.points};
    leader=res.winner; lastW=res.winner; if(res.winner%2!==declSeat%2) def+=res.points;
    plays=[]; t++;
    if(!hands.some(h=>h.length)) break;
  }
  const sc=E.scoreRound({defPoints:def,kitty:buried,defWonLastTrick:lastW%2!==declSeat%2,lastLeadSize:lastSize});
  return {total:sc.total,declUp:sc.defendersWin?-(1+sc.defenderLevelsUp):sc.declarerLevelsUp};
}

const R=[];
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
      if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{
        const lead=E.classify(plays[0].cards,trump); const r=E.aiChooseFollow(view,plays); cards=r.cards;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand);
        if(i===3&&hand.length>2&&lead.suit!=='T'&&lead.cards.length===1){
          const cur=E.currentWinner(plays,trump);
          const void_=!hand.some(x=>E.effSuit(x,trump)===lead.suit);
          const ruffPt=cards.length===1&&E.effSuit(cards[0],trump)==='T'&&E.cardPoints(cards[0])>0;
          if(cur.seat===(seat+2)%4&&cur.cl.suit!=='T'&&void_&&ruffPt){
            const team=seat%2, sign=team===declSeat%2?-1:1, lvSign=team===declSeat%2?1:-1;
            const side=hand.filter(x=>E.effSuit(x,trump)!=='T');
            const sideCand=(r.cands||[]).filter(q=>q.cards.length===1&&E.effSuit(q.cards[0],trump)!=='T').sort((a,b)=>b.score-a.score)[0];
            const dump=sideCand?sideCand.cards:(side.length?[side.slice().sort((a,b)=>E.cardPoints(a)-E.cardPoints(b)||E.ordIdx(a,trump)-E.ordIdx(b,trump))[0]]:null);
            const rest=hand.filter(x=>x.id!==cards[0].id);
            const smallT=rest.filter(x=>E.effSuit(x,trump)==='T'&&x.suit!=='X').sort((a,b)=>E.ordIdx(a,trump)-E.ordIdx(b,trump))[0];
            const logA={};
            const rng=()=>E.rng(seed*17+history.length);
            const A=run(hands,history,leader,plays,[{trick:0,pos:3,cards}],trump,declSeat,buried,def,rng(),logA);
            const B=dump?run(hands,history,leader,plays,[{trick:0,pos:3,cards:dump}],trump,declSeat,buried,def,rng()):null;
            const C=smallT?run(hands,history,leader,plays,[{trick:0,pos:3,cards},{trick:1,pos:0,cards:[smallT]}],trump,declSeat,buried,def,rng()):null;
            const v=x=>x?{pts:sign*x.total,lv:lvSign*x.declUp}:null;
            const nl=logA.next; let nextKind='?';
            if(nl){ const cl=E.classify(nl.cards,trump);
              const mem=E.makeMemory({seat,hand:rest,trump,declSeat,history:[...history,...plays.slice(0,3),{seat,cards}],buriedKnown:seat===declSeat?buried:[]});
              nextKind=!cl?'甩牌':cl.suit==='T'?(nl.cards.some(x=>x.suit==='X')?'王':'主'):(E.isBossPlay(cl,mem,trump)?'副牌钢板':'副牌非钢板');
              nextKind+=`·${nl.winner%2===team?'本队拿下':'丢了'}`; }
            R.push({A:v(A),B:v(B),C:v(C),next:nextKind,nextPts:nl?(nl.winner%2===team?1:-1)*nl.points:0,
                    ptsTable:E.countPoints(plays.flatMap(p=>p.cards)),phase:hand.length>8?'中盘(>8 张)':'收官(3~8 张)',card:E.cardPoints(cards[0]),role:seat===declSeat?'庄家':seat%2===declSeat%2?'帮家':'闲家'});
          }
        }
      }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    history.push(...plays);
    const res=E.resolveTrick(plays,trump); leader=res.winner; if(res.winner%2!==declSeat%2) def+=res.points;
  }
}
const mm=(g,f)=>g.reduce((a,r)=>a+f(r),0)/Math.max(1,g.length);
const se=(g,f)=>{ const mu=mm(g,f); return Math.sqrt(g.reduce((a,r)=>a+(f(r)-mu)**2,0)/Math.max(1,g.length-1)/Math.max(1,g.length)); };
console.log(`${FILE}${process.env.OV?' OV='+process.env.OV:''} —— ${N} 副;末家、副牌墩、队友暂大、自己断门,AI 用主分牌毙:${R.length} 个局面(${(R.length/N).toFixed(2)} 次/局)`);
const cmp=(lbl,g,k)=>{ g=g.filter(r=>r[k]); if(g.length<15) return;
  const d=r=>r[k].pts-r.A.pts, dl=r=>r[k].lv-r.A.lv;
  console.log(`  ${lbl.padEnd(26)} n=${String(g.length).padStart(4)}  相对 A:分 ${mm(g,d).toFixed(1).padStart(5)} ±${se(g,d).toFixed(1)}  级 ${mm(g,dl).toFixed(3).padStart(6)} ±${se(g,dl).toFixed(3)}`); };
const block=(title,g)=>{ if(g.length<15) return; console.log(`\n【${title}】`); cmp('B 不毙(垫副牌)',g,'B'); cmp('C 毙 + 下一手小主钓主',g,'C'); };
block('全部',R);
block('A 毙完之后领的是副牌非钢板',R.filter(r=>r.next.startsWith('副牌非钢板')));
block('A 毙完之后领副牌非钢板、而且丢了那一墩',R.filter(r=>r.next==='副牌非钢板·丢了'));
block('A 毙完之后领的是副牌钢板',R.filter(r=>r.next.startsWith('副牌钢板')));
block('A 毙完之后领的是主',R.filter(r=>r.next.startsWith('主')));
for(const role of ['庄家','帮家','闲家']) block('坐'+role,R.filter(r=>r.role===role));
for(const ph of ['中盘(>8 张)','收官(3~8 张)']) block(ph,R.filter(r=>r.phase===ph));
const cnt={}; for(const r of R) cnt[r.next]=(cnt[r.next]||0)+1;
console.log('\nA 支里毙完之后的下一手:'); for(const [k,v] of Object.entries(cnt).sort((a,b)=>b[1]-a[1]))
  console.log(`   ${String(v).padStart(4)}(${(100*v/R.length).toFixed(0)}%)  ${k}  这一墩均 ${mm(R.filter(r=>r.next===k),r=>r.nextPts).toFixed(1)} 分(本队视角)`);
