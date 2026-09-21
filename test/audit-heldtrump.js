/* 「省下来的那张大主,后来到底怎么样了?」
 *
 *   node test/audit-heldtrump.js <html> [种子数=300]
 *
 * 起因(产品方,2026-09-21):
 *   「留下的主看似很大,但如果其他更大主还在场,副花级数牌越往后预期赢墩概率可能越低,
 *    如果最后只是撞死在更大、或者同大但领出的其他主牌,收益是什么?」
 *
 * `futureValue` 给手上每一张大主记了一笔**未来价值**,AI 正是为了这笔账
 * 才在毙牌时舍不得花大主。**这笔账到底兑不兑现,从来没量过。**
 *
 * 做法:每次 AI 毙牌时**没用**手上最大的那张主,就把那张主挂上观察名单,
 * 追到本局结束,看它的下场:
 *   · 赢墩     它出手并赢下了那一墩(未来价值兑现了)
 *   · 撞死     它出手但没赢 —— 再按「被更大的主压掉」/「跟在别人领的主后面没赢」分开
 *   · 烂手里   直到本局结束都没出手
 *
 * 只数事实,不做反事实 —— 反事实那一半是 cf-ruffsize 的活。
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

const N=+process.argv[3]||300;
const S0=+(process.env.SEED0||0);
const R={win:0,ledLost:0,beatenBigger:0,lostOther:0,never:0,ptsWhenWin:0,tricksLater:0};
let nWatch=0;

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
  const history=[]; let leader=declSeat, defPoints=0, tricks=0, lastWinner=declSeat;
  const watch=new Map();              // 卡 id → {seat, atTrick}

  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4;
      const hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],
                  buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){ cards=E.aiChooseLead(view).cards;
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok)cards=chk.forced; }
      else{
        const lead=E.classify(plays[0].cards,trump);
        cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hand,lead,cards,trump))
          cards=E.genFollow(hand,lead,trump,rand);
        /* 挂观察:我毙牌了,但手上最大的那张主没用 */
        if(lead.suit!=='T'&&cards.length===1&&E.effSuit(cards[0],trump)==='T'&&i<3){
          const topOf=x=>(E.classify([x],trump)||{top:-1}).top;
          const trumps=hand.filter(x=>E.effSuit(x,trump)==='T').sort((a,b2)=>topOf(a)-topOf(b2));
          const big=trumps[trumps.length-1];
          if(big&&big.id!==cards[0].id&&!watch.has(big.id)){
            watch.set(big.id,{seat,atTrick:tricks}); nWatch++;
          }
        }
      }
      cards.forEach(x=>E.removeCard(hand,x));
      plays.push({seat,cards});
    }
    history.push(...plays);
    const res=E.resolveTrick(plays,trump);
    /* 观察名单里的牌这一墩出手了吗? */
    for(const pl of plays) for(const card of pl.cards){
      const w=watch.get(card.id); if(!w) continue;
      watch.delete(card.id);
      R.tricksLater+=tricks-w.atTrick;
      if(res.winner===pl.seat){ R.win++; R.ptsWhenWin+=res.points; }
      else if(pl.seat===plays[0].seat) R.ledLost++;        // 它自己领出,却没赢
      else {
        const win=plays.find(q=>q.seat===res.winner);
        const wt=E.effSuit(win.cards[0],trump)==='T';
        if(wt) R.beatenBigger++; else R.lostOther++;
      }
    }
    leader=res.winner; lastWinner=res.winner; tricks++;
    if(res.winner%2!==declTeam) defPoints+=res.points;
    if(tricks>60) break;
  }
  R.never+=watch.size;
}

const tot=R.win+R.ledLost+R.beatenBigger+R.lostOther+R.never;
const pct=x=>`${(100*x/tot).toFixed(1)}%`.padStart(7);
console.log(`${FILE} —— ${N} 局(自 ${S0+1} 起)`);
console.log(`毙牌时"舍不得花"而留下的最大主,共观察 ${tot} 张(每局 ${(tot/N).toFixed(2)} 张)\n`);
console.log(`  赢墩(未来价值兑现)        ${String(R.win).padStart(6)}  ${pct(R.win)}   赢下时墩里平均 ${R.win?(R.ptsWhenWin/R.win).toFixed(1):'—'} 分`);
console.log(`  出手但没赢:`);
console.log(`    被更大的主压掉           ${String(R.beatenBigger).padStart(6)}  ${pct(R.beatenBigger)}`);
console.log(`    自己领出却没赢           ${String(R.ledLost).padStart(6)}  ${pct(R.ledLost)}`);
console.log(`    其他(跟在副牌墩后面)     ${String(R.lostOther).padStart(6)}  ${pct(R.lostOther)}`);
console.log(`  到本局结束都没出手(烂手里) ${String(R.never).padStart(6)}  ${pct(R.never)}`);
console.log(`\n  从"舍不得花"到它出手,平均又过了 ${(R.tricksLater/Math.max(1,tot-R.never)).toFixed(1)} 墩`);
