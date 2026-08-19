/* 同桌配对对照 —— 判断一次 AI 改动到底有没有用的唯一诚实指标。
 *
 *   node ai-h2h.js <新版html> <旧版html> [种子数=800]
 *
 * 做法(README「开发备忘」里推荐的那套):
 *   · 引擎(发牌 / 合法性 / 结算)统一用**新版**,规则判定两版一致,不会造成偏差;
 *   · 只把 aiDiscard / aiChooseLead / aiChooseFollow 三个函数**按座位**分派到新旧两版;
 *   · 同一批种子跑两遍并**交换阵营**,消除座位与庄家偏差。
 *
 * 输出净胜分/局、SE、t 值,以及「庄家丢掉最后一墩」的比例。
 *
 * SE 有两个口径,都打出来(v0.7.10 加的配对口径,见 NOTES/measurement.md):
 *   · 逐副:把 2N 副当成 2N 个独立样本。**这是以前唯一的口径,它系统性高估 SE。**
 *     交换阵营的两副是同一副牌,牌运在它们之间是**反相**的 —— 两版完全一样时
 *     d 与 −d 成对出现,净胜恒等于 0,SE 却算出 1.8 分/局。
 *   · 配对:先把同一种子的两副合成一个数 D=(d₀+d₁)/2,再对 N 个种子求 SE。
 *     两版完全一样时 D 每副都恰好是 0 —— 牌运被消干净,SE 也就是 0。
 *     余下的方差全部来自两版**行为真的不同**的那些副,这才是要量的东西。
 *   均值两个口径完全相同,只有 SE 变。以前的结论都是在被高估的 SE 下做的,
 *   也就是说都偏保守 —— 配对口径只会让原本成立的更显著,不会把结论反过来。
 *
 * 注意它量不到什么:两边虽然是不同版本,但都是同一套启发式的变体 ——
 * 「队友带着意图调王、我该不该接」这类配合问题不会被出题,
 * 「毙牌用大王而不用主A」这类被支配的选择会淹没在噪声里。那两类看 ai-scenarios.js。
 */
const fs=require('fs'),vm=require('vm');
function load(f){const b=[...fs.readFileSync(f,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  const ctx={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};
  ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(b[0],ctx);return ctx.module.exports;}
const NEW=load(process.argv[2]||'80fen-test.html');
const OLD=load(process.argv[3]||'index.html');
const E=NEW;

function playRound(seed, aiOf){
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
  else{
    trump={suit:best.suit,rank:E.RULES.levelStart};
    for(let s=0;s<4;s++){
      if(s!==declSeat&&E.jokerPairOf(hands[s])&&rand()<0.3){
        trump={suit:null,rank:E.RULES.levelStart};declSeat=s;break;}
    }
  }
  hands[declSeat].push(...kitty);
  const buried=aiOf(declSeat).aiDiscard(hands[declSeat],trump);
  buried.forEach(c=>E.removeCard(hands[declSeat],c));
  const declTeam=declSeat%2, history=[];
  let leader=declSeat, defPoints=0, lastWinner=declSeat, lastLeadSize=1, tricks=0;
  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4;
      const view={seat,hand:hands[seat],trump,declSeat,history:[...history,...plays],
                  buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){
        cards=aiOf(seat).aiChooseLead(view).cards;
        const chk=E.checkThrow(hands,seat,cards,trump);
        if(!chk.ok) cards=chk.forced;
      }else{
        const lead=E.classify(plays[0].cards,trump);
        cards=aiOf(seat).aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hands[seat],lead,cards,trump))
          cards=E.genFollow(hands[seat],lead,trump,rand);
      }
      cards.forEach(c=>E.removeCard(hands[seat],c));
      plays.push({seat,cards});
    }
    history.push(...plays);
    lastLeadSize=plays[0].cards.length;
    const res=E.resolveTrick(plays,trump);
    leader=res.winner; lastWinner=res.winner; tricks++;
    if(res.winner%2!==declTeam) defPoints+=res.points;
    if(tricks>60) break;
  }
  const sc=E.scoreRound({defPoints,kitty:buried,
    defWonLastTrick:lastWinner%2!==declTeam,lastLeadSize});
  return {...sc, declTeam, defWonLast:lastWinner%2!==declTeam};
}

