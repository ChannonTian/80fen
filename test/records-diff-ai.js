/* 真人牌谱里 AI 座位的每一手:当前引擎 vs 旧引擎(默认 v0.7.30 = 正式版 AI)在同一局面各出什么(2026-10-14)。
 *
 *   node test/records-diff-ai.js <旧.html> <牌谱文件>... [--out=x.json]   (新 = 80fen-test.html,NEW= 覆盖)
 *
 * 出的是「换了版本以后,真人桌上 AI 哪些手变了」的清单(按领出 / 跟牌位置 / 手里剩几张分),每条带两边理由与手牌。
 */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const args=process.argv.slice(2);
const OLD=args[0]; const NEW=process.env.NEW||path.join(__dirname,'..','80fen-test.html');
const files=args.slice(1).filter(a=>!a.startsWith('--'));
const OUT=(args.find(a=>a.startsWith('--out='))||'').slice(6);
const load=f=>{ const sr=[...fs.readFileSync(f,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
  const cc={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};cc.globalThis=cc; vm.createContext(cc); vm.runInContext(sr,cc); return cc.module.exports; };
const A=load(NEW), B=load(OLD);
if(process.env.EG==='0'){ A.AIP.egSearch=0; B.AIP.egSearch=0; }
if(process.env.OVA) Object.assign(A.AIP,JSON.parse(process.env.OVA));
if(process.env.OVB) Object.assign(B.AIP,JSON.parse(process.env.OVB));
const E=A, code=x=>x.suit+x.rank;
const nm=x=>x.suit==='X'?(x.rank===16?'大王':'小王'):({S:'♠',H:'♥',D:'♦',C:'♣'}[x.suit])+({14:'A',13:'K',12:'Q',11:'J'}[x.rank]||x.rank);
const ns=cs=>cs.map(nm).join('');
const recs=[]; const seen=new Set();
for(const f of files) for(const l of fs.readFileSync(f,'utf8').split('\n')){ if(!l.trim()) continue;
  try{ const r=JSON.parse(l); if(seen.has(r.id)) continue; seen.add(r.id); if(Array.isArray(r.tricks)&&r.tricks.length) recs.push(r); }catch(e){} }
const out=[]; let n=0, nd=0; const by={};
for(const r of recs){
  const T=r.trump; let uid=0;
  const hands=r.initialHands.map(h=>h.map(x=>({suit:x[0],rank:+x.slice(1),id:'c'+(uid++)})));
  const buried=(r.buried||[]).map(x=>({suit:x[0],rank:+x.slice(1),id:'b'+(uid++)}));
  const H=r.human, D=r.declSeat; const history=[]; let ok=true, tn=0;
  const role=s=>s===D?'庄家':s%2===D%2?'庄帮':'闲';
  for(const t of r.tricks){ tn++; const plays=[];
    for(const p of t.plays){
      const h=hands[p.seat], before=h.slice(), cards=[];
      for(const x of p.cards){ const k=h.findIndex(y=>code(y)===x); if(k<0){ ok=false; break; } cards.push(h.splice(k,1)[0]); }
      if(!ok) break;
      if(p.seat!==H&&before.length>1){
        const view={seat:p.seat,hand:before,trump:T,declSeat:D,history:history.concat(plays),buriedKnown:p.seat===D?buried:[],decl:r.decl};
        const ch=M=>{ try{ return plays.length?M.aiChooseFollow({...view,hand:before.slice()},plays):M.aiChooseLead({...view,hand:before.slice()}); }catch(e){ return {cards:[],reason:'ERR '+e.message}; } };
        const a=ch(A), b=ch(B); n++;
        const same=a.cards.map(code).sort().join()===b.cards.map(code).sort().join();
        const k=(plays.length?`第${plays.length+1}家`:'领出')+(before.length<=12?' ≤12':' >12');
        const o=by[k]=by[k]||{n:0,d:0}; o.n++;
        if(!same){ nd++; o.d++;
          out.push({rec:`${String(r.pid).slice(0,4)}·${r.id.slice(0,4)}`,tn,seat:p.seat,role:role(p.seat),human:H,humanRole:role(H),hand:before.length,pos:plays.length+1,
            trump:(T.suit||'无')+T.rank, table:plays.map(x=>role(x.seat)+':'+ns(x.cards)).join(' '),
            handStr:ns(before.slice().sort((x,y)=>E.ordIdx(y,T)-E.ordIdx(x,T))),
            played:ns(cards), nw:ns(a.cards), nwR:String(a.reason||''), old:ns(b.cards), oldR:String(b.reason||''),
            trickPts:E.countPoints(t.plays.flatMap(q=>q.cards.map(x=>({suit:x[0],rank:+x.slice(1)})))), winnerRole:role(t.winner)});
        }
      }
      plays.push({seat:p.seat,cards});
    }
    if(!ok) break; history.push(...plays);
  }
}
console.log(`${recs.length} 局,AI 手 ${n},新旧不同 ${nd}(${(100*nd/n).toFixed(1)}%)`);
for(const [k,o] of Object.entries(by).sort()) console.log(`  ${k.padEnd(12)} ${o.d}/${o.n}`);
if(OUT) fs.writeFileSync(OUT,JSON.stringify(out,null,0));
