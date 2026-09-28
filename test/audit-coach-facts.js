/* 教练建议单与「相关事实」的体检 —— 只扫描,不修。
 *
 *   node test/audit-coach-facts.js [html=80fen-test.html] [局数=40]      EG=1 开收官推演(慢)
 *
 * v0.7.33 起,问教练先出一道和「价值最高的候选」相关的题,再给最多 3 个候选,每个候选后面跟一句事实
 * (别家还剩几张、还有几张比它大、谁已断、还有几分……)。这些话玩家会当真,所以要查:
 *
 *   ① 建议单第一条必须就是 AI 自己的选择(约束 6:教练与 AI 同源)
 *   ② 档次顺序:最佳 → 并列 → 也可以;「也可以」不超过门槛;按价值降序;最多 3 条
 *   ③ 说「X 已断」的,history 里必须找得到他没跟出这门的那一墩(硬证据,不是推断)
 *   ④ 领出单张的「别家没有比它大的」与 isBossPlay 同一口径
 *   ⑤ 末家的「这墩归你」与引擎 resolveTrick 结算一致
 *   ⑥ 合并成「♦5 或 ♦6」的牌,事实必须和代表那一手逐字相同(否则那句事实只对其中一手成立)
 *
 * 只查「说的和牌面对不对得上」,不评价棋力。有不符就以退出码 1 结束。
 */
const fs=require('fs'),vm=require('vm');
const F=process.argv[2]||'80fen-test.html', N=+process.argv[3]||40, THR=12;
const b=[...fs.readFileSync(F,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const C0={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};
C0.globalThis=C0; vm.createContext(C0); vm.runInContext(b[0],C0);
// 导出的 ENGINE(含 const 的 RULES / AIP)+ 脚本里的全局函数(coachFacts 等没进导出表)
const E=Object.assign({},C0,C0.module.exports);
if(typeof E.coachOptions!=='function'){ console.log(`${F}:没有 coachOptions(v0.7.33 之前的 build),跳过`); process.exit(0); }
E.AIP.egSearch=+(process.env.EG||0);

const same=(a,b)=>a.length===b.length&&a.every(x=>b.some(y=>y.id===x.id));
let n=0; const bad={}, first={}, len=[0,0,0,0], tiers={best:0,tie:0,ok:0};
const fail=(k,d)=>{ bad[k]=(bad[k]||0)+1; if(!first[k]) first[k]=d; };

function check(view,plays,J){
  const o=E.coachOptions(view,plays,J,THR,3); n++; len[o.length]++;
  if(!o.length||!same(o[0].cards,J.adv.cards)) fail('① 首选 ≠ AI 的选择','');
  const ts=o.map(x=>x.tier).join(',');
  if(!/^best(,tie)*(,ok)*$/.test(ts)) fail('② 档次顺序',ts);
  for(let i=2;i<o.length;i++) if(o[i].delta<o[i-1].delta-1e-9) fail('② 没按价值降序',o.map(x=>x.delta.toFixed(1)).join(','));
  for(const x of o){
    tiers[x.tier]++;
    if(x.tier!=='best'&&x.delta>THR) fail('② 超过门槛的也列了',x.delta);
    const f=x.facts, su=f.kind==='lead'?f.suit:f.leadSuit;
    for(const s of (f.kind==='lead'?f.oppVoid:f.behindOppVoid))
      if(!E.coachVoidTrick(view.history,s,su,view.trump)) fail('③ 说已断却找不到那一墩',`座位${s} 门${su}`);
    if(f.kind==='lead'&&f.type==='single'&&f.boss!==E.isBossPlay(E.classify(x.cards,view.trump),E.makeMemory(view),view.trump))
      fail('④ 单张「别家没有更大」与 isBossPlay 不一致','');
    for(const c of x.same)
      if(JSON.stringify(E.coachFacts(view,plays,c))!==JSON.stringify(f)) fail('⑥ 合并的牌事实不同','');
    if(f.kind==='follow'&&f.last){
      const r=E.resolveTrick(plays.concat([{seat:view.seat,cards:x.cards}]),view.trump);
      if((r.winner===view.seat)!==f.wins) fail('⑤ 末家胜负与结算不一致','');
    }
  }
}

for(let s=1;s<=N;s++){
  const seed=s*7919+3;
  const {first:fs0}=E.cutForFirst(seed);
  const {hands,kitty}=E.dealRound(seed,fs0);
  let best=null,declSeat=-1;
  for(let q=0;q<4;q++){ const o=E.declOptions(hands[q],E.RULES.levelStart)[0];
    if(o&&(!best||o.strength>best.strength)){best=o;declSeat=q;} }
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart};
  if(!best) declSeat=fs0;
  hands[declSeat].push(...kitty);
  const bur=E.aiDiscard(hands[declSeat],trump); bur.forEach(c=>E.removeCard(hands[declSeat],c));
  const hist=[], rand=E.rng(seed); let leader=declSeat, t=0;
  while(hands.some(h=>h.length)&&t<60){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4;
      const view={seat,hand:hands[seat],trump,declSeat,history:[...hist,...plays],buriedKnown:seat===declSeat?bur:[]};
      let cards;
      if(i===0){ const J=E.coachJudgeLead(view); check(view,[],J); cards=J.adv.cards;
        const ck=E.checkThrow(hands,seat,cards,trump); if(!ck.ok) cards=ck.forced; }
      else{ const J=E.coachJudgeFollow(view,plays); check(view,plays,J); cards=J.adv.cards;
        const lead=E.classify(plays[0].cards,trump);
        if(!E.isLegalFollow(hands[seat],lead,cards,trump)) cards=E.genFollow(hands[seat],lead,trump,rand); }
      cards.forEach(c=>E.removeCard(hands[seat],c)); plays.push({seat,cards});
    }
    hist.push(...plays); leader=E.resolveTrick(plays,trump).winner; t++;
  }
}
console.log(`${F} — ${N} 局,${n} 个决策点`);
console.log(`建议单长度:1 条 ${len[1]} / 2 条 ${len[2]} / 3 条 ${len[3]};档次:最佳 ${tiers.best} / 并列 ${tiers.tie} / 也可以 ${tiers.ok}`);
const ks=Object.keys(bad);
if(!ks.length){ console.log('六类断言 0 不符'); process.exit(0); }
for(const k of ks) console.log(`✗ ${k}:${bad[k]} 次  例:${first[k]}`);
process.exit(1);
