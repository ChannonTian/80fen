/* 最后一墩是靠什么赢下来的(产品方 2026-09-29:「正常局面下,能真的赢下最后一墩的最大概率是单张大王、其次小王、
 * 主级数牌已经是很小概率了,比这个差的单张抢末墩都是不现实的 —— 除非场上的大主都没了、自己明确控制局面,
 * 或者用对子 / 甩牌抢底。现在的引擎大家都是小牌抢底互掐」)。
 *
 *   node test/audit-lasttrick.js <html> [种子数=400]      (OV= 覆盖 AIP;EG=1 开收官搜索)
 *
 * 记:最后一墩赢家那一手的牌型与最大那张的档次;两个王、主级数牌在第几墩被打掉(中盘 >8 张 / 收官 / 最后 3 墩);
 * 最后一墩开始时场上还剩几张王 / 主级数牌。
 */
'use strict';
const fs=require('fs'),vm=require('vm');
const FILE=process.argv[2]||'80fen-test.html';
const src=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c;
vm.createContext(c);vm.runInContext(src,c);
const E=c.module.exports;
if(process.env.EG!=='1') E.AIP.egSearch=0;
if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV));
const N=+process.argv[3]||400;
const tier=(x,T)=>{ if(E.effSuit(x,T)!=='T') return '副牌';
  if(x.suit==='X') return x.rank===16?'大王':'小王';
  if(x.rank===T.rank) return x.suit===T.suit?'主级牌':'副级牌';
  if(x.rank===14) return '主A'; if(x.rank===13) return '主K'; return '更小的主'; };
const ORDER=['大王','小王','主级牌','副级牌','主A','主K','更小的主','副牌'];
const win={}, kind={}, gone={}, left={}; let n=0, kittyWon=0;
const add=(o,k,v=1)=>o[k]=(o[k]||0)+v;
for(let seed=1;seed<=N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) declSeat=first;
  hands[declSeat].push(...kitty); const buried=E.aiDiscard(hands[declSeat],trump); buried.forEach(x=>E.removeCard(hands[declSeat],x));
  const rand=E.rng(seed^0x9e3779b9); const history=[]; let leader=declSeat;
  while(hands.some(h=>h.length)){
    const plays=[]; const lenBefore=hands[leader].length;
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,trump); cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand); }
      for(const x of cards){ const t=tier(x,trump); if(['大王','小王','主级牌','副级牌'].includes(t))
        add(gone,`${t}·${hand.length>8?'中盘(>8 张)':hand.length>3?'收官前段(4~8)':'最后 3 墩'}`); }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    history.push(...plays);
    const res=E.resolveTrick(plays,trump); leader=res.winner;
    if(!hands.some(h=>h.length)){
      n++; const w=plays.find(p=>p.seat===res.winner), cl=E.classify(w.cards,trump);
      const top=w.cards.slice().sort((a,b)=>E.ordIdx(b,trump)-E.ordIdx(a,trump))[0];
      add(win,tier(top,trump)); add(kind,`${plays[0].cards.length>1?'多张':'单张'}·${cl?cl.type:'甩'}`);
      if(res.winner%2!==declSeat%2) kittyWon++;
    }
  }
}
const pct=(v,d)=>(100*v/d).toFixed(0).padStart(3)+'%';
console.log(`${FILE}${process.env.OV?' OV='+process.env.OV:''} —— ${N} 副;闲家赢末墩 ${pct(kittyWon,n)}`);
console.log('最后一墩赢家那一手里最大的一张:'); for(const k of ORDER) if(win[k]) console.log(`   ${k.padEnd(6)} ${pct(win[k],n)}`);
console.log('最后一墩的牌型:'); for(const [k,v] of Object.entries(kind).sort((a,b)=>b[1]-a[1])) console.log(`   ${k.padEnd(10)} ${pct(v,n)}`);
console.log('王 / 级数牌在什么时候打掉的(每局平均张数;每局王 4 张、主级牌 2 张、副级牌 6 张):');
for(const t of ['大王','小王','主级牌','副级牌']) console.log(`   ${t.padEnd(6)} `+['中盘(>8 张)','收官前段(4~8)','最后 3 墩'].map(p=>`${p} ${((gone[t+'·'+p]||0)/n).toFixed(2)}`).join('   '));
