/* 自对弈里 hf 修正会改多少决策(校准 4a 的另一半)。
 *   node test/hf-change-rate.js [种子数=200]
 * 四家同一版引擎(基线行为)打 N 副;hfFollow / hfLead 取一个极小的 λ(1e-9)只为让候选带上修正量 hfc,
 * 对每个有 ≥2 个候选的决策,离线算 argmax(score+λ·hfc) 是否不同于 argmax(score),λ ∈ 0.1 0.2 0.4 0.7 1.0。
 * 比例按「决策」算,分跟牌 / 领出;自对弈用全部局权重(hfSet 0)。 */
const fs=require('fs'),vm=require('vm');
function load(f){const b=[...fs.readFileSync(f,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  const ctx={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};
  ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(b[0],ctx);return ctx.module.exports;}
const E=load('80fen-test.html');
Object.assign(E.AIP,{egSearch:0,hfFollow:1e-9,hfLead:1e-9,hfSet:0});
const LAMS=[0.1,0.2,0.4,0.7,1.0];
const cnt={lead:{n:0,chg:LAMS.map(()=>0)},follow:{n:0,chg:LAMS.map(()=>0)}};
const am=a=>{ let b=0; for(let i=1;i<a.length;i++) if(a[i]>a[b]) b=i; return b; };
function tally(kind,list){
  if(!list||list.length<2) return;
  const c=cnt[kind]; c.n++;
  const base=am(list.map(x=>x.score));
  LAMS.forEach((lam,i)=>{ if(am(list.map(x=>x.score+lam*x.hfc))!==base) c.chg[i]++; });
}
const AI={aiDiscard:E.aiDiscard,
  aiChooseLead(view){ const r=E.aiChooseLead(view); tally('lead',r.all); return r; },
  aiChooseFollow(view,plays){ const r=E.aiChooseFollow(view,plays); tally('follow',r.cands); return r; }};
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


const N=+process.argv[2]||200, S0=+(process.env.SEED0||0);
let games=0;
for(let s=S0+1;s<=S0+N;s++){ try{ playRound(s,aiOf); games++; }catch(e){ console.error(e.message); } }
for(const k of ['lead','follow']){ const c=cnt[k];
  console.log(`${k==='lead'?'领出':'跟牌'}  ${games} 副,${c.n} 个决策(${(c.n/games).toFixed(1)}/副,候选≥2)  与基线首选不同的比例: `+LAMS.map((l,i)=>`λ${l}=${(100*c.chg[i]/c.n).toFixed(1)}%(${(c.chg[i]/games).toFixed(2)}/副)`).join('  ')); }