const N=+process.argv[4]||800;
const S0=+(process.env.SEED0||0);          // 种子偏移:分批跑互不重叠的样本,好做多批合并
let diff=0, n=0, sq=0, lostNew=0, lostOld=0, nNew=0, nOld=0;
const paired=[];                            // 每个种子一个 D=(d₀+d₁)/2
for(let s=S0+1;s<=S0+N;s++){
  const d2=[];
  for(const newTeam of [0,1]){
    const aiOf=seat=>seat%2===newTeam?NEW:OLD;
    let r; try{ r=playRound(s,aiOf); }catch(e){ continue; }
    // 新版这一队本局拿到多少分:闲家拿 total,庄家方拿 200−total
    const newPts = (r.declTeam===newTeam) ? 200-r.total : r.total;
    const oldPts = 200-newPts;
    const d=newPts-oldPts;
    diff+=d; sq+=d*d; n++; d2.push(d);
    if(r.declTeam===newTeam){ nNew++; if(r.defWonLast) lostNew++; }
    else { nOld++; if(r.defWonLast) lostOld++; }
  }
  // 只有两副都跑完才配得成对;半副废掉的种子进不了配对口径(但仍留在逐副口径里)
  if(d2.length===2) paired.push((d2[0]+d2[1])/2);
}
const mean=diff/n, sd=Math.sqrt(sq/n-mean*mean), se=sd/Math.sqrt(n);
const P=paired.length;
const mP=paired.reduce((a,x)=>a+x,0)/P;
const sdP=Math.sqrt(paired.reduce((a,x)=>a+(x-mP)*(x-mP),0)/P);
const seP=sdP/Math.sqrt(P);
const nzArr=paired.filter(x=>x!==0);        // 两版行为真的不同的种子 —— 真实样本量
const nz=nzArr.length;
// 符号检验:每副净分差是重尾的,t 检验因此偏保守(见 NOTES/measurement.md 清单第 10 条)。
// 配对之后每个种子就是一个独立读数,可以直接数正负号,不必再等「多批合并」。
const pos=nzArr.filter(x=>x>0).length;
const z=nz?(Math.abs(pos-nz/2)-0.5)/Math.sqrt(nz/4):0;         // 连续性修正
const pSign=nz?2*(1-(x=>{                                       // 标准正态尾概率(Abramowitz-Stegun 7.1.26)
  const t=1/(1+0.2316419*x), d=Math.exp(-x*x/2)/Math.sqrt(2*Math.PI);
  return 1-d*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
})(z)):1;
console.log(`同桌配对对照 ${n} 副(${N} 种子 × 交换阵营${S0?`,自 ${S0+1} 起`:''})`);
console.log(`  新版 ${process.argv[2]||'80fen-test.html'}   旧版 ${process.argv[3]||'index.html'}`);
console.log(`  新版净胜 ${(mP/2).toFixed(2)} 分/局  (SE ${(seP/2).toFixed(2)}, t=${seP?(mP/seP).toFixed(2):'—'})  [配对口径]`);
console.log(`    逐副口径(旧)     SE ${(se/2).toFixed(2)}, t=${(mean/se).toFixed(2)}  ` +
            `—— 把同一副牌的两半当独立样本,SE 高估 ${seP?(se/seP).toFixed(1):'∞'} 倍`);
console.log(`    两版行为不同的种子 ${nz}/${P}(${(100*nz/P).toFixed(1)}%)—— 其余种子 D 恒为 0,不贡献信息`);
console.log(`    其中新版更好 ${pos}/${nz}(${(100*pos/(nz||1)).toFixed(1)}%),符号检验双尾 p=${pSign<1e-4?pSign.toExponential(1):pSign.toFixed(4)}`);
console.log(`  新版坐庄丢掉最后一墩 ${(100*lostNew/nNew).toFixed(1)}%  (${lostNew}/${nNew})`);
console.log(`  旧版坐庄丢掉最后一墩 ${(100*lostOld/nOld).toFixed(1)}%  (${lostOld}/${nOld})`);
