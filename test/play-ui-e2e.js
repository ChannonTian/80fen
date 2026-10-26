#!/usr/bin/env node
/* 打牌 UI 测试页(80fen-play-ui-test.html)端到端体检。
 *
 * 在一组真实设备尺寸上从开局打到局终,把每个阶段、每种按钮组合都走一遍,
 * 每一步量一次版面:有没有东西出了屏幕、按钮挤不下 / 文字被截、座位名牌和桌心互相压住、
 * 页面横向能滚、抽屉里内容溢出。只看「能不能用、摆没摆对」,不判牌打得好不好。
 *
 *   node test/play-ui-e2e.js                 全部尺寸
 *   node test/play-ui-e2e.js --only=390x844  只跑一个
 *   node test/play-ui-e2e.js --shots=DIR     每一步截图存到 DIR(看问题用)
 *
 * 需要 Playwright + Chromium。默认找全局安装(/opt/node22/lib/node_modules/playwright、
 * /opt/pw-browsers/chromium),也可以用环境变量 PLAYWRIGHT / CHROMIUM 指定。
 * 页面计时器压缩 8 倍(AI 思考、留桌、发牌),只为跑得快,不改流程。
 */
'use strict';
const fs=require('fs'), path=require('path'), http=require('http');
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const m=a.match(/^--([^=]+)(?:=(.*))?$/);return m?[m[1],m[2]??true]:[a,true];}));
let pw;
for(const p of [process.env.PLAYWRIGHT,'playwright','/opt/node22/lib/node_modules/playwright'].filter(Boolean)){
  try{ pw=require(p); break; }catch(_){}
}
if(!pw){ console.error('找不到 Playwright(设 PLAYWRIGHT=… 指向它)'); process.exit(2); }
const CHROMIUM=process.env.CHROMIUM||(fs.existsSync('/opt/pw-browsers/chromium')?'/opt/pw-browsers/chromium':undefined);
const ROOT=path.resolve(__dirname,'..');
const PAGE=args.page||'80fen-play-ui-test.html';

const PHONE={isMobile:true,hasTouch:true,deviceScaleFactor:2};
const SIZES=[
  ['320x568',PHONE],['360x640',PHONE],['375x667',PHONE],['390x844',PHONE],['393x852',PHONE],['412x915',PHONE],['430x932',PHONE],
  ['568x320',PHONE],['667x375',PHONE],['844x390',PHONE],['932x430',PHONE],
  ['768x1024',PHONE],['820x1180',PHONE],['1024x768',PHONE],
  ['1280x800',{}],['1440x900',{}],
].filter(([k])=>!args.only||String(args.only).split(',').includes(k));

/* ---------- 一个只读的静态服务器,免得依赖外面开着的 http.server ---------- */
function serve(){
  return new Promise(res=>{
    const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp'};
    const srv=http.createServer((q,r)=>{
      const f=path.join(ROOT,decodeURIComponent(q.url.split('?')[0].split('#')[0]));
      if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
      r.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);
    }).listen(0,'127.0.0.1',()=>res(srv));
  });
}

