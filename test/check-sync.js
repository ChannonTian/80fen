/* 三份 build 与文档的一致性体检 —— 只检查,不修。
 *
 *   node test/check-sync.js           # 秒级:版本号、标记、开关表、未跟踪文件
 *   node test/check-sync.js --full    # 再加三份 build 的自测(约 4 分钟)
 *
 * 为什么需要这个:这个项目有三份 html(开发/测试/正式),互相之间靠**人手复制**同步,
 * 而 `80fen-dev.html` 还被 .gitignore 挡着 —— 它跟测试版飘了没人看得见。
 * 文档里又写死了一堆版本号和测试条数,改代码时很容易忘。
 * 这里把「应该恒成立」的几条钉成断言,晋级之前跑一遍。
 *
 * 判据只查客观事实,不做主观判断:
 *   · 开发版与测试版必须逐字节相同,除了 title / versionTag 那两行标记
 *   · 每份 build 的标记要和它的角色对上(开发版不能自称正式版)
 *   · 正式版的版本号不能**超前**于测试版(流水线是单向的)
 *   · docs/SWITCHES.md 的主体必须等于 gen-switches.js 对测试版的输出
 *   · README / CHANGELOG 里写的版本号,必须等于对应 build 的 versionTag
 *   · .md 里指向仓库内文件的链接都得指得到东西
 *   · 未跟踪文件必须在白名单里(防 `git add -A` 把本地杂物扫进仓库)
 */
const fs=require('fs'), cp=require('child_process');

const DEV='80fen-dev.html', TEST='80fen-test.html', PROD='index.html';
/* 允许存在的未跟踪文件。本地开发版由 .gitignore 挡着,不会出现在这里。 */
/* 文档都在 docs/ 下(2026-09-05 归拢),这里集中一处,再挪就只改这几行 */
const DOC={rules:'docs/RULES.md', design:'docs/DESIGN.md', switches:'docs/SWITCHES.md',
           changelog:'docs/CHANGELOG.md', contestOps:'docs/contest-ops.md'};
const UNTRACKED_OK=[/^80fen-dev.*\.html$/, /^scratchpad\//];

let fail=0, skip=0;
const ok =(n)=>console.log(`  \x1b[32m✓\x1b[0m ${n}`);
const bad=(n,d)=>{fail++;console.log(`  \x1b[31m✗\x1b[0m ${n}`);if(d)console.log(`      ${String(d).replace(/\n/g,'\n      ')}`);};
const na =(n,w)=>{skip++;console.log(`  \x1b[33m–\x1b[0m ${n}  (${w})`);};
const has=f=>fs.existsSync(f);
const read=f=>fs.readFileSync(f,'utf8');

/* ---- 从一份 build 里取出它的两处身份标记 ---- */
function marks(f){
  const s=read(f);
  const t=s.match(/<title>(.*?)<\/title>/);
  const v=s.match(/<div id="versionTag">(.*?)<\/div>/);
  if(!t||!v) return null;
  const ver=(v[1].match(/v(\d+\.\d+\.\d+)/)||[])[1];
  const suffix=(v[1].match(/[((]([^))]*)[))]/)||[])[1]||'';
  const prefix=(t[1].match(/^\[(.*?)\]/)||[])[1]||'';
  return {title:t[1], tag:v[1], ver, suffix, prefix};
}
/* 版本号比大小:v0.7.10 要排在 v0.7.9 后面,不能按字符串比 */
const cmpVer=(a,b)=>{
  const A=a.split('.').map(Number), B=b.split('.').map(Number);
  for(let i=0;i<3;i++){ if(A[i]!==B[i]) return A[i]-B[i]; }
  return 0;
};

console.log('\n\x1b[1m三份 build 的身份标记\x1b[0m');
const M={};
for(const [f,role] of [[PROD,''],[TEST,'测试版'],[DEV,'开发版']]){
  if(!has(f)){ na(`${f} 存在`, '文件不在,跳过'); continue; }
  const m=marks(f); M[f]=m;
  if(!m){ bad(`${f} 能读出 title / versionTag`); continue; }
  if(!m.ver){ bad(`${f} versionTag 里有版本号`, m.tag); continue; }
  // 角色标记:正式版两处都不该带方括号/后缀,另外两份都必须带且一致
  const wantPrefix=role, wantSuffix=role;
  if(m.prefix===wantPrefix && m.suffix===wantSuffix)
    ok(`${f}  v${m.ver}${role?`(${role})`:'(正式版,无标记)'}`);
  else
    bad(`${f} 的角色标记`, `title 前缀「${m.prefix||'无'}」/ versionTag 后缀「${m.suffix||'无'}」,` +
                          `按角色应为「${wantPrefix||'无'}」`);
}

