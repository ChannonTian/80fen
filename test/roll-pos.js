/* 冻住的一个跟牌局面:把我看不见的牌按与历史一致的方式随机补发(张数对、已知断门不违反),
 * 分别强制我出几种候选,同一个 AI 打到底,比本队整局得失分与级数。给场景库定期望用。
 *
 *   node test/roll-pos.js <html> <局面.json> <候选,逗号分隔,如 SA,SK> [抽样数=200]     (OV= 覆盖 AIP;EG=1 开收官搜索)
 *
 * 局面.json:{trump:{suit,rank}, seat, declSeat, defPoints, history:[{seat,cards:['SA',…]}…],
 *           plays:[{seat,cards:[…]}…](这一墩已出的), hand:['SA',…]}
 * 牌名同场景库:SA / H10 写 HT / 大王 XB / 小王 XS。底牌:我不是庄家时随机,是庄家时要在 json 里给 buried。
 * 局限:续打是同一个 AI(DESIGN §7.11);推断出来的「软」断门不当约束,只用没跟牌的硬断门。
 */
'use strict';
const fs=require('fs'),vm=require('vm');
const [FILE,POS,CANDS,NS]=process.argv.slice(2);
const src=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c;
vm.createContext(c);vm.runInContext(src,c);
const E=c.module.exports;
E.AIP.egSearch=+(process.env.EG||0);
if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV));
const P=JSON.parse(fs.readFileSync(POS,'utf8')), T=P.trump, N=+NS||200, cands=CANDS.split(',');
let _id=1; const RM={A:14,K:13,Q:12,J:11,T:10};
const C=s=>s==='XB'?{suit:'X',rank:16,id:_id++}:s==='XS'?{suit:'X',rank:15,id:_id++}
        :{suit:s[0],rank:RM[s.slice(1)]!==undefined?RM[s.slice(1)]:+s.slice(1),id:_id++};
const deck=[]; for(let d=0;d<2;d++){ deck.push('XB','XS'); for(const su of 'SHDC') for(const r of ['A','K','Q','J','T',9,8,7,6,5,4,3,2]) deck.push(su+r); }
const pool=deck.slice(); const take=s=>{const i=pool.indexOf(s); if(i<0) throw Error('牌数不对:多出一张 '+s); pool.splice(i,1);};
const allPlays=[...P.history,...P.plays];
allPlays.forEach(p=>p.cards.forEach(take)); P.hand.forEach(take);
if(P.buried) P.buried.forEach(take);
// 各家还剩几张
const left=[0,1,2,3].map(s=>s===P.seat?P.hand.length:25-allPlays.filter(p=>p.seat===s).reduce((a,p)=>a+p.cards.length,0));
const kittyN=P.buried?0:8;
if(left.reduce((a,b)=>a+b,0)-P.hand.length+kittyN!==pool.length) throw Error(`牌数不对:未见 ${pool.length} 张,各家剩 ${left} + 底 ${kittyN}`);
// 硬断门:这一墩领出门没跟
const voids=[{},{},{},{}];
for(let i=0;i<P.history.length;i+=4){ const tr=P.history.slice(i,i+4), ls=E.effSuit(C(tr[0].cards[0]),T);
  tr.forEach(p=>{ if(p.cards.some(x=>E.effSuit(C(x),T)!==ls)) voids[p.seat][ls]=true; }); }
{ const ls=P.plays.length?E.effSuit(C(P.plays[0].cards[0]),T):null;
  P.plays.forEach(p=>{ if(p.cards.some(x=>E.effSuit(C(x),T)!==ls)) voids[p.seat][ls]=true; }); }
