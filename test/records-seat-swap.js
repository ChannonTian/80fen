/* 真人 vs 坐在真人位置上的 AI —— 同一副牌上,真人比 AI 强还是弱(真人水平锚点)。
 *
 *   node test/records-seat-swap.js <牌谱.jsonl>... [--out=结果.json] [--workers=3] [--cache=目录]
 *        [--minfid=0.9] [--limit=N] [--only=idprefix] [--autoshare=0.2]
 *   node test/records-seat-swap.js --selftest [--n=6] [--cache=目录]
 *
 * 对每一局「有效、打完、非测试局、非重打」的真人牌谱,从扣底后第一墩起(主 / 庄家 / 底牌照记录,只比较出牌):
 *   ACTUAL     记录里的真实结果(人那一队的视角);
 *   SWAP-SAME  四家全由「记录当时那一版」AI 打到底(收官搜索照界面开着);
 *   SWAP-NEW   人那一座换成当前 80fen-test.html,另三家仍是记录那一版;
 *   PHASE-18/12/6  照记录原样放到人手里还剩 18/12/6 张,再按 SWAP-SAME 接着打(定位差距出在哪个阶段)。
 *   FIDELITY   先验:记录当时版本的引擎,在记录里每个 AI 座位的真实局面上选的牌,和记录里 AI 实际出的是否一致。
 *              一致率低 = 版本对不上 / 引擎对同一局面不确定,那一版的 SWAP-SAME 量的是别的东西 → 标出,低于 --minfid 的版本排除。
 *
 * 指标(与 ai-h2h.js 同口径,人那一队视角):
 *   pts = 人这一队本局得分 − 100(= 两队分差 / 2;庄家方得 200−total,闲家方得 total);
 *   lv  = (本队净升级 − 对方净升级) / 2(闲家赢:上台记 1 再加台阶;庄家守住:2 / 3 / 1 级,同 ai-h2h 的 netLv)。
 *   这里的 lv 是**单局**级数(不含关卡 / 速通),不是整场进度。
 * 报告:HUMAN − AI 的逐局配对差,均值 / 配对 SE / t,以及样本量。
 *
 * 版本 → 引擎:记录 version 里的 vX.Y.Z,在 git 历史里找 80fen-test.html 带这个标记的提交,抽块①(引擎 + AI)。
 * 同一版号有几个块①内容不同的候选时,每局取保真率最高的那个。
 * 裁判(发牌 / 合法性 / 结算)一律用当前版 —— records-check 就是用它验的。
 */
'use strict';
const fs=require('fs'), vm=require('vm'), path=require('path'), os=require('os');
const {execFileSync, fork}=require('child_process');
const crypto=require('crypto');
const ROOT=path.join(__dirname,'..');
const argv=process.argv.slice(2);
const opt=(k,d)=>{ const a=argv.find(x=>x.startsWith('--'+k+'=')); return a?a.slice(k.length+3):d; };
const HTML=path.join(ROOT,'80fen-test.html');
const CACHE=opt('cache',path.join(os.tmpdir(),'80fen-seat-swap-cache'));

