/* 80分 AI —— 用户反馈的九条，逐条做成可复现的场景断言。
 *
 * 用法：
 *   node ai-scenarios.js /path/to/80fen-dev.html
 *   node ai-scenarios.js /path/to/index.html
 *
 * 它做两件事：
 *   1) 从 html 里抽出第一个 <script> 块（引擎+AI），在 vm 里跑；
 *   2) 对每条反馈跑一个写死的牌面，打印实际选择 + 是否违反断言。
 * 目的是把「自对弈测不出来的配合类问题」变成可回归的硬断言 ——
 * 自对弈两边是同一个 AI，它从不带着意图去调王，这类题目根本不会被出出来。
 */
const fs=require('fs'), vm=require('vm'), path=require('path');
const file=process.argv[2];
if(!file){ console.error('用法: node ai-scenarios.js <80fen-dev.html|index.html>'); process.exit(1); }
const src=fs.readFileSync(file,'utf8');
const blocks=[...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const ctx={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};
ctx.globalThis=ctx; vm.createContext(ctx);
vm.runInContext(blocks[0],ctx,{filename:path.basename(file)});
const E=ctx.module.exports;

let _id=9000;
const RM={A:14,K:13,Q:12,J:11,T:10};
const C=s=>s==='XB'?{suit:'X',rank:16,id:_id++}
        :s==='XS'?{suit:'X',rank:15,id:_id++}
        :{suit:s[0],rank:RM[s.slice(1)]!==undefined?RM[s.slice(1)]:+s.slice(1),id:_id++};
const H=a=>a.map(C);
const nm=c=>c.suit==='X'?(c.rank===16?'大王':'小王'):c.suit+({14:'A',13:'K',12:'Q',11:'J'}[c.rank]||c.rank);
const ns=cs=>cs.map(nm).join(' ');
const T={suit:'S',rank:2};                       // 主=♠，打2

let pass=0, fail=0;
function check(id,title,got,ok,want){
  const good=ok(got);
  console.log(`${good?'  OK  ':'  FAIL'} [${id}] ${title}`);
  console.log(`        实际: ${got}`);
  if(!good) console.log(`        期望: ${want}`);
  good?pass++:fail++;
}

console.log(`\n===== ${path.basename(file)} =====\n`);

/* ── ① 保底手段：cheapSort 把大王/级数牌当成「便宜牌」 ───────────────── */
{
  const lead=E.classify(H(['DK']),T);
  const cur={suit:'D',top:11,type:'single'};
  const t=(cs)=>ns(E.minWinFollow(H(cs),lead,T,cur)||[]);   // certain=false：不确定能否守住
  check('1a','断门毙牌：手持 主A + 大王，应当出主A（大王是保底手段）',
        t(['SA','XB','H9']), g=>g==='SA', 'SA');
  check('1b','断门毙牌：手持 主K + 小王，应当出主K',
        t(['SK','XS','H9']), g=>g==='SK', 'SK');
  check('7a','断门毙牌：手持 主Q + 副常主(级数牌)，应当出主Q',
        t(['SQ','C2','H9']), g=>g==='SQ', 'SQ');
}

/* ── ⑨ 毙牌必赢时，应当兑现主牌里的分牌 ─────────────────────────────── */
{
  const lead=E.classify(H(['DK']),T);
  const cur={suit:'D',top:11,type:'single'};
  const t=cs=>ns(E.minWinFollow(H(cs),lead,T,cur,true)||[]);   // certain=true：末家，必定拿下
  check('9a','末家毙牌必赢：手持 主7/主10/主K，应当出主10（把分收进来）',
        t(['S7','S10','SK','H9']), g=>g==='S10', 'S10');
  check('9b','末家毙牌必赢：手持 主10/主J，应当出主10',
        t(['S10','SJ','H9']), g=>g==='S10', 'S10');
  // 全决策路径（不是直接调 minWinFollow）：末家、对手♦K暂大、我断门
  {
    const view={seat:3,trump:T,declSeat:0,history:[],buriedKnown:[],
      hand:H(['S10','S7','S9','C9','C8','H4','H3'])};
    const r=E.aiChooseFollow(view,[{seat:0,cards:H(['DK'])},{seat:1,cards:H(['D3'])},{seat:2,cards:H(['D4'])}]);
    check('9c','同上，走完整决策路径',`${ns(r.cards)}（${r.reason}）`,
          ()=>r.cards.length===1&&r.cards[0].rank===10, '主10');
  }
}

/* ── ⑧ 末家 + 队友已必赢 → 毙牌是纯浪费 ─────────────────────────────── */
{
  // 手上给一张副色分牌 C10：正解是把它贴给队友，而不是花一张主去毙一个已经赢下的墩
  const view={seat:3,trump:T,declSeat:0,history:[],buriedKnown:[],
    hand:H(['SA','S7','S5','C10','C8','H4','H3'])};
  const plays=[{seat:0,cards:H(['DQ'])},{seat:1,cards:H(['DK'])},{seat:2,cards:H(['D3'])}];
  const r=E.aiChooseFollow(view,plays);
  const isT=E.effSuit(r.cards[0],T)==='T';
  check('8','末家、队友♦K已锁定这墩、我♦断门 → 贴副色分牌，不该动主牌',
        `${ns(r.cards)}（${r.reason}）`, ()=>!isT, '贴 C10');
}

/* ── ③ 对手暂大 + 我断门 + 台面有分 → 应当毙 ─────────────────────────── */
{
  const view={seat:2,trump:T,declSeat:1,history:[],buriedKnown:[],
    hand:H(['SA','S7','S9','C9','C8','H4','H3','H6','C4','C5','H8','H9','H10'])};
  const plays=[{seat:1,cards:H(['DK'])},{seat:0,cards:H(['D3'])}]; // 座1对手领♦K暂大
  const r=E.aiChooseFollow(view,plays);
  check('3','对手♦K暂大、我♦断门有主、台面10分 → 应当毙',
        `${ns(r.cards)}（${r.reason}）`, ()=>E.effSuit(r.cards[0],T)==='T', '出主牌毙掉');
}

/* ── ④ 副色对子：一对J vs 一对8 ─────────────────────────────────────── */
{
  const view={seat:0,trump:T,declSeat:0,history:[],buriedKnown:[],
    hand:H(['CJ','CJ','C8','C8','C4','SA','S9','S7','H4','H3','D6','D7','D9'])};
  const sJ=E.coachScoreLead(view,H(['CJ','CJ'])), s8=E.coachScoreLead(view,H(['C8','C8']));
  check('4','副色一对J 应当优先于一对8（能压住对方的一对10）',
        `对J=${sJ.toFixed(1)}  对8=${s8.toFixed(1)}`, ()=>sJ>s8, '对J 分更高');
}

/* ── ⑤ 打2 无庄开局：不该造反自己对门 ───────────────────────────────── */
{
  const vis=H(['S2','S2','SA','SK','S9','S8','S7','C9','C8','H4','H3','D6']);
  const mk=o=>({vis,seat:0,trumpRank:2,curDecl:{seat:2,suit:'D',strength:1},
    dealerKnown:false,dealer:-1,firstTaker:0,gates:[],levels:[2,2],...o});
  const d=E.aiDeclDecide(mk({}));
  check('5','无庄开局、队友(座2)已亮♦ → 我不该用♠2对造反',
        d?`增量${d.score.toFixed(1)} vs 门槛${d.threshold.toFixed(1)} → ${d.pass?'造反':'不动'}`:'无候选',
        ()=>!d||!d.pass, '不动');
  const d2=E.aiDeclDecide(mk({curDecl:{seat:1,suit:'D',strength:1}}));
  check('5b','同一手牌、改成对手(座1)已亮♦ → 应当造反（对照组）',
        d2?`增量${d2.score.toFixed(1)} vs 门槛${d2.threshold.toFixed(1)} → ${d2.pass?'造反':'不动'}`:'无候选',
        ()=>d2&&d2.pass, '造反');
}

/* ── ② 调主：队友领小主，我持大主应当接过牌权（且要接得够高） ───────── */
{
  const hand=['SA','SK','S9','S8','C9','C8','C7','H4','H3','H6','D6','D7','D9'];
  const view={seat:3,trump:T,declSeat:0,history:[],buriedKnown:[],hand:H(hand)};
  const r=E.aiChooseFollow(view,[{seat:1,cards:H(['S4'])},{seat:2,cards:H(['S3'])}]);
  check('2a','中盘：队友领小主调主、对手跟小 → 我应当接过牌权',
        `${ns(r.cards)}（${r.reason}）`, ()=>E.ordIdx(r.cards[0],T)>E.ordIdx(C('S4'),T),
        '出比 S4 大的主牌');
  /* 2b 换成一个**中盘真实**的局面：大小王与正/副常主大都已现身，SA 已接近钢板。
   * 原来那版是一个 13 张手牌 + 空历史的合成局面，在外还有 12 张主压得住 SA ——
   * 那种情况下用 SA 去接本来就是坏棋，AI 选 S8 是对的。
   * 「接得够高」要在 SA 真的守得住的时候成立才算数。 */
  const hist=[
   {seat:0,cards:H(['XB'])},{seat:1,cards:H(['S3'])},{seat:2,cards:H(['XS'])},{seat:3,cards:H(['S6'])},
   {seat:0,cards:H(['XB'])},{seat:1,cards:H(['S7'])},{seat:2,cards:H(['XS'])},{seat:3,cards:H(['S5'])},
   {seat:0,cards:H(['S2'])},{seat:1,cards:H(['C2'])},{seat:2,cards:H(['S2'])},{seat:3,cards:H(['D2'])},
   {seat:0,cards:H(['H2'])},{seat:1,cards:H(['C2'])},{seat:2,cards:H(['D2'])},{seat:3,cards:H(['H2'])}];
  const v3={seat:3,trump:T,declSeat:0,history:hist,buriedKnown:[],
    hand:H(['SA','SK','S9','S8','C9','C8','C7','H4','H3'])};
  const r3=E.aiChooseFollow(v3,[{seat:1,cards:H(['S4'])},{seat:2,cards:H(['S3'])}]);
  check('2b','大牌已现身、SA 接近钢板时，接就要接得够高（别让末家用主10/主K掀走）',
        `${ns(r3.cards)}（${r3.reason}）`, ()=>ns(r3.cards)==='SA', 'SA');
  check('2d','反过来：在外还有十几张主压得住 SA 时，不该硬接（对照组）',
        ns(r.cards), g=>g!=='SA', '不是 SA');
  // 收官阶段（7 张）：AI 有 93% 的调主发生在这里，而 takeOverScoped 在 end 阶段直接关闭
  const v2={seat:3,trump:T,declSeat:0,history:[],buriedKnown:[],
    hand:H(['SA','SK','C9','C8','H4','H3','D6'])};
  const r2=E.aiChooseFollow(v2,[{seat:1,cards:H(['S4'])},{seat:2,cards:H(['S3'])}]);
  check('2c','收官阶段同样的局面 → 队友也该有人接（当前 takeOverScoped 在 end 阶段一律关闭）',
        `${ns(r2.cards)}（${r2.reason}）候选数=${r2.cands.length}`,
        ()=>r2.cands.some(c=>/接过|毙下来|压到/.test(c.reason||'')), '至少生成一个「接过牌权」候选');
}

/* ── ①⑥ 统计口径：跑一批自对弈，把关键比率打出来 ─────────────────────── */
{
  let n=0,lost=0,k10=0,k10lost=0;
  for(let s=1;s<=400;s++){
    try{ const r=E.simulateRound(s); if(!r) continue; n++;
      // simulateRound 未导出最后一墩归属，用 mult/total 反推不可靠 —— 这里只统计底分分布
      if(r.kittyPts>=10) k10++;
    }catch(e){}
  }
  console.log(`\n  [统计] ${n} 局自对弈，底分≥10 的局 ${k10} 局（${(100*k10/n).toFixed(0)}%）—— 护底该被触发的频率`);
}

console.log(`\n通过 ${pass} / 失败 ${fail}\n`);
process.exit(fail?1:0);
