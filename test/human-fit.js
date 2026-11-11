/* 真人出牌拟合 · 阶段 1b:条件 logit(P(选 c) ∝ exp(θ_s·引擎分 + Σθ_k·x_ck)),领出 / 跟牌各一个模型。
 *
 *   node test/human-fit.js <decisions.jsonl 所在目录> [--boot=300] [--out=结果.json] [--seed=1]
 *
 * 数据来自 test/human-fit-data.js。纯 Node,无依赖。
 *   · 特征标准化(训练集上);L2 只罚特征、不罚引擎分的系数;优化用带回溯线搜索的牛顿法(维度 ≤ 50,稳)。
 *   · L2 强度:外层按局分 5 折(数据里的 fold = 局 id 哈希 mod 5),每个外层训练集内再按同一个 fold 号做内层 CV 选 λ。
 *   · 报告:引擎 argmax / (ii) 只有引擎分(温度)/ (iii) 引擎分 + 特征 / (iv) 只有特征 的留出一致率与平均对数损失;
 *     留一玩家(两位主要玩家);在「引擎首选拆对子而真人不拆」子集上的一致率;
 *     修正量(θ_k/θ_s,单位 = 引擎分)的自助法 SE(按局重抽);拆对子家族的有效代价表;置换检验。
 * 只有候选数 ≥2 的决策参与(只有 1 个候选的决策不含信息)。
 */
'use strict';
const fs=require('fs'), path=require('path');
const argv=process.argv.slice(2);
const opt=(k,d)=>{ const a=argv.find(x=>x.startsWith('--'+k+'=')); return a?a.slice(k.length+3):d; };
const dir=argv.find(a=>!a.startsWith('--'));
const BOOT=+opt('boot',300);
let SEED=+opt('seed',1);
const rnd=()=>{ SEED=(SEED*1664525+1013904223)>>>0; return SEED/4294967296; };

const feats=JSON.parse(fs.readFileSync(path.join(dir,'features.json'),'utf8'));
const decs=fs.readFileSync(path.join(dir,'decisions.jsonl'),'utf8').split('\n').filter(Boolean).map(JSON.parse);
/* 'added'(候选是不是枚举出来的)不进模型:凡是没做枚举的决策(多张跟牌、原分对不上的决策),新增候选就只有真人那一手,
 * 带着 added 特征会让模型靠「候选集怎么造的」认出真人的选择 —— 泄漏。 */
for(const k of ['lead','follow']){ const i=feats[k].indexOf('added'); if(i>=0){ feats[k].splice(i,1); for(const d of decs) if(d.kind===k) d.X=d.X.map(x=>x.filter((_,j)=>j!==i)); } }
const byKind={lead:decs.filter(d=>d.kind==='lead'&&d.n>=2&&d.chosen>=0), follow:decs.filter(d=>d.kind==='follow'&&d.n>=2&&d.chosen>=0)};

