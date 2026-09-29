/* 一个开关在实际对局里改了哪些手(给「手感」对账用):
 * 自对弈(开关按文件默认值),每个跟牌 / 领出决策点把同一局面在开关另一档下再算一遍,两档出牌不同就记下来,按类别汇总。
 *
 *   node test/diff-switch.js <html> <开关名> <另一档的值> [种子数=200]      (EG=1 开收官搜索)
 *
 * 类别:我这一手是主 / 副、主的档次(王 / 主级牌 / 副级牌 / 主 A / 主分牌 5·10·K / 小主)、赢没赢下这墩、台面分、是不是毙牌。
 */
'use strict';
const fs=require('fs'),vm=require('vm');
const [FILE,KEY,ALT,NS]=process.argv.slice(2);
const src=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c;
vm.createContext(c);vm.runInContext(src,c);
const E=c.module.exports;
if(process.env.EG!=='1') E.AIP.egSearch=0;
const ON=E.AIP[KEY], OFF=JSON.parse(ALT), N=+NS||200;
const tier=(x,T)=>{ if(E.effSuit(x,T)!=='T') return E.cardPoints(x)>0?'副分牌':'副牌';
  if(x.suit==='X') return x.rank===16?'大王':'小王';
  if(x.rank===T.rank) return x.suit===T.suit?'主级牌':'副级牌';
  if(x.rank===14) return '主A'; if(E.cardPoints(x)>0) return '主分牌'; return '小主'; };
const desc=(cards,plays,T,lead)=>{ const w=E.currentWinner([...plays,{seat:-1,cards}],T).seat===-1;
  const t=[...new Set(cards.map(x=>tier(x,T)))].join('+');
  const ruff=lead&&lead.suit!=='T'&&cards.some(x=>E.effSuit(x,T)==='T');
  return `${t}${ruff?'(毙)':''}${w?'·赢':'·不赢'}`; };
const R={}, rec=(k)=>{R[k]=(R[k]||0)+1;};
/* 这一墩的下文:我出 cards 之后,后面几家按 AI 出完,看这墩归谁、本队得失几分 */
const finishTrick=(hands,history,plays,leader,seat,cards,trump,declSeat,buried,rand)=>{
  const hs=hands.map(h=>h.slice()); const ps=[...plays,{seat,cards}]; cards.forEach(x=>E.removeCard(hs[seat],x));
  for(let i=ps.length;i<4;i++){ const s=(leader+i)%4, hand=hs[s];
    const v={seat:s,hand,trump,declSeat,history:[...history,...ps],buriedKnown:s===declSeat?buried:[]};
    const lead=E.classify(ps[0].cards,trump); let cs=E.aiChooseFollow(v,ps).cards;
    if(!E.isLegalFollow(hand,lead,cs,trump)) cs=E.genFollow(hand,lead,trump,rand);
    ps.push({seat:s,cards:cs}); }
  const r=E.resolveTrick(ps,trump); return {won:r.winner%2===seat%2, pts:(r.winner%2===seat%2?1:-1)*r.points}; };
const OUT={};
let nDec=0,nDiff=0;
for(let seed=1;seed<=N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) declSeat=first;
  hands[declSeat].push(...kitty); const buried=E.aiDiscard(hands[declSeat],trump); buried.forEach(x=>E.removeCard(hands[declSeat],x));
  const rand=E.rng(seed^0x9e3779b9); const history=[]; let leader=declSeat;
  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards, alt;
      if(i===0){ cards=E.aiChooseLead(view).cards; E.AIP[KEY]=OFF; alt=E.aiChooseLead(view).cards; E.AIP[KEY]=ON;
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,trump); cards=E.aiChooseFollow(view,plays).cards;
        E.AIP[KEY]=OFF; alt=E.aiChooseFollow(view,plays).cards; E.AIP[KEY]=ON;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand); }
      nDec++;
      const same=alt.length===cards.length&&alt.every(x=>cards.some(y=>y.suit===x.suit&&y.rank===x.rank));
      if(!same){ nDiff++;
        const lead=i===0?null:E.classify(plays[0].cards,trump);
        const pts=E.countPoints(plays.flatMap(p=>p.cards));
        const role=seat===declSeat?'庄家':seat%2===declSeat%2?'帮家':'闲家';
        const pw=i===0?'领出':(E.currentWinner(plays,trump).seat%2===seat%2?'队友暂大':'对手暂大');
        rec(`${i===0?'领出':'第'+(i+1)+'家'}·${pw}·${lead?(lead.suit==='T'?'主墩':'副牌墩'):''}·台面${pts>0?'有分':'0分'} | 开:${desc(cards,plays,trump,lead)}  ←  关:${desc(alt,plays,trump,lead)}`);
        rec(`[按角色] ${role}`);
        if(i>0&&i<3){ const a=finishTrick(hands,history,plays,leader,seat,cards,trump,declSeat,buried,rand),
                             b=finishTrick(hands,history,plays,leader,seat,alt.map(x=>hand.find(y=>y.suit===x.suit&&y.rank===x.rank)),trump,declSeat,buried,rand);
          const k=`第${i+1}家 开:${desc(cards,plays,trump,lead)} ← 关:${desc(alt,plays,trump,lead)}`;
          const o=OUT[k]=OUT[k]||{n:0,wa:0,wb:0,pa:0,pb:0}; o.n++; o.wa+=a.won; o.wb+=b.won; o.pa+=a.pts; o.pb+=b.pts; }
      }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    history.push(...plays);
    const res=E.resolveTrick(plays,trump); leader=res.winner;
  }
}
console.log(`${FILE} ${KEY}: 开=${JSON.stringify(ON)} 关=${ALT} —— ${N} 副,${nDec} 个决策点,出牌不同 ${nDiff} 个(${(nDiff/N).toFixed(2)} 次/局)`);
for(const [k,v] of Object.entries(R).sort((a,b)=>b[1]-a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
console.log('\n第 2 / 3 家出牌不同时,这一墩打完的结果(后面几家按 AI 出):本队最终拿下这墩的比例、这墩本队得失分(均值)');
for(const [k,o] of Object.entries(OUT).sort((a,b)=>b[1].n-a[1].n)) if(o.n>=3)
  console.log(`  n=${String(o.n).padStart(3)}  开:拿下 ${(100*o.wa/o.n).toFixed(0)}% ${(o.pa/o.n).toFixed(1)} 分   关:拿下 ${(100*o.wb/o.n).toFixed(0)}% ${(o.pb/o.n).toFixed(1)} 分   ${k}`);
