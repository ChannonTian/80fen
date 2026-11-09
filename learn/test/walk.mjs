/* 教学版走查:每个单元的每一课都从首页点进去打一遍,断言每题都判「答对了」(两方案题判「这一手更好」)。
   竖屏两档屏幕各跑一遍。
       node learn/test/walk.mjs              # 在仓库根目录跑
       node learn/test/walk.mjs --shots      # 顺便存每课结束的截图到 learn/test/shots/
       node learn/test/walk.mjs --only=u2    # 只跑一个单元
   每一步点什么,不再手写:从题目数据里取,能由引擎推的(哪几张能出、排大小、阶梯、甩牌)
   交给引擎推 —— 课程重排、加题之后这里不用跟着改。
   为什么要真点一遍:小局、收官是「AI 自动推进 + 人也能操作」的结构,过期的定时器回来再出一张牌、
   同一家出两张、endTrick 跑两次,都只在真跑的时候才看得见。 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const SHOTS=process.argv.includes('--shots'), SHOTDIR='learn/test/shots';
const ONLY=(process.argv.find(a=>a.startsWith('--only='))||'').slice(7);
if(SHOTS) fs.mkdirSync(SHOTDIR,{recursive:true});

let bad=0;
const b=await chromium.launch({headless:true});
for(const [w,h,tag] of [[390,844,'p'],[375,667,'se']]){
  const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:2});
  p.setDefaultTimeout(8000);
  const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  await p.goto('file://'+process.cwd()+'/learn.html');
  const units=await p.evaluate(()=>__LEARN__.UNITS.map(U=>({key:U.key,ids:U.lessons.map(L=>L.id),qs:U.lessons.map(L=>L.qs.length)})));

  for(let u=0;u<units.length;u++){ if(ONLY&&units[u].key!==ONLY) continue;
    for(let L=0;L<units[u].ids.length;L++){
      // 前面的课全标成学完 → 这一课正好是首页上「该学的那一课」
      const before=units.slice(0,u).flatMap(x=>x.ids).concat(units[u].ids.slice(0,L));
      // 关掉音效:无头浏览器里没有声卡,第一次建 AudioContext 要卡一秒多,点击会超时
      await p.evaluate(d=>{localStorage.clear();localStorage.setItem('80fenlearn-sound','0');
                           localStorage.setItem('80fenlearn-done',JSON.stringify(d));},before);
      await p.reload(); await p.waitForTimeout(150);
      const T0=Date.now();
      await p.click(`.unit[data-unit="${u}"] .go`);   // 首页:这一单元当前那课的「开始」
      await p.waitForTimeout(200);
      for(let qi=0;qi<units[u].qs[L];qi++){
        const q=await p.evaluate(([u,L,i])=>{
          const {UNITS,answerOf,ladderIdx,throwResult,isLegalFollow,classify,legalSet,effSuit}=__LEARN__;
          const Lz=UNITS[u].lessons[L], q=Lz.qs[i], tr=q.tr!==undefined?q.tr:Lz.tr;
          let a=answerOf(q,tr);
          if(q.type==='ladder') a=ladderIdx(q.defPoints,q.kitty,q.wonLast,q.lastLeadSize);
          if(q.type==='throwjudge') a=throwResult(q,tr).ok?0:1;
          if(q.type==='forcedpick') a=throwResult(q,tr).forced.map(c=>c.id);
          if(q.type==='trickpick'&&q.anyLegal){
            const led=q.played&&q.played[q.lead]&&q.lead!==0?effSuit([].concat(q.played[q.lead])[0],tr):null;
            a=legalSet(q.hand,led,tr)[0].id;
          }
          if(q.type==='playset'&&q.anyLegal){       // 随便找一手合法的
            const lead=classify([].concat(q.played[q.lead]),tr), n=lead.cards.length, h=q.hand;
            const pick=(k,s,acc)=>{ if(acc.length===n) return isLegalFollow(h,lead,acc,tr)?acc:null;
              for(let j=s;j<h.length;j++){ const r=pick(k,j+1,acc.concat(h[j])); if(r) return r; } return null; };
            a=pick(0,0,[]).map(c=>c.id);
          }
          return {type:q.type,a};
        },[u,L,qi]);
        const A=q.a, click=sel=>p.click(sel);
        if(q.type==='seat') await click(`.seatbtn[data-s="${A}"]`);
        else if(['numpick','ladder','throwjudge'].includes(q.type)) await click(`.opt[data-i="${A}"]`);
        else if(q.type==='winpick'||q.type==='teampick') await click(`#table .slot[data-seat="${A}"]`);
        else if(['multi','cardpick','order'].includes(q.type)) for(const id of [].concat(A)) await click(`#table .pile .card[data-id="${id}"]`);
        else if(q.type==='trickpick') await click(`#hand .card[data-id="${A}"]`);
        else if(q.type==='playset'||q.type==='discard') for(const id of A) await click(`#hand .card[data-id="${id}"]`);
        else if(q.type==='forcedpick') for(const id of A) await click(`#table .pickset .card[data-id="${id}"]`);
        else if(q.type==='mini'){
          // 轮到我就点第一张能出的;顺手乱点几下,压测 busy 闸
          for(let t=0;t<160;t++){
            if(await p.evaluate(()=>document.getElementById('foot').className==='good')) break;
            const c=await p.$$('#hand .card:not(.dim)');
            if(c.length){ try{ await c[0].click({timeout:400}); }catch(e){}
              for(const x of await p.$$('#hand .card')){ try{await x.click({timeout:200});}catch(e){} } }
            await p.waitForTimeout(350);
          }
        }
        else if(q.type==='endplay'){
          for(let t=0;t<80;t++){
            if(await p.evaluate(()=>!!document.getElementById('verdict').textContent)) break;
            if(await p.$('#hand .card.pick')){
              const id=await p.evaluate(()=>__LEARN__.endBest());
              await click(`#hand .card[data-id="${id}"]`); await click('#cta');
            }
            await p.waitForTimeout(300);
          }
          await p.waitForFunction(()=>document.getElementById('verdict').textContent!=='',null,{timeout:20000});
        }
        if(!['mini','endplay'].includes(q.type)){ await click('#cta'); await p.waitForTimeout(220); }
        const v=await p.evaluate(()=>document.getElementById('verdict').textContent);
        if(v!=='答对了'&&v!=='这一手更好') errs.push(`${units[u].ids[L]} q${qi+1} ${q.type} 判成「${v}」(点的是 ${A})`);
        await click('#cta'); await p.waitForTimeout(200);
      }
      const doneOk=await p.evaluate(()=>getComputedStyle(document.getElementById('done')).display!=='none');
      if(!doneOk) errs.push(`${units[u].ids[L]} 打完没进通关页`);
      if(SHOTS&&tag==='p') await p.screenshot({path:`${SHOTDIR}/${units[u].ids[L]}-done.png`});
      console.log(` ${units[u].key} ${units[u].ids[L]} ${Math.round((Date.now()-T0)/1000)}s`);
    }
  }
  console.log(tag,'== errors:',errs.length?'\n  '+errs.join('\n  '):'none');
  bad+=errs.length;
  await p.close();
}
await b.close();
process.exit(bad?1:0);
