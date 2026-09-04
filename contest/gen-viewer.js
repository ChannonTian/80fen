/* 给参赛提交套上 GUI 壳,生成一个人类可以坐下来打的观察页。
 *
 *   node contest/gen-viewer.js <提交目录> <选手名> [输出文件]
 *   node contest/gen-viewer.js /path/to/submissions/foo foo
 *     → 80fen-contest-foo-v1.html
 *
 * 做法:拿正式版 index.html,**保留引擎和界面**,只把三家 AI 的决策换成参赛者的。
 * 引擎不动是关键 —— 合法性判定必须还是我们这边的,否则观察员看到的就不是
 * 比赛里那个 AI 了。
 *
 * 换掉的四处(界面块调 AI 的全部入口):
 *   aiDeclThink   亮主/加固   → onDeal
 *   aiLowRebel    低分造反     → onRebel
 *   afterTrumpSet 扣底         → discard
 *   step / 托管    领出与跟牌   → lead / follow
 *
 * **没换**的两处,页面上会标出来:
 *   · 教练打分用的还是原版 AI(它评的是你的出牌,和参赛者无关),默认关闭
 *   · 记牌面板同理
 *
 * 违规会实时显示在右下角 —— 一个 AI 频繁出非法牌,观察员一眼就能看见,
 * 不用等联赛跑完。
 */
'use strict';
const fs=require('fs'), path=require('path');

const [srcDir, name, outArg]=process.argv.slice(2);
if(!srcDir||!name){
  console.error('用法: node contest/gen-viewer.js <提交目录> <选手名> [输出文件]');
  process.exit(1);
}
const ROOT=path.join(__dirname,'..');
const OUT=path.join(ROOT, outArg||`80fen-contest-${name}-v1.html`);
const BASE=path.join(ROOT,'index.html');

// ---------- 1. 收集提交的 .js(只要顶层,dev/ 是开发工具,不进) ----------
const files=fs.readdirSync(srcDir).filter(f=>f.endsWith('.js'))
  .map(f=>({id:f.replace(/\.js$/,''), src:fs.readFileSync(path.join(srcDir,f),'utf8')}));
if(!files.some(f=>f.id==='index')){ console.error(`${srcDir} 里没有 index.js`); process.exit(1); }
for(const f of files){
  // </script> 会把宿主页面的 script 提前截断
  if(/<\/script/i.test(f.src)){ console.error(`${f.id}.js 里有 </script>,拒绝内联`); process.exit(1); }
}
const totalKB=(files.reduce((a,f)=>a+f.src.length,0)/1024).toFixed(0);

// ---------- 2. 把提交打包成一段可内联的脚本 ----------
const bundle = `
/* ============================================================
 * 参赛提交:${name}
 * ${files.map(f=>f.id+'.js').join(' + ')} —— 原样内联,一个字符没改。
 * 极简 CommonJS,只认本包内的相对 require。
 * ============================================================ */
const __CM={}, __CC={};
function __def(id, fn){ __CM[id]=fn; }
// 界面块整个被 (function(){…})() 包着,适配层必须插进那个闭包里才看得见 G/visHand;
// 而参赛代码在闭包外,所以靠 window 把 require 递进去。
window.__contestReq=function(s){ return __req(s); };
function __req(spec){
  const id=String(spec).replace(/^\\.\\//,'').replace(/\\.js$/,'');
  if(__CC[id]) return __CC[id].exports;
  const fn=__CM[id];
  if(!fn) throw new Error('参赛包里没有模块 '+id);
  const mod={exports:{}}; __CC[id]=mod;
  fn(mod, mod.exports, __req);
  return mod.exports;
}
${files.map(f=>`__def(${JSON.stringify(f.id)}, function(module, exports, require){\n${f.src}\n});`).join('\n')}
`;