/* ---------------- 引擎装载 ---------------- */
function blockOf(html){ return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1]; }
function loadSrc(src){
  const ctx={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};
  ctx.globalThis=ctx; vm.createContext(ctx); vm.runInContext(src,ctx); return ctx.module.exports;
}
/* 版号 → [{commit, hash}](hash = 块①内容的 sha1 前 12 位;块①相同的提交只留最新的) */
function buildIndex(){
  fs.mkdirSync(CACHE,{recursive:true});
  const idxf=path.join(CACHE,'index.json');
  const head=execFileSync('git',['log','-1','--format=%H','--','80fen-test.html'],{cwd:ROOT,encoding:'utf8'}).trim();
  if(fs.existsSync(idxf)){ const j=JSON.parse(fs.readFileSync(idxf,'utf8')); if(j.head===head) return j.byTag; }
  const commits=execFileSync('git',['log','--format=%H','--','80fen-test.html'],{cwd:ROOT,encoding:'utf8'}).trim().split('\n');
  const byTag={};
  for(const c of commits){
    const html=execFileSync('git',['show',`${c}:80fen-test.html`],{cwd:ROOT,encoding:'utf8',maxBuffer:128<<20});
    const tag=((html.match(/id="versionTag">[^<]*?(v\d+\.\d+\.\d+)/)||[])[1]);
    if(!tag) continue;
    const blk=blockOf(html), hash=crypto.createHash('sha1').update(blk).digest('hex').slice(0,12);
    fs.writeFileSync(path.join(CACHE,hash+'.js'),blk);
    const arr=byTag[tag]||(byTag[tag]=[]);
    if(!arr.some(x=>x.hash===hash)) arr.push({commit:c.slice(0,7),hash});
  }
  fs.writeFileSync(idxf,JSON.stringify({head,byTag}));
  return byTag;
}
const ENG={};   // hash → engine
function engineByHash(h){ return ENG[h]||(ENG[h]=loadSrc(fs.readFileSync(path.join(CACHE,h+'.js'),'utf8'))); }
let CUR=null;
function getCur(){ return CUR||(CUR=loadSrc(blockOf(fs.readFileSync(HTML,'utf8')))); }
const tagOf=v=>((String(v).match(/v\d+\.\d+\.\d+/)||[])[0]||'?');

/* ---------------- 牌谱校验(照搬 records-check.js 的 verify,规则一致) ---------------- */
const code=c=>c.suit+c.rank;
const sortKey=a=>a.slice().sort().join(',');
function verify(E,r){
  if(r.partial&&r.initialHands==null) return Array.isArray(r.tricks)&&!r.tricks.length?'':'残局没开打却有出牌';
  if(!Array.isArray(r.initialHands)||r.initialHands.length!==4||!Array.isArray(r.tricks)) return '缺手牌或出牌记录';
  if(r.seed!=null&&r.firstTaker!=null){
    const seed=parseInt(String(r.seed),10), d=E.dealRound(seed,r.firstTaker);
    for(let s=0;s<4;s++){
      const got=s===r.declSeat?r.initialHands[s].concat(r.buried):r.initialHands[s];
      const want=s===r.declSeat?d.hands[s].map(code).concat(d.kitty.map(code)):d.hands[s].map(code);
      if(sortKey(got)!==sortKey(want)) return `发牌对不上种子(座位 ${s})`;
    }
    if(r.kitty&&sortKey(r.kitty)!==sortKey(d.kitty.map(code))) return '原底牌对不上种子';
  }
  let uid=0;
  const hands=r.initialHands.map(h=>h.map(x=>({suit:x[0],rank:+x.slice(1),id:'c'+(uid++)})));
  const trump=r.trump; let def=0, lastWin=-1, leader=r.declSeat;
  for(let ti=0;ti<r.tricks.length;ti++){
    const t=r.tricks[ti], plays=[];
    if(t.plays.length!==4) return `第 ${ti+1} 墩不是四家`;
    if(t.plays[0].seat!==leader) return `第 ${ti+1} 墩领出的人不对`;
    for(let i=0;i<4;i++){
      const p=t.plays[i];
      if(p.seat!==(leader+i)%4) return `第 ${ti+1} 墩出牌顺序不对`;
      const h=hands[p.seat], before=h.slice(), cards=[];
      for(const x of p.cards){ const k=h.findIndex(y=>code(y)===x); if(k<0) return `第 ${ti+1} 墩座位 ${p.seat} 手里没有 ${x}`; cards.push(h.splice(k,1)[0]); }
      if(i===0){
        const cl=E.classify(cards,trump);
        if(!cl) return `第 ${ti+1} 墩领出不成牌型`;
        if(cl.type==='throw'){
          const hs=hands.map((x,s)=>s===p.seat?before:x);
          if(!E.checkThrow(hs,p.seat,cards,trump).ok) return `第 ${ti+1} 墩甩牌不成立`;
        }
      }else{
        const lead=E.classify(plays[0].cards,trump);
        if(!E.isLegalFollow(before,lead,cards,trump)) return `第 ${ti+1} 墩座位 ${p.seat} 跟牌不合法`;
      }
      plays.push({seat:p.seat,cards});
    }
    const res=E.resolveTrick(plays,trump);
    if(res.winner!==t.winner) return `第 ${ti+1} 墩赢家不对`;
    if(res.points!==t.points) return `第 ${ti+1} 墩分数不对`;
    if(res.winner%2!==r.declSeat%2) def+=res.points;
    leader=lastWin=res.winner;
  }
  if(r.partial) return '';
  if(hands.some(h=>h.length)) return '打完还有牌没出';
  if(r.defPoints!=null){
    const kitty=lastWin%2!==r.declSeat%2?(r.kittyPts||0)*(r.mult||0):0;
    if(def+kitty!==r.defPoints) return `闲家得分对不上(重算 ${def}+${kitty},记录 ${r.defPoints})`;
  }
  return '';
}