/* ---------- 版面检查(在页面里跑) ---------- */
function audit(){
  const W=innerWidth,H=innerHeight,out=[];
  const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect();if(r.width<1||r.height<1)return false;
    const cs=getComputedStyle(e);return cs.visibility!=='hidden'&&cs.display!=='none'&&+cs.opacity>0.05;};
  const name=e=>e.id?'#'+e.id:(e.className&&typeof e.className==='string'?'.'+e.className.trim().split(/\s+/).join('.'):e.tagName.toLowerCase())+(e.textContent?'「'+e.textContent.trim().slice(0,10)+'」':'');
  const R=e=>e.getBoundingClientRect();
  const inter=(a,b,pad=1)=>a.left<b.right-pad&&b.left<a.right-pad&&a.top<b.bottom-pad&&b.top<a.bottom-pad;
  const overlay=document.getElementById('overlay'),setO=document.getElementById('setOverlay');
  const modal=[overlay,setO].some(o=>o&&getComputedStyle(o).display!=='none')||!document.getElementById('scoreModal').hidden||document.getElementById('sheet').open;
  const drawer=document.body.classList.contains('drawer-open');
  if(document.documentElement.scrollWidth>W+1)out.push(`页面横向溢出 ${document.documentElement.scrollWidth}>${W}`);
  // 1. 该看得见的东西都在屏幕里
  const must=[...document.querySelectorAll('.topbar>*,#controls>*,#controls #dealZone>*,.player-label,#trickSummary,.coach-bubble,.center-toast.show,.say.show')];
  if(!modal&&!drawer)for(const e of must){ if(!vis(e))continue; const r=R(e);
    if(r.left<-1||r.top<-1||r.right>W+1||r.bottom>H+1)out.push(`出屏:${name(e)} [${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}]`); }
  // 2. 操作栏:不滚、不重叠、字不截
  const bar=document.getElementById('controls');
  if(!modal&&!drawer&&vis(bar)){
    if(bar.scrollWidth>bar.clientWidth+1)out.push(`操作栏放不下 ${bar.scrollWidth}>${bar.clientWidth}`);
    const items=[...bar.querySelectorAll('button')].filter(vis), br=R(bar);
    for(const b of items){const r=R(b);
      if(r.left<br.left-1||r.right>br.right+1||r.top<br.top-1||r.bottom>br.bottom+1)out.push(`按钮出了操作栏:${name(b)}`);
      if(b.scrollWidth>b.clientWidth+1)out.push(`按钮文字被截:${name(b)}`);
      if(r.height<38)out.push(`按钮太矮(${Math.round(r.height)}px):${name(b)}`);}
    for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++)if(inter(R(items[i]),R(items[j])))out.push(`按钮重叠:${name(items[i])} / ${name(items[j])}`);
  }
  // 3. 顶栏:字不截;竖屏第一行不折行
  for(const e of document.querySelectorAll('.topbar .chip,.topbar .score-chip'))if(vis(e)&&e.scrollWidth>e.clientWidth+1)out.push(`顶栏文字被截:${name(e)}`);
  const game=document.getElementById('game');
  if(game.classList.contains('m-p')){
    const row=['trumpChip','levelChip','recordsBtn','menuBtn'].map(id=>document.getElementById(id)).filter(vis).map(e=>Math.round(R(e).top/10));
    if(new Set(row).size>1)out.push('顶栏第一行折行了');
  }else if(game.classList.contains('m-l')&&document.querySelector('.topbar').scrollHeight>R(document.querySelector('.topbar')).height+1){
    // 矮横屏:顶栏是左边一条竖栏(测试版),里面的东西不能超出栏高;UI 测试页的横屏顶栏仍是一行,走下面那条
    const tb=document.querySelector('.topbar');
    if(getComputedStyle(tb).display==='grid')out.push(`左边竖栏放不下 ${tb.scrollHeight}>${Math.round(R(tb).height)}`);
  }
  if(!game.classList.contains('m-p')&&getComputedStyle(document.querySelector('.topbar')).display!=='grid'){
    // 宽屏(和 UI 测试页的横屏):顶栏只有一行
    const tops=[...document.querySelectorAll('.topbar>*')].filter(vis).map(e=>R(e)).map(r=>Math.round((r.top+r.bottom)/2/12));
    if(new Set(tops).size>1)out.push('顶栏折行了');
  }
  // 矮横屏:右边按钮栏不压牌桌上的牌摞和名牌
  if(game.classList.contains('m-l')&&!modal&&!drawer){
    const btns=[...document.querySelectorAll('#controls button')].filter(vis),busy=[...document.querySelectorAll('.played:not(.ghost),.player-label')].filter(vis);
    for(const b of btns)for(const q of busy)if(inter(R(b),R(q),2)){out.push(`按钮压住牌桌:${name(b)} / ${name(q)}`);break;}
  }
  // 4. 牌桌:名牌、桌心、牌摞两两不压
  if(!modal&&!drawer){
    const arena=R(document.getElementById('arena'));
    const parts=[...document.querySelectorAll('.player-label,#trickSummary,.played:not(.ghost),.turn-slot,.winner-label')].filter(vis);
    for(const e of parts){const r=R(e);if(r.left<arena.left-2||r.right>arena.right+2||r.top<arena.top-2||r.bottom>arena.bottom+2)out.push(`出了牌桌:${name(e)}`);}
    for(let i=0;i<parts.length;i++)for(let j=i+1;j<parts.length;j++){
      const a=parts[i],b=parts[j];if(a.contains(b)||b.contains(a))continue;
      if(a.closest('.player,.my-play')&&a.closest('.player,.my-play')===b.closest('.player,.my-play'))continue;
      // 收墩的戳本来就盖在赢的那摞上
      if([a,b].some(x=>x.classList.contains('winner-label')&&[a,b].some(y=>y.id==='p'+x.dataset.seat)))continue;
      if(inter(R(a),R(b),3))out.push(`压住了:${name(a)} / ${name(b)}`);}
    // 桌面牌不能比手牌小一截(竖屏、宽屏)
    const tc=document.querySelector('.played .card'),hc=document.querySelector('#hand .card');
    // 扣底时手里 33 张,窄屏要排三排、牌桌变矮;那时桌上只有亮主的一两张,先顾手牌,这条不查
    const kitty=window.__G&&window.__G()&&window.__G().phase==='kitty';
    if(tc&&hc&&!kitty&&!game.classList.contains('m-l')){const k=tc.offsetWidth/(parseFloat(hc.style.getPropertyValue('--w'))||hc.offsetWidth);   // 量排版宽度:出牌动画开头牌是缩小的
      if(k<0.8)out.push(`桌面牌太小:只有手牌的 ${Math.round(k*100)}%`);}
    // 竖屏、宽屏手牌整张露出来,不被操作栏切掉
    if(hc&&!game.classList.contains('m-l')){const hb=R(document.getElementById('controls')).top;
      for(const c of document.querySelectorAll('#hand .card'))if(R(c).bottom>hb+2){out.push('手牌被操作栏切掉一截');break;}}
    // 手牌左右不出手牌区(要拨牌时除外)
    const ha=document.getElementById('handArea');
    if(!ha.classList.contains('overflow')){const hr=R(ha);
      for(const c of document.querySelectorAll('#hand .card')){const r=R(c);if(r.left<hr.left-8||r.right>hr.right+8){out.push('手牌出了手牌区');break;}}}
    // 六六气泡不盖住「出牌」
    const bub=document.getElementById('coachBubble');
    if(vis(bub)&&inter(R(bub),R(document.getElementById('controls'))))out.push('六六气泡压住了操作栏');
  }
  // 5. 弹窗:面板在屏幕里,按钮看得见
  for(const sel of ['#overlay .panel','#setOverlay .panel','#scoreModal .zpanel','#sheet']){
    const e=document.querySelector(sel);if(!vis(e))continue;const r=R(e);
    if(r.left<-1||r.top<-1||r.right>W+1||r.bottom>H+1)out.push(`弹窗出屏:${sel}`);
    if(e.scrollWidth>e.clientWidth+1)out.push(`弹窗横向溢出:${sel}`);
    const acts=e.querySelector('.panel-actions');
    if(acts&&vis(acts)){const a=R(acts);if(a.bottom>Math.min(H,r.bottom)+1||a.top<r.top-1)out.push(`弹窗按钮看不见:${sel}`);}
  }
  // 6. 抽屉
  if(drawer){
    const side=document.getElementById('side'),r=R(side);
    if(r.left<-1||r.right>W+1||r.top<-1||r.bottom>H+1)out.push('抽屉出屏');
    const body=side.querySelector('.records-body');
    if(body.scrollWidth>body.clientWidth+1)out.push(`抽屉横向溢出 ${body.scrollWidth}>${body.clientWidth}`);
    for(const e of side.querySelectorAll('#recPanel *'))if(vis(e)&&R(e).right>r.right-4){out.push('抽屉内容贴边或出界:'+name(e));break;}
    const hr=R(document.getElementById('handArea')),pt=document.elementFromPoint(Math.min(hr.left+hr.width/2,W-2),Math.min(hr.top+12,H-2));
    if(pt&&pt.closest('#hand')&&inter(hr,r))out.push('手牌浮在抽屉上面');
  }
  return out;
}

