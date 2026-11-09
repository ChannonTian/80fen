/* 第 2 家断门不毙、把牌垫给后面的队友:队友是真人 vs AI 时本队拿下的比例(2026-11-08,查「续打的 AI 像不像人」)。
 *   node test/records-rescue.js <牌谱.jsonl>   (在仓库根目录跑)  */
const fs=require('fs'),vm=require('vm');const sr=[...fs.readFileSync(require('path').join(__dirname,'..','80fen-test.html'),'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const cc={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};cc.globalThis=cc;vm.createContext(cc);vm.runInContext(sr,cc);const E=cc.module.exports;
const {isTestGame}=require('./records-filter.js');
const rs=fs.readFileSync(process.argv[2],'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(r=>r&&!isTestGame(r)&&r.initialHands&&r.tricks&&r.tricks.length);
const G={};
const add=(k,won,pts)=>{ const o=G[k]||(G[k]={n:0,w:0,pts:0}); o.n++; if(won) o.w++; o.pts+=pts; };
for(const r of rs){ const T=r.trump; let uid=0; const hands=r.initialHands.map(h=>h.map(x=>({suit:x[0],rank:+x.slice(1),id:'c'+(uid++)}))); let ok=true;
  for(const t of r.tricks){ const plays=[];
    for(const [j,p] of t.plays.entries()){ const h=hands[p.seat], before=h.slice(), cards=[];
      for(const x of p.cards){ const k=h.findIndex(y=>y.suit+y.rank===x); if(k<0){ok=false;break;} cards.push(h.splice(k,1)[0]); } if(!ok) break;
      if(j===1&&p.seat!==r.human&&cards.length===1&&plays[0].cards.length===1){ const lead=E.classify(plays[0].cards,T);
        const voidS=lead.suit!=='T'&&!before.some(x=>E.effSuit(x,T)===lead.suit), hasT=before.some(x=>E.effSuit(x,T)==='T');
        if(voidS&&hasT&&E.effSuit(cards[0],T)!=='T'){ const full=t.plays.map(q=>({seat:q.seat,cards:q.cards.map(x=>({suit:x[0],rank:+x.slice(1)}))}));
          const won=E.resolveTrick(full,T).winner%2===p.seat%2, mate=(p.seat+2)%4, mateHum=mate===r.human?'队友真人':'队友 AI', dumped=E.cardPoints(cards[0])>0?'垫了分':'没垫分';
          add(mateHum+'·'+dumped,won,E.cardPoints(cards[0])); add(mateHum,won,0);
          // 同样局面里 AI 毙了的(对照)在下面单独数
        }
        if(voidS&&hasT&&E.effSuit(cards[0],T)==='T'){ const full=t.plays.map(q=>({seat:q.seat,cards:q.cards.map(x=>({suit:x[0],rank:+x.slice(1)}))}));
          const won=E.resolveTrick(full,T).winner%2===p.seat%2, mate=(p.seat+2)%4; add('(对照)AI 自己毙了·'+(mate===r.human?'队友真人':'队友 AI'),won,0); }
      }
      plays.push({seat:p.seat,cards}); } if(!ok) break; } }
for(const k of Object.keys(G).sort()){ const o=G[k]; console.log(`  ${k.padEnd(22)} n=${String(o.n).padStart(4)}  本队拿下 ${(100*o.w/o.n).toFixed(0)}%`); }
