/* 教练的「同一标尺」对账 —— 只扫描,不修。
 *
 *   node test/audit-coach.js [html=80fen-test.html] [局数=120]
 *
 * 约束 6 说教练与 AI 同源:教练给你那一手打的分,必须和 AI 自己给同一手打的分一样。
 * 失误反馈的判据是 `best.score − 你这手的分`,两边口径一旦不一样,
 * 就会出现两种错:你出了 AI 自己的第二候选,教练报的分差比真实的大(冤枉你),或者小(放过你)。
 *
 * 做法:让 AI 自己打完整局,在每一个决策点假装这个座位是你,把 AI 的每一个候选
 * 都当成「你出的牌」交给教练打分,和 AI 候选表里那个分对账。
 *
 *   ① 口径差    教练分 − AI 分,按候选类别、理由关键词分层
 *   ② 判定翻转  按中档门槛 12 分,「该报没报 / 不该报却报」各多少
 *   ③ 负分差    AI 的首选不是候选表第一名(收官推演、贴分改判)时,
 *              出候选表第一名会得到负的分差 —— 永远不报,哪怕推演说它亏
 *
 * 引擎导出里若有 coachEvalFollow / coachEvalLead(v0.7.31 起),同时对账新口径。
 */
const fs=require('fs'),vm=require('vm');
function load(f){const b=[...fs.readFileSync(f,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  const ctx={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};
  ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(b[0],ctx);return ctx.module.exports;}
const HTML=process.argv[2]||'80fen-test.html';
const E=load(HTML);
const N=+process.argv[3]||120;
const THR=12, LEAD_SCALE=4;
const NEW=typeof E.coachEvalFollow==='function';

const same=(a,b)=>a.length===b.length&&a.every(x=>b.some(y=>y.id===x.id));
const kw=r=>(r||'').replace(/^收官推演:/,'').replace(/(收官推演[^)]*)/,'').slice(0,14);
const st={follow:{n:0,bad:0,big:0,byCat:{},byKw:{},flipUp:0,flipDown:0,cmp:0,neg:0,negSeen:0},
          lead:{n:0,bad:0,big:0,byCat:{},byKw:{},flipUp:0,flipDown:0,cmp:0,neg:0,negSeen:0},
          newFollow:{n:0,bad:0,fb:0,fbBig:0,neg:0,negSeen:0,conf:{}},newLead:{n:0,bad:0,fb:0,fbBig:0,neg:0,negSeen:0,conf:{}},eg:{n:0,override:0}};
const samples=[];
function tally(S,cat,reason,diff){
  S.n++;
  const b=Math.abs(diff)>0.5;
  if(b){ S.bad++; if(Math.abs(diff)>=6) S.big++; }
  const k1=cat||'?'; (S.byCat[k1]=S.byCat[k1]||[0,0,0])[0]++; if(b){ S.byCat[k1][1]++; S.byCat[k1][2]+=Math.abs(diff); }
  const k2=kw(reason); (S.byKw[k2]=S.byKw[k2]||[0,0,0])[0]++; if(b){ S.byKw[k2][1]++; S.byKw[k2][2]+=Math.abs(diff); }
}

/* 新口径:① 候选内的分必须逐字等于 AI 的分(bad);② 候选外的现场打分(兜底)拿候选当考题,
 * 和 AI 分对账(fb / fbBig);③ 推演改判时出第一名,分差不能 ≤0(neg)。 */
function newCheck(S,ev,fbScore,c,adv,topIsBest){
  S.n++;
  if(Math.abs(ev.mine.score-c.score)>0.5) S.bad++;
  const d=Math.abs(fbScore-c.score); if(d>0.5) S.fb++; if(d>=6) S.fbBig++;
  if(!topIsBest&&adv.cands[0]&&c.cards===adv.cands[0].cards&&ev.unit==='eg'){ S.negSeen++; if(ev.gap<=0) S.neg++; }
  S.conf[ev.conf]=(S.conf[ev.conf]||0)+1;
}
function decisionFollow(view,plays,adv){
  if(!adv.cands||adv.cands.length<2) return;
  const S=st.follow;
  if(adv.eg) st.eg.n++;
  const topIsBest=same(adv.cards,adv.cands[0].cards);
  if(!topIsBest) st.eg.override++;
  for(const c of adv.cands){
    const cs=E.coachScoreFollow(view,plays,c.cards);
    const diff=cs-c.score;
    tally(S,c.cat,c.reason,diff);
    if(Math.abs(diff)>=6&&samples.length<6) samples.push(`跟牌 ${c.reason}:AI ${c.score.toFixed(1)} / 教练 ${cs.toFixed(1)}`);
    if(same(c.cards,adv.cards)) continue;
    // 旧判据(humanPlay 原样)
    const rep=adv.score-cs, tru=adv.cands[0].score-c.score;
    S.cmp++;
    if(rep>THR&&!(tru>THR)) S.flipUp++;
    if(!(rep>THR)&&tru>THR) S.flipDown++;
    if(!topIsBest&&same(c.cards,adv.cands[0].cards)){ S.negSeen++; if(rep<=0) S.neg++; }
    if(NEW) newCheck(st.newFollow,E.coachEvalFollow(view,plays,c.cards,adv),
                     E.coachFollowScoreFull(view,plays,c.cards).score,c,adv,topIsBest);
  }
}
function decisionLead(view,adv){
  if(!adv.cands||adv.cands.length<2) return;
  const S=st.lead;
  if(NEW&&adv.all) adv={...adv,cands:adv.all};
  const topIsBest=same(adv.cards,adv.cands[0].cards);
  for(const c of adv.cands){
    const cs=E.coachScoreLead(view,c.cards);
    const diff=cs-c.score;
    tally(S,c.suit==='T'?'主':'副',c.reason,diff);
    if(Math.abs(diff)>=6&&samples.length<12) samples.push(`领出 ${c.reason}:AI ${c.score.toFixed(1)} / 教练 ${cs.toFixed(1)}`);
    if(same(c.cards,adv.cards)) continue;
    const rep=(adv.score-cs)/LEAD_SCALE, tru=(adv.cands[0].score-c.score)/LEAD_SCALE;
    S.cmp++;
    if(rep>THR&&!(tru>THR)) S.flipUp++;
    if(!(rep>THR)&&tru>THR) S.flipDown++;
    if(!topIsBest&&same(c.cards,adv.cands[0].cards)){ S.negSeen++; if(rep<=0) S.neg++; }
    if(NEW) newCheck(st.newLead,E.coachEvalLead(view,c.cards,adv),
                     E.coachLeadScoreFull(view,c.cards,adv).score,c,adv,topIsBest);
  }
}

function playRound(seed){
  const {first}=E.cutForFirst(seed);
  const {hands,kitty}=E.dealRound(seed,first);
  let best=null, declSeat=-1;
  for(let s=0;s<4;s++){
    const o=E.declOptions(hands[s],E.RULES.levelStart)[0];
    if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}
  }
  const rand=E.rng(seed^0x9e3779b9);
  let trump;
  if(!best){trump={suit:null,rank:E.RULES.levelStart};declSeat=first;}
  else trump={suit:best.suit,rank:E.RULES.levelStart};
  hands[declSeat].push(...kitty);
  const buried=E.aiDiscard(hands[declSeat],trump);
  buried.forEach(c=>E.removeCard(hands[declSeat],c));
  const history=[]; let leader=declSeat, tricks=0;
  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4;
      const view={seat,hand:hands[seat],trump,declSeat,history:[...history,...plays],
                  buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){
        const adv=E.aiChooseLead(view); cards=adv.cards;
        decisionLead(view,adv);
        const chk=E.checkThrow(hands,seat,cards,trump);
        if(!chk.ok) cards=chk.forced;
      }else{
        const lead=E.classify(plays[0].cards,trump);
        const adv=E.aiChooseFollow(view,plays); cards=adv.cards;
        decisionFollow(view,plays,adv);
        if(!E.isLegalFollow(hands[seat],lead,cards,trump)) cards=E.genFollow(hands[seat],lead,trump,rand);
      }
      cards.forEach(c=>E.removeCard(hands[seat],c));
      plays.push({seat,cards});
    }
    history.push(...plays);
    leader=E.resolveTrick(plays,trump).winner;
    if(++tricks>60) break;
  }
}

