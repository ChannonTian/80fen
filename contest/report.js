/* 把一次联赛的结果写成人能读的赛报。
 *
 *   node contest/report.js <league-result.json> [rounds.ndjson(.gz)] [--out=FILE]
 *
 * 两份输入分工不同:
 *   · league-result.json —— 积分榜和每一对的配对口径统计,排名靠它
 *   · rounds.ndjson.gz   —— 一局一条记录,赛报里的「打法画像」和复盘靠它
 * 只给第一份也能出报告,少一节而已。
 */
'use strict';
const fs=require('fs'), zlib=require('zlib'), path=require('path');

const argv=process.argv.slice(2);
const opt=(k,d)=>{ const a=argv.find(x=>x.startsWith(`--${k}=`)); return a?a.slice(k.length+3):d; };
const pos=argv.filter(a=>!a.startsWith('--'));
if(!pos[0]){ console.error('用法: node contest/report.js <league-result.json> [rounds.ndjson.gz]'); process.exit(1); }
const J=JSON.parse(fs.readFileSync(pos[0],'utf8'));
const OUT=opt('out', pos[0].replace(/\.json$/,'')+'.md');

// ---------- 统计小工具 ----------
const stat=a=>{ if(!a.length) return {n:0,m:0,se:0};
  const n=a.length, m=a.reduce((x,y)=>x+y,0)/n;
  const sd=Math.sqrt(a.reduce((x,y)=>x+(y-m)*(y-m),0)/n);
  return {n,m,sd,se:sd/Math.sqrt(n)}; };
// 标准正态上尾,用 Abramowitz-Stegun 26.2.17
const Phi=x=>{ const t=1/(1+0.2316419*Math.abs(x)), d=Math.exp(-x*x/2)/Math.sqrt(2*Math.PI);
  const p=1-d*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
  return x>=0?p:1-p; };
/* 符号检验:配对之后每个种子是一个独立读数,直接数正负号。
 * 净分差是重尾的,t 检验对它偏保守(NOTES/measurement.md 清单第 10 条)。 */
function signTest(arr){
  const nz=arr.filter(x=>x!==0), n=nz.length, pos=nz.filter(x=>x>0).length;
  if(!n) return {n:0,pos:0,p:1};
  const z=(Math.abs(pos-n/2)-0.5)/Math.sqrt(n/4);
  return {n, pos, p:2*(1-Phi(z))};
}
const sg=x=>(x>=0?'+':'')+x.toFixed(2);
const pf=p=>p<1e-4?p.toExponential(1):p.toFixed(4);

