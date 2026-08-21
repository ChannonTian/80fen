/* 80分 AI —— 用户反馈的九条，逐条做成可复现的场景断言。
 *
 * 用法：
 *   node ai-scenarios.js /path/to/80fen-test.html
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
if(!file){ console.error('用法: node ai-scenarios.js <80fen-test.html|index.html>'); process.exit(1); }
const src=fs.readFileSync(file,'utf8');
const blocks=[...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const ctx={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};
ctx.globalThis=ctx; vm.createContext(ctx);
vm.runInContext(blocks[0],ctx,{filename:path.basename(file)});
const E=ctx.module.exports;
// 扫参时临时改开关:OV='{"nearBossHold":8}' node test/ai-scenarios.js index.html
if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV));

let _id=9000;
const RM={A:14,K:13,Q:12,J:11,T:10};
const C=s=>s==='XB'?{suit:'X',rank:16,id:_id++}
        :s==='XS'?{suit:'X',rank:15,id:_id++}
        :{suit:s[0],rank:RM[s.slice(1)]!==undefined?RM[s.slice(1)]:+s.slice(1),id:_id++};
const H=a=>a.map(C);
const nm=c=>c.suit==='X'?(c.rank===16?'大王':'小王'):c.suit+({14:'A',13:'K',12:'Q',11:'J'}[c.rank]||c.rank);
const ns=cs=>cs.map(nm).join(' ');
const T={suit:'S',rank:2};                       // 主=♠，打2
// [seat,'C1','C2',...] → {seat, cards} —— 把自对弈里捞到的真实残局冻下来用
const P=a=>a.map(x=>({seat:x[0],cards:H(x.slice(1))}));

let pass=0, fail=0, known=0;
/* 已确认的缺陷,修复前必然不过 —— 断言先写下来(规矩是先加场景再动代码),
 * 但不让整套变红。修好之后必须把 todo() 改回 check():真的过了这里会喊一声并计入失败,
 * 免得一条已经修好的断言永远挂在「已知未修」里没人管。 */
function todo(id,title,got,ok,want,note){
  const good=ok(got);
  console.log(`${good?'  !!!! ':'  待修 '} [${id}] ${title}`);
  console.log(`        实际: ${got}`);
  console.log(`        期望: ${want}${note?'  —— '+note:''}`);
  if(good){ console.log('        ^^ 这条已经过了,请把 todo() 改成 check()'); fail++; }
  else known++;
}
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

/* ── 送分：明知对手在这门断门，还带着分领这门 ─────────────────────────
 * 根因在 partnerRescueP：它把「队友本门还有更大的牌」当成能救这一墩，
 * 可只要有对手断门，这墩是被一张**主**盖走的，队友那张本门的 A 没用。
 * 配一条对照组：同样的牌面、没人断门时，该收这一墩就得收。 */
{
  const h=()=>H(['HK','H6','C6','C7','D4','D5','S6']);
  // 第1墩 0 领 HA，1 号垫方块 → 1 号红桃硬断门；第2墩 0 用 CA 保住牌权
  /* 两副牌,每个点数两张 —— 只出过一张 HA,HK 上面就还压着另一张 HA。
   * v0.7.8 加了 nearBossHold(「上面只剩一张」的留手溢价)之后,这一条会把
   * HK 压下去,对照组就测不出「断门」那件事了。把两张 HA 都放进历史,
   * HK 在两种情形下都是真钢板,E1 与 E1b 的唯一差别重新只剩「对手断不断门」。 */
  const base=[{seat:0,cards:H(['HA'])},{seat:2,cards:H(['HA'])},{seat:3,cards:H(['H4'])},
              {seat:0,cards:H(['CA'])},{seat:1,cards:H(['C3'])},
              {seat:2,cards:H(['C4'])},{seat:3,cards:H(['C5'])}];
  const mk=p1=>{const t=base.slice(); t.splice(1,0,{seat:1,cards:H([p1])}); return t;};
  const lead=hist=>E.aiChooseLead({seat:0,trump:T,declSeat:0,history:hist,
                                   buriedKnown:[],hand:h()});
  const rVoid=lead(mk('D9'));      // 1 号垫方块 = 红桃断门
  const rCtrl=lead(mk('H5'));      // 对照：1 号跟了红桃，没断门
  check('E1','已知对手在红桃断门 → 不该把 10 分的红桃K 领出去送毙',
        `${ns(rVoid.cards)}（${rVoid.reason}）`, ()=>ns(rVoid.cards)!=='HK', '不是 HK');
  check('E1b','对照组：没人断门时，这张红桃K 该收下这一墩',
        `${ns(rCtrl.cards)}（${rCtrl.reason}）`, ()=>ns(rCtrl.cards)==='HK', 'HK');
}

