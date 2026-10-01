/* 真人牌谱(80fen-record-2)批量验收 + 概况。
 *
 *   node test/records-check.js <牌谱文件>... [html=80fen-test.html] [--bad]
 *
 * 文件是一行一局:设置里「导出全部牌谱」得到的 .txt,或收集表 doGet 下载的 JSONL(见 docs/upload/README.md)。
 * 也认单局 JSON(80fen-record-1/2)。多个文件按 id 去重。
 *
 * 每一局逐项核对,任何一项不过就判为坏局(--bad 列出原因):
 *   ① 发牌:按 seed + firstTaker 用 dealRound 重发,四家手牌 + 底牌要和记录对得上(庄家 = 扣底后手牌 + 扣的 8 张
 *      = 发到的 25 张 + 原底牌)—— 挡掉手改过的、拼凑的局;
 *   ② 出牌:按引擎规则逐手重放,领出要成牌型、甩牌要成立、跟牌要合法,牌要真在那一家手里;
 *   ③ 每墩赢家和分数、闲家总分要和引擎算的一致。
 * 然后按「谁做的决定」(by:h 你 / a 托管 / f 没得选)数手数,按玩家、版本、重打与否分组 ——
 * AI 线拿去用之前,先看这张表决定哪些能当「真人数据」。 */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const args=process.argv.slice(2);