/* ---------------- 局面 / 决策 ---------------- */
const mkCard=(x,id)=>({suit:x[0],rank:+x.slice(1),id});
function stateOf(r, cutTricks){
  // 从记录的扣底后手牌出发,照记录放 cutTricks 墩,返回可继续打的局面
  let uid=0;
  const hands=r.initialHands.map(h=>h.map(x=>mkCard(x,'c'+(uid++))));
  const buried=r.buried.map(x=>mkCard(x,'b'+(uid++)));
  const history=[]; let leader=r.declSeat, defPts=0, lastWinner=r.declSeat, lastLeadSize=1;
  const R=getCur();
  for(let ti=0;ti<cutTricks;ti++){
    const t=r.tricks[ti], plays=[];
    for(const p of t.plays){
      const cards=[]; for(const x of p.cards){ const k=hands[p.seat].findIndex(y=>code(y)===x); cards.push(hands[p.seat].splice(k,1)[0]); }
      plays.push({seat:p.seat,cards});
    }
    history.push(...plays);
    const res=R.resolveTrick(plays,r.trump);
    if(res.winner%2!==r.declSeat%2) defPts+=res.points;
    leader=lastWinner=res.winner; lastLeadSize=plays[0].cards.length;
  }
  return {hands,buried,history,leader,defPts,lastWinner,lastLeadSize};
}
const declLogOf=r=>Array.isArray(r.decl)?r.decl:[];
function mkView(r,seat,st,plays){
  const log=declLogOf(r), last=log.length?log[log.length-1]:null;
  return {seat,hand:st.hands[seat],trump:r.trump,declSeat:r.declSeat,
    history:[...st.history,...plays],buriedKnown:seat===r.declSeat?st.buried:[],
    decl:last?{seat:last.seat,suit:last.suit,strength:last.strength}:null,declLog:log,humanSeat:r.human};
}
/* 和界面一样的出牌调度:引擎给牌,不合法就换成 genFollow / checkThrow 的兜底 */
function decide(eng, r, st, seat, plays){
  const R=getCur(), hand=st.hands[seat], view=mkView(r,seat,st,plays);
  let cards;
  if(!plays.length){
    cards=eng.aiChooseLead(view).cards;
    const chk=R.checkThrow(st.hands,seat,cards,r.trump); if(!chk.ok) cards=chk.forced;
  }else{
    const lead=R.classify(plays[0].cards,r.trump);
    cards=eng.aiChooseFollow(view,plays).cards;
    if(!R.isLegalFollow(hand,lead,cards,r.trump)) cards=R.genFollow(hand,lead,r.trump,R.rng(1));
  }
  return cards.map(c=>hand.find(x=>x.id===c.id)||c);
}
/* 从 st 接着打到底,engOf(seat) 给每个座位的引擎;返回单局结果 */
function playOut(r, st, engOf){
  const R=getCur(), T=r.trump, D=r.declSeat;
  let {leader,defPts,lastWinner,lastLeadSize}=st;
  while(st.hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, cards=decide(engOf(seat),r,st,seat,plays);
      cards.forEach(c=>R.removeCard(st.hands[seat],c));
      plays.push({seat,cards});
    }
    st.history.push(...plays);
    const res=R.resolveTrick(plays,T);
    if(res.winner%2!==D%2) defPts+=res.points;
    leader=lastWinner=res.winner; lastLeadSize=plays[0].cards.length;
  }
  return result(r,defPts,st.buried,lastWinner,lastLeadSize);
}
function result(r, defPoints, buried, lastWinner, lastLeadSize){
  const R=getCur(), D=r.declSeat;
  const sc=R.scoreRound({defPoints,kitty:buried,defWonLastTrick:lastWinner%2!==D%2,lastLeadSize});
  const team=r.human%2, declTeam=D%2;
  const pts=(declTeam===team)?200-sc.total:sc.total;                 // 人这一队本局得分
  const defUp=sc.defendersWin?1+(sc.defenderLevelsUp||0):0, decUp=sc.defendersWin?0:(sc.declarerLevelsUp||0);
  const mine=declTeam===team?decUp:defUp, theirs=declTeam===team?defUp:decUp;
  return {pts:pts-100, lv:(mine-theirs)/2, total:sc.total};
}

