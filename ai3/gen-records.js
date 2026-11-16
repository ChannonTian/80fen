/* ai3/gen-records.js —— 现引擎(默认配置,收官搜索开)自对弈,只存原始牌谱。级数可变。
 *   node ai3/gen-records.js --seed0=2000000 --n=100 --out=ai3/out/rec     (一块;已有 .done 则跳过)
 *   node ai3/gen-records.js --par --seed0=2000000 --total=20000 --chunk=100 --workers=8 --out=ai3/out/rec
 * 每局一行 JSON:{s:种子,lv:级数,ts:主花色0..3|4无主,dc:庄,h:[4×25 牌种],k:[8 埋底],
 *   p:[[座位,想出的牌种[],实际打出[]|null(同想出),搜索0/1,引擎候选数],...],
 *   dp:闲家墩得分,tot:总分,wl:闲家拿末墩,ll:末墩张数,win:闲家胜,du:闲升,cu:庄升}
 * 级数:种子为偶数打 2,奇数 3..14 均匀(由种子决定,可复现)。牌种 = id%54。 */
'use strict';
const fs=require('fs'),path=require('path'),zlib=require('zlib'),cp=require('child_process');
const a={seed0:2000000,n:100,total:20000,chunk:100,workers:8,out:path.join(__dirname,'out','rec')};
for(const x of process.argv.slice(2)){ const m=x.match(/^--(\w+)(?:=(.*))?$/); if(m) a[m[1]]=m[2]===undefined?true:(isNaN(+m[2])?m[2]:+m[2]); }
const SUITC='SHDC';
const makeRng=require('./kernel.js').makeRng;

function levelOf(seed){
  const u=makeRng(seed*7919+13)(), u2=makeRng(seed*104729+17)();   // 一半打 2,一半 3..14 均匀(种子决定,可复现)
  return u<0.5?2:3+Math.min(11,Math.floor(u2*12));
}
const ty=cards=>cards.map(c=>c.id%54).sort((x,y)=>x-y);

function playGame(E,seed){
  const level=levelOf(seed);
  E.RULES.levelStart=level;
  const {first}=E.cutForFirst(seed);
  const {hands,kitty}=E.dealRound(seed,first);
  let best=null, declSeat=-1;
  for(let s=0;s<4;s++){
    const o=E.declOptions(hands[s],level)[0];
    if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}
  }
  const rand=E.rng(seed^0x9e3779b9);
  let trump;
  if(!best){ trump={suit:null,rank:level}; declSeat=first; }
  else{
    trump={suit:best.suit,rank:level};
    for(let s=0;s<4;s++){
      if(s!==declSeat&&E.jokerPairOf(hands[s])&&rand()<0.3){ trump={suit:null,rank:level}; declSeat=s; break; }
    }
  }
  const curDecl=!best?null:{seat:declSeat,suit:trump.suit,
    strength:trump.suit?best.strength:(E.jokerPairOf(hands[declSeat])||{strength:3}).strength};
  hands[declSeat].push(...kitty);
  const buried=E.aiDiscard(hands[declSeat],trump);
  buried.forEach(c=>E.removeCard(hands[declSeat],c));
  const rec={s:seed,lv:level,ts:trump.suit?SUITC.indexOf(trump.suit):4,dc:declSeat,
    h:hands.map(h=>ty(h)),k:ty(buried),p:[]};
  const declTeam=declSeat%2, history=[];
  let leader=declSeat, defPoints=0, lastWinner=declSeat, lastLeadSize=1, tricks=0;
  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4;
      const view={seat,hand:hands[seat],trump,declSeat,history:[...history,...plays],
                  buriedKnown:seat===declSeat?buried:[],curDecl};
      let cards, want, eg, nc;
      if(i===0){
        const r=E.aiChooseLead(view); want=r.cards; cards=want; eg=r.eg?1:0; nc=(r.all||r.cands||[]).length;
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced;
      }else{
        const lead=E.classify(plays[0].cards,trump);
        const r=E.aiChooseFollow(view,plays); want=r.cards; cards=want; eg=r.eg?1:0; nc=(r.cands||[]).length;
        if(!E.isLegalFollow(hands[seat],lead,cards,trump)) cards=E.genFollow(hands[seat],lead,trump,rand);
      }
      const tw=ty(want), ta=ty(cards);
      rec.p.push([seat,tw,tw.join()===ta.join()?null:ta,eg,nc]);
      cards.forEach(c=>E.removeCard(hands[seat],c));
      plays.push({seat,cards});
    }
    history.push(...plays);
    lastLeadSize=plays[0].cards.length;
    const res=E.resolveTrick(plays,trump);
    leader=res.winner; lastWinner=res.winner; tricks++;
    if(res.winner%2!==declTeam) defPoints+=res.points;
    if(tricks>60) throw new Error('too many tricks');
  }
  const sc=E.scoreRound({defPoints,kitty:buried,defWonLastTrick:lastWinner%2!==declTeam,lastLeadSize});
  rec.dp=defPoints; rec.tot=sc.total; rec.wl=lastWinner%2!==declTeam?1:0; rec.ll=lastLeadSize;
  rec.win=sc.defendersWin?1:0; rec.du=sc.defenderLevelsUp||0; rec.cu=sc.declarerLevelsUp||0;
  return rec;
}

if(a.par){
  fs.mkdirSync(a.out,{recursive:true});
  const jobs=[]; for(let s=a.seed0;s<a.seed0+a.total;s+=a.chunk){
    const n=Math.min(a.chunk,a.seed0+a.total-s);
    if(!fs.existsSync(path.join(a.out,`s${s}_${n}.done`))) jobs.push([s,n]); }
  let running=0, done=0; const t0=Date.now(), tot=jobs.length;
  const next=()=>{ while(running<a.workers&&jobs.length){
    const [s,n]=jobs.shift(); running++;
    const p=cp.spawn(process.execPath,[__filename,`--seed0=${s}`,`--n=${n}`,`--out=${a.out}`],{stdio:['ignore','ignore','inherit']});
    p.on('exit',()=>{ running--; done++; if(done%5===0||done===tot) console.log(`${done}/${tot} 块, ${((Date.now()-t0)/1000).toFixed(0)}s`); next(); });
  } };
  console.log(`待跑 ${tot} 块`); next();
} else {
  const E=require('../ai2/sim.js').loadEngine();
  fs.mkdirSync(a.out,{recursive:true});
  const base=path.join(a.out,`s${a.seed0}_${a.n}`);
  if(!fs.existsSync(base+'.done')){
    const lines=[]; let t0=Date.now(), fail=0;
    for(let s=a.seed0;s<a.seed0+a.n;s++){
      try{ lines.push(JSON.stringify(playGame(E,s))); }catch(e){ fail++; console.error('seed',s,e.message); }
    }
    const ms=Date.now()-t0;
    fs.writeFileSync(base+'.jsonl.gz',zlib.gzipSync(lines.join('\n')+'\n'));
    fs.writeFileSync(base+'.done',JSON.stringify({games:lines.length,fail,ms}));
    if(!a.quiet) console.log(`seed0=${a.seed0} games=${lines.length} fail=${fail} ${(ms/Math.max(1,lines.length)).toFixed(0)} ms/局`);
  }
}
