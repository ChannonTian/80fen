/* 真人出牌拟合 · 阶段 1a:把真人牌谱里每一手 by=h 的决策做成「候选集 + 引擎打分 + 特征 + 真人选了哪个」的数据集。
 *
 *   node test/human-fit-data.js <牌谱.jsonl>... --out=<目录> [--workers=2] [--limit=N]
 *
 * 输出(都在 --out 目录,不进仓库):
 *   decisions.jsonl   每手一行 {g,p,v,fold,kind,left,stage,role,n,chosen,eng,inEng[],s[],X[][],...}
 *   features.json    {lead:[特征名],follow:[特征名]}
 *   coverage.json    覆盖率统计(真人那手不在引擎自己的候选表里的比例、候选集大小、被丢弃的决策)
 *
 * 引擎:当前 80fen-test.html,AIP {pairKeep:0, pairKeepCands:1},收官搜索关(要的是启发式分,不是搜索的改判)。
 * 候选集 = 引擎候选表 ∪ 真人所出 ∪ 系统枚举:
 *   · 领出:每个不同的单张、每个对子、每个拖拉机(含子拖拉机,长度 ≥2);甩牌只有引擎或真人提出才有。
 *   · 单张领出的跟牌:每张不同的合法牌。多张领出的跟牌:引擎候选 ∪ 真人所出。
 * 给新增候选打分走引擎自己给「任意一手」打分的路径:跟牌 = aiChooseFollow(view,plays,extra).extraScore(教练用的 extra 参数,
 * 和引擎候选同一条流水线,含 ruff2Plan / feedPlan),领出 = coachScoreLead。
 * 这两条路径与引擎候选表里的原分并不处处一致(领出侧:trumpLeadRel / jokerLeadDef / leadVoidTrumpPen / kittyGuard 这些事后加减分只加在
 * 引擎自己生成的候选上;跟牌侧:个别生成器专属的规则加成)。口径:一个决策里只要有任何一个引擎候选的原分与 extra / coach 分对不上,
 * 这个决策就**不加枚举候选**(只留引擎候选 ∪ 真人所出),而且真人所出若不在引擎候选里就丢掉整个决策(不编造分数)。覆盖统计里记着个数。
 */
'use strict';
const fs=require('fs'), path=require('path'), crypto=require('crypto');
const {fork}=require('child_process');
const M=require('./records-seat-swap.js');
const {isTestGame}=require('./records-filter.js');
const argv=process.argv.slice(2);
const opt=(k,d)=>{ const a=argv.find(x=>x.startsWith('--'+k+'=')); return a?a.slice(k.length+3):d; };

let E=null, E2=null, CTX2=null;
const vm=require('vm');
function engine(){
  if(E) return E;
  const src=M.blockOf(fs.readFileSync(M.HTML,'utf8'));
  E=M.loadSrc(src);
  Object.assign(E.AIP,{egSearch:0,pairKeep:0,pairKeepCands:1});
  M.EXTRA_ENG.push(E);
  /* 第二份引擎(只在本脚本里对源码做文本改动,仓库里的引擎不动):领出候选生成处多收一批「额外组件」globalThis.__XC,
   * 让枚举出来的领法(拆对子领单张、拖拉机里的对子、子拖拉机、真人的甩牌)走引擎自己的 scoreLeadPlay + 事后加减分流水线。 */
  const needle="const comps=decompose(bySuit[s],trump);\n    for(const comp of comps){";
  if(src.split(needle).length!==2) throw new Error('领出候选生成处的源码对不上,无法注入额外组件');
  let src2=src.replace(needle,"const comps=decompose(bySuit[s],trump);\n    for(const comp of comps.concat((globalThis.__XC||[]).filter(q=>effSuit(q.cards[0],trump)===s))){");
  const needle2="const cl={type:comp.type,len:comp.len,suit:s,top:comp.top,cards:comp.cards};";
  if(src2.split(needle2).length!==2) throw new Error('领出候选 cl 构造处的源码对不上');
  src2=src2.replace(needle2,"const cl=comp.__cl?Object.assign({},comp.__cl,{cards:comp.cards}):{type:comp.type,len:comp.len,suit:s,top:comp.top,cards:comp.cards};");
  CTX2={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};
  CTX2.globalThis=CTX2; vm.createContext(CTX2); vm.runInContext(src2,CTX2); E2=CTX2.module.exports;
  Object.assign(E2.AIP,{egSearch:0,pairKeep:0,pairKeepCands:1});
  M.EXTRA_ENG.push(E2);
  return E;
}
const cs=cards=>cards.map(M.code).sort().join(',');

