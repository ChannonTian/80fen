/* ShengJi+(开源的神经网络升级 AI)对我们的 AI —— 在**我们的**规则和发牌下,只比打牌阶段。
 *
 *   node test/sjplus/match.js --repo <shengji_plus 仓库> --ckpt <含 main.pt 的目录> --py <python>
 *        [--opp 80fen-test.html|engines/v0.5.7.js|random] [--opp-ov '{"egSearch":0}']
 *        [--sj model|random|<引擎文件>] [--sj-ov JSON]
 *        [--opp-nothrow]      ← 对照:对面领出甩牌时改出其中一组(ShengJi+ 的引擎判甩牌墩有毛病,它没学过我们这种甩牌)
 *        [--n 400] [--seed0 0] [--jobs 4] [--out 结果.jsonl] [--cap 500] [--dom ours|theirs] [--level 2]
 *        [--dump 决策.jsonl]   ← 给 selfcheck_tensor.py 用,每一手的局面 + 候选 + 实际出的牌
 *
 * 做法照 ai-h2h.js:裁判(发牌 / 合法性 / 结算)统一用 80fen-test.html;主、庄、底牌的定法一字不改;
 * 同一批种子、交换阵营、配对口径报 分/局 和 级/局 ± SE。和 ai-h2h 不同的只有两处:
 *   · 扣底两边都用裁判引擎的 aiDiscard(只比打牌);
 *   · 一边的两个座位换成 ShengJi+:候选由这里按我们的规则枚举,发给 Python 常驻进程(sj_server.py)打分,取最高。
 * 候选:领出 = 每张不同的单张、每个对子、每个拖拉机(含子段),**不给甩牌**;跟牌 = isLegalFollow 判合法的全部跟法,
 * 多于 --cap 时随机抽 cap 个(记录触发次数)。
 *
 * --sj <引擎文件> 时两边都是我们的引擎,等于 ai-h2h(用来核对这份循环没写歪);--sj random / --opp random 是「随机合法出牌」。
 * --out 断点续跑:已经在文件里的种子跳过。
 */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path'),cp=require('child_process'),readline=require('readline');
