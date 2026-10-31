#!/usr/bin/env node
/* 网页图标(favicon / 加到主屏幕的图标):六六头像 + 一张大王,用测试版自己的美术拼出来再截图。
 *
 *   node test/make-icons.js        重新生成 icons/apple-touch-icon.png(180)、favicon-32.png、favicon-16.png
 *
 * 180 那张铺满蜂蜜色底(iOS 自己会切圆角);32 / 16 透明底,头像放大一点,标签页里小也认得出。
 * 需要 Playwright + Chromium(同 play-ui-e2e.js)。 */
'use strict';
const fs=require('fs'),path=require('path'),http=require('http');
let pw;
for(const p of [process.env.PLAYWRIGHT,'playwright','/opt/node22/lib/node_modules/playwright'].filter(Boolean)){ try{ pw=require(p); break; }catch(_){} }
if(!pw){ console.error('找不到 Playwright(设 PLAYWRIGHT=… 指向它)'); process.exit(2); }
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'icons');

const srv=http.createServer((q,r)=>{
  const f=path.join(ROOT,decodeURIComponent(q.url.split('?')[0]));
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}
  r.writeHead(200,{'content-type':f.endsWith('.html')?'text/html; charset=utf-8':f.endsWith('.css')?'text/css':'application/octet-stream'});
  fs.createReadStream(f).pipe(r);
}).listen(0,'127.0.0.1',async()=>{
  const base='http://127.0.0.1:'+srv.address().port;
  const b=await pw.chromium.launch(fs.existsSync('/opt/pw-browsers/chromium')?{executablePath:'/opt/pw-browsers/chromium'}:{});
  fs.mkdirSync(OUT,{recursive:true});
  for(const [px,file,bg] of [[180,'apple-touch-icon.png',true],[32,'favicon-32.png',false],[16,'favicon-16.png',false]]){
    /* 在 100×100 的框里摆好,按 px/100 的缩放截图 */
    const ctx=await b.newContext({viewport:{width:600,height:600},deviceScaleFactor:px/100});
    const p=await ctx.newPage();
    await p.goto(base+'/80fen-test.html');await p.waitForTimeout(500);
    await p.evaluate(([bg,small])=>{
      const art=window.__jokerArt.big;
      const d=document.createElement('div');d.id='ico';
      d.style.cssText='position:fixed;left:0;top:0;width:100px;height:100px;z-index:99999;overflow:hidden;background:'+(bg?'#EDB94F':'transparent');
      d.innerHTML=`<div class="card jb" style="--w:${small?52:50}px;position:absolute;left:44px;top:${small?6:9}px;transform:rotate(12deg);box-shadow:none;border-width:${small?3:2.5}px">`+
        `<span class="face"><span class="cat-tl">${art}</span><span class="cat-big">${art}</span></span></div>`+
        `<span class="leo-avatar leo-outline" style="position:absolute;display:block;left:${small?-6:2}px;top:${small?30:36}px;width:${small?70:62}px;height:${small?70:62}px"></span>`;
      document.body.appendChild(d);document.getElementById('overlay').style.display='none';
    },[bg,px<=32]);
    await p.waitForTimeout(200);
    await p.locator('#ico').screenshot({path:path.join(OUT,file),omitBackground:!bg});
    await ctx.close();
    console.log('icons/'+file);
  }
  await b.close();srv.close();
});