const stageOf=left=>left>=19?'st1':left>=13?'st2':'st3';
function roleOf(r){ const H=r.human, D=r.declSeat; return H===D?'decl':H%2===D%2?'dpart':'def'; }

/* 领出的系统枚举:单张(每个不同的牌)、对子、拖拉机及其子拖拉机 */
function leadEnum(view){
  const T=view.trump, hand=view.hand, out=[], seen=new Set();
  const add=cards=>{ const k=cs(cards); if(!seen.has(k)){ seen.add(k); out.push(cards); } };
  const by={}; for(const c of hand){ (by[c.suit+':'+c.rank]=by[c.suit+':'+c.rank]||[]).push(c); }
  for(const k in by){ add([by[k][0]]); if(by[k].length>=2) add([by[k][0],by[k][1]]); }
  const bySuit={}; for(const c of hand){ (bySuit[E.effSuit(c,T)]=bySuit[E.effSuit(c,T)]||[]).push(c); }
  for(const s in bySuit) for(const m of E.decompose(bySuit[s],T)) if(m.type==='tractor'){
    const n=m.len;
    for(let len=2;len<=n;len++) for(let i=0;i+len<=n;i++) add(m.cards.slice(i*2,(i+len)*2));
  }
  return out;
}
function followEnum(view,lead){
  const out=[], seen=new Set();
  for(const c of view.hand){ const k=c.suit+':'+c.rank; if(seen.has(k)) continue; seen.add(k);
    if(E.isLegalFollow(view.hand,lead,[c],view.trump)) out.push([c]); }
  return out;
}

function decisionOf(r,k,pn,hp,cov){
  const H=r.human, {st,partial}=M.stateAt(r,k,pn);
  const view=M.mkView(r,H,st,partial), left=st.hands[H].length;
  const stage=stageOf(left), role=roleOf(r);
  const pool=st.hands[H].slice(); const hum=[];
  for(const x of hp.cards){ const j=pool.findIndex(y=>M.code(y)===x); if(j<0) return null; hum.push(pool.splice(j,1)[0]); }
  const isLead=partial.length===0;
  const lead=isLead?null:E.classify(partial[0].cards,r.trump);
  const kindKey=isLead?'lead':(lead.type==='single'?'follow1':'followN');
  const res=isLead?E.aiChooseLead(view):E.aiChooseFollow(view,partial);
  let flip=false, lead2=null;
  const eng=(isLead?res.all:res.cands)||[];
  const engKey=new Set(eng.map(c=>cs(c.cards)));
  const humKey=cs(hum);
  const stat=cov[kindKey]||(cov[kindKey]={n:0,notIn:0,adjusted:0,dropped:0,sizes:[],added:0});
  stat.n++;
  const humIn=engKey.has(humKey); if(!humIn) stat.notIn++;
  let cands, adjusted=false, enumd=0;
  if(isLead){
    /* 领出:两遍。第 1 遍 = 引擎原样(原分);第 2 遍 = 同一个引擎多收一批枚举组件,只拿新增候选的分。
     * 第 2 遍里引擎候选的分若和第 1 遍对不上(额外组件改变了 trumpLeadRel 里「当前最高分候选」之类的全局量),
     * 这个决策就不收枚举候选,只留引擎候选 ∪ 真人所出,并记 flip。 */
    const mk=cards=>{ const cl=E.classify(cards,r.trump); return {type:cl.type,len:cl.len,top:cl.top,cards,__cl:cl.type==='throw'?cl:null}; };
    const want=[]; const seenK=new Set(engKey);
    const addW=cards=>{ const kk=cs(cards); if(!seenK.has(kk)){ seenK.add(kk); want.push(cards); } };
    addW(hum); for(const cards of leadEnum(view)) addW(cards);
    CTX2.__XC=want.map(mk);
    let r2; try{ r2=E2.aiChooseLead(view); }finally{ CTX2.__XC=null; }
    lead2=new Map(r2.all.map(c=>[cs(c.cards),c.score]));
    for(const c of eng){ const v=lead2.get(cs(c.cards)); if(v===undefined||Math.abs(v-c.score)>1e-6){ flip=true; break; } }
    if(flip) stat.adjusted++;
    cands=eng.map(c=>({cards:c.cards,score:c.score,inEng:1}));
    const have=new Set(engKey);
    for(const cards of want){
      const kk=cs(cards); if(flip&&kk!==humKey) continue;
      const v=lead2.get(kk); if(v===undefined) continue;
      have.add(kk); cands.push({cards,score:v,inEng:0});
    }
    adjusted=flip; enumd=flip?0:1;
    if(!humIn&&!cands.some(c=>cs(c.cards)===humKey)){ stat.dropped++; return null; }
  }else{
    const scoreFn=cards=>E.aiChooseFollow(view,partial,cards).extraScore;
    for(const c of eng){ const s2=scoreFn(c.cards); if(Math.abs(s2-c.score)>1e-6){ adjusted=true; break; } }
    if(adjusted) stat.adjusted++;
    if(adjusted&&!humIn){ stat.dropped++; return null; }
    cands=eng.map(c=>({cards:c.cards,score:c.score,inEng:1}));
    const have=new Set(engKey);
    const addC=(cards)=>{ const key=cs(cards); if(have.has(key)) return; have.add(key); cands.push({cards,score:scoreFn(cards),inEng:0}); };
    addC(hum);
    if(!adjusted&&lead.type==='single'){ enumd=1; for(const cards of followEnum(view,lead)) addC(cards); }
  }
  // 引擎真正出的牌(含 followFix / partnerRuffDump 等事后改判)落在哪个候选上;找不到就取原分最高
  const engPick=res.cards?cs(res.cards):null;
  let ei=cands.findIndex(c=>cs(c.cards)===engPick);
  if(ei<0){ let b=-1e18; cands.forEach((c,i)=>{ if(c.inEng&&c.score>b){ b=c.score; ei=i; } }); }
  const K=E.hfCtx(view);   // 特征由引擎里的 hfLeadFeats / hfFollowFeats 算(唯一一份)
  const X=cands.map(c=>isLead?E.hfLeadFeats(view,c.cards,K):E.hfFollowFeats(view,partial,c.cards,K,lead));
  const ci=cands.findIndex(c=>cs(c.cards)===humKey);
  stat.sizes.push(cands.length); stat.added+=cands.filter(c=>!c.inEng).length;
  return {g:r.id.slice(0,8),p:String(r.pid||'?').slice(0,6),v:(String(r.version).match(/v\d+\.\d+\.\d+/)||['?'])[0],
    fold:parseInt(crypto.createHash('md5').update(r.id).digest('hex').slice(0,8),16)%5,
    kind:isLead?'lead':'follow',sub:kindKey,k,left,stage,role,pos:pn,n:cands.length,chosen:ci,eng:ei,adjusted:+adjusted,enumd,
    inEng:cands.map(c=>c.inEng),s:cands.map(c=>+c.score.toFixed(4)),X,
    hum:hum.map(M.code),cards:cands.map(c=>c.cards.map(M.code))};
}