const ROOT=path.resolve(__dirname,'../..');
function loadHtml(f){const b=[...fs.readFileSync(f,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  const ctx={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};
  ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(b[0],ctx);return ctx.module.exports;}
function loadEngine(f){const ctx=vm.createContext({window:{}});vm.runInContext(fs.readFileSync(f,'utf8'),ctx,{filename:f});
  const all=ctx.window.__ENGINES||{}; return all[Object.keys(all)[0]];}
const load=f=>{ const p=path.isAbsolute(f)?f:path.join(ROOT,f); return f.endsWith('.js')?loadEngine(p):loadHtml(p); };
function parseArgs(argv){ const a={}; for(let i=2;i<argv.length;i++){ if(!argv[i].startsWith('--')) continue;
  const k=argv[i].slice(2); a[k]=(i+1<argv.length&&!argv[i+1].startsWith('--'))?argv[++i]:'1'; } return a; }
const A=parseArgs(process.argv);
const REF='80fen-test.html';
const E=load(REF);                                   // 裁判:规则、发牌、结算、扣底
if(A.level) E.RULES.levelStart=+A.level;
const CAP=+(A.cap||500), ENUM_MAX=20000;
const N=+(A.n||400), S0=+(A.seed0||0), JOBS=+(A.jobs||1);
const SJ=A.sj||'model', OPP=A.opp||REF;

/* ---------- 牌名、候选枚举 ---------- */
const code=c=>c.suit+c.rank;                          // 'S14' 黑桃A,'X15' 小王,'X16' 大王
const codes=cs=>cs.map(code);
function groups(cards){ const m=new Map(); for(const c of cards){ const k=code(c); if(!m.has(k)) m.set(k,[]); m.get(k).push(c); } return [...m.values()]; }
/* 领出候选:每张不同的单张、每个对子、每个拖拉机(含子段;同序号的副级牌对各算一条)。不含甩牌。 */
function leadCands(hand,trump){
  const g=groups(hand), out=[];
  for(const a of g) out.push([a[0]]);
  const pairs=g.filter(a=>a.length>=2).map(a=>[a[0],a[1]]);
  for(const p of pairs) out.push(p);
  const by={};
  for(const p of pairs){ const es=E.effSuit(p[0],trump); (by[es]=by[es]||[]).push(p); }
  for(const es in by){ const ps=by[es];
    const ext=chain=>{ const last=E.ordIdx(chain[chain.length-1][0],trump);
      for(const p of ps) if(E.ordIdx(p[0],trump)===last+1){ const c2=[...chain,p]; out.push(c2.flat()); ext(c2); } };
    for(const p of ps) ext([p]);
  }
  for(const c of out){ const cl=E.classify(c,trump);
    if(!cl||cl.type==='throw') throw new Error('领出候选不是单一牌型:'+codes(c)); }
  return out;
}
function countMultisets(gs,k){ let w=new Array(k+1).fill(0); w[0]=1;
  for(const g of gs){ const nw=new Array(k+1).fill(0);
    for(let i=0;i<=k;i++) if(w[i]) for(let j=0;j<=g.length&&i+j<=k;j++) nw[i+j]+=w[i];
    w=nw; }
  return w[k]; }
function* enumMultisets(gs,k,i,acc,room){
  if(k===0){ yield acc.slice(); return; }
  if(i>=gs.length||room[i]<k) return;
  for(let j=Math.min(gs[i].length,k);j>=0;j--){
    for(let t=0;t<j;t++) acc.push(gs[i][t]);
    yield* enumMultisets(gs,k-j,i+1,acc,room);
    acc.length-=j;
  }
}
function shuffled(arr,rand){ const a=arr.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(rand()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
const ST={dec:0,lead:0,follow:0,cands:0,maxCands:0,capHit:0,enumSampled:0,noCand:0,oppErr:0,oppFallback:0,single:0,oppThrows:0};
/* 跟牌候选:所有合法跟法(同点同花色的两张不分先后,按张数去重)。 */
function followCands(hand,lead,trump,rand){
  const n=lead.cards.length;
  const inSuit=hand.filter(c=>E.effSuit(c,trump)===lead.suit), rest=hand.filter(c=>E.effSuit(c,trump)!==lead.suit);
  const fixed=inSuit.length<=n?inSuit:[], pool=inSuit.length<=n?rest:inSuit, k=n-fixed.length;
  const gs=groups(pool); let out=[];
  if(countMultisets(gs,k)<=ENUM_MAX){
    const room=new Array(gs.length+1).fill(0); for(let i=gs.length-1;i>=0;i--) room[i]=room[i+1]+gs[i].length;
    for(const m of enumMultisets(gs,k,0,[],room)){ const cand=[...fixed,...m]; if(E.isLegalFollow(hand,lead,cand,trump)) out.push(cand); }
  }else{                                              // 组合数太大(大甩牌 + 缺门):不枚举,直接随机抽
    ST.enumSampled++; const seen=new Set();
    for(let tries=0; out.length<CAP && tries<CAP*40; tries++){
      const m=shuffled(pool,rand).slice(0,k), sig=codes(m).sort().join();
      if(seen.has(sig)) continue; seen.add(sig);
      const cand=[...fixed,...m]; if(E.isLegalFollow(hand,lead,cand,trump)) out.push(cand);
    }
  }
  if(!out.length){ ST.noCand++; out=[E.genFollow(hand,lead,trump,rand)]; }
  if(out.length>CAP){ ST.capHit++; out=shuffled(out,rand).slice(0,CAP); }
  return out;
}

/* ---------- Python 常驻进程 ---------- */
class Bridge{
  constructor(){
    if(!A.repo||!A.ckpt) throw new Error('--sj model 需要 --repo <shengji_plus 仓库> 和 --ckpt <含 main.pt 的目录>');
    const py=A.py||process.env.SJ_PY||'python3';
    this.p=cp.spawn(py,['-I',path.join(__dirname,'sj_server.py'),'--repo',A.repo,'--ckpt',A.ckpt,'--dom',A.dom||'ours'],
      {stdio:['pipe','pipe','inherit']});
    this.q=[]; this.dead=null;
    readline.createInterface({input:this.p.stdout}).on('line',l=>{ const w=this.q.shift(); if(w) w.res(JSON.parse(l)); });
    this.p.on('exit',c=>{ this.dead='sj_server 退出,代码 '+c; for(const w of this.q) w.rej(new Error(this.dead)); this.q=[]; });
    this.ready=new Promise((res,rej)=>this.q.push({res,rej}));
  }
  ask(msg){ if(this.dead) return Promise.reject(new Error(this.dead));
    return new Promise((res,rej)=>{ this.q.push({res,rej}); this.p.stdin.write(JSON.stringify(msg)+'\n'); }); }
  close(){ try{ this.p.stdin.end(); }catch(e){} }
}

/* ---------- 三种出牌者 ---------- */
function engineAgent(file,ov){ const m=load(file); if(ov) Object.assign(m.AIP,JSON.parse(ov));
  const ref=load(REF);                                // 老引擎抛错 / 出了不在手里的牌时的替补(照 ai-pool)
  const own=(cards,hand)=>cards&&cards.length&&cards.every(c=>hand.includes(c));
  return {name:path.basename(file)+(ov?' '+ov:''),
    lead(view){ let cards=null; try{ cards=m.aiChooseLead(view).cards; }catch(e){ ST.oppErr++; }
      if(!own(cards,view.hand)){ ST.oppFallback++; cards=ref.aiChooseLead(view).cards; } return cards; },
    follow(view,plays){ let cards=null; try{ cards=m.aiChooseFollow(view,plays).cards; }catch(e){ ST.oppErr++; }
      if(!cards||!cards.every(c=>view.hand.includes(c))){ ST.oppFallback++; cards=[]; } return cards; } };
}
function randomAgent(){ return {name:'随机合法出牌', pick(cands,g){ return Math.floor(g.rand2()*cands.length); }}; }
function modelAgent(){ const br=new Bridge(); let id=0;
  return {name:'ShengJi+', br,
    async pick(cands,g,msg){ if(cands.length===1) return 0;
      const r=await br.ask({...msg,id:++id}); if(r.error) throw new Error('sj_server: '+r.error+'\n'+JSON.stringify(msg)); return r.best; } };
}
const mk=(spec,ov)=>spec==='model'?modelAgent():spec==='random'?randomAgent():engineAgent(spec,ov);

/* ---------- 一副牌 ---------- */
let dumpFd=null;
const dump=o=>{ if(dumpFd!==null) fs.writeSync(dumpFd,JSON.stringify(o)+'\n'); };
async function playRound(seed, sjTeam, agents){
  const agentOf=seat=>seat%2===sjTeam?agents.sj:agents.opp;
  const {first}=E.cutForFirst(seed);
  const {hands,kitty}=E.dealRound(seed,first);
  let best=null, declSeat=-1;
  for(let s=0;s<4;s++){
    const o=E.declOptions(hands[s],E.RULES.levelStart)[0];
    if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}
  }
  const rand=E.rng(seed^0x9e3779b9);                  // 和 ai-h2h 同一条随机流(王对反无主、非法跟牌兜底)
  const rand2=E.rng(((seed^0x51ed270b)>>>0)+7919*sjTeam);   // 另一条:随机出牌者、候选抽样
  let trump;
  if(!best){trump={suit:null,rank:E.RULES.levelStart};declSeat=first;}
  else{
    trump={suit:best.suit,rank:E.RULES.levelStart};
    for(let s=0;s<4;s++){
      if(s!==declSeat&&E.jokerPairOf(hands[s])&&rand()<0.3){
        trump={suit:null,rank:E.RULES.levelStart};declSeat=s;break;}
    }
  }
  const curDecl=!best?null:{seat:declSeat,suit:trump.suit,
    strength:trump.suit?best.strength:(E.jokerPairOf(hands[declSeat])||{strength:3}).strength};
  /* 给 ShengJi+ 的亮主信息:没人亮 → null(它那边也是「没人亮 = 无主」);花色主 → 单张 0 / 一对 1;王对 → 小王对 2 / 大王对 3 */
  const decl=!curDecl?null:trump.suit?{seat:declSeat,suit:trump.suit,level:curDecl.strength>=2?1:0}
    :{seat:declSeat,suit:curDecl.strength>=4?'DJ':'XJ',level:curDecl.strength>=4?3:2};
  hands[declSeat].push(...kitty);
  const buried=E.aiDiscard(hands[declSeat],trump);    // 扣底两边都用裁判引擎的
  buried.forEach(c=>E.removeCard(hands[declSeat],c));
  dump({t:'game',seed,sjTeam,level:trump.rank,trump:trump.suit,decl,dealer:declSeat,hands:hands.map(codes),kitty:codes(buried)});
  const declTeam=declSeat%2, history=[], done=[];
  const g={rand2};
  let leader=declSeat, defPoints=0, lastWinner=declSeat, lastLeadSize=1, tricks=0;
  while(hands.some(h=>h.length)){
    const plays=[]; let shown=null;                  // shown:甩牌失败时亮出来又收回去的那几张(别家都看见了)
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, ag=agentOf(seat), hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],
                  buriedKnown:seat===declSeat?buried:[],curDecl};
      const lead=i?E.classify(plays[0].cards,trump):null;
      let cards, chosen, msg=null;
      if(ag.pick||dumpFd!==null){
        const cands=i?followCands(hand,lead,trump,rand2):leadCands(hand,trump);
        msg={level:trump.rank,trump:trump.suit,decl,dealer:declSeat,me:seat,hand:codes(hand),
          kitty:seat===declSeat?codes(buried):null,att:defPoints,
          tricks:[...done,{leader,plays:plays.map(p=>codes(p.cards)),...(shown?{shown}:{})}],
          cands:cands.map(codes),
          wins:cands.map(c=>E.resolveTrick([...plays,{seat,cards:c}],trump).winner===seat?1:0)};
        if(ag.pick){
          if(seat%2===sjTeam){ ST.dec++; i?ST.follow++:ST.lead++; ST.cands+=cands.length; if(cands.length>ST.maxCands) ST.maxCands=cands.length;
            if(cands.length===1) ST.single++; }
          chosen=cands[await ag.pick(cands,g,msg)];
        }
      }
      if(!ag.pick) chosen=i?ag.follow(view,plays):ag.lead(view);
      if(i===0&&seat%2!==sjTeam){ const cl=E.classify(chosen,trump);
        if(cl&&cl.type==='throw'){ ST.oppThrows++;
          if(A['opp-nothrow']){                         // 对照:对面不许甩牌,改出其中张数最多、同张数里最大的那一组
            chosen=cl.comps.slice().sort((a,b)=>b.cards.length-a.cards.length||b.top-a.top)[0].cards; } } }
      cards=chosen;
      if(i===0){ const chk=E.checkThrow(hands,seat,cards,trump);
        if(!chk.ok){ cards=chk.forced; const f=new Set(cards.map(c=>c.id)); shown=codes(chosen.filter(c=>!f.has(c.id))); } }
      else if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand);
      if(msg) dump({t:'dec',msg,chosen:codes(chosen),played:codes(cards)});
      cards.forEach(c=>E.removeCard(hand,c));
      plays.push({seat,cards});
    }
    history.push(...plays);
    lastLeadSize=plays[0].cards.length;
    const res=E.resolveTrick(plays,trump);
    done.push({leader,plays:plays.map(p=>codes(p.cards)),w:res.winner,...(shown?{shown}:{})});
    leader=res.winner; lastWinner=res.winner; tricks++;
    if(res.winner%2!==declTeam) defPoints+=res.points;
    dump({t:'trick',w:res.winner,att:defPoints});
    if(tricks>60) break;
  }
  const sc=E.scoreRound({defPoints,kitty:buried,defWonLastTrick:lastWinner%2!==declTeam,lastLeadSize});
  dump({t:'end',total:sc.total});
  return {...sc, declTeam, defWonLast:lastWinner%2!==declTeam, defPoints, lastLeadSize};
}

