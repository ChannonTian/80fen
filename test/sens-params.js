/* 参数敏感度与级联扫描:哪些 AIP 参数真的在拍板某一类决定,哪些在互相抵消。
 *
 *   node test/sens-params.js <html> [种子数=200]        (OV= 覆盖 AIP;PAIRS=8 两两扫描前几名)
 *
 * 起因(2026-09-25):产品方试玩 v0.7.21 后报的三种行为(钓主墩能压不压、中盘单领大王、
 * 知道对手断门还探路)在上一轮的改动下几乎没变。参数一百五十个,逐个猜不过来,
 * 而且可能存在**级联**:几个参数互相顶着,拨动其中一个,另一个把它补回来,行为纹丝不动。
 *
 * 做法:
 *   ① 自对弈(收官搜索关)里把出现这三种行为的决策点**原样存下来**;
 *   ② 每个参数单独拨动(数值 ×0.5 与 ×2;0/1 开关翻转),在**同一批决策点**上重做决定,
 *      数「这一类行为消失了」的比例 —— 不重打整局,只看同一局面下的选择变不变;
 *   ③ 单拨排名前几的参数两两一起拨:一起拨的翻转率远大于单拨之和 = 级联(互相抵消)。
 *
 * 「行为消失」的判据:
 *   probe —— 新选择不再是「领进对手多半断的副花非钢板」
 *   bigJ  —— 新选择不再是单张大王
 *   care  —— 新选择压过了当前最大(钓主墩里原来能压不压的那一手)
 */
'use strict';
const fs=require('fs'),vm=require('vm');
const FILE=process.argv[2]||'80fen-test.html';
const src=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c;
vm.createContext(c);vm.runInContext(src,c);
const E=c.module.exports;
E.AIP.egSearch=0;
if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV));
const N=+process.argv[3]||200, CAP=+(process.env.CAP||300);

// ---------- ① 收集决策点 ----------
const S={probe:[],bigJ:[],care:[]};
const snap=v=>({...v,hand:v.hand.slice(),history:v.history.map(p=>({seat:p.seat,cards:p.cards.slice()}))});
for(let seed=1;seed<=N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) declSeat=first;
  hands[declSeat].push(...kitty); const buried=E.aiDiscard(hands[declSeat],trump); buried.forEach(x=>E.removeCard(hands[declSeat],x));
  const rand=E.rng(seed^0x9e3779b9); const history=[]; let leader=declSeat;
  while(hands.some(h=>h.length)){ const plays=[];
    for(let i=0;i<4;i++){ const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){ cards=E.aiChooseLead(view).cards;
        if(hand.length>8){
          if(isProbe(view,cards)&&S.probe.length<CAP) S.probe.push(snap(view));
          if(isBigJ(cards)&&S.bigJ.length<CAP) S.bigJ.push(snap(view));
        }
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,trump); cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand);
        if(lead.suit==='T'&&lead.cards.length===1&&S.care.length<CAP&&isCareless(view,plays,cards))
          S.care.push({view:snap(view),plays:plays.map(p=>({seat:p.seat,cards:p.cards.slice()}))}); }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards}); }
    history.push(...plays); leader=E.resolveTrick(plays,trump).winner; }
}
function isProbe(view,cards){
  const t=view.trump, su=E.effSuit(cards[0],t); if(su==='T') return false;
  const cl=E.classify(cards,t); if(!cl||cl.type==='throw') return false;
  const L=E.leadCtx(view); return !E.isBossPlay(cl,L.mem,t)&&L.oppVoidP(su)>0.5;
}
function isBigJ(cards){ return cards.length===1&&cards[0].suit==='X'&&cards[0].rank===16; }
function isCareless(view,plays,cards){
  const t=view.trump, cur=E.currentWinner(plays,t); if(cur.seat%2===view.seat%2) return false;
  const lead=E.classify(plays[0].cards,t);
  const can=view.hand.some(x=>E.effSuit(x,t)==='T'&&E.ordIdx(x,t)>cur.cl.top&&E.isLegalFollow(view.hand,lead,[x],t));
  const mine=E.classify(cards,t); const beat=mine&&mine.suit==='T'&&mine.top>cur.cl.top;
  return can&&!beat;
}
console.log(`${FILE}${process.env.OV?' OV='+process.env.OV:''} —— ${N} 副,决策点:探路进断门 ${S.probe.length}、中盘单领大王 ${S.bigJ.length}、钓主墩能压不压 ${S.care.length}`);

