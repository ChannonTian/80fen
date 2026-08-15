/* 领出侧两条反馈:
 *   D 一门副色 A 打完、无 K 有 Q,不该先打 Q(K 还在外)
 *   E' 已知别家断门还领这门(送毙),尤其带着分
 */
const fs=require('fs'),vm=require('vm');
function load(f){const b=[...fs.readFileSync(f,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  const ctx={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};
  ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(b[0],ctx);return ctx.module.exports;}
const E=load(process.argv[2]||'80fen-test.html');
const N=+process.argv[3]||150;
E.AIP.egSearch=0;
if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV));
let qLead=0,qLost=0,qPts=0, voidLead=0,voidLeadLost=0,voidLeadPts=0, leads=0;
for(let seed=1;seed<=N;seed++){
  const {first}=E.cutForFirst(seed);
  const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1;
  for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0];
    if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
  const rand=E.rng(seed^0x9e3779b9);
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart};
  if(!best) declSeat=first;
  hands[declSeat].push(...kitty);
  const buried=E.aiDiscard(hands[declSeat],trump);
  buried.forEach(c=>E.removeCard(hands[declSeat],c));
  const history=[];let leader=declSeat,tricks=0;
  while(hands.some(h=>h.length)){
    const plays=[];let watch=null;
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4;
      const view={seat,hand:hands[seat],trump,declSeat,history:[...history,...plays],
                  buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){
        const hb=hands[seat].slice();
        cards=E.aiChooseLead(view).cards;
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok)cards=chk.forced;
        leads++;
        const mem=E.makeMemory(view), voids=E.makeVoids(view.history,trump);
        const cl=E.classify(cards,trump);
        if(cl&&cl.suit!=='T'){
          // D:领出单张 Q(或任何非最大),而这门在外还有更大的、我手上没有
          if(cl.type==='single'){
            let bigOut=0;
            for(const k in mem.unseen){const n=mem.unseen[k];if(n<=0)continue;
              const c=E.keyToCard(k);
              if(E.effSuit(c,trump)===cl.suit&&E.ordIdx(c,trump)>cl.top) bigOut+=n;}
            const iHaveBigger=hb.some(c=>E.effSuit(c,trump)===cl.suit&&E.ordIdx(c,trump)>cl.top);
            if(bigOut>0&&!iHaveBigger&&cl.top>=8){ qLead++; watch={kind:'q',seat}; }
          }
          // E':明知有对手在这门断门还领这门
          const oppVoid=[0,1,2,3].some(p=>p%2!==seat%2&&voids[p]&&voids[p][cl.suit]);
          if(oppVoid){ voidLead++; watch={kind:watch?'both':'v',seat,q:!!watch}; }
        }
      }else{
        const lead=E.classify(plays[0].cards,trump);
        cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hands[seat],lead,cards,trump))
          cards=E.genFollow(hands[seat],lead,trump,rand);
      }
      cards.forEach(c=>E.removeCard(hands[seat],c));
      plays.push({seat,cards});
      if(i===0&&watch) watch.plays=plays;
    }
    const res=E.resolveTrick(plays,trump);
    if(watch&&res.winner%2!==watch.seat%2){
      if(watch.kind==='q'||watch.kind==='both'||watch.q){ qLost++; qPts+=res.points; }
      if(watch.kind==='v'||watch.kind==='both'){ voidLeadLost++; voidLeadPts+=res.points; }
    }
    history.push(...plays); leader=res.winner; if(++tricks>60)break;
  }
}
console.log(`${process.argv[2]}  ${N} 局,共领出 ${leads} 次`);
console.log(`D 领出一张「上面还有更大的、我手里又没有」的副色高牌(Q 以上): ${qLead} 次,`+
            `丢掉 ${qLost} 次 (${(100*qLost/Math.max(1,qLead)).toFixed(1)}%),送出 ${qPts} 分`);
console.log(`E' 明知有对手在这门断门仍领这门: ${voidLead} 次,丢掉 ${voidLeadLost} 次,送出 ${voidLeadPts} 分`);