const t0=Date.now();
for(let s=1;s<=N;s++) playRound(s*104729+17);
const pct=(a,b)=>b?(100*a/b).toFixed(1)+'%':'-';
console.log(`${HTML} — ${N} 局,${((Date.now()-t0)/1000).toFixed(0)}s\n`);
for(const side of ['follow','lead']){
  const S=st[side];
  console.log(`== ${side==='follow'?'跟牌':'领出'}:候选 ${S.n} 个 ==`);
  console.log(`  ① 口径差 >0.5 分:${S.bad}(${pct(S.bad,S.n)}),其中 ≥6 分 ${S.big}`);
  const rows=Object.entries(S.byKw).filter(([,v])=>v[1]).sort((a,b)=>b[1][1]-a[1][1]).slice(0,10);
  for(const [k,v] of rows) console.log(`     ${k.padEnd(16,' ')} ${String(v[1]).padStart(5)}/${String(v[0]).padEnd(6)} 平均差 ${(v[2]/v[1]).toFixed(1)}`);
  console.log(`  ② 按门槛 ${THR} 判定翻转(${S.cmp} 次模拟「你出了别的候选」):冤枉 ${S.flipUp}(${pct(S.flipUp,S.cmp)}) / 放过 ${S.flipDown}(${pct(S.flipDown,S.cmp)})`);
  console.log(`  ③ 首选不是第一名时出第一名:${S.negSeen} 次,分差 ≤0(永远不报)${S.neg} 次`);
}
console.log(`\n首选被改判(收官推演 / 贴分改判)的跟牌决策:${st.eg.override}`);
if(NEW){
  console.log(`\n== 新口径 coachEval* ==`);
  for(const [nm,S] of [['跟牌',st.newFollow],['领出',st.newLead]]){
    console.log(`  ${nm}:候选内分数不一致 ${S.bad}/${S.n};兜底打分与 AI 差 >0.5 ${S.fb}(${pct(S.fb,S.n)}),≥6 分 ${S.fbBig}`);
    console.log(`        推演改判时出第一名:${S.negSeen} 次,分差 ≤0 ${S.neg} 次;把握分布 ${JSON.stringify(S.conf)}`);
  }
}
if(samples.length) console.log('\n---- 例子 ----\n'+samples.map(s=>'  '+s).join('\n'));
