/* §S5 里 2026-09-05 新增的那些向量,拿引擎跑一遍。
 *
 *   node test/rules-vectors.js [build=index.html]
 *
 * 为什么单独一个文件:规则书的自测向量本来住在 html 的块②(219 条),
 * 但那是 build 里的东西,得走开发版→测试版→正式版那条流水线。
 * 这一版向量是比赛参赛者的反馈逼出来的,先在这里跑起来 ——
 * **写进规则书的向量必须先在引擎上跑过**,跑不过的要么是引擎的 bug、要么是我写错了,
 * 两种都不该悄悄进规则书。晋级时再并进块②。
 */
'use strict';
const {load}=require('../contest/engine.js');
const {E}=load(process.argv[2]||'index.html');

let pass=0, fail=0;
const ok=(name,got,want)=>{
  const good=JSON.stringify(got)===JSON.stringify(want);
  good?pass++:fail++;
  console.log(`  ${good?'\x1b[32m✓\x1b[0m':'\x1b[31m✗\x1b[0m'} ${name}` +
              (good?'':`\n      得到 ${JSON.stringify(got)},期望 ${JSON.stringify(want)}`));
};
let uid=0;
const C=(s,r)=>({suit:s, rank:r, id:s+r+':'+(uid++)});
const T={suit:'S',rank:2}, TA={suit:'S',rank:14}, NT={suit:null,rank:2};
const lead=cs=>({suit:E.effSuit(cs[0],T), cards:cs, ...E.classify(cs,T)});
const trick=(...cs)=>cs.map((c,i)=>({seat:i, cards:Array.isArray(c)?c:[c]}));

console.log(`\n§S5 新增向量 —— ${process.argv[2]||'index.html'}\n`);

console.log('牌序:打 A 时 rank < trumpRank 的那一支');
ok('ordIdx(♠2, 主♠打A) = 0',  E.ordIdx(C('S',2),TA), 0);
ok('ordIdx(♠K, 主♠打A) = 11', E.ordIdx(C('S',13),TA), 11);
ok('ordIdx(♥A, 主♠打A) = 12(副级)', E.ordIdx(C('H',14),TA), 12);
ok('ordIdx(♠A, 主♠打A) = 13(正级)', E.ordIdx(C('S',14),TA), 13);

console.log('\n牌型:同序号的对子分层,不再把链切断(§S3 ③,2026-09-07 改)');
const shape=(h,tr)=>E.decompose(h,tr).map(c=>c.type+(c.len||1)).sort();
{
  // ordIdx:♠A=11、异花的 2 都是 12(副级)、♠2=13(正级)、小王=14
  const h=[C('S',14),C('S',14), C('H',2),C('H',2), C('D',2),C('D',2), C('S',2),C('S',2)];
  ok('♠A♠A+♥2♥2+♦2♦2+♠2♠2 → 三连对 + 一对', shape(h,T), ['pair1','tractor3']);
  ok('maxTractorLen 报 3(贪心版只报 2)', E.maxTractorLen(h,T), 3);
  ok('classify 仍是甩牌,top 仍是 13', (c=>[c.type,c.top])(E.classify(h,T)), ['throw',13]);
}
{
  // 三门副级牌对都挤在 12 —— 第 0 层凑出 11→12→13→14 的四连对
  const h=[C('S',14),C('S',14), C('H',2),C('H',2), C('D',2),C('D',2), C('C',2),C('C',2),
           C('S',2),C('S',2), C('X',15),C('X',15)];
  ok('再加♣2♣2和小王对 → 四连对 + 两对', shape(h,T), ['pair1','pair1','tractor4']);
  ok('maxTractorLen 报 4(贪心版只报 3)', E.maxTractorLen(h,T), 4);
}
{
  // 同序号在低端:分层和贪心拿到的最长拖拉机一样长,只是哪一对进链不同
  const h=[C('H',2),C('H',2), C('D',2),C('D',2), C('S',2),C('S',2)];
  ok('♥2♥2+♦2♦2+♠2♠2 → 二连对 + 一对', shape(h,T), ['pair1','tractor2']);
  ok('maxTractorLen 报 2(与贪心版相同)', E.maxTractorLen(h,T), 2);
}
{
  // 没有同序号重复:分层退化成一趟扫,逐字等价
  const h=[C('S',3),C('S',3), C('S',4),C('S',4), C('S',5),C('S',5)];
  ok('♠3♠3+♠4♠4+♠5♠5 → 一个三连对(无重复时与贪心逐字等价)', shape(h,T), ['tractor3']);
}
{
  // 领出不成型:混门 classify 给 null —— 裁判据此罚「替出张数 × 5」(§J 2)
  ok('classify(♥5+♦7) = null(混门,不成型)', E.classify([C('H',5),C('D',7)],T), null);
}

