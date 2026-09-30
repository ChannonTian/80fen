/* 教练建议单的「文不对题」体检 —— 只扫描,不修。
 *
 *   node test/audit-coach-text.js [html=80fen-test.html] [局数=60]      EG=1 开收官推演(慢)
 *
 * audit-reason.js 查的是 **AI 自己选中那一手** 的理由;这里查的是 **教练建议单里每一条显示出来的候选**
 * —— 首选、并列、也可以 —— 因为玩家读到的是这些。试玩报障(v0.7.33):
 *   · 对手暂大,却说「这门没分可贴,跟一张」—— 「贴」只对队友说得通;领的是对子,却说「跟一张」;
 *   · 「♣10 也可以 —— 跟分(躲不掉的分先出)」—— 手里明明有 ♣4 不带分,「躲不掉」是假的,
 *     而且把白送对手 10 分列成「也可以」。
 * 每条断言都是理由字面上自称的东西(或建议单自称的东西),不是棋力判断。
 *
 * 引擎导出里有 coachReason(v0.7.36 起)时查的是改写后的理由,否则查 AI 的原句。
 *
 * 第二轮(同在 v0.7.36):把块③ 里教练的其余文字也拿出来查 —— 跟牌提示(「你没有将牌:可以用将牌毙」)、
 * 题目与答案(「别家还有几张比大王大」这种答案恒为 0 的题)、候选后面那句事实。
 * 块③ 的几段是按源码里的标记截出来在 vm 里跑的,截不到就跳过这一组并说一声。
 */