const html=args.find(a=>a.endsWith('.html'))||path.join(__dirname,'..','80fen-test.html');
const files=args.filter(a=>!a.startsWith('--')&&!a.endsWith('.html'));
if(!files.length){ console.log('用法:node test/records-check.js <牌谱文件>... [--bad]'); process.exit(1); }
const src=[...fs.readFileSync(html,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c;
vm.createContext(c);vm.runInContext(src,c);
const E=c.module.exports;

const recs=new Map();
let unreadable=0;
for(const f of files){
  const txt=fs.readFileSync(f,'utf8').trim();
  const lines=txt.startsWith('{')&&!txt.includes('\n{')?[txt]:txt.split('\n');
  for(const l of lines){ if(!l.trim()) continue;
    try{ const r=JSON.parse(l); recs.set(r.id||('noid-'+recs.size),r); }catch(e){ unreadable++; } }
}

const code=c=>c.suit+c.rank;
const sortKey=a=>a.slice().sort().join(',');
function verify(r){
  if(!Array.isArray(r.initialHands)||r.initialHands.length!==4||!Array.isArray(r.tricks)) return '缺手牌或出牌记录';
  // ① 发牌
  if(r.seed!=null&&r.firstTaker!=null){
    const seed=parseInt(String(r.seed),10);
    const d=E.dealRound(seed,r.firstTaker);
    for(let s=0;s<4;s++){
      const got=s===r.declSeat?r.initialHands[s].concat(r.buried):r.initialHands[s];
      const want=s===r.declSeat?d.hands[s].map(code).concat(d.kitty.map(code)):d.hands[s].map(code);
      if(sortKey(got)!==sortKey(want)) return `发牌对不上种子(座位 ${s})`;
    }
    if(r.kitty&&sortKey(r.kitty)!==sortKey(d.kitty.map(code))) return '原底牌对不上种子';
  }
  // ② ③ 出牌
  let uid=0;
  const hands=r.initialHands.map(h=>h.map(x=>({suit:x[0],rank:+x.slice(1),id:'c'+(uid++)})));
  const trump=r.trump; let def=0, lastWin=-1, leader=r.declSeat;
  for(let ti=0;ti<r.tricks.length;ti++){
    const t=r.tricks[ti], plays=[];
    if(t.plays.length!==4) return `第 ${ti+1} 墩不是四家`;
    if(t.plays[0].seat!==leader) return `第 ${ti+1} 墩领出的人不对`;
    for(let i=0;i<4;i++){
      const p=t.plays[i];
      if(p.seat!==(leader+i)%4) return `第 ${ti+1} 墩出牌顺序不对`;
      const h=hands[p.seat], before=h.slice(), cards=[];
      for(const x of p.cards){ const k=h.findIndex(y=>code(y)===x); if(k<0) return `第 ${ti+1} 墩座位 ${p.seat} 手里没有 ${x}`; cards.push(h.splice(k,1)[0]); }
      if(i===0){
        const cl=E.classify(cards,trump);
        if(!cl) return `第 ${ti+1} 墩领出不成牌型`;
        if(cl.type==='throw'){
          const hs=hands.map((x,s)=>s===p.seat?before:x);
          if(!E.checkThrow(hs,p.seat,cards,trump).ok) return `第 ${ti+1} 墩甩牌不成立`;
        }
      }else{
        const lead=E.classify(plays[0].cards,trump);
        if(!E.isLegalFollow(before,lead,cards,trump)) return `第 ${ti+1} 墩座位 ${p.seat} 跟牌不合法`;
      }
      plays.push({seat:p.seat,cards});
    }
    const res=E.resolveTrick(plays,trump);
    if(res.winner!==t.winner) return `第 ${ti+1} 墩赢家不对`;
    if(res.points!==t.points) return `第 ${ti+1} 墩分数不对`;
    if(res.winner%2!==r.declSeat%2) def+=res.points;
    leader=lastWin=res.winner;
  }
  if(hands.some(h=>h.length)) return '打完还有牌没出';
  if(r.defPoints!=null){
    // 闲家得分 = 墩上分 + 抠底(末墩闲家赢时底分 × 倍数,见 scoreRound)
    const kitty=lastWin%2!==r.declSeat%2?(r.kittyPts||0)*(r.mult||0):0;
    if(def+kitty!==r.defPoints) return `闲家得分对不上(重算 ${def}+${kitty},记录 ${r.defPoints})`;
  }
  return '';
}

const bad=[], good=[];
for(const r of recs.values()){ let why; try{ why=verify(r); }catch(e){ why='重放出错:'+e.message; } (why?bad:good).push({r,why}); }

const pct=(a,b)=>b?(100*a/b).toFixed(0)+'%':'-';
console.log(`读入 ${recs.size} 局(${files.length} 个文件${unreadable?`,${unreadable} 行读不懂`:''}):有效 ${good.length},坏局 ${bad.length}`);
if(bad.length&&args.includes('--bad')) for(const {r,why} of bad) console.log(`  ✗ ${String(r.id).slice(0,8)} ${r.nick||String(r.pid||'').slice(0,8)} 第 ${r.no} 局:${why}`);
else if(bad.length) console.log('  (加 --bad 看原因)');

// 概况:按玩家
const by={};
for(const {r} of good){
  const k=r.pid||'?'; const o=by[k]||(by[k]={nick:r.nick||'',games:0,replay:0,h:0,a:0,f:0,hint:0,u:0,undos:0,ver:new Set(),eng:new Set()});
  o.games++; if(r.replay) o.replay++; o.undos+=r.undos||0; o.ver.add(r.version); 
  (r.engines||[]).forEach((v,s)=>{ if(s!==r.human&&v!=='latest') o.eng.add(v); });
  for(const t of r.tricks) for(const p of t.plays) if(p.seat===r.human){
    const w=p.by||'h'; o[w]=(o[w]||0)+1; if(p.hint) o.hint++; if(p.u) o.u++; }
}
console.log('\n玩家           局数  重打  真人手数  托管  没得选  照提示出  悔后重出  版本');
for(const [k,o] of Object.entries(by).sort((a,b)=>b[1].games-a[1].games)){
  const all=o.h+o.a+o.f;
  console.log(`${(o.nick||k.slice(0,8)).padEnd(14)} ${String(o.games).padStart(4)}  ${String(o.replay).padStart(4)}  `+
    `${String(o.h).padStart(8)}  ${pct(o.a,all).padStart(4)}  ${pct(o.f,all).padStart(6)}  ${pct(o.hint,o.h).padStart(8)}  ${String(o.u).padStart(8)}  `+
    [...o.ver].map(v=>v.replace(/^80分 |\(测试版\)$/g,'')).join(' ')+(o.eng.size?`  旧引擎:${[...o.eng].join(',')}`:''));
}
console.log('\n用作「真人数据」时建议:只取 by=h 的手;重打(replay)的局人可能已见过牌,另算;照提示出(hint)的手算半个 AI 决定。');
