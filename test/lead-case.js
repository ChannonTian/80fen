/* 单个真人牌谱局面的领出复盘(2026-11-07,教练线;牌谱 b6a891b8 第 4 墩那一套,做成通用的)。
 *
 *   node test/lead-case.js <牌谱.jsonl|.json> --game=<id 前几位> --trick=N  [模式] [选项]
 *
 * 局面 = 第 N 墩领出前,领出那一家的视角(只用他知道的信息)。模式(可以同时给几个):
 *   --scores        这一家所有不同出法(单张 / 对子 / 拖拉机 / 甩牌,同名牌只算一次)的当前打分、守住概率、留手价值、是否在 AI 候选表里
 *   --decomp        把 --leads 里每一手的打分拆成:本墩 EV、留手、牌型、主牌项、牌权(scoreLeadEV 的各项)
 *   --trick         本墩送分表:按约束抽世界,三家按 AI 跟牌,数「对方赢墩 / 送分 / 送 ≥20 / 对方均得(其中我方的牌)/ 我方均得」
 *   --full          整局:同一批世界里每一手都由 AI 四家续打到局终,和 --ref 那一手配对比较;另按目标分开(守住 / 跳级 / 闲家 ≥120)
 *   --deplete       这一墩之后各家这门张数、对手 / 队友新断这门的概率
 * 选项:
 *   --leads=S2,C7,D2,H4,C5C5   要比的几手(牌码同牌谱:花色 + 点数,王 X15 / X16;一手多张直接连写)
 *   --ref=S2                   --full 的对照(默认 --leads 第一手)
 *   --n=600                    世界数(--full 默认 250)
 *   --void=SUIT                只抽「领出者的队友断这门」的世界(看「赌队友扣底断门」那一支)
 *   --html=80fen-test.html     用哪一版引擎
 * 约束抽样(不用 makeBelief,为的是把硬信息钉住、口径透明):未见牌按剩余空位均匀发给三家和底牌,另加
 *   ① 亮主那家手里有他亮的级牌 / 王(按 rec.decl 里最后一次亮主);
 *   ② 某家光领过一张副牌 A(当时那门第一次出),另一张 A 不在他手里(他有的话会领对子)—— 给另外两家;
 *   ③ 前面墩里没跟出这门的人,这门一张不发(硬断门)。
 * 跟牌的三家用 AI(收官搜索关);人坐的那一家也由 AI 代打。结论只对这一个局面成立。 */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const args=process.argv.slice(2);