/* ── D「AA 打完无 K 有 Q，不该先打 Q」──────────────────────────────────
 * 病灶不是「领了张高牌」，是**把只差一张就成钢板的那个期权提前作废**。
 * 定点反事实分层给的判据有两条，所以正例/反例也要按这两条各配一组：
 *   · 在外更大的恰好一张   —— 反例：两张（这时留着没用，实测反而更差）
 *   · 这门我还有更小的牌   —— 反例：只剩这一张（留不留一样，还挡着断门）
 * 断言比的是**同一牌面下开关开与关的差**,与默认值解耦 —— 默认值多少都照样跑。
 * 但没有这个开关的旧版本(正式版尚未晋级时)整段跳过,否则会报一堆假失败。
 */
if('nearBossHold' in E.AIP){
  /* 两副牌 —— 「上面只剩一张」要求 ♦A ×2 和 ♦K ×1 都已经露过面,
   * 剩下的那一张 ♦K 就是我手上 ♦Q 头上唯一的压制。 */
  const outAA=[{seat:0,cards:H(['DA'])},{seat:1,cards:H(['D3'])},
               {seat:2,cards:H(['DA'])},{seat:3,cards:H(['DK'])},
               {seat:3,cards:H(['C9'])},{seat:0,cards:H(['C3'])},
               {seat:1,cards:H(['C4'])},{seat:2,cards:H(['C5'])}];
  // 对照:第二张 ♦A 还没出 → ♦Q 上面还有 ♦A、♦K 两张,这条不该生效
  const outA1=[{seat:0,cards:H(['DA'])},{seat:1,cards:H(['D3'])},
               {seat:2,cards:H(['D6'])},{seat:3,cards:H(['DK'])},
               {seat:3,cards:H(['C9'])},{seat:0,cards:H(['C3'])},
               {seat:1,cards:H(['C4'])},{seat:2,cards:H(['C5'])}];
  const multi=['DQ','D4','D5','H7','H8','C7','S6'];   // 这门还有 ♦4 ♦5 可以改领
  const only =['DQ','H7','H8','H9','C7','C8','S6'];   // 这门只剩 ♦Q 一张
  /* 比的是**同一个牌面下、开关开与关**的差,不是两个牌面之间的差 ——
   * 两段历史里 ♦ 的已知情况本来就不同(leadWinP、oppVoidP 都会跟着变),
   * 拿它们互比会把别人的效果算到这一条头上。
   * 用 coachScoreLead 直接给 ♦Q 这一手打分,不去 cands 里捞 ——
   * cands 只留前几名,这条一生效 ♦Q 就掉出榜单,反而读成 NaN。 */
  const qScore=(hist,hand)=>{
    const h=H(hand);
    const view={seat:0,trump:T,declSeat:0,history:hist,buriedKnown:[],hand:h};
    const r=E.aiChooseLead(view);
    return {score:E.coachScoreLead(view,[h[0]]), pick:ns(r.cards), reason:r.reason};
  };
  const withSwitch=(v,f)=>{const o=E.AIP.nearBossHold;E.AIP.nearBossHold=v;
                           try{return f();}finally{E.AIP.nearBossHold=o;}};
  const ON=8;                                        // 断言用固定值,与默认值解耦
  const d=(hist,hand)=>withSwitch(ON,()=>qScore(hist,hand)).score
                      -withSwitch(0,()=>qScore(hist,hand)).score;
  check('D1','上面只剩 K 一张、这门我还有小牌 → 领出 ♦Q 要被扣分',
        `开关带来的差 ${d(outAA,multi).toFixed(2)}`, ()=>d(outAA,multi)<-1, '明显为负');
  check('D1b','对照组:上面还有 A、K 两张时不该扣(留着也当不成钢板)',
        `开关带来的差 ${d(outA1,multi).toFixed(2)}`, ()=>Math.abs(d(outA1,multi))<0.01, '恰好 0');
  check('D1c','对照组:这门只剩 ♦Q 一张时不该扣(留不留等价,出掉还能断门)',
        `开关带来的差 ${d(outAA,only).toFixed(2)}`, ()=>Math.abs(d(outAA,only))<0.01, '恰好 0');
  const pk=withSwitch(E.AIP.nearBossHold,()=>qScore(outAA,multi));
  console.log(`\n  [参考] 当前默认值下这一手实际领出:${pk.pick}(${pk.reason})`);
}

