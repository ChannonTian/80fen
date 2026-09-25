/* 产品方试玩 v0.7.21 后报的三种行为,逐条数频次(2026-09-25)。
 *
 *   node test/audit-behavior.js <html> [种子数=300]      (OV= 覆盖 AIP,EG=1 开收官搜索)
 *
 *   ① 钓主墩里不在乎牌权、还送分:主牌领出的墩里,某家**能**压过当时最大、他那队当时也不是暂大,
 *      却没压 —— 这墩最后归了对手;其中他还**出了分**的,单独数。按「领出者的队友」和「对手」分开。
 *   ② 中盘领大王单张:手里多于 8 张时单领一张大王(小王另数)。
 *   ③ 副花小牌探路打进对手断门:领出一张**非钢板**的副花,而某个对手**真的**没有这门(真值)。
 *      再分:领出者自己的推断当时知不知道(oppVoidP > 0.5);这一手带不带分。
 *
 * 每条都附上 AI 当时给的理由,按出现次数排序 —— 理由说明它**以为**自己在干什么。
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
const C={trumpTricks:0, careless:{partner:0,opp:0}, carelessPts:{partner:0,opp:0}, carelessPtsSum:0,
         bigJ:0, smallJ:0, sideProbe:0, probeVoid:0, probeVoidKnown:0, probeVoidPts:0, probeVoidPtsSum:0};
const why={careless:{}, bigJ:{}, probe:{}};
const bump=(o,k)=>{ k=String(k||'').replace(/[0-9.]+/g,'#').slice(0,40); o[k]=(o[k]||0)+1; };

for(let seed=S0+1;seed<=S0+N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1;
  for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) declSeat=first;
  hands[declSeat].push(...kitty); const buried=E.aiDiscard(hands[declSeat],trump); buried.forEach(x=>E.removeCard(hands[declSeat],x));
  const rand=E.rng(seed^0x9e3779b9); const history=[]; let leader=declSeat;
  while(hands.some(h=>h.length)){
    const plays=[], pend=[];
    let leadInfo=null;
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards, reason='';
      if(i===0){
        const r=E.aiChooseLead(view); cards=r.cards; reason=r.reason;
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced;
        const cl=E.classify(cards,trump), su=E.effSuit(cards[0],trump);
        leadInfo={seat,su,single:cards.length===1};
        if(hand.length>8&&cards.length===1&&cards[0].suit==='X'){
          if(cards[0].rank===16){ C.bigJ++; bump(why.bigJ,reason); } else C.smallJ++; }
        if(su!=='T'&&cl&&cl.type!=='throw'){
          const L=E.leadCtx(view);
          if(!E.isBossPlay(cl,L.mem,trump)){
            C.sideProbe++;
            const opps=[0,1,2,3].filter(s=>s%2!==seat%2);
            const trulyVoid=opps.some(s=>!hands[s].some(x=>E.effSuit(x,trump)===su));
            if(trulyVoid){ C.probeVoid++; bump(why.probe,reason);
              if(L.oppVoidP(su)>0.5) C.probeVoidKnown++;
              const p=E.countPoints(cards); if(p>0){ C.probeVoidPts++; C.probeVoidPtsSum+=p; } }
          }
        }
        if(su==='T') C.trumpTricks++;
      }else{
        const lead=E.classify(plays[0].cards,trump);
        const r=E.aiChooseFollow(view,plays); cards=r.cards; reason=r.reason;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand);
        if(leadInfo.su==='T'&&leadInfo.single){
          const cur=E.currentWinner(plays,trump);
          if(cur.seat%2!==seat%2){
            const canBeat=hand.some(x=>E.effSuit(x,trump)==='T'&&E.ordIdx(x,trump)>cur.cl.top&&E.isLegalFollow(hand,lead,[x],trump));
            const mine=E.classify(cards,trump);
            const beat=mine&&mine.suit==='T'&&mine.top>cur.cl.top;
            if(canBeat&&!beat) pend.push({seat,role:seat%2===leadInfo.seat%2?'partner':'opp',pts:E.countPoints(cards),reason});
          }
        }
      }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    history.push(...plays);
    const w=E.resolveTrick(plays,trump).winner;
    for(const p of pend) if(w%2!==p.seat%2){ C.careless[p.role]++; bump(why.careless,p.role+':'+p.reason);
      if(p.pts>0){ C.carelessPts[p.role]++; C.carelessPtsSum+=p.pts; } }
    leader=w;
  }
}
const per=x=>(x/N).toFixed(2);
console.log(`${FILE}${process.env.OV?' OV='+process.env.OV:''} —— ${N} 副`);
console.log(`① 钓主墩(单张主领出)${per(C.trumpTricks)} 墩/局;能压却没压、这墩归了对手:`
  +`领出者的队友 ${per(C.careless.partner)} 次/局(其中还出了分 ${per(C.carelessPts.partner)})、`
  +`对手 ${per(C.careless.opp)} 次/局(其中还出了分 ${per(C.carelessPts.opp)});送出的分 ${per(C.carelessPtsSum)} 分/局`);
console.log(`② 中盘(>8 张)单领大王 ${per(C.bigJ)} 次/局,小王 ${per(C.smallJ)} 次/局`);
console.log(`③ 副花非钢板领出 ${per(C.sideProbe)} 次/局;打进对手真断门 ${per(C.probeVoid)} 次/局`
  +`(领出者推断知道的 ${C.probeVoid?(100*C.probeVoidKnown/C.probeVoid).toFixed(0):0}%;带分的 ${per(C.probeVoidPts)} 次/局,${per(C.probeVoidPtsSum)} 分/局)`);
const top=(o,n)=>Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([k,v])=>`    ${String(v).padStart(4)}  ${k}`).join('\n');
console.log('  ① 的理由:\n'+top(why.careless,8)); console.log('  ② 的理由:\n'+top(why.bigJ,6)); console.log('  ③ 的理由:\n'+top(why.probe,8));
