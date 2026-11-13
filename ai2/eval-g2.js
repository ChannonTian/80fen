/* G2 排序评测(逐对输出,汇总见 report-g2.js)。
 *   node ai2/eval-g2.js --dir=<shard 目录> --w=<权重 json> --out=<ndjson> [--hold=9] [--worlds=60] [--part=0/4] [--maxseeds=N]
 * 对留出集(seed % 10 == hold)里每个 fork 配对 {在线动作 base, 偏离动作 dev}:
 *   重放该种子的在线对局到决策点,给出三种「dev 比 base 好多少」的预测:
 *     h  启发式分数差 sd − sb
 *     vt 真实世界里 V(dev 落子后局面) − V(base 落子后局面)(oracle 输入,真牌)
 *     vw 对 actor 视角抽样的 worlds 个世界取平均(endgameSearch 的 vnet 分支,即线上将使用的估计)
 * V 的取值都折成 actor 一方的「净升几级」(levelUtility,含 egPointsEps)与「期望本队得分」两个口径。 */
'use strict';
const fs=require('fs'),path=require('path');
const sim=require('./sim.js'), F=require('./featurize.js'), V=require('./vnet.js');
const a={dir:'',w:'',out:'',hold:9,worlds:60,part:'0/1',maxseeds:1e9};
for(const x of process.argv.slice(2)){ const m=x.match(/^--(\w+)=(.*)$/); if(m) a[m[1]]=isNaN(+m[2])||m[1]==='part'?m[2]:+m[2]; }
const [pi,pn]=a.part.split('/').map(Number);
const E=sim.loadEngine(); E.AIP.egSearch=0;
const model=V.load(JSON.parse(fs.readFileSync(a.w,'utf8')));
const pbuf=new Float32Array(model.nbins);
E.setVnet({probs:sv=>V.predictRaw(model,F.rawFromState(sv),pbuf)});

const pairs={};   // seed → [pair]
for(const f of fs.readdirSync(a.dir).filter(f=>f.endsWith('.pairs.ndjson')))
  for(const l of fs.readFileSync(path.join(a.dir,f),'utf8').split('\n').filter(Boolean)){
    const p=JSON.parse(l); if(p.seed%10!==a.hold) continue; (pairs[p.seed]=pairs[p.seed]||[]).push(p); }
const seeds=Object.keys(pairs).map(Number).sort((x,y)=>x-y).filter((s,i)=>i%pn===pi).slice(0,a.maxseeds);

function utilBins(team,declTeam){ const u=new Float64Array(41); for(let b=0;b<41;b++)
  u[b]=E.levelUtility(E.scoreRound({defPoints:5*b,kitty:[],defWonLastTrick:false,lastLeadSize:1}),team,declTeam); return u; }
const ptsBins=(team,declTeam)=>{ const u=new Float64Array(41); for(let b=0;b<41;b++) u[b]=declTeam===team?200-5*b:5*b; return u; };
const ex=(p,u)=>{ let s=0; for(let b=0;b<41;b++) s+=p[b]*u[b]; return s; };
const realU=(total,team,declTeam)=>E.levelUtility(E.scoreRound({defPoints:total,kitty:[],defWonLastTrick:false,lastLeadSize:1}),team,declTeam);
const realP=(total,team,declTeam)=>declTeam===team?200-total:total;

const out=fs.openSync(a.out,'w'); let nOut=0;
const t0=Date.now(); let msW=0, nW=0;
for(const seed of seeds){
  const want={}; let maxPly=0; for(const p of pairs[seed]){ (want[p.ply]=want[p.ply]||[]).push(p); maxPly=Math.max(maxPly,p.ply); }
  const st=sim.newDeal(E,seed);
  let g=0;
  while(!sim.finished(st)&&g++<200&&st.nPly<=maxPly){
    const ps=want[st.nPly];
    const d=sim.decide(st);
    if(ps){
      const seat=d.seat, team=seat%2, declTeam=st.declSeat%2;
      const uB=utilBins(team,declTeam), pB=ptsBins(team,declTeam);
      const pre=sim.snapshot(st);
      for(const p of ps){
        const byKey=k=>{ const ids=new Set(k.split(',').map(Number)); return st.hands[seat].filter(c=>ids.has(c.id)); };
        const cb=byKey(p.kb), cd=byKey(p.kd);
        const rec={seed:p.seed,fork:p.fork,lead:p.lead,nh:p.nh,nc:p.nc,sb:p.sb,sd:p.sd,
          ub:realU(p.tb,team,declTeam),ud:realU(p.td,team,declTeam),pb:realP(p.tb,team,declTeam),pd:realP(p.td,team,declTeam)};
        // vt:真实世界
        const vt=[];
        for(const cards of [cb,cd]){
          const s2=sim.restore(pre,1); sim.apply(s2,seat,cards);
          if(sim.finished(s2)){ vt.push(null); continue; }
          const pr=V.predictRaw(model,F.rawFromState(sim.stateView(s2)),pbuf);
          vt.push([ex(pr,uB),ex(pr,pB)]);
        }
        if(vt[0]&&vt[1]){ rec.vtB=vt[0][0]; rec.vtD=vt[1][0]; rec.vtpB=vt[0][1]; rec.vtpD=vt[1][1]; }
        // vw:抽样世界(endgameSearch 的 V 分支;egMaxCards=0 让所有手牌数都走 V)
        const view=sim.viewOf(st,seat), plays=st.plays.length?st.plays:null;
        const keep={...E.AIP};
        Object.assign(E.AIP,{egSearch:1,vnet:1,egMaxCards:0,vnetSamples:a.worlds,vnetMaxCands:4,egMaxCands:6});
        const tt=Date.now();
        let r1=E.endgameSearch(view,plays,[{cards:cb},{cards:cd}]);
        msW+=Date.now()-tt; nW++;
        E.AIP.egPointsEps=1000;
        let r2=E.endgameSearch(view,plays,[{cards:cb},{cards:cd}]);
        Object.assign(E.AIP,keep);
        if(r1){ rec.vwB=r1[0].u; rec.vwD=r1[1].u; rec.nw=r1.samples; }
        if(r2){ rec.vwpB=r2[0].u/1000; rec.vwpD=r2[1].u/1000; }
        fs.writeSync(out,JSON.stringify(rec)+'\n'); nOut++;
      }
    }
    sim.apply(st,d.seat,d.cards);
  }
}
fs.closeSync(out);
console.log(`part ${a.part}: ${seeds.length} 种子 ${nOut} 对, ${((Date.now()-t0)/1000).toFixed(0)}s, V 抽样 ${nW?(msW/nW).toFixed(0):'-'} ms/次(2 个候选 × ${a.worlds} 世界)`);
