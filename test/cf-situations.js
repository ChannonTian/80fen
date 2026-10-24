/* 按「局面」(出牌那一刻就能认出来,不看结果)做定点反事实:某条备选规则 vs AI 自己的选择(2026-10-24)。
 *
 *   node test/cf-situations.js [html] [种子数=300]      (SEED0= 起始种子;OV= 覆盖 AIP;DUMP=x.json)
 *
 * 自对弈(搜索关,快),每遇到一种局面,把「AI 的选择」和每条备选规则各用真 AI 从真实牌打完,记本队净升级 / 本队得分之差(备选 − AI)。
 * 只在备选和 AI 选得不一样时记。不挑「事后最好的」那一手 —— 每条规则单独一个均值,避免「几个里挑最好」的赢家诅咒。
 *
 * 局面:
 *   R  毙牌选哪张   第 2 / 3 家、单张副牌领出、我断门、有主也有副牌可垫、后面还有对手
 *        细分:后手对手已知断门 / 未知;台面分 0 / 有分
 *        规则:垫(最小不带分的副牌)/ 最省的毙 / 毙到在外非王主之上(高毙)/ 用最大的主
 *   F  第 2 家贴分   第 2 家跟本门、AI 出了分牌    规则:改出最小不带分的
 *   G  领分牌       AI 领出带分的牌               规则:启发式里最好的不带分领出
 *   K  守底时花大牌  庄家方、底里 ≥10 分、手里 ≥4 张、AI 在 ≤5 分的墩上出王 / 主级牌(对)   规则:改出最便宜的合法牌
 *   L  末家不吃分   我坐末家、对手暂大、台面 ≥10 分、AI 没吃                                 规则:最省的吃法
 */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const FILE=process.argv[2]||path.join(__dirname,'..','80fen-test.html'), N=+process.argv[3]||300, S0=+(process.env.SEED0||0);
