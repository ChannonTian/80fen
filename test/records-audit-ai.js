/* 真人牌谱里 **AI 座位** 的出牌体检(2026-10-14):AI 在真人桌上出了什么、为什么、有没有问题。
 *
 *   node test/records-audit-ai.js <牌谱文件>... [html=80fen-test.html] [--ex=N] [--dump=x.json]
 *
 * 逐局重放,对每一手 AI 出牌(非真人座位)用当前引擎重算一次(复现率 + 理由),再按三类观测点统计:
 *   ① 埋底 / 守底 / 抠底:AI 做庄埋了几分、末墩谁拿、底分丢没丢;真人做庄时 AI 闲家抠底成没成。
 *   ② 盘中大牌:王 / 主级牌在 0 分墩、队友已稳拿的墩、中盘单领。
 *   ③ 领出:AI 领出后本墩被对手拿走的分(按领出类型分)。
 * 收官搜索默认开(和界面一致,≤12 张);EG=0 关掉会快很多。
 */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const args=process.argv.slice(2);
const html=args.find(a=>a.endsWith('.html'))||path.join(__dirname,'..','80fen-test.html');
const files=args.filter(a=>!a.startsWith('--')&&!a.endsWith('.html'));
const EXN=+((args.find(a=>a.startsWith('--ex='))||'--ex=4').slice(5));
const DUMP=(args.find(a=>a.startsWith('--dump='))||'').slice(7);
const src=[...fs.readFileSync(html,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c;
vm.createContext(c);vm.runInContext(src,c);
const E=c.module.exports;
if(process.env.EG==='0') E.AIP.egSearch=0;
const code=x=>x.suit+x.rank;
const nm=x=>x.suit==='X'?(x.rank===16?'大王':'小王'):({S:'♠',H:'♥',D:'♦',C:'♣'}[x.suit])+({14:'A',13:'K',12:'Q',11:'J'}[x.rank]||x.rank);
const ns=cs=>cs.map(nm).join('');
const recs=[]; const seen=new Set();
for(const f of files) for(const l of fs.readFileSync(f,'utf8').split('\n')){ if(!l.trim()) continue;
  try{ const r=JSON.parse(l); if(seen.has(r.id)) continue; seen.add(r.id); if(Array.isArray(r.initialHands)&&Array.isArray(r.tricks)&&r.tricks.length) recs.push(r); }catch(e){} }

const big=(x,T)=>x.suit==='X'||(x.rank===T.rank);              // 王 / 级牌(含副级牌)
const bigT=(x,T)=>x.suit==='X'||(x.rank===T.rank&&x.suit===T.suit); // 王 / 主级牌
const ex={}, cnt={}; const inc=(k,v=1)=>cnt[k]=(cnt[k]||0)+v;
const push=(k,s)=>(ex[k]=ex[k]||[]).push(s);
const out=[];
let nAI=0,nSame=0;
for(const r of recs){
  const T=r.trump; let uid=0;
  const hands=r.initialHands.map(h=>h.map(x=>({suit:x[0],rank:+x.slice(1),id:'c'+(uid++)})));
  const buried=(r.buried||[]).map(x=>({suit:x[0],rank:+x.slice(1),id:'b'+(uid++)}));
  const H=r.human, D=r.declSeat, team=s=>s%2===D%2?'庄':'闲';
  const tag=`${String(r.pid).slice(0,4)}·${r.id.slice(0,4)}`;
  const history=[]; let ok=true; let tn=0;
  const full=r.tricks.length*4>=100||hands.every(h=>h.length===0);
  for(const t of r.tricks){ tn++; const plays=[];
    for(const p of t.plays){
      const h=hands[p.seat], before=h.slice(), cards=[];
      for(const x of p.cards){ const k=h.findIndex(y=>code(y)===x); if(k<0){ ok=false; break; } cards.push(h.splice(k,1)[0]); }
      if(!ok) break;
      if(p.seat!==H&&before.length>=1){
        nAI++;
        const view={seat:p.seat,hand:before,trump:T,declSeat:D,history:history.slice().concat(plays),buriedKnown:p.seat===D?buried:[],decl:r.decl};
        let q=null; try{ q=plays.length?E.aiChooseFollow(view,plays):E.aiChooseLead(view); }catch(e){}
        const same=q&&q.cards.length===cards.length&&q.cards.map(code).sort().join()===cards.map(code).sort().join();
        if(same) nSame++;
        out.push({tag,tn,seat:p.seat,role:team(p.seat)+(p.seat===D?'(庄家)':''),pos:plays.length+1,hand:before.length,
          table:plays.map(x=>ns(x.cards)).join(' '),cards:ns(cards),reason:q?String(q.reason||''):'',same,human:H,decl:D,
          handStr:ns(before.slice().sort((a,b)=>E.ordIdx(b,T)-E.ordIdx(a,T)))});
      }
      plays.push({seat:p.seat,cards});
    }
    if(!ok) break;
    // 墩后统计
    const res=E.resolveTrick(plays,T), pts=E.countPoints(plays.flatMap(p=>p.cards));
    const leadP=plays[0], leadAI=leadP.seat!==H;
    const lastTrick=hands.every(x=>x.length===0);
    for(const p of plays){ if(p.seat===H) continue;
      const mine=p.cards; const isLead=p===leadP;
      const partnerWin=res.winner%2===p.seat%2;
      if(mine.some(x=>bigT(x,T))&&!isLead&&!lastTrick){
        // 王 / 主级牌跟出:墩分、是不是自己拿、是不是被迫(手里只剩这些能出的不管)
        const k=pts===0?'跟出王/主级 · 0 分墩':'跟出王/主级 · 有分墩';
        inc(k); if(res.winner!==p.seat) { inc(k+' · 没拿到'); }
        if(pts===0&&res.winner===p.seat&&hands[p.seat].length>8) inc('跟出王/主级 · 0 分墩自己拿(中盘)');
      }
    }
    if(leadAI){
      const cl=E.classify(leadP.cards,T); const sd=leadP.seat;
      const k='领出 · '+(cl.suit==='T'?(leadP.cards.some(x=>x.suit==='X')?'主(含王)':'主'):'副')+(cl.type==='single'?'单':'组');
      inc(k); const lost=res.winner%2!==sd%2; if(lost){ inc(k+' · 丢墩'); inc(k+' · 丢分',pts); }
      const own=E.countPoints(leadP.cards);
      if(lost&&own>0){ inc('领出带分被对手拿'); inc('领出带分被对手拿 · 分',own);
        push('领出带分被对手拿',`${tag} 第${tn}墩 ${team(sd)}${sd===D?'(庄家)':''} 领 ${ns(leadP.cards)} → 台面 ${plays.slice(1).map(x=>ns(x.cards)).join(' ')} 丢 ${pts} 分`); }
      if(leadP.cards.length===1&&leadP.cards[0].suit==='X'&&hands[sd].length>8){ inc('中盘单领王'); push('中盘单领王',`${tag} 第${tn}墩 ${team(sd)}${sd===D?'(庄家)':''} 领 ${ns(leadP.cards)} 墩分 ${pts}`); }
    }
    history.push(...plays);
    if(lastTrick) r._last={winner:res.winner,plays:plays.map(p=>({seat:p.seat,c:ns(p.cards)})),pts};
  }
  r._ok=ok;
}
console.log(`${recs.length} 局;AI 出牌 ${nAI} 手,当前引擎重算一致 ${(100*nSame/nAI).toFixed(1)}%${process.env.EG==='0'?'(收官搜索关)':''}`);
// ① 埋底 / 末墩
const fin=recs.filter(r=>r._ok&&r._last);
const kit={};
for(const r of fin){ const D=r.declSeat, H=r.human, aiDecl=D!==H&&D%2!==H%2?'AI 庄(对手)':D===H?'真人做庄':'AI 庄(真人队友)';
  const bpts=E.countPoints((r.buried||[]).map(x=>({suit:x[0],rank:+x.slice(1)})));
  const declWonLast=r._last.winner%2===D%2;
  const o=kit[aiDecl]=kit[aiDecl]||{n:0,bp:0,lost:0,lostPts:0,lastT:{},defWin:0};
  o.n++; o.bp+=bpts; if(!declWonLast){ o.lost++; o.lostPts+=bpts*(r.mult||2); }
  if(r.defendersWin) o.defWin++;
  const wc=r._last.plays.find(p=>p.seat===r._last.winner).c; const kk=/王/.test(wc)?wc.replace(/[^大小王]/g,'').slice(0,2):wc;
  o.lastT[kk]=(o.lastT[kk]||0)+1;
  if(!declWonLast&&bpts>0) push('底被抠('+aiDecl+')',`${String(r.pid).slice(0,4)}·${r.id.slice(0,4)} 埋 ${bpts} 分 ×${r.mult} 末墩 ${r._last.plays.map(p=>(p.seat===D?'庄':p.seat%2===D%2?'庄帮':'闲')+(p.seat===H?'*':'')+':'+p.c).join(' ')} 闲家总分 ${r.defPoints}`);
}
console.log('\n① 埋底与末墩(完整局)');
for(const [k,o] of Object.entries(kit)) console.log(`  ${k.padEnd(14)} ${o.n} 局  平均埋 ${(o.bp/o.n).toFixed(1)} 分  末墩归闲 ${o.lost} 局(抠走 ${o.lostPts} 分)  闲家胜 ${o.defWin}  末墩赢牌 ${JSON.stringify(o.lastT)}`);
console.log('\n②③ 计数');
for(const k of Object.keys(cnt).sort()) console.log(`  ${k.padEnd(30)} ${cnt[k]}`);
if(EXN>0) for(const [k,a] of Object.entries(ex)){ console.log(`\n[${k}] ${a.length} 例:`); a.slice(0,EXN).forEach(x=>console.log('  '+x)); }
if(DUMP) fs.writeFileSync(DUMP,JSON.stringify(out));