function processRecord(r){
  engine();
  const restore=M.applyRules(r); const out=[], cov={};
  try{
    for(let k=0;k<r.tricks.length;k++){
      const t=r.tricks[k], pn=t.plays.findIndex(p=>p.seat===r.human); if(pn<0) continue;
      const hp=t.plays[pn]; const by=hp.by==='a'?'auto':hp.by==='f'?'forced':hp.hint?'hint':'h';
      if(by!=='h') continue;
      let d=null; try{ d=decisionOf(r,k,pn,hp,cov); }catch(e){ cov.errors=(cov.errors||0)+1; cov.lastErr=String(e.stack).split('\n').slice(0,3).join(' | '); }
      if(d) out.push(d);
    }
  }finally{ restore(); }
  return {id:r.id,out,cov};
}

if(process.env.HFD_WORKER){
  process.on('message',m=>{ if(m.stop) process.exit(0);
    let res; try{ res=processRecord(m.r); }catch(e){ res={id:m.r.id,err:String(e.stack).slice(0,300)}; }
    process.send({res}); });
  process.send({ready:1});
}else if(require.main===module){
  (async()=>{
    const files=argv.filter(a=>!a.startsWith('--')), outDir=opt('out'), NW=+opt('workers',2);
    if(!files.length||!outDir){ console.log('用法:node test/human-fit-data.js <牌谱.jsonl>... --out=<目录> [--workers=2] [--limit=N]'); process.exit(1); }
    fs.mkdirSync(outDir,{recursive:true});
    const t0=Date.now(); const R=M.getCur(); const seen=new Map();
    for(const f of files) for(const l of fs.readFileSync(f,'utf8').split('\n')){ if(!l.trim()) continue; try{ const r=JSON.parse(l); seen.set(r.id,r); }catch(e){} }
    const recs=[], excl={};
    for(const r of seen.values()){
      const bump=k=>excl[k]=(excl[k]||0)+1;
      if(isTestGame(r)){ bump('自动测试局'); continue; }
      if(r.replay){ bump('重打 / 种子开局'); continue; }
      if(!r.initialHands){ bump('没有手牌的残局'); continue; }
      let why=''; try{ why=M.verify(R,r); }catch(e){ why='重放出错'; }
      if(why){ bump('验收不过'); continue; }
      recs.push(r);
    }
    if(opt('limit')) recs.length=Math.min(recs.length,+opt('limit'));
    console.log(`读入 ${seen.size} 局;排除 ${JSON.stringify(excl)};进入 ${recs.length} 局(含未打完的 ${recs.filter(r=>r.partial).length} 局)`);
    const results=new Map();
    await new Promise(done=>{
      let next=0, alive=0;
      const spawn=()=>{ const w=fork(__filename,[],{env:{...process.env,HFD_WORKER:'1'}}); alive++;
        const feed=()=>{ if(next<recs.length) w.send({r:recs[next++]}); else w.send({stop:1}); };
        w.on('message',m=>{ if(m.ready){ feed(); return; } if(m.res){ results.set(m.res.id,m.res);
          if(results.size%20===0) process.stderr.write(`  ${results.size}/${recs.length}  ${((Date.now()-t0)/1000).toFixed(0)}s\n`); feed(); } });
        w.on('exit',()=>{ if(--alive===0) done(); }); };
      for(let i=0;i<Math.min(NW,recs.length);i++) spawn();
    });
    const cov={}, lines=[]; let errs=0, errMsg='';
    for(const r of recs){ const o=results.get(r.id); if(!o||o.err){ errs++; errMsg=(o&&o.err)||'无结果'; continue; }
      for(const d of o.out) lines.push(JSON.stringify(d));
      for(const [k,v] of Object.entries(o.cov)){
        if(typeof v==='object'){ const c=cov[k]||(cov[k]={n:0,notIn:0,adjusted:0,dropped:0,sizes:[],added:0});
          c.n+=v.n; c.notIn+=v.notIn; c.adjusted+=v.adjusted; c.dropped+=v.dropped; c.added+=v.added; c.sizes.push(...v.sizes); }
        else if(k==='errors') cov.errors=(cov.errors||0)+v; else cov.lastErr=v; }
    }
    fs.writeFileSync(path.join(outDir,'decisions.jsonl'),lines.join('\n')+'\n');
    fs.writeFileSync(path.join(outDir,'features.json'),JSON.stringify({lead:engine().HF_LEAD_F,follow:engine().HF_FOLLOW_F}));
    const q=(a,p)=>{ const s=a.slice().sort((x,y)=>x-y); return s.length?s[Math.min(s.length-1,Math.floor(p*s.length))]:0; };
    console.log(`\n==== 覆盖率(by=h 的决策;不含托管 / 照提示 / 没得选)====`);
    const names={lead:'领出',follow1:'单张领出的跟牌',followN:'多张领出的跟牌'};
    const summary={};
    for(const k of ['lead','follow1','followN']){ const c=cov[k]; if(!c) continue;
      summary[k]={n:c.n,notIn:c.notIn,adjusted:c.adjusted,dropped:c.dropped,kept:c.sizes.length,addedCands:c.added,size:{mean:c.sizes.reduce((a,x)=>a+x,0)/c.sizes.length,p10:q(c.sizes,.1),p50:q(c.sizes,.5),p90:q(c.sizes,.9),max:Math.max(...c.sizes)}};
      console.log(`  ${names[k].padEnd(10)} 决策 ${String(c.n).padStart(5)}  真人那手不在引擎候选表里 ${String(c.notIn).padStart(4)} (${(100*c.notIn/c.n).toFixed(1)}%)  `+
        `(领出:第 2 遍引擎候选分变了 / 跟牌:原分与 extra 分对不上)的决策 ${c.adjusted} (${(100*c.adjusted/c.n).toFixed(1)}%)  丢弃 ${c.dropped}  进数据集 ${c.sizes.length}  `+
        `候选数 均值 ${summary[k].size.mean.toFixed(1)} p10/p50/p90/max ${summary[k].size.p10}/${summary[k].size.p50}/${summary[k].size.p90}/${summary[k].size.max}  新增候选 ${c.added}`); }
    console.log(`  出错 ${(cov.errors||0)+errs}${cov.lastErr?'  '+cov.lastErr:''}${errMsg?'  '+errMsg:''}`);
    fs.writeFileSync(path.join(outDir,'coverage.json'),JSON.stringify({excl,games:recs.length,summary,errors:cov.errors||0},null,1));
    console.log(`写了 ${lines.length} 个决策;耗时 ${((Date.now()-t0)/1000).toFixed(0)} s`);
  })();
}
