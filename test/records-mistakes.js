/* 真人牌谱里 AI 座位的「错手」清单(2026-10-24,产品方:毙小被主分超、底里有分却提前打完大牌……做详尽分析)。
 *
 *   node test/records-mistakes.js <牌谱>... [--ver=v0.7.40] [--ex=N] [html=80fen-test.html]   (EG=0 关收官搜索,快)
 *
 * 逐局重放,对每类错手列出:局面、AI 出的、当时理由(当前引擎重算)、**当前引擎在这一手现在会出什么**(改没改掉)。
 *   A 毙小被超   我断门毙了,后面的对手用更大的主超毙拿走这墩;我手里本有压得住超毙那张的主(「明知」= 超毙者此前已露断门)
 *   B 末家漏吃   我坐末家、对手暂大、台面有分,我有能吃下的牌却没吃
 *   C 末家浪费   我坐末家吃下,用的牌比「最小能吃的那张」大一档以上(王 / 级牌 / 主 A),而且这墩 ≤5 分
 *   D 白送分     我出了分牌、这墩归对手,而我本可以出不带分(或更少分)的合法牌;分「出牌时对手暂大」(纯送)与「队友暂大」(赌)
 *   E 压队友     队友暂大且后面没有对手了(我坐末家),我还用王 / 级牌 / 主 A 压过队友
 *   F 丢底       庄家方丢末墩且底里有分:末墩赢牌那张,庄家方此前在哪一墩、为什么花掉了能压住它的牌
 *   G 领分被拿   我领带分的牌,这墩归对手
 */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const args=process.argv.slice(2);
