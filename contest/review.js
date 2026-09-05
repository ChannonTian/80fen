/* 给一名选手出一份复盘 —— 他的分差是在哪些局面上丢的。
 *
 *   node contest/review.js <逐局记录.ndjson.gz> <选手名> [--out=FILE]
 *   node contest/review.js <逐局记录.ndjson.gz> --all      # 每名选手各出一份
 *
 * 积分榜只说谁强,复盘要回答「强在哪、弱在哪」。逐局记录里每一局都带着
 * 谁坐庄、亮的什么主、闲家拿了多少分、级数怎么走 —— 把这些按局面切开,
 * 差距就落到具体的一类局上,而不是一个总分。
 *
 * 切法都是**对称**的:同一个量,他和对手各算一遍,报的是差。
 * 只报他自己的绝对值没有意义 —— 对手强弱不同,数字会跟着漂。
 */
'use strict';
const fs=require('fs'), zlib=require('zlib'), path=require('path');

const argv=process.argv.slice(2);
const opt=(k,d)=>{ const a=argv.find(x=>x.startsWith(`--${k}=`)); return a?a.slice(k.length+3):d; };
const pos=argv.filter(a=>!a.startsWith('--'));
if(!pos[0]){
  console.error('用法: node contest/review.js <逐局记录.ndjson.gz> <选手名>|--all [--out=FILE]');
  process.exit(1);
}
let buf=fs.readFileSync(pos[0]);
if(/\.gz$/.test(pos[0])) buf=zlib.gunzipSync(buf);
const MATCHES=buf.toString('utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));

const ALL=[...new Set(MATCHES.flatMap(m=>[m.a,m.b]))];
const targets = argv.includes('--all') ? ALL : [pos[1]];
for(const t of targets){
  if(!ALL.includes(t)){ console.error(`✗ 记录里没有选手「${t}」。有:${ALL.join('、')}`); process.exit(1); }
}

const GATES=[2,5,10,13];
const SUIT={S:'♠',H:'♥',D:'♦',C:'♣',null:'无主'};
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const se=a=>{ if(a.length<2) return 0; const m=mean(a);
  return Math.sqrt(a.reduce((x,y)=>x+(y-m)*(y-m),0)/a.length)/Math.sqrt(a.length); };
const sg=(x,d=1)=>(x>=0?'+':'')+x.toFixed(d);
const pct=(a,b)=>b?((100*a/b).toFixed(1)+'%'):'—';

function review(me){
  const L=[]; const w=s=>L.push(s);
  /* 一局对「我」来说的四个事实:我坐庄吗、闲家拿了多少、这一级是不是关卡、我升了没。
   * 闲家得分 total 是**公有量**,庄家方的收益就是 200−total。 */
  const rows=[];
  for(const m of MATCHES){
    const opp = m.a===me ? m.b : m.a===me ? null : (m.b===me ? m.a : null);
    if(m.a!==me && m.b!==me) continue;
    const myTeam = (m.a===me) ? m.aTeam : 1-m.aTeam;
    const other  = (m.a===me) ? m.b : m.a;
    for(const r of m.rounds){
      const iDecl = r.declTeam===myTeam;
      rows.push({opp:other, seed:m.seed, no:r.no, iDecl,
        // 我这一局净拿多少分(单副口径):坐庄拿 200−total,当闲拿 total
        pts: iDecl ? 200-r.total : r.total,
        held: iDecl ? !r.defendersWin : null,      // 我坐庄,守住了吗
        broke: iDecl ? null : r.defendersWin,      // 我当闲,打上去了吗
        lvlBefore: r.before[myTeam],
        atGate: GATES.includes(r.before[myTeam]),
        oppAtGate: GATES.includes(r.before[1-myTeam]),
        up: r.after[myTeam]-r.before[myTeam],
        trump:r.trump, strength:r.declStrength, mult:r.mult, kittyPts:r.kittyPts,
        tricks:r.tricks, defWonLast:r.defWonLast, total:r.total});
    }
  }
  const decl=rows.filter(r=>r.iDecl), def=rows.filter(r=>!r.iDecl);

  w(`# 复盘 · ${me}`);
  w('');
  w(`2026-09-04 联赛,${me} 打过的 ${MATCHES.filter(m=>m.a===me||m.b===me).length} 场 / ${rows.length} 局。`);
  w('');
  w(`所有口径都是**单副口径**:一局的分数是闲家拿到的 \`total\`(已含底翻),`);
  w(`坐庄那方的收益就是 \`200 − total\`。「净分」= 我的收益 − 对方的收益 = 2×我的收益 − 200。`);
  w('');

  /* ---- 1. 分差是在坐庄还是当闲丢的 ----
   * 这一节只报**对称**的量。第一版报的是「我坐庄时的净分 +47.8 / 我当闲时 −32.5」,
   * 那是错的:坐庄方本来就拿得多,这两个数的差是游戏的不对称,不是这名选手的事实。
   * 对称的切法只有一个 —— 同样是坐庄,闲家从我这拿走多少、从对手那拿走多少。 */
  const A=mean(decl.map(r=>r.total));      // 我坐庄,闲家拿走(我放的分),越低越好
  const B=mean(def.map(r=>r.total));       // 对手坐庄,我拿走,越高越好
  w(`## 一、分差丢在哪一侧`);
  w('');
  w(`闲家最终拿到的 \`total\` 是**公有量**,同一局两边看到的是同一个数。`);
  w(`所以只有一种对称的切法:同样是坐庄,闲家从我这儿拿走多少、从对手那儿拿走多少。`);
  w('');
  w(`| 谁坐庄 | 局数 | 闲家拿走 | 越好的方向 |`);
  w(`|---|---:|---:|---|`);
  w(`| 我 | ${decl.length} | **${A.toFixed(1)}** | 越低越好(我守擂) |`);
  w(`| 对手 | ${def.length} | **${B.toFixed(1)}** | 越高越好(我进攻) |`);
  w('');
  const gap=B-A;
  w(gap>0
    ? `**${gap.toFixed(1)} 分的顺差** —— 我坐庄时放出去的比对手坐庄时放出去的少,两侧都占优。`
    : `**${(-gap).toFixed(1)} 分的逆差** —— 我坐庄时放出去的比对手坐庄时放出去的还多。`);
  w('');
  const net=(decl.length*(200-A)+def.length*B)/rows.length-100;
  w(`把两侧按局数加权合回去:**每局净分 ${sg(net)} 分**`);
  w(`(${decl.length} 局我坐庄 × ${(200-A).toFixed(1)} + ${def.length} 局我当闲 × ${B.toFixed(1)},除以 ${rows.length},再减去 100 分的中线。)`);
  w('');
  w(`口径同 \`test/ai-h2h.js\`:「净分」= (我的得分 − 对方的得分) / 2,也就是**比 100 分中线多拿几分**。`);
  w(`这个数和赛报上的会差一点 —— 赛报是**每场等权**(先按场取均值,再按种子配对),这里是**每局等权**`);
  w(`(所有局摊平)。场次长短不一,两种加权必然不同,不是哪个算错了。`);
  w('');
  w(`- 我坐庄守住:**${pct(decl.filter(r=>r.held).length, decl.length)}**(${decl.filter(r=>r.held).length}/${decl.length})`);
  w(`- 我当闲打上去:**${pct(def.filter(r=>r.broke).length, def.length)}**(${def.filter(r=>r.broke).length}/${def.length})`);
  w(`  —— 这两个数**加起来不该是 100%**:它们来自不同的局。`);
  w(`- 抢到庄的局占 **${pct(decl.length, rows.length)}** —— 打级里守住就继续坐庄,这个数多半是守擂率的果,不是因`);
  w('');

  // ---- 2. 关卡 ----
  w(`## 二、关卡局`);
  w('');
  w(`\`${GATES.join('/')}\` 四道关必须**坐庄守住**才过得去。关卡局赢一局抵得上平时好几局,`);
  w(`所以这里单独切一刀:同样是坐庄,在关卡上和不在关卡上,守擂率差多少。`);
  w('');
  w(`| 我坐庄时 | 局数 | 守住 |`);
  w(`|---|---:|---:|`);
  const g1=decl.filter(r=>r.atGate), g0=decl.filter(r=>!r.atGate);
  w(`| 我方在关卡上(${GATES.join('/')}) | ${g1.length} | ${pct(g1.filter(r=>r.held).length,g1.length)} |`);
  w(`| 我方不在关卡上 | ${g0.length} | ${pct(g0.filter(r=>r.held).length,g0.length)} |`);
  w('');
  const gd=(g1.length&&g0.length)?100*(g1.filter(r=>r.held).length/g1.length - g0.filter(r=>r.held).length/g0.length):0;
  w(Math.abs(gd)<3
    ? `差 ${sg(gd)} 个百分点 —— **关卡局和平时打得一样**。牌力是同一套,没有为关卡额外使劲。`
    : gd>0 ? `关卡局守擂率**高 ${gd.toFixed(1)} 个百分点** —— 到关卡会加把劲,是好事。`
           : `关卡局守擂率**低 ${(-gd).toFixed(1)} 个百分点** —— 最该守住的局反而更容易丢,值得查。`);
  w('');
  const og=def.filter(r=>r.oppAtGate);
  w(`我当闲、且**对方在关卡上**的局有 ${og.length} 局,我打上去 **${pct(og.filter(r=>r.broke).length,og.length)}**;`);
  w(`对方不在关卡上时是 ${pct(def.filter(r=>!r.oppAtGate&&r.broke).length, def.filter(r=>!r.oppAtGate).length)}。`);
  w(`拦住对方过关和自己过关一样值钱。`);
  w('');

  // ---- 3. 底 ----
  w(`## 三、底`);
  w('');
  w(`底分翻 \`2 × 最后一墩每人几张\`:单张 ×2、对子 ×4、拖拉机 ×8。`);
  w(`一手 40 分的底被拖拉机扣掉就是 320 分 —— 打级里单局最大的变量。`);
  w('');
  const bm={}; for(const r of decl) if(r.defWonLast) bm[r.mult]=(bm[r.mult]||0)+1;
  const beaten=decl.filter(r=>r.defWonLast);
  const gotKitty=def.filter(r=>r.defWonLast);   // 对手坐庄、我扣到底
  w(`| | 局数 | 底被扣掉 | 平均倍数 |`);
  w(`|---|---:|---:|---:|`);
  w(`| 我坐庄(护底) | ${decl.length} | ${pct(beaten.length,decl.length)} | ×${mean(beaten.map(r=>r.mult)).toFixed(2)} |`);
  w(`| 对手坐庄(我抠底) | ${def.length} | ${pct(gotKitty.length,def.length)} | ×${mean(gotKitty.map(r=>r.mult)).toFixed(2)} |`);
  w('');
  w(`护底那一行越低越好,抠底那一行越高越好。`);
  w('');
  w(`我坐庄被扣底的 ${beaten.length} 局,倍数分布:`);
  w('');
  w(`| 倍数 | 局数 | 占被扣底的 |`);
  w(`|---|---:|---:|`);
  for(const k of Object.keys(bm).sort((a,b)=>a-b))
    w(`| ×${k} | ${bm[k]} | ${pct(bm[k],beaten.length)} |`);
  w('');
  w(`被扣底那些局,闲家平均拿 ${mean(beaten.map(r=>r.total)).toFixed(1)} 分;`);
  w(`没被扣底的局 ${mean(decl.filter(r=>!r.defWonLast).map(r=>r.total)).toFixed(1)} 分。`);
  w(`差 **${(mean(beaten.map(r=>r.total))-mean(decl.filter(r=>!r.defWonLast).map(r=>r.total))).toFixed(1)} 分/局**。`);
  w('');

  // ---- 4. 亮主 ----
  w(`## 四、亮主`);
  w('');
  const byS={}, byT={};
  for(const r of decl){
    const k=r.strength; (byS[k]=byS[k]||[]).push(r.pts);
    const s=r.trump===null?'无主':r.trump; (byT[s]=byT[s]||[]).push(r.pts);
  }
  const SN={0:'没人亮(无主)',1:'单张',2:'一对',3:'反主',4:'反反主'};
  w(`只统计我坐庄的局。「守住」= 闲家没打上去。`);
  w('');
  w(`| 亮主强度 | 局数 | 守住 | 我方每局得分 |`);
  w(`|---|---:|---:|---:|`);
  for(const k of Object.keys(byS).sort((a,b)=>a-b)){
    const set=decl.filter(r=>r.strength==k);
    w(`| ${SN[k]||k} | ${set.length} | ${pct(set.filter(r=>r.held).length,set.length)} | ${mean(byS[k]).toFixed(1)} |`);
  }
  w('');
  w(`| 主花色 | 局数 | 守住 | 我方每局得分 |`);
  w(`|---|---:|---:|---:|`);
  for(const k of Object.keys(byT).sort((a,b)=>byT[b].length-byT[a].length)){
    const set=decl.filter(r=>(r.trump===null?'无主':r.trump)===k);
    w(`| ${SUIT[k]||k} | ${set.length} | ${pct(set.filter(r=>r.held).length,set.length)} | ${mean(byT[k]).toFixed(1)} |`);
  }
  w('');

  // ---- 5. 逐对 ----
  w(`## 五、对每个对手`);
  w('');
  w(`| 对手 | 局数 | 我坐庄守住 | 我当闲打上去 | 我方每局净分 |`);
  w(`|---|---:|---:|---:|---:|`);
  for(const o of [...new Set(rows.map(r=>r.opp))]){
    const R=rows.filter(r=>r.opp===o), D=R.filter(r=>r.iDecl), F=R.filter(r=>!r.iDecl);
    w(`| ${o} | ${R.length} | ${pct(D.filter(r=>r.held).length,D.length)} | `+
      `${pct(F.filter(r=>r.broke).length,F.length)} | ${sg(mean(R.map(r=>r.pts))-100)} |`);
  }
  w('');

  // ---- 6. 最差的局 ----
  w(`## 六、丢分最多的十局`);
  w('');
  w(`拿 seed 重跑就能完整复现这一局 —— 决策路径里没有 \`Math.random\`,同种子必然同牌同走法。`);
  w('');
  w(`| 对手 | seed | 第几局 | 我的位置 | 闲家得分 | 底翻 | 我方净分 |`);
  w(`|---|---:|---:|---|---:|---:|---:|`);
  for(const r of rows.slice().sort((a,b)=>a.pts-b.pts).slice(0,10))
    w(`| ${r.opp} | ${r.seed} | ${r.no} | ${r.iDecl?'庄家':'闲家'} | ${r.total} | ×${r.mult} | ${sg(r.pts-100)} |`);
  w('');
  w('```sh');
  w(`# 复现某一局(第一个数是 seed,跑够那么多种子才会走到它)`);
  w(`node contest/run.js <我的目录> <对手目录> <seed> --eg`);
  w('```');
  w('');
  return L.join('\n');
}

/* 文件名要能进 URL、能被脚本引用,所以非 ASCII 的选手名单独给一个 slug。
 * 报告正文里仍然用原名 —— 改的只是文件名。 */
const SLUG={'陪练':'baseline'};
const slug=n=>SLUG[n] || n.replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'') || 'player';

const OUTDIR=path.dirname(pos[0]);
const stamp=(path.basename(pos[0]).match(/^(\d{4}-\d{2}-\d{2})/)||[,'review'])[1];
for(const t of targets){
  const md=review(t);
  const out=opt('out', path.join(OUTDIR, `${stamp}-review-${slug(t)}.md`));
  fs.writeFileSync(out, md);
  console.log(`→ ${out}`);
}
