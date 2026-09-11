/* 教学版走查:把每个单元的每一课都打一遍,断言每题都判「答对了」,
   并核对每个小局打完的结算结论。竖屏两档屏幕各跑一遍。
       node learn/test/walk.mjs          # 在仓库根目录跑
       node learn/test/walk.mjs --shots  # 顺便存截图到 learn/test/shots/
   为什么要有这个:小局是「AI 自动推进 + 人也能操作」的结构,正式版没有
   这种东西 —— 过期的定时器回来再出一张牌、同一家出两张、endTrick 跑两次,
   都只在真跑一遍的时候才看得见,单元测试断言不出来。 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

/* 每一课的正确答案。一步一个动作:
   seat 点座位 / num 点数值选项 / lad 点阶梯选项 / win·team 点牌桌上的一家 /
   card·multi 点牌桌上的牌 / play·set 点手牌 / throwset 点甩牌那一行 / mini 打小局 */
const PLANS=[
 { key:'u1', lessons:[
   [['seat',2],['multi',['H50','H130','H100']],['num',2],['win',1],['team',1],
    ['play','H120'],['play','H50'],['mini',0]],
   [['play','H70'],['multi',['H30','H130']],['multi',['S40','C90','D60']],['win',1],
    ['play','H60'],['mini',0]],
   [['multi',['S90','H50','X160','C50']],['multi',['C30','S80','H80','X150','C130']],
    ['multi',['H50','D70','C90']],['card','X150'],['card','S50'],['mini',0]],
   [['play','D60'],['win',0],['play','H100'],['win',0],['mini',0]],
   [['multi',['S70','S71']],['win',1],['set',['S100','S101']],['set',['S40','S90']],['win',0]],
   [['multi',['H80','H81','H90','H91']],
    ['multi',['H50','H51','H70','H71','H80','H81']],['multi',['H70','H71','H80','H81']],
    ['set',['D40','D41','D50','D51']],['win',0]],
   [['multi',['S40','S41','S90']],['num',0],['num',1],['throwset',['S90']],['win',1],['num',1]],
 ]},
 { key:'u2', lessons:[
   [['num',2],['lad',2],['lad',3],['lad',4],['lad',0],['num',1]],
   [['num',2],['num',1],['num',2],['num',0],['lad',4],['play','D140']],
   [['num',1],['play','S60'],['num',1],['num',1]],
   [['num',1],['num',0],['multi',['C30','C80','C60']],['num',1]],
   [['card','H50'],['num',1],['num',1],['num',1]],
   [['num',1],['mini',0]],
 ]},
];

/* 每课小局打完之后应该给出的结算结论 —— 由「起始分 + 这两墩抓到的分 + 底」推出来的,
   改牌面、起始分或底牌都要一起改。没有小局的课写 null 跳过。 */
const SCORE={
 u1:['一共 80 分,上台了','一共 80 分,上台了',
     '一共 120 分 —— 上台,还升 1 级','一共 160 分 —— 上台,还升 2 级',null,null,null],
 u2:[null,null,null,null,null,'一共 105 分,上台了'],
};

const SHOTS=process.argv.includes('--shots');
const SHOTDIR='learn/test/shots';
if(SHOTS) (await import('node:fs')).mkdirSync(SHOTDIR,{recursive:true});

let bad=0;
const b=await chromium.launch({headless:true});
for(const [w,h,tag] of [[390,844,'p'],[375,667,'se']]){
  const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:2});
  const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  const shot=async name=>{ if(SHOTS) await p.screenshot({path:`${SHOTDIR}/${name}`}); };

  await p.goto('file://'+process.cwd()+'/learn.html');
  await p.evaluate(()=>localStorage.clear());

  for(let u=0;u<PLANS.length;u++){
    const U=PLANS[u];
    for(let L=0;L<U.lessons.length;L++){
      // 直接把进度设到这一课,免得每次都从头打一遍
      await p.evaluate(([k,n])=>localStorage.setItem('80fenlearn-'+k,String(n)),[U.key,L]);
      for(const prev of PLANS.slice(0,u))
        await p.evaluate(([k,n])=>localStorage.setItem('80fenlearn-'+k,String(n)),
                         [prev.key,prev.lessons.length]);
      await p.reload(); await p.waitForTimeout(220);
      const T0=Date.now();
      await p.click(`[data-go="${u}"]`); await p.waitForTimeout(220);
      if(tag==='p') await shot(`${U.key}-l${L+1}-q1.png`);

      for(const [kind,val] of U.lessons[L]){
        if(kind==='seat') await p.click(`.seatbtn[data-s="${val}"]`);
        else if(kind==='num'||kind==='lad') await p.click(`.opt[data-i="${val}"]`);
        else if(kind==='win'||kind==='team') await p.click(`#table .slot[data-seat="${val}"]`);
        else if(kind==='card') await p.click(`#table .card[data-id="${val}"]`);
        else if(kind==='multi'){ for(const id of val) await p.click(`#table .card[data-id="${id}"]`); }
        else if(kind==='play') await p.click(`#hand .card[data-id="${val}"]`);
        else if(kind==='set'){ for(const id of val) await p.click(`#hand .card[data-id="${id}"]`); }
        else if(kind==='throwset'){ for(const id of val) await p.click(`#table .pickset .card[data-id="${id}"]`); }
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
        await p.click('#cta'); await p.waitForTimeout(280);
        const v=await p.evaluate(()=>document.getElementById('verdict').textContent);
        if(v!=='答对了') errs.push(`${U.key} L${L+1} 判成「${v}」: ${kind}=${val}`);
        await p.click('#cta'); await p.waitForTimeout(250);
      }

      if(tag==='p') await shot(`${U.key}-l${L+1}-end.png`);
      const fin=await p.evaluate(()=>document.getElementById('bub').textContent);
      const want=SCORE[U.key][L];
      if(want&&!fin.includes(want))
        errs.push(`${U.key} L${L+1} 结算不符,期望「${want}」,实得「${fin.slice(-44)}」`);
      console.log(` ${U.key} L${L+1} ${Math.round((Date.now()-T0)/1000)}s | ${fin.slice(-28)}`);

      // 有小局的课要再点一次「继续」才通关;没小局的课,最后一题的「继续」已经通关了
      const live=await p.evaluate(()=>{
        const el=document.getElementById('cta');
        return getComputedStyle(document.getElementById('foot')).visibility!=='hidden' && el.offsetParent!==null;});
      if(live){ await p.click('#cta'); await p.waitForTimeout(280); }
      await p.click('#doneBtn'); await p.waitForTimeout(250);
    }
  }
  await shot(`${tag}-map.png`);
  console.log(tag,'== errors:',errs.length?errs.join(' | '):'none');
  bad+=errs.length;
  await p.close();
}
await b.close();
process.exit(bad?1:0);
