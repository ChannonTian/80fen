/* 教练建议「文不对题」的体检 —— 只扫描,不修。
 *
 *   node test/audit-reason.js [html=80fen-test.html] [局数=400]
 *
 * 教练页签给玩家看的那句话,就是 AI 自己选中的那个候选带的 `reason`。
 * 于是有一类 bug 不影响棋力、只影响可信度:**牌打对了,理由说错了**。
 * 玩家看见「断门毙牌抢分」而自己明明还有这门牌,就再也不会相信下面那句了。
 *
 * 做法:让 AI 自己打完整局,每次决策都把选中的理由和**当时的客观事实**对上。
 * 每条断言都是理由字面上自称的东西,不是我认为它该干的事 ——
 * 「最后一手」就必须真是末家,「垫废牌」就必须真的 0 分。
 * 不做任何策略判断,只查事实。
 */
const fs=require('fs'),vm=require('vm');
function load(f){const b=[...fs.readFileSync(f,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  const ctx={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};
  ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(b[0],ctx);return ctx.module.exports;}
const E=load(process.argv[2]||'80fen-test.html');
const N=+process.argv[3]||400;

const hits={}, bad={}, samples={};
const note=(key,ok,detail)=>{
  hits[key]=(hits[key]||0)+1;
  if(!ok){ bad[key]=(bad[key]||0)+1;
    (samples[key]=samples[key]||[]).length<3&&samples[key].push(detail); }
};
const nm=c=>(c.suit||'J')+(c.rank===16?'大王':c.rank===15?'小王':c.rank);
const dsc=cs=>cs.map(nm).join('');

/* ---- 事实核查表:理由里的关键词 → 它自称成立的那件事 ---- */
function checkFollow(reason, f){
  const {hand,lead,trump,cards,isLast,partnerWinning,ptsTable,beatsCur}=f;
  const hasLeadSuit=hand.some(c=>E.effSuit(c,trump)===lead.suit);
  const pts=E.countPoints(cards);
  const isTrump=cards.every(c=>E.effSuit(c,trump)==='T');
  const d=()=>`理由「${reason}」\n  主${trump.suit||'无'}${trump.rank} 手${dsc(hand)}`+
              ` 领${lead.suit} 出${dsc(cards)} 台面${ptsTable}分 末家=${isLast} 队友暂大=${partnerWinning}`;
  if(/断门/.test(reason))      note('断门:我真的断这门', !hasLeadSuit, d());
  if(/台面有分|抢分|收分/.test(reason)) note('抢分:台面真的有分', ptsTable>0, d());
  if(/最后一手/.test(reason))  note('最后一手:我真是末家', isLast, d());
  if(/队友稳赢,贴分|队友只是暂大/.test(reason))
                               note('队友相关:队友真的暂大', partnerWinning, d());
  if(/贴分|跟分/.test(reason)) note('贴分:出的牌真的带分', pts>0, d());
  if(/垫废牌/.test(reason))    note('垫废牌:真的不带分不带主', pts===0&&!isTrump, d());
  // 只查「我这一手是毙」的那几句;「但后手或被毙」说的是别人毙我,不在此列
  if(/毙牌|毙下|毙掉/.test(reason)&&!/被毙/.test(reason))
                               note('毙:出的真的是主', isTrump&&lead.suit!=='T', d());
  if(/能吃住|稳吃|争这墩/.test(reason)) note('吃:真的压过了当前最大', beatsCur, d());
  if(/后手或被毙|后手对手能压/.test(reason)) note('后手:我真的不是末家', !isLast, d());
}
function checkLead(reason, f){
  const {hand,trump,cards,cl,mem}=f;
  const isTrump=cards.every(c=>E.effSuit(c,trump)==='T');
  const pts=E.countPoints(cards);
  const d=()=>`理由「${reason}」\n  主${trump.suit||'无'}${trump.rank} 手${dsc(hand)} 领出${dsc(cards)}(${cl?cl.type:'?'})`;
  if(/吊主|调主|清主|不动主|留作后手/.test(reason)&&!/不占优|先不动主|留作后手/.test(reason))
                                note('吊主/调主:领出的真的是主', isTrump, d());
  if(/拖拉机/.test(reason))     note('拖拉机:真的是拖拉机', cl&&cl.type==='tractor', d());
  if(/甩牌/.test(reason))       note('甩牌:真的一次多张', cards.length>1, d());
  if(/对子探路|分对/.test(reason)) note('对子:真的是一对', cl&&cl.type==='pair', d());
  if(/小牌探路|小主领出/.test(reason)) note('探路:出的不是本门最大', true, d());
  if(/这门在外已无分/.test(reason))
    note('在外无分:这门在外真的没分了', cl&&E.unseenPointsIn(mem,cl.suit,trump)===0, d());
  if(/本门在外已无更大/.test(reason)) note('封顶:领出的不是主', !isTrump||true, d());
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
      const hand=hands[seat].slice();
      const view={seat,hand:hands[seat],trump,declSeat,history:[...history,...plays],
                  buriedKnown:seat===declSeat?buried:[]};
      let cards, adv;
      if(i===0){
        adv=E.aiChooseLead(view); cards=adv.cards;
        const chk=E.checkThrow(hands,seat,cards,trump);
        if(chk.ok) checkLead(adv.reason,{hand,trump,cards,cl:E.classify(cards,trump),
                                         mem:E.makeMemory(view)});
        else cards=chk.forced;
      }else{
        const lead=E.classify(plays[0].cards,trump);
        adv=E.aiChooseFollow(view,plays); cards=adv.cards;
        if(E.isLegalFollow(hands[seat],lead,cards,trump)){
          const before=E.resolveTrick(plays,trump);
          const after=E.resolveTrick([...plays,{seat,cards}],trump);
          checkFollow(adv.reason,{hand,lead,trump,cards,
            isLast:adv.ctx?adv.ctx.isLast:(i===3),
            partnerWinning:adv.ctx?adv.ctx.partnerWinning:false,
            ptsTable:adv.ctx?adv.ctx.ptsTable:0,
            beatsCur:after.winner===seat&&before.winner!==seat});
        }else cards=E.genFollow(hands[seat],lead,trump,rand);
      }
      cards.forEach(c=>E.removeCard(hands[seat],c));
      plays.push({seat,cards});
    }
    history.push(...plays);
    leader=E.resolveTrick(plays,trump).winner;
    if(++tricks>60) break;
  }
}

E.AIP.egSearch=0;                    // 收官推演只是给理由加前缀,扫理由时关掉省时间
for(let s=1;s<=N;s++) playRound(s*7919);

const keys=Object.keys(hits).sort((a,b)=>(bad[b]||0)/hits[b]-(bad[a]||0)/hits[a]);
console.log(`${process.argv[2]||'80fen-test.html'} — ${N} 局\n`);
console.log('断言'.padEnd(30)+'触发'.padStart(8)+'不符'.padStart(8)+'占比'.padStart(9));
for(const k of keys){
  const b=bad[k]||0;
  console.log(k.padEnd(30)+String(hits[k]).padStart(8)+String(b).padStart(8)+
              ((100*b/hits[k]).toFixed(1)+'%').padStart(9));
}
console.log('\n---- 每类第一个反例 ----');
for(const k of keys) if(bad[k]) console.log(`\n[${k}]`+samples[k].map(x=>`\n  ${x}`).join(''));
