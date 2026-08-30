/* 比赛跑分器
 *
 *   node contest/run.js <A.js> <B.js> [场数=100] [--eg] [--json out.json]
 *
 * 每个 matchSeed 跑**两场**并交换阵营:第一场 A 坐 (0,2),第二场 A 坐 (1,3)。
 * 打级和单副不一样 —— 交换阵营只能消掉**第一局**的牌运,之后庄家轮换按输赢分叉,
 * 两场的牌序列就发散了。所以这里同时打三个口径:
 *   · 胜场    —— 打级的定义,但一场只有 1 bit
 *   · 级数差  —— 终局 A 的级数 − B 的级数,连续量,方差小得多
 *   · 每局净分 —— 把整场拆回单副口径,样本量 ×30
 * 排名用胜场,判断"这次改动有没有用"看后两个。
 *
 * 每个参赛者在**自己的 realm** 里加载 —— 引擎、AI、以及**提交自己的代码**都在里面
 * (见 engine.js 的 createRealm)。改 Array.prototype、改 AIP、改引擎,
 * 都只改到自己那一份。裁判用第三份独立加载的引擎判合法性,谁也碰不到。
 *
 * `egSearch=0` 是在 mount **之前**设的,所以参赛者可以在自己的工厂里把它设回来。
 * 这是有意的:计算预算该由超时来管,不该由裁判禁用某个功能 —— 想搜就搜,代价是时间。
 */
'use strict';
const {load, createRealm}=require('./engine.js');
const {playMatch}=require('./referee.js');

const args=process.argv.slice(2);
const flags=new Set(args.filter(a=>a.startsWith('--')));
const pos=args.filter(a=>!a.startsWith('--'));
const [fileA, fileB]=pos;
const N=+pos[2]||100;
const BUILD=process.env.BUILD||'index.html';
if(!fileA||!fileB){
  console.error('用法: node contest/run.js <A.js> <B.js> [场数] [--eg]');
  process.exit(1);
}

// ---- 裁判自己的引擎:参赛者碰不到 ----
const REF=load(BUILD);
// ---- 每个参赛者一份独立的 realm:引擎、AI、以及**提交自己的代码**都在里面 ----
function mount(file, tag){
  const realm=createRealm(BUILD, tag);
  if(!flags.has('--eg')) realm.AI.AIP.egSearch=0;   // 默认关收官蒙特卡洛,快 4 倍
  const ai=realm.mount(file);
  for(const m of ['onDeal','onRebel','discard','lead','follow'])
    if(typeof ai[m]!=='function') console.error(`  ! ${file} 没有实现 ${m}(),该阶段将走裁判兜底`);
  return ai;
}
const A=mount(fileA,'A'), B=mount(fileB,'B');
// 兜底用裁判自己的那份基线,和参赛者无关
const FB={engine:REF.E,
  fallbackDiscard:(h,t)=>REF.AI.aiDiscard(h,t),
  fallbackLead:(h,t,rd)=>REF.AI.aiLead(h,t,rd)};

let winA=0, winB=0, draw=0, rounds=0, redeals=0;
const lvlDiff=[], ptsDiff=[];
/* 配对口径 —— NOTES/measurement.md 的核心教训,这里必须再守一次。
 * 把同一个 matchSeed 的两场(阵营对调)合成一个数,再对 N 个种子求 SE。
 * 两边 AI 完全一样时,两场是同一场的镜像 → D 每个种子都恰好是 0,SE 也是 0;
 * 逐场口径却会把 d 与 −d 当成两个独立样本,凭空算出一个不小的 SE。
 * 余下的方差全部来自两边**行为真的不同**的那些种子 —— 那才是要量的东西。 */
const pairL=[], pairP=[], pairW=[];
const vioA={count:0,by:{},ms:0}, vioB={count:0,by:{},ms:0};
const acc=(dst,v)=>{ dst.count+=v.count; dst.ms+=v.ms;
  const s=v.summary(); for(const k in s) dst.by[k]=(dst.by[k]||0)+s[k]; };

