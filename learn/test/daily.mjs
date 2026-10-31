/* 每日练习体检:
       node learn/test/daily.mjs
   题是按日期现生成的,没法逐题看 —— 一次查一年(从 2026-11-01 起 365 天、1095 题)。 */
// 查两件事:每天三题都生成得出来;第一手出错,结算确实掉一档
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b=await chromium.launch();const p=await b.newPage();
await p.goto('file://'+process.cwd()+'/learn.html');
const r=await p.evaluate(()=>{
  const {dailyLesson,endMoves,ladderKey}=__LEARN__; const bad=[]; let n=0, roles={}, goals={};
  for(let i=0;i<365;i++){
    const d=new Date(2026,10,1+i), day=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const L=dailyLesson(day); if(L.qs.length!==3) bad.push(day+' 只有 '+L.qs.length+' 题');
    for(const q of L.qs){ n++;
      const st={hands:[q.hand,...q.end.hands.slice(1)],lead:q.lead,played:q.played,def:q.end.def,declTeam:q.end.decl%2,kitty:q.end.kitty};
      const mv=endMoves(st,q.tr), mine=st.declTeam===0, vs=mv.map(m=>m.v);
      const best=mine?Math.min(...vs):Math.max(...vs);
      const tiers=new Set(mv.map(m=>Math.floor(m.v/1000)));
      if(tiers.size<2) bad.push(day+' '+q.badge+' 错一手不掉档');
      roles[mine?'庄家方':'闲家']=(roles[mine?'庄家方':'闲家']||0)+1;
      const g=q.prompt.replace(/<[^>]+>/g,'').split('目标:')[1]; goals[g]=(goals[g]||0)+1;
    }
  }
  return {bad,n,roles,goals};
});
console.log('puzzles',r.n,'problems',r.bad.length,r.bad.slice(0,5));console.log(r.roles);console.log(r.goals);
await b.close();
process.exit(r.bad.length?1:0);
