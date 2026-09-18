/* 定点反事实**普扫**:不预设「哪里该改」,让量具自己把亏在哪报出来。
 *
 *   node test/cf-scan.js <html> [种子数=400]
 *
 * 为什么要有这一把 ——
 * 之前四把 cf 都是「先有一条断言,再做一把量具去验」。四条断言现在全部不成立
 * (cf-ruff / cf-highlead 缺口消失,cf-line 是量具伪影,cf-pair 两轮全负),
 * 短板表上一条活的都不剩。再照老路做第五把「我猜这里亏」的量具,
 * 大概率还是猜错。所以换个方向:**不猜**,把所有跟牌决策点按「AI 选了哪一类打法」
 * 分格,每一格都去问「换成另一类会不会更好」,亏在哪一格由数据说。
 *
 * 判据(最干净的那一类决策点,占绝大多数):
 *   · 领出一张、AI 也跟一张 —— 于是候选就是手里每一张合法牌,可以穷举;
 *   · 至少存在一张**类别不同**的合法替代牌(否则这一手没得选,不算决策)。
 *
 * 分叉:
 *   A 现状 —— aiChooseFollow 真正出的那一张(**生产路径**,含收官搜索)
 *   B 替代 —— 所有「类别与 A 不同」的合法牌里,coachScoreFollow 打分最高的那张
 *             (即 AI 自己心目中的「次优类别的最好代表」)
 * 两条支路用同一套 AI 打完整局,比最终结果。dp>0 = B 更好 = 这一格 AI 选错了类。
 *
 * 类别(五类,按这一张牌在本墩里扮演的角色):
 *   毙  垫主牌吃下这一墩          压  本门大过去
 *   贴  不吃,垫出去的牌带分       垫  不吃,垫出去的牌不带分
 *   跟小 不吃,本门跟一张(带不带分再按 pw 分)
 * 「贴」的好坏完全取决于队友是不是暂大 —— 所以每一格再按 pw(队友暂大)拆开看。
 *
 * SAME=1 换第二个口径:B 改成「和 A **同类**、但不是 A」里打分最高的那张 ——
 * 扫的是「类选对了、类里挑错了牌」(毙用哪张主、垫哪张废牌)。
 *
 * ⚠️ 生产配置:不关 egSearch。EG=0 才关,只用来快速探路,探路的数字不许当结论。
 */
const fs=require('fs'),vm=require('vm');
const FILE=process.argv[2]||'80fen-test.html';
const b=[...fs.readFileSync(FILE,'utf8')
  .matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c;
vm.createContext(c);vm.runInContext(b[0],c);
const E=c.module.exports;
if(process.env.EG==='0') E.AIP.egSearch=0;
if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV));

/* 从某个残局(含本墩已出的牌)接着打完,forced 指定某一家的这一手打什么 */
function playOut(st, forced){
  const hands=st.hands.map(h=>h.slice()), history=st.history.slice();
  let leader=st.leader, defPoints=st.defPoints, tricks=st.tricks;
  const {trump,declSeat,buried}=st, declTeam=declSeat%2;
  let lastWinner=st.lastWinner, lastLeadSize=st.lastLeadSize;
  let pending=st.plays?st.plays.slice():[];
  const rand=E.rng(st.seed^0x9e3779b9);
  let first=true;
  while(hands.some(h=>h.length)){
    const plays=first?pending:[];
    first=false;
    for(let i=plays.length;i<4;i++){
      const seat=(leader+i)%4;
      const view={seat,hand:hands[seat],trump,declSeat,history:[...history,...plays],
                  buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(forced&&forced.seat===seat&&!forced.used){
        cards=forced.cards; forced.used=true;
      }else if(i===0){
        cards=E.aiChooseLead(view).cards;
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok)cards=chk.forced;
      }else{
        const lead=E.classify(plays[0].cards,trump);
        cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hands[seat],lead,cards,trump))
          cards=E.genFollow(hands[seat],lead,trump,rand);
      }
      cards.forEach(x=>E.removeCard(hands[seat],x));
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
  return {sc, declTeam};
}
const val=(r,team)=>r.declTeam===team?80-r.sc.total:r.sc.total-80;
function netLevels(r,team){
  const {sc,declTeam}=r;
  const defUp=sc.defendersWin?1+(sc.defenderLevelsUp||0):0;
  const decUp=sc.defendersWin?0:(sc.declarerLevelsUp||0);
  const iAmDecl=team===declTeam;
  return (iAmDecl?decUp:defUp)-(iAmDecl?defUp:decUp);
}