// ---------- 3. 适配层 ----------
const shim = `
/* ============================================================
 * 适配层 —— 把参赛者的五个方法接到界面的调用点上。
 *
 * view 按比赛裁判的口径构造(深拷贝 + 冻结):参赛者看到的东西必须和联赛里
 * 一模一样,否则这个页面就不是在展示同一个 AI。
 * 返回值只认牌的 id,兜底与罚分口径也和裁判一致(替出几张 × 5 分)。
 * ============================================================ */
const CONTESTANT=(function(){
  let ai=null, loadErr=null;
  try{ const f=window.__contestReq('index'); ai=(typeof f==='function')?f():f; }
  catch(e){ loadErr=e; }

  const V={n:0, pts:0, by:{}, soft:0};
  const bump=(k,fine)=>{ V.n++; V.by[k]=(V.by[k]||0)+1; if(fine) V.pts+=fine; paintVio(); };

  const cpCard=c=>Object.freeze({suit:c.suit, rank:c.rank, id:c.id});
  const cpCards=a=>Object.freeze(a.map(cpCard));
  const cpPlays=a=>Object.freeze(a.map(p=>Object.freeze({seat:p.seat, cards:cpCards(p.cards)})));

  function pub(){
    return {
      trumpRank: G.trumpRank, dealerKnown: G.dealerKnown, dealer: M.dealer,
      firstTaker: G.firstTaker,
      curDecl: G.decl?Object.freeze({seat:G.decl.seat, suit:G.decl.suit, strength:G.decl.strength}):null,
      rebelHappened: G.rebelHappened,
      levels: Object.freeze(M.levels.slice()), played: Object.freeze(M.played.slice()),
      gates: Object.freeze((S.gatesOn?S.gates:[]).slice()), round: M.round,
      kittySize: RULES.kittySize,
    };
  }
  function mkView(seat, phase, extra){
    const v=Object.assign({
      phase, seat, myTeam:seat%2,
      hand: cpCards(phase==='deal'?visHand(seat):G.hands[seat]),
      trump: G.trump?Object.freeze({suit:G.trump.suit, rank:G.trump.rank}):null,
      declSeat: G.declSeat,
      history: cpPlays([...G.tricks.flatMap(t=>t.plays), ...G.trick]),
      buriedKnown: seat===G.declSeat?cpCards(G.buried||[]):Object.freeze([]),
    }, pub(), extra||{});
    return Object.freeze(v);
  }
  // 只认 id —— 参赛者返回什么形状的对象都无所谓
  function resolve(ret, hand, kind){
    const cs=Array.isArray(ret)?ret:(ret&&Array.isArray(ret.cards)?ret.cards:null);
    if(!cs||!cs.length){ bump(kind+':形状'); return null; }
    const byId=new Map(hand.map(c=>[c.id,c]));
    const out=[], used=new Set();
    for(const c of cs){
      const id=(c&&typeof c==='object')?c.id:c;
      if(!byId.has(id)){ bump(kind+':牌不在手上'); return null; }
      if(used.has(id)){ bump(kind+':重复出牌'); return null; }
      used.add(id); out.push(byId.get(id));
    }
    return out;
  }
  const call=(m, args, kind)=>{
    if(!ai||typeof ai[m]!=='function') return null;
    try{ return ai[m].apply(ai, args); }
    catch(e){ bump(kind+':抛异常'); return null; }
  };

  return {
    name: (ai&&ai.name)||${JSON.stringify(name)},
    loadErr, vio:V,

    // 亮主/加固 —— 校验与裁判一致,不合法当作没亮(不罚分)
    onDeal(seat){
      const vis=visHand(seat);
      if(!vis.length) return null;
      const ret=call('onDeal',[mkView(seat,'deal',{trumpRank:rankOf(seat)})],'onDeal');
      if(!ret) return null;
      const opt={suit: ret.suit===undefined?null:ret.suit, strength: ret.strength|0};
      const cands=[...declOptions(vis, rankOf(seat))];
      const jp=jokerPairOf(vis); if(jp) cands.push(jp);
      if(!cands.some(o=>o.suit===opt.suit&&o.strength===opt.strength)){
        bump('onDeal:不是合法选项'); return null;
      }
      const reinforce=canReinforce2(G.decl,seat,vis,rankOf(seat),G.rebelHappened)
                      && opt.suit===G.decl.suit && opt.strength===2;
      if(!reinforce && !canOverride(G.decl,opt,seat)){ V.soft++; paintVio(); return null; }
      return {opt, reinforce};
    },

    onRebel(seat, r){
      return call('onRebel',[mkView(seat,'rebel',{
        rebelReason:Object.freeze({pts:r.pts,nT:r.nT,byPts:r.byPts,byTrump:r.byTrump})})],'onRebel')===true;
    },

    discard(seat){
      const ret=call('discard',[mkView(seat,'discard')],'discard');
      let b=resolve(ret, G.hands[seat], 'discard');
      if(b && b.length!==RULES.kittySize){ bump('discard:张数不对', 5*RULES.kittySize); b=null; }
      else if(!b) V.pts+=5*RULES.kittySize;
      return b || aiDiscard(G.hands[seat], G.trump);     // 兜底用原版
    },

    lead(seat){
      const ret=call('lead',[mkView(seat,'lead',{trickNo:G.trickNo})],'lead');
      let cs=resolve(ret, G.hands[seat], 'lead');
      if(!cs){ cs=aiLead(G.hands[seat], G.trump, rng(G.seed+G.trickNo)); V.pts+=5*cs.length; }
      const chk=checkThrow(G.hands, seat, cs, G.trump);
      if(!chk.ok) cs=chk.forced;                          // 甩牌被吃:不算违规也不罚分
      return cs;
    },

    follow(seat){
      const lead=classify(G.trick[0].cards, G.trump);
      const ret=call('follow',[mkView(seat,'follow',{trickNo:G.trickNo}), cpPlays(G.trick)],'follow');
      let cs=resolve(ret, G.hands[seat], 'follow');
      if(cs && !isLegalFollow(G.hands[seat], lead, cs, G.trump)){ bump('follow:不合法'); cs=null; }
      if(!cs){ cs=genFollow(G.hands[seat], lead, G.trump, rng(G.seed+G.trickNo)); V.pts+=5*cs.length; }
      return cs;
    },
  };
})();

/* 观察页专用的调试口。比赛裁判那边没有这东西 —— 这里挂出来是为了:
 *   · 观察员能在控制台看 CONTESTANT.vio(违规明细)
 *   · 自动化验证能驱动一整局(见 contest/gen-viewer.js 的验证说明)
 */
window.CONTESTANT=CONTESTANT;
window.__viewer={
  get G(){ return G; }, get M(){ return M; }, get S(){ return S; },
  step, humanLowRebel, buryKitty, newRound,
};

// 右下角的违规计数 —— 频繁出非法牌的 AI,观察员一眼就该看见
function paintVio(){
  const el=document.getElementById('vioTag');
  if(!el) return;
  const V=CONTESTANT.vio;
  if(!V.n&&!V.soft){ el.textContent=''; el.style.color=''; return; }
  el.textContent='违规 '+V.n+' 次,罚 '+V.pts+' 分';
  el.title=JSON.stringify(V.by);
  el.style.color=V.n?'#ff8f6e':'';
}
`;