/* ---------------- 单局全部变体 ---------------- */
function applyRules(r){
  const saved=[];
  for(const E of [getCur(),...Object.values(ENG)]){
    const o={}; for(const k of ['strictTractorFollow','partialTractorFollow']) if(E.RULES&&k in E.RULES&&k in (r.rules||{})){ o[k]=E.RULES[k]; E.RULES[k]=r.rules[k]; }
    saved.push([E,o]);
  }
  return ()=>{ for(const [E,o] of saved) Object.assign(E.RULES,o); };
}
/* 人手里还剩 ≤k 张时的第一个墩边界(一墩可能出多张,墩数不等于张数) */
function cutFor(r,k){
  let left=r.initialHands[r.human].length;
  for(let t=0;t<=r.tricks.length;t++){
    if(left<=k) return t;
    if(t<r.tricks.length) left-=r.tricks[t].plays.find(p=>p.seat===r.human).cards.length;
  }
  return r.tricks.length;
}
function fidelity(eng, r){
  // 记录里每个 AI 座位的决策,在记录当时的真实局面上让引擎重选
  let n=0,m=0,nl=0,ml=0; const st=stateOf(r,0);
  for(const t of r.tricks){
    const plays=[];
    for(const p of t.plays){
      if(p.seat!==r.human){
        let ok=false; try{
          const cards=decide(eng,r,st,p.seat,plays);
          ok=sortKey(cards.map(code))===sortKey(p.cards);
        }catch(e){ ok=false; }
        n++; if(ok) m++; if(!plays.length){ nl++; if(ok) ml++; }
      }
      const cards=[]; for(const x of p.cards){ const k=st.hands[p.seat].findIndex(y=>code(y)===x); cards.push(st.hands[p.seat].splice(k,1)[0]); }
      plays.push({seat:p.seat,cards});
    }
    st.history.push(...plays);
  }
  return {n,m,nl,ml};
}
function humanShare(r){
  let h=0,a=0,f=0,hint=0;
  for(const t of r.tricks) for(const p of t.plays) if(p.seat===r.human){ const w=p.by||'h'; if(w==='a')a++; else if(w==='f')f++; else { h++; if(p.hint)hint++; } }
  const tot=h+a; return {h,a,f,hint,share:tot?(a+hint)/tot:0};
}
function processRecord(r, byTag, selftest){
  const t0=Date.now(), R=getCur();
  const tag=selftest?'SELF':tagOf(r.version);
  const cands=selftest?[{hash:'__cur__'}]:(byTag[tag]||[]);
  if(!cands.length) return {id:r.id,err:'无对应版本的引擎('+tag+')'};
  const getE=h=>h==='__cur__'?R:engineByHash(h);
  cands.forEach(c=>getE(c.hash));          // 先把候选全装好,再套本局规则
  const restore=applyRules(r);
  try{
    let best=null;
    for(const c of cands){
      const f=fidelity(getE(c.hash),r);
      if(!best||f.m>best.f.m) best={c,f};
    }
    const V=getE(best.c.hash);
    const out={id:r.id,tag,engine:best.c.hash,ncand:cands.length,fid:best.f};
    const sa=stateOf(r,r.tricks.length);
    out.actual=result(r,sa.defPts,sa.buried,sa.lastWinner,sa.lastLeadSize);
    out.same=playOut(r,stateOf(r,0),()=>V);
    out.new=playOut(r,stateOf(r,0),s=>s===r.human?R:V);
    for(const k of [18,12,6]) out['p'+k]=playOut(r,stateOf(r,cutFor(r,k)),()=>V);
    out.ms=Date.now()-t0;
    return out;
  }finally{ restore(); }
}