console.log('\n\x1b[1m流水线方向\x1b[0m');
if(M[DEV]&&M[TEST]){
  // 开发版与测试版必须只差那两行标记
  const a=read(DEV).split('\n'), b=read(TEST).split('\n');
  if(a.length!==b.length){
    bad('开发版与测试版只差 title / versionTag 两行', `行数就不同:${a.length} vs ${b.length}`);
  }else{
    const d=[]; for(let i=0;i<a.length;i++) if(a[i]!==b[i]) d.push(i+1);
    const onlyMarks=d.every(n=>/<title>|id="versionTag"/.test(a[n-1]));
    if(d.length===2&&onlyMarks) ok('开发版与测试版只差 title / versionTag 两行');
    else bad('开发版与测试版只差 title / versionTag 两行',
             `实际差 ${d.length} 行:${d.slice(0,12).join(', ')}${d.length>12?' …':''}`);
  }
}else na('开发版与测试版逐行比对', '缺一份');

if(M[TEST]&&M[PROD]){
  const c=cmpVer(M[PROD].ver, M[TEST].ver);
  if(c<=0) ok(`正式版 v${M[PROD].ver} 不超前于测试版 v${M[TEST].ver}`);
  else bad('正式版不得超前于测试版', `正式版 v${M[PROD].ver} > 测试版 v${M[TEST].ver}`);
}else na('版本先后', '缺一份');

console.log('\n\x1b[1m生成的文档\x1b[0m');
if(has(DOC.switches)&&has(TEST)){
  const body=s=>{const i=s.indexOf('\n### ');return i<0?null:s.slice(i);};
  let gen=null;
  try{ gen=cp.execFileSync('node',[`${__dirname}/gen-switches.js`,TEST],{encoding:'utf8'}); }
  catch(e){ bad('gen-switches.js 能跑', e.message); }
  if(gen){
    const g=body(gen), c=body(read(DOC.switches));
    if(!g||!c) bad('docs/SWITCHES.md 能定位到主体(### 开头那段)');
    else if(g.trimEnd()===c.trimEnd()) ok(`docs/SWITCHES.md 主体 == AIP(${(gen.match(/共 (\d+) 个参数/)||[])[1]} 个参数)`);
    else bad('docs/SWITCHES.md 主体 == gen-switches.js 的输出',
             '开关表落后于 AIP。重新生成:node test/gen-switches.js 80fen-test.html');
  }
}else na('docs/SWITCHES.md 与 AIP 同步', '缺文件');

/* 发给参赛者的规则书是**生成**的(contest/gen-public.js),只对主 repo 的 docs/RULES.md
 * 做两处必要改写。手工副本会悄悄漂,而漂了之后参赛者按老规则写、裁判按新规则判 ——
 * 罚分就成了冤枉。 */
if(has('contest/public/RULES.md')&&has(DOC.rules)){
  const r=cp.spawnSync('node',['contest/gen-public.js','--check'],{encoding:'utf8'});
  if(r.status===0) ok('contest/public/RULES.md == 主 repo 的 docs/RULES.md(两处改写除外)');
  else bad('发给参赛者的规则书与主 repo 同步',
           (r.stderr||'').trim() || '重新生成:node contest/gen-public.js');
}else na('参赛者规则书与主 repo 同步', '缺文件');

