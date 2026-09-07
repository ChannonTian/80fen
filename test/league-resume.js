/* 联赛断点续跑的回归测试。
 *
 *   node test/league-resume.js
 *
 * 为什么值得单独一份:一届联赛要跑几个钟头,而结果原本只在**最后**写一次 ——
 * 中途掉一次进程就全没了。2026-09-06 真掉过一次(我自己一条 pkill 模式打宽了,
 * 把正在跑的 worker 一起杀了),当时的逐局记录是一条长 gzip 流、没 end() 过,
 * 整个文件读不出来。
 *
 * 这里钉三件事:
 *   1. 进程被杀之后,已完成那几对的逐局记录**仍然读得出来**
 *   2. 续跑出来的积分榜和逐局记录,与一口气跑完的**逐字节相同**
 *   3. 断点说完成、而逐局记录场数对不上的那一对,会被**重跑**,不会静默留个缺口
 */
'use strict';
const cp=require('child_process'), fs=require('fs'), os=require('os'),
      path=require('path'), zlib=require('zlib');

const ROOT=path.join(__dirname,'..');
const DIR=fs.mkdtempSync(path.join(os.tmpdir(),'league-resume-'));
const P=n=>path.join(DIR,n);
let pass=0, fail=0;
const ok=(name,good,detail)=>{ good?pass++:fail++;
  console.log(`  ${good?'\x1b[32m✓\x1b[0m':'\x1b[31m✗\x1b[0m'} ${name}`+(good||!detail?'':`\n      ${detail}`)); };

// 三个不带收官搜索的选手就够了 —— 这里测的是记录与断点,不是棋力
const SUBS=path.join(ROOT,'..','80fen-contest','submissions');
const who=['gpt-5.6-sol','kimi-k3','zai-glm'].map(n=>path.join(SUBS,n));
if(!who.every(fs.existsSync)){
  console.log('\n联赛断点续跑 —— \x1b[33m跳过\x1b[0m(参赛 repo 不在旁边)\n');
  process.exit(0);
}

const args=tag=>[...who, '--no-house', '--seeds=4', '--jobs=1', '--log-rounds',
  `--log=${P(tag+'.ndjson.gz')}`, `--out=${P(tag+'.json')}`, `--ckpt=${P(tag+'.ckpt')}`];
const rounds=f=>{
  // Z_SYNC_FLUSH:半截 gzip 成员也把能读的读出来
  const t=zlib.gunzipSync(fs.readFileSync(f),{finishFlush:zlib.constants.Z_SYNC_FLUSH})
             .toString('utf8').trim();
  return t?t.split('\n'):[];
};
const table=f=>JSON.parse(fs.readFileSync(f,'utf8')).table
  .map(({ms,...r})=>r);                       // ms 是墙钟,每次不一样,不进比较

console.log('\n联赛断点续跑\n');

// ---- 参照:一口气跑完 ----
cp.execFileSync('node',[path.join(ROOT,'contest','league.js'),...args('full')],
  {cwd:ROOT, stdio:'ignore'});
const full=rounds(P('full.ndjson.gz')).sort();

// ---- 跑到第一对写完就杀 ----
const kid=cp.spawn('node',[path.join(ROOT,'contest','league.js'),...args('part')],
  {cwd:ROOT, stdio:'ignore'});
const t0=Date.now();
while(!(fs.existsSync(P('part.ckpt')) && fs.statSync(P('part.ckpt')).size>0)){
  if(Date.now()-t0>120000){ kid.kill('SIGKILL'); throw new Error('第一对迟迟没写进断点'); }
  cp.execFileSync('sleep',['0.2']);
}
// 只按 pid 杀这一棵进程树,不用模式匹配 —— 模式会打到别的联赛上
for(const p of String(cp.execFileSync('pgrep',['-P',String(kid.pid)],{encoding:'utf8'}))
                 .split('\n').filter(Boolean)) { try{ process.kill(+p,'SIGKILL'); }catch(e){} }
kid.kill('SIGKILL');
cp.execFileSync('sleep',['1']);

let salvaged=[];
try{ salvaged=rounds(P('part.ndjson.gz')); }catch(e){}
ok('被杀之后,已完成那几对的逐局记录仍读得出来', salvaged.length>0,
   '一条长 gzip 流没 end() 就是这个下场:整个文件报 unexpected end of file');

// ---- 续跑 ----
cp.execFileSync('node',[path.join(ROOT,'contest','league.js'),
  ...args('part'),'--resume'],{cwd:ROOT, stdio:'ignore'});

ok('续跑之后逐局记录与一口气跑的逐字节相同',
   JSON.stringify(rounds(P('part.ndjson.gz')).sort())===JSON.stringify(full),
   `一口气 ${full.length} 行,续跑 ${rounds(P('part.ndjson.gz')).length} 行`);
ok('续跑之后积分榜与一口气跑的逐字节相同',
   JSON.stringify(table(P('part.json')))===JSON.stringify(table(P('full.json'))));

// ---- 断点说完成、记录却不全的那一对要重跑 ----
{
  const all=rounds(P('part.ndjson.gz'));
  const first=JSON.parse(all[0]), k=x=>x.a===first.a&&x.b===first.b;
  const cut=all.filter(l=>{ const o=JSON.parse(l); return !k(o); })
               .concat(all.filter(l=>k(JSON.parse(l))).slice(0,-1));   // 抽掉一场
  fs.writeFileSync(P('part.ndjson.gz'), zlib.gzipSync(Buffer.from(cut.join('\n')+'\n','utf8')));
  const out=cp.execFileSync('node',[path.join(ROOT,'contest','league.js'),
    ...args('part'),'--resume'],{cwd:ROOT, encoding:'utf8',
    stdio:['ignore','pipe','ignore']});   // 进度条走 stderr,别混进来
  ok('逐局记录场数对不上的那一对会被重跑', /场数对不上/.test(out),
     out.split('\n').slice(0,6).join('\n'));
  ok('重跑之后又和一口气跑的对上',
     JSON.stringify(rounds(P('part.ndjson.gz')).sort())===JSON.stringify(full));
}

fs.rmSync(DIR,{recursive:true, force:true});
console.log(`\n通过 ${pass} 项,失败 ${fail} 项\n`);
process.exit(fail?1:0);
