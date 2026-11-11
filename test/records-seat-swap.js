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
const NEWMODE=argv.includes('--new');   // --attrib --new:人位的对照引擎是 OVN 覆盖后的当前版(另三家仍是记录版本)
const NEWONLY=argv.includes('--newonly');   // 只跑 fidelity + SWAP-NEW(变体对变体时用,省 4 次续打)
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
/* OVN='{"pairKeep":8}':只覆盖 SWAP-NEW 里坐人位的那一版(记录版本的另三家不动)。
 * 不设 OVN 时 getNew()===getCur(),行为和以前逐位相同。 */
const OVN=process.env.OVN?JSON.parse(process.env.OVN):null;
let NEWE=null;
function getNew(){
  if(!OVN) return getCur();
  if(!NEWE){ NEWE=loadSrc(blockOf(fs.readFileSync(HTML,'utf8'))); Object.assign(NEWE.AIP,OVN); }
  return NEWE;
}
const EXTRA_ENG=[];   // --agree 里按配置装的引擎,也要套本局规则
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
  decide.reason=undefined;
  const R=getCur(), hand=st.hands[seat], view=mkView(r,seat,st,plays);
  let cards;
  if(!plays.length){
    const rl=eng.aiChooseLead(view); cards=rl.cards; decide.reason=rl.reason;
    const chk=R.checkThrow(st.hands,seat,cards,r.trump); if(!chk.ok) cards=chk.forced;
  }else{
    const lead=R.classify(plays[0].cards,r.trump);
    const rf=eng.aiChooseFollow(view,plays); cards=rf.cards; decide.reason=rf.reason;
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
  for(const E of [getCur(),...(OVN?[getNew()]:[]),...EXTRA_ENG,...Object.values(ENG)]){
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
    if(!NEWONLY) out.same=playOut(r,stateOf(r,0),()=>V);
    out.new=playOut(r,stateOf(r,0),s=>s===r.human?getNew():V);
    if(!NEWONLY) for(const k of [18,12,6]) out['p'+k]=playOut(r,stateOf(r,cutFor(r,k)),()=>V);
    out.ms=Date.now()-t0;
    return out;
  }finally{ restore(); }
}


/* ================= --attrib:逐手归因(伸缩和) =================
 * W(t) = 照记录原样放到人的第 t 手(不含)之前,从人的第 t 手起四家全由记录版本 AI 接着打到底的结果。
 * W(0)=SWAP-SAME,W(T)=ACTUAL。m(t)=W(t+1)−W(t):人这一手 vs AI 在同一局面的选择(之后都由同一个 AI 接着打)。
 * 人和 AI 选的牌一样时 m(t)=0,不用推演;只有不一样的才跑一次续打。
 * 恒等式 Σm = ACTUAL − SWAP-SAME 是正确性检查(链头 W0 是独立算的,链尾要等于独立重放的 ACTUAL)。 */