// ---------- 4. patch 界面块 ----------
const P=[];
const patch=(from,to,tag)=>P.push({from,to,tag});

// A. 亮主
patch(
`  if(canReinforce2(G.decl,seat,vis,rankOf(seat),G.rebelHappened)){
    const asPair=scoreDeclOption(ctx,{suit:G.decl.suit,strength:2}).score;
    const asSingle=scoreDeclOption(ctx,{suit:G.decl.suit,strength:1,hasPair:true}).score;
    if(asPair>asSingle&&rand()<0.9){
      applyDecl(seat,{suit:G.decl.suit,strength:2},true); return;
    }
  }
  const d=aiDeclDecide(ctx);
  if(!d) return;
  // 分数越过门槛越多,越果断;贴着门槛则留一点随机,避免四家行为整齐划一
  const margin=d.score-d.threshold;
  if(margin<0) return;
  if(rand()<Math.min(0.95,0.45+margin/40)) applyDecl(seat,d.opt,false);`,
`  // 【参赛版】亮主/加固整个交给参赛者,不再掷骰子 —— 骰子留在这边,亮主策略就看不出来了
  const r=CONTESTANT.onDeal(seat);
  if(r) applyDecl(seat, r.opt, r.reinforce);`,
'aiDeclThink');

// B. 低分造反
patch(
`  const rand=rng(G.seed*17+5);
  for(let s=1;s<4;s++){
    const r=canFullRebel(G.hands[s],G.trump);
    if(r.ok && s%2!==G.declSeat%2 && rand()<0.7){`,
`  for(let s=1;s<4;s++){
    const r=canFullRebel(G.hands[s],G.trump);
    if(r.ok && s%2!==G.declSeat%2 && CONTESTANT.onRebel(s,r)){`,
'aiLowRebel');

// C. 扣底
patch(
`    G.buried=aiDiscard(G.hands[G.declSeat],G.trump);`,
`    G.buried=CONTESTANT.discard(G.declSeat);          // 【参赛版】`,
'afterTrumpSet');

// D1. AI 座位出牌
patch(
`    const view=viewFor(seat);
    let cards, reason='';
    if(G.trick.length===0){
      const ch=aiChooseLead(view);
      cards=ch.cards; reason=ch.reason;
      const chk=checkThrow(G.hands,seat,cards,G.trump);
      if(!chk.ok) cards=chk.forced;
    }else{
      const lead=classify(G.trick[0].cards,G.trump);
      const ch=aiChooseFollow(view,G.trick);
      cards=ch.cards; reason=ch.reason;
      if(!isLegalFollow(G.hands[seat],lead,cards,G.trump))
        cards=genFollow(G.hands[seat],lead,G.trump,rng(G.seed+G.trickNo));
    }`,
`    // 【参赛版】三家 AI 全部换成参赛者;合法性仍由这边的引擎把关
    let cards, reason='';
    cards = G.trick.length===0 ? CONTESTANT.lead(seat) : CONTESTANT.follow(seat);`,
'step:AI 出牌');