// ---------- 逐局记录 ----------
let rounds=null;
if(pos[1] && fs.existsSync(pos[1])){
  let buf=fs.readFileSync(pos[1]);
  if(/\.gz$/.test(pos[1])) buf=zlib.gunzipSync(buf);
  rounds=buf.toString('utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
}

/* 每名选手的打法画像 —— 全部从逐局记录重算,不依赖 league-result.json。
 * 谁在这一局坐庄:declTeam 和 aTeam 一样就是 a,否则是 b。 */
const prof={};
const P=id=>prof[id]||(prof[id]={rounds:0, decl:0, held:0, defPts:[], givePts:[],
  suit:{}, strength:{}, tricks:[], redeals:0, kittyMult:{}});
if(rounds) for(const m of rounds){
  for(const r of m.rounds){
    const dealer = (r.declTeam===m.aTeam) ? m.a : m.b;
    const other  = (r.declTeam===m.aTeam) ? m.b : m.a;
    const D=P(dealer), O=P(other);
    D.rounds++; O.rounds++;
    D.decl++;
    if(!r.defendersWin) D.held++;             // 庄家守住了
    D.givePts.push(r.total);                  // 坐庄时放出去多少分
    O.defPts.push(r.total);                   // 当闲家时拿到多少分
    const s=r.trump===null?'无主':r.trump;
    D.suit[s]=(D.suit[s]||0)+1;
    D.strength[r.declStrength]=(D.strength[r.declStrength]||0)+1;
    D.kittyMult[r.mult]=(D.kittyMult[r.mult]||0)+1;
    D.tricks.push(r.tricks); D.redeals+=r.redeals; O.redeals+=r.redeals;
  }
}

// ---------- 出报告 ----------
const L=[];
const w=s=>L.push(s);
const N=J.players.length;
w(`# 80分 AI 联赛 · 赛报`);
w('');
w(`| | |`);
w(`|---|---|`);
w(`| 日期 | ${new Date().toISOString().slice(0,10)} |`);
w(`| 选手 | ${J.players.join('、')}(${N} 名) |`);
w(`| 赛制 | 两两对过局,${N*(N-1)/2} 对 × ${J.seeds} 副牌 × 交换阵营 = 每对 ${J.seeds*2} 场 |`);
w(`| 裁判引擎 | \`${J.build}\` |`);
w(`| 一场的定义 | 打级,2 → A,过 ${'`'}2/5/10/13${'`'} 四道关,先打过 A 者胜 |`);
w('');
w(`交换阵营的意思是同一个 matchSeed 打两场,第二场两位选手换座位。`);
w(`**打级里配对只在第一局完全有效** —— 庄家轮换按输赢分叉,之后两场的牌序列必然发散,`);
w(`所以这里报的是「同一种子两场取平均」,不是严格的镜像对照。`);
w('');

// 积分榜
w(`## 积分榜`);
w('');
w(`| 名次 | 选手 | 胜-负 | 胜率 | 净胜级/场 | 每局净分 | 违规 | 罚掉 |`);
w(`|---:|---|---|---:|---|---:|---:|---:|`);
J.table.forEach((r,i)=>{
  w(`| ${i+1} | ${r.id} | ${r.w}-${r.l}${r.d?'-'+r.d:''} | ${(100*r.rate).toFixed(1)}% | `+
    `${sg(r.lvl.m)} ±${r.lvl.se.toFixed(2)} | ${sg(r.pts.m/2)} | ${r.vioCount||'—'} | ${r.vioApplied||'—'} |`);
});
w('');
w(`- **净胜级/场**:终局「我方级数 − 对方级数」,同种子两场取平均后再对种子求均值和 SE。`);
w(`  一场只有胜/负 1 bit,级数差是连续量,方差小得多,判断强弱看它。`);
w(`- **每局净分**:把整场拆回单副口径 —— 闲家拿 total、庄家方拿 200−total,再作差取半。`);
w(`- **违规**次数不含判断失误(如「压不过当前亮主」);**罚掉**是实际生效的罚分,不是名义值。`);
w('');

// 对战表
w(`## 对战表`);
w('');
w(`行对列,胜-负。`);
w('');
w(`| | ${J.table.map(r=>r.id).join(' | ')} |`);
w(`|---|${J.table.map(()=>'---').join('|')}|`);
for(const r of J.table)
  w(`| **${r.id}** | ${J.table.map(c=>r.id===c.id?'—':(r.opp[c.id]||'?')).join(' | ')} |`);
w('');

// 逐对
w(`## 每一对`);
w('');
w(`配对口径:同一种子的两场先合成一个数,再对种子求 SE。两边 AI 完全一样时`);
w(`每个种子恰好是 0、SE 也是 0;逐场口径却会把 d 和 −d 当成两个独立样本,`);
w(`凭空算出一个不小的 SE —— 这是 \`NOTES/measurement.md\` 记过的坑,这里守住。`);
w('');
for(const p of J.pairs){
  const L2=stat(p.pairL), P2=stat(p.pairP), W2=stat(p.pairW);
  const s=signTest(p.pairP);
  const games=p.winA+p.winB+p.draw;
  w(`### ${p.a} vs ${p.b}`);
  w('');
  w(`- 胜场 **${p.winA} : ${p.winB}**${p.draw?`(平 ${p.draw})`:''},共 ${games} 场 / ${p.rounds} 局`+
    (p.crashed?`,**崩溃 ${p.crashed} 场**`:''));
  w(`- 配对胜率 **${(100*W2.m).toFixed(1)}%** ±${(100*W2.se).toFixed(1)}%`);
  w(`- 级数差 **${sg(L2.m)} 级/场** ±${L2.se.toFixed(2)}(t=${L2.se?(L2.m/L2.se).toFixed(2):'—'})`);
  w(`- 每局净分 **${sg(P2.m/2)} 分** ±${(P2.se/2).toFixed(2)}`);
  w(`- 两边打出不同结果的种子 ${s.n}/${p.pairP.length}(${(100*s.n/(p.pairP.length||1)).toFixed(1)}%),`+
    `其中 ${p.a} 更好 ${s.pos}/${s.n},符号检验双尾 **p=${pf(s.p)}**`);
  const vr=(tag,v)=>v.count?w(`- ${tag} 违规 ${v.count} 次,实际罚掉 ${v.applied} 分 \`${JSON.stringify(v.by)}\``):null;
  vr(p.a,p.vio.a); vr(p.b,p.vio.b);
  w(`- AI 净思考时间 ${p.a} ${(p.vio.a.ms/1000).toFixed(0)}s / ${p.b} ${(p.vio.b.ms/1000).toFixed(0)}s`);
  w('');
}

// 打法画像
if(rounds){
  const totalRounds=rounds.reduce((a,m)=>a+m.rounds.length,0);
  w(`## 打法画像`);
  w('');
  w(`从 ${rounds.length} 场 / ${totalRounds} 局的逐局记录重算。`);
  w('');
  w(`| 选手 | 抢到庄 | 守擂成功 | 坐庄放分 | 当闲拿分 | 平均墩数 | 底翻×4以上 |`);
  w(`|---|---:|---:|---:|---:|---:|---:|`);
  for(const id of J.table.map(r=>r.id)){
    const q=prof[id]; if(!q) continue;
    const big=Object.entries(q.kittyMult).filter(([k])=>+k>=4).reduce((a,[,v])=>a+v,0);
    w(`| ${id} | ${(100*q.decl/q.rounds).toFixed(1)}% | ${q.decl?(100*q.held/q.decl).toFixed(1)+'%':'—'} | `+
      `${stat(q.givePts).m.toFixed(1)} | ${stat(q.defPts).m.toFixed(1)} | `+
      `${stat(q.tricks).m.toFixed(1)} | ${q.decl?(100*big/q.decl).toFixed(1)+'%':'—'} |`);
  }
  w('');
  w(`- **抢到庄**:这一局的庄家是他的比例。无庄盘靠亮主抢,有庄盘靠上一局守住。`);
  w(`- **守擂成功**:他坐庄的局里,闲家没打上去(\`defendersWin=false\`)的比例。`);
  w(`- **坐庄放分 / 当闲拿分**:同一个量的两面 —— 闲家最终拿到的 \`total\`(已含底翻)。`);
  w(`- **底翻×4以上**:被闲家扣底、且最后一墩不是单张的局。一墩甩牌就是 ×8。`);
w(`- 这一节是**跨所有对手**汇总的,对手强弱不同会拉动这些数 —— 看趋势,别拿它直接比高下。`);
  w('');
  w(`### 亮主偏好(只统计他坐庄的局)`);
  w('');
  w(`| 选手 | 花色分布 | 亮主强度 |`);
  w(`|---|---|---|`);
  const SN={S:'♠',H:'♥',D:'♦',C:'♣','无主':'无主'};
  const STN={0:'没人亮',1:'单张',2:'一对',3:'反主',4:'反反主'};
  for(const id of J.table.map(r=>r.id)){
    const q=prof[id]; if(!q||!q.decl) continue;
    const su=Object.entries(q.suit).sort((a,b)=>b[1]-a[1])
      .map(([k,v])=>`${SN[k]||k} ${(100*v/q.decl).toFixed(0)}%`).join('、');
    const st=Object.entries(q.strength).sort((a,b)=>a[0]-b[0])
      .map(([k,v])=>`${STN[k]||k} ${(100*v/q.decl).toFixed(0)}%`).join('、');
    w(`| ${id} | ${su} | ${st} |`);
  }
  w('');
}

// 记录
w(`## 记录文件`);
w('');
w(`| 文件 | 内容 |`);
w(`|---|---|`);
w(`| \`${path.basename(pos[0])}\` | 积分榜 + 每一对的配对样本(\`pairL\`/\`pairP\`/\`pairW\`,一个种子一个数)|`);
if(pos[1]) w(`| \`${path.basename(pos[1])}\` | 一行一场,\`rounds[]\` 里一局一条:庄家、亮主、闲家得分、罚分、级数怎么走的 |`);
w('');
w(`复盘某一局:`);
w('');
w('```sh');
w(`zcat ${pos[1]?path.basename(pos[1]):'rounds.ndjson.gz'} \\`);
w(`  | jq -c 'select(.a=="${J.players[0]}" and .seed==7)'`);
w('```');
w('');
w(`把某一对重跑一遍(同样的种子必然出同样的牌 —— 决策路径里没有 \`Math.random\`):`);
w('');
w('```sh');
w(`node contest/run.js <A> <B> ${J.seeds} --eg`);
w('```');
w('');

fs.writeFileSync(OUT, L.join('\n'));
console.log(`→ ${OUT}`);