console.log('\n跟牌义务');
{
  const h=[C('H',5),C('H',5),C('H',9),C('H',9),C('H',3)];
  const ld=lead([C('H',10),C('H',10)]);
  ok('本门有对必对:出 ♥5♥5 合法', E.isLegalFollow(h,ld,[h[0],h[1]],T), true);
  ok('本门有对必对:出 ♥5+♥3 非法', E.isLegalFollow(h,ld,[h[0],h[4]],T), false);
  ok('countPairsIn 数不相邻的对子 = 2', E.countPairsIn(h,T), 2);
}
{
  const h=[C('H',5),C('H',6),C('H',7),C('H',8),C('H',9),C('S',3)];
  const ld=lead([C('H',10),C('H',10)]);
  ok('本门 5 张无对、领出 2 张:出两张本门合法', E.isLegalFollow(h,ld,[h[0],h[1]],T), true);
  ok('本门还有牌却拿主凑张数:非法', E.isLegalFollow(h,ld,[h[0],h[5]],T), false);
}
{
  // partialTractorFollow 真正被触发,需要本门有**多余的**对子可拆
  const h=[C('H',3),C('H',3),C('H',4),C('H',4),C('H',6),C('H',6),C('H',12),C('H',12)];
  const ld=lead([C('H',9),C('H',9),C('H',10),C('H',10),C('H',11),C('H',11)]);
  ok('领出三连对,拆散成三个不相邻的对子 → 非法',
     E.isLegalFollow(h,ld,[h[0],h[1],h[4],h[5],h[6],h[7]],T), false);
  ok('领出三连对,带上手里的二连对 → 合法',
     E.isLegalFollow(h,ld,[h[0],h[1],h[2],h[3],h[4],h[5]],T), true);
  // 对照:本门只有二连对 + 散牌时,本门全出、根本没有可拆的余地
  const h2=[C('H',3),C('H',3),C('H',4),C('H',4),C('H',8),C('S',5),C('S',6)];
  ok('本门只有 5 张:全出即可,partial 规则无从触发',
     E.isLegalFollow(h2,ld,[h2[0],h2[1],h2[2],h2[3],h2[4],h2[5]],T), true);
}

console.log('\n甩牌:失败时强制出 top 最小的一组');
{
  const hands=[[C('H',3),C('H',3),C('H',14)], [C('H',13),C('H',13)], [], []];
  const r=E.checkThrow(hands, 0, hands[0].slice(), T);
  ok('甩 ♥3♥3+♥A、别家有 ♥K♥K → 不成立', r.ok, false);
  ok('强制出的是 ♥3♥3(一对),不是张数最少的 ♥A',
     r.forced.map(c=>c.rank).sort(), [3,3]);
}

console.log('\n无主局的一墩胜负');
ok('异花级数牌同级 → 先出的那家赢',
   E.resolveTrick(trick(C('S',2),C('H',2),C('D',2),C('C',5)), NT).winner, 0);
ok('级数牌是主,压副牌',
   E.resolveTrick(trick(C('H',5),C('S',2),C('H',7),C('H',9)), NT).winner, 1);

console.log('\n一局的结构:打到手牌出完,不是固定 25 墩');
{
  // 领出一对就会让这一墩消耗每人 2 张 —— 25 张手牌不可能再打满 25 墩
  const d=E.dealRound(7, 0);
  ok('每家发到 25 张', d.hands.map(h=>h.length), [25,25,25,25]);
  ok('底牌 8 张', d.kitty.length, 8);
  ok('一墩领出一对就消耗 2 张 → 墩数必然少于 25',
     E.classify([C('H',5),C('H',5)],T).cards.length, 2);
}

