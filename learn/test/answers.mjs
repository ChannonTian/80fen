/* 把每道出牌题的标答拿去问引擎:这手合法吗?真的赢下这一墩吗?
       node learn/test/answers.mjs
   为什么要有这个:walk.mjs 只验证「界面判它对」,而界面判对错用的是题里写死的
   q.answer —— 题出错了它一样绿。这个脚本绕开 q.answer,直接问引擎。
   起因是一道拖拉机题写成了 ♥A♥A + ♥J♥J(A 和 J 之间隔着 K、Q,根本不是拖拉机),
   脑内推演没推出来。
   带 rest 的题(单元 4 跟牌的位置):身后几家按 finishTrick 把这一墩打完,赢家看的是打完的结果;
   而且把手上**每一张别的合法牌**也打一遍 —— 标答打出来的结果要是不如一张「错」牌,
   学的人看见的就是「出错的牌反而更好」,那道题就是自相矛盾的。 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const b=await chromium.launch();
const p=await b.newPage();
const errs=[];
p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
await p.goto('file://'+process.cwd()+'/learn.html');

const rows=await p.evaluate(()=>{
  const {UNITS,winnerOf,isLegalFollow,legalSet,effSuit,classify,countPoints,finishTrick}=window.__LEARN__;
  // 我方净得:这一墩的分归谁,就给谁记正负
  const net=r=>r.done?(r.win%2===0?r.got:-r.got):null;
  const out=[];
  for(const U of UNITS) for(const L of U.lessons) L.qs.forEach((q,i)=>{
    if(!['trickpick','playset'].includes(q.type)||!q.played) return;
    const tr=q.tr!==undefined?q.tr:L.tr;
    const tag=`${L.id} q${i+1} ${q.task}`;
    if(q.anyLegal) return out.push({tag,note:'anyLegal,不判对错'});
    const ids=Array.isArray(q.answer)?q.answer:[q.answer];
    const cards=ids.map(id=>q.hand.find(c=>c.id===id));
    if(cards.some(c=>!c)) return out.push({tag,bad:'标答里有手牌中没有的牌'});
    const played=q.played.slice(); played[0]=cards.length>1?cards:cards[0];
    let legal=null;
    if(q.lead!==0&&q.played[q.lead]){
      const lead=classify([].concat(q.played[q.lead]),tr);
      legal=isLegalFollow(q.hand,lead,cards,tr);
    }
    let win=null; try{ win=winnerOf(played,q.lead,tr); }catch(e){ return out.push({tag,bad:'resolveTrick 抛错 '+e.message}); }
    // 不是末家、又没写 rest:这一墩还没打完,winnerOf 给的只是「暂时最大」
    const last=q.lead===1;
    let final=null, worse=[];
    if(q.rest&&cards.length===1){
      const r=finishTrick(q,cards[0],tr);
      if(!r.done) return out.push({tag,bad:'rest 没把这一墩补全(哪个座位缺牌?)'});
      final=r.win;
      const ok=new Set([q.answer].concat(q.accept||[]));
      const led=q.lead!==0&&q.played[q.lead]?[].concat(q.played[q.lead])[0]:null;
      const ledSuit=led?effSuit(led,tr):null;
      for(const c of legalSet(q.hand,ledSuit,tr)){
        if(ok.has(c.id)) continue;
        const alt=finishTrick(q,c,tr);
        if(net(alt)>net(r)) worse.push(`出 ${c.id} 打完是 ${net(alt)},标答只有 ${net(r)}`);
      }
    }
    // 题面写的「台面 25 分」得和桌上的牌对得上 —— 这类数字对不上,
    // 走查脚本一点也看不出来(它只点界面),但学习者算一遍就发现讲解是错的。
    const onTable=[].concat(...q.played.filter(Boolean).map(x=>[].concat(x)));
    const plain=q.prompt.replace(/<[^>]+>/g,'');
    const m=plain.match(/台面[^。;]{0,10}?(\d+)\s*分|这一墩[^。;]{0,10}?(\d+)\s*分/);
    out.push({tag,legal,win:final!=null?final:win,lead:q.lead,lose:!!q.lose,
              open:!last&&q.lead!==0&&!q.rest, worse,
              table:countPoints(onTable), whole:countPoints(onTable.concat(cards)),
              said:m?+(m[1]||m[2]):null, saidText:m?m[0]:''});
  });
  return out;
});

/* 字数预算(单元 2 起;单元 1 产品方认可过,不动)。产品方说「解释文字太多了」之后定的:
   题面只写牌桌上看不出来的东西,答对/答错各一句,总结一课只说一次(通关页上的 sum)。
   不设闸,字数一定会慢慢长回去 —— 每次补一句「顺便说明」都显得很合理。 */
