/* 守底审计:庄家埋了分,最后一墩为什么丢。
 *
 *   node test/audit-guard.js <html> [种子数=400]        (OV= 覆盖 AIP,EG=1 开收官搜索)
 *
 * 起因(产品方,2026-09-26):「现在经常底里埋分加小牌守底失败 —— 连续几局都是庄家底里 20~30 分,
 * 结果副花色的小牌最后一墩,前面的都白打。」
 *
 * 只看庄家埋底 ≥ MINK(默认 15)分的局。报:
 *   · 守住率;丢底时庄家 / 帮家最后一张是什么(主 / 副);
 *   · 庄家「钢板主」(在外已无更大的主,按当时记牌算)的去向:每一张是第几墩、以什么方式打掉的 ——
 *     自己领出 / 跟牌(被迫:手里只剩主 / 主门跟牌时没有更小的)/ 跟牌主动压 / 毙牌;
 *   · 剩 5 张、3 张时庄家手里还有几张主、有没有钢板主。
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
const N=+process.argv[3]||400, S0=+(process.env.SEED0||0), MINK=+(process.env.MINK||15);
const K={}; const inc=(k,v=1)=>{K[k]=(K[k]||0)+v;};
let games=0, all=0;
for(let seed=S0+1;seed<=S0+N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) declSeat=first;
  hands[declSeat].push(...kitty);
  const pLast=c.pWinLastTrick(hands[declSeat],trump);
  const buried=E.aiDiscard(hands[declSeat],trump); buried.forEach(x=>E.removeCard(hands[declSeat],x));
  all++;
  const kp=E.countPoints(buried); if(kp<MINK) continue;
  games++;
  const partner=(declSeat+2)%4;
  const rand=E.rng(seed^0x9e3779b9); const history=[]; let leader=declSeat, last=null, lastPlays=null, tno=0;
  const spent=[]; const snap={};
  const bossOf=(seat,view)=>{ const mem=E.makeMemory(view); return hands[seat].filter(x=>E.effSuit(x,trump)==='T'
      &&E.unseenBeats(mem,{suit:'T',top:E.ordIdx(x,trump),type:'single'},trump).higher===0); };
  while(hands.some(h=>h.length)){
    const plays=[]; tno++;
    const left=hands[declSeat].length;
    if(left===5||left===3){
      const v={seat:declSeat,hand:hands[declSeat],trump,declSeat,history,buriedKnown:buried};
      snap[left]={nT:hands[declSeat].filter(x=>E.effSuit(x,trump)==='T').length,boss:bossOf(declSeat,v).length,
                  pT:hands[partner].filter(x=>E.effSuit(x,trump)==='T').length};
    }
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards, reason='';
      const bossBefore=seat===declSeat?new Set(bossOf(seat,view).map(x=>x.id)):null;
      if(i===0){ const r=E.aiChooseLead(view); cards=r.cards; reason=r.reason; const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,trump); const r=E.aiChooseFollow(view,plays); cards=r.cards; reason=r.reason;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand); }
      if(seat===declSeat){
        for(const x of cards) if(bossBefore.has(x.id)){
          let how;
          if(i===0) how='自己领出';
          else{ const ls=E.classify(plays[0].cards,trump).suit;
            const myT=hand.filter(y=>E.effSuit(y,trump)==='T');
            if(ls==='T'){ const cheaper=myT.some(y=>!cards.some(z=>z.id===y.id)&&E.ordIdx(y,trump)<E.ordIdx(x,trump));
              how=cheaper?'主门跟牌:主动压':'主门跟牌:被迫(没有更小的主)'; }
            else how=hand.some(y=>E.effSuit(y,trump)===ls)?'副门跟牌':'毙牌 / 垫牌'; }
          spent.push({left:hand.length,how,reason:String(reason).slice(0,24)});
        }
      }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    history.push(...plays);
    const res=E.resolveTrick(plays,trump); leader=res.winner; last=res.winner; lastPlays=plays;
  }
  const held=last%2===declSeat%2;
  inc('局'); if(held) inc('守住');
  const tag=held?'守住':'丢底';
  inc(tag+'·局');
  const dc=lastPlays.find(p=>p.seat===declSeat).cards[0], pc=lastPlays.find(p=>p.seat===partner).cards[0];
  inc(`${tag}·庄家最后一张${E.effSuit(dc,trump)==='T'?'是主':'是副'}`);
  inc(`${tag}·帮家最后一张${E.effSuit(pc,trump)==='T'?'是主':'是副'}`);
  for(const L of [5,3]) if(snap[L]){ inc(`${tag}·剩${L}张时庄家主张数`,snap[L].nT); inc(`${tag}·剩${L}张时庄家钢板主`,snap[L].boss); inc(`${tag}·剩${L}张时帮家主张数`,snap[L].pT); inc(`${tag}·剩${L}张计数`); }
  for(const s of spent){ inc(`${tag}·钢板主打掉·${s.how}·${s.left>8?'中盘(>8张)':s.left>3?'收官前段(4~8张)':'最后3张'}`);
    if(!held&&s.left>3) inc(`丢底理由:${s.how} · ${s.reason}`); }
  inc(tag+'·埋分',kp); inc(tag+'·pLast',pLast);
}
const g=k=>K[k]||0;
console.log(`${FILE}${process.env.OV?' OV='+process.env.OV:''} —— ${N} 副,其中庄家埋底 ≥${MINK} 分的 ${games} 局(${(100*games/all).toFixed(0)}%)`);
console.log(`守住 ${g('守住')}/${g('局')}(${(100*g('守住')/Math.max(1,g('局'))).toFixed(0)}%);`
  +`守住的局埋底均 ${(g('守住·埋分')/Math.max(1,g('守住·局'))).toFixed(1)} 分、埋底时估守住 ${(100*g('守住·pLast')/Math.max(1,g('守住·局'))).toFixed(0)}%;`
  +`丢底的局埋底均 ${(g('丢底·埋分')/Math.max(1,g('丢底·局'))).toFixed(1)} 分、埋底时估守住 ${(100*g('丢底·pLast')/Math.max(1,g('丢底·局'))).toFixed(0)}%`);
for(const t of ['丢底','守住']){ const n=g(t+'·局'); if(!n) continue;
  console.log(`\n【${t}】${n} 局:庄家最后一张是主 ${g(t+'·庄家最后一张是主')}、是副 ${g(t+'·庄家最后一张是副')};帮家最后一张是主 ${g(t+'·帮家最后一张是主')}、是副 ${g(t+'·帮家最后一张是副')}`);
  for(const L of [5,3]){ const m=g(`${t}·剩${L}张计数`); if(m) console.log(`   剩 ${L} 张时:庄家平均 ${(g(`${t}·剩${L}张时庄家主张数`)/m).toFixed(1)} 张主、${(g(`${t}·剩${L}张时庄家钢板主`)/m).toFixed(2)} 张钢板主;帮家 ${(g(`${t}·剩${L}张时帮家主张数`)/m).toFixed(1)} 张主`); }
  console.log('   庄家的钢板主怎么没的(每局平均张数):');
  for(const k of Object.keys(K).filter(k=>k.startsWith(t+'·钢板主打掉·')).sort((a,b)=>K[b]-K[a])) console.log(`     ${(K[k]/n).toFixed(2)}  ${k.slice((t+'·钢板主打掉·').length)}`);
}
console.log('\n丢底局里,收官前(>3 张)打掉钢板主时 AI 给的理由(前 12):');
for(const k of Object.keys(K).filter(k=>k.startsWith('丢底理由:')).sort((a,b)=>K[b]-K[a]).slice(0,12)) console.log(`   ${K[k]}  ${k.slice(5)}`);
