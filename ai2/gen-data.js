/* ai2/gen-data.js —— 自对弈数据生成(egSearch:0)。
 *
 *   node ai2/gen-data.js --seed0=0 --n=300 --k=4 --out=<目录> [--html=80fen-test.html] [--ov='{"x":1}']
 *
 * 每个种子:
 *   1. 在线对局打一遍(fork=0),记下每一手之后的局面(全明牌原始记录,见 featurize.js),标签=这一副的终局闲家总分/5;
 *   2. 随机挑 k 个「候选 ≥ 2」的决策点,还原到那一刻,换成引擎自己候选表里**非选中**的一手(均匀随机),
 *      之后仍按 AI 打完。偏离那一手之后的所有局面用这一支的结局打标签;偏离之前的局面不会被打上偏离的结局;
 *   3. 每个 fork 写一行配对记录(pairs.ndjson):在线动作 / 偏离动作的启发式分数、两边结局。
 * 确定性:对局里没有 Math.random;fork 的选点、选候选用 rng(seed 派生)。同一种子永远写出同样的字节。
 * 输出:<out>/s<seed0>_<n>.bin(128 字节一条)与 .pairs.ndjson。 */
'use strict';
const fs=require('fs'),path=require('path');
const sim=require('./sim.js'), F=require('./featurize.js');

function genSeed(E, seed, K, recOut, pairOut, stats){
  const st=sim.newDeal(E,seed);
  const baseRecs=[];            // {raw}
  const elig=[];                // 有非选中候选的决策点
  let guard=0;
  while(!sim.finished(st)&&guard++<200){
    const pre=sim.snapshot(st);
    const d=sim.decide(st);
    const others=d.cands.filter(c=>c.key!==d.chosenKey);
    const ply0=st.nPly;
    sim.apply(st,d.seat,d.cards);
    if(sim.finished(st)) break;
    const raw=F.rawFromState(sim.stateView(st));
    raw[117]=0; raw[118]=st.nPly; raw[119]=0;
    new DataView(raw.buffer,raw.byteOffset).setUint32(120,seed,true);
    baseRecs.push(raw);
    if(others.length) elig.push({ply:ply0,pre,d,others,recIdx:baseRecs.length-1});
  }
  const sc=sim.outcome(st), baseTotal=sc.total;
  const lab=F.labelOf(baseTotal);
  for(const r of baseRecs){ r[116]=lab; recOut.push(r); }
  stats.base+=baseRecs.length;
  // fork
  const rr=E.rng((seed*2654435761)^0x5bd1e995);
  const pool=elig.slice(), chosen=[];
  while(chosen.length<K&&pool.length){ const i=Math.floor(rr()*pool.length); chosen.push(pool.splice(i,1)[0]); }
  chosen.sort((a,b)=>a.ply-b.ply);
  chosen.forEach((e,fi)=>{
    const fork=fi+1;
    const s2=sim.restore(e.pre,((seed*31+fork)^0x2545f491)>>>0);
    // 随机挑非选中候选;甩牌候选可能被引擎强制改成别的,改回和选中相同就换一个
    const order=e.others.slice(); let devCards=null, devCand=null;
    while(order.length){
      const i=Math.floor(rr()*order.length); const c=order.splice(i,1)[0];
      const cards=sim.legalize(s2,e.d.seat,c.cards);
      if(sim.keyOf(cards)!==e.d.chosenKey){ devCards=cards; devCand=c; break; }
    }
    if(!devCards) return;
    const recs=[];
    sim.apply(s2,e.d.seat,devCards);
    let first=true, g2=0;
    const put=()=>{
      if(sim.finished(s2)) return;
      const raw=F.rawFromState(sim.stateView(s2));
      raw[117]=fork; raw[118]=s2.nPly; raw[119]=first?1:0; first=false;
      new DataView(raw.buffer,raw.byteOffset).setUint32(120,seed,true);
      recs.push(raw);
    };
    put();
    while(!sim.finished(s2)&&g2++<200){
      const d2=sim.decide(s2); sim.apply(s2,d2.seat,d2.cards); put();
    }
    const sc2=sim.outcome(s2), l2=F.labelOf(sc2.total);
    for(const r of recs){ r[116]=l2; recOut.push(r); }
    stats.fork+=recs.length;
    const baseCand=e.d.cands.find(c=>c.key===e.d.chosenKey);
    pairOut.push(JSON.stringify({seed,fork,ply:e.ply,seat:e.d.seat,lead:e.d.isLead?1:0,
      nh:e.pre.hands[e.d.seat].length,nc:e.d.cands.length,declSeat:st.declSeat,
      sb:baseCand?baseCand.score:e.d.chosenScore,sd:devCand.score,
      tb:baseTotal,td:sc2.total,kb:e.d.chosenKey,kd:sim.keyOf(devCards),
      lb:sc.defendersWin?1:0,ld:sc2.defendersWin?1:0}));
  });
  stats.seeds++;
}

function run(opts){
  const E=sim.loadEngine(opts.html);
  E.AIP.egSearch=0;
  if(opts.ov) Object.assign(E.AIP,JSON.parse(opts.ov));
  const recs=[], pairs=[], stats={seeds:0,base:0,fork:0,err:0};
  const t0=Date.now();
  for(let s=opts.seed0+1;s<=opts.seed0+opts.n;s++){
    const r0=recs.length, p0=pairs.length;
    try{ genSeed(E,s,opts.k,recs,pairs,stats); }
    catch(e){ recs.length=r0; pairs.length=p0; stats.err++; console.error('seed',s,e.message); }
  }
  const buf=Buffer.alloc(recs.length*F.REC);
  recs.forEach((r,i)=>buf.set(r,i*F.REC));
  fs.mkdirSync(opts.out,{recursive:true});
  const base=path.join(opts.out,`s${opts.seed0}_${opts.n}`);
  fs.writeFileSync(base+'.bin',buf);
  fs.writeFileSync(base+'.pairs.ndjson',pairs.join('\n')+(pairs.length?'\n':''));
  stats.sec=(Date.now()-t0)/1000; stats.recs=recs.length; stats.pairs=pairs.length;
  fs.writeFileSync(base+'.meta.json',JSON.stringify(stats));
  return stats;
}

if(require.main===module){
  const a={seed0:0,n:300,k:4,out:'ai2-data',html:undefined,ov:process.env.OV};
  for(const x of process.argv.slice(2)){ const m=x.match(/^--(\w+)=(.*)$/); if(m) a[m[1]]=(['seed0','n','k'].includes(m[1])?+m[2]:m[2]); }
  const st=run(a);
  console.log(JSON.stringify(st),`${(st.sec/st.seeds).toFixed(2)} s/seed`);
}
module.exports={genSeed,run};