function stateAt(r,k,pn){
  const st=stateOf(r,k), partial=[];
  if(k<r.tricks.length){
    const t=r.tricks[k];
    for(let i=0;i<pn;i++){ const p=t.plays[i], cards=[];
      for(const x of p.cards){ const j=st.hands[p.seat].findIndex(y=>code(y)===x); cards.push(st.hands[p.seat].splice(j,1)[0]); }
      partial.push({seat:p.seat,cards}); }
  }
  return {st,partial};
}
function finish(r, st, partial, engOf){
  const R=getCur(), T=r.trump, D=r.declSeat;
  let defPts=st.defPts, lastWinner=st.lastWinner, lastLeadSize=st.lastLeadSize;
  let plays=partial.slice(), leader=partial.length?partial[0].seat:st.leader;
  while(plays.length||st.hands.some(h=>h.length)){
    for(let i=plays.length;i<4;i++){
      const seat=(leader+i)%4, cards=decide(engOf(seat),r,st,seat,plays);
      cards.forEach(c=>R.removeCard(st.hands[seat],c)); plays.push({seat,cards});
    }
    st.history.push(...plays);
    const res=R.resolveTrick(plays,T);
    if(res.winner%2!==D%2) defPts+=res.points;
    leader=lastWinner=res.winner; lastLeadSize=plays[0].cards.length; plays=[];
  }
  return result(r,defPts,st.buried,lastWinner,lastLeadSize);
}
const SUITSYM={S:'♠',H:'♥',D:'♦',C:'♣'};
const cname=c=>c.suit==='X'?(c.rank===16?'大王':'小王'):SUITSYM[c.suit]+({14:'A',13:'K',12:'Q',11:'J'}[c.rank]||c.rank);
const cnames=cs=>cs.map(cname).join(' ');
function feats(r, st, partial, cards){
  const R=getCur(), T=r.trump, H=r.human, hand=st.hands[H], f={pts:R.countPoints(cards)};
  const voids=R.makeVoids(st.history,T);
  const es=c=>R.effSuit(c,T), oi=c=>R.ordIdx(c,T);
  const top=cards.reduce((a,c)=>oi(c)>oi(a)?c:a,cards[0]);
  // 手里同牌(花色+点数)有几张 → 拆对
  const cnt=(c)=>hand.filter(y=>y.suit===c.suit&&y.rank===c.rank).length;
  if(!partial.length){
    const cl=R.classify(cards,T); f.lead=true;
    let cls;
    if(!cl) cls='?';
    else if(cl.type==='throw') cls='甩牌';
    else if(cl.suit==='T') cls=cl.type==='single'?'主单张':'主对/拖拉机';
    else if(cl.type==='single'){
      const pool=[]; for(let s=0;s<4;s++) if(s!==H) pool.push(...st.hands[s]);
      if(r.declSeat!==H) pool.push(...st.buried);
      const boss=!pool.some(y=>es(y)===cl.suit&&oi(y)>oi(cards[0]));
      cls=boss?'边门单张·最大(boss)':(R.cardPoints(cards[0])?'边门单张·分牌':'边门单张·非分');
    }else cls=cl.type==='pair'?'边门对子':'边门拖拉机';
    f.cls=cls; f.suit=cl?cl.suit:null;
    f.bigJ=cards.some(c=>c.suit==='X'&&c.rank===16); f.smallJ=cards.some(c=>c.suit==='X'&&c.rank===15);
    const partner=(H+2)%4, opps=[(H+1)%4,(H+3)%4];
    f.partnerVoid=!!(f.suit&&voids[partner][f.suit]); f.oppVoid=!!(f.suit&&opps.some(o=>voids[o][f.suit]));
    const lens={}; for(const c of hand){ const e=es(c); if(e!=='T') lens[e]=(lens[e]||0)+1; }
    const ks=Object.keys(lens);
    if(ks.length>=2&&f.suit&&f.suit!=='T'){ const v=ks.map(k=>lens[k]); f.shortest=lens[f.suit]===Math.min(...v)&&v.filter(x=>x===Math.min(...v)).length===1; f.longest=lens[f.suit]===Math.max(...v)&&v.filter(x=>x===Math.max(...v)).length===1; }
    else{ f.shortest=false; f.longest=false; }
  }else{
    const lead=R.classify(partial[0].cards,T); f.lead=false; f.ledSuit=lead.suit;
    const void_=!hand.some(c=>es(c)===lead.suit);
    f.void=void_;
    const allT=cards.every(c=>es(c)==='T');
    f.kind=void_?((lead.suit!=='T'&&allT)?'毙':'垫'):'跟门';
    if(f.kind==='毙') f.trumpTop=oi(top);
    f.win=R.currentWinner([...partial,{seat:H,cards}],T).seat===H;
    if(!void_&&cards.every(c=>es(c)===lead.suit)) f.ledTop=oi(top);
    f.single=cards.length===1;
    f.brk=cards.length===1&&cnt(cards[0])>=2&&lead.type==='single';
  }
  return f;
}
const rolePos=(r)=>r.human===r.declSeat?'庄家':r.human%2===r.declSeat%2?'庄家的对家':'闲家';
/* --attrib --new 的跟牌细分:(a) 座位 × 当前谁暂大 × 缺不缺门;(b) 人相对引擎做了什么(互斥,按优先级:赢墩不同 → 毙 / 垫不同 → 同类里比大小 → 比分 → 垫牌换门) */
function followCell(r,st,partial,hum,eng,reason){
  const R=getCur(), T=r.trump, H=r.human, hand=st.hands[H], es=c=>R.effSuit(c,T), oi=c=>R.ordIdx(c,T);
  const lead=R.classify(partial[0].cards,T), pos=partial.length;   // 1=第2家 2=第3家 3=第4家
  const cw=R.currentWinner(partial,T).seat, partnerWin=cw%2===H%2;
  const void_=!hand.some(c=>es(c)===lead.suit);
  const seatN=['','第2家','第3家','第4家'][pos];
  const state=pos===1?'对手领出':(partnerWin?'队友暂大':'对手暂大');
  const a=seatN+'·'+state+'·'+(void_?'缺门':'有门');
  const info=cs=>{ const top=cs.reduce((x,c)=>oi(c)>oi(x)?c:x,cs[0]);
    const allT=cs.every(c=>es(c)==='T');
    const kind=void_?((lead.suit!=='T'&&allT)?'毙':'垫'):'跟门';
    const win=R.currentWinner([...partial,{seat:H,cards:cs}],T).seat===H;
    const suits=[...new Set(cs.map(es))];
    const len=suits.length===1?hand.filter(c=>es(c)===suits[0]).length:0;
    return {top:oi(top),pts:R.countPoints(cs),kind,win,suit:suits.length===1?suits[0]:'混',len,key:suits.join()};};
  const h=info(hum), e=info(eng);
  let b;
  if(h.win!==e.win) b=h.win?'人赢墩·引擎不赢':'引擎赢墩·人不赢';
  else if(h.kind!==e.kind) b=h.kind==='毙'?'人毙·引擎垫':(h.kind==='垫'?'人垫·引擎毙':'其他');
  else if(h.kind==='垫'){
    if(h.suit!==e.suit){ b='垫·换门·'+(h.len<e.len?'人垫更短门':h.len>e.len?'人垫更长门':'两门同长')+((h.pts>0||e.pts>0)?'·含分牌':'');
    }else if(h.top!==e.top) b='垫·同门·人垫'+(h.top>e.top?'更大':'更小');
    else b=h.pts!==e.pts?'垫·同门·人垫'+(h.pts>e.pts?'更多分':'更少分'):'垫·同门·其他';
  }else{
    const nm=h.kind==='毙'?'毙':'跟门';
    if(h.top!==e.top) b=nm+'·同位·人出更'+(h.top>e.top?'大':'小')+(h.pts!==e.pts?'('+(h.pts>e.pts?'多喂分':'少喂分')+')':'');
    else b=h.pts!==e.pts?nm+'·同位·人'+(h.pts>e.pts?'多喂分':'少喂分'):nm+'·同位·其他';
  }
  return {a,b,hp:h.pts-e.pts,reason:reason||''};
}
function attribRecord(r, byTag, selftest){
  const t0=Date.now(), R=getCur();
  const tag=selftest?'SELF':tagOf(r.version);
  const cands=selftest?[{hash:'__cur__'}]:(byTag[tag]||[]);
  if(!cands.length) return {id:r.id,err:'无对应版本的引擎('+tag+')'};
  const getE=h=>h==='__cur__'?R:engineByHash(h);
  cands.forEach(c=>getE(c.hash));
  const restore=applyRules(r);
  try{
    let best=null;
    for(const c of cands){ if(cands.length===1){ best={c}; break; } const f=fidelity(getE(c.hash),r); if(!best||f.m>best.f.m) best={c,f}; }
    const Vr=getE(best.c.hash), T=r.tricks.length, H=r.human;
    const N=NEWMODE?getNew():Vr, V=N, engOf=sd=>(NEWMODE&&sd!==H)?Vr:N;
    const posOf=k=>r.tricks[k].plays.findIndex(p=>p.seat===H);
    const sa=stateOf(r,T), actual=result(r,sa.defPts,sa.buried,sa.lastWinner,sa.lastLeadSize);
    let a0=stateAt(r,0,posOf(0)); const W0=finish(r,a0.st,a0.partial,engOf);
    let base=W0; const decs=[]; let nSame=0;
    const sh=humanShare(r);
    for(let k=0;k<T;k++){
      const pn=posOf(k), hp=r.tricks[k].plays[pn];
      const {st,partial}=stateAt(r,k,pn);
      const left=st.hands[H].length;
      const aiCards=decide(N,r,st,H,partial); const aiReason=decide.reason;
      const hum=[]; { const pool=st.hands[H].slice(); for(const x of hp.cards){ const j=pool.findIndex(y=>code(y)===x); hum.push(pool.splice(j,1)[0]); } }
      const same=sortKey(aiCards.map(code))===sortKey(hp.cards);
      const by=hp.by==='a'?'auto':hp.by==='f'?'forced':hp.hint?'hint':'h';
      const d={k,pos:pn,left,same,by,u:hp.u?1:0};
      if(NEWMODE&&pn>0){ const hm=[]; { const pool=st.hands[H].slice(); for(const x of hp.cards){ const j=pool.findIndex(y=>code(y)===x); hm.push(pool.splice(j,1)[0]); } } d.xa=followCell(r,st,partial,hm,aiCards,aiReason); }
      if(same){ nSame++; decs.push(d); continue; }
      const W1=(k+1<T)?(()=>{ const z=stateAt(r,k+1,posOf(k+1)); return finish(r,z.st,z.partial,engOf); })():actual;
      d.m={pts:W1.pts-base.pts,lv:W1.lv-base.lv}; base=W1;
      d.hum=hum.map(code); d.ai=aiCards.map(code);
      d.hf=feats(r,st,partial,hum); d.af=feats(r,st,partial,aiCards);
      d.hand=cnames(st.hands[H].slice().sort((a,b)=>R.ordIdx(b,r.trump)-R.ordIdx(a,r.trump)));
      d.table=partial.map(p=>['南','东','北','西'][p.seat]+':'+cnames(p.cards)).join(' ');
      d.humS=cnames(hum); d.aiS=cnames(aiCards); d.aiReason=aiReason||'';
      decs.push(d);
    }
    return {id:r.id,tag,engine:best.c.hash,T,actual,W0,resid:{pts:actual.pts-base.pts,lv:actual.lv-base.lv},
      undos:r.undos||0,share:sh.share,role:rolePos(r),trump:r.trump,declSeat:r.declSeat,decs,nSame,ms:Date.now()-t0};
  }finally{ restore(); }
}

