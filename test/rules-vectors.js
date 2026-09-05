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

console.log('\n牌型:同序号对子会断链(§S3 ③ 的已知偏差)');
{
  const h=[C('S',14),C('S',14), C('H',2),C('H',2), C('D',2),C('D',2), C('S',2),C('S',2)];
  const tr=E.decompose(h,T).filter(c=>c.type==='tractor').map(c=>c.len).sort();
  ok('♠A♠A+♥2♥2+♦2♦2+♠2♠2 → 两个二连对(而非一个三连对)', tr, [2,2]);
  ok('maxTractorLen 因此只报 2', E.maxTractorLen(h,T), 2);
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

console.log(`\n通过 ${pass} 项,失败 ${fail} 项\n`);
process.exit(fail?1:0);