/* ---------- 汇总(口径照 ai-h2h) ---------- */
function netLv(r,team){ const defUp=r.defendersWin?1+(r.defenderLevelsUp||0):0, decUp=r.defendersWin?0:(r.declarerLevelsUp||0);
  return r.declTeam===team?decUp-defUp:defUp-decUp; }
const mean=a=>a.reduce((x,y)=>x+y,0)/(a.length||1);
const sem=a=>{ const m=mean(a); return Math.sqrt(a.reduce((x,y)=>x+(y-m)*(y-m),0)/(a.length||1))/Math.sqrt(a.length||1); };
function summarize(recs,title,stats){
  const D=[],L=[]; let games=0, sjHold=0,sjDecl=0,opHold=0,opDecl=0, sjAtt=[],opAtt=[], sjWin=0;
  for(const rec of recs){ if(!rec.r||rec.r.length!==2||rec.r.some(x=>!x)) continue;
    const d=[],l=[];
    rec.r.forEach((r,t)=>{ games++;
      const sjPts=r.declTeam===t?200-r.total:r.total; d.push(sjPts-(200-sjPts)); l.push(netLv(r,t));
      if(r.declTeam===t){ sjDecl++; if(!r.defendersWin){sjHold++;sjWin++;} opAtt.push(r.total); }
      else{ opDecl++; if(!r.defendersWin) opHold++; else sjWin++; sjAtt.push(r.total); } });
    D.push((d[0]+d[1])/2); L.push((l[0]+l[1])/2);
  }
  const nz=D.filter(x=>x!==0), pos=nz.filter(x=>x>0).length;
  const o=[];
  o.push(`${title}`);
  o.push(`  ${games} 副(${D.length} 种子 × 交换阵营),配对口径`);
  o.push(`  前者净胜 ${(mean(D)/2).toFixed(2)} ± ${(sem(D)/2).toFixed(2)} 分/局   净升 ${(mean(L)/2>=0?'+':'')+(mean(L)/2).toFixed(3)} ± ${(sem(L)/2).toFixed(3)} 级/局   (负 = 对面更强)`);
  o.push(`  前者赢的副数 ${sjWin}/${games}(${(100*sjWin/games).toFixed(1)}%);种子上分数占优 ${pos}/${nz.length}`);
  o.push(`  坐庄守住:前者 ${sjHold}/${sjDecl}(${(100*sjHold/(sjDecl||1)).toFixed(1)}%)  对面 ${opHold}/${opDecl}(${(100*opHold/(opDecl||1)).toFixed(1)}%)`);
  o.push(`  当闲家平均抓分:前者 ${mean(sjAtt).toFixed(1)}  对面 ${mean(opAtt).toFixed(1)}`);
  if(stats&&stats.dec) o.push(`  前者 ${stats.dec} 次决策(领出 ${stats.lead} / 跟牌 ${stats.follow}),其中只有一个候选 ${stats.single};平均候选 ${(stats.cands/stats.dec).toFixed(1)}、最多 ${stats.maxCands};`
    +`候选超上限 ${CAP} 被抽样 ${stats.capHit} 次、组合数过大改抽样 ${stats.enumSampled} 次、枚举不出合法跟法 ${stats.noCand} 次`);
  if(stats&&stats.py) o.push(`  模型端:${stats.py.decisions} 次打分,每次编码 ${stats.py.encMs.toFixed(1)} ms + 前向 ${stats.py.fwdMs.toFixed(1)} ms;`
    +`「是否暂时最大」两套裁判判得不同的候选 ${stats.py.domMismatch}/${stats.py.cands}`);
  if(stats) o.push(`  对面领出甩牌 ${stats.oppThrows||0} 次`+(A['opp-nothrow']?'(本次对照里都被换成了其中最大的一组,不许甩)':''));
  if(stats&&(stats.oppErr||stats.oppFallback)) o.push(`  对面引擎抛错 ${stats.oppErr} 次、出牌不在手里改用替补 ${stats.oppFallback} 次`);
  return {text:o.join('\n'), pts:mean(D)/2, ptsSE:sem(D)/2, lv:mean(L)/2, lvSE:sem(L)/2, seeds:D.length, games, sjWin};
}
function title(){ return `[${SJ==='model'?'ShengJi+':SJ==='random'?'随机合法出牌':SJ+(A['sj-ov']?' '+A['sj-ov']:'')}] 对 [${OPP==='random'?'随机合法出牌':OPP+(A['opp-ov']?' '+A['opp-ov']:'')}]`
  +(A['opp-nothrow']?'(对面不许甩牌)':'')+(A.level?`  级牌 ${A.level}`:'')+(S0?`  种子自 ${S0+1} 起`:''); }