const opt=k=>{const a=args.find(x=>x.startsWith('--'+k+'='));return a?a.slice(k.length+3):null;};
const has=k=>args.includes('--'+k);
const recFile=args.find(a=>!a.startsWith('--'));
const html=path.resolve(opt('html')||path.join(__dirname,'..','80fen-test.html'));
const src=[...fs.readFileSync(html,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const C={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number,isFinite};C.globalThis=C;
vm.createContext(C); vm.runInContext(src,C);
const E=C.module.exports; E.AIP.egSearch=0;

// ---- 牌谱 ----
const lines=fs.readFileSync(recFile,'utf8').split('\n').filter(Boolean);
const recs=lines.map(l=>{try{return JSON.parse(l);}catch(e){return null;}}).filter(Boolean);
const g=opt('game'); const rec=g?recs.find(r=>String(r.id).startsWith(g)):recs[0];
if(!rec){ console.error('找不到牌谱',g); process.exit(1); }
const TN=+(opt('trick')||1);
let uid=0; const parse=s=>({suit:s[0],rank:+s.slice(1),id:'r'+(uid++)});
const hands=rec.initialHands.map(h=>h.map(parse)), buried=rec.buried.map(parse);
const T=rec.trump, D=rec.declSeat;
const take=(seat,code)=>{ const h=hands[seat]; const i=h.findIndex(x=>x.suit+x.rank===code); if(i<0) throw new Error(seat+' 没有 '+code); return h.splice(i,1)[0]; };
const history=[];
for(let ti=0;ti<TN-1;ti++) for(const p of rec.tricks[ti].plays) history.push({seat:p.seat,cards:p.cards.map(cd=>take(p.seat,cd))});
const me=rec.tricks[TN-1].plays[0].seat, mate=(me+2)%4, others=[0,1,2,3].filter(s=>s!==me);
const view={seat:me,hand:hands[me].slice(),trump:T,declSeat:D,history:history.slice(),buriedKnown:me===D?buried:[]};
const NAME=['南','东','北','西'];
const nm=c=>c.suit==='X'?(c.rank===16?'大王':'小王'):({S:'♠',H:'♥',D:'♦',C:'♣'}[c.suit])+({11:'J',12:'Q',13:'K',14:'A'}[c.rank]||c.rank);
const ns=cs=>cs.map(nm).join('');
const pick=spec=>{ const h=view.hand.slice(), out=[];
  for(const m of spec.matchAll(/([SHDCX])(\d+)/g)){ const i=h.findIndex(x=>x.suit===m[1]&&x.rank===+m[2]); if(i<0) throw new Error('手里没有 '+m[0]); out.push(h.splice(i,1)[0]); }
  return out; };
const LEADS=(opt('leads')||'').split(',').filter(Boolean);
console.log(`${rec.version}  牌谱 ${String(rec.id).slice(0,8)}  主 ${T.suit||'无'} 打 ${T.rank}  ${NAME[D]} 坐庄  第 ${TN} 墩 ${NAME[me]} 领出  引擎 ${path.basename(html)}`);
console.log(`${NAME[me]} 手牌:${ns(view.hand)}`);

// ---- 约束抽样 ----
const mem=E.makeMemory(view); const unseen=[];
for(const k in mem.unseen){ const c=E.keyToCard(k); for(let i=0;i<mem.unseen[k];i++) unseen.push({suit:c.suit,rank:c.rank,id:'u'+(uid++)}); }
const sizes={}; for(const s of others) sizes[s]=view.hand.length;
const kittyN=view.buriedKnown.length?0:unseen.length-others.reduce((a,s)=>a+sizes[s],0);
const pinned=[];                       // [{seat, suit, rank}] 必在某家
const banned=[];                       // [{seat, suit, rank}] 不在某家(给其余两家)
const voidOf={}; others.forEach(s=>voidOf[s]=new Set());
const decl=(rec.decl||[]).slice(-1)[0];
if(decl&&decl.seat!==me){
  const n=decl.strength>=3?2:decl.strength, card=decl.strength>=3?{suit:'X',rank:decl.strength===4?16:15}:{suit:decl.suit,rank:T.rank};
  let already=history.filter(p=>p.seat===decl.seat).flatMap(p=>p.cards).filter(c=>c.suit===card.suit&&c.rank===card.rank).length;
  for(let i=0;i<n-already;i++) pinned.push({seat:decl.seat,...card});
}
for(let i=0;i<history.length;i+=4){
  const t=history.slice(i,i+4), lead=E.classify(t[0].cards,T);
  for(const p of t.slice(1)) if(p.cards.some(c=>E.effSuit(c,T)!==lead.suit)&&voidOf[p.seat]) voidOf[p.seat].add(lead.suit);
  const c=t[0].cards[0];
  if(t[0].cards.length===1&&c.rank===14&&E.effSuit(c,T)!=='T'&&t[0].seat!==me&&!history.slice(0,i).some(p=>p.cards.some(x=>E.effSuit(x,T)===c.suit)))
    banned.push({seat:t[0].seat,suit:c.suit,rank:14});
}
const vSuit=opt('void');
if(vSuit) voidOf[mate].add(vSuit);
let seed=12345; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
function deal(){
  for(let t=0;t<3000;t++){
    const p=unseen.slice(); for(let i=p.length-1;i>0;i--){ const j=Math.floor(rnd()*(i+1)); [p[i],p[j]]=[p[j],p[i]]; }
    const H={}; others.forEach(s=>H[s]=[]); const kitty=[]; const used=new Set(); let ok=true;
    for(const q of pinned){ const c=p.find(x=>!used.has(x.id)&&x.suit===q.suit&&x.rank===q.rank); if(!c){ok=false;break;} used.add(c.id); H[q.seat].push(c); }
    if(!ok) continue;
    for(const q of banned){ const c=p.find(x=>!used.has(x.id)&&x.suit===q.suit&&x.rank===q.rank); if(!c) continue;
      const to=others.filter(s=>s!==q.seat&&!voidOf[s].has(q.suit)&&H[s].length<sizes[s]); if(!to.length){ok=false;break;}
      used.add(c.id); H[to[Math.floor(rnd()*to.length)]].push(c); }
    if(!ok) continue;
    for(const c of p){ if(used.has(c.id)) continue; const su=E.effSuit(c,T);
      const slots=others.filter(s=>H[s].length<sizes[s]&&!voidOf[s].has(su)); const w=slots.map(s=>sizes[s]-H[s].length);
      if(kitty.length<kittyN){ slots.push('k'); w.push(kittyN-kitty.length); }
      if(!slots.length){ ok=false; break; }
      let x=rnd()*w.reduce((a,b)=>a+b,0), i=0; while(x>w[i]){ x-=w[i]; i++; }
      if(slots[i]==='k') kitty.push(c); else H[slots[i]].push(c); }
    if(ok&&others.every(s=>H[s].length===sizes[s])) return {H,kitty:view.buriedKnown.length?view.buriedKnown:kitty};
  }
  return null;
}
const N=+(opt('n')||(has('full')?250:600));
const worlds=[]; for(let i=0;i<N;i++){ const w=deal(); if(w) worlds.push(w); }
const order=[1,2,3].map(i=>(me+i)%4);
const kittyOf=w=>D===me?buried:w.kitty;

function playTrick(w,lead){
  const hs={}; others.forEach(s=>hs[s]=w.H[s].slice());
  const plays=[{seat:me,cards:lead}];
  for(const s of order){ const v={seat:s,hand:hs[s],trump:T,declSeat:D,history:history.concat(plays),buriedKnown:s===D?kittyOf(w):[]};
    let cs=E.aiChooseFollow(v,plays).cards; const ld=E.classify(lead,T); if(!E.isLegalFollow(hs[s],ld,cs,T)) cs=E.genFollow(hs[s],ld,T,E.rng(1));
    plays.push({seat:s,cards:cs}); }
  const r=E.resolveTrick(plays,T), us=r.winner%2===me%2;
  const ours=plays.filter(p=>p.seat%2===me%2).reduce((a,p)=>a+E.countPoints(p.cards),0);
  return {us,pts:r.points,ours,plays};
}
function playOut(w,lead){
  const hs=[0,1,2,3].map(s=>s===me?view.hand.slice():w.H[s].slice()), kitty=kittyOf(w);
  const hist=history.slice(); let leader=me, defPoints=0, last=null, first=true;
  for(let i=0;i<hist.length;i+=4){ const t=hist.slice(i,i+4); if(E.resolveTrick(t,T).winner%2!==D%2) defPoints+=E.countPoints(t.flatMap(p=>p.cards)); }
  while(hs.some(h=>h.length)){ const ps=[];
    for(let i=0;i<4;i++){ const s=(leader+i)%4, hand=hs[s];
      const v={seat:s,hand,trump:T,declSeat:D,history:hist.concat(ps),buriedKnown:s===D?kitty:[]};
      let cs;
      if(!i){ if(first){ cs=lead.map(c=>hand.find(x=>x.id===c.id)); first=false; } else { cs=E.aiChooseLead(v).cards; const ck=E.checkThrow(hs,s,cs,T); if(!ck.ok) cs=ck.forced; } }
      else { const ld=E.classify(ps[0].cards,T); cs=E.aiChooseFollow(v,ps).cards; if(!E.isLegalFollow(hand,ld,cs,T)) cs=E.genFollow(hand,ld,T,E.rng(1)); }
      cs.forEach(x=>E.removeCard(hand,x)); ps.push({seat:s,cards:cs}); }
    const res=E.resolveTrick(ps,T); if(res.winner%2!==D%2) defPoints+=res.points;
    last={w:res.winner,size:ps[0].cards.length}; hist.push(...ps); leader=res.winner; }
  const sc=E.scoreRound({defPoints,kitty,defWonLastTrick:last.w%2!==D%2,lastLeadSize:last.size});
  return {u:E.levelUtility(sc,me%2,D%2), def:sc.total};
}
console.log(`约束:亮主钉牌 ${pinned.map(q=>NAME[q.seat]+nm(q)).join(' ')||'无'};光领 A 推断 ${banned.map(q=>NAME[q.seat]+'无第二张'+nm(q)).join(' ')||'无'};`+
  `断门 ${others.map(s=>[...voidOf[s]].map(su=>NAME[s]+'断'+su).join(' ')).filter(Boolean).join(' ')||'无'}  世界 ${worlds.length}`);

const L=C.leadCtx(view);
if(has('scores')){
  const adv=E.aiChooseLead(view); const gen=new Set((adv.all||adv.cands).map(c=>c.cards.map(nm).sort().join('')));
  const by={}; for(const c of view.hand){ const s=E.effSuit(c,T); (by[s]=by[s]||[]).push(c); }
  const rows=[];
  for(const s in by){ const cs=by[s].slice().sort((a,b)=>E.ordIdx(b,T)-E.ordIdx(a,T)), seen=new Set();
    for(let m=1;m<(1<<cs.length);m++){ const sub=cs.filter((_,i)=>m>>i&1), key=ns(sub); if(seen.has(key)) continue; seen.add(key);
      const cl=E.classify(sub,T), sp=cl?E.scoreLeadPlay(L,cl,sub):{};
      rows.push({key,type:cl?cl.type:'?',score:E.coachLeadScoreFull(view,sub,adv).score,p:sp.pWin,fut:E.futureValue(sub,L),reason:sp.reason||'',gen:gen.has(sub.map(nm).sort().join(''))}); } }
  rows.sort((a,b)=>b.score-a.score);
  console.log(`\n== 全部 ${rows.length} 种不同出法(AI 候选 ${rows.filter(r=>r.gen).length} 手;AI 选 ${ns(adv.cards)})`);
  rows.forEach((r,i)=>console.log(`${String(i+1).padStart(4)} ${r.key.padEnd(22)} ${r.type.padEnd(7)} ${r.score.toFixed(1).padStart(7)}  守住 ${r.p!==undefined?(100*r.p).toFixed(0)+'%':' - '}  留手 ${r.fut.toFixed(1)}  ${r.gen?'[候选]':'      '} ${r.reason}`));
}
if(has('decomp')){
  const A=E.AIP;
  console.log(`\n== 打分拆项   pw ${L.pw.toFixed(3)}  闲家已得 ${L.def}  阶段 ${L.phase}`);
  for(const k of LEADS){ const cards=pick(k), cl=E.classify(cards,T), pts=E.countPoints(cards);
    const p=C.leadWinP(L,cl,cards); const LS=Object.create(L); LS.ptsTable=pts+(C.unseenPointsIn(L.mem,cl.suit,T)>0?5:0); LS.lead=null;
    const pMine=Math.min(p,C.pSurvive(LS,cl,L.remainingOpp));
    const gain=pts+C.leadPointsEV(L,cl,cards), loss=pts+C.leadLossPoints(L,cl,cards), ev=(p*gain-(1-p)*loss)*(L.pw||1), fut=C.futureValue(cards,L);
    let tsum=0, tx='';
    if(cl.suit==='T'){ const dt=C.drawTrumpValue(L), pen=-Math.min(0,dt)+A.leadWeakTrump*(1-p)+C.trumpLeadPrior(L,cards), tw=C.tiaoWangValue(L,cl,cards);
      tsum=p*Math.max(0,dt)-pen+tw; tx=`主牌项 ${tsum.toFixed(1)}(dt ${dt.toFixed(1)}、小主罚 ${(A.leadWeakTrump*(1-p)).toFixed(1)}、钓主值 ${tw.toFixed(1)})`; }
    const shape=cl.type==='pair'?A.leadShapeBonus:cl.type==='tractor'?A.leadShapeBonus*(cards.length-1):0;
    const tempo=C.leadTempo(L,cards,p,pMine), total=C.scoreLeadPlay(L,cl,cards).score;
    console.log(`${ns(cards).padEnd(8)} 总分 ${total.toFixed(1).padStart(6)} | p ${p.toFixed(2)}(我 ${pMine.toFixed(2)} 队友救 ${(p-pMine).toFixed(2)}) | EV ${ev.toFixed(1)}(得 ${gain.toFixed(1)} 失 ${loss.toFixed(1)})`+
      ` | 留手 −${fut.toFixed(1)} | 牌型 +${shape} | ${tx||'—'} | 牌权 ${tempo.toFixed(1)}(队友兑现 ${C.partnerCashValue(L).toFixed(1)})`+
      (Math.abs(total-(ev-fut+shape+tsum+tempo))>0.05?` | 其他 ${(total-(ev-fut+shape+tsum+tempo)).toFixed(1)}`:'')); }
}
if(has('trick')||has('deplete')){
  console.log(`\n== 本墩${vSuit?`(只看${NAME[mate]}断 ${vSuit} 的世界)`:''}`);
  for(const k of LEADS){ const lead=pick(k), su=E.effSuit(lead[0],T);
    let opp=0,give=0,big=0,oppPts=0,oppOurs=0,usPts=0,newOppVoid=0,newMateVoid=0; const bef={},aft={}; others.forEach(s=>{bef[s]=0;aft[s]=0;});
    for(const w of worlds){ const r=playTrick(w,lead);
      if(r.us) usPts+=r.pts; else { opp++; oppPts+=r.pts; oppOurs+=r.ours; if(r.pts>0) give++; if(r.pts>=20) big++; }
      for(const s of others){ const b=w.H[s].filter(c=>E.effSuit(c,T)===su).length, a=b-r.plays.find(p=>p.seat===s).cards.filter(c=>E.effSuit(c,T)===su).length;
        bef[s]+=b; aft[s]+=a; if(b>0&&a===0){ if(s===mate) newMateVoid++; else newOppVoid++; } } }
    const n=worlds.length, P=x=>(100*x/n).toFixed(0)+'%';
    if(has('trick')) console.log(`${ns(lead).padEnd(8)} 对方赢墩 ${P(opp)}  送分 ${P(give)}  送 ≥20 ${P(big)}  对方均得 ${(oppPts/n).toFixed(1)}(其中我方的牌 ${(oppOurs/n).toFixed(1)})  我方均得 ${(usPts/n).toFixed(1)}`);
    if(has('deplete')) console.log(`${ns(lead).padEnd(8)} 这门张数 ${others.map(s=>NAME[s]+' '+(bef[s]/n).toFixed(1)+'→'+(aft[s]/n).toFixed(1)).join('  ')}  对手新断 ${P(newOppVoid)}  队友新断 ${P(newMateVoid)}`); }
}
if(has('full')){
  const ref=opt('ref')||LEADS[0]; const R={};
  for(const k of LEADS) R[k]=worlds.map(w=>playOut(w,pick(k)));
  console.log(`\n== 整局(AI 四家续打,${worlds.length} 个世界${vSuit?`,${NAME[mate]}断 ${vSuit}`:''};配对比 ${ref})`);
  for(const k of LEADS){ const a=R[k], b=R[ref], n=a.length;
    const d=a.map((x,i)=>x.u-b[i].u), dp=a.map((x,i)=>x.def-b[i].def), m=d.reduce((x,y)=>x+y,0)/n, mp=dp.reduce((x,y)=>x+y,0)/n;
    const se=v=>{const mm=v.reduce((x,y)=>x+y,0)/n; return Math.sqrt(v.reduce((x,y)=>x+(y-mm)**2,0)/Math.max(1,n-1)/n);};
    const P=f=>(100*a.filter(f).length/n).toFixed(0)+'%', decl=me%2===D%2;
    console.log(`${ns(pick(k)).padEnd(8)} 净升级 ${(a.reduce((x,y)=>x+y.u,0)/n).toFixed(3)}  比 ${ref}: ${m.toFixed(3)} ±${se(d).toFixed(3)} 级、闲家分 ${mp.toFixed(1)} ±${se(dp).toFixed(1)}`+
      `  | ${decl?'守住(闲家<80)':'上台(闲家≥80)'} ${decl?P(r=>r.def<80):P(r=>r.def>=80)}  闲家<40 ${P(r=>r.def<40)}  闲家≥120 ${P(r=>r.def>=120)}`); }
}
