/* 把每道出牌题的标答拿去问引擎:这手合法吗?真的赢下这一墩吗?
       node learn/test/answers.mjs
   为什么要有这个:walk.mjs 只验证「界面判它对」,而界面判对错用的是题里写死的
   q.answer —— 题出错了它一样绿。这个脚本绕开 q.answer,直接问引擎。
   起因是一道拖拉机题写成了 ♥A♥A + ♥J♥J(A 和 J 之间隔着 K、Q,根本不是拖拉机),
   脑内推演没推出来。 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const b=await chromium.launch();
const p=await b.newPage();
const errs=[];
p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
await p.goto('file://'+process.cwd()+'/learn.html');

const rows=await p.evaluate(()=>{
  const {UNITS,winnerOf,isLegalFollow,classify,countPoints}=window.__LEARN__;
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
    // 题面写的「台面 25 分」得和桌上的牌对得上 —— 这类数字对不上,
    // 走查脚本一点也看不出来(它只点界面),但学习者算一遍就发现讲解是错的。
    const onTable=[].concat(...q.played.filter(Boolean).map(x=>[].concat(x)));
    const plain=q.prompt.replace(/<[^>]+>/g,'');
    const m=plain.match(/台面[^。;]{0,10}?(\d+)\s*分|这一墩[^。;]{0,10}?(\d+)\s*分/);
    out.push({tag,legal,win,lead:q.lead,lose:!!q.lose,
              table:countPoints(onTable), whole:countPoints(onTable.concat(cards)),
              said:m?+(m[1]||m[2]):null, saidText:m?m[0]:''});
  });
  return out;
});

let bad=0;
for(const r of rows){
  if(r.note){ console.log(`·  ${r.tag} — ${r.note}`); continue; }
  const p1=[];
  if(r.bad){ p1.push('✗ '+r.bad); }
  if(r.legal===false){ p1.push('✗ 标答不合法(跟牌义务)'); }
  // 领出题只出了一张牌,这一墩还没打完,赢家无从谈起
  const judged = r.lead!==0;
  if(judged&&!r.lose&&r.win%2!==0) p1.push(`✗ 标答打出去这一墩被 ${['南','东','北','西'][r.win]} 收走(本意是要赢下来?没写 lose:true)`);
  if(judged&&r.lose&&r.win%2===0) p1.push('✗ 写了 lose:true,可这一墩其实是我方收走的');
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