/* ---------------- 模型 ---------------- */
// 列规格:useS=用引擎分,useF=用特征。返回每个决策的候选行(Float64Array 数组)
function rowsOf(d,useS,useF){
  return d.X.map((x,i)=>{ const r=[]; if(useS) r.push(d.s[i]); if(useF) for(const v of x) r.push(v); return r; });
}
function standardize(ds,useS,useF){
  let dim=null, n=0, sum=null, sq=null;
  for(const d of ds){ const R=d._r[useS+'-'+useF]; for(const r of R){ if(!dim){ dim=r.length; sum=new Float64Array(dim); sq=new Float64Array(dim); } n++; for(let j=0;j<dim;j++){ sum[j]+=r[j]; sq[j]+=r[j]*r[j]; } } }
  const mean=new Float64Array(dim), sd=new Float64Array(dim);
  for(let j=0;j<dim;j++){ mean[j]=sum[j]/n; const v=sq[j]/n-mean[j]*mean[j]; sd[j]=v>1e-12?Math.sqrt(v):0; }
  return {mean,sd,dim};
}
function zrows(d,key,st){ // 标准化后的行(常数列置 0);不缓存,避免每次拟合都留一份
  return d._r[key].map(r=>{ const z=new Float64Array(st.dim); for(let j=0;j<st.dim;j++) z[j]=st.sd[j]>0?(r[j]-st.mean[j])/st.sd[j]:0; return z; });
}
function solve(A,b,n){ // 高斯消元(带部分主元),A 会被改
  for(let i=0;i<n;i++){ let p=i; for(let k=i+1;k<n;k++) if(Math.abs(A[k][i])>Math.abs(A[p][i])) p=k;
    [A[i],A[p]]=[A[p],A[i]]; [b[i],b[p]]=[b[p],b[i]];
    const piv=A[i][i]||1e-12;
    for(let k=i+1;k<n;k++){ const f=A[k][i]/piv; if(!f) continue; for(let j=i;j<n;j++) A[k][j]-=f*A[i][j]; b[k]-=f*b[i]; } }
  const x=new Float64Array(n);
  for(let i=n-1;i>=0;i--){ let s=b[i]; for(let j=i+1;j<n;j++) s-=A[i][j]*x[j]; x[i]=s/(A[i][i]||1e-12); }
  return x;
}
function objective(Z,ds,th,lam,nopen){ // Z: 每个决策的标准化行;返回 f,g,H
  const dim=th.length; let f=0; const g=new Float64Array(dim), H=Array.from({length:dim},()=>new Float64Array(dim));
  for(let di=0;di<ds.length;di++){
    const R=Z[di], ch=ds[di].chosen, m=R.length;
    const eta=new Float64Array(m); let mx=-1e300;
    for(let c=0;c<m;c++){ let e=0; const r=R[c]; for(let j=0;j<dim;j++) e+=th[j]*r[j]; eta[c]=e; if(e>mx) mx=e; }
    let Z0=0; for(let c=0;c<m;c++){ eta[c]=Math.exp(eta[c]-mx); Z0+=eta[c]; }
    f+=Math.log(Z0)+mx; { let e=0; const r=R[ch]; for(let j=0;j<dim;j++) e+=th[j]*r[j]; f-=e; }
    const mu=new Float64Array(dim);
    for(let c=0;c<m;c++){ const p=eta[c]/Z0; const r=R[c]; for(let j=0;j<dim;j++) mu[j]+=p*r[j]; }
    for(let j=0;j<dim;j++) g[j]+=mu[j]-R[ch][j];
    for(let c=0;c<m;c++){ const p=eta[c]/Z0; const r=R[c];
      for(let a=0;a<dim;a++){ const ra=r[a]; if(ra===0) continue; const pa=p*ra; const Ha=H[a]; for(let b=0;b<=a;b++) Ha[b]+=pa*r[b]; } }
    for(let a=0;a<dim;a++) for(let b=0;b<=a;b++) H[a][b]-=mu[a]*mu[b];
  }
  for(let a=0;a<dim;a++) for(let b=a+1;b<dim;b++) H[a][b]=H[b][a];
  for(let j=nopen;j<dim;j++){ f+=0.5*lam*th[j]*th[j]; g[j]+=lam*th[j]; H[j][j]+=lam; }
  return {f,g,H};
}
function fitModel(ds,useS,useF,lam,init){
  const key=useS+'-'+useF;
  for(const d of ds) if(!d._r) d._r={}; for(const d of ds) if(!d._r[key]) d._r[key]=rowsOf(d,useS,useF);
  const st=standardize(ds,useS,useF), dim=st.dim, nopen=useS?1:0;
  const Z=ds.map(d=>zrows(d,key,st));
  let th=init&&init.length===dim?Float64Array.from(init):new Float64Array(dim);
  let cur=objective(Z,ds,th,lam,nopen);
  for(let it=0;it<60;it++){
    const A=cur.H.map(r=>Float64Array.from(r)); for(let j=0;j<dim;j++) A[j][j]+=1e-8;
    const step=solve(A,Float64Array.from(cur.g),dim);
    let t=1, ok=false;
    for(let ls=0;ls<30;ls++){
      const nt=th.map((v,j)=>v-t*step[j]); const nx=objective(Z,ds,nt,lam,nopen);
      if(nx.f<=cur.f+1e-10){ th=nt; ok=true; const dec=cur.f-nx.f; cur=nx; if(dec<1e-7) it=1e9; break; }
      t/=2;
    }
    if(!ok) break;
  }
  return {th,st,useS,useF,key};
}
function evalModel(model,ds){ // 每个决策:chosen 的对数概率、是否 argmax=chosen
  const out=[];
  for(const d of ds){
    if(!d._r) d._r={}; if(!d._r[model.key]) d._r[model.key]=rowsOf(d,model.useS,model.useF);
    const R=zrows(d,model.key,model.st), dim=model.th.length;
    let mx=-1e300, best=-1; const eta=[];
    for(let c=0;c<R.length;c++){ let e=0; for(let j=0;j<dim;j++) e+=model.th[j]*R[c][j]; eta.push(e); if(e>mx){ mx=e; best=c; } }
    let Z0=0; for(const e of eta) Z0+=Math.exp(e-mx);
    out.push({lp:eta[d.chosen]-mx-Math.log(Z0),hit:+(best===d.chosen),pick:best,d});
  }
  return out;
}
const LAMS=[0.3,1,3,10,30,100];
function chooseLam(train,useS,useF,foldKey){
  const folds=[...new Set(train.map(foldKey))];
  let best=null;
  for(const lam of LAMS){
    let ll=0, n=0;
    for(const f of folds){
      const tr=train.filter(d=>foldKey(d)!==f), te=train.filter(d=>foldKey(d)===f);
      if(!te.length||!tr.length) continue;
      const m=fitModel(tr,useS,useF,lam); const ev=evalModel(m,te);
      for(const e of ev){ ll-=e.lp; n++; }
    }
    ll/=Math.max(1,n);
    if(!best||ll<best.ll) best={lam,ll};
  }
  return best.lam;
}
const mean=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);

