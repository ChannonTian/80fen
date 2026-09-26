/* 两家配合的链条:庄家钓主 → 帮家抢权 → 打庄家断门 → 庄家毙下收割 → 牌权回到庄家。
 *
 *   node test/audit-coop.js <html> [种子数=300]        (OV= 覆盖 AIP,EG=1 开收官搜索)
 *
 * 起因(产品方,2026-09-25):「帮家尽力在盘前中期帮助牌权过渡中少旁落,经常通过
 * 庄家钓主 → 帮家抢权 → 打庄家断门收割优势并交回牌权的方法来主导牌局,
 * 自然需要在盘中经常出级数牌以及大小王来达到这个效果。」
 *
 * 数(中盘,出牌前手里 >8 张;按**真实手牌**判断断门):
 *   ① 庄家领单张主(钓主)的墩:帮家接(压过当前最大)的比例、用的是什么牌(王 / 级牌 / 其他主)、
 *      这墩最后归谁;
 *   ② 帮家有牌权时领什么:庄家真断门的副花(且两个对手不都断)/ 主 / 其他副花;
 *      领庄家断门那一手:庄家毙了没有、本队拿下没有、这墩多少分、下一墩是不是庄家领;
 *   ③ 同样的口径看闲家两家互相配合(对照)。
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
const N=+process.argv[3]||300, S0=+(process.env.SEED0||0);
const K={};
const inc=(k,v=1)=>{K[k]=(K[k]||0)+v;};
for(let seed=S0+1;seed<=S0+N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) declSeat=first;
  hands[declSeat].push(...kitty); const buried=E.aiDiscard(hands[declSeat],trump); buried.forEach(x=>E.removeCard(hands[declSeat],x));
  const partner=(declSeat+2)%4;
  const rand=E.rng(seed^0x9e3779b9); const history=[]; let leader=declSeat;
  const has=(s,su)=>hands[s].some(x=>E.effSuit(x,trump)===su);
  let pendingNext=null;
  while(hands.some(h=>h.length)){
    const mid=hands[leader].length>8;
    const plays=[]; let note=null;
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){
        cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced;
        if(mid){
          const cl=E.classify(cards,trump), su=cl?cl.suit:E.effSuit(cards[0],trump);
          const team=seat%2===declSeat%2?'庄方':'闲方', mate=(seat+2)%4, o1=(seat+1)%4, o2=(seat+3)%4;
          const role=seat===declSeat?'庄家':seat===partner?'帮家':'闲家';
          if(role!=='庄家'){
            inc(`${role}领出`);
            if(su==='T') inc(`${role}领出 · 主`);
            else if(!has(mate,su)&&!(!has(o1,su)&&!has(o2,su))){
              inc(`${role}领出 · 队友真断门的副花`);
              note={kind:`${role}领队友断门`,mate,team:seat%2};
            }else inc(`${role}领出 · 其他副花`);
            // 队友有断门可打、却没打
            const mateVoids=['S','H','D','C'].filter(x=>x!==trump.suit&&!has(mate,x)&&has(seat,x)&&(has(o1,x)||has(o2,x)));
            if(mateVoids.length) inc(`${role}有队友断门可打的次数`);
          }
          if(seat===declSeat&&cl&&cl.suit==='T'&&cards.length===1) note={kind:'钓主'};
        }
      }else{
        const lead=E.classify(plays[0].cards,trump); cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand);
      }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    history.push(...plays);
    const res=E.resolveTrick(plays,trump);
    if(pendingNext){ inc(pendingNext+' · 下一墩庄家领',res&&leader===declSeat?1:0); pendingNext=null; }
    if(note&&note.kind==='钓主'){
      inc('庄家钓主(中盘单张主)');
      const pp=plays.find(p=>p.seat===partner), pc=pp.cards[0];
      const beforeP=plays.slice(0,plays.indexOf(pp));
      const cur=E.currentWinner(beforeP,trump);
      const overDecl=E.effSuit(pc,trump)==='T'&&E.ordIdx(pc,trump)>cur.cl.top;
      if(overDecl){ inc('钓主 · 帮家压过当前最大');
        const kind=pc.suit==='X'?'王':pc.rank===trump.rank?'级牌':'其他主';
        inc('钓主 · 帮家接,用'+kind);
      }
      if(res.winner===partner) inc('钓主 · 帮家拿下');
      else if(res.winner===declSeat) inc('钓主 · 庄家自己拿下');
      else { inc('钓主 · 闲家拿下'); inc('钓主 · 闲家拿下时的分',res.points); }
    }else if(note){
      inc(note.kind);
      const mp=plays.find(p=>p.seat===note.mate);
      const ruffed=mp.cards.some(x=>E.effSuit(x,trump)==='T');
      if(ruffed) inc(note.kind+' · 队友毙了');
      if(res.winner%2===note.team){ inc(note.kind+' · 本队拿下'); inc(note.kind+' · 本队拿下的分',res.points); }
      else { inc(note.kind+' · 丢了'); inc(note.kind+' · 丢的分',res.points); }
      if(note.kind==='帮家领队友断门') pendingNext=note.kind;
    }
    leader=res.winner;
  }
}
console.log(`${FILE}${process.env.OV?' OV='+process.env.OV:''} —— ${N} 副,中盘(领出者手里 >8 张),断门按真实手牌`);
const g=k=>K[k]||0, pr=(a,b)=>b?`${(100*a/b).toFixed(0)}%`:'—', pg=k=>(g(k)/N).toFixed(2);
const tz=g('庄家钓主(中盘单张主)');
console.log(`\n① 庄家钓主 ${pg('庄家钓主(中盘单张主)')} 次/局:帮家压过当前最大 ${pr(g('钓主 · 帮家压过当前最大'),tz)}`
  +`(用王 ${g('钓主 · 帮家接,用王')}、级牌 ${g('钓主 · 帮家接,用级牌')}、其他主 ${g('钓主 · 帮家接,用其他主')})`);
console.log(`   这墩归:帮家 ${pr(g('钓主 · 帮家拿下'),tz)}、庄家 ${pr(g('钓主 · 庄家自己拿下'),tz)}、闲家 ${pr(g('钓主 · 闲家拿下'),tz)}`
  +`(闲家拿下时均 ${(g('钓主 · 闲家拿下时的分')/Math.max(1,g('钓主 · 闲家拿下'))).toFixed(1)} 分)`);
for(const role of ['帮家','闲家']){
  const n=g(`${role}领出`);
  console.log(`\n${role==='帮家'?'②':'③'} ${role}领出 ${pg(role+'领出')} 次/局:主 ${pr(g(role+'领出 · 主'),n)}、队友真断门的副花 ${pr(g(role+'领出 · 队友真断门的副花'),n)}、其他副花 ${pr(g(role+'领出 · 其他副花'),n)}`
    +`;手里有队友断门可打的领出 ${pr(g(role+'有队友断门可打的次数'),n)}`);
  const k=`${role}领队友断门`, m=g(k);
  if(m) console.log(`   领队友断门 ${m} 次:队友毙了 ${pr(g(k+' · 队友毙了'),m)}、本队拿下 ${pr(g(k+' · 本队拿下'),m)}`
    +`(均 ${(g(k+' · 本队拿下的分')/Math.max(1,g(k+' · 本队拿下'))).toFixed(1)} 分)、丢了 ${pr(g(k+' · 丢了'),m)}(均 ${(g(k+' · 丢的分')/Math.max(1,g(k+' · 丢了'))).toFixed(1)} 分)`
    +(role==='帮家'?`;下一墩庄家领 ${pr(g(k+' · 下一墩庄家领'),m)}`:''));
}