/* ── F 稳拿这墩时该不该把主分牌兑现（v0.7.9，cashWinPoints）───────────────
 * 报障：♦ 作主、末家毙牌，玩家出 ♦K 而教练说「更好的是 ♦3 —— 最后一手，毙掉收分」。
 * 两张同为主、同为毙，那句理由对两张同样成立 —— 建议与实际出牌在理由所指的事情上
 * 没有区别，这条建议本身就是错的。真正的区别只有一个：♦K 多收 10 分。
 * 而 ♦K 上面压着 14/33 的未见主，留在手里赢不了墩；主级数牌 ♦10 只压着 4/33，
 * 留着既能赢墩又能带走自己那 10 分 —— 那才是不该兑现的那种。
 * 比的是**同一牌面下开关开与关**，与默认值解耦。 */
if('cashWinPoints' in E.AIP){
  const CC=(su,r,i)=>({suit:su,rank:r,id:su+r+'_'+(i||1)});
  const nmOf=x=>x.suit+(x.rank===13?'K':x.rank===14?'A':x.rank);
  const P3=[{seat:0,cards:[CC('S',13)]},{seat:1,cards:[CC('S',5)]},{seat:2,cards:[CC('S',9)]}];
  const pick=(T,hand,plays,seat,on)=>{
    const o=E.AIP.cashWinPoints; E.AIP.cashWinPoints=on;
    try{ return E.aiChooseFollow({seat,hand,trump:T,declSeat:0,history:[],buriedKnown:[]},plays); }
    finally{ E.AIP.cashWinPoints=o; }
  };
  const T4={suit:'D',rank:4};
  const h4=[CC('D',13),CC('D',3),CC('D',6),CC('C',6),CC('C',7),
            CC('C',9),CC('H',8),CC('H',9),CC('H',2),CC('C',2)];
  const T10={suit:'D',rank:10};
  const h10=[CC('D',10),CC('D',3),CC('D',6),CC('C',6),CC('C',7),
             CC('C',9),CC('H',8),CC('H',9),CC('H',2),CC('C',2)];
  const off=(...a)=>nmOf(pick(...a,0).cards[0]);
  const on =(...a)=>nmOf(pick(...a,1).cards[0]);

  check('F1','末家稳拿、♦K 上面压着一大半主 → 该把这 10 分兑现',
        `关→${off(T4,h4,P3,3)}  开→${on(T4,h4,P3,3)}`,
        ()=>off(T4,h4,P3,3)==='D3'&&on(T4,h4,P3,3)==='DK', '关时 D3、开时 DK');
  check('F1b','对照组：非末家(不稳拿) → 不该兑现',
        `关→${off(T4,h4,[{seat:0,cards:[CC('S',13)]}],1)}  ` +
        `开→${on(T4,h4,[{seat:0,cards:[CC('S',13)]}],1)}`,
        ()=>off(T4,h4,[{seat:0,cards:[CC('S',13)]}],1)
           ===on(T4,h4,[{seat:0,cards:[CC('S',13)]}],1), '开关无差别');
  check('F1c','对照组：那张分牌是主级数牌 ♦10(上面只压着两王) → 留着,不该兑现',
        `关→${off(T10,h10,P3,3)}  开→${on(T10,h10,P3,3)}`,
        ()=>off(T10,h10,P3,3)===on(T10,h10,P3,3), '开关无差别');
  check('F1d','理由必须能区分建议牌与实际牌(不能只说「毙掉收分」)',
        pick(T4,h4,P3,3,1).reason,
        ()=>/兑现/.test(pick(T4,h4,P3,3,1).reason), '提到「兑现」而不是泛泛的毙牌');
}

