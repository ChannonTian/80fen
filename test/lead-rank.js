/* 领出侧的「同一决策里候选谁好」排对率(2026-11-07,ai-progress 第四节第 12 项 A~I 的量具)。
 * 自对弈每副取一个中盘领出(手里 >12 张,收官由搜索管),把打分前 K 名候选各自用真 AI 在真实牌局里打到局终,
 * 结果 = 领出方这一队的本局得分(闲家得分为正 / 庄家方取负)与净升级;看打分的先后和结果的先后对不对得上。
 * 变体只**重新打分同一批候选**(续打不变),所以一个想法要不要跑整局,先在这里看排对率。
 *   node test/lead-rank.js [html] [种子数=100]   (SEED0=;K=4;DUMP=x.json;VARS='[{"tiaoDrawOut":1},{…}]')
 *   node test/lead-rank.js --report a.json …     */
'use strict';
const fs=require('fs'),vm=require('vm');
const REPORT=process.argv[2]==='--report';
let R=[];
if(!REPORT){
const FILE=process.argv[2]||'80fen-test.html', N=+process.argv[3]||100, S0=+(process.env.SEED0||0), K=+(process.env.K||4);
const VARS=process.env.VARS?JSON.parse(process.env.VARS):[];
const src=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c; vm.createContext(c); vm.runInContext(src,c);
const E=c.module.exports; E.AIP.egSearch=0;
const key=cs=>cs.map(x=>x.suit+x.rank).sort().join(',');
function finish(hands0,history0,leader,trump,declSeat,buried,defSoFar,firstLead,rand){
  const hands=hands0.map(h=>h.slice()), history=history0.slice(); let def=defSoFar, lastW=leader, lastSize=1, first=true;
  while(hands.some(h=>h.length)){ const plays=[];
    for(let i=0;i<4;i++){ const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){ cards=first?firstLead.map(x=>hand.find(y=>y.id===x.id)):E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,trump); cards=E.aiChooseFollow(view,plays).cards; if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand); }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards}); }
    first=false; history.push(...plays); lastSize=plays[0].cards.length;
    const res=E.resolveTrick(plays,trump); leader=res.winner; lastW=res.winner; if(res.winner%2!==declSeat%2) def+=res.points; }
  const sc=E.scoreRound({defPoints:def,kitty:buried,defWonLastTrick:lastW%2!==declSeat%2,lastLeadSize:lastSize});
  return {def:sc.total,declUp:sc.defendersWin?-(1+sc.defenderLevelsUp):sc.declarerLevelsUp};
}
for(let seed=S0+1;seed<=S0+N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,D=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;D=s;}}
  const T=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) D=first;
  hands[D].push(...kitty); const buried=E.aiDiscard(hands[D],T); buried.forEach(x=>E.removeCard(hands[D],x));
  const rand=E.rng(seed^0x5bd1e995); const pick=2+(seed*7)%9;   // 这一副取第几墩(2~10,中盘)
  const history=[]; let leader=D, def=0, ti=0, done=false;
  while(hands.some(h=>h.length)&&!done){ const plays=[];
    for(let i=0;i<4;i++){ const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump:T,declSeat:D,history:[...history,...plays],buriedKnown:seat===D?buried:[],curDecl:best?{seat:D,suit:best.suit,strength:best.strength}:null};
      let cards;
      if(i===0){ const r=E.aiChooseLead(view); cards=r.cards;
        if(ti===pick&&hand.length>12){
          const seen=new Set(), cands=[]; for(const q of r.all){ const k=key(q.cards); if(seen.has(k)) continue; seen.add(k); cands.push(q); if(cands.length>=K) break; }
          if(cands.length>=2){
            const team=seat%2, decl=team===D%2;
            const out=cands.map(q=>{ const o=finish(hands,history,seat,T,D,buried,def,q.cards,E.rng(seed*13+ti)); return {k:key(q.cards),s0:q.score,pts:decl?-o.def:o.def,lv:decl?o.declUp:-o.declUp}; });
            for(const [vi,v] of VARS.entries()){ const sv={}; for(const k in v){ sv[k]=E.AIP[k]; E.AIP[k]=v[k]; }
              const r2=E.aiChooseLead(view), m={}; for(const q of r2.all){ const k=key(q.cards); if(m[k]===undefined) m[k]=q.score; }
              out.forEach(o=>{ o['s'+(vi+1)]=m[o.k]!==undefined?m[o.k]:-1e9; }); Object.assign(E.AIP,sv); }
            R.push({seed,ti,n:hand.length,role:seat===D?'庄':team===D%2?'帮':'闲',cands:out});
          }
          done=true; }
        const chk=E.checkThrow(hands,seat,cards,T); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,T); cards=E.aiChooseFollow(view,plays).cards; if(!E.isLegalFollow(hand,lead,cards,T)) cards=E.genFollow(hand,lead,T,rand); }
      if(done) break;
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards}); }
    if(done) break;
    history.push(...plays); const res=E.resolveTrick(plays,T); leader=res.winner; if(res.winner%2!==D%2) def+=res.points; ti++; }
}
if(process.env.DUMP) fs.writeFileSync(process.env.DUMP,JSON.stringify(R));
}else for(const f of process.argv.slice(3)) R.push(...JSON.parse(fs.readFileSync(f,'utf8')));
// 报告:每个打分列的排对率(按本局得分、按净升级)、首选的遗憾(前 K 名里最好的结果 − 打分最高那手的结果)
const cols=Object.keys((R[0]||{cands:[{}]}).cands[0]).filter(k=>/^s\d+$/.test(k));
const m=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
const rep=(t,rs)=>{ if(!rs.length) return; const line=[];
  for(const col of cols){ let n=0,ok=0,loss=0,nl=0,okl=0; const reg=[],regl=[];
    for(const r of rs){ const a=r.cands; for(let i=0;i<a.length;i++) for(let j=i+1;j<a.length;j++){ const ds=a[i][col]-a[j][col];
        const dy=a[i].pts-a[j].pts; if(dy&&ds){ n++; if(Math.sign(ds)===Math.sign(dy)) ok++; else loss+=Math.abs(dy); }
        const dl=a[i].lv-a[j].lv; if(dl&&ds){ nl++; if(Math.sign(ds)===Math.sign(dl)) okl++; } }
      const top=a.reduce((b,x)=>x[col]>b[col]?x:b,a[0]); reg.push(Math.max(...a.map(x=>x.pts))-top.pts); regl.push(Math.max(...a.map(x=>x.lv))-top.lv); }
    line.push(`${col} 排对(分)${(100*ok/Math.max(1,n)).toFixed(1)}%(级)${(100*okl/Math.max(1,nl)).toFixed(1)}% 每对损失 ${(loss/Math.max(1,n)).toFixed(2)} 首选遗憾 ${m(reg).toFixed(2)} 分 / ${m(regl).toFixed(3)} 级`); }
  console.log(`${t.padEnd(10)} 局面 ${String(rs.length).padStart(4)}\n    `+line.join('\n    ')); };
console.log(`领出排对率:${R.length} 个中盘领出局面,每个前 ${R[0]?R[0].cands.length:0} 名候选真 AI 打到局终(s0 = 现在的打分,s1… = VARS)`);
rep('全部',R); for(const ro of ['庄','帮','闲']) rep(ro,R.filter(r=>r.role===ro));
