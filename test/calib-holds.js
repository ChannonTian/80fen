/* 「谁手里有什么」的推断准不准(路线 ②,2026-10-01)。
 *
 *   node test/calib-holds.js <html> [种子数=200]      (OV= 覆盖 AIP;POOL=a.html,b.js 让别家用池子里的引擎打,观察者仍是候选 AI;DUMP=x.json 存「握最大那张」的样本给拟合用)
 *
 * 每次领出前,领出者当观察者:对另外三家每一家 s、每一门副牌 S(这门在外还有牌),
 *   · AI 估的「s 断 S」= L.pVoidOf(s,S)                      → 和真实手牌比
 *   · 「s 握着这门在外最大的那张」的均匀估计 = expHoldIn(s,S) / Σ(三家 + 底)  → 和真实比
 * 再按产品方说的信号分层:「这张成为在外最大之后,s 领过牌、却没领这门」(有机会领大牌却没领)、
 * 「s 是庄家」。信号层里真实频率和估计差多少,就是这条信号该给多大的权。
 * 校准用分箱 + 对数损失(越小越好)。
 */
'use strict';
const fs=require('fs'),vm=require('vm');
const FILE=process.argv[2]||'80fen-test.html';
const load=f=>{ if(f.endsWith('.js')){ const ctx=vm.createContext({window:{}}); vm.runInContext(fs.readFileSync(f,'utf8'),ctx); const a=ctx.window.__ENGINES; return a[Object.keys(a)[0]]; }
  const src=[...fs.readFileSync(f,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
  const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c; vm.createContext(c); vm.runInContext(src,c); return c.module.exports; };
const E=load(FILE); E.AIP.egSearch=0;
// 与引擎里 expHoldIn 同式(它没导出):这门未见张数 × 我的手牌占未见的比例,再夹进持有区间
const expHoldIn=(L,seat,S)=>{ let tot=0,inS=0; for(const k in L.mem.unseen){ const n=L.mem.unseen[k]; if(n<=0) continue; tot+=n;
    if(E.effSuit(E.keyToCard(k),L.trump)===S) inS+=n; }
  if(tot<=0) return 0; const raw=inS*Math.min(1,(L.hand||[]).length/tot);
  if(!L.holdRange) return raw; const {lo,hi}=L.holdRange(seat,S); return Math.min(hi,Math.max(lo,raw)); };
if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV));
const POOL=(process.env.POOL||'').split(',').filter(Boolean).map(load); POOL.forEach(m=>{ if(m.AIP) m.AIP.egSearch=0; });
const N=+process.argv[3]||200;
const V=[], Tp=[];
const ll=(p,y)=>{ p=Math.min(0.999,Math.max(0.001,p)); return -(y?Math.log(p):Math.log(1-p)); };
for(let seed=1;seed<=N;seed++){
  const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) declSeat=first;
  hands[declSeat].push(...kitty); const buried=E.aiDiscard(hands[declSeat],trump); buried.forEach(x=>E.removeCard(hands[declSeat],x));
  const opp=POOL.length?POOL[seed%POOL.length]:null;            // 池子:对手一队换成别的引擎(按种子轮换)
  const aiOf=s=>opp&&s%2!==seed%2?opp:E;
  const rand=E.rng(seed^0x9e3779b9); const history=[]; let leader=declSeat;
  // 每家每门:这门「在外最大」那张最近一次变化之后,s 有没有领过牌而没领这门
  const skipped=[{},{},{},{}];
  const topKey=(S)=>{ let t=-1; for(const h of hands) for(const x of h) if(E.effSuit(x,trump)===S) t=Math.max(t,E.ordIdx(x,trump)); return t; };
  const lastTop={};
  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){
        if(aiOf(seat)===E&&hand.length>3){
          const L=E.leadCtx(view);
          for(const s of [0,1,2,3].filter(x=>x!==seat)) for(const S of ['S','H','D','C'].filter(x=>x!==trump.suit)){
            const t=topKey(S); if(t<0) continue;                                     // 这门在外(含我)没牌了
            if(hand.some(x=>E.effSuit(x,trump)===S&&E.ordIdx(x,trump)===t)) continue; // 最大那张在我手里,不用猜
            const pv=L.pVoidOf(s,S), yv=!hands[s].some(x=>E.effSuit(x,trump)===S);
            const holders=[0,1,2,3].filter(x=>x!==seat);
            const ex=holders.map(h=>expHoldIn(L,h,S)); const kit=seat===declSeat?0:Math.max(0,8*(ex.reduce((a,b)=>a+b,0)/Math.max(1,holders.reduce((a,h)=>a+hands[h].length,0))));
            const tot=ex.reduce((a,b)=>a+b,0)+kit;
            // 在外最大的那个点数可能有两张(观察者从记牌就知道还剩几张):他至少握一张的概率
            const copies=holders.reduce((a,h)=>a+hands[h].filter(x=>E.effSuit(x,trump)===S&&E.ordIdx(x,trump)===t).length,0)
                        +(seat===declSeat?0:buried.filter(x=>E.effSuit(x,trump)===S&&E.ordIdx(x,trump)===t).length);
            const sh=tot>0?ex[holders.indexOf(s)]/tot:0;
            const pt=1-Math.pow(1-sh,Math.max(1,copies)), yt=hands[s].some(x=>E.effSuit(x,trump)===S&&E.ordIdx(x,trump)===t);
            const sig={skip:!!skipped[s][S], decl:s===declSeat, partner:s%2===seat%2};
            V.push({p:pv,y:yv,...sig}); Tp.push({p:pt,y:yt,...sig});
          }
        }
        cards=aiOf(seat).aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced;
        // 记信号:这一手领的不是某门 → 对那门记「有机会却没领」(只在这门在外最大没变时有效)
        const ls=E.effSuit(cards[0],trump);
        for(const S of ['S','H','D','C'].filter(x=>x!==trump.suit)){
          const t=topKey(S); if(lastTop[S]!==t){ lastTop[S]=t; for(const z of [0,1,2,3]) skipped[z][S]=false; }
          if(S!==ls) skipped[seat][S]=true; else skipped[seat][S]=false;
        }
      }else{ const lead=E.classify(plays[0].cards,trump); cards=aiOf(seat).aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand); }
      cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards});
    }
    history.push(...plays); leader=E.resolveTrick(plays,trump).winner;
  }
}
if(process.env.DUMP) fs.writeFileSync(process.env.DUMP,JSON.stringify(Tp.map(r=>[r.p,r.y?1:0,r.skip?1:0,r.decl?1:0,r.partner?1:0])));
const mm=(g,f)=>g.reduce((a,r)=>a+f(r),0)/Math.max(1,g.length);
const rep=(name,A)=>{
  console.log(`\n【${name}】n=${A.length}  对数损失 ${mm(A,r=>ll(r.p,r.y)).toFixed(4)}  估 ${(100*mm(A,r=>r.p)).toFixed(1)}%  实 ${(100*mm(A,r=>r.y)).toFixed(1)}%`);
  for(let b=0;b<10;b++){ const g=A.filter(r=>r.p>=b/10&&(b===9?r.p<=1:r.p<(b+1)/10)); if(g.length<100) continue;
    console.log(`   [${(b/10).toFixed(1)},${((b+1)/10).toFixed(1)})  n=${String(g.length).padStart(6)}  估 ${(100*mm(g,r=>r.p)).toFixed(1).padStart(5)}%  实 ${(100*mm(g,r=>r.y)).toFixed(1).padStart(5)}%`); }
  const sub=(t,g)=>{ if(g.length>=100) console.log(`   ${t.padEnd(30)} n=${String(g.length).padStart(6)}  估 ${(100*mm(g,r=>r.p)).toFixed(1).padStart(5)}%  实 ${(100*mm(g,r=>r.y)).toFixed(1).padStart(5)}%`); };
  sub('有机会领却没领这门(对手)',A.filter(r=>r.skip&&!r.partner)); sub('没有这个信号(对手)',A.filter(r=>!r.skip&&!r.partner));
  sub('有机会领却没领这门(队友)',A.filter(r=>r.skip&&r.partner));
  sub('他是庄家',A.filter(r=>r.decl)); sub('他不是庄家',A.filter(r=>!r.decl));
  sub('庄家 · 有机会领却没领',A.filter(r=>r.decl&&r.skip));
};
console.log(`${FILE}${POOL.length?' POOL='+process.env.POOL:''} —— ${N} 副,领出前的观察`);
rep('某家断某门(pVoidOf)',V);
rep('某家握着这门在外最大的那张(按持有张数均匀分摊)',Tp);
