/* 第 2 家「跟分给在后的队友」准不准(产品方 2026-09-30):
 * 「跟分需要一个对队友有大牌不仅盖过 #1 家、还能盖过 #3 家的判断。如果没有这种迹象,直接送分就是冒险。」
 * 「判断的依赖条件根本不在于我是不是分、Q 是不是暂大,而在于这门还有什么大、谁有什么、断哪门的概率 ——
 *   谁做庄(庄家多半断门)会很大程度影响推断。」
 *
 *   node test/calib-feed.js <html> [种子数=400]      (OV= 覆盖 AIP;HARSH=1 第 3 家断门有主必毙;POOL=… 对手一队用池子里的引擎;DUMP=x.json 存特征给 fit-feed.js)
 *
 * 自对弈里我坐第 2 家、对手领副牌单张、我的候选里有一手带分的「跟分 / 垫分」(不赢墩)时记一个局面:
 * AI 估的「本队最终拿下这墩」p(pTeamWin,贴分后口径),以及把这一手放上去、其余三家按 AI 打完这墩的实际结果。
 * 按 p 分箱看校准;再按「谁是庄家」(#1 领出者 / #3 下家 / #4 队友 / 我)分层,这是产品方说的关键条件。
 */
'use strict';
const fs=require('fs'),vm=require('vm');
const FILE=process.argv[2]||'80fen-test.html';
const src=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c;
vm.createContext(c);vm.runInContext(src,c);
const E=c.module.exports;
E.AIP.egSearch=0;
const loadAny=f=>{ if(f.endsWith('.js')){ const cx=vm.createContext({window:{}}); vm.runInContext(fs.readFileSync(f,'utf8'),cx); const a=cx.window.__ENGINES; return a[Object.keys(a)[0]]; }
  const sr=[...fs.readFileSync(f,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
  const cc={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};cc.globalThis=cc; vm.createContext(cc); vm.runInContext(sr,cc); return cc.module.exports; };
const POOL=(process.env.POOL||'').split(',').filter(Boolean).map(loadAny); POOL.forEach(m=>{ if(m.AIP) m.AIP.egSearch=0; });
if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV));
const N=+process.argv[3]||400;
let aiOf=()=>E;
const finishTrick=(hands,history,plays,leader,seat,cards,trump,declSeat,buried,rand)=>{
  const hs=hands.map(h=>h.slice()); const ps=[...plays,{seat,cards}]; cards.forEach(x=>E.removeCard(hs[seat],x));
  for(let i=ps.length;i<4;i++){ const s=(leader+i)%4, hand=hs[s];
    const v={seat:s,hand,trump,declSeat,history:[...history,...ps],buriedKnown:s===declSeat?buried:[]};
    const lead=E.classify(ps[0].cards,trump); let cs=aiOf(s).aiChooseFollow(v,ps).cards;
    /* HARSH=1:第 3 家(我的下家)断这门、有主、台面有分就一定毙(拿最小的能压住当前最大的主)—— 人坐那里的样子。
     * AI 自己坐第 3 家时并不总毙(自对弈里「#3 真断这门」本队还拿下 38%),续打的实测会偏乐观。 */
    if(process.env.HARSH==='1'&&i===ps.length&&s===(seat+1)%4&&lead.suit!=='T'&&!hand.some(x=>E.effSuit(x,trump)===lead.suit)){
      const cur=E.currentWinner(ps,trump);
      const tr=hand.filter(x=>E.effSuit(x,trump)==='T').sort((a,b)=>E.ordIdx(a,trump)-E.ordIdx(b,trump))
                   .find(x=>E.currentWinner([...ps,{seat:s,cards:[x]}],trump).seat===s);
      // 队友(#1)暂大也毙:他那张不是本门最大,台面有分时人会先毙掉,不赌 #4 没有更大的
      if(tr&&E.countPoints(ps.flatMap(p=>p.cards))>0) cs=[tr];
    }
    if(!E.isLegalFollow(hand,lead,cs,trump)) cs=E.genFollow(hand,lead,trump,rand);
    ps.push({seat:s,cards:cs}); }
  const r=E.resolveTrick(ps,trump); return {won:r.winner%2===seat%2, pts:r.points}; };