function readOut(){ const m=new Map(); if(A.out&&fs.existsSync(A.out)) for(const l of fs.readFileSync(A.out,'utf8').split('\n')){
  if(!l.trim()) continue; try{ const r=JSON.parse(l); if(r.seed!==undefined) m.set(r.seed,r); }catch(e){} } return m; }

/* ---------- 主流程:--jobs>1 时把种子分给子进程 ---------- */
async function worker(seeds){
  const agents={sj:mk(SJ,A['sj-ov']), opp:mk(OPP,A['opp-ov'])};
  for(const a of [agents.sj,agents.opp]) if(a.br){ const info=await a.br.ready; if(!info.ready) throw new Error('sj_server 没起来'); }
  if(A.dump) dumpFd=fs.openSync(A.dump,'w');
  const recs=[];
  for(const s of seeds){ const rec={seed:s,r:[]};
    for(const t of [0,1]) rec.r.push(await playRound(s,t,agents));
    recs.push(rec);
    if(process.send) process.send({rec}); else if(A.out) fs.appendFileSync(A.out,JSON.stringify(rec)+'\n');
    if(!process.send&&recs.length%20===0) process.stderr.write(`  ${recs.length}/${seeds.length} 种子\n`);
  }
  const stats={...ST};
  for(const a of [agents.sj,agents.opp]) if(a.br){ stats.py=await a.br.ask({cmd:'stats'}); a.br.close(); }
  if(dumpFd!==null) fs.closeSync(dumpFd);
  if(process.send) process.send({stats});
  return {recs,stats};
}
function addStats(a,b){ if(!a) return b; const o={...a};
  for(const k in b){ if(k==='py'){ if(!o.py) o.py=b.py; else{ const x=o.py,y=b.py,n=x.decisions+y.decisions||1;
        o.py={decisions:x.decisions+y.decisions,cands:x.cands+y.cands,domMismatch:x.domMismatch+y.domMismatch,
          encMs:(x.encMs*x.decisions+y.encMs*y.decisions)/n,fwdMs:(x.fwdMs*x.decisions+y.fwdMs*y.decisions)/n}; } }
    else if(k==='maxCands') o[k]=Math.max(a[k]||0,b[k]); else o[k]=(a[k]||0)+b[k]; }
  return o; }
