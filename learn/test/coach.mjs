/* 拿最新的 AI(测试版 80fen-test.html 的引擎)把单元 4 的跟牌题各答一遍,看它和标答是否一致。
       node learn/test/coach.mjs [80fen-test.html]
   这**不是**判对错的依据 —— 教学版只发 L1/L2 真值(DESIGN §二),AI 是 L3 启发式。
   它的用处是双向的(DESIGN §二「双向价值」):
     · AI 和标答不一致 → 先回头查题:是不是题面漏了一个前提,或者标答本身站不住;
     · 查完题站得住 → 这就是一条可以回报给 AI 线的场景(「这个局面 AI 答错了」)。
   AI 只看得见它的 view:手牌、出过的牌(题里 rows 标着「出过」的,喂进 buriedKnown 当已见),
   看不见题面里的文字前提(比如「北家亮主亮的是 ♥7」)—— 那几题不一致是意料之中,输出里会标出来。
   收官推演(≤ egMaxCards 张)关掉:题里的手牌只有两三张,推演会以为已经到了最后几墩。 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs'; import vm from 'node:vm';

const file=process.argv[2]||'80fen-test.html';
const src=fs.readFileSync(file,'utf8');
const block=[...src.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
const ctx={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};
ctx.globalThis=ctx; vm.createContext(ctx); vm.runInContext(block,ctx);
const E=ctx.module.exports;
E.AIP.egMaxCards=0;
const PAD=process.env.PAD===undefined?'1':process.env.PAD;   // PAD= 关掉补牌,对照用
const ver=(src.match(/80分 (v[\d.]+)/)||[])[1]||'?';

const b=await chromium.launch(); const p=await b.newPage();
await p.goto('file://'+process.cwd()+'/learn.html');
const qs=await p.evaluate(()=>{
  const out=[];
  for(const U of window.__LEARN__.UNITS) if(U.key==='u4') for(const L of U.lessons) L.qs.forEach((q,i)=>{
    if(q.type!=='trickpick'||q.lead===0) return;
    out.push({tag:`${L.id} q${i+1} ${q.task}`,tr:L.tr,q:JSON.parse(JSON.stringify(q))});
  });
  return out;
});
await b.close();

const nm=c=>c.suit==='X'?(c.rank===16?'大王':'小王'):({S:'♠',H:'♥',D:'♦',C:'♣'})[c.suit]+({11:'J',12:'Q',13:'K',14:'A'}[c.rank]||c.rank);
let same=0, diff=0;
console.log(`AI:${file} ${ver}(收官推演关闭)\n`);
for(const {tag,tr,q} of qs){
  let id=1000;
  const fix=c=>({suit:c.suit,rank:c.rank,id:id++,_id:c.id});
  const hand=q.hand.map(fix);
  const seen=(q.rows||[]).filter(r=>/出过|出完/.test(r.who)).flatMap(r=>r.cards).map(fix);
  const plays=[];
  for(let k=0;k<4;k++){ const s=(q.lead+k)%4; if(s===0) break; plays.push({seat:s,cards:[].concat(q.played[s]).map(fix)}); }
  // 题里只给了两三张相关的牌;AI 看手牌张数判断局势阶段,两三张会被当成最后几墩。
  // 补成 12 张:补的是和这一墩无关的门(不是领出门、不是主)里不带分的小牌。
  const led=[].concat(q.played[q.lead])[0];
  const ledEff=E.effSuit(led,tr);
  const filler=[];
  for(const s of ['S','H','C','D']) for(const r of [2,3,4,6,7,8,9]){
    const c={suit:s,rank:r};
    if(filler.length+hand.length>=12) break;
    if(r===tr.rank||s===tr.suit||E.effSuit(c,tr)===ledEff||E.effSuit(c,tr)==='T') continue;
    if(hand.some(h=>h.suit===s)&&PAD!=='any') continue;          // 手上已有的门不动,免得改变「这门有几张」
    filler.push(fix(c));
  }
  if(PAD) hand.push(...filler);
  const view={seat:0,trump:tr,declSeat:1,history:[],buriedKnown:seen,hand};
  let r; try{ r=E.aiChooseFollow(view,plays); }catch(e){ console.log(`!  ${tag} — AI 抛错 ${e.message}`); continue; }
  const got=r.cards.map(c=>c._id||hand.find(h=>h.id===c.id)._id);
  const ok=[q.answer].concat(q.accept||[]);
  const hit=got.length===1&&ok.includes(got[0]);
  hit?same++:diff++;
  const hidden=/亮/.test(q.prompt)?'  (题面前提里有「亮主」信息,AI 看不见)':'';
  if((!hit||process.env.SHOW==="all")&&process.env.SHOW) for(const c of (r.cands||[]).slice(0,4))
    console.log(`      ${c.score.toFixed(1).padStart(6)}  ${c.cards.map(x=>nm(x)).join(' ')}  ${c.cat} ${c.reason}`);
  console.log(`${hit?'=':'≠'}  ${tag} — 标答 ${ok.map(x=>nm(q.hand.find(c=>c.id===x))).join('/')},`+
              `AI 出 ${got.map(x=>nm(q.hand.find(c=>c.id===x))).join(' ')}(${r.reason||''})${hit?'':hidden}`);
}
console.log(`\n一致 ${same} / 不一致 ${diff}`);