/* ── G 甩牌只能甩整门 → 可以甩「压不住的那几组」子集（v0.7.9，throwBossSubset）──
 * 报障三条同一个根:候选生成里甩牌只取 bySuit[s]（整门）。
 * 手上 ♦A♦A + ♦K + ♦5 时，A 对和 K 单张都压不住，可整门带上那张 ♦5 就甩不成立，
 * 于是候选压根不生成 —— AAK / AKK 撒不出去、两对不会一起甩、教练也只能建议单张。
 * 为什么该甩：一墩里「后出的牌结构必须和领出的一样才参与比较」(RULES E)，
 * 两对一起甩要对手同时有两个主对才端得走，比分两次打安全得多。 */
if('throwBossSubset' in E.AIP){
  const GC=(su,r,i)=>({suit:su,rank:r,id:su+r+'_'+(i||1)});
  const gn=x=>x.suit+(x.rank===13?'K':x.rank===14?'A':x.rank===12?'Q':x.rank);
  const T2={suit:'H',rank:2};
  const lead=(hand,on)=>{
    const o=E.AIP.throwBossSubset; E.AIP.throwBossSubset=on;
    try{ return E.aiChooseLead({seat:0,hand,trump:T2,declSeat:0,history:[],buriedKnown:[]}); }
    finally{ E.AIP.throwBossSubset=o; }
  };
  const rest=[GC('H',7),GC('H',8),GC('S',6),GC('S',9),GC('C',4),GC('C',7)];
  // 正例：♦A♦A 是钢板对、♦K 单张也压不住（两张 A 都在我手）、♦5 压得住 → 甩 AAK
  const hAAK=[GC('D',14,1),GC('D',14,2),GC('D',13),GC('D',5)].concat(rest);
  // 对照：把 K 换成 Q，两张 ♦K 都在外 → Q 压得住 → 只剩一个钢板组件，不该甩
  const hAAQ=[GC('D',14,1),GC('D',14,2),GC('D',12),GC('D',5)].concat(rest);
  const sz=(h,on)=>lead(h,on).cards.length;

  check('G1','♦A♦A + 压不住的 ♦K + 带不动的 ♦5 → 甩 AAK,而不是只出一对',
        `关→${lead(hAAK,0).cards.map(gn).join('')}  开→${lead(hAAK,1).cards.map(gn).join('')}`,
        ()=>sz(hAAK,0)===2&&sz(hAAK,1)===3, '关时 2 张、开时 3 张');
  check('G1b','对照组:只有一个组件压不住(♦Q 上面还有 K)→ 不该甩',
        `关→${lead(hAAQ,0).cards.map(gn).join('')}  开→${lead(hAAQ,1).cards.map(gn).join('')}`,
        ()=>sz(hAAQ,0)===sz(hAAQ,1), '开关无差别');
  check('G1c','甩出去的每一组都必须是本门压不住的(不能把 ♦5 带上)',
        lead(hAAK,1).cards.map(gn).join(''),
        ()=>!lead(hAAK,1).cards.some(x=>x.rank===5), '不含 ♦5');
}