/* ================= --agree:当前引擎(按配置覆盖 AIP)在真人每个自己出的手上,选的牌和真人一样的比例 =================
 * AGREECFG='[{},{"pairKeepCands":1},{"pairKeep":8,"pairKeepCands":1}]'(第 0 项当基线)。不续打,只比这一手。 */
const AG=[];
function agreeRecord(r){
  const cfgs=JSON.parse(process.env.AGREECFG||'[{}]');
  if(!AG.length) for(const c of cfgs){ const E=loadSrc(blockOf(fs.readFileSync(HTML,'utf8'))); Object.assign(E.AIP,c); AG.push(E); EXTRA_ENG.push(E); }
  const restore=applyRules(r), H=r.human, T=r.tricks.length, decs=[];
  try{
    for(let k=0;k<T;k++){
      const pn=r.tricks[k].plays.findIndex(p=>p.seat===H), hp=r.tricks[k].plays[pn];
      const by=hp.by==='a'?'auto':hp.by==='f'?'forced':hp.hint?'hint':'h';
      if(by!=='h') continue;
      const {st,partial}=stateAt(r,k,pn);
      const view=mkView(r,H,st,partial), hand=st.hands[H];
      const hum=sortKey(hp.cards), follow=partial.length>0;
      const lead=follow?AG[0].classify(partial[0].cards,r.trump):null;
      const single=!!(follow&&lead.type==='single'&&hp.cards.length===1);
      const d={k,left:hand.length,follow,single,hum:null,ch:[],sp:[],spAlt:[]};
      if(single){ const hc=hand.find(c=>code(c)===hp.cards[0]); d.humSplit=!!(hc&&AG[0].pairSplitCard(hand,[hc])); }
      for(const E of AG){
        const cards=decide(E,r,st,H,partial);
        d.ch.push(sortKey(cards.map(code))===hum);
        let sp=false, sa=false;
        if(single&&cards.length===1&&E.pairSplitCard(hand,cards)){ sp=true; sa=!!E.pairKeepAlt(view,partial,cards[0]); }
        d.sp.push(sp); d.spAlt.push(sa);
      }
      decs.push(d);
    }
    return {id:r.id,decs};
  }finally{ restore(); }
}
/* 被 require(如 human-fit-data.js)时只导出局面还原工具,不跑主程序 */
if(require.main!==module&&!process.env.SEATSWAP_WORKER){
  module.exports={loadSrc,blockOf,verify,stateOf,stateAt,mkView,applyRules,getCur,code,sortKey,mkCard,humanShare,EXTRA_ENG,HTML};
  return;
}
/* ---------------- 工人进程 ---------------- */
if(process.env.SEATSWAP_WORKER){
  const selftest=process.env.SEATSWAP_WORKER==='self';
  const byTag=selftest?{}:buildIndex();
  process.on('message',m=>{
    if(m.stop) process.exit(0);
    let out; try{ out=m.agree?agreeRecord(m.r):m.attrib?attribRecord(m.r,byTag,selftest):processRecord(m.r,byTag,selftest); }catch(e){ out={id:m.r.id,err:'引擎出错:'+(e.stack||e.message).split('\n').slice(0,2).join(' | ')}; }
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
function reportAgree(recs,results){
  const cfgs=JSON.parse(process.env.AGREECFG||'[{}]');
  const all=[]; let games=0;
  for(const r of recs){ const o=results.get(r.id); if(!o||o.err) continue; games++; all.push(...o.decs); }
  const pc=(xs,i)=>xs.length?(100*xs.filter(d=>d.ch[i]).length/xs.length).toFixed(1)+'%':'—';
  const sets=[['全部 by=h 决策',all],['其中跟牌',all.filter(d=>d.follow)],['其中单张领出的跟牌',all.filter(d=>d.single)],
    ['基线拆对子的单张跟牌',all.filter(d=>d.single&&d.sp[0])],
    ['  其中真人没拆(AI 拆 / 人保)',all.filter(d=>d.single&&d.sp[0]&&!d.humSplit)],
    ['  其中真人也拆',all.filter(d=>d.single&&d.sp[0]&&d.humSplit)]];
  console.log(`\n==== 当前引擎选牌 = 真人所出的比例(${games} 局)====`);
  console.log('  '.padEnd(34)+'n'.padStart(6)+cfgs.map((c,i)=>(i?JSON.stringify(c):'基线').padStart(i?34:8)).join(''));
  for(const [nm,xs] of sets) console.log(('  '+nm).padEnd(34)+String(xs.length).padStart(6)+cfgs.map((_,i)=>pc(xs,i).padStart(i?34:8)).join(''));
  console.log('\n  相对基线的翻转(配置对、基线错 / 基线对、配置错),全部 by=h 决策:');
  for(let i=1;i<cfgs.length;i++){
    const up=all.filter(d=>d.ch[i]&&!d.ch[0]).length, dn=all.filter(d=>!d.ch[i]&&d.ch[0]).length;
    const sub=all.filter(d=>d.single&&d.sp[0]&&!d.humSplit);
    console.log(`  ${JSON.stringify(cfgs[i]).padEnd(40)} 对→${up} / 错→${dn};  在「AI 拆 / 人保」${sub.length} 处里翻对 ${sub.filter(d=>d.ch[i]&&!d.ch[0]).length}`);
  }
  console.log('\n  引擎在这些局面上拆对子(单张领出的跟牌)的次数 / 局 —— 括号内:手上有同位不拆替身的:');
  const sf=all.filter(d=>d.single);
  cfgs.forEach((c,i)=>console.log(`  ${(i?JSON.stringify(c):'基线').padEnd(44)} 拆 ${(sf.filter(d=>d.sp[i]).length/games).toFixed(3)} /局  (有替身 ${(sf.filter(d=>d.spAlt[i]).length/games).toFixed(3)} /局);真人拆 ${(sf.filter(d=>d.humSplit).length/games).toFixed(3)} /局`));
}
/* ---------------- --cmp=a.json,b.json:两次 --out 的 SWAP-NEW 逐局配对 ---------------- */
function cmpMain(){
  const [fa,fb]=opt('cmp').split(',');
  const A=JSON.parse(fs.readFileSync(fa,'utf8')), B=JSON.parse(fs.readFileSync(fb,'utf8'));
  const bm=new Map(B.games.map(g=>[g.id,g]));
  const rows=A.games.filter(g=>g.keptFid&&bm.has(g.id)&&bm.get(g.id).keptFid).map(g=>({a:g,b:bm.get(g.id)}));
  const AUTO=+opt('autoshare',0.2);
  const show=(title,rr)=>{
    console.log(`\n${title}  (n=${rr.length})`);
    for(const [met,d,label] of [['lv',3,'级/局'],['pts',2,'分/局']]){
      const newA=rr.map(x=>x.a.new[met]), newB=rr.map(x=>x.b.new[met]);
      const act=rr.map(x=>x.a.actual[met]);
      console.log(`  ${label}: AI(基线) ${f2(pairStat(newA).mean,d)}  AI(变体) ${f2(pairStat(newB).mean,d)}   变体−基线(配对) ${fmt(pairStat(rr.map((x,i)=>newB[i]-newA[i])),d)}`);
      console.log(`        HUMAN−AI: 基线 ${fmt(pairStat(rr.map((x,i)=>act[i]-newA[i])),d)}   变体 ${fmt(pairStat(rr.map((x,i)=>act[i]-newB[i])),d)}`);
    }
  };
  show('==== 全部 ====',rows);
  show(`==== 剔除托管+照提示 > ${AUTO*100}% ====`,rows.filter(x=>x.a.share<=AUTO));
}
const VARS=[['SWAP-SAME','same'],['SWAP-NEW','new'],['PHASE-18','p18'],['PHASE-12','p12'],['PHASE-6','p6']].filter(v=>!NEWONLY||v[1]==='new');
function table(rows, title){
  console.log(`\n${title}  (n=${rows.length})`);
  console.log('  HUMAN−AI        '+VARS.map(v=>v[0].padStart(26)).join(''));
  for(const [met,d,label] of [['lv',3,'级/局 (主指标)'],['pts',2,'分/局']])
    console.log('  '+label.padEnd(16)+VARS.map(([_,k])=>fmt(pairStat(rows.map(r=>r[met][k])),d).padStart(26)).join(''));
}

/* ---------------- 主程序 ---------------- */
async function main(){
  if(opt('cmp')) return cmpMain();
  const selftest=argv.includes('--selftest'); const ATTRIB=argv.includes('--attrib'), AGREE=argv.includes('--agree');
  const R=getCur();
  const {isTestGame}=require('./records-filter.js');
  const files=argv.filter(a=>!a.startsWith('--'));
  const excl={}; const bump=(k)=>excl[k]=(excl[k]||0)+1;
  let recs=[];
  if(selftest){ recs=selfRecords(+opt('n',6),argv.includes('--perturb')); }
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
    const spawn=()=>{ const w=fork(__filename,argv.filter(a=>a.startsWith('--cache=')||a==='--new'||a==='--newonly'),{env:{...process.env,SEATSWAP_WORKER:selftest?'self':'1'}}); alive++;
      const feed=()=>{ if(next<recs.length){ w.send({r:recs[next++],attrib:ATTRIB,agree:AGREE}); } else { w.send({stop:1}); } };
      w.on('message',m=>{ if(m.ready){ feed(); return; } if(m.res){ results.set(m.res.id,m.res);
        if(results.size%10===0) process.stderr.write(`  ${results.size}/${recs.length}  ${((Date.now()-wall0)/1000).toFixed(0)}s\n`); feed(); } });
      w.on('exit',()=>{ if(--alive===0) done(); }); };
    for(let i=0;i<Math.min(NW,recs.length);i++) spawn();
    if(!recs.length) done();
  });
  if(AGREE) reportAgree(recs,results);
  else if(ATTRIB) reportAttrib(recs,results,excl,(Date.now()-wall0)/1000,selftest);
  else report(recs,results,excl,(Date.now()-wall0)/1000,selftest);
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
  for(const [k,label] of [['same','SWAP-SAME'],['new','SWAP-NEW']].filter(v=>VARS.some(x=>x[1]===v[0]))){
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


/* ---------------- --attrib 报告 ---------------- */
/* ---- --attrib --new:跟牌细分(互斥格子,逐行重算合计) ---- */
const CELLSTAT={};
function followNew(name,G,hd,diff,ld,fo,other,stat){
  const sum=(xs,f)=>xs.reduce((a,d)=>a+d.m[f],0);
  console.log(`\n  ==== [--new] 逐行重算的分项合计(by=h 且与引擎不同;对 ${G} 局) ====`);
  const otherDiff=other.filter(d=>!d.same);
  console.log(`     领出 ${(sum(ld,'pts')/G).toFixed(2)} 分 ${(sum(ld,'lv')/G).toFixed(3)} 级 (n=${ld.length});跟牌 ${(sum(fo,'pts')/G).toFixed(2)} 分 ${(sum(fo,'lv')/G).toFixed(3)} 级 (n=${fo.length});`+
    `合计 ${((sum(ld,'pts')+sum(fo,'pts'))/G).toFixed(2)} 分 ${((sum(ld,'lv')+sum(fo,'lv'))/G).toFixed(3)} 级;非 by=h 的不同手(托管 / 照提示)m 之和 ${(sum(otherDiff,'pts')/G).toFixed(2)} 分 (n=${otherDiff.length})`);
  // 4. 一致率,按 (a) 格
  const hf=hd.filter(d=>d.xa);
  const A={}; for(const d of hf){ (A[d.xa.a]=A[d.xa.a]||[]).push(d); }
  console.log('\n  -- 4. 人 = 新引擎 的一致率,按 (a) 格(座位·谁暂大·缺不缺门;by=h 的跟牌)');
  for(const k of Object.keys(A).sort()){ const a=A[k]; console.log('     '+k.padEnd(24-[...k].filter(c=>c.charCodeAt(0)>255).length*0)+` n=${String(a.length).padStart(4)}  一致 ${(100*a.filter(d=>d.same).length/a.length).toFixed(1)}%`); }
  console.log(`     (跟牌合计 n=${hf.length}, 一致 ${(100*hf.filter(d=>d.same).length/hf.length).toFixed(1)}%)`);
  // 3(a)(b):格 × 行为,按贡献排序
  const fd=diff.filter(d=>d.xa);
  const cellRows=(title,labelFn)=>{
    const g={}; for(const d of fd){ (g[labelFn(d)]=g[labelFn(d)]||[]).push(d); }
    console.log(`\n  -- ${title}   (合计 n=${fd.length}, ${(sum(fd,'pts')/G).toFixed(2)} 分/局, ${(sum(fd,'lv')/G).toFixed(3)} 级/局;★ = |t|≥2 且 n≥30)`);
    console.log('  '+'格'.padEnd(52)+'n'.padStart(5)+'  分/手±SE (t)'.padEnd(22)+'分/局'.padStart(7)+'  级/手±SE'.padEnd(16)+'级/局'.padStart(8));
    const out=[];
    for(const k of Object.keys(g).sort((x,y)=>sum(g[y],'pts')-sum(g[x],'pts'))){ const a=g[k], sp=stat(a.map(d=>d.m.pts)), sl=stat(a.map(d=>d.m.lv));
      const t=sp.se>0?sp.m/sp.se:0, star=(Math.abs(t)>=2&&a.length>=30)?'★':' ';
      out.push({k,a,t});
      console.log(' '+star+k.padEnd(52-[...k].filter(c=>c.charCodeAt(0)>255).length*0)+String(a.length).padStart(5)+`  ${sp.m.toFixed(1)}±${sp.se.toFixed(1)} (${t.toFixed(1)})`.padEnd(22)+(sum(a,'pts')/G).toFixed(2).padStart(7)+`  ${sl.m.toFixed(2)}±${sl.se.toFixed(2)}`.padEnd(16)+(sum(a,'lv')/G).toFixed(3).padStart(8)); }
    return out;
  };
  cellRows('3(a). 格:座位 · 谁暂大 · 缺不缺门(合计应等于跟牌合计)',d=>d.xa.a);
  cellRows('3(b). 人相对引擎做了什么(跨 (a) 格合并)',d=>d.xa.b);
  const fine=cellRows('3(a)×(b). 全部互斥格',d=>d.xa.a+' | '+d.xa.b);
  CELLSTAT[name]=fine;
  // 边际:喂分多少(不互斥,只看)
  const mg={}; for(const d of fd){ const k=d.xa.hp>0?'人多喂分':d.xa.hp<0?'人少喂分':'喂分一样'; (mg[k]=mg[k]||[]).push(d); }
  console.log('\n  -- 边际(不互斥):人比引擎多 / 少喂的牌面分');
  for(const k of Object.keys(mg)){ const a=mg[k], sp=stat(a.map(d=>d.m.pts)); console.log(`     ${k.padEnd(10)} n=${String(a.length).padStart(4)}  ${sp.m.toFixed(1)}±${sp.se.toFixed(1)}  ${(sum(a,'pts')/G).toFixed(2)} 分/局`); }
}
function writeExamples(gs,recs){
  const fine=CELLSTAT['(a) 全部局']; if(!fine) return;
  const G=gs.length, sumP=a=>a.reduce((x,d)=>x+d.m.pts,0);
  const top=fine.filter(c=>Math.abs(c.t)>=2).sort((x,y)=>sumP(y.a)-sumP(x.a)).slice(0,3);
  const SN=['南','东','北','西'], tn=t=>t.suit?SUITSYM[t.suit]+t.rank:'无主'+t.rank;
  let txt='';
  for(const c of top){
    txt+=`\n\n######## 格:${c.k}   n=${c.a.length}  ${(sumP(c.a)/G).toFixed(2)} 分/局  t=${c.t.toFixed(1)}(全部局;12 例按 局 id 排序后等距抽取,不挑 m)\n`;
    const ar=c.a.slice().sort((x,y)=>(x.g.id+String(x.k).padStart(3,'0')).localeCompare(y.g.id+String(y.k).padStart(3,'0')));
    const step=Math.max(1,Math.floor(ar.length/12));
    for(let i=0,n=0;i<ar.length&&n<12;i+=step,n++){ const d=ar[i], g=d.g;
      txt+=`\n[${n+1}] 局 ${g.id.slice(0,8)} 第 ${d.k+1} 墩  主 ${tn(g.trump)}  人是${g.role}  剩 ${d.left} 张  ${['领出','第2家','第3家','第4家'][d.pos]}\n    手牌: ${d.hand}\n    台面: ${d.table}\n    人出: ${d.humS}   引擎出: ${d.aiS}   引擎的理由: ${d.aiReason||'(无)'}\n    m = ${d.m.pts>=0?'+':''}${d.m.pts} 分 / ${d.m.lv>=0?'+':''}${d.m.lv} 级\n`; }
  }
  const f=opt('examples'); if(f){ fs.writeFileSync(f,txt); console.log('\n示例已写 '+f); } else console.log(txt);
}
function reportAttrib(recs,results,excl,wall,selftest){
  const AUTO=+opt('autoshare',0.2);
  const games=[]; const errs={};
  for(const r of recs){ const o=results.get(r.id); if(!o||o.err){ const k=(o&&o.err)||'无结果'; errs[k]=(errs[k]||0)+1; continue; } games.push(o); }
  for(const [k,v] of Object.entries(errs)) excl['跑失败:'+k]=v;
  console.log('\n==== 排除 ===='); for(const [k,v] of Object.entries(excl)) console.log(`  ${k}: ${v}`);
  console.log(`  进入归因: ${games.length} 局`);
  // 恒等式检查
  const bad=games.filter(g=>g.resid.pts!==0||g.resid.lv!==0);
  let sumM={pts:0,lv:0}, gapTot={pts:0,lv:0};
  for(const g of games){ for(const d of g.decs) if(d.m){ sumM.pts+=d.m.pts; sumM.lv+=d.m.lv; } gapTot.pts+=g.actual.pts-g.W0.pts; gapTot.lv+=g.actual.lv-g.W0.lv; }
  console.log(`\n==== 恒等式 Σm(t) = ACTUAL − ${NEWMODE?'SWAP-NEW(OVN)':'SWAP-SAME'} ====\n  逐局链尾 = ACTUAL 的局: ${games.length-bad.length}/${games.length}`+
    `${bad.length?`  ✗ 有 ${bad.length} 局对不上(残差之和 ${bad.reduce((a,g)=>a+g.resid.pts,0)} 分 / ${bad.reduce((a,g)=>a+g.resid.lv,0).toFixed(2)} 级)`:'  ✓'}`+
    `\n  全体 Σm/局: ${(sumM.pts/games.length).toFixed(2)} 分, ${(sumM.lv/games.length).toFixed(3)} 级;  ACTUAL−${NEWMODE?'SWAP-NEW':'SWAP-SAME'}/局: ${(gapTot.pts/games.length).toFixed(2)} 分, ${(gapTot.lv/games.length).toFixed(3)} 级`);
  const sets=[['(a) 全部局',games],['(b) 无悔棋且托管+照提示 ≤'+AUTO*100+'%',games.filter(g=>g.undos===0&&g.share<=AUTO)]];
  const bucket=l=>l>=19?'25-19':l>=13?'18-13':l>=7?'12-7':'6-1';
  const BK=['25-19','18-13','12-7','6-1'];
  const stat=(xs)=>{ const n=xs.length; if(!n) return {n:0,m:0,se:0}; const m=xs.reduce((a,x)=>a+x,0)/n; const sd=n>1?Math.sqrt(xs.reduce((a,x)=>a+(x-m)*(x-m),0)/(n-1)):0; return {n,m,se:sd/Math.sqrt(n)}; };
  function rows(title,decs,labelFn,G,order){
    const g={}; for(const d of decs){ const l=labelFn(d); if(l==null) continue; (g[l]=g[l]||[]).push(d); }
    console.log(`\n  -- ${title}`);
    console.log('  '+'类别'.padEnd(34)+'n'.padStart(5)+'  均值分±SE'.padEnd(16)+'贡献分/局'.padStart(10)+'  均值级±SE'.padEnd(18)+'贡献级/局'.padStart(10));
    const keys=Object.keys(g); if(order) keys.sort((a,b)=>order.indexOf(a)-order.indexOf(b)); else keys.sort((a,b)=>Math.abs(g[b].reduce((x,d)=>x+d.m.pts,0))-Math.abs(g[a].reduce((x,d)=>x+d.m.pts,0)));
    { const all=keys.flatMap(k=>g[k]); console.log('  '+'合计(逐行重算)'.padEnd(30)+String(all.length).padStart(5)+''.padEnd(16)+(all.reduce((x,d)=>x+d.m.pts,0)/G).toFixed(2).padStart(10)+''.padEnd(18)+(all.reduce((x,d)=>x+d.m.lv,0)/G).toFixed(3).padStart(10)); }
    for(const k of keys){ const a=g[k], sp=stat(a.map(d=>d.m.pts)), sl=stat(a.map(d=>d.m.lv));
      const sump=a.reduce((x,d)=>x+d.m.pts,0)/G, suml=a.reduce((x,d)=>x+d.m.lv,0)/G;
      console.log('  '+String(k).padEnd(34-[...String(k)].filter(c=>c.charCodeAt(0)>255).length)+String(a.length).padStart(5)+`  ${sp.m.toFixed(1)}±${sp.se.toFixed(1)}`.padEnd(16)+sump.toFixed(2).padStart(10)+`  ${sl.m.toFixed(2)}±${sl.se.toFixed(2)}`.padEnd(18)+suml.toFixed(3).padStart(10)); }
  }
  for(const [name,gs] of sets){
    const G=gs.length; if(!G) continue;
    const all=[]; for(const g of gs) for(const d of g.decs) all.push({...d,g});
    const hd=all.filter(d=>d.by==='h'), diff=hd.filter(d=>!d.same);
    const other=all.filter(d=>d.by!=='h');
    const otherDiff=other.filter(d=>!d.same);
    console.log(`\n\n################ ${name}:${G} 局 ################`);
    console.log(`人的决策(by=h)${hd.length} 手,和 AI 不同 ${diff.length} 手(${(100*diff.length/hd.length).toFixed(1)}%);其余(托管 / 照提示 / 没得选)${other.length} 手,其中和 AI 不同 ${otherDiff.length} 手,m 之和 ${(otherDiff.reduce((a,d)=>a+d.m.pts,0)/G).toFixed(2)} 分/局, ${(otherDiff.reduce((a,d)=>a+d.m.lv,0)/G).toFixed(3)} 级/局`);
    console.log(`这一组总差距 ACTUAL−SWAP-SAME: ${(gs.reduce((a,g)=>a+g.actual.pts-g.W0.pts,0)/G).toFixed(2)} 分/局, ${(gs.reduce((a,g)=>a+g.actual.lv-g.W0.lv,0)/G).toFixed(3)} 级/局;by=h 的 m 之和: ${(diff.reduce((a,d)=>a+d.m.pts,0)/G).toFixed(2)} 分/局, ${(diff.reduce((a,d)=>a+d.m.lv,0)/G).toFixed(3)} 级/局`);
    // 5 一致率
    console.log('\n  -- 5. 人 = AI 的一致率(by=h)');
    for(const pos of ['领出','跟牌']){ for(const b of BK){ const a=hd.filter(d=>bucket(d.left)===b&&(d.pos===0)===(pos==='领出'));
      if(a.length) console.log(`     ${pos} 剩${b.padEnd(6)} n=${String(a.length).padStart(4)}  一致 ${(100*a.filter(d=>d.same).length/a.length).toFixed(1)}%`); } }
    // 1 剩牌×位置
    rows('1. 剩牌数 × 位置(只含和 AI 不同的手;贡献 = Σm / 局数)',diff,d=>bucket(d.left)+(d.pos===0?' 领出':' 跟牌'),G,BK.flatMap(b=>[b+' 领出',b+' 跟牌']));
    // 4 身份
    rows('4. 身份 × 领出/跟牌',diff,d=>d.g.role+(d.pos===0?' 领出':' 跟牌'),G);
    // 2 领出
    const ld=diff.filter(d=>d.pos===0);
    rows('2a. 领出:人的牌型',ld,d=>'人 '+d.hf.cls,G);
    rows('2b. 领出:AI 的牌型(同一局面)',ld,d=>'AI '+d.af.cls,G);
    rows('2c. 领出:人→AI 牌型对照(m 之和前 14 类)',ld,d=>d.hf.cls+' → '+d.af.cls,G);
    for(const [fl,lab] of [['bigJ','领大王'],['smallJ','领小王'],['partnerVoid','领对家已缺的门'],['oppVoid','领对手已缺的门'],['shortest','领最短边门'],['longest','领最长边门']])
      rows('2d. 领出标记:'+lab,ld,d=>(d.hf[fl]?'人有':'人无')+'/'+(d.af[fl]?'AI有':'AI无'),G);
    // 3 跟牌
    const fo=diff.filter(d=>d.pos>0);
    rows('3a. 跟牌:缺门时 毙 / 垫(人→AI)',fo.filter(d=>d.hf.void),d=>'人'+d.hf.kind+' / AI'+d.af.kind,G);
    rows('3b. 跟牌:都毙时 主牌大小(人相对 AI)',fo.filter(d=>d.hf.kind==='毙'&&d.af.kind==='毙'),d=>d.hf.trumpTop>d.af.trumpTop?'人毙得更大':d.hf.trumpTop<d.af.trumpTop?'人毙得更小':'同大小',G);
    rows('3c. 跟牌:出的分牌(人 − AI)',fo,d=>d.hf.pts>d.af.pts?'人多出分':d.hf.pts<d.af.pts?'人少出分':'分数一样',G);
    rows('3d. 跟牌:出完后牌桌上暂时最大是自己吗',fo,d=>'人'+(d.hf.win?'暂赢':'不赢')+' / AI'+(d.af.win?'暂赢':'不赢'),G);
    rows('3e. 跟牌:都跟本门时出的牌(人相对 AI)',fo.filter(d=>d.hf.ledTop!==undefined&&d.af.ledTop!==undefined),d=>d.hf.ledTop>d.af.ledTop?'人出更大':d.hf.ledTop<d.af.ledTop?'人出更小':'同大小',G);
    rows('3f. 跟牌(单张):拆对(人/AI)',fo.filter(d=>d.hf.single&&d.af.single),d=>'人'+(d.hf.brk?'拆对':'不拆')+' / AI'+(d.af.brk?'拆对':'不拆'),G);
    if(NEWMODE) followNew(name,G,hd,diff,ld,fo,other,stat);
  }
  if(NEWMODE) writeExamples(sets[0][1],recs);
  // 示例
  const clean=sets[1][1];
  const ex=[]; for(const g of clean) for(const d of g.decs) if(d.m&&d.by==='h') ex.push({...d,g});
  ex.sort((a,b)=>Math.abs(b.m.pts)-Math.abs(a.m.pts)||Math.abs(b.m.lv)-Math.abs(a.m.lv));
  console.log(`\n\n################ 无悔棋且托管+照提示 ≤${AUTO*100}% 的局里,|m(分)| 最大的 25 手(给产品方过目) ################`);
  const SN=['南','东','北','西'], tn=t=>t.suit?SUITSYM[t.suit]+t.rank:'无主'+t.rank;
  ex.slice(0,25).forEach((d,i)=>{
    console.log(`\n[${i+1}] 局 ${d.g.id.slice(0,8)} 玩家 ${String(recs.find(r=>r.id===d.g.id).pid).slice(0,6)}  第 ${d.k+1} 墩  主 ${tn(d.g.trump)}  人是${d.g.role}  剩 ${d.left} 张  ${['领出','第2家','第3家','第4家'][d.pos]}${d.u?'(悔棋后重出)':''}`);
    console.log(`    手牌: ${d.hand}`); if(d.table) console.log(`    台面: ${d.table}`);
    console.log(`    人出: ${d.humS}   AI 会出: ${d.aiS}   → 人比 AI ${d.m.pts>=0?'+':''}${d.m.pts} 分 / ${d.m.lv>=0?'+':''}${d.m.lv} 级`);
  });
  console.log(`\n耗时: 墙钟 ${wall.toFixed(0)} s;每局 CPU 平均 ${(games.reduce((a,g)=>a+g.ms,0)/Math.max(1,games.length)/1000).toFixed(1)} s`);
  const out=opt('out');
  if(out){ fs.writeFileSync(out,JSON.stringify({excluded:excl,wallSec:wall,games:games.map(g=>({...g,id:g.id.slice(0,8),pid:String(recs.find(r=>r.id===g.id).pid).slice(0,6)}))}));
    console.log('已写 '+out); }
  if(selftest) process.exitCode=bad.length?1:0;
}

/* ---------------- SELFTEST:用当前 AI 自对弈造「牌谱」(人 = 同一个 AI) ---------------- */
function selfRecords(n,perturb){
  let rs=12345; const rnd=()=>{ rs=(rs*1103515245+12345)&0x7fffffff; return rs/0x7fffffff; };
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
      for(let i=0;i<4;i++){ const seat=(leader+i)%4; let cards=decide(E,rec,st,seat,plays);
        if(perturb&&seat===0&&rnd()<0.4){      // 扰动:"人"有时乱出合法牌 → 恒等式要在 m≠0 时也成立
          const hand=st.hands[0];
          if(!plays.length) cards=[hand[Math.floor(rnd()*hand.length)]];
          else{ const lead=E.classify(plays[0].cards,trump); cards=E.genFollow(hand,lead,trump,E.rng(Math.floor(rnd()*1e6))); } }
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
