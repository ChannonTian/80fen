/* 两条实战反馈的客观计数:
 *   C 已知下家断门,仍用小主毙牌 → 被盖毙
 *   E 自己断门、手上有废牌可垫,却贴了分牌给赢下这墩的对手
 */
const fs=require('fs'),vm=require('vm');
function load(f){const b=[...fs.readFileSync(f,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  const ctx={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};
  ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(b[0],ctx);return ctx.module.exports;}
const E=load(process.argv[2]||'80fen-test.html');
const N=+process.argv[3]||150;
E.AIP.egSearch=0;
if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV));                     // 审计不用收官推演,太慢
let guardChosen=0,gateHit=0,ruffTot=0,ruffOverKnown=0,ruffAvoidable=0,ptsLost=0,dumpTot=0,dumpBad=0,ptsGiven=0;
for(let seed=1;seed<=N;seed++){
  const {first}=E.cutForFirst(seed);
  const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1;
  for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0];
    if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
  const rand=E.rng(seed^0x9e3779b9);
  let trump;
  if(!best){trump={suit:null,rank:E.RULES.levelStart};declSeat=first;}
  else trump={suit:best.suit,rank:E.RULES.levelStart};
  hands[declSeat].push(...kitty);
  const buried=E.aiDiscard(hands[declSeat],trump);
  buried.forEach(c=>E.removeCard(hands[declSeat],c));
  const history=[];let leader=declSeat,tricks=0;
  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4;
      const view={seat,hand:hands[seat],trump,declSeat,history:[...history,...plays],
                  buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){ cards=E.aiChooseLead(view).cards;
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok)cards=chk.forced; }
      else{
        const lead=E.classify(plays[0].cards,trump);
        const handBefore=hands[seat].slice();
        const _ch=E.aiChooseFollow(view,plays); cards=_ch.cards;
        if(/原样端走/.test(_ch.reason||'')) guardChosen++;
        {const later=[];for(let j=i+1;j<4;j++)later.push((leader+j)%4);
         const rd=E.makeReads(view.history,trump);
         const iv=!hands[seat].some(c=>E.effSuit(c,trump)===lead.suit);
         if(iv&&lead.suit!=='T'&&later.some(p=>p%2!==seat%2&&rd.hard[p]&&rd.hard[p][lead.suit])) gateHit++;}
        if(!E.isLegalFollow(hands[seat],lead,cards,trump))
          cards=E.genFollow(hands[seat],lead,trump,rand);
        const reads=E.makeReads(view.history,trump);
        const iAmVoid=!handBefore.some(c=>E.effSuit(c,trump)===lead.suit);
        // ---- C:我毙牌,后面还有对手,而他的断门在这之前就已经被演绎出来 ----
        if(lead.suit!=='T'&&iAmVoid&&E.effSuit(cards[0],trump)==='T'){
          ruffTot++;
          const later=[];for(let j=i+1;j<4;j++)later.push((leader+j)%4);
          const knownVoidOpp=later.filter(p=>p%2!==seat%2&&reads.hard[p]&&reads.hard[p][lead.suit]);
          if(knownVoidOpp.length){
            // 记下来,等这一墩收完看是不是被他盖过
            plays.__watch=plays.__watch||[];
            plays.__watch.push({seat,knownVoidOpp,handBefore,lead,played:cards});
          }
        }
        // ---- E:我断门、有废牌可垫,却贴了分 ----
        const curWin=E.resolveTrick(plays,trump).winner;
        const oppWinning=curWin%2!==seat%2;
        if(iAmVoid&&oppWinning&&lead.cards.length===1){
          const junk=handBefore.filter(c=>E.cardPoints(c)===0&&E.effSuit(c,trump)!=='T');
          const gave=cards.reduce((a,c)=>a+E.cardPoints(c),0);
          if(junk.length){ dumpTot++;
            if(gave>0&&E.effSuit(cards[0],trump)!=='T'){ dumpBad++; ptsGiven+=gave; } }
        }
      }
      cards.forEach(c=>E.removeCard(hands[seat],c));
      plays.push({seat,cards});
    }
    const res=E.resolveTrick(plays,trump);
    (plays.__watch||[]).forEach(w=>{
      if(res.winner!==w.seat&&w.knownVoidOpp.includes(res.winner)){
        ruffOverKnown++;
        // 我当时手上有没有一张更大的主,毙上去就赢了这一墩?
        const win=plays.find(p=>p.seat===res.winner);
        const better=w.handBefore.filter(c=>E.effSuit(c,trump)==='T'&&
          E.ordIdx(c,trump)>E.ordIdx(win.cards[0],trump));
        if(better.length){ ruffAvoidable++; ptsLost+=res.points; }
      }});
    history.push(...plays); leader=res.winner; if(++tricks>60)break;
  }
}
console.log(`${process.argv[2]||'80fen-test.html'}  ${N} 局`);
console.log(`C 毙牌 ${ruffTot} 次,其中被「事先已知断门的对手」盖毙 ${ruffOverKnown} 次 (${(100*ruffOverKnown/Math.max(1,ruffTot)).toFixed(1)}%)`);
console.log(`  其中我手上本有更大的主、毙上去就赢的: ${ruffAvoidable} 次,白送 ${ptsLost} 分`);
console.log(`  门槛命中(我断门+后手有已知断门的对手) ${gateHit} 次,选中「毙高一档」 ${guardChosen} 次`);
console.log(`E 断门且手上有废牌可垫、对手赢这墩 ${dumpTot} 次,其中贴了副牌分 ${dumpBad} 次 (${(100*dumpBad/Math.max(1,dumpTot)).toFixed(1)}%),共送 ${ptsGiven} 分`);