/* ── H 跨阶梯线:抢下这一墩就过线,AI 却退缩(#147 那一簇)─────────────────
 *
 * 局末目标是 0/40/80/120/160/200 一整排台阶,不是只有 80。`pointWeight` 用一个高斯
 * 包络近似「此刻一分值多少」,峰值钉在 gap = live/2,理由是「贴着 0 已基本注定」。
 * 但 gap≈0 一点也不注定 —— 它恰恰取决于此刻要不要去抢这一墩。于是差 5 分就赢下本局时,
 * 一分的权重反而低于差 15 分(闲家 75 分、还剩 30 分:0.970 vs 1.200)。
 *
 * 下面两个局面都是**从自对弈里捞出来的真实残局**(合成牌面在这个项目骗过好几次)。
 * 两边手牌都多于 egMaxCards,不在收官搜索视野内 —— 收官搜索本身以 levelUtility 为目标、
 * 阶梯是对的,所以缺陷只发生在视野之外,fixture 必须落在那里才测得到。
 *
 * `test/cf-line.js` 6000 副:跨线组 +0.33 ±0.06 个升级当量(t=5.34),
 * 对照组 −0.08 ±0.03(t=−3.15)—— **两组符号相反**。所以这是阶梯意识的缺陷,
 * 不是「AI 整体太被动」;H1b 就是钉住后者的对照,防止修法滑成「见暂大就抢」。
 */
{
  const HIST_CTRL=P([
    [0,'DQ','DQ'],[1,'D4','D6'],[2,'DT','DK'],[3,'D7','DJ'],[0,'D3','D3'],[1,'D5','D7'],[2,'D6','D9'],[3,'DK','DT'],
    [0,'C8','C8'],[1,'C5','C9'],[2,'C7','C7'],[3,'C4','C4'],[0,'C3','C3'],[1,'CA','S7'],[2,'CT','CK'],[3,'CJ','CQ'],
    [0,'D8','D8'],[1,'DA','S8'],[2,'DA','DJ'],[3,'S6','S4'],[0,'XB'],[1,'H3'],[2,'H5'],[3,'H7'],
    [0,'D9'],[1,'H7'],[2,'C6'],[3,'ST'],[1,'S3','S3'],[2,'SQ','SQ'],[3,'SA','SA'],[0,'CQ','CT'],
    [3,'CA','CK'],[0,'H3','H6'],[1,'S9','SJ'],[2,'CJ','ST'],[0,'XS','XS'],[1,'H9','H9'],[2,'H4','H4'],[3,'HJ','HQ']
  ]);
  const PLAY_CTRL=P([[0,'H2'],[1,'H8'],[2,'H6']]);
  const HAND_CTRL=['HK','C2','C5','S2','S4','H5','XB'];
  const HIST_LINE=P([
    [2,'H6','H6','H7','H7'],[3,'H8','H8','H4','H9'],[0,'HT','HK','H4','HJ'],[1,'H5','HK','HJ','HT'],[2,'S9','S9'],[3,'S3','S3'],[0,'S5','S7'],[1,'S6','S6'],
    [2,'H3','H3'],[3,'HQ','HA'],[0,'HA','CK'],[1,'D8','D8'],[1,'CA'],[2,'D4'],[3,'C3'],[0,'C5'],
    [2,'XS'],[3,'D3'],[0,'D3'],[1,'D4'],[2,'XB','XB'],[3,'D6','D9'],[0,'D7','D7'],[1,'DT','DT'],
    [2,'H9'],[3,'S4'],[0,'C3'],[1,'D6'],[1,'S7'],[2,'SJ'],[3,'SQ'],[0,'S8'],
    [3,'SA'],[0,'SJ'],[1,'ST'],[2,'ST'],[3,'C7','C7'],[0,'C4','CJ'],[1,'C8','CQ'],[2,'HQ','H5'],
    [3,'SK'],[0,'SA'],[1,'S4'],[2,'SK'],[0,'CA'],[1,'CT'],[2,'DQ'],[3,'C6']
  ]);
  const PLAY_LINE=P([[2,'S2'],[3,'DQ'],[0,'D5']]);
  const HAND_LINE=['D9','S8','DJ','S5','C2','XS'];
  const ask=(hand,hist,plays,seat,declSeat,trump)=>{
    const h=H(hand);
    const view={seat,trump,declSeat,history:hist,buriedKnown:[],hand:h};
    const r=E.aiChooseFollow(view,plays);
    const takes=E.currentWinner(plays.concat([{seat,cards:r.cards}]),trump).seat%2===seat%2;
    return {pick:ns(r.cards), takes, reason:r.reason, def:E.roundScore(view).def};
  };
  const TD={suit:'D',rank:2}, TH={suit:'H',rank:2};
  const a=ask(HAND_LINE,HIST_LINE,PLAY_LINE,1,2,TD);
  todo('H1','跨线:闲家 35 分、台面 5 分,抢下正好到 40 线(免被跳 2 级)—— 应当抢',
       a.pick+'(抢下='+a.takes+',闲家已得 '+a.def+' 分)—— '+a.reason,
       ()=>a.takes, '抢下这一墩(最省的抢法是小王)',
       'cf-line 实测这一手值 +1 个升级当量 / +10 分');
  const b=ask(HAND_CTRL,HIST_CTRL,PLAY_CTRL,3,0,TH);
  check('H1b','对照组:闲家 20 分、台面 0 分,抢下不跨任何线 —— 不该为它花大王',
        b.pick+'(抢下='+b.takes+',闲家已得 '+b.def+' 分)—— '+b.reason,
        ()=>!b.takes, '不抢(cf-line 实测抢下要亏 2 个升级当量)');
}