console.log('\n关卡开与关:同一组输入,整场推进表和必打关卡表给的是两个答案');
{
  const G=[2,5,10,13];
  const sc={defendersWin:true, total:150, kittyPts:0, mult:2, defenderLevelsUp:1, declarerLevelsUp:0};
  const lv=(gates,played)=>E.advanceMatch([2,2], 1, sc, gates, played).levels;
  ok('关卡关 → 队 0 升到 3', lv([], [-1,-1]), [3,2]);
  ok('关卡开、队 0 没在 2 上坐庄守住过 → 停在 2', lv(G, [-1,-1]), [2,2]);
  ok('关卡开、played=[2,-1] → 照常升到 3', lv(G, [2,-1]), [3,2]);
  ok('关卡开但根本不传 played → 不拦(没有记账就无从判断)', lv(G, undefined), [3,2]);
  ok('卡住时 gateHeld 报出关卡级', E.advanceMatch([2,2],1,sc,G,[-1,-1]).gateHeld, 2);
}

console.log('\n合法跟牌永远存在 —— 对子义务不会造出无解局面');
{
  /* 有参赛者报告 must 缺 ⌊k/2⌋ 封顶会造出无解局面。不成立:任何领出都满足
   * 2 × pairsInLead ≤ 张数,所以 must 对总放得下。这里就近取几个最容易出事的构造。 */
  const sub=(a,k,st=0,cur=[],out=[])=>{ if(cur.length===k){ out.push(cur.slice()); return out; }
    for(let i=st;i<a.length;i++){ cur.push(a[i]); sub(a,k,i+1,cur,out); cur.pop(); } return out; };
  const has=(hand,leadCards)=>{
    const l={suit:E.effSuit(leadCards[0],T), cards:leadCards, ...E.classify(leadCards,T)};
    return sub(hand, leadCards.length).some(c=>E.isLegalFollow(hand,l,c,T));
  };
  // 本门对子多于领出能容纳的对子数 —— zai-glm 说这里无解
  ok('领出 2 单张甩牌、本门 3 对 → 有合法跟牌',
     has([C('H',3),C('H',3),C('H',4),C('H',4),C('H',6),C('H',6)],
         [C('H',9),C('H',11)]), true);
  ok('领出 1 对 + 1 单(3 张)、本门 3 对 → 有合法跟牌',
     has([C('H',3),C('H',3),C('H',4),C('H',4),C('H',6),C('H',6)],
         [C('H',9),C('H',9),C('H',11)]), true);
  ok('领出三连对(6 张)、本门 4 对但连不成三连 → 有合法跟牌',
     has([C('H',3),C('H',3),C('H',6),C('H',6),C('H',9),C('H',9),C('H',12),C('H',12)],
         [C('H',4),C('H',4),C('H',5),C('H',5),C('H',7),C('H',7)]), true);
}

/* 引擎这三条**没有变**,变的是裁判:2026-09-07 起 referee.js 在领出之后先过一遍
 * classify,为 null 就替出、按「替出张数 × 5」罚(§J 2)。所以这三条现在是
 * 「为什么裁判必须自己拦」的依据 —— 指望 checkThrow 或 isLegalFollow 拦是拦不住的。 */
console.log('\n非法领出:引擎拦不住,所以裁判必须自己拦(§J 2,2026-09-07 修)');
{
  const mixed=[C('H',5), C('D',7)];
  ok('混门领出 classify 返回 null', E.classify(mixed,T), null);
  ok('checkThrow 见 null 直接放行(它只管甩牌成不成立)', E.checkThrow([[],[],[],[]],0,mixed,T).ok, true);
  let threw=false;
  try{ E.isLegalFollow([C('H',3),C('H',4)], E.classify(mixed,T), [C('H',3)], T); }
  catch(e){ threw=true; }
  ok('跟牌方会在 isLegalFollow 里抛异常(裁判不拦的话整场就作废在这儿)', threw, true);
}

console.log(`\n通过 ${pass} 项,失败 ${fail} 项\n`);
process.exit(fail?1:0);
