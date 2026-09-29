/* 对「一池」不同版本的对手量一个改动(产品方 2026-09-29:「用不止一个版本的差异来进行更多对弈,可以避免某些兔子洞」)。
 *
 *   POOL=a.html,b.html,engines/v0.7.0.js  OVA='{"x":1}' OVB='{"x":0}'  node test/ai-pool.js <候选html> [种子数=200]
 *
 * ai-h2h 是「新版 vs 旧版」同桌对打:两边是同一套启发式的邻居,一方的习惯(比如王出得早、末墩拿小牌抢)
 * 另一方也有,改动只在这个小世界里被评判。这里换成:同一个候选文件按 OVA / OVB 覆盖出 A、B 两版,
 * **各自**去和池子里每一个版本(交换阵营)打同一批种子,比较 A 与 B 的净升级 / 净胜分。
 * 池子里的版本打法各不相同,A 赢 B 的那部分就不只是「更会对付自己」。
 *
 * 池子成员:.html(抽第一个 <script>)或 engines/*.js(浏览器里的历史引擎模块,window.__ENGINES)。
 * 规则 / 发牌 / 结算统一用候选文件的引擎。收官搜索默认关(EG=1 打开,只对 A、B)。
 * 输出:每个池子成员一行 A−B(级 / 分,配对 SE),以及全池合并。
 */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
function loadHtml(f){const b=[...fs.readFileSync(f,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  const ctx={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};
  ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(b[0],ctx);return ctx.module.exports;}
function loadEngine(f){const ctx=vm.createContext({window:{}});vm.runInContext(fs.readFileSync(f,'utf8'),ctx,{filename:f});
  const all=ctx.window.__ENGINES||{}; const k=Object.keys(all)[0]; return all[k];}
const load=f=>f.endsWith('.js')?loadEngine(f):loadHtml(f);
const FILE=process.argv[2]||'80fen-test.html', N=+process.argv[3]||200, S0=+(process.env.SEED0||0);
const A=loadHtml(FILE), B=loadHtml(FILE), E=A;
if(process.env.OVA) Object.assign(A.AIP,JSON.parse(process.env.OVA));
if(process.env.OVB) Object.assign(B.AIP,JSON.parse(process.env.OVB));
if(process.env.EG!=='1'){ A.AIP.egSearch=0; B.AIP.egSearch=0; }
const POOL=(process.env.POOL||'index.html').split(',').map(f=>{ const m=load(f);
  if(m.AIP&&'egSearch' in m.AIP) m.AIP.egSearch=0; return {name:path.basename(f),m}; });

function playRound(seed, aiOf){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null, declSeat=-1;
  for(let s=0;s<4;s++){ const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;} }
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) declSeat=first;
  const rand=E.rng(seed^0x9e3779b9);
  hands[declSeat].push(...kitty);
  let buried=aiOf(declSeat).aiDiscard(hands[declSeat],trump);
  if(!buried||buried.length!==8) buried=A.aiDiscard(hands[declSeat],trump);
  buried.forEach(c=>E.removeCard(hands[declSeat],c));
  const declTeam=declSeat%2, history=[]; let leader=declSeat, defPoints=0, lastWinner=declSeat, lastLeadSize=1, tricks=0;
  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4;
      const view={seat,hand:hands[seat],trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){ try{ cards=aiOf(seat).aiChooseLead(view).cards; }catch(e){ cards=null; }
        if(!cards||!cards.length||!cards.every(c=>hands[seat].includes(c))) cards=A.aiChooseLead(view).cards;
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,trump);
        try{ cards=aiOf(seat).aiChooseFollow(view,plays).cards; }catch(e){ cards=null; }
        if(!cards||!cards.every(c=>hands[seat].includes(c))||!E.isLegalFollow(hands[seat],lead,cards,trump))
          cards=E.genFollow(hands[seat],lead,trump,rand); }
      cards.forEach(c=>E.removeCard(hands[seat],c)); plays.push({seat,cards});
    }
    history.push(...plays); lastLeadSize=plays[0].cards.length;
    const res=E.resolveTrick(plays,trump); leader=res.winner; lastWinner=res.winner; tricks++;
    if(res.winner%2!==declTeam) defPoints+=res.points;
    if(tricks>60) break;
  }
  const sc=E.scoreRound({defPoints,kitty:buried,defWonLastTrick:lastWinner%2!==declTeam,lastLeadSize});
  return {...sc,declTeam};
}
// 这一副 team 这一队:净升级(本队升的 − 对方升的)与本队得分 − 对方得分
function net(r,team){
  const defUp=r.defendersWin?1+(r.defenderLevelsUp||0):0, decUp=r.defendersWin?0:(r.declarerLevelsUp||0);
  const iDecl=team===r.declTeam; const pts=iDecl?200-r.total:r.total;
  return {lv:(iDecl?decUp:defUp)-(iDecl?defUp:decUp), pts:2*pts-200};
}
const per=POOL.map(()=>({lv:[],pts:[],diff:0}));
for(let s=S0+1;s<=S0+N;s++){
  POOL.forEach((p,k)=>{
    let lvA=0,ptA=0,lvB=0,ptB=0,ok=true;
    for(const team of [0,1]){
      try{
        const ra=playRound(s,seat=>seat%2===team?A:p.m), rb=playRound(s,seat=>seat%2===team?B:p.m);
        const a=net(ra,team), b=net(rb,team); lvA+=a.lv; ptA+=a.pts; lvB+=b.lv; ptB+=b.pts;
      }catch(e){ ok=false; }
    }
    if(!ok) return;
    const dl=(lvA-lvB)/2, dp=(ptA-ptB)/2;
    per[k].lv.push(dl); per[k].pts.push(dp); if(dl!==0||dp!==0) per[k].diff++;
  });
}
const mm=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
const se=a=>{const m=mm(a);return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/Math.max(1,a.length-1)/Math.max(1,a.length));};
console.log(`${FILE}  A=${process.env.OVA||'{}'}  B=${process.env.OVB||'{}'} —— 每个池子成员 ${N} 种子 × 交换阵营;A−B(正 = A 好)`);
const allL=[],allP=[];
POOL.forEach((p,k)=>{ const g=per[k]; allL.push(...g.lv); allP.push(...g.pts);
  console.log(`  对 ${p.name.padEnd(22)} 级 ${mm(g.lv).toFixed(3).padStart(7)} ±${se(g.lv).toFixed(3)}   分 ${mm(g.pts).toFixed(2).padStart(6)} ±${se(g.pts).toFixed(2)}   A、B 结果不同的种子 ${g.diff}/${g.lv.length}`); });
console.log(`  全池合并                  级 ${mm(allL).toFixed(3).padStart(7)} ±${se(allL).toFixed(3)}   分 ${mm(allP).toFixed(2).padStart(6)} ±${se(allP).toFixed(2)}`);
