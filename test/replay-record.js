/* 把一局真人对局的牌谱(界面结算框里「复制牌谱」导出的那段 JSON)逐手还原,
 * 每一个决策点重新问一遍 AI:它会出什么、前几名候选各多少分、理由是什么。
 *
 *   node test/replay-record.js <牌谱.json> [html=80fen-test.html] [--trick=N] [--seat=S] [--eg]
 *
 * 起因(2026-09-25):产品方试玩 v0.7.21 报了三种行为,自对弈里复现不出同样的规模 ——
 * 与其继续猜判据,不如拿真实的那几手原样还原,逐项拆 AI 为什么那么打。
 *
 * 读法:
 *   · AI 坐的位置:「实际」应当和「AI 重算」一致(打分是确定的);不一致说明还原有偏差,
 *     先别看那一手的解释。
 *   · 人坐的位置:「AI 重算」就是换成 AI 会怎么打,可以对照人的出法。
 * 默认关收官搜索(`--eg` 打开),和界面一致需要打开 —— 手牌 ≤8 张时两者可能不同。
 */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const args=process.argv.slice(2);
const recFile=args.find(a=>!a.startsWith('--')&&a.endsWith('.json'))||args[0];
const html=args.find(a=>a.endsWith('.html'))||path.join(__dirname,'..','80fen-test.html');
const opt=k=>{const a=args.find(x=>x.startsWith('--'+k+'='));return a?a.split('=')[1]:null;};
const onlyTrick=opt('trick')!==null?+opt('trick'):null, onlySeat=opt('seat')!==null?+opt('seat'):null;
const src=[...fs.readFileSync(html,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c;
vm.createContext(c);vm.runInContext(src,c);
const E=c.module.exports;
if(!args.includes('--eg')) E.AIP.egSearch=0;
if(process.env.OV) Object.assign(E.AIP,JSON.parse(process.env.OV));

const rec=JSON.parse(fs.readFileSync(recFile,'utf8'));
if(rec.fmt!=='80fen-record-1') console.log('⚠️ 格式标记不是 80fen-record-1,照样试着读');
const NAME=['南','东','北','西'];
const nm=c=>c.suit==='X'?(c.rank===16?'大王':'小王'):c.suit+({11:'J',12:'Q',13:'K',14:'A'}[c.rank]||c.rank);
const ns=cs=>cs.map(nm).join(' ');
let uid=0;
const parse=s=>({suit:s[0],rank:+s.slice(1),id:'r'+(uid++)});
const hands=rec.initialHands.map(h=>h.map(parse));
const buried=rec.buried.map(parse);
const trump=rec.trump, declSeat=rec.declSeat;
// 出过的牌从手里按「花色 + 点数」取第一张没用过的(两副牌同一张有两份,哪一份无所谓)
const take=(seat,code)=>{ const h=hands[seat]; const i=h.findIndex(x=>x.suit+x.rank===code);
  if(i<0) throw new Error(`${NAME[seat]} 手里找不到 ${code}`); return h.splice(i,1)[0]; };

console.log(`${rec.version||''}  第 ${rec.no} 局  ${NAME[declSeat]} 坐庄  主 ${trump.suit||'无'} 打 ${trump.rank}  `
  +`闲家得分 ${rec.defPoints}  人坐 ${NAME[rec.human]}  用 ${path.basename(html)}${E.AIP.egSearch?'(收官搜索开)':'(收官搜索关)'}`);
console.log(`庄家扣底:${ns(buried)}\n`);
const history=[]; let mismatches=0, aiMoves=0;
rec.tricks.forEach((t,ti)=>{
  const plays=[];
  const show=onlyTrick===null||onlyTrick===ti+1;
  if(show) console.log(`—— 第 ${ti+1} 墩 ——`);
  for(let i=0;i<t.plays.length;i++){
    const {seat,cards:codes}=t.plays[i];
    const hand=hands[seat];
    const view={seat,hand:hand.slice(),trump,declSeat,history:history.slice().concat(plays),
                buriedKnown:seat===declSeat?buried:[]};
    let r; try{ r=i===0?E.aiChooseLead(view):E.aiChooseFollow(view,plays); }catch(e){ r={cards:[],reason:'出错:'+e.message,cands:[]}; }
    const actual=codes.map(code=>take(seat,code));
    const same=r.cards.length===actual.length&&r.cards.map(nm).sort().join()===actual.map(nm).sort().join();
    const isHuman=seat===rec.human;
    if(!isHuman){ aiMoves++; if(!same) mismatches++; }
    if(show&&(onlySeat===null||onlySeat===seat)){
      const tag=isHuman?(same?'  (你出的和 AI 一样)':'  ← 你出的;AI 会出 '+ns(r.cards)):(same?'':'  ⚠️ 与 AI 重算不一致:AI 会出 '+ns(r.cards));
      console.log(`  ${NAME[seat]}${seat===declSeat?'(庄)':''}${isHuman?'[人]':''} 出 ${ns(actual)}${tag}   理由:${r.reason||''}`);
      const cands=(r.cands||[]).slice().sort((a,b)=>b.score-a.score).slice(0,4);
      for(const q of cands) console.log(`        ${ns(q.cards).padEnd(12)} ${q.score.toFixed(1).padStart(7)}  ${q.reason||''}`);
    }
    plays.push({seat,cards:actual});
  }
  history.push(...plays);
  const res=E.resolveTrick(plays,trump);
  if(show) console.log(`  → ${NAME[res.winner]} 拿下,${res.points} 分${res.winner!==t.winner?'  ⚠️ 记录里是 '+NAME[t.winner]:''}\n`);
});
console.log(`AI 座位的 ${aiMoves} 手里,重算与实际不一致 ${mismatches} 手`
  +(mismatches?'(收官搜索或界面给 AI 的信息与这里不同时会出现;手牌 >8 张的中盘应当一致)':''));
