/* 定点反事实回放:在「我断门毙牌、后手还有已知断门的对手」这个决策点上分叉,
 * 三条支路各自用同一套 AI 打完整局,比最终得分。
 *   A 最省的毙法(现状)   B 毙到最大的主   C 干脆不毙(垫牌)
 * 打分口径与 ab.js 一致:以 80 为零点的零和,从「我」这一队看。
 */
const fs=require('fs'),vm=require('vm');
const b=[...fs.readFileSync(process.argv[2]||'index.html','utf8')
  .matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c;
vm.createContext(c);vm.runInContext(b[0],c);
const E=c.module.exports; E.AIP.egSearch=0;
if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV));

function playOut(st, forced){
  // st: {hands, history, leader, declSeat, trump, buried, defPoints, tricks}
  const hands=st.hands.map(h=>h.slice()), history=st.history.slice();
  let leader=st.leader, defPoints=st.defPoints, tricks=st.tricks;
  const {trump,declSeat,buried}=st, declTeam=declSeat%2;
  let lastWinner=st.lastWinner, lastLeadSize=st.lastLeadSize;
  let pending=st.plays?st.plays.slice():[];         // 本墩已出的牌
  const rand=E.rng(st.seed^0x9e3779b9);
  let first=true;
  while(hands.some(h=>h.length)){
    const plays=first?pending:[];
    first=false;
    for(let i=plays.length;i<4;i++){
      const seat=(leader+i)%4;
      const view={seat,hand:hands[seat],trump,declSeat,history:[...history,...plays],
                  buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(forced&&i===plays.length&&forced.seat===seat&&!forced.used){
        cards=forced.cards; forced.used=true;
      }else if(i===0){
        cards=E.aiChooseLead(view).cards;
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok)cards=chk.forced;
      }else{
        const lead=E.classify(plays[0].cards,trump);
        cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hands[seat],lead,cards,trump))
          cards=E.genFollow(hands[seat],lead,trump,rand);
      }
      cards.forEach(x=>E.removeCard(hands[seat],x));
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
  return {total:sc.total, declTeam};
}
const val=(r,team)=>r.declTeam===team?80-r.total:r.total-80;

const N=+process.argv[3]||300;
const SKIP=+(process.env.SKIP||0);
let nCase=0; const acc={A:0,B:0,C:0}, win={B:0,C:0};
const diffs={B:[],C:[]};
const byUnits={};
for(let seed=1;seed<=N;seed++){
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
  const history=[]; let leader=declSeat, defPoints=0, tricks=0,
      lastWinner=declSeat, lastLeadSize=1, done=false, seen=0;
  while(hands.some(h=>h.length)&&!done){
    const plays=[];
    for(let i=0;i<4&&!done;i++){
      const seat=(leader+i)%4;
      const view={seat,hand:hands[seat],trump,declSeat,history:[...history,...plays],
                  buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){ cards=E.aiChooseLead(view).cards;
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok)cards=chk.forced; }
      else{
        const lead=E.classify(plays[0].cards,trump);
        const ch=E.aiChooseFollow(view,plays); cards=ch.cards;
        if(!E.isLegalFollow(hands[seat],lead,cards,trump))
          cards=E.genFollow(hands[seat],lead,trump,rand);
        // ---- 判据:我断门、这一手是毙、后手还有已知断门的对手、我手上还有更大的主 ----
        const voids=E.makeVoids(view.history,trump);
        const iVoid=!hands[seat].some(x=>E.effSuit(x,trump)===lead.suit);
        const isRuff=lead.suit!=='T'&&iVoid&&E.effSuit(cards[0],trump)==='T'&&cards.length===1;
        const later=[]; for(let j=i+1;j<4;j++) later.push((leader+j)%4);
        const knownVoid=later.some(p=>p%2!==seat%2&&voids[p]&&voids[p][lead.suit]);
        if(isRuff&&knownVoid){
          const tr=hands[seat].filter(x=>E.effSuit(x,trump)==='T');
          const bigger=tr.filter(x=>E.ordIdx(x,trump)>E.ordIdx(cards[0],trump));
          const junk=hands[seat].filter(x=>E.effSuit(x,trump)!=='T');
          if(bigger.length&&seen++>=SKIP){
            const top=bigger.sort((a,b)=>E.ordIdx(b,trump)-E.ordIdx(a,trump))[0];
            const st={hands,history,leader,declSeat,trump,buried,defPoints,tricks,
                      lastWinner,lastLeadSize,plays,seed};
            const rA=playOut(st,{seat,cards,used:false});
            const rB=playOut(st,{seat,cards:[top],used:false});
            const vA=val(rA,seat%2), vB=val(rB,seat%2);
            acc.A+=vA; acc.B+=vB; diffs.B.push(vB-vA); if(vB>vA) win.B++;
            if(junk.length){
              const dis=E.buildFollow(hands[seat],lead,trump,'discard',null);
              if(dis&&E.effSuit(dis[0],trump)!=='T'){
                const rC=playOut(st,{seat,cards:dis,used:false});
                const vC=val(rC,seat%2);
                acc.C+=vC; diffs.C.push(vC-vA); if(vC>vA) win.C++;
              }else{ acc.C+=vA; diffs.C.push(0); }
            }else{ acc.C+=vA; diffs.C.push(0); }
            // 手上还剩几手「保底级」的牌:在外最大的主之上、或本门已无更大的一手
            const X={trump,mem:E.makeMemory({seat,hand:hands[seat],trump,history:view.history,
                     buriedKnown:seat===declSeat?buried:[]}),hand:hands[seat]};
            const nu=E.bossUnits?E.bossUnits(X).length:0;
            const bk=nu>=3?'3手以上':nu+'手';
            (byUnits[bk]=byUnits[bk]||[]).push(diffs.C[diffs.C.length-1]);
            nCase++; done=true; break;
          }
        }
      }
      cards.forEach(x=>E.removeCard(hands[seat],x));
      plays.push({seat,cards});
    }
    if(done) break;
    history.push(...plays);
    lastLeadSize=plays[0].cards.length;
    const res=E.resolveTrick(plays,trump);
    leader=res.winner; lastWinner=res.winner; tricks++;
    if(res.winner%2!==declTeam) defPoints+=res.points;
    if(tricks>60) break;
  }
}
const stat=a=>{const m=a.reduce((x,y)=>x+y,0)/a.length;
  const sd=Math.sqrt(a.reduce((x,y)=>x+(y-m)*(y-m),0)/a.length);
  return `${m>=0?'+':''}${m.toFixed(2)} ±${(sd/Math.sqrt(a.length)).toFixed(2)}`;};
console.log(`${process.argv[2]||'index.html'} —— ${N} 局里命中 ${nCase} 个决策点,各分叉打完整局`);
console.log(`  A 最省的毙法(现状)   ${(acc.A/nCase).toFixed(2)} 分`);
console.log(`  B 毙到手上最大的主    ${(acc.B/nCase).toFixed(2)} 分   相对 A ${stat(diffs.B)}  更好的占 ${(100*win.B/nCase).toFixed(0)}%`);
console.log(`  C 不毙,垫一张废牌     ${(acc.C/nCase).toFixed(2)} 分   相对 A ${stat(diffs.C)}  更好的占 ${(100*win.C/nCase).toFixed(0)}%`);
console.log('  C 的优势按「手上还有几手钢板(保底手)」分层:');
Object.keys(byUnits).sort().forEach(k=>console.log(`    ${k}: n=${byUnits[k].length}  ${stat(byUnits[k])}`));
