/* 行为审计:「后手有已知断门的对手,我却把分贴过去」—— 只数,不评价棋力。
 *
 *   node test/audit-dumpvoid.js [html=80fen-test.html] [局数=400]
 *
 * 这一类报障在需求列表里有 8 条(已知对手断门还领出/贴分、已知下家断门跟废送分、
 * 三家断门下家贴分被王分收掉、#16 稳大时贴 15 分 ……)。全部是同一个形状:
 *
 *   我不是末家 → 我身后还有对手在这门**已知断门** → 我这一手加了分 →
 *   那张分牌被后面的断门方毙走。
 *
 * 这里量三个数,改动前后对比:
 *   · 触发次数   —— 这类决策发生了多少回
 *   · 贴出去的分 —— 上界(不是净损失,有些本来也守不住)
 *   · 真被断门方收走的分 —— 净损失的下界,这个才是要压下去的数
 *
 * 注意它**不是尺子**:少贴分不等于多赢分,分可能只是换个地方丢。
 * 聚合收益看 ai-h2h.js,见 docs/notes/measurement.md。
 */
const fs=require('fs'),vm=require('vm');
const b=[...fs.readFileSync(process.argv[2]||'80fen-test.html','utf8')
  .matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c;
vm.createContext(c);vm.runInContext(b[0],c);
const E=c.module.exports; E.AIP.egSearch=0;
if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV));

const N=+process.argv[3]||400;
let hit=0, ptsDumped=0, ptsToVoid=0, tricks=0, follows=0;

for(let seed=1;seed<=N;seed++){
  const {first}=E.cutForFirst(seed);
  const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1;
  for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0];
    if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}
                  :{suit:null,rank:E.RULES.levelStart};
  if(!best) declSeat=first;
  hands[declSeat].push(...kitty);
  const buried=E.aiDiscard(hands[declSeat],trump);
  buried.forEach(x=>E.removeCard(hands[declSeat],x));
  const rand=E.rng(seed^0x9e3779b9);
  const history=[]; let leader=declSeat;
  while(hands.some(h=>h.length)){
    const plays=[]; const marks=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4;
      const view={seat,hand:hands[seat],trump,declSeat,history:[...history,...plays],
                  buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){
        cards=E.aiChooseLead(view).cards;
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok)cards=chk.forced;
      }else{
        follows++;
        const lead=E.classify(plays[0].cards,trump);
        cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hands[seat],lead,cards,trump))
          cards=E.genFollow(hands[seat],lead,trump,rand);
        // 判据:我不是末家、领出的不是主、身后还有对手在这门已知断门、而我这手带分
        const voids=E.makeVoids(history,trump);
        const behind=[];
        for(let j=i+1;j<4;j++) behind.push((leader+j)%4);
        const voidOppBehind=behind.filter(s=>s%2!==seat%2&&voids[s]&&voids[s][lead.suit]);
        const my=E.countPoints(cards);
        const iWin=E.resolveTrick([...plays,{seat,cards}],trump).winner===seat;
        if(lead.suit!=='T'&&voidOppBehind.length&&my>0&&!iWin){
          hit++; ptsDumped+=my;
          marks.push({seat,my,voidOppBehind});
        }
      }
      cards.forEach(x=>E.removeCard(hands[seat],x));
      plays.push({seat,cards});
    }
    history.push(...plays);
    const res=E.resolveTrick(plays,trump);
    // 这一墩最后是不是被那个断门的对手收走了
    for(const m of marks) if(m.voidOppBehind.includes(res.winner)) ptsToVoid+=m.my;
    leader=res.winner; tricks++;
  }
}
const f=process.argv[2]||'80fen-test.html';
console.log(`${f} — ${N} 局,${tricks} 墩,${follows} 次跟牌\n`);
console.log(`  后手有已知断门对手、我却贴了分   ${hit} 次` +
            `  (占跟牌 ${(100*hit/follows).toFixed(2)}%)`);
console.log(`  贴出去的分(上界)               ${ptsDumped} 分` +
            `  (${(ptsDumped/N).toFixed(2)} 分/局)`);
console.log(`  其中真被那个断门方收走(下界)   ${ptsToVoid} 分` +
            `  (${(ptsToVoid/N).toFixed(2)} 分/局,` +
            `${ptsDumped?(100*ptsToVoid/ptsDumped).toFixed(1):0}%)`);