const BUDGET={prompt:50,good:36,bad:36};
const texts=await p.evaluate(()=>{
  const t=h=>(h||'').replace(/<[^>]+>/g,'').replace(/\s/g,'');
  const out=[];
  for(const U of window.__LEARN__.UNITS){ if(U.key==='u1') continue;
    for(const L of U.lessons){
      if(!L.sum) out.push({tag:L.id,f:'sum',n:-1});
      L.qs.forEach((q,i)=>{
        for(const f of ['prompt','good','bad']) out.push({tag:`${L.id} q${i+1}`,f,n:t(q[f]).length});
        // key 圈的牌得真的在桌上(出过的牌、记录行、或者身后那几家的 rest 里)
        if(q.key){
          const onTable=[].concat(...(q.played||[]).filter(Boolean).map(x=>[].concat(x)),
            ...(q.rows||[]).map(r=>r.cards),...Object.values(q.rest||{}));
          for(const id of q.key) if(!onTable.some(c=>c.id===id)) out.push({tag:`${L.id} q${i+1}`,f:'key',n:-2,id});
        }
      });
    }}
  return out;
});
let bad=0;
for(const x of texts){
  if(x.n===-1){ bad++; console.log(`✗  ${x.tag} 没有 sum(通关页那一句)`); }
  else if(x.n===-2){ bad++; console.log(`✗  ${x.tag} key 里的 ${x.id} 不在桌上`); }
  else if(x.n>BUDGET[x.f]){ bad++; console.log(`✗  ${x.tag} ${x.f} ${x.n} 字,超过 ${BUDGET[x.f]}`); }
}
for(const r of rows){
  if(r.note){ console.log(`·  ${r.tag} — ${r.note}`); continue; }
  const p1=[];
  if(r.bad){ p1.push('✗ '+r.bad); }
  if(r.legal===false){ p1.push('✗ 标答不合法(跟牌义务)'); }
  // 领出题只出了一张牌,这一墩还没打完,赢家无从谈起
  const judged = r.lead!==0;
  if(judged&&!r.lose&&r.win%2!==0) p1.push(`✗ 标答打出去这一墩被 ${['南','东','北','西'][r.win]} 收走(本意是要赢下来?没写 lose:true)`);
  if(judged&&r.lose&&r.win%2===0) p1.push('✗ 写了 lose:true,可这一墩其实是我方收走的');
  if(r.open) p1.push('✗ 你不是最后一家,又没写 rest —— 这一墩没打完,「收走」无从判断');
  for(const w of r.worse||[]) p1.push('✗ 打完一比,「错」牌反而更好:'+w);
  if(r.said!=null&&r.said!==r.table&&r.said!==r.whole)
    p1.push(`✗ 题面写「${r.saidText}」,可桌上的牌是 ${r.table} 分(加上你这张 ${r.whole} 分)`);
  if(p1.length){ bad++; console.log(`✗  ${r.tag}\n   `+p1.join('\n   ')); }
  else console.log(`✓  ${r.tag}${r.lead===0?' (领出)':''} — ${r.lead===0?'合法':'合法,'+['南','东','北','西'][r.win]+'收'}`+
                   `,台面 ${r.table} 分${r.said!=null?' ✓题面':''}`);
}
if(errs.length){ bad++; errs.forEach(e=>console.log(e)); }
console.log(bad?`\n${bad} 处有问题`:'\n全部通过');
await b.close();
process.exit(bad?1:0);
