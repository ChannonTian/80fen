/* 牌谱里某一手的候选打分明细:node test/records-pos.js <牌谱> <局id前缀> <墩号> [座位] [html]   (EG=0 关搜索)
 * 列出 AI 在这一手的全部候选(牌、类别、分、理由),以及实际出的、当前引擎首选。 */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const [file,idp,tnS,seatS,htmlA]=process.argv.slice(2);
const html=htmlA||path.join(__dirname,'..','80fen-test.html');
const src=[...fs.readFileSync(html,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c; vm.createContext(c); vm.runInContext(src,c);
const E=c.module.exports; if(process.env.EG==='0') E.AIP.egSearch=0; if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV));
const code=x=>x.suit+x.rank;
const nm=x=>x.suit==='X'?(x.rank===16?'大王':'小王'):({S:'♠',H:'♥',D:'♦',C:'♣'}[x.suit])+({14:'A',13:'K',12:'Q',11:'J'}[x.rank]||x.rank);
const ns=cs=>cs.map(nm).join('');
const r=fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(JSON.parse).find(x=>x.id.startsWith(idp)||(String(x.pid).slice(0,4)+'·'+x.id.slice(0,4))===idp);
const T=r.trump; let uid=0; const D=r.declSeat;
const hands=r.initialHands.map(h=>h.map(x=>({suit:x[0],rank:+x.slice(1),id:'c'+(uid++)})));
const buried=(r.buried||[]).map(x=>({suit:x[0],rank:+x.slice(1),id:'b'+(uid++)}));
const role=s=>(s===D?'庄家':s%2===D%2?'庄帮':'闲')+(s===r.human?'(人)':'');
const history=[]; const TN=+tnS;
for(let i=0;i<r.tricks.length;i++){ const t=r.tricks[i]; const plays=[];
  for(const p of t.plays){ const h=hands[p.seat], before=h.slice(), cards=[];
    for(const x of p.cards){ const k=h.findIndex(y=>code(y)===x); cards.push(h.splice(k,1)[0]); }
    if(i+1===TN&&(seatS===undefined||+seatS===p.seat)&&p.seat!==r.human){
      const view={seat:p.seat,hand:before,trump:T,declSeat:D,history:history.concat(plays),buriedKnown:p.seat===D?buried:[],decl:r.decl};
      const q=plays.length?E.aiChooseFollow(view,plays):E.aiChooseLead(view);
      console.log(`第${TN}墩 ${role(p.seat)} 第${plays.length+1}家 主${T.suit||'无'}${T.rank} 台面 ${plays.map(z=>role(z.seat)+':'+ns(z.cards)).join(' ')||'(领)'}\n手 ${ns(before.slice().sort((a,b)=>E.ordIdx(b,T)-E.ordIdx(a,T)))}\n实际 ${ns(cards)} | 当前首选 ${ns(q.cards)}〔${q.reason}〕`);
      const cs=(q.all||q.cands||[]).slice().sort((a,b)=>(b.score||0)-(a.score||0));
      for(const k of cs) console.log(`   ${String((k.score||0).toFixed(1)).padStart(7)}  ${ns(k.cards).padEnd(10)} ${(k.cat||'').padEnd(6)} ${k.reason||''}`);
      if(q.eg) console.log('   搜索:',q.eg.map(o=>ns(o.cards)+' '+o.u.toFixed(3)).join(' | '),`(${q.eg.samples} 世界)`);
    }
    plays.push({seat:p.seat,cards}); }
  history.push(...plays); if(i+1>=TN) break; }
