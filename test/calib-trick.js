/* 下游校准:AI 预测的「本队拿下这一墩」的概率,和这一墩实际的结果对得上吗?
 *
 *   node test/calib-trick.js <html> [种子数=200]
 *
 * 起因(DESIGN §7.13 阶段 3):calib-infer 把断门推断改准了(对数损失 0.536 → 0.371),
 * 接进出牌棋力却没涨。用推断的那些打分项是围着**旧的、有偏的**推断标定的 —— 推断改准了,
 * 它们可能跟着失准。先量它们的**输出**:领出侧 `leadWinP`(本队赢这墩的概率)、
 * 跟牌侧 `pTeamWin`(出这手之后本队赢这墩的概率)。出完这一墩就知道结果,可以直接对照。
 *
 * 只量 AI 真正选的那一手(别的候选没有结果可对)。
 * 分层:领出 / 跟牌;我方是庄 / 闲;这一手是不是可能被毙(领出副牌、对手断门概率 > 0.2)。
 * OV 同时改变推断与出牌,用来对照「旧推断 vs 新推断」下同一个预测量的校准。
 */
'use strict';
const fs=require('fs'),vm=require('vm');
const FILE=process.argv[2]||'80fen-test.html';
const src=[...fs.readFileSync(FILE,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c;
vm.createContext(c);vm.runInContext(src,c);
const E=c.module.exports;
if(process.env.EG!=='1') E.AIP.egSearch=0;
if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV));
const N=+process.argv[3]||200, S0=+(process.env.SEED0||0);
const recs=[];     // {p, y, kind:'lead'|'follow', decl, ruffy, n}

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
  const rand=E.rng(seed^0x9e3779b9);
  const history=[]; let leader=declSeat;
  while(hands.some(h=>h.length)){
    const plays=[], pend=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4, hand=hands[seat];
      const view={seat,hand,trump,declSeat,history:[...history,...plays],
                  buriedKnown:seat===declSeat?buried:[]};
      let cards;
      if(i===0){
        cards=E.aiChooseLead(view).cards;
        const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced;
        const cl=E.classify(cards,trump);
        if(cl&&cl.type!=='throw'&&hand.length>1){
          const L=E.leadCtx(view);
          const p=c.leadWinP(L,cl,cards);
          const ruffy=cl.suit!=='T'&&L.oppVoidP(cl.suit)>0.2;
          pend.push({p,team:seat%2,kind:'领出',decl:seat%2===declSeat%2,ruffy,n:hand.length});
        }
      }else{
        const lead=E.classify(plays[0].cards,trump);
        cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hand,lead,cards,trump)) cards=E.genFollow(hand,lead,trump,rand);
        if(i<3&&lead.cards.length===1){          // 末家的结果是确定的,不量
          const X=E.followCtx(view,plays);
          const cl=E.classify(cards,trump);
          let beats=false;
          if(cl&&E.structMatches(cl,X.lead)){
            if(cl.suit===X.cur.cl.suit) beats=cl.top>X.cur.cl.top; else if(cl.suit==='T') beats=true; }
          const p=E.pTeamWin(X,cards,beats);
          const isRuff=cl&&cl.suit==='T'&&lead.suit!=='T';
          const cat=beats?(isRuff?'我毙了':'我压过去了'):(X.partnerWinning?'队友暂大、我没压':'对手暂大、我没压');
          pend.push({p,team:seat%2,kind:'跟牌',decl:seat%2===declSeat%2,cat,pos:i+1,
                     pts:E.countPoints(cards),
                     ruffy:lead.suit!=='T'&&X.oppVoidP(lead.suit)>0.2,n:hand.length});
        }
      }
      cards.forEach(x=>E.removeCard(hand,x));
      plays.push({seat,cards});
    }
    history.push(...plays);
    const w=E.resolveTrick(plays,trump).winner;
    for(const r of pend) recs.push({...r,y:w%2===r.team?1:0});
    leader=w;
  }
}
const eps=1e-6, cl=p=>Math.min(1-eps,Math.max(eps,p));
const fmt=g=>{ const n=g.length; if(!n) return 'n=0';
  let b=0,l=0,mp=0,my=0; for(const r of g){ b+=(r.p-r.y)**2; l-=r.y?Math.log(cl(r.p)):Math.log(cl(1-r.p)); mp+=r.p; my+=r.y; }
  return `n=${String(n).padStart(6)}  预测 ${(100*mp/n).toFixed(1).padStart(5)}%  实际 ${(100*my/n).toFixed(1).padStart(5)}%  Brier ${(b/n).toFixed(4)}  对数损失 ${(l/n).toFixed(3)}`; };
console.log(`${FILE}${process.env.OV?' OV='+process.env.OV:''} —— ${N} 副(自 ${S0+1} 起)`);
for(const k of ['领出','跟牌']){
  const g=recs.filter(r=>r.kind===k);
  console.log(`\n【${k}】全部         ${fmt(g)}`);
  console.log(`  我方坐庄        ${fmt(g.filter(r=>r.decl))}`);
  console.log(`  我方是闲家      ${fmt(g.filter(r=>!r.decl))}`);
  console.log(`  可能被毙        ${fmt(g.filter(r=>r.ruffy))}`);
  console.log(`  不太会被毙      ${fmt(g.filter(r=>!r.ruffy))}`);
  if(k==='跟牌'){
    console.log('   按这一手的类别(第几家):');
    for(const ct of ['我压过去了','我毙了','队友暂大、我没压','对手暂大、我没压']) for(const pos of [2,3]){
      const gg=g.filter(r=>r.cat===ct&&r.pos===pos); if(gg.length<20) continue;
      console.log(`     ${ct.padEnd(9)} 第${pos}家  ${fmt(gg)}`);
      const hi=gg.filter(r=>r.p>=0.9); if(hi.length>=20)
        console.log(`        └ 其中预测≥0.9 的  ${fmt(hi)}   贴了分的 ${hi.filter(r=>r.pts>0).length}`);
    }
  }
  console.log('   分箱:');
  for(let b=0;b<10;b++){ const lo=b/10,hi=(b+1)/10;
    const gg=g.filter(r=>r.p>=lo&&(b===9?r.p<=hi:r.p<hi)); if(gg.length<30) continue;
    const m=x=>gg.reduce((s,r)=>s+r[x],0)/gg.length;
    console.log(`     [${lo.toFixed(1)},${hi.toFixed(1)})  n=${String(gg.length).padStart(6)}  预测 ${(100*m('p')).toFixed(1).padStart(5)}%  实际 ${(100*m('y')).toFixed(1).padStart(5)}%`); }
}