const fs=require('fs'),vm=require('vm');
const F=process.argv[2]||'80fen-test.html', N=+process.argv[3]||60;
const b=[...fs.readFileSync(F,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const C0={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number,isFinite,
  location:{pathname:'/'+F,search:''},localStorage:{getItem:()=>null,setItem:()=>{}}};
C0.globalThis=C0; vm.createContext(C0); vm.runInContext(b[0],C0);
const E=Object.assign({},C0,C0.module.exports);
if(typeof E.coachOptions!=='function'){ console.log(`${F}:没有 coachOptions,跳过`); process.exit(0); }
E.AIP.egSearch=+(process.env.EG||0);
const HAVE_REWRITE=typeof E.coachReason==='function';
const OK_THR=typeof E.coachOkThr==='function'?E.coachOkThr(12):12;   // v0.7.33 用的是失误门槛 12,v0.7.36 收紧到 6
const reasonOf=(view,plays,o)=>o.say!==undefined?o.say:E.coachReasonCore(o.reason);   // v0.7.36 起建议单自带改写后的理由

/* 块③ 里教练的文字:按源码标记截几段出来跑(术语表、牌名、factText / obligationNote / quizFor)。 */
let UI=null;
try{
  const ui=b[2], cut=(from,to)=>{ const i=ui.indexOf(from), j=ui.indexOf(to,i+from.length);
    if(i<0||j<0) throw new Error(from); return ui.slice(i,j); };
  const code=cut('const TERMS={','\nlet lang=')+'\nlet lang="sh";\n'+cut('const T=k=>','\nconst HUMAN=')+
    cut('const rankName=','\n')+'\n'+cut('let C={','\n')+'\n'+cut('const GAP_THR=','\n')+'\n'+cut('const desc=','\n')+'\n'+
    cut('function miniName(c){','// 副花色')+cut('const seatShort=','const canAskCoach=')+
    '\nglobalThis.__UI={factText,obligationNote,quizFor};';
  vm.runInContext(code,C0); UI=C0.__UI;
}catch(e){ console.log(`(块③ 的教练文字没截到:${e.message} —— 跳过这一组)`); }
// 这张在它那门里已是最大一档(副牌 A、大王):数一遍整副牌,不借引擎的 coachTopRank
const topRank=(c,t)=>!E.makeDeck().some(x=>E.effSuit(x,t)===E.effSuit(c,t)&&E.ordIdx(x,t)>E.ordIdx(c,t));
function checkUI(view,plays,J,os){
  if(!UI) return;
  const t=view.trump, strip=h=>String(h).replace(/<[^>]+>/g,'');
  if(plays.length){
    const lead=E.classify(plays[0].cards,t), ob=UI.obligationNote(view,plays);
    const d=()=>`「${ob}」 领 ${dsc(plays[0].cards)} 手里 ${dsc(view.hand)}`;
    note('跟牌提示:没有主可毙时不说「可以用主毙」', !(/可以用.*毙/.test(ob)&&(lead.suit==='T'||!view.hand.some(c=>E.effSuit(c,t)==='T'))), d);
    note('跟牌提示:甩的全是单张不说「有对必对」', !(/有对必对/.test(ob)&&!E.pairsInLead(lead)), d);
  }
  const forced=typeof E.coachForced==='function'&&E.coachForced(view,plays);
  const f=E.coachFacts(view,plays,J.adv.cards);
  const Q=forced?null:UI.quizFor(view,plays,{cards:J.adv.cards,facts:f});
  if(Q){
    const q=Q.q, rv=strip(Q.reveal), d=()=>`「${q}」→「${rv}」 首选 ${dsc(J.adv.cards)}`;
    if(f.kind==='follow'){
      note('题目:不问「比 A / 大王还大的有几张」(答案恒为 0)',
        !((/别家还有几张比/.test(q)&&!/队友/.test(q)&&topRank(J.adv.cards[0],t))||(/队友的/.test(q)&&f.partnerCard&&topRank(f.partnerCard,t))), d);
      note('题目:已被毙的墩不问「压不压得过桌上那张」', !(/压得过桌上/.test(q)&&f.ruffed), d);
    }
    note('题目答案:别家 0 张时不说「越可能有人断」', !(/越可能/.test(rv)&&/还剩 0 张/.test(rv)), d);
  }
  for(const o of os){
    const say=o.say!==undefined?o.say:E.coachReasonCore(o.reason), ft=UI.factText(o.facts), m=say+'。'+ft;
    const d=()=>`「${m}」 出 ${dsc(o.cards)}`;
    note('理由与事实不打架:「队友稳赢」vs「别家还有 N 张比他那张大」', !(/队友稳赢/.test(say)&&/别家还有 \d+ 张比他那张大/.test(ft)), d);
    note('事实:别家 0 张说「一张都没有了」', !/还剩 0 张/.test(ft), d);
    const lf=o.facts;
    if(lf.kind==='follow'&&lf.last&&!lf.wins&&!lf.partnerWinning&&lf.table)
      note('事实:末家放掉的墩说出台面分也归对手', /台面 \d+ 分归对手/.test(ft), d);
  }
}

const SYM={S:'♠',H:'♥',C:'♣',D:'♦'};
const nm=c=>c.suit==='X'?(c.rank===16?'大王':'小王'):SYM[c.suit]+({11:'J',12:'Q',13:'K',14:'A'}[c.rank]||c.rank);
const dsc=cs=>cs.map(nm).join('');
const hits={}, bad={}, ex={};
const note=(k,ok,d)=>{ hits[k]=(hits[k]||0)+1; if(!ok){ bad[k]=(bad[k]||0)+1; (ex[k]=ex[k]||[]).length<2&&ex[k].push(d()); } };
let points=0, opts=0, aiGift=0; const aiGiftEx=[];
/* 有没有「一分不带、又不动更大的牌」的合法跟法(单张、多张的墩都查):
 *   从手里所有不带分的牌里挑 —— 这门的牌不比出的那手这门最大那张大;别门的只用副牌小牌(10 以下)——
 *   凑够张数、合法(isLegalFollow:有对必对、有拖拉机跟拖拉机、够门必跟)就算有。
 * 拿小王 / 副 A 去省一个 5 分不算「便宜」—— 那是另一种取舍,不算说错。组合太多返回 null(不判)。 */
function cheapZeroAlt(view,plays,cards){
  const t=view.trump, lead=E.classify(plays[0].cards,t), need=lead.cards.length;
  const inSuit=c=>E.effSuit(c,t)===lead.suit;
  const tops=cards.filter(inSuit).map(c=>E.ordIdx(c,t)), top=tops.length?Math.max(...tops):-1;
  const pool=view.hand.filter(c=>E.cardPoints(c)===0&&(inSuit(c)?E.ordIdx(c,t)<=top:(E.effSuit(c,t)!=='T'&&c.rank<=10)));
  let n=0, hit=false; const pick=[];
  (function rec(i){
    if(hit||n>20000) return;
    if(pick.length===need){ n++; hit=E.isLegalFollow(view.hand,lead,pick,t); return; }
    for(let j=i;j<=pool.length-(need-pick.length)&&!hit;j++){ pick.push(pool[j]); rec(j+1); pick.pop(); }
  })(0);
  return hit?true:(n>20000?null:false);
}
// 真是小牌:9 以下、不是级牌也不是王
const small=(c,t)=>c.suit!=='X'&&c.rank!==t.rank&&c.rank<=9;
const big=(c,t,leadSuit)=>E.cardPoints(c)>0||c.rank>=12||c.suit==='X'||(E.effSuit(c,t)==='T'&&leadSuit!=='T');

function checkFollow(view,plays,o,best,r){
  const t=view.trump, lead=E.classify(plays[0].cards,t), need=lead.cards.length, me=view.seat, partner=(me+2)%4;
  const after=E.currentWinner(plays.concat([{seat:me,cards:o.cards}]),t), before=E.currentWinner(plays,t);
  const iWin=after.seat===me, partnerWins=after.seat===partner, oppWins=!iWin&&!partnerWins;
  const mine=view.hand.filter(c=>E.effSuit(c,t)===lead.suit);
  const played=o.cards.filter(c=>E.effSuit(c,t)===lead.suit);
  const unplayed=mine.filter(c=>!o.cards.some(x=>x.id===c.id));
  const pts=E.countPoints(o.cards), table=E.countPoints(plays.flatMap(p=>p.cards)), last=plays.length===3;
  const isRuff=iWin&&lead.suit!=='T'&&o.cards.every(c=>E.effSuit(c,t)==='T');
  const d=()=>`[${o.tier}] 「${r}」 出 ${dsc(o.cards)} | 领 ${dsc(plays[0].cards)}(${need}张) 手里这门 ${dsc(mine)||'无'} 台面${table} ${iWin?'我赢':partnerWins?'队友赢':'对手赢'}`;
  // 「贴」:这墩最后归队友;或队友还没出、理由明说在等他毙(预判)。两种都要求我自己没赢
  const partnerAfter=plays.length<2&&!plays.some(p=>p.seat===partner);
  if(/贴/.test(r)) note('贴分:归队友(或明说等队友毙)', !iWin&&(partnerWins||(/队友多半断|会毙/.test(r)&&partnerAfter)), d);
  if(/跟一张/.test(r))                 note('跟一张:领的真是单张', need===1, d);
  if(/跟一张/.test(r))                 note('跟一张:手里真有这门(断门叫垫)', mine.length>0, d);
  if(/垫/.test(r))                     note('垫:真的出了别门的牌', o.cards.some(c=>E.effSuit(c,t)!==lead.suit), d);
  if(/跟小|保留实力/.test(r)){
    note('跟小:没有赢下这墩', !iWin, d);
    note('跟小:手里真有这门(断门叫垫)', mine.length>0, d);
    // 「小」= 便宜:留着一张更小、又不更带分的牌,却出了大的,才算说错(留 ♣5 出 ♣6 是为了不送 5 分,不算)
    // v0.7.36 起用引擎同一个判据(领对子只和对子比);旧 build 没有就退回逐张比
    const cheaper=typeof E.coachCheaperLeft==='function'?E.coachCheaperLeft(view,lead,o.cards)
      :unplayed.some(u=>played.some(p=>E.ordIdx(u,t)<E.ordIdx(p,t)&&E.cardPoints(u)<=E.cardPoints(p)));
    note('跟小:出的真是这门里小的', !cheaper, d);
    note('跟小:不是被迫把大牌全跟上', !(mine.length&&played.length===mine.length&&played.some(c=>big(c,t,lead.suit))), d);
  }
  if(/跟小|保留实力|跟一张小/.test(r)) note('跟小:出的真是小牌(9 以下,不是级牌和王)', played.every(c=>small(c,t)), d);
  if(/跟分/.test(r))                   note('跟分:没赢下、也真有这门(毙下是收分,断门是垫分)', !iWin&&mine.length>0, d);
  if(/垫小主/.test(r))                 note('垫小主:垫的主真是小主', o.cards.filter(c=>E.effSuit(c,t)==='T').every(c=>small(c,t)), d);
  if(/队友稳赢/.test(r)){
    // 稳赢 = 我是末家;或单张墩里队友那张别家已没有更大的、后面的对手也没露出断门(和事实那句同一口径)
    const f=E.coachFacts(view,plays,o.cards);
    note('队友稳赢:队友那张真赢定了', last||(!!f.partnerBigger&&!f.partnerBigger.length&&!f.behindOppVoid.length), d);
  }
  if(/台面有分/.test(r))               note('台面有分:台面真有分', table>0, d);
  if(/毙/.test(r)&&!/被毙|来毙|会毙|能毙|可能毙|让他毙|再毙/.test(r)) note('毙:我真用主毙下了', isRuff, d);
  if(/躲不掉/.test(r)){
    note('躲不掉:没有赢下这墩', !iWin, d);
    const alt=cheapZeroAlt(view,plays,o.cards);
    if(alt!==null) note(need===1?'躲不掉:真没有更小又不带分的牌':'躲不掉(多张):真没有不带分的跟法', !alt, d);
  }
  if(/最后一手/.test(r))               note('最后一手:真是末家', last, d);
  if(/能吃住|压住|稳吃|稳拿|尝试吃|争这墩|接过|拿牌权|压到|吃到/.test(r)&&!/被/.test(r)) note('吃:真的暂时赢下', iWin, d);
  if(/收分|抢分|争这墩分/.test(r))      note('收分:台面或这手真有分', table+pts>0, d);
  if(/队友稳赢|队友只是暂大/.test(r))  note('队友:出牌前真是队友暂大', before.seat===partner, d);
  // 建议单层面:「也可以」不该是白送对手分(同一墩里首选送得更少)
  if(o.tier!=='best') note('也可以:不白送对手分', !(oppWins&&pts>E.countPoints(best.cards)), d);
  // 首选本身白送分:对手赢、这手带分、手里却有合法又不带分的跟法 —— 这是 AI 的打法,不只是措辞
  if(o.tier==='best'&&oppWins&&pts>0&&cheapZeroAlt(view,plays,o.cards)){
    aiGift++; if(aiGiftEx.length<3) aiGiftEx.push(d());
    // 首选是 AI 的打法,教练改不了;但不许再说「躲不掉」,要如实说在送分
    note('首选送分:如实说是送分', /出掉|垫掉|送/.test(r)&&!/躲不掉/.test(r), d);
  }
}
function checkLead(view,o,r){
  const t=view.trump, cl=E.classify(o.cards,t), f=o.facts;
  const suitCards=view.hand.filter(c=>E.effSuit(c,t)===(cl?cl.suit:''));
  const d=()=>`[${o.tier}] 「${r}」 领 ${dsc(o.cards)}(${cl?cl.type:'?'}) 这门手里 ${dsc(suitCards)}`;
  if(/钢板|整门都是最大/.test(r)&&cl&&cl.type==='single') note('钢板:单张真的别家没有更大', f.boss===true, d);
  if(/钓主/.test(r))                   note('钓主:领的真是主', !!cl&&cl.suit==='T', d);
  if(/甩牌/.test(r))                   note('甩牌:真的一次多组', !!cl&&cl.type==='throw', d);
  if(/对子/.test(r))                   note('对子:真是一对', !!cl&&cl.type==='pair', d);
  if(/拖拉机/.test(r))                 note('拖拉机:真是拖拉机', !!cl&&cl.type==='tractor', d);
  if(/小牌探路/.test(r)&&cl&&cl.type==='single'){
    note('小牌:不是这门里最大的那张', suitCards.length===1||suitCards.some(c=>E.ordIdx(c,t)>E.ordIdx(o.cards[0],t)), d);
    note('小牌:真是小牌(9 以下)', small(o.cards[0],t), d);
  }
  // AI 用来解释「为什么扣分」的标签,不能当推荐理由(「主牌不占优,先不动主」挂在大怪上)
  note('领出:不拿扣分标签当理由', !/先不动主|留作后手|慎出|下策|甩牌有风险|按被毙的概率算|压不住场,吊不出/.test(r), d);
  if(/多半断这门|可能缺门/.test(r)&&cl&&cl.suit!=='T')
    note('「对手多半断」:还没有对手确定断、别家也还有这门', !f.oppVoid.length&&f.out>0, d);
  if(/都没有了/.test(r))               note('「别家都没有了」:真是一张都没有', f.out===0, d);
  if(/(^|[^半])压得住/.test(r))        note('「压得住」:别家真没有更大的(否则说「多半压得住」)', f.boss!==false, d);
  if(/小主/.test(r)&&cl&&cl.suit==='T'){
    // 小主:别家比它大的主不少于一半(与 cashWinMinAbove 同一个「低」的口径)
    const up=E.coachBiggerUnseen(E.makeMemory(view),'T',t,cl.top).reduce((a,x)=>a+x.n,0);
    note('小主:真的是张小主', f.out>0&&up/f.out>=0.5, d);
  }
  if(/队友的断门/.test(r))             note('队友断门:队友真的断了这门', f.partnerVoid===true, d);
}

/* ---- 报障复现(v0.7.33 试玩)----
 * 第 1 墩对手领 ♥K♥K:教练说「这门没分可贴,跟一张」;第 2 墩对手领 ♣A、我有 ♣A♣10♣4:
 * 「♣10 也可以 —— 跟分(躲不掉的分先出)」。手牌是照报障拼的,其余牌随手补齐到 25 张。 */
if(typeof E.coachForced==='function'){
  let uid=0; const K=(s,r)=>({suit:s,rank:r,id:'r'+(uid++)});
  const trump={suit:'S',rank:2}, filler=()=>[K('D',3),K('D',6),K('D',8),K('D',9),K('D',11),K('D',12),K('C',3),K('C',6),K('C',8),
    K('C',9),K('C',12),K('S',4),K('S',6),K('S',9),K('S',11),K('S',14),K('H',3),K('H',6),K('H',9)];
  const judge=(hand,plays)=>{ const view={seat:0,hand,trump,declSeat:1,history:plays.slice(),buriedKnown:[]};
    const J=E.coachJudgeFollow(view,plays); return {view,J,opts:E.coachOptions(view,plays,J,OK_THR,3)}; };
  const say=o=>o.say!==undefined?o.say:E.coachReasonCore(o.reason);
  const rp=(k,ok,d)=>note('复现 '+k,ok,()=>d);
  // A1:这门只有一对 → 没得选
  { const hand=[K('H',12),K('H',12),K('H',7),K('H',4),...filler()].slice(0,25);
    const plays=[{seat:3,cards:[K('H',13),K('H',13)]}];
    const {view}=judge(hand,plays);
    rp('A1 只有一对 ♥Q♥Q:判为没得选', E.coachForced(view,plays)==='pair', `coachForced=${E.coachForced(view,plays)}`); }
  // A2:两对可选 → 理由不许说「贴」「跟一张」
  { const hand=[K('H',12),K('H',12),K('H',7),K('H',7),K('H',4),...filler()].slice(0,25);
    const plays=[{seat:3,cards:[K('H',13),K('H',13)]}];
    const {opts}=judge(hand,plays);
    for(const o of opts) rp('A2 对子墩的理由不说「贴」「跟一张」', !/贴|跟一张/.test(say(o)), `${dsc(o.cards)}「${say(o)}」`); }
  // B:对手领 ♣A,我有 ♣A♣10♣4 → ♣10 不许当「也可以」,也不许说「躲不掉」
  { const hand=[K('C',14),K('C',10),K('C',4),...filler().filter(c=>c.suit!=='C')].slice(0,25);
    const plays=[{seat:3,cards:[K('C',14)]}];
    const {opts}=judge(hand,plays);
    rp('B 首选不带分', E.countPoints(opts[0].cards)===0, `首选 ${dsc(opts[0].cards)}`);
    for(const o of opts){
      rp('B ♣10 不在建议单里', !o.cards.some(c=>c.rank===10), `${dsc(o.cards)} [${o.tier}]`);
      rp('B 理由不说「贴」「躲不掉」', !/贴|躲不掉/.test(say(o)), `${dsc(o.cards)}「${say(o)}」`);
    } }
}

for(let s=1;s<=N;s++){
  const seed=s*6151+11;
  const {first}=E.cutForFirst(seed);
  const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1;
  for(let q=0;q<4;q++){ const o=E.declOptions(hands[q],E.RULES.levelStart)[0];
    if(o&&(!best||o.strength>best.strength)){best=o;declSeat=q;} }
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart};
  if(!best) declSeat=first;
  hands[declSeat].push(...kitty);
  const bur=E.aiDiscard(hands[declSeat],trump); bur.forEach(c=>E.removeCard(hands[declSeat],c));
  const hist=[], rand=E.rng(seed); let leader=declSeat, t=0;
  while(hands.some(h=>h.length)&&t<60){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4;
      const view={seat,hand:hands[seat],trump,declSeat,history:[...hist,...plays],buriedKnown:seat===declSeat?bur:[]};
      const J=i?E.coachJudgeFollow(view,plays):E.coachJudgeLead(view);
      const os=E.coachOptions(view,i?plays:[],J,OK_THR,3); points++;
      for(const o of os){ opts++; const r=reasonOf(view,i?plays:[],o);
        note('理由里没有空括号 / 推演数字', !/\(\)|样本|净升/.test(r), ()=>`「${r}」`);
        if(i) checkFollow(view,plays,o,os[0],r); else checkLead(view,o,r); }
      checkUI(view,i?plays:[],J,os);
      let cards=J.adv.cards;
      if(!i){ const ck=E.checkThrow(hands,seat,cards,trump); if(!ck.ok) cards=ck.forced; }
      else{ const lead=E.classify(plays[0].cards,trump);
        if(!E.isLegalFollow(hands[seat],lead,cards,trump)) cards=E.genFollow(hands[seat],lead,trump,rand); }
      cards.forEach(c=>E.removeCard(hands[seat],c)); plays.push({seat,cards});
    }
    hist.push(...plays); leader=E.resolveTrick(plays,trump).winner; t++;
  }
}
const keys=Object.keys(hits).sort((a,b)=>(bad[b]||0)-(bad[a]||0));
console.log(`${F} — ${N} 局,${points} 个决策点,显示出来的候选 ${opts} 条(理由:${HAVE_REWRITE?'教练改写后':'AI 原句'};「也可以」门槛 ${OK_THR})\n`);
console.log('断言'.padEnd(24)+'触发'.padStart(7)+'不符'.padStart(7)+'占比'.padStart(8));
for(const k of keys){ const n=bad[k]||0; console.log(k.padEnd(24)+String(hits[k]).padStart(7)+String(n).padStart(7)+((100*n/hits[k]).toFixed(1)+'%').padStart(8)); }
console.log(`\n(记给 AI 线,不算教练说错)首选本身白送分:对手赢、这手带分,手里却有不带分又不动大牌的合法跟法 —— ${aiGift} 次`);
if(aiGiftEx.length) console.log('  '+aiGiftEx.join('\n  '));
const bk=keys.filter(k=>bad[k]);
if(bk.length){ console.log('\n---- 例子 ----'); for(const k of bk) console.log(`\n[${k}]\n  `+ex[k].join('\n  ')); process.exit(1); }
console.log('\n全部 0 不符');
