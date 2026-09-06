/* 教学版走查:把单元 1 的四课各打一遍,断言每题都判「答对了」,
   并核对每个小局的最终比分。竖屏两档屏幕各跑一遍。
       node test/learn-walk.mjs
   为什么要有这个:小局是「AI 自动推进 + 人也能操作」的结构,正式版没有
   这种东西 —— 过期的定时器回来再出一张牌、同一家出两张、endTrick 跑两次,
   都只在真跑一遍的时候才看得见,单元测试断言不出来。 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const PLAN=[
 [['seat',2],['multi',['H50','H130','H100']],['opt',2],['opt',1],['opt',1],['pick','H120'],['pick','H50'],['mini',2]],
 [['pick','H70'],['opt',0],['pick','S40'],['opt',1],['multi',['C60','C110']],['pick','H60'],['mini',2]],
 [['multi',['H50','S20','X160','C20']],['opt',1],['opt',1],['opt',1],['multi',['D20','H90','X150','H30']],['mini',2]],
 [['opt',2],['pick','H60'],['opt',1],['pick','D30'],['opt',1],['mini',2]],
];
/* 每课小局的应得比分 —— 由牌面推出来的,改牌面就要一起改 */
const SCORE=['你们队拿到 15 分,对手 10 分','你们队拿到 10 分,对手 0 分',
             '你们队拿到 15 分,对手 0 分','你们队拿到 10 分,对手 0 分'];
let bad=0;
const b=await chromium.launch({headless:true});
for(const [w,h,tag] of [[390,844,'p'],[375,667,'se']]){
  const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:2});
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto('file://'+process.cwd()+'/learn.html');
  await p.evaluate(()=>localStorage.clear()); await p.reload(); await p.waitForTimeout(250);
  for(let L=0;L<PLAN.length;L++){
    const T0=Date.now();
    await p.click('#go'); await p.waitForTimeout(220);
    if(tag==='p'&&L>0) await p.screenshot({path:`x-l${L+1}-q1.png`});
    for(const [kind,val] of PLAN[L]){
      if(kind==='seat') await p.click(`.seatbtn[data-s="${val}"]`);
      else if(kind==='opt') await p.click(`.opt[data-i="${val}"]`);
      else if(kind==='multi'){ for(const id of val) await p.click(`.card[data-id="${id}"]`); }
      else if(kind==='pick') await p.click(`#hand .card[data-id="${val}"]`);
      else if(kind==='mini'){
        // 轮询到小局结束:该我出就点第一张能出的,顺手连点几下压测 busy 闸
        for(let t=0;t<120;t++){
          const done=await p.evaluate(()=>getComputedStyle(document.getElementById('btnRow')).display!=='none');
          if(done) break;
          const c=await p.$$('#hand .card:not(.dim)');
          if(c.length){ try{ await c[0].click({timeout:500}); }catch(e){}
            for(const x of await p.$$('#hand .card')){ try{await x.click({timeout:250});}catch(e){} } }
          await p.waitForTimeout(500);
        }
        break;
      }
      await p.click('#cta'); await p.waitForTimeout(260);
      const v=await p.evaluate(()=>document.getElementById('verdict').textContent);
      if(v!=='答对了') errs.push(`L${L+1} 判成「${v}」: ${kind}=${val}`);
      await p.click('#cta'); await p.waitForTimeout(240);
    }
    if(tag==='p') await p.screenshot({path:`x-l${L+1}-end.png`});
    const fin=await p.evaluate(()=>document.getElementById('bub').textContent);
    const want=SCORE[L];
    if(!fin.includes(want)){ errs.push(`L${L+1} 小局比分不符,期望「${want}」,实得「${fin.slice(-40)}」`); }
    console.log(` L${L+1} ${Math.round((Date.now()-T0)/1000)}s | ${fin.slice(-30)}`);
    await p.click('#cta'); await p.waitForTimeout(300);   // 通关页
    await p.click('#doneBtn'); await p.waitForTimeout(300);
  }
  await p.screenshot({path:`x-${tag}-mapdone.png`});
  console.log(tag,'== errors:',errs.length?errs.join(' | '):'none');
  bad+=errs.length;
  await p.close();
}
await b.close();
process.exit(bad?1:0);