const R=[];
for(let seed=1;seed<=N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) declSeat=first;
  hands[declSeat].push(...kitty); const buried=E.aiDiscard(hands[declSeat],trump); buried.forEach(x=>E.removeCard(hands[declSeat],x));
  aiOf=s=>POOL.length&&s%2!==seed%2?POOL[seed%POOL.length]:E;
  const rand=E.rng(seed^0x9e3779b9); const history=[]; let leader=declSeat;
  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){ cards=aiOf(seat).aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{
        const lead=E.classify(plays[0].cards,trump); const q=aiOf(seat).aiChooseFollow(view,plays); cards=q.cards;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand);
        if(i===1&&aiOf(seat)===E&&lead.type==='single'&&lead.suit!=='T'&&hand.length>1){
          // 带分、不赢墩的候选里分最多的那一手
          const feed=(q.cands||[]).filter(o=>o.cards.length===1&&E.countPoints(o.cards)>0
                       &&E.currentWinner([...plays,{seat,cards:o.cards}],trump).seat!==seat
                       &&E.effSuit(o.cards[0],trump)!=='T')
                     .sort((a,b)=>E.countPoints(b.cards)-E.countPoints(a.cards))[0];
          if(feed){
            const X=E.followCtx(view,plays); const p=E.pTeamWin(X,feed.cards,false);
            const out=finishTrick(hands,history,plays,leader,seat,feed.cards,trump,declSeat,buried,E.rng(seed*7+history.length));
            const s3=(seat+1)%4, s4=(seat+2)%4, ls=lead.suit;
            const void3=!hands[s3].some(x=>E.effSuit(x,trump)===ls), void4=!hands[s4].some(x=>E.effSuit(x,trump)===ls);
            const top=E.ordIdx(plays[0].cards[0],trump);
            const p4big=hands[s4].some(x=>E.effSuit(x,trump)===ls&&E.ordIdx(x,trump)>top);
            const decl=declSeat===seat?'我是庄':declSeat===leader?'#1(领出者)是庄':declSeat===s3?'#3 是庄':'#4(队友)是庄';
            const sk=X.reads&&X.reads.skip, tbl=E.countPoints(plays.flatMap(p=>p.cards));
            R.push({f:[p,X.pVoidOf(s3,ls),X.pVoidOf(s4,ls),declSeat===leader?1:0,declSeat===s3?1:0,declSeat===s4?1:0,declSeat===seat?1:0,
                       tbl+E.countPoints(feed.cards),sk&&sk[s3][ls]?1:0,sk&&sk[s4][ls]?1:0,hand.length],
                    p,won:out.won,pts:E.countPoints(feed.cards),chosen:feed.cards[0].id===cards[0].id,decl,void3,void4,p4big,
                    mid:hand.length>8});
          }
        }
      }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    history.push(...plays);
    leader=E.resolveTrick(plays,trump).winner;
  }
}
if(process.env.DUMP) fs.writeFileSync(process.env.DUMP,JSON.stringify(R.map(r=>[...r.f,r.won?1:0])));
const mm=(g,f)=>g.reduce((a,r)=>a+f(r),0)/Math.max(1,g.length);
console.log(`${FILE}${process.env.OV?' OV='+process.env.OV:''} —— ${N} 副;我第 2 家、对手领副牌单张、有「带分不赢墩」的候选:${R.length} 个局面`);
const row=(t,g)=>{ if(g.length<15) return; console.log(`  ${t.padEnd(22)} n=${String(g.length).padStart(5)}  估 ${(100*mm(g,r=>r.p)).toFixed(0).padStart(3)}%  实 ${(100*mm(g,r=>r.won)).toFixed(0).padStart(3)}%   AI 实际选了跟分 ${(100*mm(g,r=>r.chosen)).toFixed(0)}%`); };
console.log('\n按 AI 估的 p 分箱(实 = 把分放上去、其余按 AI 打完,本队拿下这墩的比例):');
for(let b=0;b<10;b++){ row(`[${b/10},${(b+1)/10})`,R.filter(r=>r.p>=b/10&&r.p<(b+1)/10)); }
console.log('\n按谁是庄家:'); for(const d of ['#1(领出者)是庄','#3 是庄','#4(队友)是庄','我是庄']) row(d,R.filter(r=>r.decl===d));
console.log('\nAI 实际选了跟分的那些:'); row('全部',R.filter(r=>r.chosen));
for(const d of ['#1(领出者)是庄','#3 是庄','#4(队友)是庄','我是庄']) row('  '+d,R.filter(r=>r.chosen&&r.decl===d));
console.log('\n真实牌面(AI 看不到,只用来看它该往哪边估):');
row('#3 真断这门',R.filter(r=>r.void3)); row('#3 不断、#4 有更大的',R.filter(r=>!r.void3&&r.p4big));
row('#3 不断、#4 没更大、#4 断',R.filter(r=>!r.void3&&!r.p4big&&r.void4)); row('#3 不断、#4 没更大也不断',R.filter(r=>!r.void3&&!r.p4big&&!r.void4));