// ---------- ② 在同一批决策点上重做决定 ----------
function rate(){
  let a=0,b=0,d=0;
  for(const v of S.probe){ if(!isProbe(v,E.aiChooseLead(v).cards)) a++; }
  for(const v of S.bigJ){ if(!isBigJ(E.aiChooseLead(v).cards)) b++; }
  for(const s of S.care){ if(!isCareless(s.view,s.plays,E.aiChooseFollow(s.view,s.plays).cards)) d++; }
  return {probe:a/Math.max(1,S.probe.length), bigJ:b/Math.max(1,S.bigJ.length), care:d/Math.max(1,S.care.length)};
}
const base=rate();
console.log(`零点(不拨任何参数)重做后的翻转率:${JSON.stringify(base)} —— 应当是 0,否则决策点复现不了`);

const SKIP=new Set(['egSearch','egMaxCards','egSamples','egSamplesBy','egMinSamples','egRetries','egMaxCands','egExact','egKittyModel','egKittyPtW','egDeclKnown','egMargin','egPointsEps','egVoidW']);
const keys=Object.keys(E.AIP).filter(k=>typeof E.AIP[k]==='number'&&!SKIP.has(k));
const variants=k=>{ const v=E.AIP[k];
  if(v===0||v===1) return [[k,1-v]];
  return [[k,v*0.5],[k,v*2]]; };
const res=[];
for(const k of keys){
  for(const [kk,val] of variants(k)){
    const keep=E.AIP[kk]; E.AIP[kk]=val;
    let r; try{ r=rate(); }catch(e){ r={probe:NaN,bigJ:NaN,care:NaN}; }
    E.AIP[kk]=keep;
    res.push({k:kk,from:keep,to:+val.toFixed(4),...r});
  }
}
const show=(fld,lbl)=>{
  const g=res.filter(r=>!isNaN(r[fld])).sort((a,b)=>b[fld]-a[fld]).slice(0,12);
  console.log(`\n—— ${lbl}:单拨一个参数,这类行为消失的比例(前 12)——`);
  for(const r of g) console.log(`  ${(100*r[fld]).toFixed(1).padStart(5)}%   ${r.k} ${r.from} → ${r.to}`);
};
show('probe','探路进断门'); show('bigJ','中盘单领大王'); show('care','钓主墩能压不压');

// ---------- ③ 两两一起拨:找级联 ----------
const P=+(process.env.PAIRS||8);
for(const fld of ['probe','bigJ','care']){
  const top=res.filter(r=>!isNaN(r[fld])).sort((a,b)=>b[fld]-a[fld]);
  const pick=[]; for(const r of top){ if(!pick.some(p=>p.k===r.k)) pick.push(r); if(pick.length>=P) break; }
  const out=[];
  for(let i=0;i<pick.length;i++) for(let j=i+1;j<pick.length;j++){
    const A=pick[i],B=pick[j]; const ka=E.AIP[A.k], kb=E.AIP[B.k];
    E.AIP[A.k]=A.to; E.AIP[B.k]=B.to; const r=rate(); E.AIP[A.k]=ka; E.AIP[B.k]=kb;
    out.push({a:A,b:B,joint:r[fld],sum:A[fld]+B[fld]});
  }
  out.sort((x,y)=>(y.joint-y.sum)-(x.joint-x.sum));
  console.log(`\n—— ${fld}:两两一起拨,「一起」比「单拨之和」多出来的(级联 / 互相抵消)——`);
  for(const o of out.slice(0,8))
    console.log(`  一起 ${(100*o.joint).toFixed(1).padStart(5)}%  单拨之和 ${(100*o.sum).toFixed(1).padStart(5)}%  多出 ${(100*(o.joint-o.sum)).toFixed(1).padStart(5)}   ${o.a.k}→${o.a.to} + ${o.b.k}→${o.b.to}`);
}