/* ── I「跟一对牌、垫其他花色废牌时,AI 还在凑对子」(v0.7.11,discardGreedy)────
 * 报障说的是**外观**,查下来 AI 没有凑对子的意图 —— 病根是「一次排序取前 k 张」:
 * 排序键按整手牌算,取走一张之后局面就变了而排序看不见。副牌的 ordIdx 只看点数,
 * ♠9 与 ♥9 的键完全相同又紧挨着,于是被成对取走(150 局自对弈:同点不同花 7 次);
 * 贴分那一路更糙(键只有分值+globalIdx),会把自家的对子整对丢出去或拆掉留个孤张。
 * 逐张贪心、每取一张重算键,三样一起治。
 * 配对口径 200 局:同门(造缺)103→119、两门各一张 57→44;贴分路拆对 14→12。
 *
 * 对照组 I1b 是必须的:修法很容易滑成「一律往同一门垫」,而另一门只剩单张时,
 * 垫掉那张单张才是真的造缺。 */
if('discardGreedy' in E.AIP){
  const LEAD_HH=E.classify(H(['H5','H5']),T);          // 对手领 ♥ 对子,我 ♥ 断门、手上无主
  const fill=(hand,strat,on)=>{
    const o=E.AIP.discardGreedy; E.AIP.discardGreedy=on;
    try{ const r=E.buildFollow(H(hand),LEAD_HH,T,strat,null); return r?ns(r):'null'; }
    finally{ E.AIP.discardGreedy=o; }
  };
  const sameSuit=s=>{const a=s.split(' ');return a.length===2&&a[0][0]===a[1][0];};
  // 两门都还长(各 3 张),最便宜的两张恰好同点不同花 —— 正是报障截图里 ♠9+♥9 那一手
  const H_SPREAD=['D9','DJ','DQ','C9','CJ','CQ','CK'];
  // 对照:♦ 只剩单张,垫掉它就是断门,不该为了「同门」硬留着
  const H_VOID1=['D9','C9','C7','C4','CK'];
  // 贴分路:♣8 是自家的对子,♦8+♦J 是等值(都不带分)的废牌
  const H_PAIR=['C8','D8','C8','DJ'];

  check('I1','两门都长、最便宜的两张同点不同花 → 该同门垫两张(造缺),不是两门各丢一张',
        `关→${fill(H_SPREAD,'discard',0)}  开→${fill(H_SPREAD,'discard',1)}`,
        ()=>!sameSuit(fill(H_SPREAD,'discard',0))&&sameSuit(fill(H_SPREAD,'discard',1)),
        '关时两门各一张、开时同门两张');
  check('I1b','对照组:另一门只剩单张(垫掉就断门)→ 两版都该垫那张单张,不是硬凑同门',
        `关→${fill(H_VOID1,'discard',0)}  开→${fill(H_VOID1,'discard',1)}`,
        ()=>fill(H_VOID1,'discard',0)===fill(H_VOID1,'discard',1), '开关无差别');
  check('I2','贴分(队友暂大)时不该动自家的对子 —— ♣8♣8 留着,贴 ♦8+♦J',
        `关→${fill(H_PAIR,'dump',0)}  开→${fill(H_PAIR,'dump',1)}`,
        ()=>fill(H_PAIR,'dump',1)==='D8 DJ'&&fill(H_PAIR,'dump',0)!=='D8 DJ',
        '关时动 ♣8 对、开时贴 D8 DJ');
  // 走完整决策路径:候选是生成出来了,但最后选中的是不是它,要由 scorePlay 说了算
  const vI={seat:3,trump:T,declSeat:2,history:[],buriedKnown:[],hand:H(H_SPREAD)};
  const pI=[{seat:2,cards:H(['H5','H5'])}];
  const path=on=>{const o=E.AIP.discardGreedy;E.AIP.discardGreedy=on;
    try{ return ns(E.aiChooseFollow(vI,pI).cards); } finally{ E.AIP.discardGreedy=o; }};
  check('I1c','同上,走完整决策路径(实际打出去的那一手)',
        `关→${path(0)}  开→${path(1)}`, ()=>sameSuit(path(1)), '开时同门两张');
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

console.log(`\n通过 ${pass} / 失败 ${fail}${known?` / 已知未修 ${known}`:''}\n`);
process.exit(fail?1:0);