console.log('\n\x1b[1m文档里写死的版本号\x1b[0m');
if(has('README.md')&&M[PROD]){
  const h=(read('README.md').match(/^#\s+.*?v(\d+\.\d+\.\d+)/m)||[])[1];
  if(!h) bad('README.md 标题里有版本号');
  else if(h===M[PROD].ver) ok(`README.md 标题 v${h} == 正式版`);
  else bad('README.md 标题 == 正式版版本号', `README 写 v${h},正式版是 v${M[PROD].ver}`);
}else na('README 标题版本号', '缺文件');

if(has(DOC.changelog)&&M[PROD]&&M[TEST]){
  const line=(read(DOC.changelog).match(/^当前:.*$/m)||[])[0];
  if(!line) bad('docs/CHANGELOG.md 有「当前:」那一行');
  else{
    const p=(line.match(/正式版\s*\**\s*v(\d+\.\d+\.\d+)/)||[])[1];
    const t=(line.match(/测试版\s*\**\s*v(\d+\.\d+\.\d+)/)||[])[1];
    if(p===M[PROD].ver&&t===M[TEST].ver) ok(`CHANGELOG 当前行 正式版 v${p} / 测试版 v${t}`);
    else bad('CHANGELOG「当前:」行 == 两份 build',
             `文档写 正式版 v${p||'?'} / 测试版 v${t||'?'},实际 v${M[PROD].ver} / v${M[TEST].ver}`);
  }
}else na('CHANGELOG 当前行', '缺文件');

console.log('\n\x1b[1m文档链接\x1b[0m');
/* 所有 .md 里指向仓库内文件的链接都得指得到东西。
 * 2026-09-05 把文档收进 docs/ 时,三条链接是靠人眼漏掉的(DESIGN 指 contest/public/、
 * 两份 notes 指 ../test/*.js)—— 挪文件时链接会断,而断链在 GitHub 上是静默的。 */
{
  const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>{
    if(e.name==='node_modules'||e.name==='.git') return [];
    const f=d+'/'+e.name;
    return e.isDirectory()?walk(f):(/\.md$/.test(e.name)?[f]:[]);
  });
  const broken=[];
  let n=0;
  for(const f of walk('.')){
    const dir=f.slice(0,f.lastIndexOf('/'));
    for(const m of read(f).matchAll(/\]\(([^)#\s]+)[^)]*\)/g)){
      const href=m[1];
      if(/^(https?:|mailto:|#)/.test(href)) continue;
      n++;
      if(!has(require('path').normalize(dir+'/'+href))) broken.push(`${f} → ${href}`);
    }
  }
  if(!broken.length) ok(`${n} 个仓库内链接都指得到`);
  else bad(`${n} 个仓库内链接都指得到`, broken.slice(0,10).join('\n') +
           (broken.length>10?`\n… 共 ${broken.length} 条`:''));
}

console.log('\n\x1b[1m工作区\x1b[0m');
try{
  const out=cp.execSync('git ls-files --others --exclude-standard',{encoding:'utf8'}).trim();
  const list=out?out.split('\n'):[];
  const stray=list.filter(f=>!UNTRACKED_OK.some(r=>r.test(f)));
  if(!stray.length) ok(`未跟踪文件都在白名单里(共 ${list.length} 个)`);
  else bad('未跟踪文件都在白名单里',
           `不在白名单:\n${stray.map(f=>'  '+f).join('\n')}\n` +
           '要么提交,要么加进 .gitignore —— 别让它一直挂在 status 里等着被 git add -A 扫走');
}catch(e){ na('未跟踪文件白名单', 'git 不可用'); }

if(process.argv.includes('--full')){
  console.log('\n\x1b[1m引擎自测(--full)\x1b[0m');
  const vm=require('vm');
  for(const f of [PROD,TEST,DEV]){
    if(!has(f)){ na(`${f} 自测`,'文件不在'); continue; }
    const b=[...read(f).matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
    const ctx={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};
    ctx.globalThis=ctx; vm.createContext(ctx);
    vm.runInContext(b[0],ctx); vm.runInContext(b[1],ctx);
    const r=ctx.runTests(ctx.module.exports);
    if(r.fail===0) ok(`${f} 自测 ${r.pass}/${r.pass}`);
    else bad(`${f} 自测全过`, r.out.filter(x=>!x.cond).map(x=>x.name).join('\n'));
  }
}else{
  console.log('\n\x1b[2m(自测与场景库没跑 —— 加 --full,约 4 分钟)\x1b[0m');
}

console.log(`\n${fail?`\x1b[31m不符 ${fail} 条\x1b[0m`:'\x1b[32m全部一致\x1b[0m'}` +
            `${skip?`,跳过 ${skip} 条`:''}\n`);
process.exit(fail?1:0);