const N=+process.argv[3]||400;
const S0=+(process.env.SEED0||0);
const PROB=+(process.env.PROB||10);    // 每 PROB 个合格决策点抽 1 个
const MAXH=+(process.env.MAXH||3);     // 每副最多抽几个(免得少数几副牌主导样本)
/* SAME=1:改扫**同一类内部**的排序 —— B 换成「和 A 同类、但不是 A」里打分最高的那张。
 * 默认那一版比的是「该打哪一类」,看不见「类选对了、类里挑错了牌」
 * (毙用哪张主、垫哪张废牌)。两个口径要分开跑,不能混在一张表里。 */
const SAME=process.env.SAME==='1';

/* 这一张牌在本墩里扮演什么角色 */
function catOf(x, X, leadSuit, trump){
  const su=E.effSuit(x,trump);
  const cl=E.classify([x],trump);
  let win=false;
  if(cl&&E.structMatches(cl,X.lead)){
    if(cl.suit===X.cur.cl.suit) win=cl.top>X.cur.cl.top;
    else if(cl.suit==='T') win=true;
  }
  if(win) return (su==='T'&&leadSuit!=='T')?'毙':'压';
  if(su===leadSuit) return '跟小';
  return E.cardPoints(x)>0?'贴':'垫';
}

let nHit=0, nSeed=0, nElig=0, cnt=0;
const rec=[];

for(let seed=S0+1;seed<=S0+N;seed++){
  const {first}=E.cutForFirst(seed);
  const {hands,kitty}=E.dealRound(seed,first);
  let best=null,declSeat=-1;
  for(let s=0;s<4;s++){const o=E.declOptions(hands[s],E.RULES.levelStart)[0];
    if(o&&(!best||o.strength>best.strength)){best=o;declSeat=s;}}
  const trump=best?{suit:best.suit,rank:E.RULES.levelStart}:{suit:null,rank:E.RULES.levelStart};
  if(!best) declSeat=first;
  hands[declSeat].push(...kitty);
  const buried=E.aiDiscard(hands[declSeat],trump);
  buried.forEach(x=>E.removeCard(hands[declSeat],x));
  const declTeam=declSeat%2;
  const rand=E.rng(seed^0x9e3779b9);
  const history=[]; let leader=declSeat, defPoints=0, tricks=0,
      lastWinner=declSeat, lastLeadSize=1;
  let hitsThisDeal=0;

  while(hands.some(h=>h.length)){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4;
      const view={seat,hand:hands[seat],trump,declSeat,history:[...history,...plays],
                  buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){ cards=E.aiChooseLead(view).cards;
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok)cards=chk.forced; }
      else{
        const lead=E.classify(plays[0].cards,trump);
        cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hands[seat],lead,cards,trump))
          cards=E.genFollow(hands[seat],lead,trump,rand);

        // ---------- 判据 ----------
        if(lead.cards.length===1&&cards.length===1&&hitsThisDeal<MAXH){
          const hand=hands[seat];
          const X=E.followCtx(view,plays);
          const cA=catOf(cards[0],X,lead.suit,trump);
          // 类别不同的合法替代里,AI 自己打分最高的那一张
          let B=null,sB=-Infinity;
          for(const x of hand){
            if(x.id===cards[0].id) continue;
            if(!E.isLegalFollow(hand,lead,[x],trump)) continue;
            if((catOf(x,X,lead.suit,trump)===cA)!==SAME) continue;
            const s=E.coachScoreFollow(view,plays,[x]);
            if(s>sB){ sB=s; B=x; }
          }
          if(B){
            nElig++;
            if(cnt++%PROB===0){
              const st={hands,history,leader,declSeat,trump,buried,defPoints,tricks,
                        lastWinner,lastLeadSize,plays,seed};
              const rA=playOut(st,{seat,cards,used:false});
              const rB=playOut(st,{seat,cards:[B],used:false});
              const team=seat%2;
              rec.push({
                seed,
                a:cA, b:catOf(B,X,lead.suit,trump),
                dp:val(rB,team)-val(rA,team),
                dl:netLevels(rB,team)-netLevels(rA,team),
                pw:!!X.partnerWinning,          // 队友此刻暂大
                last:i===3,                     // 我坐末手(信息最全)
                decl:team===declTeam,           // 我是庄家方
                tab:X.ptsTable||0,              // 本墩台面分
                tr:tricks,                      // 已打了几墩
                phase:hand.length,              // 手牌张数
                gap:E.coachScoreFollow(view,plays,cards)-sB   // A 比 B 高多少分(AI 自估)
              });
              nHit++; hitsThisDeal++;
            }
          }
        }
      }
      cards.forEach(x=>E.removeCard(hands[seat],x));
      plays.push({seat,cards});
    }
    history.push(...plays);
    lastLeadSize=plays[0].cards.length;
    const res=E.resolveTrick(plays,trump);
    leader=res.winner; lastWinner=res.winner; tricks++;
    if(res.winner%2!==declTeam) defPoints+=res.points;
    if(tricks>60) break;
  }
  if(hitsThisDeal) nSeed++;
}

