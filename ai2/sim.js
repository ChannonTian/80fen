/* ai2/sim.js —— 整副牌模拟器(可快照 / 还原),gen-data 与评测共用。
 * 开局流程照搬 test/ai-h2h.js 的 playRound(切牌、亮主、反主、埋底),
 * 之后一手一手走,随时可以 snapshot / 在某个决策点换一手牌再打下去。 */
const fs=require('fs'),vm=require('vm'),path=require('path');
const HTML=path.join(__dirname,'..','80fen-test.html');

function loadEngine(f){
  const b=[...fs.readFileSync(f||HTML,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  const ctx={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};
  ctx.globalThis=ctx; vm.createContext(ctx); vm.runInContext(b[0],ctx); return ctx.module.exports;
}

function newDeal(E, seed){
  const {first}=E.cutForFirst(seed);
  const {hands,kitty}=E.dealRound(seed,first);
  let best=null, declSeat=-1;
  for(let s=0;s<4;s++){
    const o=E.declOptions(hands[s],E.RULES.levelStart)[0];
    if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}
  }
  const rand=E.rng(seed^0x9e3779b9);
  let trump;
  if(!best){ trump={suit:null,rank:E.RULES.levelStart}; declSeat=first; }
  else{
    trump={suit:best.suit,rank:E.RULES.levelStart};
    for(let s=0;s<4;s++){
      if(s!==declSeat&&E.jokerPairOf(hands[s])&&rand()<0.3){
        trump={suit:null,rank:E.RULES.levelStart}; declSeat=s; break; }
    }
  }
  const curDecl=!best?null:{seat:declSeat,suit:trump.suit,
    strength:trump.suit?best.strength:(E.jokerPairOf(hands[declSeat])||{strength:3}).strength};
  hands[declSeat].push(...kitty);
  const buried=E.aiDiscard(hands[declSeat],trump);
  buried.forEach(c=>E.removeCard(hands[declSeat],c));
  return {E,seed,trump,declSeat,curDecl,hands,buried,history:[],plays:[],leader:declSeat,
          defPoints:0,tricks:0,lastWinner:declSeat,lastLeadSize:1,rand,nPly:0};
}

function snapshot(st){
  return {...st,hands:st.hands.map(h=>h.slice()),history:st.history.slice(),
          plays:st.plays.map(p=>({seat:p.seat,cards:p.cards})),rand:null};
}
function restore(snap, randSeed){
  const s={...snap,hands:snap.hands.map(h=>h.slice()),history:snap.history.slice(),
           plays:snap.plays.map(p=>({seat:p.seat,cards:p.cards}))};
  s.rand=snap.E.rng(randSeed); return s;
}

const seatToAct=st=>st.plays.length?(st.plays[0].seat+st.plays.length)%4:st.leader;
function viewOf(st,seat){
  return {seat,hand:st.hands[seat],trump:st.trump,declSeat:st.declSeat,
          history:[...st.history,...st.plays],buriedKnown:seat===st.declSeat?st.buried:[],curDecl:st.curDecl};
}
const keyOf=cards=>cards.map(c=>c.id).sort((a,b)=>a-b).join(',');

/* 让 AI 决策。返回 {seat,isLead,cards(已过合法性修正),cands:[{cards,score,key}],chosenKey,chosenScore} */
function decide(st){
  const E=st.E, seat=seatToAct(st), view=viewOf(st,seat), isLead=st.plays.length===0;
  let cards,list;
  if(isLead){
    const r=E.aiChooseLead(view);
    cards=r.cards; list=r.all||r.cands||[];
    const chk=E.checkThrow(st.hands,seat,cards,st.trump); if(!chk.ok) cards=chk.forced;
  }else{
    const lead=E.classify(st.plays[0].cards,st.trump);
    const r=E.aiChooseFollow(view,st.plays);
    cards=r.cards; list=r.cands||[];
    if(!E.isLegalFollow(st.hands[seat],lead,cards,st.trump)) cards=E.genFollow(st.hands[seat],lead,st.trump,st.rand);
  }
  const ck=keyOf(cards);
  const cands=list.map(c=>({cards:c.cards,score:c.score,key:keyOf(c.cards)}));
  const hit=cands.find(c=>c.key===ck);
  return {seat,isLead,cards,cands,chosenKey:ck,chosenScore:hit?hit.score:null};
}

/* 强制把偏离那手改成合法的实际出牌(领出要过甩牌校验,跟牌要合法) */
function legalize(st,seat,cards){
  const E=st.E;
  if(st.plays.length===0){
    const chk=E.checkThrow(st.hands,seat,cards,st.trump); return chk.ok?cards:chk.forced;
  }
  const lead=E.classify(st.plays[0].cards,st.trump);
  return E.isLegalFollow(st.hands[seat],lead,cards,st.trump)?cards:E.genFollow(st.hands[seat],lead,st.trump,st.rand);
}

/* 出牌并推进状态;满 4 家则结算这一墩 */
function apply(st,seat,cards){
  const E=st.E;
  cards.forEach(c=>E.removeCard(st.hands[seat],c));
  st.plays.push({seat,cards}); st.nPly++;
  if(st.plays.length===4){
    st.lastLeadSize=st.plays[0].cards.length;
    const res=E.resolveTrick(st.plays,st.trump);
    st.leader=res.winner; st.lastWinner=res.winner; st.tricks++;
    if(res.winner%2!==st.declSeat%2) st.defPoints+=res.points;
    st.history.push(...st.plays); st.plays=[];
  }
}
const finished=st=>st.plays.length===0&&!st.hands.some(h=>h.length);
function outcome(st){
  const E=st.E;
  const sc=E.scoreRound({defPoints:st.defPoints,kitty:st.buried,
    defWonLastTrick:st.lastWinner%2!==st.declSeat%2,lastLeadSize:st.lastLeadSize});
  return sc;
}
/* 规范化后的「刚出完这手」局面,供 featurize.rawFromState 用 */
function stateView(st){
  const E=st.E;
  return {hands:st.hands,kitty:st.buried,plays:st.plays,leader:st.leader,defPoints:st.defPoints,
          trump:st.trump,declSeat:st.declSeat,
          curWinner:st.plays.length?E.currentWinner(st.plays,st.trump).seat:-1};
}

module.exports={loadEngine,newDeal,snapshot,restore,seatToAct,viewOf,keyOf,decide,legalize,apply,finished,outcome,stateView,HTML};