/* ---------------- 工人进程 ---------------- */
if(process.env.SEATSWAP_WORKER){
  const selftest=process.env.SEATSWAP_WORKER==='self';
  const byTag=selftest?{}:buildIndex();
  process.on('message',m=>{
    if(m.stop) process.exit(0);
    let out; try{ out=processRecord(m.r,byTag,selftest); }catch(e){ out={id:m.r.id,err:'引擎出错:'+(e.stack||e.message).split('\n').slice(0,2).join(' | ')}; }
    process.send({res:out});
  });
  process.send({ready:1});
}else{

/* ---------------- 统计 ---------------- */
function pairStat(xs){
  const n=xs.length; if(!n) return {n:0};
  const m=xs.reduce((a,x)=>a+x,0)/n;
  const sd=n>1?Math.sqrt(xs.reduce((a,x)=>a+(x-m)*(x-m),0)/(n-1)):0, se=sd/Math.sqrt(n);
  return {n,mean:m,se,t:se>0?m/se:(m===0?0:Infinity)};
}
const f2=(x,d=2)=>(x>=0?'+':'')+x.toFixed(d);
function fmt(s,d){ return s.n?`${f2(s.mean,d)} ±${s.se.toFixed(d)} t=${Number.isFinite(s.t)?s.t.toFixed(1):'inf'}`:'—'; }
const VARS=[['SWAP-SAME','same'],['SWAP-NEW','new'],['PHASE-18','p18'],['PHASE-12','p12'],['PHASE-6','p6']];
function table(rows, title){
  console.log(`\n${title}  (n=${rows.length})`);
  console.log('  HUMAN−AI        '+VARS.map(v=>v[0].padStart(26)).join(''));
  for(const [met,d,label] of [['lv',3,'级/局 (主指标)'],['pts',2,'分/局']])
    console.log('  '+label.padEnd(16)+VARS.map(([_,k])=>fmt(pairStat(rows.map(r=>r[met][k])),d).padStart(26)).join(''));
}

/* ---------------- 主程序 ---------------- */
async function main(){
  const selftest=argv.includes('--selftest');
  const R=getCur();
  const {isTestGame}=require('./records-filter.js');
  const files=argv.filter(a=>!a.startsWith('--'));
  const excl={}; const bump=(k)=>excl[k]=(excl[k]||0)+1;
  let recs=[];
  if(selftest){ recs=selfRecords(+opt('n',6)); }
  else{
    if(!files.length){ console.log('用法:node test/records-seat-swap.js <牌谱.jsonl>... [--out=x.json] | --selftest'); process.exit(1); }
    const seen=new Map();
    for(const f of files) for(const l of fs.readFileSync(f,'utf8').split('\n')){ if(!l.trim()) continue; try{ const r=JSON.parse(l); seen.set(r.id||('noid-'+seen.size),r); }catch(e){ bump('读不懂的行'); } }
    console.log(`读入 ${seen.size} 局`);
    for(const r of seen.values()){
      if(isTestGame(r)){ bump('自动测试局(isTestGame)'); continue; }
      if(r.partial){ bump('残局(partial)'); continue; }
      if(r.replay){ bump('重打 / 种子开局(replay)'); continue; }
      let why=''; try{ why=verify(R,r); }catch(e){ why='重放出错'; }
      if(why){ bump('验收不过(坏局)'); continue; }
      if((r.engines||[]).some(v=>v!=='latest')){ bump('有座位用旧引擎(engines≠latest)'); continue; }
      if((r.human??0)!==0){ bump('人不在 0 座'); continue; }
      recs.push(r);
    }
    if(opt('only')) recs=recs.filter(r=>r.id.startsWith(opt('only')));
    if(opt('limit')) recs=recs.slice(0,+opt('limit'));
  }
  if(!selftest) buildIndex();
  const NW=+opt('workers',3);
  console.log(`待跑 ${recs.length} 局,${NW} 个进程${selftest?'(SELFTEST)':''}`);
  const results=new Map(), wall0=Date.now();
  await new Promise(done=>{
    let next=0, alive=0;
    const spawn=()=>{ const w=fork(__filename,argv.filter(a=>a.startsWith('--cache=')),{env:{...process.env,SEATSWAP_WORKER:selftest?'self':'1'}}); alive++;
      const feed=()=>{ if(next<recs.length){ w.send({r:recs[next++]}); } else { w.send({stop:1}); } };
      w.on('message',m=>{ if(m.ready){ feed(); return; } if(m.res){ results.set(m.res.id,m.res);
        if(results.size%10===0) process.stderr.write(`  ${results.size}/${recs.length}  ${((Date.now()-wall0)/1000).toFixed(0)}s\n`); feed(); } });
      w.on('exit',()=>{ if(--alive===0) done(); }); };
    for(let i=0;i<Math.min(NW,recs.length);i++) spawn();
    if(!recs.length) done();
  });
  report(recs,results,excl,(Date.now()-wall0)/1000,selftest);
}

function report(recs,results,excl,wall,selftest){
  const MINFID=+opt('minfid',0.9), AUTO=+opt('autoshare',0.2);
  const rows=[]; const errs={};
  for(const r of recs){
    const o=results.get(r.id);
    if(!o||o.err){ const k=(o&&o.err)||'无结果'; errs[k]=(errs[k]||0)+1; continue; }
    const hs=humanShare(r), D=r.declSeat, H=r.human;
    const role=H===D?'庄家':H%2===D%2?'庄家的对家':'闲家';
    const row={id:r.id,pid:String(r.pid||'?').slice(0,6),tag:o.tag,role,share:hs.share,hs,fid:o.fid,ms:o.ms,a:o.actual,pts:{},lv:{},raw:o};
    for(const [_,k] of VARS){ row.pts[k]=o.actual.pts-o[k].pts; row.lv[k]=o.actual.lv-o[k].lv; }
    rows.push(row);
  }
  const fv={};
  for(const w of rows){ const o=fv[w.tag]||(fv[w.tag]={n:0,m:0,nl:0,ml:0,games:0}); o.n+=w.fid.n; o.m+=w.fid.m; o.nl+=w.fid.nl; o.ml+=w.fid.ml; o.games++; }
  const tagKey=t=>t.slice(1).split('.').map(x=>x.padStart(3,'0')).join('.');
  console.log('\n==== 保真度(记录版本的引擎,在记录的 AI 座位真实局面上选牌 = 记录里 AI 实际出的牌) ====');
  let tn=0,tm=0; const badTags=new Set();
  for(const t of Object.keys(fv).sort((a,b)=>tagKey(a)<tagKey(b)?-1:1)){
    const o=fv[t]; tn+=o.n; tm+=o.m; const rate=o.m/o.n; const bad=rate<MINFID; if(bad) badTags.add(t);
    console.log(`  ${t.padEnd(9)} ${String(o.games).padStart(3)} 局  ${o.m}/${o.n} = ${(100*rate).toFixed(1)}%  (领出 ${o.ml}/${o.nl} = ${(100*o.ml/o.nl).toFixed(1)}%)${bad?'   ✗ 低于 '+(MINFID*100)+'%,排除':''}`);
  }
  console.log(`  合计 ${tm}/${tn} = ${(100*tm/tn).toFixed(1)}%`);
  const perGame=rows.map(w=>w.fid.m/w.fid.n).sort((a,b)=>a-b);
  if(perGame.length) console.log(`  逐局保真率:最低 ${(100*perGame[0]).toFixed(0)}%  中位 ${(100*perGame[perGame.length>>1]).toFixed(0)}%  ≥99% 的局 ${perGame.filter(x=>x>=0.99).length}/${perGame.length}`);

  const kept=rows.filter(w=>{ if(badTags.has(w.tag)){ const k='保真率低的版本(<'+MINFID*100+'%)'; excl[k]=(excl[k]||0)+1; return false; } return true; });
  for(const [k,v] of Object.entries(errs)) excl['跑失败:'+k]=v;
  console.log('\n==== 排除 ====');
  for(const [k,v] of Object.entries(excl)) console.log(`  ${k}: ${v}`);
  console.log(`  进入统计: ${kept.length} 局`);

  const sum=f=>kept.reduce((a,w)=>a+w.hs[f],0);
  const hi=kept.filter(w=>w.share>AUTO);
  console.log(`\n==== 人的出牌里托管 / 照提示 ====\n  人自己出 ${sum('h')} 手(其中照提示 ${sum('hint')} = ${(100*sum('hint')/Math.max(1,sum('h'))).toFixed(1)}%),托管 ${sum('a')} 手,没得选 ${sum('f')} 手;`+
    `\n  (托管+照提示)/(自己+托管) > ${AUTO*100}% 的局: ${hi.length}/${kept.length}`);
  const clean=kept.filter(w=>w.share<=AUTO);

  const m=(xs)=>xs.reduce((a,x)=>a+x,0)/Math.max(1,xs.length);
  console.log(`\n水平(人这一队,单局口径): ACTUAL ${f2(m(kept.map(w=>w.a.pts)))} 分/局, ${f2(m(kept.map(w=>w.a.lv)),3)} 级/局 (n=${kept.length})`);
  for(const [_,k] of VARS) console.log(`  AI 坐人位 ${_.padEnd(9)}: ${f2(m(kept.map(w=>w.raw[k].pts)))} 分/局, ${f2(m(kept.map(w=>w.raw[k].lv)),3)} 级/局`);

  table(kept,'==== 全部(含托管比例高的局) ====');
  table(clean,`==== 剔除托管+照提示 > ${AUTO*100}% 的局 ====`);
  const groups=(title,keyf)=>{ const g={}; for(const w of clean) (g[keyf(w)]=g[keyf(w)]||[]).push(w);
    console.log(`\n==== ${title}(剔除高托管局后) ====`);
    console.log('  '+''.padEnd(22)+VARS.map(v=>v[0].padStart(26)).join(''));
    for(const k of Object.keys(g).sort()){ const rr=g[k];
      console.log(`  ${(k+' n='+rr.length).padEnd(14)} 级/局 `+VARS.map(([_,kk])=>fmt(pairStat(rr.map(w=>w.lv[kk])),3).padStart(26)).join(''));
      console.log(`  ${''.padEnd(14)} 分/局 `+VARS.map(([_,kk])=>fmt(pairStat(rr.map(w=>w.pts[kk])),2).padStart(26)).join('')); } };
  groups('按玩家',w=>w.pid);
  groups('按真人身份',w=>w.role);
  groups('按记录版本段',w=>{ const mnr=+w.tag.split('.')[2]; return mnr<=40?'v0.7.38-40':mnr<=52?'v0.7.45-52':mnr<=60?'v0.7.53-60':'v0.7.61+'; });
  for(const [k,label] of [['same','SWAP-SAME'],['new','SWAP-NEW']]){
    const byP={}; for(const w of clean) (byP[w.pid]=byP[w.pid]||[]).push(w.lv[k]);
    const ps=Object.values(byP).filter(a=>a.length>=5).map(a=>m(a));
    if(ps.length>1) console.log(`\n玩家聚类(≥5 局的玩家 ${ps.length} 位,各玩家均值的均值) ${label} 级/局: ${fmt(pairStat(ps),3)}`);
  }
  console.log(`\n耗时: 墙钟 ${wall.toFixed(0)} s;每局 CPU 平均 ${(m(rows.map(w=>w.ms))/1000).toFixed(1)} s(含保真度 + 5 个变体),最慢 ${(Math.max(0,...rows.map(w=>w.ms))/1000).toFixed(1)} s`);
  const big=rows.filter(w=>Math.abs(w.pts.same)>15||Math.abs(w.pts.new)>15);
  console.log(`|HUMAN−AI| > 15 分(SWAP-SAME 或 NEW)的单局: ${big.length}/${rows.length}(单局差本来可以很大,看均值)`);

  if(selftest){
    const bad=rows.filter(w=>VARS.some(([_,k])=>w.pts[k]!==0||w.lv[k]!==0));
    console.log(`\nSELFTEST: "人"=同一个 AI 的 ${rows.length} 局里,HUMAN−AI 恒为 0 的局 ${rows.length-bad.length}/${rows.length}`+(bad.length?'  ✗':'  ✓'));
    for(const w of bad.slice(0,5)) console.log('   ',w.id,JSON.stringify({pts:w.pts,lv:w.lv,fid:w.fid}));
    process.exitCode=bad.length?1:0;
  }
  const out=opt('out');
  if(out){
    fs.writeFileSync(out,JSON.stringify({minfid:MINFID,autoshare:AUTO,excluded:excl,fidelityByTag:fv,wallSec:wall,
      games:rows.map(w=>({id:w.id.slice(0,8),pid:w.pid,tag:w.tag,role:w.role,share:w.share,fid:w.fid,keptFid:!badTags.has(w.tag),
        actual:w.a,same:w.raw.same,new:w.raw.new,p18:w.raw.p18,p12:w.raw.p12,p6:w.raw.p6,ms:w.ms}))},null,1));
    console.log('已写 '+out);
  }
}

/* ---------------- SELFTEST:用当前 AI 自对弈造「牌谱」(人 = 同一个 AI) ---------------- */
function selfRecords(n){
  const E=getCur(), out=[];
  for(let seed=1;out.length<n;seed++){
    const {first}=E.cutForFirst(seed);
    const {hands,kitty}=E.dealRound(seed,first);
    let best=null, declSeat=-1;
    for(let s=0;s<4;s++){ const o=E.declOptions(hands[s],E.RULES.levelStart)[0]; if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;} }
    if(!best) continue;
    const trump={suit:best.suit,rank:E.RULES.levelStart};
    const cs=a=>a.map(c=>c.suit+c.rank);
    const kit=cs(kitty);
    hands[declSeat].push(...kitty);
    const log=[{seat:declSeat,suit:best.suit,strength:best.strength,at:100}];
    const buried=E.aiDiscard(hands[declSeat],trump);
    buried.forEach(c=>E.removeCard(hands[declSeat],c));
    const rec={fmt:'80fen-record-2',id:'self-'+seed,pid:'selftest',version:'SELF',human:0,seed:String(seed),firstTaker:first,
      declSeat,trump,decl:log,kitty:kit,buried:cs(buried),initialHands:hands.map(cs),tricks:[],rules:{}};
    const st={hands:hands.map(h=>h.slice()),buried,history:[]};
    let leader=declSeat;
    while(st.hands.some(h=>h.length)){
      const plays=[];
      for(let i=0;i<4;i++){ const seat=(leader+i)%4, cards=decide(E,rec,st,seat,plays);
        cards.forEach(c=>E.removeCard(st.hands[seat],c)); plays.push({seat,cards}); }
      st.history.push(...plays);
      const res=E.resolveTrick(plays,trump);
      rec.tricks.push({plays:plays.map(p=>({seat:p.seat,cards:cs(p.cards),...(p.seat===0?{by:'h'}:{})})),winner:res.winner,points:res.points});
      leader=res.winner;
    }
    out.push(rec);
  }
  return out;
}

main().catch(e=>{ console.error(e); process.exit(1); });
}
