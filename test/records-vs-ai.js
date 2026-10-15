/* 真人牌谱 × 当前 AI:你每一手自己出的牌,AI 在同一局面会出什么(路线 ④ 的第一把尺子,2026-10-01)。
 *
 *   node test/records-vs-ai.js <牌谱文件>... [html=80fen-test.html] [--ex=N 每类列 N 个不一致的例子]
 *   SELFTEST=40 node test/records-vs-ai.js            (没有真人牌谱时自检:用 AI 自对弈生成 40 局假牌谱,一致率应接近 100%)
 *
 * 只看 by:h(你自己出、不是托管、不是没得选)的手;照提示出的(hint)和重打的局(replay)另列。
 * 按局面分类给一致率,并列出不一致的例子(你出的、AI 首选及理由)—— 这就是「人和 AI 在哪儿想得不一样」的清单。
 * 分类特意对上 ai-progress 第四节 ⑤ 的观测点:第 2 家贴分、毙牌用哪张、领出单王、跟主墩用王……
 * 收官搜索默认关(EG=1 打开,慢),和界面里 ≤12 张时的选择会有出入。
 */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const args=process.argv.slice(2);
const html=args.find(a=>a.endsWith('.html'))||path.join(__dirname,'..','80fen-test.html');
const files=args.filter(a=>!a.startsWith('--')&&!a.endsWith('.html'));
const EXN=+((args.find(a=>a.startsWith('--ex='))||'--ex=3').slice(5));
const src=[...fs.readFileSync(html,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c;
vm.createContext(c);vm.runInContext(src,c);
const E=c.module.exports;
if(process.env.EG!=='1') E.AIP.egSearch=0;
const code=x=>x.suit+x.rank;
const nm=x=>x.suit==='X'?(x.rank===16?'大王':'小王'):({S:'♠',H:'♥',D:'♦',C:'♣'}[x.suit])+({14:'A',13:'K',12:'Q',11:'J'}[x.rank]||x.rank);
const ns=cs=>cs.map(nm).join('');

// ---------- 读牌谱(或自检时生成)----------
const recs=[];
if(process.env.SELFTEST){
  for(let seed=1;seed<=+process.env.SELFTEST;seed++){
    const {first}=E.cutForFirst(seed); const {hands,kitty}=E.dealRound(seed,first);
    let best=null,declSeat=-1; for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
    const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart}; if(!best) declSeat=first;
    hands[declSeat].push(...kitty); const buried=E.aiDiscard(hands[declSeat],trump); buried.forEach(x=>E.removeCard(hands[declSeat],x));
    const init=hands.map(h=>h.map(code)); const rand=E.rng(seed^0x9e3779b9); const history=[]; let leader=declSeat; const tricks=[];
    while(hands.some(h=>h.length)){ const plays=[];
      for(let i=0;i<4;i++){ const seat=(leader+i)%4, hand=hands[seat];
        const view={seat,hand,trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[]};
        let cards; if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
        else{ const lead=E.classify(plays[0].cards,trump); cards=E.aiChooseFollow(view,plays).cards; if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand); }
        cards.forEach(x=>E.removeCard(hand,x)); plays.push({seat,cards}); }
      history.push(...plays); const res=E.resolveTrick(plays,trump); leader=res.winner;
      tricks.push({plays:plays.map(p=>({seat:p.seat,cards:p.cards.map(code),...(p.seat===0?{by:'h'}:{})})),winner:res.winner,points:res.points}); }
    recs.push({id:'self'+seed,human:0,declSeat,trump,initialHands:init,buried:buried.map(code),tricks});
  }
}else{
  if(!files.length){ console.log('用法:node test/records-vs-ai.js <牌谱文件>...   (或 SELFTEST=40 自检)'); process.exit(1); }
  const seen=new Set();
  for(const f of files){ const txt=fs.readFileSync(f,'utf8').trim();
    for(const l of (txt.startsWith('{')&&!txt.includes('\n{')?[txt]:txt.split('\n'))){ if(!l.trim()) continue;
      try{ const r=JSON.parse(l); if(r.id&&seen.has(r.id)) continue; seen.add(r.id); if(Array.isArray(r.initialHands)&&Array.isArray(r.tricks)) recs.push(r); }catch(e){} } }
}

// ---------- 分类 ----------
const tier=(x,T)=>{ if(E.effSuit(x,T)!=='T') return E.cardPoints(x)>0?'副分牌':'副牌';
  if(x.suit==='X') return '王'; if(x.rank===T.rank) return '级牌'; if(E.cardPoints(x)>0) return '主分牌'; return x.rank>=12?'主大牌':'小主'; };
