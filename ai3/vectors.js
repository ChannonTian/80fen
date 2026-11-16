/* ai3/vectors.js —— 用内核跑 test/rules-vectors.js 的向量。
 *   node ai3/vectors.js
 * 做法:读向量源码,在 vm 里跑,给它假的 require('../contest/engine.js'),
 * 返回 {E: shim}。shim 里 effSuit/ordIdx/decompose/classify/isLegalFollow/structMatches/
 * resolveTrick/checkThrow/countPairsIn/maxTractorLen 走内核(牌对象 <-> 牌种号转换),
 * 其余(advanceMatch、dealRound、...)直通现引擎 —— 见输出末尾的「直通」清单。 */
'use strict';
const fs=require('fs'), path=require('path'), vm=require('vm');
const K=require('./kernel.js'), U=K.util;
const Eng=require('../ai2/sim.js').loadEngine();
const SU='SHDC', pass=new Set(), used=new Set();
const tOf=c=>c.rank===15?52:c.rank===16?53:SU.indexOf(c.suit)*13+c.rank-2;
const trT=tr=>({ts:tr.suit?SU.indexOf(tr.suit):4,tr:tr.rank});
const effS=i=>i===4?'T':SU[i];
function mk(name,f){ return (...a)=>{ used.add(name); return f(...a); }; }
// 把牌种数组映射回输入牌对象(同牌种按顺序取)
function back(types,cards){
  const pool={}; for(const c of cards)(pool[tOf(c)]=pool[tOf(c)]||[]).push(c);
  return types.map(t=>pool[t].shift());
}
const clsOf=(cards,trump)=>{ const {ts,tr}=trT(trump); const types=cards.map(tOf); const r=U.classifyT(types,ts,tr); if(!r) return null;
  const type=['single','pair','tractor','throw'][r.kind];
  const out={type,suit:effS(r.suit),top:r.top,cards};
  if(r.kind===2) out.len=r.len;
  if(r.kind===3) out.comps=r.comps.map(c=>({type:['single','pair','tractor'][c.kind],len:c.kind===2?c.len:undefined,top:c.top,cards:back(c.cards,cards)}));
  return out; };
const shim=Object.assign({},Eng,{
  effSuit:mk('effSuit',(c,t)=>{ const {ts,tr}=trT(t); return effS(U.effSuitT(tOf(c),ts,tr)); }),
  ordIdx:mk('ordIdx',(c,t)=>{ const {ts,tr}=trT(t); return U.ordIdxT(tOf(c),ts,tr); }),
  decompose:mk('decompose',(cards,t)=>{ const {ts,tr}=trT(t); const d=U.decomposeT(cards.map(tOf),ts,tr);
    return d.map(c=>({type:['single','pair','tractor'][c.kind],len:c.kind===2?c.len:undefined,top:c.top,cards:back(c.cards,cards)})); }),
  classify:mk('classify',clsOf),
  isLegalFollow:mk('isLegalFollow',(hand,lead,chosen,t)=>{ const {ts,tr}=trT(t); void lead.cards.length;   // 领出为 null 时与现引擎一样抛 TypeError
    const ids=new Set(hand.map(c=>c.id)), seen=new Set();
    for(const c of chosen){ if(!ids.has(c.id)||seen.has(c.id)) return false; seen.add(c.id); }
    return U.isLegalFollowT(hand.map(tOf),lead.cards.map(tOf),chosen.map(tOf),ts,tr); }),
  structMatches:mk('structMatches',(cand,lead)=>{ const t=cand.trumpForShim||CUR; const {ts,tr}=trT(t);
    return U.structMatchesT(cand.cards.map(tOf),lead.cards.map(tOf),ts,tr); }),
  resolveTrick:mk('resolveTrick',(plays,t)=>{ const {ts,tr}=trT(t);
    const r=U.resolveTrickT(plays.map(p=>({seat:p.seat,types:p.cards.map(tOf)})),ts,tr); return {winner:r.winner,points:r.points}; }),
  checkThrow:mk('checkThrow',(hands,seat,cards,t)=>{ const {ts,tr}=trT(t);
    const r=U.checkThrowT(hands.map(h=>h.map(tOf)),seat,cards.map(tOf),ts,tr);
    return r.ok?{ok:true}:{ok:false,forced:back(r.forced,cards)}; }),
  countPairsIn:mk('countPairsIn',cards=>U.countPairsInT(cards.map(tOf))),
  maxTractorLen:mk('maxTractorLen',(cards,t)=>{ const {ts,tr}=trT(t); return U.maxTractorLenT(cards.map(tOf),ts,tr); }),
});
/* structMatches(cand,lead) 不带 trump:向量里恒为 主♥打5(T5),其余函数不需要 */
let CUR={suit:'H',rank:5};
const src=fs.readFileSync(path.join(__dirname,'..','test','rules-vectors.js'),'utf8');
let out='', code=0;
const ctx={console:{log:(...a)=>{ const s=a.join(' '); out+=s+'\n'; console.log(s); }},
  process:{argv:['node','v'],exit:c=>{ code=c; throw new Error('__exit__'); }},
  require:p=>{ if(/contest\/engine/.test(p)) return {load:()=>({E:shim})}; throw new Error('require '+p); },
  JSON,Set,Map,Math,Object,Array,String,Number};
vm.createContext(ctx);
try{ vm.runInContext(src,ctx); }catch(e){ if(e.message!=='__exit__') throw e; }
const m=out.match(/通过 (\d+) 项,失败 (\d+) 项/);
const NA=['advanceMatch(整场推进)','dealRound(发牌)'];
console.log(`\n== 内核向量结果:通过 ${m[1]} / 总 ${(+m[1])+(+m[2])},失败 ${m[2]} ==`);
console.log('走内核的函数:'+[...used].join(', '));
console.log('直通现引擎(内核不管):'+NA.join(', '));
console.log('不适用:「非法领出」组里 isLegalFollow(领出为 null)抛异常那条 —— 内核对混门领出 classify 返回 null(与引擎一致);「抛异常」是 JS 空指针行为,内核 API 无此概念,由 shim 里的 lead.cards 取值模拟,此条算 shim 行为而非内核行为。');
process.exit(+m[2]?1:0);
