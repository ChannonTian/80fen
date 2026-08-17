/* 定点反事实回放:「一门副色 A 打完、无 K 有 Q,却先把 Q 领出去」。
 *
 *   node test/cf-highlead.js [html=index.html] [局数=300]
 *
 * 判据(领出侧,单张,非主):我领出的这张 X 满足
 *   · 这门在外还有比 X 大的牌,而且**我手上没有**(所以 X 压不住,纯粹是喂)
 *   · X 本身够高(Q 以上,ordIdx≥8)—— 低牌领出是探路,那是另一条反馈
 *   · 当时**另有门可领**(手上不止这一门),否则是被迫,不该算账
 *
 * 三条支路,各自用同一套 AI 打完整局:
 *   A 照旧领这张高牌(现状)
 *   B 改领这门最小的一张(同门,但不喂大牌)
 *   C 改领 AI 自己的次优候选(换一门 / 换一手)
 *
 * 打分口径与 ab.js 一致:以 80 为零点的零和,从「我」这一队看。
 * 分层看:在外更大的有几张、这门我还剩几张、还剩几墩。
 * ——「一次性偏离 ≠ 策略性偏离」,这里量的是前者,见 NOTES/measurement.md 三。
 */
const fs=require('fs'),vm=require('vm');
const b=[...fs.readFileSync(process.argv[2]||'index.html','utf8')
  .matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c;
vm.createContext(c);vm.runInContext(b[0],c);
const E=c.module.exports; E.AIP.egSearch=0;
if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV));

function playOut(st, forced){
  const hands=st.hands.map(h=>h.slice()), history=st.history.slice();
  let leader=st.leader, defPoints=st.defPoints, tricks=st.tricks;
  const {trump,declSeat,buried}=st, declTeam=declSeat%2;
  let lastWinner=st.lastWinner, lastLeadSize=st.lastLeadSize;
  let pending=st.plays?st.plays.slice():[];
  const rand=E.rng(st.seed^0x9e3779b9);
  let first=true;
  while(hands.some(h=>h.length)){
    const plays=first?pending:[]; first=false;
    for(let i=plays.length;i<4;i++){
      const seat=(leader+i)%4;
      const view={seat,hand:hands[seat],trump,declSeat,history:[...history,...plays],
                  buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(forced&&i===plays.length&&forced.seat===seat&&!forced.used){
        cards=forced.cards; forced.used=true;
        if(i===0){ const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok)cards=chk.forced; }
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
const diffs={B:[],C:[]};                       // 配对差,分母一致
const strat={};                                 // 分层:key → {B:[],C:[]},留原始差值好算 SE
const add=(k,dB,dC)=>{const a=strat[k]=strat[k]||{B:[],C:[]};a.B.push(dB);a.C.push(dC);};
let nCase=0, nSeen=0;

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
      lastWinner=declSeat, lastLeadSize=1;
  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4;
      const view={seat,hand:hands[seat],trump,declSeat,history:[...history,...plays],
                  buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){
        const hb=hands[seat].slice();
        const adv=E.aiChooseLead(view); cards=adv.cards;
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok)cards=chk.forced;
        const cl=E.classify(cards,trump);
        if(cl&&cl.suit!=='T'&&cl.type==='single'&&cl.top>=8){
          const mem=E.makeMemory(view);
          let bigOut=0;
          for(const k in mem.unseen){ const n=mem.unseen[k]; if(n<=0) continue;
            const cc=E.keyToCard(k);
            if(E.effSuit(cc,trump)===cl.suit&&E.ordIdx(cc,trump)>cl.top) bigOut+=n; }
          const iHaveBigger=hb.some(x=>E.effSuit(x,trump)===cl.suit&&E.ordIdx(x,trump)>cl.top);
          const suits=new Set(hb.map(x=>E.effSuit(x,trump)));
          const inSuit=hb.filter(x=>E.effSuit(x,trump)===cl.suit);
          if(bigOut>0&&!iHaveBigger&&suits.size>1&&nSeen++>=SKIP){
            const st={hands,history,leader,declSeat,trump,buried,defPoints,tricks,
                      lastWinner,lastLeadSize,plays:[],seed};
            const rA=playOut(st,{seat,cards,used:false});
            const vA=val(rA,seat%2);
            // B:同门最小的一张
            const low=inSuit.slice().sort((x,y)=>E.ordIdx(x,trump)-E.ordIdx(y,trump))[0];
            const vB=low.id===cards[0].id?vA
              :val(playOut(st,{seat,cards:[low],used:false}),seat%2);
            // C:AI 自己的次优候选(第一个牌不一样的)
            const alt=(adv.cands||[]).find(x=>!(x.cards.length===cards.length
              &&x.cards.every((q,j)=>q.id===cards[j].id)));
            const vC=alt?val(playOut(st,{seat,cards:alt.cards,used:false}),seat%2):vA;
            diffs.B.push(vB-vA); diffs.C.push(vC-vA); nCase++;
            add('全部',vB-vA,vC-vA);
            add(`在外更大 ${bigOut>=3?'≥3':bigOut} 张`,vB-vA,vC-vA);
            add(`这门我还剩 ${inSuit.length>=4?'≥4':inSuit.length} 张`,vB-vA,vC-vA);
            add(`还剩 ${hands[seat].length>=15?'≥15':hands[seat].length>=8?'8-14':'≤7'} 张手牌`,vB-vA,vC-vA);
            // 交叉层:命中报障原型「A 打完、K 还在外、我有 Q,而且这门我不止这一张」
            if(bigOut===1&&inSuit.length>=2) add('★ 在外更大恰 1 张 且 这门≥2张',vB-vA,vC-vA);
            if(bigOut>=2) add('☆ 在外更大 ≥2 张(对照)',vB-vA,vC-vA);
          }
        }
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
}
const stat=a=>{ if(!a.length) return '—';
  const m=a.reduce((x,y)=>x+y,0)/a.length;
  const sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)*(x-m),0)/Math.max(1,a.length-1));
  return `${m>=0?'+':''}${m.toFixed(2)} ±${(sd/Math.sqrt(a.length)).toFixed(2)}`; };
console.log(`${process.argv[2]||'index.html'} — ${N} 局,命中 ${nCase} 个决策点\n`);
console.log(`相对 A(照旧领这张高牌):`);
console.log(`  B 改领这门最小的一张   ${stat(diffs.B)}`);
console.log(`  C 改领 AI 的次优候选   ${stat(diffs.C)}`);
console.log(`\n分层(均值,分/局):`);
console.log('  层'.padEnd(30)+'n'.padStart(6)+'B'.padStart(16)+'C'.padStart(16));
for(const k of Object.keys(strat).sort()){
  const a=strat[k];
  console.log('  '+k.padEnd(28)+String(a.B.length).padStart(6)+
    stat(a.B).padStart(16)+stat(a.C).padStart(16));
}