/* ---------------- 外层 CV ---------------- */
const VARIANTS=[['ii 只有引擎分',1,0],['iii 引擎分+特征',1,1],['iv 只有特征',0,1]];
function cv(ds,labelOf){ // labelOf:可选,置换检验时换标签
  const res={}; const lams={};
  for(const [name,uS,uF] of VARIANTS){
    const ev=[]; lams[name]=[];
    for(let f=0;f<5;f++){
      const tr=ds.filter(d=>d.fold!==f), te=ds.filter(d=>d.fold===f);
      if(!te.length) continue;
      const lam=uF?chooseLam(tr,uS,uF,d=>d.fold):1e-6; lams[name].push(lam);
      const m=fitModel(tr,uS,uF,lam); ev.push(...evalModel(m,te));
    }
    res[name]=ev;
  }
  return {res,lams};
}
function summarize(ev,ds){
  return {n:ev.length,agree:mean(ev.map(e=>e.hit)),ll:-mean(ev.map(e=>e.lp))};
}
const pct=x=>(100*x).toFixed(1)+'%';
function ci(arr){ const m=mean(arr), sd=Math.sqrt(arr.reduce((a,x)=>a+(x-m)**2,0)/Math.max(1,arr.length-1)); return sd/Math.sqrt(arr.length); }