const sr=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const cc={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};cc.globalThis=cc; vm.createContext(cc); vm.runInContext(sr,cc);
const E=cc.module.exports; if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV)); E.AIP.egSearch=0;
const cloneH=hs=>hs.map(h=>h.slice());
const key=cs=>cs.map(c=>c.suit+c.rank).sort().join();
function playOut(hands,history,plays,leader,T,D,buried,dp,seat,cards){
  hands=cloneH(hands); history=history.slice(); let ps=plays.map(p=>({seat:p.seat,cards:p.cards.slice()}));
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
  const sc=E.scoreRound({defPoints,kitty:buried,defWonLastTrick:last.w%2!==D%2,lastLeadSize:last.size});
  return {u:E.levelUtility(sc,seat%2,D%2), pts:seat%2===D%2?200-sc.total:sc.total};
}
const R=[]; // {sit, sub, rule, du, dp}
for(let seed=S0+1;seed<=S0+N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,D=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;D=s;}}
  const T=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) D=first;
  hands[D].push(...kitty); const buried=E.aiDiscard(hands[D],T); buried.forEach(x=>E.removeCard(hands[D],x));
  const kp=E.countPoints(buried);
  const history=[]; let leader=D, dp=0;
  while(hands.some(h=>h.length)){
    const plays=[]; const voids=E.makeVoids(history,T);
    for(let i=0;i<4;i++){ const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump:T,declSeat:D,history:[...history,...plays],buriedKnown:seat===D?buried:[]};
      let q, cards;
      if(i===0){ q=E.aiChooseLead(view); cards=q.cards; const chk=E.checkThrow(hands,seat,cards,T); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,T); q=E.aiChooseFollow(view,plays); cards=q.cards; if(!E.isLegalFollow(hand,lead,cards,T)) cards=E.genFollow(hand,lead,T,E.rng(seed)); }
      // ---- 局面识别 ----
      const tests=[]; // [sit, sub, rule, altCards]
      const mate=s=>s%2===seat%2;
      if(i>0){
        const lead=E.classify(plays[0].cards,T);
        const tbl=E.countPoints(plays.flatMap(p=>p.cards));
        const cur=E.currentWinner(plays,T);
        if(lead.type==='single'&&hand.length>1){
          const legal=hand.filter(y=>E.isLegalFollow(hand,lead,[y],T));
          const haveSuit=hand.some(y=>E.effSuit(y,T)===lead.suit);
          const behind=[]; for(let j=i+1;j<4;j++) behind.push((leader+j)%4);
          const oppBehind=behind.filter(s=>!mate(s));
          // R 毙牌选哪张
          if((i===1||i===2)&&lead.suit!=='T'&&!haveSuit&&oppBehind.length){
            const trs=legal.filter(y=>E.effSuit(y,T)==='T').sort((a,b)=>E.ordIdx(a,T)-E.ordIdx(b,T));
            const nonT=legal.filter(y=>E.effSuit(y,T)!=='T').sort((a,b)=>E.cardPoints(a)-E.cardPoints(b)||E.ordIdx(a,T)-E.ordIdx(b,T));
            if(trs.length&&nonT.length){
              const winT=trs.filter(y=>E.currentWinner([...plays,{seat,cards:[y]}],T).seat===seat);
              const known=oppBehind.some(s=>voids[s][lead.suit]);
              const sub=`${i+1}家·${known?'后手对手已知断门':'后手未知'}·${tbl>0?'台面有分':'台面0分'}·${mate(cur.seat)?'队友暂大':'对手暂大'}`;
              tests.push(['R',sub,'垫最小',[nonT[0]]]);
              if(winT.length){
                tests.push(['R',sub,'最省的毙',[winT[0]]]);
                // 高毙:压过在外所有非王主的最小一张(不含王);没有就用最大的非王主
                const mem=E.makeMemory(view); let topOut=-1;
                for(const k in mem.unseen){ if(mem.unseen[k]<=0) continue; const u=E.keyToCard(k); if(E.effSuit(u,T)==='T'&&u.suit!=='X') topOut=Math.max(topOut,E.ordIdx(u,T)); }
                const hi=winT.find(y=>y.suit!=='X'&&E.ordIdx(y,T)>topOut)||winT.filter(y=>y.suit!=='X').slice(-1)[0];
                if(hi) tests.push(['R',sub,'高毙(压过在外非王主)',[hi]]);
                tests.push(['R',sub,'最大的主',[winT[winT.length-1]]]);
              }
            }
          }
          // F 第 2 家贴分
          if(i===1&&haveSuit&&cards.length===1&&E.cardPoints(cards[0])>0){
            const np=legal.filter(y=>E.cardPoints(y)===0).sort((a,b)=>E.ordIdx(a,T)-E.ordIdx(b,T));
            const role=seat===D?'我做庄':seat%2===D%2?'我是庄帮':'我是闲';
            if(np.length) tests.push(['F',`${role}·${E.cardPoints(cards[0])}分`,'改出最小不带分',[np[0]]]);
          }
          // L 末家不吃分
          if(i===3&&!mate(cur.seat)&&tbl>=10&&E.currentWinner([...plays,{seat,cards}],T).seat!==seat){
            const wins=legal.filter(y=>E.currentWinner([...plays,{seat,cards:[y]}],T).seat===seat).sort((a,b)=>E.ordIdx(a,T)-E.ordIdx(b,T));
            if(wins.length) tests.push(['L',`台面${tbl>=20?'≥20':'10~15'}分·${hand.length>8?'中盘':'收官'}`,'最省的吃',[wins[0]]]);
          }
        }
        // K 守底时花大牌(庄家方)
        if(seat%2===D%2&&kp>=10&&hand.length>=4&&tbl<=5&&cards.some(y=>y.suit==='X'||(y.rank===T.rank&&y.suit===T.suit))){
          const lead2=E.classify(plays[0].cards,T);
          // 最便宜的合法牌:按引擎自己的 genFollow 'cheap'
          let alt=null; try{ alt=E.buildFollow(hand,lead2,T,'cheap',null)||E.buildFollow(hand,lead2,T,'discard',null); }catch(e){}
          if(alt&&key(alt)!==key(cards)) tests.push(['K',`底${kp>=20?'≥20':'10~15'}分·剩${hand.length>8?'>8':'4~8'}张·${cards.length>1?'成组':'单张'}`,'改出最便宜的',alt]);
        }
      } else {
        // G 领分牌
        if(E.countPoints(cards)>0&&hand.length>1){
          const alt=(q.all||[]).find(k=>E.countPoints(k.cards)===0);
          const cl=E.classify(cards,T);
          if(alt) tests.push(['G',`${cl.suit==='T'?'主':'副'}${cl.type==='single'?'单张':'成组'}·${hand.length>12?'中盘':'收官'}`,'改领最好的不带分',alt.cards]);
        }
      }
      if(tests.length){
        const base=playOut(hands,history,plays,leader,T,D,buried,dp,seat,cards);
        for(const [sit,sub,rule,alt] of tests){
          if(key(alt)===key(cards)){ R.push({sit,sub,rule,du:0,dp:0,same:1}); continue; }
          const v=playOut(hands,history,plays,leader,T,D,buried,dp,seat,alt);
          R.push({sit,sub,rule,du:v.u-base.u,dp:v.pts-base.pts,same:0});
        }
      }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    const res=E.resolveTrick(plays,T); if(res.winner%2!==D%2) dp+=E.countPoints(plays.flatMap(p=>p.cards)); history.push(...plays); leader=res.winner;
  }
}
if(process.env.DUMP) fs.writeFileSync(process.env.DUMP,JSON.stringify(R));
if(!process.env.QUIET){
  const m=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length), se=a=>{const mu=m(a);return Math.sqrt(a.reduce((x,y)=>x+(y-mu)**2,0)/Math.max(1,a.length-1)/Math.max(1,a.length));};
  const g={}; for(const r of R){ const k=r.sit+' | '+r.sub+' | '+r.rule; (g[k]=g[k]||[]).push(r); }
  for(const k of Object.keys(g).sort()){ const a=g[k]; const d=a.filter(r=>!r.same);
    console.log(`${k.padEnd(60)} n=${String(a.length).padStart(4)} 与AI同 ${String(a.length-d.length).padStart(4)}  不同时 备选−AI:级 ${m(d.map(r=>r.du)).toFixed(3)} ±${se(d.map(r=>r.du)).toFixed(3)}  分 ${m(d.map(r=>r.dp)).toFixed(1)} ±${se(d.map(r=>r.dp)).toFixed(1)}`); }
}
