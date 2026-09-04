/* 在真浏览器里把一个参赛版观察页跑完一整局。
 *
 *   node contest/verify-viewer.js 80fen-contest-<选手>-v1.html [截图.png]
 *
 * **生成完必须跑这个再发出去。** 观察页是靠字符串 patch 拼出来的,
 * gen-viewer 报「patch 全部命中」只说明锚点找到了,不说明拼出来的东西能跑 ——
 * 第一版就是命中了全部 patch、页面却直接 `G is not defined`
 * (适配层插在了界面块的闭包外面,看不见 G/visHand/rankOf)。
 *
 * 查五件事:
 *   · 参赛代码加载无误,五个方法都在
 *   · 托管能把整局打完,四家剩牌归零(打不完就是某处卡死了)
 *   · 违规数(正常应该是 0 —— 联赛里能跑的 AI 在这儿也该干净)
 *   · 零页面报错
 *   · 顺带截一张图
 *
 * 依赖 playwright。这个项目本身是零依赖的,所以它不进任何清单 —— 装在哪都行:
 *   npm i playwright        (浏览器用环境里预装的那个,不要 playwright install)
 */
'use strict';
const path=require('path');

let chromium;
try{ ({chromium}=require('playwright')); }
catch(e){
  console.error('需要 playwright:  npm i playwright');
  console.error('(浏览器用环境里预装的,不要跑 playwright install)');
  process.exit(2);
}

// 环境里预装的 Chromium。playwright 自带的版本号常和它对不上,直接指路径最省事。
const fs=require('fs');
const PREINSTALLED='/opt/pw-browsers/chromium';
const launchOpts=fs.existsSync(PREINSTALLED)?{executablePath:PREINSTALLED}:{};

(async()=>{
  const file=process.argv[2], shot=process.argv[3];
  if(!file){ console.error('用法: node contest/verify-viewer.js <观察页.html> [截图.png]'); process.exit(1); }

  const browser=await chromium.launch(launchOpts);
  const page=await browser.newPage({viewport:{width:900,height:820}});
  const errs=[];
  page.on('pageerror', e=>errs.push('pageerror: '+e.message));
  page.on('console', m=>{ if(m.type()==='error') errs.push('console: '+m.text()); });

  await page.goto('file://'+path.resolve(file));

  const load=await page.evaluate(()=>({
    err: window.CONTESTANT ? (CONTESTANT.loadErr?String(CONTESTANT.loadErr):null) : '页面里没有 CONTESTANT',
    name: window.CONTESTANT && CONTESTANT.name,
    n: window.CONTESTANT ? ['onDeal','onRebel','discard','lead','follow']
         .filter(m=>typeof CONTESTANT[m]==='function').length : 0,
  }));
  console.log(`  加载 ${load.err?'✗ '+load.err:'✓'} | 自称 ${load.name} | 五个方法 ${load.n}/5`);
  if(load.err){ await browser.close(); process.exit(1); }

  /* 把节奏压到 0。不走 localStorage —— 每个观察页的 key 前缀都不同,
   * 直接改运行中的 S 更省事,也顺带证明 __viewer 这个调试口是通的。 */
  await page.evaluate(()=>Object.assign(__viewer.S,
    {aiThinkMin:0, aiThinkMax:0, trickHold:0, declWait:0, manualNext:false}));

  // 页面停在「开始游戏」的覆盖层上,先开局。__start 是界面自己挂在 window 上的
  await page.evaluate(()=>{ if(typeof window.__start==='function') window.__start(); });
  await page.waitForFunction(()=>window.__viewer && __viewer.G, null, {timeout:15000});
  // 发牌是 100 张 × 120ms 写死的,等它走完
  await page.waitForFunction(()=>{const G=__viewer.G;
    return G && ['play','kitty','lowrebel'].includes(G.phase);}, null, {timeout:90000});

  const phase=()=>page.evaluate(()=>__viewer.G && __viewer.G.phase);
  let ph=await phase();
  // 人类那家该答的两处,替它按默认走
  if(ph==='lowrebel'){ await page.evaluate(()=>__viewer.humanLowRebel(false));
                       await page.waitForTimeout(400); ph=await phase(); }
  if(ph==='kitty'){ await page.evaluate(()=>{ const G=__viewer.G;
      G.hands[0].slice(0,8).forEach(c=>G.selected.add(c.id)); __viewer.buryKitty(); });
    await page.waitForTimeout(400); }

  // 开托管,让参赛者的 AI 把整局打完(托管那一路也是它)
  await page.evaluate(()=>{ __viewer.G.auto=true; __viewer.step(); });
  await page.waitForFunction(()=>__viewer.G && __viewer.G.ended, null, {timeout:180000})
    .catch(()=>{});

  const st=await page.evaluate(()=>{ const G=__viewer.G, M=__viewer.M; return {
    ended:!!G.ended, tricks:G.tricks.length, defPoints:G.defPoints,
    trump:(G.trump&&G.trump.suit?G.trump.suit:'无主')+' 打'+(G.trump?G.trump.rank:'?'),
    declSeat:G.declSeat, levels:M.levels.slice(), vio:CONTESTANT.vio,
    handsLeft:G.hands.map(h=>h.length),
  };});
  if(shot) await page.screenshot({path:shot});
  await browser.close();

  const plays=st.tricks*4;
  const clean=st.handsLeft.every(n=>n===0);
  console.log(`  整局 ${st.ended?'✓':'✗ 没打完'} ${st.tricks} 墩 | 主 ${st.trump} | 庄家座位 ${st.declSeat}`);
  console.log(`  收尾 ${clean?'✓':'✗'} 四家剩牌 [${st.handsLeft.join(',')}] | 闲家 ${st.defPoints} 分 | 级数 ${st.levels}`);
  console.log(`  违规 ${st.vio.n?'⚠ ':'✓ '}${st.vio.n}/${plays} 手,罚 ${st.vio.pts} 分` +
              (st.vio.n?'  '+JSON.stringify(st.vio.by):''));
  console.log(errs.length?`  ✗ 页面报错 ${errs.length} 条:\n    `+errs.slice(0,4).join('\n    ')
                         :'  ✓ 零页面报错');
  if(shot) console.log(`  → ${shot}`);
  process.exit((!st.ended||!clean||errs.length)?1:0);
})();