const OUT={};
const t0=Date.now();
/* 数据集 B:只在引擎自己的候选表上排序(真人那手必须在表里)—— 部署时模型只能给引擎的候选重新排序,这才是对应的口径。 */
function engineOnly(ds){
  const out=[];
  for(const d of ds){
    if(d.inEng[d.chosen]!==1) continue;
    const idx=d.inEng.map((v,i)=>v?i:-1).filter(i=>i>=0); if(idx.length<2) continue;
    let ei=idx.indexOf(d.eng); if(ei<0){ let b=-1e18; idx.forEach((i,j)=>{ if(d.s[i]>b){ b=d.s[i]; ei=j; } }); }
    out.push({...d,X:idx.map(i=>d.X[i]),s:idx.map(i=>d.s[i]),inEng:idx.map(()=>1),n:idx.length,chosen:idx.indexOf(d.chosen),eng:ei,_r:undefined});
  }
  return out;
}
const SETS={
  A:(kind)=>byKind[kind].filter(d=>d.enumd===1),
  B:(kind)=>engineOnly(byKind[kind]),
};
const SETNAME={A:'A 全枚举(候选 = 引擎候选 ∪ 真人所出 ∪ 系统枚举;只含做了枚举的决策)',B:'B 只在引擎自己的候选表上排序(真人那手在表里的决策)'};
const SETSRUN=(opt('sets','AB')).split('');
const NOANALYSIS=argv.includes('--exportonly');
for(const setId of (NOANALYSIS?[]:SETSRUN)) for(const kind of ['lead','follow']){
  const ds=SETS[setId](kind); const K=feats[kind]; const iSplit=K.indexOf('splits'); const kk=kind+setId;
  console.log(`\n################ [${SETNAME[setId]}] ${kind==='lead'?'领出':'跟牌'}:${ds.length} 个决策(候选数≥2),${new Set(ds.map(d=>d.g)).size} 局 ################`);
  const uni=-mean(ds.map(d=>-Math.log(d.n)));
  const engHit=mean(ds.map(d=>+(d.eng===d.chosen)));
  const {res,lams}=cv(ds);
  console.log(`  均匀随机:对数损失 ${uni.toFixed(3)};引擎 argmax(原样)一致率 ${pct(engHit)}`);
  console.log('  按局 5 折留出:');
  console.log('    '+'模型'.padEnd(18)+'一致率'.padStart(8)+'对数损失'.padStart(10)+'   λ(各折)');
  const tab={engine:{agree:engHit}};
  for(const [name] of VARIANTS){ const s=summarize(res[name]); tab[name]=s;
    console.log('    '+name.padEnd(18-[...name].filter(c=>c.charCodeAt(0)>255).length)+pct(s.agree).padStart(8)+s.ll.toFixed(3).padStart(10)+'   '+lams[name].join(',')); }
  // 成对差(同一批留出决策)
  const e2=res['ii 只有引擎分'], e3=res['iii 引擎分+特征'], e4=res['iv 只有特征'];
  const dLL=e3.map((e,i)=>e2[i].lp-e.lp)   // 正 = iii 对数损失更小
  const dHit=e3.map((e,i)=>e.hit-engHitOf(e2[i].d));
  function engHitOf(d){ return +(d.eng===d.chosen); }
  console.log(`  (iii)−(ii) 对数损失改善 ${(-mean(dLL)).toFixed(4)} ±${ci(dLL).toFixed(4)}(负 = 变好,按决策配对 SE);  (iii)−引擎 argmax 一致率 ${(100*mean(dHit)).toFixed(2)} ±${(100*ci(dHit)).toFixed(2)} 个百分点`);
  tab.pairedLL=-mean(dLL); tab.pairedLLse=ci(dLL); tab.pairedHit=mean(dHit); tab.pairedHitse=ci(dHit);
  // 分段
  const slices=[['单张领出的跟牌',d=>d.sub==='follow1'],['多张领出的跟牌',d=>d.sub==='followN'],
    ['引擎首选拆对子且真人没拆',d=>iSplit>=0&&d.X[d.eng][iSplit]===1&&d.X[d.chosen][iSplit]===0],
    ['引擎首选拆对子且真人也拆',d=>iSplit>=0&&d.X[d.eng][iSplit]===1&&d.X[d.chosen][iSplit]===1],
    ['真人不在引擎候选表里',d=>d.inEng[d.chosen]===0]];
  console.log('  分段(留出,一致率:引擎 / ii / iii / iv;n):');
  for(const [nm,f] of slices){
    const idx=e3.map((e,i)=>f(e.d)?i:-1).filter(i=>i>=0); if(!idx.length) continue;
    const eh=mean(idx.map(i=>engHitOf(e3[i].d)));
    console.log(`    ${nm.padEnd(26-[...nm].length)}n=${String(idx.length).padStart(4)}  ${pct(eh).padStart(6)} / ${pct(mean(idx.map(i=>e2[i].hit))).padStart(6)} / ${pct(mean(idx.map(i=>e3[i].hit))).padStart(6)} / ${pct(mean(idx.map(i=>e4[i].hit))).padStart(6)}`);
  }
  tab.slices=slices.map(([nm,f])=>{ const idx=e3.map((e,i)=>f(e.d)?i:-1).filter(i=>i>=0); return {nm,n:idx.length,eng:mean(idx.map(i=>engHitOf(e3[i].d))),ii:mean(idx.map(i=>e2[i].hit)),iii:mean(idx.map(i=>e3[i].hit)),iv:mean(idx.map(i=>e4[i].hit))}; });
  OUT[kk]={cv:tab};

  /* 留一玩家 */
  const cnt={}; for(const d of decs){ cnt[d.p]=(cnt[d.p]||0)+1; }
  const top=Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,2).map(x=>x[0]);
  console.log('  留一玩家(训练 = 其余所有人;测试 = 该玩家):');
  OUT[kk].lopo={};
  for(const p of top){
    const tr=ds.filter(d=>d.p!==p), te=ds.filter(d=>d.p===p); if(te.length<20) continue;
    const row={n:te.length,eng:mean(te.map(d=>+(d.eng===d.chosen)))};
    let line=`    玩家 ${p} (本类 ${te.length} 手,占全部 by=h ${cnt[p]} 手)  引擎 ${pct(row.eng)}`;
    for(const [name,uS,uF] of VARIANTS){
      const lam=uF?chooseLam(tr,uS,uF,d=>d.fold):1e-6; const m=fitModel(tr,uS,uF,lam); const s=summarize(evalModel(m,te));
      row[name]=s; line+=`  | ${name.slice(0,3)} ${pct(s.agree)} ll ${s.ll.toFixed(3)}`; }
    // 同一批人按局 5 折(玩家在训练里)作对照:从 res 里抽该玩家的留出
    const own=e3.filter(e=>e.d.p===p), own2=e2.filter(e=>e.d.p===p);
    row.cvSame={iii:summarize(own),ii:summarize(own2)};
    line+=`\n        对照:同一玩家在按局 5 折里(训练含他自己别的局)  ii ${pct(row.cvSame.ii.agree)} ll ${row.cvSame.ii.ll.toFixed(3)} | iii ${pct(row.cvSame.iii.agree)} ll ${row.cvSame.iii.ll.toFixed(3)}`;
    console.log(line); OUT[kk].lopo[p]=row;
  }
  console.log(`  (用时 ${((Date.now()-t0)/1000).toFixed(0)} s)`);

  /* 置换检验:每个决策内打乱 chosen */
  {
    const sh=ds.map(d=>({...d,chosen:Math.floor(rnd()*d.n),_r:d._r}));
    const {res:rp}=cv(sh);
    const s2=summarize(rp['ii 只有引擎分']), s3=summarize(rp['iii 引擎分+特征']);
    console.log(`  置换检验(每个决策内随机换 chosen):ii ll ${s2.ll.toFixed(3)} 一致率 ${pct(s2.agree)} | iii ll ${s3.ll.toFixed(3)} 一致率 ${pct(s3.agree)}  → iii−ii 对数损失 ${(s3.ll-s2.ll).toFixed(4)}(≥0 = 没有虚假增益);均匀 ${(mean(ds.map(d=>Math.log(d.n)))).toFixed(3)}`);
    OUT[kk].perm={ii:s2,iii:s3};
  }

  /* 全量拟合 + 自助法 */
  const lamAll=chooseLam(ds,1,1,d=>d.fold);
  const full=fitModel(ds,1,1,lamAll);
  const names=['(引擎分)',...K];
  const corrOf=(m)=>{ // 修正量 = (θ_k/sd_k)/(θ_s/sd_s)
    const bs=m.th[0]/m.st.sd[0]; return Array.from(m.th).map((t,j)=>j===0?1:(m.st.sd[j]>0?(t/m.st.sd[j])/bs:0)); };
  const c0=corrOf(full);
  const boots=[]; const games=[...new Set(ds.map(d=>d.g))]; const byG={}; for(const d of ds){ (byG[d.g]=byG[d.g]||[]).push(d); }
  for(let b=0;b<BOOT;b++){
    const smp=[]; for(let i=0;i<games.length;i++){ const g=games[Math.floor(rnd()*games.length)]; smp.push(...byG[g]); }
    const m=fitModel(smp,1,1,lamAll,full.th); boots.push(corrOf(m));
  }
  const se=c0.map((_,j)=>{ const a=boots.map(b=>b[j]); const mm=mean(a); return Math.sqrt(a.reduce((x,y)=>x+(y-mm)**2,0)/(a.length-1)); });
  const rowsW=names.map((n,j)=>({n,c:c0[j],se:se[j],t:se[j]>0?c0[j]/se[j]:0})).filter((r,j)=>j>0&&full.st.sd[j]>0);
  rowsW.sort((a,b)=>Math.abs(b.t)-Math.abs(a.t));
  console.log(`\n  全量拟合(λ=${lamAll},θ_s 标准化系数 ${full.th[0].toFixed(3)}),修正量 = θ_k/θ_s,单位 = 引擎分;SE = ${BOOT} 次按局自助法;按 |t| 排序:`);
  console.log('    '+'特征'.padEnd(16)+'修正(分)'.padStart(10)+'SE'.padStart(8)+'t'.padStart(7));
  for(const r of rowsW) console.log('    '+r.n.padEnd(16)+r.c.toFixed(2).padStart(10)+r.se.toFixed(2).padStart(8)+r.t.toFixed(1).padStart(7)+(Math.abs(r.t)>=2?' *':''));
  OUT[kk].weights=rowsW; OUT[kk].lam=lamAll;
  OUT[kk].full={th:Array.from(full.th),sd:Array.from(full.st.sd),mean:Array.from(full.st.mean)};

  /* 拆对子家族的有效代价 */
  if(iSplit>=0&&setId==='A'||iSplit>=0&&kind==='follow'){
    const idx=n=>K.indexOf(n)+1;   // +1:引擎分占第 0 列
    const lin=(boot,terms)=>terms.reduce((a,[n,w])=>a+w*boot[idx(n)],0);
    const outMean=mean(ds.flatMap(d=>d.X.map(x=>x[K.indexOf('splits')]===1?x[K.indexOf(kind==='follow'?'splitOut10':'nOut10')]:null)).filter(x=>x!==null));
    console.log(`\n  拆对子的有效修正(分;负 = 比引擎分多罚,真人更不愿拆)—— 把 splits 主效应 + 阶段 / 身份交互 + (follow:splitOut10 取拆对候选的均值 ${outMean.toFixed(2)}) 加起来;SE 来自同一批自助样本`);
    const stg={st1:['splits*st1'],st2:['splits*st2'],st3:[]}, rol={decl:['splits*decl'],dpart:['splits*dpart'],def:[]};
    const extras=kind==='follow'?[['基准',[]],['+拖拉机',[['splitTract',1]]],['+大对(boss)',[['splitBoss',1]]],['+队友暂大',[['splits_pW',1]]]]:[['基准',[]]];
    OUT[kk].splitTable=[];
    for(const [en,eterms] of extras){
      console.log(`    [${en}]            庄家        庄家的对家        闲家`);
      for(const sg of ['st1','st2','st3']){
        let line=`      ${sg.padEnd(4)} `;
        for(const rl of ['decl','dpart','def']){
          const terms=[['splits',1],...stg[sg].map(n=>[n,1]),...rol[rl].map(n=>[n,1]),...eterms];
          if(kind==='follow') terms.push(['splitOut10',outMean]);
          const v=lin(c0,terms), a=boots.map(b=>lin(b,terms)); const mm=mean(a); const s=Math.sqrt(a.reduce((x,y)=>x+(y-mm)**2,0)/(a.length-1));
          line+=`${v.toFixed(1).padStart(8)} ±${s.toFixed(1).padEnd(5)}`;
          OUT[kk].splitTable.push({extra:en,stage:sg,role:rl,v,se:s});
        }
        console.log(line);
      }
    }
  }
}
/* ---- --export=文件:set B 上拟合三套权重(全部局 / 偶数 fold / 奇数 fold),修正量用原始特征单位(θ_k/sd_k ÷ θ_s/sd_s),写给 human-fit-embed.js ----
 * hfSet 1 = 用偶数 fold 的局训练(给奇数 fold 的局用);hfSet 2 = 用奇数 fold 训练(给偶数 fold 的局用)。 */