const html=args.find(a=>a.endsWith('.html'))||path.join(__dirname,'..','80fen-test.html');
const files=args.filter(a=>!a.startsWith('--')&&!a.endsWith('.html'));
const VER=(args.find(a=>a.startsWith('--ver='))||'').slice(6).split('|').filter(Boolean);
const EXN=+((args.find(a=>a.startsWith('--ex='))||'--ex=6').slice(5));
const src=[...fs.readFileSync(html,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c; vm.createContext(c); vm.runInContext(src,c);
const E=c.module.exports; if(process.env.EG==='0') E.AIP.egSearch=0;
const code=x=>x.suit+x.rank;
const nm=x=>x.suit==='X'?(x.rank===16?'大王':'小王'):({S:'♠',H:'♥',D:'♦',C:'♣'}[x.suit])+({14:'A',13:'K',12:'Q',11:'J'}[x.rank]||x.rank);
const ns=cs=>cs.map(nm).join('');
const recs=[]; const seen=new Set();
for(const f of files) for(const l of fs.readFileSync(f,'utf8').split('\n')){ if(!l.trim()) continue;
  try{ const r=JSON.parse(l); if(seen.has(r.id)) continue; seen.add(r.id);
    if(VER.length&&!VER.some(v=>String(r.version).includes(v))) continue;
    if(Array.isArray(r.tricks)&&r.tricks.length) recs.push(r); }catch(e){} }
const big=(x,T)=>x.suit==='X'||x.rank===T.rank||(E.effSuit(x,T)==='T'&&x.rank===14);

/* --cf:从牌谱里的**真实局面**分叉,「实际出的」与备选各用真 AI(搜索关)打完,比本队净升级 / 本队得分。
 * 续打的人(包括真人那一家)都按 AI 打 —— 是「这手在 AI 续打下值多少」,不是「真人会怎么应」。 */
const CF=args.includes('--cf');
const EGsave=E.AIP.egSearch;
function playOut(snap,hist,plays,leader,T,D,buried,dp,seat,cards){
  E.AIP.egSearch=0;
  const hands=snap.map(z=>z.slice()); let history=hist.slice(); let ps=plays.map(p=>({seat:p.seat,cards:p.cards.slice()}));
  cards.forEach(x=>E.removeCard(hands[seat],x)); ps.push({seat,cards});
  let last=null, defPoints=dp;
  for(;;){
    while(ps.length<4){ const s=(leader+ps.length)%4, hand=hands[s];
      const v={seat:s,hand,trump:T,declSeat:D,history:[...history,...ps],buriedKnown:s===D?buried:[]};
      let cs; if(!ps.length){ cs=E.aiChooseLead(v).cards; const chk=E.checkThrow(hands,s,cs,T); if(!chk.ok) cs=chk.forced; }
      else{ const lead=E.classify(ps[0].cards,T); cs=E.aiChooseFollow(v,ps).cards; if(!E.isLegalFollow(hand,lead,cs,T)) cs=E.genFollow(hand,lead,T,E.rng(1)); }
      cs.forEach(x=>E.removeCard(hand,x)); ps.push({seat:s,cards:cs}); }
    const res=E.resolveTrick(ps,T); if(res.winner%2!==D%2) defPoints+=E.countPoints(ps.flatMap(p=>p.cards));
    last={w:res.winner,size:ps[0].cards.length}; history.push(...ps); leader=res.winner; ps=[];
    if(!hands.some(h=>h.length)) break; }
  E.AIP.egSearch=EGsave;
  const sc=E.scoreRound({defPoints,kitty:buried,defWonLastTrick:last.w%2!==D%2,lastLeadSize:last.size});
  return {u:E.levelUtility(sc,seat%2,D%2), pts:seat%2===D%2?200-sc.total:sc.total};
}

const OUT={}; const add=(k,o)=>(OUT[k]=OUT[k]||[]).push(o);
let nAI=0, nGames=0, nFull=0;
for(const r of recs){
  nGames++;
  const T=r.trump; let uid=0; const H=r.human, D=r.declSeat;
  const hands=r.initialHands.map(h=>h.map(x=>({suit:x[0],rank:+x.slice(1),id:'c'+(uid++)})));
  const buried=(r.buried||[]).map(x=>({suit:x[0],rank:+x.slice(1),id:'b'+(uid++)}));
  const role=s=>(s===D?'庄家':s%2===D%2?'庄帮':'闲')+(s===H?'(人)':'');
  const tag=`${String(r.pid).slice(0,4)}·${r.id.slice(0,4)}`;
  const history=[]; let ok=true, tn=0; const spent=[]; // 庄家方花掉的大牌 {tn,seat,card,pts,view,plays}
  const sorted=h=>ns(h.slice().sort((a,b)=>E.ordIdx(b,T)-E.ordIdx(a,T)));
  const ask=(view,plays)=>{ try{ const q=plays.length?E.aiChooseFollow({...view,hand:view.hand.slice()},plays):E.aiChooseLead({...view,hand:view.hand.slice()}); return q; }catch(e){ return {cards:[],reason:'ERR'}; } };
  let lastTrick=null; let defSoFar=0;
  for(const t of r.tricks){ tn++; const plays=[]; const pre=[];
    const voids=E.makeVoids(history,T);
    for(const p of t.plays){
      const snap=hands.map(z=>z.slice());
      const h=hands[p.seat], before=h.slice(), cards=[];
      for(const x of p.cards){ const k=h.findIndex(y=>code(y)===x); if(k<0){ ok=false; break; } cards.push(h.splice(k,1)[0]); }
      if(!ok) break;
      const view={seat:p.seat,hand:before,trump:T,declSeat:D,history:history.concat(plays),buriedKnown:p.seat===D?buried:[],decl:r.decl};
      pre.push({seat:p.seat,before,cards,view,plays:plays.slice(),snap,hist:history.slice(),leader:t.plays[0].seat,dp:defSoFar});
      plays.push({seat:p.seat,cards});
    }
    if(!ok) break;
    const res=E.resolveTrick(plays,T), pts=E.countPoints(plays.flatMap(p=>p.cards));
    const lead=E.classify(plays[0].cards,T);
    const ctx=x=>`${tag} 第${tn}墩 主${T.suit||'无'}${T.rank} ${role(x.seat)} 第${x.plays.length+1}家 剩${x.before.length} | 台面 ${x.plays.map(q=>role(q.seat)+':'+ns(q.cards)).join(' ')||'(领)'} | 手 ${sorted(x.before)}`;
    const record=(k,x,extra,alts)=>{ const q=ask(x.view,x.plays); const now=ns(q.cards);
      let cf=null;
      if(CF&&alts&&alts.length){
        const base=playOut(x.snap,x.hist,x.plays,x.leader,T,D,buried,x.dp,x.seat,x.cards);
        const seenA=new Set([ns(x.cards)]); const res2=[];
        for(const a of alts){ const key=ns(a); if(seenA.has(key)) continue; seenA.add(key);
          const v=playOut(x.snap,x.hist,x.plays,x.leader,T,D,buried,x.dp,x.seat,a); res2.push({c:key,du:v.u-base.u,dp:v.pts-base.pts}); }
        res2.sort((a,b)=>b.du-a.du||b.dp-a.dp); cf={best:res2[0],all:res2};
      }
      add(k,{line:ctx(x),played:ns(x.cards),extra,now,nowR:String(q.reason||'').slice(0,40),fixed:now!==ns(x.cards),pts,seat:x.seat,cf}); };
    for(const x of pre){
      if(x.seat===H) continue; nAI++;
      const mate=s=>s%2===x.seat%2;
      const finalOpp=!mate(res.winner);
      if(x.plays.length&&lead.type==='single'&&x.before.length>1){
        const legal=x.before.filter(y=>E.isLegalFollow(x.before,lead,[y],T));
        const my=x.cards[0];
        const haveSuit=x.before.some(y=>E.effSuit(y,T)===lead.suit);
        const cur=E.currentWinner(x.plays,T); const curOpp=!mate(cur.seat);
        // A 毙小被超
        if(lead.suit!=='T'&&!haveSuit&&E.effSuit(my,T)==='T'&&finalOpp){
          const w=plays.find(q=>q.seat===res.winner).cards[0];
          if(E.effSuit(w,T)==='T'&&E.ordIdx(w,T)>E.ordIdx(my,T)&&plays.findIndex(q=>q.seat===res.winner)>x.plays.length){
            const cover=x.before.filter(y=>E.effSuit(y,T)==='T'&&E.ordIdx(y,T)>E.ordIdx(w,T));
            const known=voids[res.winner][lead.suit]?'明知超毙者断门':'超毙者此前未露断门';
            const nT=x.before.filter(y=>E.effSuit(y,T)==='T').length;
            const nonT=legal.filter(y=>E.effSuit(y,T)!=='T').sort((a,b)=>E.cardPoints(a)-E.cardPoints(b)||E.ordIdx(a,T)-E.ordIdx(b,T));
            const trs=legal.filter(y=>E.effSuit(y,T)==='T'&&E.ordIdx(y,T)>E.ordIdx(my,T));
            const forced=!nonT.length;
            record(forced?'A 毙小被超(全是主,只能毙)':'A 毙小被超',x,`毙 ${nm(my)} 被 ${role(res.winner)} ${nm(w)}${E.cardPoints(w)?'(主分)':''} 超,丢 ${pts} 分;${known};手里 ${nT} 张主,能压住的 ${cover.length?ns(cover):'无'}`,
              [...nonT.slice(0,1),...trs].map(y=>[y]));
          }
        }
        // B 末家漏吃 / C 末家浪费
        if(x.plays.length===3){
          const wins=legal.filter(y=>E.currentWinner([...x.plays,{seat:x.seat,cards:[y]}],T).seat===x.seat).sort((a,b)=>E.ordIdx(a,T)-E.ordIdx(b,T));
          if(curOpp&&E.countPoints(x.plays.flatMap(q=>q.cards))>0&&wins.length&&res.winner!==x.seat)
            record('B 末家漏吃',x,`台面 ${E.countPoints(x.plays.flatMap(q=>q.cards))} 分,能吃的 ${ns(wins)}`,wins.map(y=>[y]));
          if(res.winner===x.seat&&wins.length>1&&big(my,T)&&!big(wins[0],T)&&pts<=5&&x.before.length>3)
            record('C 末家浪费',x,`用 ${nm(my)} 吃 ${pts} 分墩,最小能吃的是 ${nm(wins[0])}`);
          if(!curOpp&&res.winner===x.seat&&cur.seat!==x.seat&&big(my,T)&&x.before.length>2)
            record('E 压队友(末家)',x,`队友已赢,我用 ${nm(my)} 压过,墩 ${pts} 分`);
        }
        // D 白送分
        if(finalOpp&&E.cardPoints(my)>0){
          const alt=legal.filter(y=>E.cardPoints(y)<E.cardPoints(my));
          const partnerBehind=x.plays.length<2;  // 队友还没出(我是第 2 家)
          if(alt.length) record(curOpp?(partnerBehind?'D1 送分·第2家,队友在后':'D2 白送分·对手暂大且队友已出'):'D3 送分·队友暂大',x,`贴 ${nm(my)} 而这墩归 ${role(res.winner)};可以出 ${ns(alt.slice(0,4))}`,
            alt.sort((a,b)=>E.cardPoints(a)-E.cardPoints(b)||E.ordIdx(a,T)-E.ordIdx(b,T)).slice(0,3).map(y=>[y]));
        }
      }
      // G 领分被拿
      if(!x.plays.length&&E.countPoints(x.cards)>0&&finalOpp){
        const q0=ask(x.view,[]); const alts=(q0.all||[]).filter(k=>E.countPoints(k.cards)===0).slice(0,3).map(k=>k.cards);
        record('G 领分被拿',x,`领 ${ns(x.cards)} → ${role(res.winner)} 拿 ${pts} 分`,alts); }
      // 庄家方花大牌记账(F 用)
      if(x.seat%2===D%2){ const bs=x.cards.filter(y=>E.effSuit(y,T)==='T'&&(y.suit==='X'||y.rank===T.rank||y.rank===14));
        if(bs.length) spent.push({tn,x,card:bs.reduce((a,b)=>E.ordIdx(b,T)>E.ordIdx(a,T)?b:a),pts}); }
    }
    if(res.winner%2!==D%2) defSoFar+=pts;
    history.push(...plays);
    if(hands.every(h=>h.length===0)) lastTrick={res,plays,pts,lead};
  }
  if(!ok||!lastTrick) continue; nFull++;
  const kp=E.countPoints(buried);
  if(lastTrick.res.winner%2!==D%2&&kp>0){
    const w=lastTrick.plays.find(q=>q.seat===lastTrick.res.winner);
    const wTop=w.cards.reduce((a,b)=>E.ordIdx(b,T)>E.ordIdx(a,T)?b:a);
    const beat=spent.filter(s=>E.ordIdx(s.card,T)>E.ordIdx(wTop,T));
    const lastPlays=lastTrick.plays.map(q=>role(q.seat)+':'+ns(q.cards)).join(' ');
    const det=beat.map(s=>{ const q=ask(s.x.view,s.x.plays); return `第${s.tn}墩 ${role(s.x.seat)} 剩${s.x.before.length} 出 ${ns(s.x.cards)}(墩 ${s.pts} 分)理由〔${String(q.reason||'').slice(0,34)}〕现在出 ${ns(q.cards)}`; });
    add('F 丢底',{line:`${tag} 主${T.suit||'无'}${T.rank} 底 ${kp} 分 ×${r.mult} 闲家 ${r.defPoints} 分${r.defendersWin?'(庄家下台)':''} | 末墩 ${lastPlays}`,
      played:'',extra:beat.length?`庄家方此前花掉能压住 ${nm(wTop)} 的牌 ${beat.length} 张:\n        `+det.join('\n        '):`庄家方没有花掉压得住 ${nm(wTop)} 的牌(本来就守不住)`,
      now:'',nowR:'',fixed:false,pts:kp*(r.mult||2),avoidable:beat.length>0});
  }
}
console.log(`${files.join(',')}${VER.length?' 版本 '+VER.join('/'):''} —— ${nGames} 局(${nFull} 局打完),AI 出牌 ${nAI} 手;「现在」= 当前引擎(${path.basename(html)})在同一局面的选择`);
for(const k of Object.keys(OUT).sort()){
  const a=OUT[k]; const fx=a.filter(o=>o.fixed).length, ptsSum=a.reduce((s,o)=>s+(o.pts||0),0);
  console.log(`\n【${k}】 ${a.length} 次${k.startsWith('F')?`(可避免 ${a.filter(o=>o.avoidable).length})`:`,涉及 ${ptsSum} 分;当前引擎已改掉 ${fx}`}`);
  const withCf=a.filter(o=>o.cf&&o.cf.best);
  if(withCf.length){ const du=withCf.map(o=>Math.max(0,o.cf.best.du)), dp=withCf.map(o=>o.cf.best.du>0||(o.cf.best.du===0&&o.cf.best.dp>0)?o.cf.best.dp:0);
    const bad=withCf.filter(o=>o.cf.best.du>0.02||(o.cf.best.du>=0&&o.cf.best.dp>=10));
    console.log(`   反事实(真实局面、AI 续打):${withCf.length} 次里 ${bad.length} 次有明显更好的备选(多升 >0.02 级或多拿 ≥10 分);最好备选平均多 ${(du.reduce((x,y)=>x+y,0)/withCf.length).toFixed(3)} 级 / ${(dp.reduce((x,y)=>x+y,0)/withCf.length).toFixed(1)} 分`); }
  for(const o of a.slice(0,EXN)) console.log(`  ${o.line}\n    → 出 ${o.played}  ${o.extra}${o.now?`  | 现在出 ${o.now}${o.fixed?'(变了)':''}〔${o.nowR}〕`:''}${o.cf&&o.cf.best?`\n      反事实:${o.cf.all.map(z=>`${z.c} ${z.du>=0?'+':''}${z.du.toFixed(2)}级/${z.dp>=0?'+':''}${z.dp}分`).join('  ')}`:''}`);
}