async function main(){
  if(process.send){ await worker(JSON.parse(process.env.SJ_SEEDS)); return; }
  const have=readOut(); const todo=[]; for(let s=S0+1;s<=S0+N;s++) if(!have.has(s)) todo.push(s);
  if(have.size) process.stderr.write(`  ${A.out} 里已有 ${have.size} 个种子,这次补 ${todo.length} 个\n`);
  const t0=Date.now(); let stats=null;
  if(JOBS<=1||A.dump||todo.length<JOBS){ const r=await worker(todo); stats=r.stats; for(const rec of r.recs) have.set(rec.seed,rec); }
  else{
    let doneN=0;
    await Promise.all([...Array(JOBS).keys()].map(k=>new Promise((res,rej)=>{
      const seeds=todo.filter((_,i)=>i%JOBS===k);
      const ch=cp.fork(__filename,process.argv.slice(2),{env:{...process.env,SJ_SEEDS:JSON.stringify(seeds)}});
      ch.on('message',m=>{ if(m.rec){ have.set(m.rec.seed,m.rec); if(A.out) fs.appendFileSync(A.out,JSON.stringify(m.rec)+'\n');
          if(++doneN%20===0) process.stderr.write(`  ${doneN}/${todo.length} 种子,${((Date.now()-t0)/1000).toFixed(0)} 秒\n`); }
        if(m.stats) stats=addStats(stats,m.stats); });
      ch.on('exit',c=>c?rej(new Error('子进程退出,代码 '+c)):res());
    })));
  }
  const recs=[]; for(let s=S0+1;s<=S0+N;s++) if(have.has(s)) recs.push(have.get(s));
  const sum=summarize(recs,title(),stats);
  console.log(sum.text);
  console.log(`  用时 ${((Date.now()-t0)/1000).toFixed(0)} 秒(${JOBS} 个进程)`);
  if(A.json) fs.writeFileSync(A.json,JSON.stringify({title:title(),args:A,...sum,stats},null,1));
}
main().catch(e=>{ console.error(e.stack||e); process.exit(1); });