const t0=Date.now();
for(let s=1;s<=N;s++){
  const dL=[], dP=[], dW=[];
  for(const aTeam of [0,1]){                 // 交换阵营
    const aiOf=seat=>seat%2===aTeam?A:B;
    // 两场用**同一个** matchSeed:第一局的牌完全相同,只是阵营对调。
    // (打级里配对只在第一局有效 —— 庄家轮换按输赢分叉,之后两场的牌序列必然发散。)
    let r; try{ r=playMatch(s, aiOf, FB); }catch(e){ console.error('场次崩溃', s, aTeam, e.message); continue; }
    rounds+=r.rounds; redeals+=r.redeals;
    if(r.winnerTeam===aTeam){ winA++; dW.push(1); }
    else if(r.winnerTeam===null){ draw++; dW.push(0.5); }
    else { winB++; dW.push(0); }
    const dl=r.levels[aTeam]-r.levels[1-aTeam];
    lvlDiff.push(dl); dL.push(dl);
    // 每局净分:闲家拿 total,庄家方拿 200−total
    let sum=0;
    for(const h of r.history){
      const aPts = (h.declTeam===aTeam) ? 200-h.total : h.total;
      const d=aPts-(200-aPts);
      ptsDiff.push(d); sum+=d;
    }
    dP.push(r.history.length?sum/r.history.length:0);   // 先按场取每局均值,再配对
    acc(vioA, r.vio[aTeam]); acc(vioB, r.vio[1-aTeam]);
  }
  // 只有两场都跑完才配得成对
  if(dL.length===2){ pairL.push((dL[0]+dL[1])/2); pairP.push((dP[0]+dP[1])/2);
                     pairW.push((dW[0]+dW[1])/2); }
  if(s%10===0) process.stderr.write(`\r  ${s}/${N} 种子  ${((Date.now()-t0)/1000/s).toFixed(1)}s/种子   `);
}
process.stderr.write('\r');

const stat=a=>{ const n=a.length, m=a.reduce((x,y)=>x+y,0)/n;
  const sd=Math.sqrt(a.reduce((x,y)=>x+(y-m)*(y-m),0)/n); return {n,m,sd,se:sd/Math.sqrt(n)}; };
const L=stat(lvlDiff), P=stat(ptsDiff);
const pL=stat(pairL), pP=stat(pairP), pW=stat(pairW);
const games=winA+winB+draw, rate=winA/(winA+winB||1);
const seRate=Math.sqrt(rate*(1-rate)/(winA+winB||1));
// 符号检验:配对之后每个种子就是一个独立读数,直接数正负号。净分差是重尾的,
// t 检验对它偏保守(measurement.md 清单第 10 条)。
const nzArr=pairP.filter(x=>x!==0), nz=nzArr.length;
const posN=nzArr.filter(x=>x>0).length;
const z=nz?(Math.abs(posN-nz/2)-0.5)/Math.sqrt(nz/4):0;
const pSign=nz?2*(1-(x=>{ const t=1/(1+0.2316419*x), d=Math.exp(-x*x/2)/Math.sqrt(2*Math.PI);
  return 1-d*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429)))); })(z)):1;

console.log(`\n═══ ${A.name||fileA}  vs  ${B.name||fileB} ═══`);
console.log(`  ${N} 种子 × 交换阵营 = ${games} 场,共 ${rounds} 局(重发 ${redeals} 次),用时 ${((Date.now()-t0)/1000).toFixed(0)}s`);
const t=(m,se)=>se?(m/se).toFixed(2):'—';
console.log(`\n  胜场   A ${winA} : ${winB} B${draw?`  (平 ${draw})`:''}   胜率 ${(100*rate).toFixed(1)}%`);
console.log(`\n  ── 配对口径(看这个)──`);
console.log(`  胜率     ${(100*pW.m).toFixed(1)}%  (SE ${(100*pW.se).toFixed(1)}%, t=${t(pW.m-0.5,pW.se)})`);
console.log(`  级数差   ${pL.m>=0?'+':''}${pL.m.toFixed(2)} 级/场  (SE ${pL.se.toFixed(2)}, t=${t(pL.m,pL.se)})`);
console.log(`  每局净分 ${pP.m>=0?'+':''}${(pP.m/2).toFixed(2)} 分/局  (SE ${(pP.se/2).toFixed(2)}, t=${t(pP.m,pP.se)})`);
console.log(`  两边行为不同的种子 ${nz}/${pairP.length}(${(100*nz/(pairP.length||1)).toFixed(1)}%)`+
            `,其中 A 更好 ${posN}/${nz},符号检验双尾 p=${pSign<1e-4?pSign.toExponential(1):pSign.toFixed(4)}`);
console.log(`\n  ── 逐场口径(高估 SE,只作对照)──`);
console.log(`  胜率 ±${(100*seRate).toFixed(1)}%   级数差 SE ${L.se.toFixed(2)}`+
            `   每局净分 SE ${(P.se/2).toFixed(2)}(n=${P.n})`);
console.log(`\n  平均 ${(rounds/games).toFixed(1)} 局/场`);
const vr=(tag,v)=>console.log(`  ${tag} 违规 ${v.count}${v.count?'  '+JSON.stringify(v.by):''},AI 用时 ${(v.ms/1000).toFixed(1)}s`);
vr('A',vioA); vr('B',vioB);
if(flags.has('--json')){
  const out=pos[3]||'contest-result.json';
  require('fs').writeFileSync(out, JSON.stringify(
    {winA,winB,draw,rate,seRate,L,P,pL,pP,pW,nz,posN,pSign,rounds,vioA,vioB},null,2));
  console.log(`\n  → ${out}`);
}