const others=[0,1,2,3].filter(s=>s!==P.seat);
const rng=E.rng(+(process.env.SEED||12345));
const res={}; cands.forEach(k=>res[k]=[]);
const team=P.seat%2, declTeam=P.declSeat%2;
for(let n=0;n<N;n++){
  let deal;
  for(let tries=0;;tries++){
    if(tries>20000) throw Error('按断门补发不出牌');
    const cs=pool.slice(); for(let i=cs.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[cs[i],cs[j]]=[cs[j],cs[i]];}
    deal={}; let k=0, ok=true;
    for(const s of others){ deal[s]=cs.slice(k,k+left[s]); k+=left[s];
      if(deal[s].some(x=>voids[s][E.effSuit(C(x),T)])){ ok=false; break; } }
    if(!ok) continue;
    deal.kitty=cs.slice(k); break;
  }
  for(const pick of cands){
    _id=5000;
    const hands=[0,1,2,3].map(s=>(s===P.seat?P.hand:deal[s]).map(C));
    const buried=(P.buried||deal.kitty).map(C);
    const history=P.history.map(p=>({seat:p.seat,cards:p.cards.map(C)}));
    let plays=P.plays.map(p=>({seat:p.seat,cards:p.cards.map(C)}));
    let leader=P.plays.length?P.plays[0].seat:P.seat, def=P.defPoints||0, lastW=leader, lastSize=1, first=true;
    const r2=E.rng(n*7+1);
    while(true){
      for(let i=plays.length;i<4;i++){
        const seat=(leader+i)%4, hand=hands[seat];
        const view={seat,hand,trump:T,declSeat:P.declSeat,history:[...history,...plays],buriedKnown:seat===P.declSeat?buried:[]};
        let cs;
        if(first&&seat===P.seat){ const want=pick.split('+'); const used=new Set();
          cs=want.map(w=>{ const x=hand.find(h=>!used.has(h.id)&&h.suit===C(w).suit&&h.rank===C(w).rank); used.add(x.id); return x; }); }
        else if(i===0){ cs=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cs,T); if(!chk.ok) cs=chk.forced; }
        else{ const lead=E.classify(plays[0].cards,T); cs=E.aiChooseFollow(view,plays).cards;
          if(!E.isLegalFollow(hand,lead,cs,T)) cs=E.genFollow(hand,lead,T,r2); }
        cs.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards:cs});
      }
      history.push(...plays); lastSize=plays[0].cards.length; first=false;
      const rr=E.resolveTrick(plays,T); leader=rr.winner; lastW=rr.winner; if(rr.winner%2!==declTeam) def+=rr.points;
      plays=[]; if(!hands.some(h=>h.length)) break;
    }
    const sc=E.scoreRound({defPoints:def,kitty:buried,defWonLastTrick:lastW%2!==declTeam,lastLeadSize:lastSize});
    const declUp=sc.defendersWin?-(1+sc.defenderLevelsUp):sc.declarerLevelsUp;
    res[pick].push({pts:team===declTeam?-sc.total:sc.total, lv:team===declTeam?declUp:-declUp});
  }
}
const mm=a=>a.reduce((x,y)=>x+y,0)/a.length;
const se=a=>{const m=mm(a);return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/Math.max(1,a.length-1)/a.length);};
console.log(`${FILE}${process.env.OV?' OV='+process.env.OV:''} —— ${N} 份补发;本队视角(分 = 闲家得分,本队是庄家方时取负;级 = 本队净升级)`);
for(const k of cands) console.log(`  ${k.padEnd(8)} 分 ${mm(res[k].map(r=>r.pts)).toFixed(1).padStart(6)}   级 ${mm(res[k].map(r=>r.lv)).toFixed(3)}`);
const b=cands[0];
for(const k of cands.slice(1)){ const d=res[b].map((r,i)=>r.pts-res[k][i].pts), dl=res[b].map((r,i)=>r.lv-res[k][i].lv);
  console.log(`  ${b} − ${k}: 分 ${mm(d).toFixed(1)} ±${se(d).toFixed(1)}   级 ${mm(dl).toFixed(3)} ±${se(dl).toFixed(3)}`); }