function category(view,plays,cards,T){
  if(!plays.length){
    const cl=E.classify(cards,T);
    if(cl&&cl.suit==='T') return cards.some(x=>x.suit==='X')&&cards.length===1&&view.hand.length>8?'领出 · 中盘单领王':'领出 · 主';
    return cl&&cl.type!=='single'?'领出 · 副牌成组':'领出 · 副牌单张';
  }
  const lead=E.classify(plays[0].cards,T), pos=plays.length+1;
  const curW=E.currentWinner(plays,T), partnerWin=curW.seat%2===view.seat%2;
  const haveSuit=view.hand.some(x=>E.effSuit(x,T)===lead.suit);
  if(lead.suit==='T') return `第 ${pos} 家 · 跟主墩`;
  if(!haveSuit) return `第 ${pos} 家 · 副牌墩断门(${partnerWin?'队友暂大':'对手暂大'})`;
  return `第 ${pos} 家 · 副牌墩跟本门(${partnerWin?'队友暂大':'对手暂大'})`;
}
const S={}, EX={};
let nHuman=0, nHint=0, nReplay=0;
for(const r of recs){
  let uid=0; const T=r.trump;
  const hands=r.initialHands.map(h=>h.map(x=>({suit:x[0],rank:+x.slice(1),id:'c'+(uid++)})));
  const buried=(r.buried||[]).map(x=>({suit:x[0],rank:+x.slice(1),id:'b'+(uid++)}));
  const history=[]; let ok=true;
  for(const t of r.tricks){ const plays=[];
    for(const p of t.plays){
      const h=hands[p.seat], before=h.slice(), cards=[];
      for(const x of p.cards){ const k=h.findIndex(y=>code(y)===x); if(k<0){ ok=false; break; } cards.push(h.splice(k,1)[0]); }
      if(!ok) break;
      if(p.seat===r.human&&p.by==='h'&&before.length>1){
        if(p.hint) nHint++; else if(r.replay) nReplay++; else {
          nHuman++;
          const view={seat:p.seat,hand:before,trump:T,declSeat:r.declSeat,history:history.slice(),buriedKnown:p.seat===r.declSeat?buried:[]};
          let q; try{ q=plays.length?E.aiChooseFollow(view,plays):E.aiChooseLead(view); }catch(e){ q=null; }
          if(q){
            const same=q.cards.length===cards.length&&q.cards.every(x=>cards.some(y=>code(y)===code(x)))
                       &&cards.every(x=>q.cards.filter(y=>code(y)===code(x)).length===cards.filter(y=>code(y)===code(x)).length);
            const k=category(view,plays,cards,T); const o=S[k]=S[k]||{n:0,agree:0,hPts:0,aPts:0,hTr:{},aTr:{}};
            o.n++; if(same) o.agree++;
            o.hPts+=E.countPoints(cards); o.aPts+=E.countPoints(q.cards);
            const th=[...new Set(cards.map(x=>tier(x,T)))].join('+'), ta=[...new Set(q.cards.map(x=>tier(x,T)))].join('+');
            o.hTr[th]=(o.hTr[th]||0)+1; o.aTr[ta]=(o.aTr[ta]||0)+1;
            if(!same){ (EX[k]=EX[k]||[]).push(`${r.nick||String(r.pid||r.id).slice(0,6)} 第${history.length/4+1}墩:领 ${plays.length?ns(plays[0].cards):'(我领)'}${plays.length>1?' 台面 '+plays.slice(1).map(x=>ns(x.cards)).join(' '):''}`
              +` → 你 ${ns(cards)} | AI ${ns(q.cards)}(${String(q.reason||'').slice(0,28)}) | 手里 ${ns(before)}`); }
          }
        }
      }
      plays.push({seat:p.seat,cards});
    }
    if(!ok) break;
    history.push(...plays);
  }
}
console.log(`${process.env.SELFTEST?'自检(AI 自对弈生成的假牌谱)':files.join(',')} —— ${recs.length} 局;你自己出的 ${nHuman} 手`
  +`(另有照提示出 ${nHint} 手、重打局 ${nReplay} 手,不计)`);
const tot=Object.values(S).reduce((a,o)=>a+o.agree,0);
console.log(`和当前 AI 首选一致:${nHuman?(100*tot/nHuman).toFixed(0):'-'}%\n`);
console.log('局面'.padEnd(26)+'手数'.padStart(6)+'一致'.padStart(7)+'  你出的分 / AI 的分(每手)   你常出的 → AI 常出的');
const top=o=>Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([k,v])=>`${k} ${v}`).join('、');
for(const [k,o] of Object.entries(S).sort((a,b)=>b[1].n-a[1].n))
  console.log(`${k.padEnd(26)}${String(o.n).padStart(6)}${((100*o.agree/o.n).toFixed(0)+'%').padStart(7)}  ${(o.hPts/o.n).toFixed(1).padStart(6)} / ${(o.aPts/o.n).toFixed(1).padEnd(6)}            ${top(o.hTr)} → ${top(o.aTr)}`);
if(EXN>0) for(const [k,a] of Object.entries(EX)){ console.log(`\n[${k}] 不一致 ${a.length} 手,例:`); a.slice(0,EXN).forEach(x=>console.log('  '+x)); }