/* ---------- 走一局 ---------- */
async function run(browser,key,opt,base){
  const [w,h]=key.split('x').map(Number);
  const ctx=await browser.newContext({viewport:{width:w,height:h},...opt});
  const p=await ctx.newPage();
  const problems=[],errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  if(args.debug)p.on('console',m=>console.log('      page:',m.text()));
  p.on('response',r=>{if(r.status()>=400)errors.push('请求失败 '+r.status()+' '+r.url().replace(base,''));});
  p.on('dialog',d=>d.accept());
  await p.addInitScript(()=>{const st=window.setTimeout;window.setTimeout=(f,t,...a)=>st(f,(t||0)/8,...a);});
  await p.goto(base+'/'+PAGE);await p.waitForTimeout(300);
  const st=()=>p.evaluate(()=>{const G=window.__G&&window.__G();return G&&{ph:G.phase,e:!!G.ended,auto:G.auto,t:G.tricks.length,decl:G.declSeat,
    my:!G.ended&&G.phase==='play'&&G.trick.length<4&&(G.leader+G.trick.length)%4===0};});
  const until=async(fn,ms=60000)=>{const t0=Date.now();while(Date.now()-t0<ms){const s=await st();if(s&&fn(s))return s;await p.waitForTimeout(40);}throw new Error('等不到:'+fn);};
  let step=0;
  const check=async label=>{
    await p.waitForTimeout(250);
    const r=await p.evaluate(audit);
    for(const x of r)problems.push(`[${label}] ${x}`);
    if(args.shots){fs.mkdirSync(args.shots,{recursive:true});await p.screenshot({path:path.join(args.shots,`${key}-${String(++step).padStart(2,'0')}-${label}.png`)});}
  };
  const click=sel=>p.evaluate(s=>{const e=document.querySelector(s);if(e)e.click();return !!e;},sel);
  const visible=sel=>p.evaluate(s=>{const e=document.querySelector(s);if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&!e.hidden&&getComputedStyle(e).display!=='none';},sel);

  await check('开局封面');
  // 发牌:有能亮的就亮,争取当庄(才看得到扣底)
  let dealer=false;
  for(let k=0;k<4&&!dealer;k++){
    await p.evaluate(()=>window.__start());
    let checkedBid=false;
    while(true){const s=await st();if(s.ph!=='dealing'&&s.ph!=='finalDecl')break;
      if(s.ph==='finalDecl'&&!checkedBid){await check('最后亮主');checkedBid=true;}
      if(await visible('#bidAction')){if(!checkedBid){await check('可以亮主');checkedBid=true;}
        await p.evaluate(()=>{const b=document.getElementById('bidAction');if(!/选牌/.test(b.textContent))b.click();else{
          const G=__G(),lv=__rankOf(0),c=G.hands[0].slice(0,G.visCount[0]).find(c=>c.rank===lv);if(c){__toggleBidCard(c.id);b.click();}}});}
      else if(s.ph==='finalDecl')await p.evaluate(()=>__skipDecl());
      await p.waitForTimeout(40);}
    const s=await until(s=>s.ph!=='dealing'&&s.ph!=='finalDecl');
    if(s.ph==='kitty'&&s.decl===0)dealer=true;
    else if(k<3&&!dealer){await p.evaluate(()=>{document.getElementById('overlay').style.display='none';});if(s.ph!=='play'){await p.evaluate(()=>__setAuto(true));await until(s=>s.ph==='play');await p.evaluate(()=>__setAuto(false));}break;}
  }
  if(dealer){
    await p.evaluate(()=>{const cs=[...document.querySelectorAll('#hand .card')];for(let i=0;i<3;i++)cs[i*4].click();});
    await check('扣底选了 3 张');
    for(let i=0;i<5;i++)await p.evaluate(()=>{const cs=[...document.querySelectorAll('#hand .card:not(.sel)')];cs[cs.length-1].click();});
    await check('扣底选满 8 张');
    await click('#btnBury');
  }
  await until(s=>s.ph==='play');
  // 第一手:问六六 → 就出这手
  await until(s=>s.my);
  await click('#btnHint');await p.waitForTimeout(150);
  await check('六六气泡');
  await p.evaluate(()=>{const q=document.querySelector('#cbActions [data-qz="skip"],#cbActions [data-qz="-1"]');if(q)q.click();});
  await p.evaluate(()=>{const b=document.getElementById('cbPlay');if(b)b.click();});
  // 第二手:选一张(能悔牌了)
  await until(s=>s.my);
  await p.evaluate(()=>document.querySelector('#hand .card:last-child').click());
  await check('出牌阶段·选了牌·能悔牌');
  // 桌面压力:四家各摆 2 / 4 / 6 张(对子、拖拉机、甩牌),名牌和牌摞都不许互相压
  for(const n of [2,4,6]){
    await p.evaluate(n=>{const src=[...document.querySelectorAll('#hand .card')];
      for(let s=0;s<4;s++){const el=document.getElementById('p'+s);if(el.__keep==null)el.__keep=el.innerHTML;
        el.innerHTML=src.slice(s*n%Math.max(1,src.length-n),s*n%Math.max(1,src.length-n)+n).map(c=>'<div class="'+c.className.replace(/\b(sel|hintc)\b/g,'')+'">'+c.innerHTML+'</div>').join('');}},n);
    await check(`桌面压力·每家 ${n} 张`);
  }
  await p.evaluate(()=>{for(let s=0;s<4;s++){const el=document.getElementById('p'+s);el.innerHTML=el.__keep;el.__keep=null;}});
  // 多张一起拖:点选六六建议的那一组(≥2 张),按住 0.4 秒再往牌桌上拖
  const touch=!!opt.hasTouch;
  let dragTried=0,dragOk=0;
  for(let k=0;k<10&&dragTried<2;k++){
    const s=await st();if(s.e)break;
    if(!s.my){await until(s=>s.my||s.e);continue;}
    await p.evaluate(()=>{__G().hintCards=null;document.getElementById('btnHint').click();const q=document.querySelector('#cbActions [data-qz="skip"],#cbActions [data-qz="-1"]');if(q)q.click();});
    const ids=await p.evaluate(()=>{const G=__G();return G.hintCards?[...G.hintCards]:[];});
    await p.evaluate(()=>document.getElementById('cbClose').click());
    if(ids.length<2){await p.evaluate(()=>{const G=__G();G.selected.clear();(G.hintCards||[]).forEach(i=>G.selected.add(i));document.getElementById('btnPlay').disabled=false;document.getElementById('btnPlay').click();});await p.waitForTimeout(150);continue;}
    /* 找一个真的点得到这张牌的点(牌互相压着、还转了角度,外框左上角未必是它) */
    const pos=id=>p.evaluate(id=>{const e=document.querySelector(`#hand .card[data-id="${id}"]`);const r=e.getBoundingClientRect();
      /* 取露出来那一块的中间(贴着边点,手机的触摸纠偏可能吸到隔壁那张) */
      const hits=[];
      for(let dy=6;dy<r.height*0.8;dy+=4)for(let dx=2;dx<r.width;dx+=3){const x=r.x+dx,y=r.y+dy;if(y>innerHeight-2)continue;const h=document.elementFromPoint(x,y);if(h&&h.closest('.card')&&h.closest('.card').dataset.id==id)hits.push([x,y]);}
      if(!hits.length)return [r.x+8,r.y+14];
      const xs=hits.map(h=>h[0]).sort((a,b)=>a-b),ys=hits.map(h=>h[1]).sort((a,b)=>a-b),m=[xs[xs.length>>1],ys[ys.length>>1]];
      return hits.reduce((best,h)=>Math.hypot(h[0]-m[0],h[1]-m[1])<Math.hypot(best[0]-m[0],best[1]-m[1])?h:best,hits[0]);},id);
    await p.evaluate(()=>document.getElementById('btnClear').onclick());await p.waitForTimeout(80);
    if(args.debug){await p.evaluate(()=>window.__DBG=1);console.log('      hint',JSON.stringify(ids),'sel',await p.evaluate(()=>JSON.stringify([...__G().selected])));}
    for(const id of ids){const b=await pos(id);if(touch)await p.touchscreen.tap(b[0],b[1]);else await p.mouse.click(b[0],b[1]);await p.waitForTimeout(260);if(args.debug)console.log("      tap",id,JSON.stringify(b),await p.evaluate(()=>JSON.stringify([...__G().selected])));}
    if(args.debug)console.log('      after taps sel',await p.evaluate(()=>JSON.stringify([...__G().selected])));
    const b=await pos(ids[ids.length-1]),to=await p.evaluate(()=>{const r=document.getElementById('arena').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];});
    const steps=14,path=i=>[b[0]+(to[0]-b[0])*i/steps,b[1]+(to[1]-b[1])*i/steps];
    if(touch){const cdp=await ctx.newCDPSession(p);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b[0],y:b[1]}]});await p.waitForTimeout(400);
      for(let i=1;i<=steps;i++){const [x,y]=path(i);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y}]});await p.waitForTimeout(16);}
      if(dragTried===0)await check('拖着多张牌');
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
    else{await p.mouse.move(b[0],b[1]);await p.mouse.down();await p.waitForTimeout(400);
      for(let i=1;i<=steps;i++){const [x,y]=path(i);await p.mouse.move(x,y);await p.waitForTimeout(16);}
      if(dragTried===0)await check('拖着多张牌');
      await p.mouse.up();}
    await p.waitForTimeout(300);
    dragTried++;
    if(await p.evaluate(ids=>!__G().hands[0].some(c=>ids.includes(c.id)),ids))dragOk++;
    else problems.push(`[拖多张出牌] ${ids.length} 张拖到牌桌没出出去:`+await p.evaluate(()=>document.getElementById('centerToast').textContent)+(args.debug?' ids='+JSON.stringify(ids)+' hand='+await p.evaluate(()=>JSON.stringify(__G().hands[0].map(c=>c.id))):''));
  }
  if(!dragTried)console.log(`    (${key} 这局没碰上能一起出的多张,跳过拖拽)`);
  await until(s=>s.my||s.e);
  if((await st()).e){await ctx.close();return {problems,errors};}
  await p.evaluate(()=>document.querySelector('#hand .card:last-child').click());
  // 故意出错
  await p.evaluate(()=>{const G=__G(),h=G.hands[0];G.selected.clear();
    if(G.trick.length){const ls=effSuit(G.trick[0].cards[0],G.trump);const c=h.find(x=>effSuit(x,G.trump)!==ls)||h[0];G.selected.add(c.id);}
    else{const a=h[0],b=h.find(x=>effSuit(x,G.trump)!==effSuit(a,G.trump));G.selected.add(a.id);if(b)G.selected.add(b.id);}
    document.getElementById('btnPlay').disabled=false;document.getElementById('btnPlay').click();});
  await check('出错提示');
  await click('#btnClear');
  // 托管中
  await p.evaluate(()=>__setAuto(true));await until(s=>s.t>=4);
  await check('托管中');
  await p.evaluate(()=>__setAuto(false));await p.waitForTimeout(300);
  // 抽屉、菜单、分牌、设置
  await click('#recordsBtn');await p.waitForTimeout(200);
  await check('记录·按墩');
  await p.evaluate(()=>{const s=document.getElementById('logMode');if(s){s.value='suit';s.onchange();}});
  await check('记录·按花色');
  await p.evaluate(()=>document.querySelector('#tabs button[data-tab=coach]').click());await p.waitForTimeout(150);
  await p.evaluate(()=>{const b=document.getElementById('memReveal');if(b)b.click();const d=document.getElementById('memBox');if(d)d.open=true;});
  await check('六六教练·记牌表');
  await click('#sideClose');
  await click('#menuBtn');await check('菜单');await p.evaluate(()=>document.getElementById('sheet').close());
  await click('#scoreChip');await check('闲家分牌');await p.evaluate(()=>{document.getElementById('scoreModal').hidden=true;});
  await p.evaluate(()=>__openSet());await check('设置');
  await p.evaluate(()=>{const e=document.querySelector('#setOverlay .panel');e.scrollTop=e.scrollHeight;});await check('设置·拉到底');
  await p.evaluate(()=>__closeSet());
  // 打完
  await p.evaluate(()=>__setAuto(true));await until(s=>s.e,180000);await p.waitForTimeout(400);
  await check('局终');
  await p.evaluate(()=>{const b=[...document.querySelectorAll('#overlay button')].find(b=>/看看这局/.test(b.textContent));b&&b.click();});
  await p.waitForTimeout(300);
  await p.evaluate(()=>{const d=document.querySelector('.init-hands');if(d)d.open=true;});
  await check('看看这局·记录');
  await click('#sideClose');
  await check('复盘中·下一局');
  const next=await p.evaluate(()=>{const b=[...document.querySelectorAll('#dealZone button')].find(b=>/下一局|重开整场/.test(b.textContent));if(b){b.click();return true;}return false;});
  if(!next)problems.push('[复盘中] 找不到「下一局」');
  else{await until(s=>!s.e);await check('第二局发牌');}
  await ctx.close();
  return {problems,errors};
}

(async()=>{
  const srv=await serve(),base='http://127.0.0.1:'+srv.address().port;
  const browser=await pw.chromium.launch(CHROMIUM?{executablePath:CHROMIUM}:{});
  let bad=0;
  for(const [key,opt] of SIZES){
    let r;
    try{r=await run(browser,key,opt,base);}catch(e){r={problems:['走不完:'+e.message.split('\n')[0]],errors:[]};}
    const all=[...new Set(r.problems)].concat(r.errors.map(e=>'页面报错:'+e));
    bad+=all.length;
    console.log((all.length?'\x1b[31m✗\x1b[0m ':'\x1b[32m✓\x1b[0m ')+key+(all.length?'':'  全部通过'));
    for(const x of all)console.log('    '+x);
  }
  await browser.close();srv.close();
  console.log(bad?`\n${bad} 个问题`:'\n全部尺寸通过');
  process.exit(bad?1:0);
})();
