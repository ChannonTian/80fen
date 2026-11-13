/* 自对弈里单张跟牌拆对子的频率(AIP.pairKeep 的前后对照用)。
 *
 *   OVN='{"pairKeep":8,"pairKeepCands":1}' node test/pair-split-rate.js [种子数=300] [80fen-test.html]
 *
 * 四家同一版引擎打 N 副;统计「单张领出的跟牌里,引擎选的牌恰好拆了手上的对子」的次数,
 * 以及其中「手上明明有同位不拆的替身」(pairKeepAlt 能找到)的次数,折成每副。 */
const fs=require('fs'),vm=require('vm');
function load(f){const b=[...fs.readFileSync(f,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  const ctx={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};
  ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(b[0],ctx);return ctx.module.exports;}
const E=load(process.argv[3]||'80fen-test.html');
if(process.env.OVN) Object.assign(E.AIP,JSON.parse(process.env.OVN));
E.AIP.egSearch=0;
const cnt={follow:0,single:0,split:0,splitAlt:0};
const AI={aiDiscard:E.aiDiscard,aiChooseLead:E.aiChooseLead,
  aiChooseFollow(view,plays){
    const r=E.aiChooseFollow(view,plays);
    cnt.follow++;
    const lead=E.classify(plays[0].cards,view.trump);
    if(lead&&lead.type==='single'&&r.cards.length===1){
      cnt.single++;
      if(E.pairSplitCard(view.hand,r.cards)){ cnt.split++; if(E.pairKeepAlt(view,plays,r.cards[0])) cnt.splitAlt++; }
    }
    return r;
  }};
const aiOf=()=>AI;
function playRound(seed, aiOf){
  const {first}=E.cutForFirst(seed);
  const {hands,kitty}=E.dealRound(seed,first);
  let best=null, declSeat=-1;
  for(let s=0;s<4;s++){
    const o=E.declOptions(hands[s],E.RULES.levelStart)[0];
    if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}
  }
  const rand=E.rng(seed^0x9e3779b9);
  let trump;
  if(!best){trump={suit:null,rank:E.RULES.levelStart};declSeat=first;}
  else{
    trump={suit:best.suit,rank:E.RULES.levelStart};
    for(let s=0;s<4;s++){
      if(s!==declSeat&&E.jokerPairOf(hands[s])&&rand()<0.3){
        trump={suit:null,rank:E.RULES.levelStart};declSeat=s;break;}
    }
  }
  // 亮主信息也进 view(裁判和界面都给;egDeclKnown 靠它把亮主者的级牌钉在他手里)
  const curDecl=!best?null:{seat:declSeat,suit:trump.suit,
    strength:trump.suit?best.strength:(E.jokerPairOf(hands[declSeat])||{strength:3}).strength};
  hands[declSeat].push(...kitty);
  const buried=aiOf(declSeat).aiDiscard(hands[declSeat],trump);
  buried.forEach(c=>E.removeCard(hands[declSeat],c));
  const declTeam=declSeat%2, history=[];
  let leader=declSeat, defPoints=0, lastWinner=declSeat, lastLeadSize=1, tricks=0;
  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4;
      const view={seat,hand:hands[seat],trump,declSeat,history:[...history,...plays],
                  buriedKnown:seat===declSeat?buried:[],curDecl};
      let cards;
      if(i===0){
        cards=aiOf(seat).aiChooseLead(view).cards;
        const chk=E.checkThrow(hands,seat,cards,trump);
        if(!chk.ok) cards=chk.forced;
      }else{
        const lead=E.classify(plays[0].cards,trump);
        cards=aiOf(seat).aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hands[seat],lead,cards,trump))
          cards=E.genFollow(hands[seat],lead,trump,rand);
      }
      cards.forEach(c=>E.removeCard(hands[seat],c));
      plays.push({seat,cards});
    }
    history.push(...plays);
    lastLeadSize=plays[0].cards.length;
    const res=E.resolveTrick(plays,trump);
    leader=res.winner; lastWinner=res.winner; tricks++;
    if(res.winner%2!==declTeam) defPoints+=res.points;
    if(tricks>60) break;
  }
  const sc=E.scoreRound({defPoints,kitty:buried,
    defWonLastTrick:lastWinner%2!==declTeam,lastLeadSize});
  return {...sc, declTeam, defWonLast:lastWinner%2!==declTeam};
}


const N=+process.argv[2]||300, S0=+(process.env.SEED0||0);
let games=0;
for(let s=S0+1;s<=S0+N;s++){ try{ playRound(s,aiOf); games++; }catch(e){} }
const f=x=>(x/games).toFixed(3);
console.log(`deals ${games}  follows/deal ${f(cnt.follow)}  single-lead follows/deal ${f(cnt.single)}  splits/deal ${f(cnt.split)}  splits-with-alt/deal ${f(cnt.splitAlt)}`);
console.log(JSON.stringify({games,...cnt}));
