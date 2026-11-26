/* ai3/gen-records.js —— 现引擎(默认配置,收官搜索开)自对弈,只存原始牌谱。级数可变。
 *   node ai3/gen-records.js --seed0=2000000 --n=100 --out=ai3/out/rec     (一块;已有 .done 则跳过)
 *   node ai3/gen-records.js --par --seed0=2000000 --total=20000 --chunk=100 --workers=8 --out=ai3/out/rec
 * 每局一行 JSON:{s:种子,lv:级数,ts:主花色0..3|4无主,dc:庄,h:[4×25 牌种],k:[8 埋底],
 *   p:[[座位,想出的牌种[],实际打出[]|null(同想出),搜索0/1,引擎候选数],...],
 *   dp:闲家墩得分,tot:总分,wl:闲家拿末墩,ll:末墩张数,win:闲家胜,du:闲升,cu:庄升}
 * 级数:种子为偶数打 2,奇数 3..14 均匀(由种子决定,可复现)。牌种 = id%54。
 *
 * DAgger 模式 --dagger=<权重目录>(块文件前缀 d,其余同上;局里多 dg:网络那队的队号 0/1):
 *   每局按种子随机选一队由网络打(argmax,只管打牌阶段;亮主 / 埋底仍是引擎),另一队是引擎。
 *   网络那队每个决策:先让引擎在同一局面算出它会出什么(= 标签),再实际出网络那手。
 *   p 的每一手:[座位, 实际选的牌种[], 被强制 / 修正后实际打出[]|null, 搜索0/1, 引擎候选数, 标签, 标签被强制]
 *     第 6 项(标签)只在网络座位上有:1 = 标签与选的相同;数组 = 引擎的选择(与网络选的不同)。引擎座位上没有第 6 项。
 *     第 7 项 =1 表示标签本身会被强制(引擎想出的甩牌不成立 / 跟牌非法),训练时剔掉。回放只认前 3 项,与老格式兼容。 */
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

const sameT=(x,y)=>x.length===y.length&&x.every((v,i)=>v===y[i]);
function playGame(E,seed,NP){
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
  let netTeam=-1;
  if(NP){ netTeam=makeRng(seed*6151+7)()<0.5?0:1; rec.dg=netTeam;
    NP.reset(hands,buried,rec.ts,level,declSeat,seed*977+3); }
  let leader=declSeat, defPoints=0, lastWinner=declSeat, lastLeadSize=1, tricks=0;
  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4;
      const view={seat,hand:hands[seat],trump,declSeat,history:[...history,...plays],
                  buriedKnown:seat===declSeat?buried:[],curDecl};
      let cards, want, eg, nc, cho, labBad=0;
      const isNet=NP&&(seat&1)===netTeam;
      if(i===0){
        const r=E.aiChooseLead(view); want=r.cards; eg=r.eg?1:0; nc=(r.all||r.cands||[]).length;
        cho=isNet?NP.cards(seat,hands):want; cards=cho;
        if(isNet&&!E.checkThrow(hands,seat,want,trump).ok) labBad=1;
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced;
      }else{
        const lead=E.classify(plays[0].cards,trump);
        const r=E.aiChooseFollow(view,plays); want=r.cards; eg=r.eg?1:0; nc=(r.cands||[]).length;
        cho=isNet?NP.cards(seat,hands):want; cards=cho;
        if(isNet&&!E.isLegalFollow(hands[seat],lead,want,trump)) labBad=1;
        if(!E.isLegalFollow(hands[seat],lead,cards,trump)) cards=E.genFollow(hands[seat],lead,trump,rand);
      }
      const tw=ty(cho), ta=ty(cards), e=[seat,tw,tw.join()===ta.join()?null:ta,eg,nc];
      if(isNet){ const tl=ty(want); e.push(sameT(tl,tw)?1:tl); if(labBad) e.push(1); }
      rec.p.push(e);
      if(NP) NP.sync(cards,i===0);
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
    if(!fs.existsSync(path.join(a.out,`${a.dagger?'d':'s'}${s}_${n}.done`))) jobs.push([s,n]); }
  let running=0, done=0; const t0=Date.now(), tot=jobs.length;
  const next=()=>{ while(running<a.workers&&jobs.length){
    const [s,n]=jobs.shift(); running++;
    const p=cp.spawn(process.execPath,[__filename,`--seed0=${s}`,`--n=${n}`,`--out=${a.out}`,...(a.dagger?[`--dagger=${a.dagger}`]:[])],{stdio:['ignore','ignore','inherit']});
    p.on('exit',()=>{ running--; done++; if(done%5===0||done===tot) console.log(`${done}/${tot} 块, ${((Date.now()-t0)/1000).toFixed(0)}s`); next(); });
  } };
  console.log(`待跑 ${tot} 块`); next();
} else {
  const E=require('../ai2/sim.js').loadEngine();
  fs.mkdirSync(a.out,{recursive:true});
  const base=path.join(a.out,`${a.dagger?'d':'s'}${a.seed0}_${a.n}`);
  const NP=a.dagger?require('./netplay.js')(a.dagger):null;
  if(!fs.existsSync(base+'.done')){
    const lines=[]; let t0=Date.now(), fail=0;
    for(let s=a.seed0;s<a.seed0+a.n;s++){
      try{ lines.push(JSON.stringify(playGame(E,s,NP))); }catch(e){ fail++; console.error('seed',s,e.message); }
    }
    const ms=Date.now()-t0;
    fs.writeFileSync(base+'.jsonl.gz',zlib.gzipSync(lines.join('\n')+'\n'));
    fs.writeFileSync(base+'.done',JSON.stringify(NP?{games:lines.length,fail,ms,nnet:NP.nnet,nsync:NP.nsync}:{games:lines.length,fail,ms}));
    if(!a.quiet) console.log(`seed0=${a.seed0} games=${lines.length} fail=${fail} ${(ms/Math.max(1,lines.length)).toFixed(0)} ms/局`+(NP?` 网络手 ${NP.nnet} 内核同步不符 ${NP.nsync}`:''));
  }
}