if(opt('export')){
  const EX={};
  for(const kind of ['lead','follow']){
    const ds=SETS.B(kind), K=feats[kind];
    const fitW=(sub,label)=>{
      const lam=chooseLam(sub,1,1,d=>d.fold); const m=fitModel(sub,1,1,lam);
      const bs=m.th[0]/m.st.sd[0];
      const c=Array.from(m.th).slice(1).map((t,j)=>m.st.sd[j+1]>0?(t/m.st.sd[j+1])/bs:0);
      console.log(`  [export] ${kind} ${label}: ${sub.length} 决策,${new Set(sub.map(d=>d.g)).size} 局,λ_L2=${lam},θ_s(标准化)=${m.th[0].toFixed(3)}`);
      return {c,lam,n:sub.length};
    };
    const all=fitW(ds,'全部'), h1=fitW(ds.filter(d=>d.fold%2===0),'偶数 fold'), h2=fitW(ds.filter(d=>d.fold%2===1),'奇数 fold');
    EX[kind]={names:K,sets:[all.c,h1.c,h2.c],lam:[all.lam,h1.lam,h2.lam],n:[all.n,h1.n,h2.n]};
  }
  fs.writeFileSync(opt('export'),JSON.stringify(EX,null,1));
  console.log('已写 '+opt('export'));
}
console.log(`\n总用时 ${((Date.now()-t0)/1000).toFixed(0)} s`);
if(opt('out')) fs.writeFileSync(opt('out'),JSON.stringify(OUT,null,1));