// D2. 托管替人类出牌
patch(
`      const view=viewFor(HUMAN);
      if(G.trick.length===0){
        const ch=aiChooseLead(view); cards=ch.cards;
        const chk=checkThrow(G.hands,HUMAN,cards,G.trump);
        if(!chk.ok) cards=chk.forced;
      }else{
        const lead=classify(G.trick[0].cards,G.trump);
        const ch=aiChooseFollow(view,G.trick); cards=ch.cards;
        if(!isLegalFollow(G.hands[HUMAN],lead,cards,G.trump))
          cards=genFollow(G.hands[HUMAN],lead,G.trump,rng(G.seed+G.trickNo));
      }`,
`      // 【参赛版】托管也用参赛者的 AI —— 想看它整场怎么打,开托管就行
      cards = G.trick.length===0 ? CONTESTANT.lead(HUMAN) : CONTESTANT.follow(HUMAN);`,
'托管');

// ---------- 5. 组装 ----------
let html=fs.readFileSync(BASE,'utf8');
const B=html.match(/<script>[\s\S]*?<\/script>/g);
if(!B||B.length<3){ console.error('index.html 的 <script> 块结构变了'); process.exit(1); }

for(const p of P){
  if(!html.includes(p.from)){
    console.error(`✗ patch「${p.tag}」失配 —— index.html 的界面块改了?`);
    console.error(`  找不到:\n${p.from.split('\n').slice(0,3).join('\n')}\n  ...`);
    process.exit(2);
  }
  html=html.replace(p.from, p.to);
}

// 参赛代码作为独立脚本插在块① 之后(它只依赖 JS 内建)
const after1=html.indexOf(B[0])+B[0].length;
html=html.slice(0,after1) + `\n\n<script>${bundle}</script>` + html.slice(after1);

/* 适配层要读 G / M / S / visHand / rankOf —— 那些全在界面块的 IIFE 闭包里,
 * 所以它必须插进那个闭包。锚在 viewFor 的定义前。 */
const ANCHOR='function viewFor(seat){';
if(!html.includes(ANCHOR)){ console.error('✗ 找不到界面块的插入锚点 viewFor'); process.exit(2); }
html=html.replace(ANCHOR, shim + '\n' + ANCHOR);

/* localStorage 隔离。
 * 部署之后正式版和几个参赛版在同一个域名下,**共享 localStorage** ——
 * 设置、语言、尤其是**笔记**会串在一起,观察员对两个 AI 的记录混成一摊。
 * 每个参赛版换一套自己的 key。 */
const LS=`80fen-c-${name}-`;
const before=(html.match(/'80fentest-/g)||[]).length;
html=html.split("'80fentest-").join(`'${LS}`);
if(before===0){ console.error('✗ 找不到 localStorage key —— 正式版换写法了?'); process.exit(2); }

// 标记:两个参赛版长得一模一样,观察员开两个标签必须一眼分得清在看谁
html=html.replace(/<title>[^<]*<\/title>/, `<title>[${name}] 80分 参赛版</title>`);
html=html.replace(/<div id="versionTag">[^<]*<\/div>/,
  `<div id="versionTag">参赛版 <b style="color:#ffd479">${name}</b>` +
  ` <span style="opacity:.7">· 引擎与界面同正式版,只换了三家 AI</span>` +
  ` <span id="vioTag" style="margin-left:8px"></span></div>`);
// 那一行原本是 rgba(255,255,255,.3),太暗了看不见自己在看哪个 AI
html=html.replace('#versionTag{position:fixed;right:10px;bottom:4px;font-size:11px;color:rgba(255,255,255,.3);',
                  '#versionTag{position:fixed;right:10px;bottom:4px;font-size:12px;color:rgba(255,255,255,.62);');

// 教练默认关:它评分用的是原版 AI,不是参赛者的,开着会让人以为那是这个 AI 的想法
html=html.replace(`let C={on:true,`, `let C={on:false,`);

fs.writeFileSync(OUT, html);
console.log(`✓ ${path.basename(OUT)}  ${(html.length/1024).toFixed(0)}KB` +
            `(其中参赛代码 ${totalKB}KB:${files.map(f=>f.id).join(' ')})`);
console.log(`  patch ${P.length} 处全部命中,localStorage 前缀 ${LS}`);
// 「命中」只说明锚点找到了,不说明拼出来的能跑 —— 发出去之前必须真跑一局
console.log(`  下一步:node contest/verify-viewer.js ${path.basename(OUT)}`);