const stat=a=>{
  if(!a.length) return 'n=0';
  const m=a.reduce((x,y)=>x+y,0)/a.length;
  const sd=Math.sqrt(a.reduce((x,y)=>x+(y-m)*(y-m),0)/a.length);
  const se=sd/Math.sqrt(a.length);
  const pos=a.filter(x=>x>0).length, neg=a.filter(x=>x<0).length;
  return `${m>=0?'+':''}${m.toFixed(2)} ±${se.toFixed(2)} (t=${se?(m/se).toFixed(2):'—'}) 正/负/平 ${pos}/${neg}/${a.length-pos-neg} n=${a.length}`;
};
const sel=(f,k)=>rec.filter(f).map(r=>r[k]);
console.log(`${FILE} —— ${N} 局(自 ${S0+1} 起,${SAME?'同类内部排序':'该打哪一类'}):`
  +`合格决策点 ${nElig} 个,抽了 ${nHit} 个(分布在 ${nSeed} 副)`);
if(!rec.length){ console.log('  (一个都没命中)'); process.exit(0); }
console.log(`  总表(所有格一起,应当接近 0 —— 若整体显著为正,先怀疑量具而不是 AI):`);
console.log(`    分数 ${stat(rec.map(r=>r.dp))}`);
console.log(`    级数 ${stat(rec.map(r=>r.dl))}`);
/* 按「AI 选了哪一类 → 换成哪一类」分格。dp 显著为正的格子 = 一条活的短板。 */
const cells={};
for(const r of rec){ const k=r.a+'→'+r.b; (cells[k]=cells[k]||[]).push(r); }
console.log('  按「AI 选的类 → 替代类」分格(按样本量排序,只列 n≥12 的):');
for(const k of Object.keys(cells).sort((x,y)=>cells[y].length-cells[x].length)){
  if(cells[k].length<12) continue;
  console.log(`    ${k.padEnd(8)} 分数 ${stat(cells[k].map(r=>r.dp))}`);
}
const layers=[
  ['队友暂大 pw=1', r=>r.pw], ['对手暂大 pw=0', r=>!r.pw],
  ['末手', r=>r.last], ['非末手', r=>!r.last],
  ['庄家方', r=>r.decl], ['闲家方', r=>!r.decl],
  ['台面 0 分', r=>r.tab===0], ['台面 ≥5 分', r=>r.tab>=5],
  ['开局 手≥17', r=>r.phase>=17], ['中盘 手 9~16', r=>r.phase>=9&&r.phase<17],
  ['收官 手 ≤8', r=>r.phase<9],
  ['A 自估领先大 gap≥20', r=>r.gap>=20], ['A 自估领先小 gap<20', r=>r.gap<20],
];
console.log('  分层(横切所有格):');
for(const [k,f] of layers){ const a=sel(f,'dp'); if(a.length>=12) console.log(`    ${k.padEnd(16)} ${stat(a)}`); }
if(process.env.RAW) console.log('RAW '+JSON.stringify({N,S0,nHit,nElig,nSeed,rec}));
