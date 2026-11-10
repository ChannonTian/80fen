/* 真人 vs AI 的毙牌意愿(11-10,flagFix 两把尺子方向相反时查「续打的 AI 像不像人」):单张副牌领出、对手暂大、我断门且有压得过的主 —— 毙不毙,
 * 按末家 / 非末家、真人 / AI、台面分拆。  node test/records-ruffwill.js <牌谱.jsonl> */
const fs=require('fs'),vm=require('vm');
const {isTestGame}=require('./records-filter.js');
const src=[...fs.readFileSync(require('path').join(__dirname,'..','80fen-test.html'),'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c; vm.createContext(c); vm.runInContext(src,c); const E=c.module.exports;
const recs=fs.readFileSync(process.argv[2],'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(r=>r&&r.initialHands&&r.tricks&&!isTestGame(r));
const st={}; const add=(k,y)=>{st[k]=st[k]||[0,0]; st[k][0]++; st[k][1]+=y;};
for(const r of recs){ let uid=0; const parse=s=>({suit:s[0],rank:+s.slice(1),id:'r'+(uid++)});
  const hands=r.initialHands.map(h=>h.map(parse)), T=r.trump, D=r.declSeat;
  const take=(seat,code)=>{const h=hands[seat];const i=h.findIndex(x=>x.suit+x.rank===code);return h.splice(i,1)[0];};
  for(const t of r.tricks){ const plays=[]; let ruffer=null;
    for(const p of t.plays){ const before=hands[p.seat].slice(); const cards=p.cards.map(code=>take(p.seat,code)); 
      const lead=plays.length?E.classify(plays[0].cards,T):null;
      if(lead&&lead.type==='single'&&lead.suit!=='T'&&cards.length===1){
        const voidHere=!before.some(x=>E.effSuit(x,T)===lead.suit);
        // 有人(对手)小毙在先、现在由我(另一队)断门、手里有压得过的主 → 盖不盖
        if(voidHere&&E.currentWinner(plays,T).seat%2!==p.seat%2&&!E.isLastSeat){
          const over=before.filter(x=>E.effSuit(x,T)==='T'&&E.currentWinner([...plays,{seat:p.seat,cards:[x]}],T).seat===p.seat);
          if(over.length){ const did=E.currentWinner([...plays,{seat:p.seat,cards}],T).seat===p.seat?1:0;
            const who=p.seat===r.human&&p.by!=='a'&&p.by!=='f'?'真人':'AI';
            const tbl=E.countPoints(plays.flatMap(q=>q.cards));
            add(`${plays.length===3?'末家':'非末'}·${who}·台面${tbl===0?'0':tbl<=10?'5~10':'>10'}`,did); add((plays.length===3?'末家':'非末')+'·'+who,did); } }
        if(!ruffer&&plays.length&&voidHere&&E.effSuit(cards[0],T)==='T'&&E.currentWinner([...plays,{seat:p.seat,cards}],T).seat===p.seat) ruffer={seat:p.seat};
      }
      plays.push({seat:p.seat,cards}); } } }
for(const k of Object.keys(st).sort()) console.log(k.padEnd(14),'n=',st[k][0],'盖毙',(100*st[k][1]/st[k][0]).toFixed(0)+'%');
